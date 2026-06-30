import { ConfigService } from '@nestjs/config';
import { BranchConnectionFactory } from '../src/reports/branch-connection.factory';

describe('BranchConnectionFactory', () => {
  const factory = new BranchConnectionFactory(new ConfigService());
  const branch = {
    id: '31',
    branchcode: 'BGB',
    branchname: 'Test',
    branchservername: '10.0.0.1',
    branchserverdatabasename: 'pos',
    branchserverusername: 'reader',
    branchserverpassword: 'secret',
    isactive: 1,
    branchconnected: 1,
  };

  it('builds a non-synchronizing MSSQL source for only the selected branch', () => {
    const source = factory.create(branch);
    expect(source.options).toMatchObject({
      type: 'mssql',
      host: '10.0.0.1',
      port: 1433,
      database: 'pos',
      synchronize: false,
      logging: false,
    });
  });

  it('always destroys an initialized request connection', async () => {
    const source = {
      initialize: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
      isInitialized: true,
    };
    jest.spyOn(factory, 'create').mockReturnValue(source as any);
    await factory.withConnection(branch, async () => 'done');
    expect(source.destroy).toHaveBeenCalledTimes(1);
  });
});
