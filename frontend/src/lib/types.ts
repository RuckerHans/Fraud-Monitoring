export interface Branch {
  id: string;
  code: string;
  name: string;
  online: boolean;
}

export interface Transaction {
  transactionNo: string;
  customerCode: string | null;
  customerName: string | null;
  amount: number;
  logDate: string;
  userId: string | null;
  terminalNo: string | null;
  returned: boolean;
  voided: boolean;
  voidRemarks: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
}

export interface ReportResponse {
  data: Transaction[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  assumptions: string[];
}

export interface ReportParams {
  branchId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  returned?: boolean;
  voided?: boolean;
  points?: 'earned' | 'redeemed' | 'any';
}
