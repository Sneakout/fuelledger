import {
  buildApprovalScenario, buildCustomerScenario, buildMissingRecordScenario, buildProfitScenario,
  buildPurchaseScenario, buildShiftScenario, buildStockScenario, buildSupplierScenario,
  type DeterministicScenario,
} from '../../src/modules/notifications/scenario-builders.js';

const station = { id: 'sanitized-station-c', name: 'Station C' };
const hsd = { name: 'High Speed Diesel', code: 'HSD' };
const ms = { name: 'Motor Spirit', code: 'MS' };
const now = new Date('2026-09-10T12:00:00.000Z');
const record = (label: string, path: string, recordType: string, recordId: string) => ({ label, path, recordType, recordId });

export type LocalNotificationFixture = Readonly<{
  key: string;
  scenario: DeterministicScenario;
  expectedText: readonly string[];
}>;

export const localOwnerNotificationFixtures: readonly LocalNotificationFixture[] = [
  {
    key: 'overdue-customer-purchase',
    scenario: buildCustomerScenario({ station, now, customerId: 'customer-riverline', customerName: 'Riverline Logistics', product: hsd, suppliedQuantity: 380, suppliedAt: new Date('2026-09-01T06:00:00.000Z'), dueAt: new Date('2026-09-05T06:00:00.000Z'), outstandingAmount: 35_720, evidence: [record('Open Riverline Logistics ledger', '/customers/customer-riverline', 'CUSTOMER_LEDGER', 'customer-riverline'), record('Open the HSD credit sale', '/sales/sale-riverline-1', 'SALE', 'sale-riverline-1')] }),
    expectedText: ['Riverline Logistics', '380 L of HSD', '₹35,720', '5 September 2026', 'still unpaid'],
  },
  {
    key: 'overdue-supplier-delivery',
    scenario: buildSupplierScenario({ station, now, supplierId: 'supplier-national', supplierName: 'National Fuel Supply', product: hsd, receivedQuantity: 8_000, receivedAt: new Date('2026-09-02T06:00:00.000Z'), dueAt: new Date('2026-09-05T06:00:00.000Z'), outstandingAmount: 299_000, invoiceNumber: 'NFS-1042', evidence: [record('Open supplier invoice NFS-1042', '/purchases/invoice-nfs-1042', 'PURCHASE_INVOICE', 'invoice-nfs-1042'), record('Open the matched receipt', '/inventory/receipt-nfs-1042', 'PURCHASE_RECEIPT', 'receipt-nfs-1042')] }),
    expectedText: ['National Fuel Supply', '8,000 L HSD load', '2 September 2026', '₹2,99,000', 'remains unpaid'],
  },
  {
    key: 'empty-tank',
    scenario: buildStockScenario({ station, tankId: 'tank-ms-1', tankCode: '1', product: ms, measuredAt: now, availableQuantity: 0, state: 'EMPTY', evidence: [record('Open MS tank 1 stock timeline', '/inventory/tank-ms-1', 'TANK', 'tank-ms-1')] }),
    expectedText: ['MS tank 1', 'Station C', 'no available recorded stock'],
  },
  {
    key: 'low-stock-projection',
    scenario: buildStockScenario({ station, tankId: 'tank-hsd-2', tankCode: '2', product: hsd, measuredAt: now, availableQuantity: 1_250, state: 'LOW_STOCK', projectedRunoutAt: new Date('2026-09-12T12:00:00.000Z'), verifiedProjectionBasis: 'the last 7 completed days of metered HSD sales', evidence: [record('Open HSD tank 2 stock timeline', '/inventory/tank-hsd-2', 'TANK', 'tank-hsd-2'), record('Open recent HSD sales', '/sales/hsd-seven-days', 'SALES_SUMMARY', 'hsd-seven-days')] }),
    expectedText: ['1,250 L', 'run out by 12 September 2026', 'last 7 completed days'],
  },
  {
    key: 'physical-book-variance',
    scenario: buildStockScenario({ station, tankId: 'tank-hsd-1', tankCode: '1', product: hsd, measuredAt: now, availableQuantity: 7_820, physicalQuantity: 7_820, bookQuantity: 8_140, state: 'STOCK_VARIANCE', evidence: [record('Open HSD tank 1 reading', '/inventory/tank-hsd-1/readings/latest', 'TANK_READING', 'reading-hsd-1'), record('Open HSD tank 1 stock ledger', '/inventory/tank-hsd-1/timeline', 'STOCK_LEDGER', 'ledger-hsd-1')] }),
    expectedText: ['7,820 L physically', '8,140 L in the stock ledger'],
  },
  {
    key: 'missing-density',
    scenario: buildMissingRecordScenario({ station, now, subjectName: 'HSD tank 1', recordType: 'DENSITY_READING', product: hsd, expectedAt: new Date('2026-09-10T00:00:00.000Z'), missingDescription: 'The morning density reading', evidence: [record('Open HSD tank 1 readings', '/inventory/tank-hsd-1/readings', 'TANK', 'tank-hsd-1')] }),
    expectedText: ['morning density reading', 'HSD tank 1', 'has not been recorded'],
  },
  {
    key: 'open-shift',
    scenario: buildShiftScenario({ station, now, shiftId: 'shift-18', shiftNumber: 18, eventAt: new Date('2026-09-09T06:00:00.000Z'), state: 'OPEN', evidence: [record('Open Shift 18', '/operations/shifts/shift-18', 'SHIFT', 'shift-18')] }),
    expectedText: ['Shift 18', 'opened on 9 September 2026', 'still open'],
  },
  {
    key: 'reconciliation-difference',
    scenario: buildShiftScenario({ station, now, shiftId: 'shift-17', shiftNumber: 17, eventAt: new Date('2026-09-09T02:00:00.000Z'), state: 'COLLECTION_VARIANCE', collectionVariance: -2_480, evidence: [record('Open Shift 17 reconciliation', '/reconciliation/shift-17', 'SHIFT_RECONCILIATION', 'shift-17'), record('Open Shift 17 collections', '/operations/shifts/shift-17/collections', 'SHIFT_COLLECTION', 'collections-shift-17')] }),
    expectedText: ['Shift 17', 'verified collection difference', '₹2,480'],
  },
  {
    key: 'duplicate-invoice',
    scenario: buildPurchaseScenario({ station, supplierName: 'National Fuel Supply', invoiceNumber: 'NFS-1048', invoiceDate: new Date('2026-09-09T06:00:00.000Z'), amount: 486_000, finding: 'DUPLICATE_INVOICE', verifiedDetail: 'Another recorded invoice from this supplier has the same invoice number and amount.', evidence: [record('Open invoice NFS-1048', '/purchases/invoice-nfs-1048-a', 'PURCHASE_INVOICE', 'invoice-nfs-1048-a'), record('Open the matching invoice', '/purchases/invoice-nfs-1048-b', 'PURCHASE_INVOICE', 'invoice-nfs-1048-b')] }),
    expectedText: ['invoice NFS-1048', '₹4,86,000', 'same invoice number and amount'],
  },
  {
    key: 'material-expense-change',
    scenario: buildProfitScenario({ station, periodLabel: '1–9 September 2026', calculatedAt: now, netResult: 184_200, verifiedChange: -42_600, verifiedContributor: 'FuelNerve reports that generator repairs increased recorded expenses by ₹38,000.', evidence: [record('Open the profit report', '/reports/profit-sep-1-9', 'PROFIT_REPORT', 'profit-sep-1-9'), record('Open the generator repair expense', '/expenses/expense-generator-1', 'EXPENSE', 'expense-generator-1')] }),
    expectedText: ['net result of ₹1,84,200', '₹42,600 lower', 'generator repairs', '₹38,000'],
  },
  {
    key: 'pending-inventory-adjustment',
    scenario: buildApprovalScenario({ station, now, approvalId: 'approval-hsd-1', requesterName: 'Station Manager', requestedAt: new Date('2026-09-10T08:00:00.000Z'), subjectName: 'HSD tank 1', product: hsd, quantityDelta: -320, exactAction: 'an inventory adjustment for HSD tank 1', evidence: [record('Review the exact adjustment request', '/inventory/approvals/approval-hsd-1', 'APPROVAL_REQUEST', 'approval-hsd-1')] }),
    expectedText: ['Station Manager', '-320 L', 'Nothing changes unless you approve this exact request'],
  },
] as const;

export const localTransportFixtures = {
  crossStationDenial: { requestedStationId: 'sanitized-station-b', permittedStationIds: ['sanitized-station-c'], status: 403, code: 'STATION_ACCESS_DENIED' },
  offlineBackend: { error: 'notConnectedToInternet', mustUseSampleData: false, mayRetainLastSuccessfulResponse: true },
} as const;
