import { describe, expect, it } from 'vitest';
import {
  buildApprovalScenario, buildCustomerScenario, buildMissingRecordScenario, buildProfitScenario,
  buildPurchaseScenario, buildSecurityScenario, buildShiftScenario, buildStockScenario, buildSupplierScenario,
} from '../src/modules/notifications/scenario-builders.js';

const station = { id: 'station-c', name: 'Station C' };
const product = { name: 'High Speed Diesel', code: 'HSD' };
const evidence = [{ label: 'Open the source record', path: '/inventory', recordType: 'RECORD', recordId: 'record-1' }];
const now = new Date('2026-09-09T12:00:00.000Z');

describe('deterministic notification scenario builders', () => {
  it('builds a specific shift fact packet', () => {
    const result = buildShiftScenario({ station, evidence, now, shiftId: 'shift-4', shiftNumber: 4, eventAt: new Date('2026-09-07T12:00:00.000Z'), state: 'AWAITING_RECONCILIATION' });
    expect(result.sentence).toContain('Shift 4 at Station C closed on 7 September 2026');
    expect(result.facts.status).toBe('AWAITING_RECONCILIATION');
  });

  it('builds stock wording only from supplied values', () => {
    const result = buildStockScenario({ station, evidence, product, tankId: 'tank-1', tankCode: '1', measuredAt: now, availableQuantity: 0, state: 'EMPTY' });
    expect(result.sentence).toBe('HSD tank 1 at Station C had no available recorded stock at 9 September 2026.');
    expect(result.facts.quantity).toEqual({ value: 0, unit: 'L' });
  });

  it('names the customer, product, event, due date and amount', () => {
    const result = buildCustomerScenario({ station, evidence, now, customerId: 'customer-1', customerName: 'Customer X', suppliedAt: new Date('2026-09-01T06:00:00.000Z'), dueAt: new Date('2026-09-05T06:00:00.000Z'), outstandingAmount: 35_720, product, suppliedQuantity: 380 });
    expect(result.sentence).toBe('Customer X took 380 L of HSD on 1 September 2026. ₹35,720 was due on 5 September 2026 and is still unpaid.');
    expect(result.facts.daysOverdueOrWaiting).toBe(4);
  });

  it('builds a human supplier load sentence', () => {
    const result = buildSupplierScenario({ station, evidence, now, supplierId: 'supplier-1', supplierName: 'IndianOil', receivedAt: new Date('2026-09-02T06:00:00.000Z'), dueAt: new Date('2026-09-05T06:00:00.000Z'), outstandingAmount: 299_000, product, receivedQuantity: 8_000, invoiceNumber: 'IO-42' });
    expect(result.sentence).toContain("IndianOil's 8,000 L HSD load was unloaded at Station C on 2 September 2026 on invoice IO-42.");
    expect(result.sentence).toContain('₹2,99,000 was due on 5 September 2026 and remains unpaid.');
  });

  it('uses a supplied verified purchase detail without inventing a cause', () => {
    const result = buildPurchaseScenario({ station, evidence, supplierName: 'IndianOil', invoiceNumber: 'IO-42', invoiceDate: now, amount: 100_000, finding: 'RATE_CHANGED', verifiedDetail: 'The recorded HSD rate is ₹2 higher per litre than the previous accepted invoice.' });
    expect(result.sentence).toContain('The recorded HSD rate is ₹2 higher');
    expect(result.facts.status).toBe('RATE_CHANGED');
  });

  it('does not calculate profit changes', () => {
    const result = buildProfitScenario({ station, evidence, periodLabel: '1–7 September 2026', calculatedAt: now, netResult: 29_826, verifiedChange: -2_000, verifiedContributor: 'FuelNerve reports that expenses contributed most to the change.' });
    expect(result.sentence).toContain('₹29,826');
    expect(result.sentence).toContain('₹2,000 lower');
  });

  it('builds missing-record, approval and security scenarios', () => {
    const missing = buildMissingRecordScenario({ station, evidence, now, subjectName: 'HSD tank 1', recordType: 'DENSITY_READING', expectedAt: now, product, missingDescription: 'The morning density reading' });
    expect(missing.sentence).toContain('has not been recorded');
    const approval = buildApprovalScenario({ station, evidence, now, approvalId: 'approval-1', requesterName: 'Demo Manager', requestedAt: now, subjectName: 'HSD tank 1', product, quantityDelta: -20, exactAction: 'an inventory adjustment' });
    expect(approval.sentence).toContain('Nothing changes unless you approve this exact request.');
    expect(approval.facts.availableActions).toContain('APPROVE');
    const security = buildSecurityScenario({ station, evidence, subjectName: 'A denied station access attempt', eventAt: now, event: 'ACCESS_DENIED', verifiedDetail: 'No Station C records were returned.' });
    expect(security.sentence).toContain('No Station C records were returned.');
  });

  it('fails closed when evidence is not an allowed FuelNerve path', () => {
    expect(() => buildSecurityScenario({ station, evidence: [{ ...evidence[0]!, path: 'https://attacker.example' }], subjectName: 'Sign-in', eventAt: now, event: 'NEW_SIGN_IN', verifiedDetail: 'The session was accepted.' })).toThrow();
  });
});
