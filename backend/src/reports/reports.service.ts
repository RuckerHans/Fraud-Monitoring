import { BadRequestException, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { BranchesService } from '../branches/branches.service';
import { BranchConnectionFactory } from './branch-connection.factory';
import { ExportQueryDto, ReportQueryDto } from './report-query.dto';
import { REPORT_COUNT_SQL, REPORT_EXPORT_SQL, REPORT_PAGE_SQL } from './report.sql';
import { FraudReportRow, PagedReport } from './report.types';
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
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReportsService.name);
  }

  async find(query: ReportQueryDto, user = 'unknown'): Promise<PagedReport> {
    this.validateRange(query);
    const branchIds = this.branchIds(query);
    const branches = await this.branches.resolveManyForConnection(branchIds);
    const params = this.params(query);
    const rows: FraudReportRow[] = [];
    const warnings: string[] = [];
    let total = 0;
    let successfulBranches = 0;
    const perBranchLimit = query.page * query.pageSize;
    for (const branch of branches) {
      const started = Date.now();
      try {
        const [branchRows, countRows] = await this.connections.withConnection(
          branch,
          async (source) => {
            const pageRows = await source.query(REPORT_PAGE_SQL, [
              ...params,
              0,
              perBranchLimit,
            ]);
            const totals = await source.query(REPORT_COUNT_SQL, params);
            return [pageRows, totals];
          },
        );
        successfulBranches += 1;
        total += Number(countRows[0]?.total ?? 0);
        rows.push(...branchRows.map((row: unknown) => this.normalize(row, branch)));
        this.logQuery('branch_query', branch, query, user, started, branchRows.length);
      } catch (error) {
        const reason = this.branchFailureReason(error);
        warnings.push(`${branch.branchlocation || branch.branchcode}: ${reason}`);
        this.logger.warn({
          event: 'branch_query_failed',
          branchId: String(branch.id),
          reason,
          errorCode: error instanceof BranchUnreachableError ? error.code : undefined,
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
        const branchRows = await this.connections.withConnection(branch, (source) =>
          source.query(REPORT_EXPORT_SQL, this.params(query)),
        );
        successfulBranches += 1;
        rows.push(...branchRows.map((row: unknown) => this.normalize(row, branch)));
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

  private params(query: ReportQueryDto) {
    return [
      query.from,
      query.to,
      query.returned === undefined ? null : Number(query.returned),
      query.voided === undefined ? null : Number(query.voided),
      query.points ?? null,
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

  private normalize(row: any, branch: DatacenterBranch): FraudReportRow {
    return {
      ...row,
      branchId: String(branch.id),
      branchCode: branch.branchcode,
      branchLocation: branch.branchlocation || branch.branchcode,
      transactionNo: String(row.transactionNo),
      amount: Number(row.amount ?? 0),
      returned: Boolean(row.returned),
      voided: Boolean(row.voided),
      pointsEarned: Number(row.pointsEarned ?? 0),
      pointsRedeemed: Number(row.pointsRedeemed ?? 0),
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
}
