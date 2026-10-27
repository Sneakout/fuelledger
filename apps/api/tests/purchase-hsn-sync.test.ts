import { describe, expect, it } from 'vitest';
import { normalizeHsnCode, planProductHsnUpdates } from '../src/modules/purchases/hsn-sync.js';

describe('purchase product HSN synchronization', () => {
  it('fills a missing product HSN from one trustworthy confirmed invoice code', () => {
    expect(planProductHsnUpdates(
      [{ productId: 'ms', hsnCode: '2710 1242' }],
      [{ id: 'ms', hsnCode: null }],
    )).toEqual([{ productId: 'ms', hsnCode: '27101242' }]);
  });

  it('never overwrites an existing product HSN', () => {
    expect(planProductHsnUpdates(
      [{ productId: 'hsd', hsnCode: '27101944' }],
      [{ id: 'hsd', hsnCode: '27101234' }],
    )).toEqual([]);
  });

  it('does not choose between conflicting OCR codes for the same product', () => {
    expect(planProductHsnUpdates(
      [{ productId: 'fuel', hsnCode: '27101242' }, { productId: 'fuel', hsnCode: '27101944' }],
      [{ id: 'fuel', hsnCode: '' }],
    )).toEqual([]);
  });

  it('accepts only four to eight digit HSN codes for the product master', () => {
    expect(normalizeHsnCode(' 27101944 ')).toBe('27101944');
    expect(normalizeHsnCode('HSN-27101944')).toBeNull();
    expect(normalizeHsnCode('123')).toBeNull();
  });
});
