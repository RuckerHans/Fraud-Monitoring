import { REPORT_COUNT_SQL, REPORT_EXPORT_SQL, REPORT_PAGE_SQL } from '../src/reports/report.sql';

describe('fraud report SQL', () => {
  it('uses bound parameters and an indexed date range before bit filters', () => {
    expect(REPORT_PAGE_SQL).toContain('fs.LogDate >= @0');
    expect(REPORT_PAGE_SQL).toContain('ft.LogDate >= @0');
    expect(REPORT_PAGE_SQL).toContain('ROW_NUMBER() OVER');
    expect(REPORT_PAGE_SQL).toContain('rowNumber <= (@5 + @6)');
    expect(REPORT_PAGE_SQL).not.toContain('OFFSET');
    expect(REPORT_COUNT_SQL).toContain('COUNT_BIG(1)');
    expect(REPORT_PAGE_SQL).not.toContain('${');
  });

  it('bounds exports', () => {
    expect(REPORT_EXPORT_SQL).toContain('TOP (50000)');
  });

  it('documents the provisional signed-points derivation in executable SQL', () => {
    expect(REPORT_PAGE_SQL).toContain('ISNULL(fs.Points, 0) > 0');
    expect(REPORT_PAGE_SQL).toContain('ISNULL(fs.Points, 0) < 0');
  });
});
