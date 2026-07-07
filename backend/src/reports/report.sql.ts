export const REPORT_CTE = `
WITH SaleSummary AS (
  SELECT
    fs.TransactionNo,
    MAX(CASE WHEN fs.[Return] = 1 THEN 1 ELSE 0 END) AS Returned,
    MAX(CASE WHEN fs.Voided = 1 THEN 1 ELSE 0 END) AS SaleVoided,
    SUM(CASE WHEN fs.PointsPosted = 1 AND ISNULL(fs.Points, 0) > 0
      THEN fs.Points ELSE 0 END) AS PointsEarned,
    SUM(CASE WHEN fs.PointsPosted = 1 AND ISNULL(fs.Points, 0) < 0
      THEN ABS(fs.Points) ELSE 0 END) AS PointsRedeemed
  FROM dbo.FinishedSales fs
  WHERE fs.LogDate >= @0 AND fs.LogDate < DATEADD(day, 1, @1)
  GROUP BY fs.TransactionNo
),
Filtered AS (
  SELECT
    ft.TransactionNo AS transactionNo,
    ft.CustomerCode AS customerCode,
    COALESCE(NULLIF(ft.Description, ''), ft.CustomerCode) AS customerName,
    ft.GrandTotal AS amount,
    ft.DateTime AS logDate,
    ft.UserID AS userId,
    ft.TerminalNo AS terminalNo,
    CAST(ISNULL(ss.Returned, 0) AS bit) AS returned,
    CAST(CASE WHEN ft.Voided = 1 OR ISNULL(ss.SaleVoided, 0) = 1 THEN 1 ELSE 0 END AS bit) AS voided,
    ft.VoidRemarks AS voidRemarks,
    ISNULL(ss.PointsEarned, 0) AS pointsEarned,
    ISNULL(ss.PointsRedeemed, 0) AS pointsRedeemed
  FROM dbo.FinishedTransaction ft
  LEFT JOIN SaleSummary ss ON ss.TransactionNo = ft.TransactionNo
  WHERE ft.LogDate >= @0 AND ft.LogDate < DATEADD(day, 1, @1)
    AND (@2 IS NULL OR ISNULL(ss.Returned, 0) = @2)
    AND (@3 IS NULL OR CASE WHEN ft.Voided = 1 OR ISNULL(ss.SaleVoided, 0) = 1 THEN 1 ELSE 0 END = @3)
    AND (
      @4 IS NULL OR @4 = 'any'
      OR (@4 = 'earned' AND ISNULL(ss.PointsEarned, 0) > 0)
      OR (@4 = 'redeemed' AND ISNULL(ss.PointsRedeemed, 0) > 0)
    )
    AND (
      @5 IS NULL OR @5 = 'all'
      OR (@5 = 'returnedOrVoided' AND (
        ISNULL(ss.Returned, 0) = 1
        OR ft.Voided = 1
        OR ISNULL(ss.SaleVoided, 0) = 1
      ))
      OR (@5 = 'returned' AND ISNULL(ss.Returned, 0) = 1)
      OR (@5 = 'voided' AND (
        ft.Voided = 1
        OR ISNULL(ss.SaleVoided, 0) = 1
      ))
    )
)`;

export const REPORT_PAGE_SQL = `${REPORT_CTE}
, Numbered AS (
  SELECT
    transactionNo,
    customerCode,
    customerName,
    amount,
    logDate,
    userId,
    terminalNo,
    returned,
    voided,
    voidRemarks,
    pointsEarned,
    pointsRedeemed,
    ROW_NUMBER() OVER (ORDER BY logDate DESC, transactionNo DESC) AS rowNumber
  FROM Filtered
)
SELECT
  transactionNo,
  customerCode,
  customerName,
  amount,
  logDate,
  userId,
  terminalNo,
  returned,
  voided,
  voidRemarks,
  pointsEarned,
  pointsRedeemed
FROM Numbered
WHERE rowNumber > @6
  AND rowNumber <= (@6 + @7)
ORDER BY rowNumber;`;

export const REPORT_COUNT_SQL = `${REPORT_CTE}
SELECT COUNT_BIG(1) AS total FROM Filtered;`;

export const REPORT_EXPORT_SQL = `${REPORT_CTE}
SELECT TOP (50000) *
FROM Filtered
ORDER BY logDate DESC, transactionNo DESC;`;

export const RECEIPT_HEADER_SQL = `
SELECT TOP (1)
  ft.TransactionNo AS transactionNo,
  ft.CustomerCode AS customerCode,
  COALESCE(NULLIF(ft.Description, ''), ft.CustomerCode) AS customerName,
  ft.SubTotal AS subTotal,
  ft.GrandTotal AS grandTotal,
  ft.DownPayments AS downPayments,
  ft.Discount AS discount,
  ft.AmountDiscounted AS amountDiscounted,
  ft.Allowance AS allowance,
  ft.ReturnSubtotal AS returnSubtotal,
  ft.UserID AS userId,
  ft.TerminalNo AS terminalNo,
  ft.Shift AS shift,
  ft.LogDate AS logDate,
  ft.DateTime AS dateTime,
  ft.BranchCode AS branchCodeFromTransaction,
  ft.Voided AS voided,
  ft.VoidRemarks AS voidRemarks,
  ft.seniorcitizenname AS seniorCitizenName,
  ft.OSCAID AS oscaId,
  ft.PWDTag AS pwdTag
FROM dbo.FinishedTransaction ft
WHERE ft.TransactionNo = @0
  AND (@1 IS NULL OR ft.TerminalNo = @1)
ORDER BY ft.DateTime DESC, ft.LogDate DESC;`;

export const RECEIPT_ITEMS_SQL = `
SELECT
  fs.LineID AS lineId,
  fs.ProductID AS productId,
  fs.ProductCode AS productCode,
  fs.Barcode AS barcode,
  COALESCE(NULLIF(fs.Description, ''), NULLIF(p.Description, ''), NULLIF(pos.Description, '')) AS description,
  fs.UOM AS uom,
  fs.Qty AS qty,
  fs.Packing AS packing,
  fs.TotalQty AS totalQty,
  fs.Price AS price,
  fs.Discount AS discount,
  fs.AmountDiscounted AS amountDiscounted,
  fs.DiscountedPrice AS discountedPrice,
  fs.Extended AS extended,
  fs.[Return] AS returned,
  fs.ReturnDescription AS returnDescription,
  fs.ReturnRemarks AS returnRemarks,
  fs.Voided AS voided,
  fs.Points AS points,
  fs.PointsPosted AS pointsPosted,
  fs.PriceModeCode AS priceModeCode,
  p.Description AS productDescription,
  pos.Description AS posDescription,
  p.reportuom AS reportUom,
  pos.uom AS posUom,
  pos.srp AS srp
FROM dbo.FinishedSales fs
LEFT JOIN dbo.Products p ON p.ProductID = fs.ProductID
LEFT JOIN dbo.POS_Products pos
  ON pos.Barcode = fs.Barcode
  AND pos.PriceModeCode = fs.PriceModeCode
WHERE fs.TransactionNo = @0
  AND (@1 IS NULL OR fs.TerminalNo = @1)
ORDER BY fs.LineID ASC;`;

export const RECEIPT_PAYMENTS_SQL = `
SELECT
  fp.TenderCode AS tenderCode,
  fp.Description AS description,
  fp.Amount AS amount,
  fp.Cash AS cash,
  fp.Change AS change,
  fp.ChargeToAccount AS chargeToAccount,
  fp.AccountNo AS accountNo,
  fp.ApprovalNo AS approvalNo,
  fp.Remarks AS remarks,
  fp.UserID AS userId,
  fp.TerminalNo AS terminalNo,
  fp.Voided AS voided,
  fp.DateTime AS dateTime
FROM dbo.FinishedPayments fp
WHERE fp.TransactionNo = @0
  AND (@1 IS NULL OR fp.TerminalNo = @1)
ORDER BY fp.DateTime ASC, fp.TenderCode ASC;`;
