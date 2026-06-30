export interface FraudReportRow {
  transactionNo: string;
  customerCode: string | null;
  customerName: string | null;
  amount: number;
  logDate: Date | string;
  userId: string | null;
  terminalNo: string | null;
  returned: boolean;
  voided: boolean;
  voidRemarks: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
}

export interface PagedReport {
  data: FraudReportRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  assumptions: string[];
}
