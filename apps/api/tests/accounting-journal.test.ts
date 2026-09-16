import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { postJournal } from '../src/modules/accounting/service.js';

const transaction = () => ({
  chartAccount: {
    upsert: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([
      { id: 'inventory', code: '1200' },
      { id: 'tax', code: '1210' },
      { id: 'payable', code: '2000' },
    ]),
  },
  journal: { create: vi.fn().mockImplementation(({ data }) => data) },
});

const baseJournal = {
  organizationId: 'organization',
  reference: 'PI-20274247B025710',
  description: 'Purchase invoice from Indian Oil Corporation Limited',
  sourceType: 'PURCHASE_INVOICE',
  sourceId: 'invoice',
};

describe('journal currency normalization', () => {
  it('posts a balanced fuel invoice after KL-to-litre conversion introduces sub-paise fractions', async () => {
    const tx = transaction();
    const quantity = 12 * 1_000;
    const unitCost = 79_341.27 / 1_000;
    const subtotal = quantity * unitCost;
    const tax = 254_983.76;
    const total = subtotal + tax;

    await postJournal(tx as never, {
      ...baseJournal,
      lines: [
        { account: '1200', debit: subtotal },
        { account: '1210', debit: tax },
        { account: '2000', credit: total },
      ],
    });

    const createdLines = tx.journal.create.mock.calls[0][0].data.lines.create;
    expect(createdLines.map((line: { debit: Prisma.Decimal; credit: Prisma.Decimal }) => ({
      debit: line.debit.toFixed(2),
      credit: line.credit.toFixed(2),
    }))).toEqual([
      { debit: '952095.24', credit: '0.00' },
      { debit: '254983.76', credit: '0.00' },
      { debit: '0.00', credit: '1207079.00' },
    ]);
  });

  it('still rejects a genuine one-paise imbalance', async () => {
    const tx = transaction();

    await expect(postJournal(tx as never, {
      ...baseJournal,
      lines: [
        { account: '1200', debit: 100 },
        { account: '2000', credit: 99.99 },
      ],
    })).rejects.toMatchObject({ code: 'JOURNAL_UNBALANCED' });
    expect(tx.journal.create).not.toHaveBeenCalled();
  });
});
