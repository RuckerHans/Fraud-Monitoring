import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { BranchesService } from '../branches/branches.service';
import { BranchAuditTrailService } from './branch-audit-trail.service';
import { BranchConnectionFactory } from './branch-connection.factory';
import {
  ExportQueryDto,
  ReceiptQueryDto,
  ReportException,
  ReportQueryDto,
} from './report-query.dto';
import {
  RECEIPT_HEADER_SQL,
  RECEIPT_ITEMS_SQL,
  RECEIPT_PAYMENTS_SQL,
  REPORT_COUNT_SQL,
  REPORT_EXPORT_SQL,
  REPORT_PAGE_SQL,
  reprintedReportSql,
} from './report.sql';
import {
  FraudReportRow,
  PagedReport,
  ReceiptHeader,
  ReceiptItem,
  ReceiptPayment,
  TransactionReceipt,
} from './report.types';
import { DatacenterBranch } from '../branches/branch.types';
import { BranchUnreachableError } from '../common/errors';

const assumptions = [
  'CustomerName currently falls back to CustomerCode until the branch customer table is confirmed.',
  'PointsPosted=1 with positive Points is treated as earned; negative Points is treated as redeemed pending ledger confirmation.',
];

@Injectable()
export class ReportsService {
  constructor(
    private readonly branches: BranchesService,
    private readonly connections: BranchConnectionFactory,
    private readonly auditTrail: BranchAuditTrailService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReportsService.name);
  }

  async find(query: ReportQueryDto, user = 'unknown'): Promise<PagedReport> {
    this.validateRange(query);
    const branchIds = this.branchIds(query);
    const branches = await this.branches.resolveManyForConnection(branchIds);
    const rows: FraudReportRow[] = [];
    const warnings: string[] = [];
    let total = 0;
    let successfulBranches = 0;
    const perBranchLimit = query.page * query.pageSize;
    for (const branch of branches) {
      const started = Date.now();
      try {
        const reprintTransactionNumbers = await this.reprintTransactionNumbersForDefault(
          branch,
          query,
        );
        const [branchRows, countRows, reprintRows] = await this.connections.withConnection(
          branch,
          async (source) => {
            const sqlException = this.sqlException(query);
            const pageRows = sqlException
              ? await source.query(REPORT_PAGE_SQL, [
                ...this.params(query, sqlException),
                0,
                perBranchLimit,
              ])
              : [];
            const totals = sqlException
              ? await source.query(REPORT_COUNT_SQL, this.params(query, sqlException))
              : [{ total: 0 }];
            const reprintRows = await this.reprintedRows(
              source,
              query,
              reprintTransactionNumbers,
            );
            return [this.mergeExceptionRows(query, pageRows, reprintRows), totals, reprintRows];
          },
        );
        successfulBranches += 1;
        total +=
          Number(countRows[0]?.total ?? 0) +
          this.additionalReprintRows(query, reprintRows).length;
        rows.push(...(await this.normalizeRows(branchRows, branch)));
        this.logQuery('branch_query', branch, query, user, started, branchRows.length);
      } catch (error) {
        const reason = this.branchFailureReason(error);
        warnings.push(`${branch.branchlocation || branch.branchcode}: ${reason}`);
        this.logger.warn({
          event: 'branch_query_failed',
          branchId: String(branch.id),
          reason,
          errorCode: error instanceof BranchUnreachableError ? error.code : undefined,
          databaseError: this.databaseErrorForLog(error),
          from: query.from,
          to: query.to,
          user,
          durationMs: Date.now() - started,
        });
      }
    }
    if (successfulBranches === 0) {
      throw new BranchUnreachableError(warnings.join(' '));
    }
    const offset = (query.page - 1) * query.pageSize;
    const pageRows = rows
      .sort((left, right) => this.compareRows(left, right))
      .slice(offset, offset + query.pageSize);
    return {
      data: pageRows,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
      assumptions,
      warnings,
    };
  }

  async exportRows(query: ExportQueryDto, user = 'unknown'): Promise<FraudReportRow[]> {
    this.validateRange(query);
    const branches = await this.branches.resolveManyForConnection(this.branchIds(query));
    const rows: FraudReportRow[] = [];
    let successfulBranches = 0;
    for (const branch of branches) {
      const started = Date.now();
      try {
        const reprintTransactionNumbers = await this.reprintTransactionNumbersForDefault(
          branch,
          query,
        );
        const branchRows = await this.connections.withConnection(branch, async (source) =>
          this.mergeExceptionRows(
            query,
            await this.exportBaseRows(source, query),
            await this.reprintedRows(source, query, reprintTransactionNumbers),
          ),
        );
        successfulBranches += 1;
        rows.push(...(await this.normalizeRows(branchRows, branch)));
        this.logQuery('branch_export', branch, query, user, started, branchRows.length);
      } catch {
        this.logger.warn({
          event: 'branch_export_failed',
          branchId: String(branch.id),
          from: query.from,
          to: query.to,
          user,
          durationMs: Date.now() - started,
        });
      }
    }
    if (successfulBranches === 0) {
      throw new BranchUnreachableError('None of the selected branches could be exported.');
    }
    return rows
      .sort((left, right) => this.compareRows(left, right))
      .slice(0, 50_000);
  }

  async receipt(query: ReceiptQueryDto): Promise<TransactionReceipt> {
    const branch = await this.branches.resolveForConnection(query.branchId);
    const params = [query.transactionNo, query.terminalNo ?? null];
    const [headerRows, itemRows, paymentRows] = await this.connections.withConnection(
      branch,
      async (source) => Promise.all([
        source.query(RECEIPT_HEADER_SQL, params),
        source.query(RECEIPT_ITEMS_SQL, params),
        source.query(RECEIPT_PAYMENTS_SQL, params),
      ]),
    );

    const headerRow = headerRows[0];
    if (!headerRow) {
      throw new NotFoundException('The selected transaction was not found.');
    }

    const transactionNo = String(headerRow.transactionNo);
    let approver: string | null = null;
    let reprint: string | null = null;
    let reprintCount = 0;
    try {
      const [approvers, reprints, reprintCounts] = await Promise.all([
        this.auditTrail.approversByTransaction(branch, [transactionNo]),
        this.auditTrail.reprintsByTransaction(branch, [transactionNo]),
        this.auditTrail.reprintCountsByTransaction(branch, [transactionNo]),
      ]);
      approver = approvers.get(transactionNo) ?? null;
      reprint = reprints.get(transactionNo) ?? null;
      reprintCount = reprintCounts.get(transactionNo) ?? 0;
    } catch (error) {
      this.logger.warn({
        event: 'receipt_audit_lookup_failed',
        branchId: String(branch.id),
        transactionNo,
        databaseError: this.databaseErrorForLog(error),
      });
    }

    const items: ReceiptItem[] = (itemRows as unknown[]).map((row: any) =>
      this.normalizeReceiptItem(row),
    );
    const payments: ReceiptPayment[] = (paymentRows as unknown[]).map((row: any) =>
      this.normalizeReceiptPayment(row),
    );
    return {
      header: this.normalizeReceiptHeader(headerRow, branch, approver, reprint),
      items,
      payments,
      totals: {
        itemCount: items.length,
        returnedItemCount: items.filter((item) => item.returned).length,
        voidedItemCount: items.filter((item) => item.voided).length,
        pointsEarned: items.reduce(
          (sum, item) => sum + (item.pointsPosted && item.points > 0 ? item.points : 0),
          0,
        ),
        pointsRedeemed: items.reduce(
          (sum, item) => sum + (item.pointsPosted && item.points < 0 ? Math.abs(item.points) : 0),
          0,
        ),
        reprintCount,
        paymentTotal: payments
          .filter((payment) => !payment.voided && payment.amount > 0)
          .reduce((sum, payment) => sum + payment.amount, 0),
      },
    };
  }

  private params(
    query: ReportQueryDto,
    exceptionOverride?: Extract<ReportException, 'returnedOrVoided' | 'returned' | 'voided' | 'all'>,
  ) {
    return [
      query.from,
      query.to,
      query.returned === undefined ? null : Number(query.returned),
      query.voided === undefined ? null : Number(query.voided),
      query.points ?? null,
      exceptionOverride ?? query.exception ?? 'returnedOrVoided',
    ];
  }

  private validateRange(query: ReportQueryDto) {
    const from = new Date(`${query.from}T00:00:00Z`);
    const to = new Date(`${query.to}T00:00:00Z`);
    if (from > to) throw new BadRequestException('"from" must be on or before "to".');
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days > 366) throw new BadRequestException('Date ranges may not exceed 366 days.');
  }

  private branchIds(query: ReportQueryDto): string[] {
    const ids = [...new Set(query.branchIds.split(',').map((id) => id.trim()))];
    if (ids.length > 100) {
      throw new BadRequestException('At most 100 branches may be selected.');
    }
    return ids;
  }

  private async reprintTransactionNumbersForDefault(
    branch: DatacenterBranch,
    query: ReportQueryDto,
  ): Promise<string[]> {
    if (!this.includesReprints(query.exception)) return [];
    try {
      return await this.auditTrail.reprintTransactionNumbers(branch, query.from, query.to);
    } catch (error) {
      this.logger.warn({
        event: 'branch_reprint_directory_failed',
        branchId: String(branch.id),
        databaseError: this.databaseErrorForLog(error),
      });
      return [];
    }
  }

  private async reprintedRows(
    source: { query: (sql: string, params: unknown[]) => Promise<any[]> },
    query: ReportQueryDto,
    transactionNumbers: string[],
  ): Promise<any[]> {
    if (!this.includesReprints(query.exception) || transactionNumbers.length === 0) {
      return [];
    }
    const rows: any[] = [];
    for (const chunk of this.chunks(transactionNumbers, 500)) {
      rows.push(
        ...(await source.query(reprintedReportSql(chunk.length), [
          ...this.params(query, 'all'),
          ...chunk,
        ])),
      );
    }
    return rows;
  }

  private async exportBaseRows(
    source: { query: (sql: string, params: unknown[]) => Promise<any[]> },
    query: ReportQueryDto,
  ): Promise<any[]> {
    const sqlException = this.sqlException(query);
    if (!sqlException) return [];
    return source.query(REPORT_EXPORT_SQL, this.params(query, sqlException));
  }

  private mergeExceptionRows(
    query: ReportQueryDto,
    baseRows: any[],
    reprintRows: any[],
  ): any[] {
    if (reprintRows.length === 0) return baseRows;
    const merged: any[] = [];
    const seen = new Set<string>();
    for (const row of baseRows) {
      merged.push(row);
      seen.add(this.rowKey(row));
    }
    for (const row of this.additionalReprintRows(query, reprintRows)) {
      const key = this.rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
    return merged;
  }

  private additionalReprintRows(query: ReportQueryDto, rows: any[]): any[] {
    switch (query.exception) {
      case 'returnedOrVoided':
        return rows.filter((row) => !row.returned && !row.voided);
      case 'returnedOrReprinted':
        return rows.filter((row) => !row.returned);
      case 'voidedOrReprinted':
        return rows.filter((row) => !row.voided);
      case 'reprinted':
        return rows;
      default:
        return [];
    }
  }

  private sqlException(
    query: ReportQueryDto,
  ): Extract<ReportException, 'returnedOrVoided' | 'returned' | 'voided' | 'all'> | null {
    switch (query.exception) {
      case 'returnedAndVoided':
        return 'returnedOrVoided';
      case 'returnedOrReprinted':
        return 'returned';
      case 'voidedOrReprinted':
        return 'voided';
      case 'reprinted':
        return null;
      case 'returnedOrVoided':
      case 'returned':
      case 'voided':
      case 'all':
        return query.exception;
      default:
        return 'returnedOrVoided';
    }
  }

  private includesReprints(exception: ReportException): boolean {
    return [
      'returnedOrVoided',
      'reprinted',
      'returnedOrReprinted',
      'voidedOrReprinted',
    ].includes(exception);
  }

  private rowKey(row: any): string {
    return `${String(row.transactionNo)}:${String(row.terminalNo ?? '')}`;
  }

  private normalize(row: any, branch: DatacenterBranch): FraudReportRow {
    return {
      ...row,
      branchId: String(branch.id),
      branchCode: branch.branchcode,
      branchLocation: branch.branchlocation || branch.branchcode,
      transactionNo: String(row.transactionNo),
      approver: row.approver ?? null,
      reprint: row.reprint ?? null,
      amount: Number(row.amount ?? 0),
      returned: Boolean(row.returned),
      voided: Boolean(row.voided),
      pointsEarned: Number(row.pointsEarned ?? 0),
      pointsRedeemed: Number(row.pointsRedeemed ?? 0),
    };
  }

  private async normalizeRows(
    rows: unknown[],
    branch: DatacenterBranch,
  ): Promise<FraudReportRow[]> {
    const normalized = rows.map((row: unknown) => this.normalize(row, branch));
    if (normalized.length === 0) return normalized;

    try {
      const transactionNumbers = normalized.map((row) => row.transactionNo);
      const [approvers, reprints] = await Promise.all([
        this.auditTrail.approversByTransaction(branch, transactionNumbers),
        this.auditTrail.reprintsByTransaction(branch, transactionNumbers),
      ]);
      if (approvers.size === 0) {
        this.logger.info({
          event: 'branch_audit_no_approvers',
          branchId: String(branch.id),
          branchLocation: branch.branchlocation || branch.branchcode,
          transactionCount: normalized.length,
        });
      }
      return normalized.map((row) => ({
        ...row,
        approver: approvers.get(row.transactionNo) ?? null,
        reprint: reprints.get(row.transactionNo) ?? null,
      }));
    } catch (error) {
      this.logger.warn({
        event: 'branch_audit_lookup_failed',
        branchId: String(branch.id),
        databaseError: this.databaseErrorForLog(error),
      });
      return normalized;
    }
  }

  private normalizeReceiptHeader(
    row: any,
    branch: DatacenterBranch,
    approver: string | null,
    reprint: string | null,
  ): ReceiptHeader {
    return {
      branchId: String(branch.id),
      branchCode: branch.branchcode,
      branchLocation: branch.branchlocation || branch.branchcode,
      transactionNo: String(row.transactionNo),
      customerCode: row.customerCode ?? null,
      customerName: row.customerName ?? null,
      approver,
      reprint,
      subTotal: Number(row.subTotal ?? 0),
      grandTotal: Number(row.grandTotal ?? 0),
      downPayments: Number(row.downPayments ?? 0),
      discount: Number(row.discount ?? 0),
      amountDiscounted: Number(row.amountDiscounted ?? 0),
      allowance: Number(row.allowance ?? 0),
      returnSubtotal: Number(row.returnSubtotal ?? 0),
      userId: row.userId ?? null,
      terminalNo: row.terminalNo ?? null,
      shift: row.shift === null || row.shift === undefined ? null : Number(row.shift),
      logDate: row.logDate,
      dateTime: row.dateTime ?? null,
      branchCodeFromTransaction: row.branchCodeFromTransaction ?? null,
      voided: Boolean(row.voided),
      voidRemarks: row.voidRemarks ?? null,
      seniorCitizenName: row.seniorCitizenName ?? null,
      oscaId: row.oscaId ?? null,
      pwdTag: Boolean(row.pwdTag),
    };
  }

  private normalizeReceiptItem(row: any): ReceiptItem {
    return {
      lineId: Number(row.lineId ?? 0),
      productId: row.productId === null || row.productId === undefined
        ? null
        : Number(row.productId),
      productCode: row.productCode ?? null,
      barcode: row.barcode ?? null,
      description: row.description ?? null,
      uom: row.uom ?? null,
      qty: Number(row.qty ?? 0),
      packing: Number(row.packing ?? 0),
      totalQty: Number(row.totalQty ?? 0),
      price: Number(row.price ?? 0),
      discount: Number(row.discount ?? 0),
      amountDiscounted: Number(row.amountDiscounted ?? 0),
      discountedPrice: Number(row.discountedPrice ?? 0),
      extended: Number(row.extended ?? 0),
      returned: Boolean(row.returned),
      returnDescription: row.returnDescription ?? null,
      returnRemarks: row.returnRemarks ?? null,
      voided: Boolean(row.voided),
      points: Number(row.points ?? 0),
      pointsPosted: Boolean(row.pointsPosted),
      priceModeCode: row.priceModeCode ?? null,
      productDescription: row.productDescription ?? null,
      posDescription: row.posDescription ?? null,
      reportUom: row.reportUom ?? null,
      posUom: row.posUom ?? null,
      srp: Number(row.srp ?? 0),
    };
  }

  private normalizeReceiptPayment(row: any): ReceiptPayment {
    return {
      tenderCode: row.tenderCode ?? null,
      description: row.description ?? null,
      amount: Number(row.amount ?? 0),
      cash: Boolean(row.cash),
      change: Boolean(row.change),
      chargeToAccount: Boolean(row.chargeToAccount),
      accountNo: row.accountNo ?? null,
      approvalNo: row.approvalNo ?? null,
      remarks: row.remarks ?? null,
      userId: row.userId ?? null,
      terminalNo: row.terminalNo ?? null,
      voided: Boolean(row.voided),
      dateTime: row.dateTime ?? null,
    };
  }

  private compareRows(left: FraudReportRow, right: FraudReportRow): number {
    const dateOrder = new Date(right.logDate).getTime() - new Date(left.logDate).getTime();
    return dateOrder || right.transactionNo.localeCompare(left.transactionNo);
  }

  private logQuery(
    event: 'branch_query' | 'branch_export',
    branch: DatacenterBranch,
    query: ReportQueryDto,
    user: string,
    started: number,
    rowCount: number,
  ) {
    this.logger.info({
      event,
      branchId: String(branch.id),
      from: query.from,
      to: query.to,
      user,
      durationMs: Date.now() - started,
      rowCount,
    });
  }

  private branchFailureReason(error: unknown): string {
    if (error instanceof BranchUnreachableError) return error.message;
    if (error && typeof error === 'object') {
      const value = error as {
        name?: string;
        code?: string;
        driverError?: { code?: string };
      };
      const code = value.code ?? value.driverError?.code;
      if (value.name === 'QueryFailedError' || code === 'EREQUEST') {
        return 'The report query does not match this branch database schema.';
      }
    }
    return 'The branch report query failed.';
  }

  private databaseErrorForLog(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const value = error as {
      message?: string;
      driverError?: {
        message?: string;
        originalError?: { message?: string; info?: { message?: string } };
      };
    };
    const message =
      value.driverError?.originalError?.info?.message ??
      value.driverError?.originalError?.message ??
      value.driverError?.message ??
      value.message;
    if (!message) return undefined;
    return message
      .replace(/(password|user(?:name)?)\s*[=:]\s*[^,; ]+/gi, '$1=[REDACTED]')
      .slice(0, 500);
  }

  private chunks<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
