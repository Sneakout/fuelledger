import type { ReportsBootstrap } from './api';

export type AccountingEntry = ReportsBootstrap['operations']['accountingEntries'][number];

const groupByCode: Record<string, string> = {
  '1000': 'Cash-in-Hand',
  '1010': 'Bank Accounts',
  '1020': 'Bank Accounts',
  '1030': 'Current Assets',
  '1100': 'Sundry Debtors',
  '1200': 'Stock-in-Hand',
  '1210': 'Duties & Taxes',
  '1220': 'Current Assets',
  '2000': 'Sundry Creditors',
  '4000': 'Sales Accounts',
  '4010': 'Sales Accounts',
  '5000': 'Direct Expenses',
  '5100': 'Direct Expenses',
  '6100': 'Indirect Expenses',
};

const clean = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const xml = (value: string) => clean(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const ledgerName = (entry: Pick<AccountingEntry, 'accountCode' | 'accountName'>) => `FuelNerve · ${entry.accountCode} · ${entry.accountName}`;
const amount = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const tallyDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`Invalid accounting date: ${value}`);
  return `${match[1]}${match[2]}${match[3]}`;
};
const safeCsv = (value: string | number) => {
  const raw = String(value);
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
};

export type AccountingExportSummary = {
  journals: number;
  lines: number;
  debit: number;
  credit: number;
  accounts: number;
  unbalancedJournals: number;
};

export function summariseAccountingEntries(entries: AccountingEntry[]): AccountingExportSummary {
  const journals = new Map<string, AccountingEntry[]>();
  for (const entry of entries) journals.set(entry.journalId, [...(journals.get(entry.journalId) ?? []), entry]);
  return {
    journals: journals.size,
    lines: entries.length,
    debit: entries.reduce((total, entry) => total + entry.debit, 0),
    credit: entries.reduce((total, entry) => total + entry.credit, 0),
    accounts: new Set(entries.map(entry => entry.accountCode)).size,
    unbalancedJournals: [...journals.values()].filter(lines => Math.abs(lines.reduce((total, line) => total + line.debit - line.credit, 0)) > 0.009).length,
  };
}

function envelope(companyName: string, id: 'All Masters' | 'Vouchers', messages: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n <HEADER><VERSION>1</VERSION><TALLYREQUEST>Import</TALLYREQUEST><TYPE>Data</TYPE><ID>${id}</ID></HEADER>\n <BODY>\n  <DESC><STATICVARIABLES><SVCURRENTCOMPANY>${xml(companyName)}</SVCURRENTCOMPANY><IMPORTDUPS>@@DUPCOMBINE</IMPORTDUPS></STATICVARIABLES></DESC>\n  <DATA>\n${messages}\n  </DATA>\n </BODY>\n</ENVELOPE>\n`;
}

export function buildTallyLedgerMastersXml(companyName: string, entries: AccountingEntry[]) {
  const accounts = [...new Map(entries.map(entry => [entry.accountCode, entry])).values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const messages = accounts.map(entry => `   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <LEDGER NAME="${xml(ledgerName(entry))}" ACTION="Create">\n     <NAME>${xml(ledgerName(entry))}</NAME><PARENT>${xml(groupByCode[entry.accountCode] ?? fallbackGroup(entry.accountType))}</PARENT><ISBILLWISEON>No</ISBILLWISEON><AFFECTSSTOCK>No</AFFECTSSTOCK>\n    </LEDGER>\n   </TALLYMESSAGE>`).join('\n');
  return envelope(companyName, 'All Masters', messages);
}

function fallbackGroup(type: string) {
  if (type === 'ASSET') return 'Current Assets';
  if (type === 'LIABILITY') return 'Current Liabilities';
  if (type === 'REVENUE') return 'Sales Accounts';
  return 'Indirect Expenses';
}

export function buildTallyVouchersXml(companyName: string, entries: AccountingEntry[]) {
  const journals = new Map<string, AccountingEntry[]>();
  for (const entry of entries) journals.set(entry.journalId, [...(journals.get(entry.journalId) ?? []), entry]);
  const ordered = [...journals.entries()].sort(([, a], [, b]) => a[0]!.date.localeCompare(b[0]!.date) || a[0]!.reference.localeCompare(b[0]!.reference));
  for (const [journalId, lines] of ordered) {
    const debit = lines.reduce((total, line) => total + line.debit, 0);
    const credit = lines.reduce((total, line) => total + line.credit, 0);
    if (Math.abs(debit - credit) > 0.009) throw new Error(`Journal ${journalId} is not balanced and was not exported.`);
  }
  const messages = ordered.map(([journalId, lines]) => {
    const first = lines[0]!;
    const number = `FN-${first.reference}-${journalId.slice(-8)}`;
    const narration = [first.description, first.station && `Station: ${first.station}`, `FuelNerve source: ${first.sourceType} ${first.sourceId}`].filter(Boolean).join(' · ');
    const ledgerLines = lines.map(line => {
      const isCredit = line.credit > 0;
      const signedAmount = isCredit ? -line.credit : line.debit;
      return `     <ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ledgerName(line))}</LEDGERNAME><ISDEEMEDPOSITIVE>${isCredit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amount(signedAmount)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    }).join('\n');
    return `   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>${tallyDate(first.date)}</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(number)}</VOUCHERNUMBER><REFERENCE>${xml(first.reference)}</REFERENCE><GUID>${xml(`FuelNerve-${journalId}`)}</GUID><REMOTEID>${xml(`FuelNerve-${journalId}`)}</REMOTEID><NARRATION>${xml(narration)}</NARRATION>\n${ledgerLines}\n    </VOUCHER>\n   </TALLYMESSAGE>`;
  }).join('\n');
  return envelope(companyName, 'Vouchers', messages);
}

export function buildAccountingJournalCsv(entries: AccountingEntry[]) {
  const headings = ['Date', 'Voucher number', 'Reference', 'Station', 'Source type', 'Source ID', 'Account code', 'Account name', 'Debit', 'Credit', 'Description', 'Memo', 'Created by'];
  const rows = entries.map(entry => [entry.date.slice(0, 10), `FN-${entry.reference}-${entry.journalId.slice(-8)}`, entry.reference, entry.station, entry.sourceType, entry.sourceId, entry.accountCode, entry.accountName, amount(entry.debit), amount(entry.credit), entry.description, entry.memo ?? '', entry.createdBy]);
  return '\ufeff' + [headings, ...rows].map(row => row.map(safeCsv).join(',')).join('\n');
}
