import * as ExcelJS from 'exceljs';
import { ExcelExportService } from '../src/reports/excel-export.service';

describe('ExcelExportService', () => {
  it('creates a real XLSX and neutralizes spreadsheet formulas', async () => {
    const buffer = await new ExcelExportService().build([
      {
        branchId: '31',
        branchCode: 'BGB',
        branchLocation: 'BAGUMBONG',
        transactionNo: '=1+1',
        customerCode: 'C1',
        customerName: 'Customer',
        amount: 123.45,
        logDate: '2026-01-02T10:00:00',
        userId: 'cashier',
        terminalNo: '1',
        returned: true,
        voided: false,
        voidRemarks: null,
        pointsEarned: 5,
        pointsRedeemed: 0,
      },
    ]);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.getWorksheet('Transactions');
    expect(sheet?.getCell('D2').value).toBe("'=1+1");
    expect(sheet?.autoFilter).toBe('A1:O1');
  });
});
