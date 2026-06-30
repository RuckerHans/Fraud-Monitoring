import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { BranchesService } from '../src/branches/branches.service';

describe('BranchesService', () => {
  it('uses branchlocation, sorts locations, and never exposes connection fields', async () => {
    const get = jest.fn().mockReturnValue(of({
      data: [
        {
          id: '31',
          branchcode: 'BGB',
          branchname: 'Same Company',
          branchlocation: 'BAGUMBONG',
          isactive: 0,
          branchconnected: 1,
        },
        {
          id: '29',
          branchcode: 'LPN',
          branchname: 'Same Company',
          branchlocation: 'LASPINAS',
          isactive: 0,
          branchconnected: 1,
        },
        {
          id: '99',
          branchcode: 'LFC',
          branchname: 'Same Company',
          branchlocation: 'LASPINAS_FC',
          isactive: 0,
          branchconnected: 1,
        },
      ],
    }));
    const service = new BranchesService(
      { get } as unknown as HttpService,
      new ConfigService({
        DATACENTER_API_URL: 'http://directory.example',
        DATACENTER_ACTIVE_VALUE: '0',
        API_KEY: 'test-key',
      }),
    );

    await expect(service.list()).resolves.toEqual([
      { id: '31', code: 'BGB', location: 'BAGUMBONG', online: true },
      { id: '29', code: 'LPN', location: 'LASPINAS', online: true },
    ]);
    expect(get).toHaveBeenCalledWith(
      'http://directory.example/branch/list-datacenter',
      expect.objectContaining({ headers: { 'api-key': 'test-key' } }),
    );
  });
});
