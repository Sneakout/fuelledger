import { describe, expect, it } from 'vitest';
import { ownerNotificationPacketSchema } from './index.js';

const validPacket = {
  schemaVersion: 1 as const,
  subjectName: 'Arun Transport',
  recordType: 'CUSTOMER_RECEIVABLE',
  product: { name: 'High Speed Diesel', code: 'HSD' },
  eventDate: '2026-09-01T05:30:00.000Z',
  dueDate: '2026-09-05T05:30:00.000Z',
  amount: { value: 35_720, currency: 'INR' as const },
  quantity: { value: 380, unit: 'L' },
  status: 'OVERDUE',
  daysOverdueOrWaiting: 4,
  station: { id: 'station-c', name: 'Station C' },
  evidence: [{ label: 'Open Arun Transport ledger', path: '/customers/arun', recordType: 'CUSTOMER_LEDGER', recordId: 'customer-arun' }],
  availableActions: ['ACKNOWLEDGE', 'VIEW_RECORD', 'GIVE_DETAILS'] as const,
  responsibleAgent: { key: 'receivables-watch', name: 'Credit Agent', responsibility: 'Customer balances, ageing and payment follow-up' },
};

describe('owner notification packet', () => {
  it('accepts specific, evidence-backed business facts', () => {
    expect(ownerNotificationPacketSchema.parse(validPacket).subjectName).toBe('Arun Transport');
  });

  it('rejects malformed or external evidence links', () => {
    expect(ownerNotificationPacketSchema.safeParse({ ...validPacket, evidence: [{ ...validPacket.evidence[0], path: 'https://attacker.example/record' }] }).success).toBe(false);
  });

  it('allows approval only for an exact approval-request record', () => {
    expect(ownerNotificationPacketSchema.safeParse({ ...validPacket, availableActions: ['APPROVE'] }).success).toBe(false);
    expect(ownerNotificationPacketSchema.safeParse({ ...validPacket, recordType: 'INVENTORY_ADJUSTMENT_REQUEST', availableActions: ['APPROVE'] }).success).toBe(true);
  });

  it('requires two verified records before comparison', () => {
    expect(ownerNotificationPacketSchema.safeParse({ ...validPacket, availableActions: ['VIEW_RECORD', 'COMPARE_RECORDS'] }).success).toBe(false);
    expect(ownerNotificationPacketSchema.safeParse({ ...validPacket, evidence: [...validPacket.evidence, { label: 'Open the related sale', path: '/sales/sale-1', recordType: 'SALE', recordId: 'sale-1' }], availableActions: ['VIEW_RECORD', 'COMPARE_RECORDS'] }).success).toBe(true);
  });

  it('requires draft preparation before proposal submission', () => {
    expect(ownerNotificationPacketSchema.safeParse({ ...validPacket, availableActions: ['SUBMIT_PROPOSAL'] }).success).toBe(false);
    expect(ownerNotificationPacketSchema.safeParse({ ...validPacket, availableActions: ['PREPARE_DRAFT', 'SUBMIT_PROPOSAL'] }).success).toBe(true);
  });
});
