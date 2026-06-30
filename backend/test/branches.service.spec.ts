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

  it('bypasses the directory and permits only the configured direct branch', async () => {
    const get = jest.fn();
    const service = new BranchesService(
      { get } as unknown as HttpService,
      new ConfigService({
        DIRECT_BRANCH_MODE: 'true',
        DIRECT_BRANCH_ID: '31',
        DIRECT_BRANCH_CODE: 'BGB',
        DIRECT_BRANCH_LOCATION: 'BAGUMBONG',
        DIRECT_BRANCH_HOST: '192.168.5.36',
        DIRECT_BRANCH_PORT: 1433,
        DIRECT_BRANCH_DATABASE: 'srsbag',
        DIRECT_BRANCH_USERNAME: 'reader',
        DIRECT_BRANCH_PASSWORD: 'secret',
        DATACENTER_ACTIVE_VALUE: '0',
      }),
    );

    await expect(service.list()).resolves.toEqual([
      { id: '31', code: 'BGB', location: 'BAGUMBONG', online: true },
    ]);
    await expect(service.resolveForConnection('31')).resolves.toMatchObject({
      branchservername: '192.168.5.36',
      branchserverdatabasename: 'srsbag',
    });
    expect(get).not.toHaveBeenCalled();
  });
});
