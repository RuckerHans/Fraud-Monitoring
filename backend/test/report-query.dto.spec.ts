import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportQueryDto } from '../src/reports/report-query.dto';

describe('ReportQueryDto', () => {
  it('rejects unknown boolean spellings before a branch connection is attempted', async () => {
    const dto = plainToInstance(ReportQueryDto, {
      branchIds: '29,31',
      from: '2026-01-01',
      to: '2026-01-02',
      returned: 'yes',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'returned')).toBe(true);
  });

  it('accepts explicit query-string booleans', async () => {
    const dto = plainToInstance(ReportQueryDto, {
      branchIds: '29,31',
      from: '2026-01-01',
      to: '2026-01-02',
      returned: 'false',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.returned).toBe(false);
    expect(dto.exception).toBe('returnedOrVoided');
  });
});
