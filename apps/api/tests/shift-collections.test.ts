import { describe, expect, it } from 'vitest';
import { additionalCustomerDebt, collectionDifferences } from '../src/lib/shift-collections.js';

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
