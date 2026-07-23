import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { DatacenterBranch } from '../branches/branch.types';

interface AuditActorRow extends RowDataPacket {
  transactionNo: string | null;
  actorName: string | null;
  actorUserId: string | null;
}

@Injectable()
export class BranchAuditTrailService {
  constructor(private readonly config: ConfigService) {}

  async approversByTransaction(
    branch: DatacenterBranch,
    transactionNumbers: string[],
  ): Promise<Map<string, string>> {
    return this.auditNamesByTransaction(branch, transactionNumbers, 'approver');
  }

  async reprintsByTransaction(
    branch: DatacenterBranch,
    transactionNumbers: string[],
  ): Promise<Map<string, string>> {
    return this.auditNamesByTransaction(branch, transactionNumbers, 'reprint');
  }

  private async auditNamesByTransaction(
    branch: DatacenterBranch,
    transactionNumbers: string[],
    auditType: 'approver' | 'reprint',
  ): Promise<Map<string, string>> {
    const uniqueNumbers = [
      ...new Set(transactionNumbers.map((value) => this.transactionKey(value)).filter(Boolean)),
    ];
    const names = new Map<string, string>();
    if (uniqueNumbers.length === 0) return names;

    const pool = this.createPool(branch);
    try {
      for (const chunk of this.chunks(uniqueNumbers, 500)) {
        const placeholders = chunk.map(() => '?').join(',');
        const descriptionPredicate =
          auditType === 'approver'
            ? "LOWER(COALESCE(description, '')) LIKE '%oic approval%'"
            : "LOWER(TRIM(COALESCE(description, ''))) = 'reprint'";
        const [rows] = await pool.query<AuditActorRow[]>(
          `
            SELECT
              CAST(TransactionNo AS CHAR) AS transactionNo,
              NULLIF(TRIM(name), '') AS actorName,
              NULLIF(TRIM(UserID), '') AS actorUserId
            FROM audit_trail
            WHERE CAST(TransactionNo AS CHAR) IN (${placeholders})
              AND ${descriptionPredicate}
            ORDER BY datetime DESC, id DESC
          `,
          chunk,
        );

        for (const row of rows) {
          const transactionNo = this.transactionKey(row.transactionNo);
          if (!transactionNo || names.has(transactionNo)) continue;
          const name = row.actorName?.trim() || row.actorUserId?.trim();
          if (name) names.set(transactionNo, name);
        }
      }
      return names;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  private createPool(branch: DatacenterBranch): Pool {
    return createPool({
      host: branch.branchservername,
      port: Number(this.config.get<string | number>('BRANCH_AUDIT_MYSQL_PORT', 3306)),
      user: this.config.getOrThrow<string>('BRANCH_AUDIT_MYSQL_USER'),
      password: this.config.getOrThrow<string>('BRANCH_AUDIT_MYSQL_PASSWORD'),
      database: this.config.getOrThrow<string>('BRANCH_AUDIT_MYSQL_DATABASE'),
      waitForConnections: true,
      connectionLimit: Number(
        this.config.get<string | number>('BRANCH_AUDIT_MYSQL_CONNECTION_LIMIT', 2),
      ),
      connectTimeout: Number(
        this.config.get<string | number>('BRANCH_AUDIT_MYSQL_CONNECT_TIMEOUT_MS', 30_000),
      ),
    });
  }

  private transactionKey(value: string | null | undefined): string {
    return value?.trim() ?? '';
  }

  private chunks<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
