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
