import { BadRequestException, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { BranchesService } from '../branches/branches.service';
import { BranchConnectionFactory } from './branch-connection.factory';
import { ExportQueryDto, ReportQueryDto } from './report-query.dto';
import { REPORT_COUNT_SQL, REPORT_EXPORT_SQL, REPORT_PAGE_SQL } from './report.sql';
import { FraudReportRow, PagedReport } from './report.types';

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
    const started = Date.now();
    const branch = await this.branches.resolveForConnection(query.branchId);
    const params = this.params(query);
    const [rows, countRows] = await this.connections.withConnection(branch, async (source) => {
      const pageRows = await source.query(REPORT_PAGE_SQL, [
        ...params,
        (query.page - 1) * query.pageSize,
        query.pageSize,
      ]);
      const totals = await source.query(REPORT_COUNT_SQL, params);
      return [pageRows, totals];
    });
    const total = Number(countRows[0]?.total ?? 0);
    this.logger.info({
      event: 'branch_query',
      branchId: query.branchId,
      from: query.from,
      to: query.to,
      user,
      durationMs: Date.now() - started,
      rowCount: rows.length,
    });
    return {
      data: rows.map(this.normalize),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
      assumptions,
    };
  }

  async exportRows(query: ExportQueryDto, user = 'unknown'): Promise<FraudReportRow[]> {
    this.validateRange(query);
    const started = Date.now();
    const branch = await this.branches.resolveForConnection(query.branchId);
    const rows = await this.connections.withConnection(branch, (source) =>
      source.query(REPORT_EXPORT_SQL, this.params(query)),
    );
    this.logger.info({
      event: 'branch_export',
      branchId: query.branchId,
      from: query.from,
      to: query.to,
      user,
      durationMs: Date.now() - started,
      rowCount: rows.length,
    });
    return rows.map(this.normalize);
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

  private normalize(row: any): FraudReportRow {
    return {
      ...row,
      transactionNo: String(row.transactionNo),
      amount: Number(row.amount ?? 0),
      returned: Boolean(row.returned),
      voided: Boolean(row.voided),
      pointsEarned: Number(row.pointsEarned ?? 0),
      pointsRedeemed: Number(row.pointsRedeemed ?? 0),
    };
  }
}
