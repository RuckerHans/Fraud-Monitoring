export interface Branch {
  id: string;
  code: string;
  location: string;
  online: boolean;
}

export interface AuthenticatedUser {
  id?: string;
  username: string;
  roles: string[];
  expiresAt: number;
}

export interface Transaction {
  branchId: string;
  branchCode: string;
  branchLocation: string;
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
  warnings: string[];
}

export interface ReportParams {
  branchIds: string[];
  branchLocations?: Record<string, string>;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  returned?: boolean;
  voided?: boolean;
  points?: 'earned' | 'redeemed' | 'any';
  exception?: 'returnedOrVoided' | 'returned' | 'voided' | 'all';
}
