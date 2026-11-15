import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { calibrateDip, compareDipWithOcrVolume, IOCL_20KL_UG_KOZHIKODE_CALIBRATION } from './dip-calibration.js';

describe('IndianOil 20 KL UG master calibration', () => {
  it('preserves all 210 source entries in uninterrupted dip order', () => {
    const entries = IOCL_20KL_UG_KOZHIKODE_CALIBRATION.entries;
    expect(entries).toHaveLength(210);
    expect(entries.map(entry => entry.dipCm)).toEqual(Array.from({ length: 210 }, (_, index) => index + 1));
    const canonical = entries.map(entry => `${entry.dipCm}|${entry.volumeLitres.toFixed(2)}|${entry.diffLitresPerMm.toFixed(2)}\n`).join('');
    expect(createHash('sha256').update(canonical).digest('hex')).toBe('b4279142e00962530c1e11549e2a57d81e45dd91fd2e4fb978ea2cd16ee60760');
  });

  it('returns exact chart volumes at exact readings and preserves the uncapped maximum', () => {
    expect(calibrateDip(1)).toMatchObject({ status: 'OK', volumeLitres: 11.97, interpolated: false });
    expect(calibrateDip(126)).toMatchObject({ status: 'OK', volumeLitres: 13_550.35, interpolated: false });
    expect(calibrateDip(210)).toMatchObject({ status: 'OK', volumeLitres: 21_628.93, interpolated: false });
  });

  it('linearly interpolates decimal dips from adjacent source entries', () => {
    expect(calibrateDip(126.5)).toMatchObject({ status: 'OK', volumeLitres: 13_614.54, interpolated: true });
  });

  it('does not extrapolate and handles invalid OCR safely', () => {
    expect(calibrateDip(0)).toEqual(expect.objectContaining({ status: 'OUT_OF_RANGE', minimumDipCm: 1, maximumDipCm: 210 }));
    expect(calibrateDip(211)).toEqual(expect.objectContaining({ status: 'OUT_OF_RANGE', minimumDipCm: 1, maximumDipCm: 210 }));
    expect(calibrateDip('unclear')).toEqual(expect.objectContaining({ status: 'INVALID' }));
    expect(calibrateDip(null)).toEqual(expect.objectContaining({ status: 'INVALID' }));
  });

  it('flags an OCR volume only when it exceeds the configured tolerance', () => {
    expect(compareDipWithOcrVolume({ dipCm: 126.5, ocrVolumeLitres: 13_620, toleranceLitres: 10 })).toMatchObject({ requiresReview: false });
    const mismatch = compareDipWithOcrVolume({ dipCm: 126.5, ocrVolumeLitres: 13_700, toleranceLitres: 10 });
    expect(mismatch.requiresReview).toBe(true);
    expect(mismatch.differenceLitres).toBeCloseTo(85.46, 8);
    expect(compareDipWithOcrVolume({ dipCm: 126.5 })).toMatchObject({ requiresReview: false, ocrVolumeLitres: undefined });
  });

  it('keeps the unresolved deadwood and nominal-capacity discrepancy visible in metadata', () => {
    expect(IOCL_20KL_UG_KOZHIKODE_CALIBRATION.review).toMatchObject({ deadwoodAllowanceLitres: 18, deadwoodConventionEstablished: false, nominalCapacityDiscrepancy: true, productionApprovalRequired: true });
  });
});
