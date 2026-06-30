import { HttpService } from '@nestjs/axios';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { UpstreamUnavailableError } from '../common/errors';
import { DatacenterBranch, PublicBranch } from './branch.types';

@Injectable()
export class BranchesService {
  private publicCache?: { expiresAt: number; branches: PublicBranch[] };

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async list(): Promise<PublicBranch[]> {
    if (this.publicCache && this.publicCache.expiresAt > Date.now()) {
      return this.publicCache.branches;
    }
    const records = await this.fetchRecords();
    const branches = records
      .filter((branch) => this.isIncluded(branch))
      .map((branch) => this.toPublic(branch))
      .sort((left, right) =>
        left.location.localeCompare(right.location, undefined, { sensitivity: 'base' }) ||
        left.code.localeCompare(right.code),
      );
    this.publicCache = {
      branches,
      expiresAt: Date.now() + this.config.get<number>('BRANCH_CACHE_TTL_MS', 120_000),
    };
    return branches;
  }

  // Credentials are deliberately fetched fresh and never enter the public-list cache.
  async resolveForConnection(branchId: string): Promise<DatacenterBranch> {
    return (await this.resolveManyForConnection([branchId]))[0];
  }

  async resolveManyForConnection(branchIds: string[]): Promise<DatacenterBranch[]> {
    const records = await this.fetchRecords();
    const byId = new Map(records.map((branch) => [String(branch.id), branch]));
    return branchIds.map((branchId) => {
      const branch = byId.get(branchId);
      if (!branch) throw new NotFoundException(`Branch ${branchId} was not found.`);
      if (!this.isIncluded(branch)) {
        throw new NotFoundException(`Branch ${branchId} is excluded from monitoring.`);
      }
      if (!this.isOnline(branch)) {
        throw new NotFoundException(`Branch ${branchId} is currently offline.`);
      }
      return branch;
    });
  }

  private async fetchRecords(): Promise<DatacenterBranch[]> {
    try {
      const baseUrl = this.config.getOrThrow<string>('DATACENTER_API_URL');
      const { data } = await firstValueFrom(
        this.http.get<DatacenterBranch[]>(`${baseUrl}/branch/list-datacenter`, {
          headers: { 'api-key': this.config.getOrThrow<string>('API_KEY') },
          timeout: 5_000,
        }),
      );
      if (!Array.isArray(data)) throw new Error('Invalid branch response');
      return data;
    } catch {
      throw new UpstreamUnavailableError('Datacenter API unavailable');
    }
  }

  private toPublic(branch: DatacenterBranch): PublicBranch {
    return {
      id: String(branch.id),
      code: branch.branchcode,
      location: branch.branchlocation || branch.branchcode,
      online: this.isOnline(branch),
    };
  }

  private isOnline(branch: DatacenterBranch): boolean {
    const expectedActive = this.config.get<string>('DATACENTER_ACTIVE_VALUE', '0');
    return (
      String(branch.isactive).toLowerCase() === expectedActive.toLowerCase() &&
      ['1', 'true'].includes(String(branch.branchconnected).toLowerCase())
    );
  }

  private isIncluded(branch: DatacenterBranch): boolean {
    return !branch.branchlocation?.trim().toUpperCase().endsWith('_FC');
  }
}
