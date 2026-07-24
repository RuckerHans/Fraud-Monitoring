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
  approver: string | null;
  reprint: string | null;
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

export interface ReceiptHeader {
  branchId: string;
  branchCode: string;
  branchLocation: string;
  transactionNo: string;
  customerCode: string | null;
  customerName: string | null;
  approver: string | null;
  reprint: string | null;
  subTotal: number;
  grandTotal: number;
  downPayments: number;
  discount: number;
  amountDiscounted: number;
  allowance: number;
  returnSubtotal: number;
  userId: string | null;
  terminalNo: string | null;
  shift: number | null;
  logDate: string;
  dateTime: string | null;
  branchCodeFromTransaction: string | null;
  voided: boolean;
  voidRemarks: string | null;
  seniorCitizenName: string | null;
  oscaId: string | null;
  pwdTag: boolean;
}

export interface ReceiptItem {
  lineId: number;
  productId: number | null;
  productCode: string | null;
  barcode: string | null;
  description: string | null;
  uom: string | null;
  qty: number;
  packing: number;
  totalQty: number;
  price: number;
  discount: number;
  amountDiscounted: number;
  discountedPrice: number;
  extended: number;
  returned: boolean;
  returnDescription: string | null;
  returnRemarks: string | null;
  voided: boolean;
  points: number;
  pointsPosted: boolean;
  priceModeCode: string | null;
  productDescription: string | null;
  posDescription: string | null;
  reportUom: string | null;
  posUom: string | null;
  srp: number;
}

export interface ReceiptPayment {
  tenderCode: string | null;
  description: string | null;
  amount: number;
  cash: boolean;
  change: boolean;
  chargeToAccount: boolean;
  accountNo: string | null;
  approvalNo: string | null;
  remarks: string | null;
  userId: string | null;
  terminalNo: string | null;
  voided: boolean;
  dateTime: string | null;
}

export interface TransactionReceipt {
  header: ReceiptHeader;
  items: ReceiptItem[];
  payments: ReceiptPayment[];
  totals: {
    itemCount: number;
    returnedItemCount: number;
    voidedItemCount: number;
    pointsEarned: number;
    pointsRedeemed: number;
    reprintCount: number;
    paymentTotal: number;
  };
}
