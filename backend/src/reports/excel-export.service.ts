import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { FraudReportRow } from './report.types';

@Injectable()
export class ExcelExportService {
  async build(rows: FraudReportRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Fraud Monitoring';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Transactions', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.autoFilter = 'A1:L1';
    sheet.columns = [
      { header: 'Transaction No.', key: 'transactionNo', width: 20 },
      { header: 'Customer Code', key: 'customerCode', width: 18 },
      { header: 'Customer Name', key: 'customerName', width: 28 },
      { header: 'Amount', key: 'amount', width: 15, style: { numFmt: '#,##0.00' } },
      { header: 'Log Date', key: 'logDate', width: 22, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
      { header: 'Cashier', key: 'userId', width: 16 },
      { header: 'Terminal', key: 'terminalNo', width: 14 },
      { header: 'Returned', key: 'returned', width: 12 },
      { header: 'Voided', key: 'voided', width: 12 },
      { header: 'Void Remarks', key: 'voidRemarks', width: 35 },
      { header: 'Points Earned', key: 'pointsEarned', width: 16 },
      { header: 'Points Redeemed', key: 'pointsRedeemed', width: 18 },
    ];
    for (const row of rows) {
      sheet.addRow({
        ...row,
        transactionNo: this.safeText(row.transactionNo),
        customerCode: this.safeText(row.customerCode),
        customerName: this.safeText(row.customerName),
        voidRemarks: this.safeText(row.voidRemarks),
        logDate: new Date(row.logDate),
        returned: row.returned ? 'Yes' : 'No',
        voided: row.voided ? 'Yes' : 'No',
      });
    }
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF172554' },
    };
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private safeText(value: string | null): string {
    if (!value) return '';
    return /^[=+\-@]/.test(value) ? `'${value}` : value;
  }
}
