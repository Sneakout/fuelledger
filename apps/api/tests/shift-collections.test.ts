import { describe, expect, it } from 'vitest';
import { additionalCustomerDebt, collectionDifferences, closingCollectionFacts } from '../src/lib/shift-collections.js';

describe('shift customer reconciliation', () => {
  it('posts only new credit, never a previously recorded sale twice', () => {
    const previous = [{ customerId: 'c', paymentMethod: 'CREDIT', amount: 100 }];
    expect(additionalCustomerDebt([{ ...previous[0]!, amount: 150 }], previous)).toEqual([50]);
    expect(additionalCustomerDebt(previous, previous)).toEqual([0]);
  });
  it('handles repeated allocation rows without duplicating existing debt', () => {
    expect(additionalCustomerDebt([{ customerId: 'c', paymentMethod: 'FLEET', amount: 60 }, { customerId: 'c', paymentMethod: 'FLEET', amount: 60 }], [{customerId: 'c', paymentMethod: 'FLEET', amount: 100}])).toEqual([0, 20]);
  });
  it('does not create debt for fleet purchases paid by cash, UPI or card', () => {
    expect(additionalCustomerDebt(['CASH', 'UPI', 'CARD'].map(paymentMethod => ({ customerId: 'fleet', paymentMethod, amount: 200 })), [])).toEqual([0, 0, 0]);
  });
  it('prevents reallocating an existing customer debt to someone else', () => {
    expect(() => additionalCustomerDebt([{customerId:'other',paymentMethod:'CREDIT',amount:100}], [{customerId:'c',paymentMethod:'CREDIT',amount:100}])).toThrow('same customers');
  });
  it('keeps offsetting shortages and excesses visible', () => {
    expect(collectionDifferences([{expectedAmount:100,adjustmentAmount:0,actualAmount:80},{expectedAmount:100,adjustmentAmount:0,actualAmount:120}])).toEqual({shortage:20,excess:20});
  });
});

it('keeps a mixed staff declaration separate from physical cash and payment allocations', () => {
  const facts = closingCollectionFacts({ openingCash: 500, closingCash: 2500,
    nozzleAssignments: [{ collectionAmount: 7000 }, { collectionAmount: 3000 }] });
  // Cash 2,000 + UPI 5,000 + card 3,000 can be declared as 10,000.
  // The till holds only 2,500 including the opening float.
  expect(facts).toEqual({ basis: 'MIXED_PAYMENTS', declaredStaffCollections: 10000,
    missingDeclarations: 0, physicalOpeningCash: 500, physicalClosingCash: 2500 });
  expect(facts).not.toHaveProperty('CASH');
});
it('distinguishes a missing handover or cash count from a recorded zero', () => {
  expect(closingCollectionFacts({ openingCash: 0, closingCash: null,
    nozzleAssignments: [{ collectionAmount: null }, { collectionAmount: 0 }] }))
    .toMatchObject({ declaredStaffCollections: 0, missingDeclarations: 1, physicalClosingCash: null });
});
