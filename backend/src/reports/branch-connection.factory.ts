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
      } catch {
        throw new BranchUnreachableError('Branch connection failed');
      }
      try {
        return await operation(source);
      } catch (error: any) {
        const code = String(error?.code ?? error?.originalError?.code ?? '');
        if (['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ELOGIN'].includes(code)) {
          throw new BranchUnreachableError('Branch query connection failed');
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
        connectionTimeout: this.config.get<number>('MSSQL_CONNECT_TIMEOUT_MS', 5_000),
        requestTimeout: this.config.get<number>('MSSQL_REQUEST_TIMEOUT_MS', 15_000),
        pool: { max: 2, min: 0, idleTimeoutMillis: 10_000 },
      },
    });
  }
}
