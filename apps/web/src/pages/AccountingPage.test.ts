import { describe, expect, it } from 'vitest';
import { accountBalanceLabel } from './AccountingPage';

describe('accounting balance labels', () => {
  it('shows an asset credit balance without a misleading negative amount', () => {
    expect(accountBalanceLabel({ type: 'ASSET', balance: -1100000 })).toEqual({ amount: '₹11,00,000', side: 'Credit balance' });
  });

  it('shows a liability in its normal credit position', () => {
    expect(accountBalanceLabel({ type: 'LIABILITY', balance: 1000000 })).toEqual({ amount: '₹10,00,000', side: 'Credit balance' });
  });
});
