import { PrismaClient } from '@prisma/client';
try { process.loadEnvFile('.env'); } catch { /* Explicit DATABASE_URL also works. */ }
const db = new PrismaClient();
try {
  const report = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '20000ms'");
    const negativeStock = await tx.$queryRawUnsafe(`
      SELECT l.station_id, l.product_id, l.tank_id,
        SUM(l.quantity_delta) + COALESCE(MAX(t.opening_stock),0) AS quantity
      FROM inventory_ledger l LEFT JOIN tanks t ON t.id=l.tank_id
      WHERE l.occurred_at <= CURRENT_TIMESTAMP
      GROUP BY l.station_id,l.product_id,l.tank_id
      HAVING SUM(l.quantity_delta) + COALESCE(MAX(t.opening_stock),0) < -0.001`);
    const unbalancedJournals = await tx.$queryRawUnsafe(`
      SELECT j.id, j.station_id, SUM(l.debit)-SUM(l.credit) AS difference
      FROM journals j JOIN journal_lines l ON l.journal_id=j.id
      GROUP BY j.id,j.station_id HAVING ABS(SUM(l.debit)-SUM(l.credit)) > 0.01`);
    const invoicePaymentIssues = await tx.$queryRawUnsafe(`
      SELECT i.id, i.station_id, i.status, i.total_amount,
        COALESCE(SUM(p.amount),0) AS paid
      FROM purchase_invoices i LEFT JOIN supplier_payments p ON p.invoice_id=i.id
      WHERE i.status <> 'VOID'
      GROUP BY i.id,i.station_id,i.status,i.total_amount
      HAVING COALESCE(SUM(p.amount),0)>i.total_amount+0.01
        OR (i.status='PAID' AND ABS(i.total_amount-COALESCE(SUM(p.amount),0))>0.01)`);
    const accountChecks = await tx.$queryRawUnsafe(`
      WITH gl AS (
        SELECT j.organization_id,j.station_id,a.code,SUM(l.debit-l.credit) AS balance
        FROM journal_lines l JOIN journals j ON j.id=l.journal_id
        JOIN chart_accounts a ON a.id=l.account_id
        WHERE a.code IN ('1100','2000') GROUP BY j.organization_id,j.station_id,a.code
      ), ar AS (
        SELECT organization_id,station_id,SUM(amount) AS balance FROM customer_ledger GROUP BY organization_id,station_id
      ), ap AS (
        SELECT organization_id,station_id,SUM(amount) AS balance FROM (
          SELECT organization_id,station_id,total_amount AS amount FROM purchase_invoices WHERE status<>'VOID'
          UNION ALL SELECT organization_id,station_id,-amount FROM supplier_payments
        ) x GROUP BY organization_id,station_id
      ), sub AS (
        SELECT *, '1100' AS code FROM ar UNION ALL SELECT *, '2000' AS code FROM ap
      ) SELECT COALESCE(gl.organization_id,sub.organization_id) AS organization_id,
        COALESCE(gl.station_id,sub.station_id) AS station_id,COALESCE(gl.code,sub.code) AS account,
        COALESCE(sub.balance,0) AS register_balance,
        COALESCE(gl.balance,0)*CASE WHEN COALESCE(gl.code,sub.code)='2000' THEN -1 ELSE 1 END AS accounting_balance
      FROM gl FULL JOIN sub ON gl.organization_id=sub.organization_id AND gl.station_id IS NOT DISTINCT FROM sub.station_id AND gl.code=sub.code`);
    return { generatedAt: new Date().toISOString(), mode: 'READ ONLY', negativeStock, unbalancedJournals, invoicePaymentIssues, accountChecks,
      releaseBlockers: ['Moving weighted-average costing and verified opening-stock values are not implemented.'],
      limitations: ['Account differences require review, not automatic repair. Standalone goods receipts may explain accounts-payable differences.', 'This report does not establish historical inventory value or prove all workflows. No records were modified.'] };
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
  console.log(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
} finally { await db.$disconnect(); }
