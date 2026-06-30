import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DatacenterBranch } from '../branches/branch.types';
import { BranchUnreachableError } from '../common/errors';

@Injectable()
export class BranchConnectionFactory {
  constructor(private readonly config: ConfigService) {}

  async withConnection<T>(
    branch: DatacenterBranch,
    operation: (source: DataSource) => Promise<T>,
  ): Promise<T> {
    const source = this.create(branch);
    try {
      try {
        await source.initialize();
      } catch (error: any) {
        const code = this.errorCode(error);
        throw new BranchUnreachableError(this.connectionMessage(code), code);
      }
      try {
        return await operation(source);
      } catch (error: any) {
        const code = this.errorCode(error);
        if (['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ELOGIN'].includes(code)) {
          throw new BranchUnreachableError(this.connectionMessage(code), code);
        }
        throw error;
      }
    } finally {
      if (source.isInitialized) await source.destroy().catch(() => undefined);
    }
  }

  create(branch: DatacenterBranch): DataSource {
    return new DataSource({
      type: 'mssql',
      host: branch.branchservername,
      port: Number(branch.branchserverport ?? 1433),
      username: branch.branchserverusername,
      password: branch.branchserverpassword,
      database: branch.branchserverdatabasename,
      synchronize: false,
      logging: false,
      options: { encrypt: false, trustServerCertificate: true },
      extra: {
        connectionTimeout: Number(
          this.config.get<string | number>('MSSQL_CONNECT_TIMEOUT_MS', 30_000),
        ),
        requestTimeout: Number(
          this.config.get<string | number>('MSSQL_REQUEST_TIMEOUT_MS', 1_200_000),
        ),
        pool: { max: 2, min: 0, idleTimeoutMillis: 10_000 },
      },
    });
  }

  private errorCode(error: any): string {
    const code = String(
      error?.code ??
      error?.originalError?.code ??
      error?.driverError?.code ??
      error?.driverError?.originalError?.code ??
      '',
    ).toUpperCase();
    if (code) return code;
    const message = String(
      error?.message ??
      error?.originalError?.message ??
      error?.driverError?.message ??
      '',
    ).toLowerCase();
    if (
      message.includes('timed out') ||
      (message.includes('failed to connect') && message.includes('ms'))
    ) return 'ETIMEOUT';
    if (message.includes('login failed')) return 'ELOGIN';
    if (message.includes('failed to connect') || message.includes('socket')) return 'ESOCKET';
    return '';
  }

  private connectionMessage(code: string): string {
    if (code === 'ELOGIN') return 'The branch database rejected its configured login.';
    if (code === 'ETIMEOUT') return 'The branch database connection timed out.';
    if (['ESOCKET', 'ECONNCLOSED', 'ECONNREFUSED'].includes(code)) {
      return 'The branch database server is unreachable.';
    }
    return 'The branch database connection could not be established.';
  }
}
