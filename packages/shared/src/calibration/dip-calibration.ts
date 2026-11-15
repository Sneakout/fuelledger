import { IOCL_20KL_UG_KOZHIKODE_CALIBRATION } from './iocl-20kl-ug-kozhikode.js';

export type CalibrationEntry = { dipCm: number; volumeLitres: number; diffLitresPerMm: number };
export type CalibrationChart = {
  id: string;
  entries: readonly CalibrationEntry[];
};

export type DipCalibrationResult =
  | { status: 'OK'; chartId: string; dipCm: number; volumeLitres: number; interpolated: boolean; lower: CalibrationEntry; upper: CalibrationEntry }
  | { status: 'INVALID'; chartId: string; reason: 'MISSING_OR_INVALID_DIP' }
  | { status: 'OUT_OF_RANGE'; chartId: string; dipCm: number; minimumDipCm: number; maximumDipCm: number };

export const MASTER_20KL_UG_CALIBRATION: CalibrationChart = IOCL_20KL_UG_KOZHIKODE_CALIBRATION;

export function calibrateDip(dip: unknown, chart: CalibrationChart = MASTER_20KL_UG_CALIBRATION): DipCalibrationResult {
  const dipCm = typeof dip === 'number' ? dip : typeof dip === 'string' && dip.trim() !== '' ? Number(dip) : Number.NaN;
  if (!Number.isFinite(dipCm)) return { status: 'INVALID', chartId: chart.id, reason: 'MISSING_OR_INVALID_DIP' };
  const first = chart.entries[0];
  const last = chart.entries.at(-1);
  if (!first || !last) return { status: 'INVALID', chartId: chart.id, reason: 'MISSING_OR_INVALID_DIP' };
  if (dipCm < first.dipCm || dipCm > last.dipCm) return { status: 'OUT_OF_RANGE', chartId: chart.id, dipCm, minimumDipCm: first.dipCm, maximumDipCm: last.dipCm };

  let low = 0;
  let high = chart.entries.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const entry = chart.entries[middle]!;
    if (entry.dipCm === dipCm) return { status: 'OK', chartId: chart.id, dipCm, volumeLitres: entry.volumeLitres, interpolated: false, lower: entry, upper: entry };
    if (entry.dipCm < dipCm) low = middle + 1;
    else high = middle - 1;
  }
  const lower = chart.entries[high]!;
  const upper = chart.entries[low]!;
  const fraction = (dipCm - lower.dipCm) / (upper.dipCm - lower.dipCm);
  const volumeLitres = lower.volumeLitres + fraction * (upper.volumeLitres - lower.volumeLitres);
  return { status: 'OK', chartId: chart.id, dipCm, volumeLitres, interpolated: true, lower, upper };
}

export function compareDipWithOcrVolume(input: {
  dipCm: unknown;
  ocrVolumeLitres?: unknown;
  toleranceLitres?: number;
  chart?: CalibrationChart;
}) {
  const calibration = calibrateDip(input.dipCm, input.chart ?? MASTER_20KL_UG_CALIBRATION);
  const ocrVolumeLitres = typeof input.ocrVolumeLitres === 'number' ? input.ocrVolumeLitres : typeof input.ocrVolumeLitres === 'string' && input.ocrVolumeLitres.trim() !== '' ? Number(input.ocrVolumeLitres) : undefined;
  const toleranceLitres = input.toleranceLitres ?? 25;
  if (calibration.status !== 'OK') return { calibration, ocrVolumeLitres: Number.isFinite(ocrVolumeLitres) ? ocrVolumeLitres : undefined, toleranceLitres, requiresReview: true as const };
  if (!Number.isFinite(ocrVolumeLitres)) return { calibration, ocrVolumeLitres: undefined, toleranceLitres, differenceLitres: undefined, requiresReview: false as const };
  const differenceLitres = Math.abs(ocrVolumeLitres! - calibration.volumeLitres);
  return { calibration, ocrVolumeLitres, toleranceLitres, differenceLitres, requiresReview: differenceLitres > toleranceLitres };
}

export { IOCL_20KL_UG_KOZHIKODE_CALIBRATION } from './iocl-20kl-ug-kozhikode.js';
