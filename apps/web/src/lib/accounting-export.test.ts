import { describe, expect, it } from 'vitest';
import { buildAccountingJournalCsv, buildTallyLedgerMastersXml, buildTallyVouchersXml, summariseAccountingEntries, type AccountingEntry } from './accounting-export';

const entry = (overrides: Partial<AccountingEntry> = {}): AccountingEntry => ({
  id: 'line-1', journalId: 'journal-12345678', date: '2026-09-27T10:00:00.000Z', station: 'Saleema & Co', stationCode: 'SAL', reference: 'SALE-1', description: 'Fuel sale', sourceType: 'SHIFT_SALE', sourceId: 'shift-1', accountCode: '1000', accountName: 'Cash on Hand', accountType: 'ASSET', debit: 100, credit: 0, memo: null, createdBy: 'Owner', ...overrides,
});

const balanced = [
  entry(),
  entry({ id: 'line-2', accountCode: '4000', accountName: 'Product Revenue', accountType: 'REVENUE', debit: 0, credit: 100 }),
];

describe('accounting exports', () => {
  it('creates Tally ledger masters with stable groups and escaped company names', () => {
    const result = buildTallyLedgerMastersXml('Saleema & Sons', balanced);
    expect(result).toContain('<ID>All Masters</ID>');
    expect(result).toContain('<SVCURRENTCOMPANY>Saleema &amp; Sons</SVCURRENTCOMPANY>');
    expect(result).toContain('<PARENT>Cash-in-Hand</PARENT>');
    expect(result).toContain('<PARENT>Sales Accounts</PARENT>');
  });

  it('groups balanced lines into one dated Tally voucher with signed amounts', () => {
    const result = buildTallyVouchersXml('Saleema Petroleum', balanced);
    expect(result).toContain('<ID>Vouchers</ID>');
    expect(result).toContain('<DATE>20260927</DATE>');
    expect(result.match(/<VOUCHER /g)).toHaveLength(1);
    expect(result).toContain('<AMOUNT>100.00</AMOUNT>');
    expect(result).toContain('<AMOUNT>-100.00</AMOUNT>');
  });

  it('refuses to export an unbalanced journal', () => {
    expect(() => buildTallyVouchersXml('Saleema Petroleum', [entry()])).toThrow('is not balanced');
    expect(summariseAccountingEntries([entry()]).unbalancedJournals).toBe(1);
  });

  it('protects spreadsheet cells from formula execution', () => {
    const result = buildAccountingJournalCsv([entry({ description: '=HYPERLINK("bad")' })]);
    expect(result).toContain('"\'=HYPERLINK(""bad"")"');
  });
});
