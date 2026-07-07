import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import { DatacenterBranch } from '../branches/branch.types';

interface AuditApproverRow extends RowDataPacket {
  TransactionNo: string | null;
  approverName: string | null;
  approverUserId: string | null;
}

@Injectable()
export class BranchAuditTrailService {
  constructor(private readonly config: ConfigService) {}

  async approversByTransaction(
    branch: DatacenterBranch,
    transactionNumbers: string[],
  ): Promise<Map<string, string>> {
    const uniqueNumbers = [...new Set(transactionNumbers.filter(Boolean))];
    const approvers = new Map<string, string>();
    if (uniqueNumbers.length === 0) return approvers;

    const pool = this.createPool(branch);
    try {
      for (const chunk of this.chunks(uniqueNumbers, 500)) {
        const placeholders = chunk.map(() => '?').join(',');
        const [rows] = await pool.query<AuditApproverRow[]>(
          `
            SELECT
              TransactionNo,
              NULLIF(TRIM(name), '') AS approverName,
              NULLIF(TRIM(UserID), '') AS approverUserId
            FROM audit_trail
            WHERE TransactionNo IN (${placeholders})
              AND LOWER(COALESCE(description, '')) LIKE '%oic approval%'
            ORDER BY datetime DESC, id DESC
          `,
          chunk,
        );

        for (const row of rows) {
          const transactionNo = row.TransactionNo?.trim();
          if (!transactionNo || approvers.has(transactionNo)) continue;
          const approver = row.approverName?.trim() || row.approverUserId?.trim();
          if (approver) approvers.set(transactionNo, approver);
        }
      }
      return approvers;
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

  private chunks<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}
