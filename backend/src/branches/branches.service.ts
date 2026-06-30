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
    const branches = records.map((branch) => this.toPublic(branch));
    this.publicCache = {
      branches,
      expiresAt: Date.now() + this.config.get<number>('BRANCH_CACHE_TTL_MS', 120_000),
    };
    return branches;
  }

  // Credentials are deliberately fetched fresh and never enter the public-list cache.
  async resolveForConnection(branchId: string): Promise<DatacenterBranch> {
    const branch = (await this.fetchRecords()).find((item) => String(item.id) === branchId);
    if (!branch) throw new NotFoundException('Branch not found.');
    if (!this.isOnline(branch)) {
      throw new NotFoundException('Branch is currently offline.');
    }
    return branch;
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
      name: branch.branchname,
      online: this.isOnline(branch),
    };
  }

  private isOnline(branch: DatacenterBranch): boolean {
    const expectedActive = this.config.get<string>('DATACENTER_ACTIVE_VALUE', '1');
    return (
      String(branch.isactive).toLowerCase() === expectedActive.toLowerCase() &&
      ['1', 'true'].includes(String(branch.branchconnected).toLowerCase())
    );
  }
}
