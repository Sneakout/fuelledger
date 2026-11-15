import { describe, expect, it } from 'vitest';
import { mapExtractedDsrDraft, mergeExactNozzleAudit, mergeExactTankAudit, needsDsrVisualVerification, parseExactMeterReading, parseVisibleDsrNumber, suspiciousNozzleCells, type ExtractedDsrDraft } from '../src/modules/historical-sales/extractor.js';

const setup = {
  product: { id: 'product', code: 'HSD', name: 'High Speed Diesel', sellingPrice: '94' },
  tanks: [{ id: 'tank-1', code: 'HSD-1', workingCapacity: '19000', openingStock: '5000' }, { id: 'tank-2', code: 'HSD-2', workingCapacity: '19000', openingStock: '4000' }],
  nozzles: [{ id: 'nozzle-1', code: 'HSD-1', dispenserCode: 'D-1', openingMeter: '1000' }, { id: 'nozzle-2', code: 'HSD-2', dispenserCode: 'D-1', openingMeter: '2000' }],
} as never;

describe('DSR extraction mapping', () => {
  it('preserves all digits and the fixed three-decimal meter convention', () => {
    expect(parseExactMeterReading('18218·270')).toBe(18218.27);
    expect(parseExactMeterReading('26010-130')).toBe(26010.13);
    expect(parseExactMeterReading('3814800')).toBe(3814.8);
    expect(parseExactMeterReading('1828.13')).toBeUndefined();
  });

  it('replaces numeric guesses with the dedicated exact nozzle transcription', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.96, detectedPumpColumns: ['1', '2'], detectedTankColumns: ['1'], confidence: 0.8,
      rows: [{ day: 1, tankReadings: [{ code: '1', openingStock: 7929.83, dipReading: 83 }], receiptQuantity: 0, totalStock: 7929.83, nozzleReadings: [{ code: '1', meterReading: 1508.13 }, { code: '2', meterReading: 1828.13 }], testingQuantity: 25, salesQuantity: 1804.42, cumulativeSales: 1779.42, stockGainLoss: null, note: '' }],
    };
    const merged = mergeExactNozzleAudit(draft, { columns: ['1', '2'], rows: [{ day: 1, readings: [{ code: '1', raw: '15086·173' }, { code: '2', raw: '18218·270' }] }] });
    expect(merged.rows[0]?.nozzleReadings).toEqual([{ code: '1', meterReading: 15086.173 }, { code: '2', meterReading: 18218.27 }]);
  });

  it('fills a missing tank dip from the dedicated tank audit without replacing reliable stock', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.96, detectedPumpColumns: ['1'], detectedTankColumns: ['1'], confidence: 0.8,
      rows: [{ day: 1, tankReadings: [{ code: '1', openingStock: 7929.83, dipReading: null }], receiptQuantity: 0, totalStock: 7929.83, nozzleReadings: [], testingQuantity: 25, salesQuantity: null, cumulativeSales: null, stockGainLoss: null, note: '' }],
    };
    const merged = mergeExactTankAudit(draft, { columns: ['1'], rows: [{ day: 1, readings: [{ code: '1', dipRaw: '83', openingStockRaw: '7,999.99' }] }] });
    expect(merged.rows[0]?.tankReadings[0]).toEqual({ code: '1', openingStock: 7929.83, dipReading: 83 });
    expect(parseVisibleDsrNumber('6,306.44')).toBe(6306.44);
    expect(parseVisibleDsrNumber('70·1')).toBe(70.1);
  });

  it('rejects duplicated and backwards nozzle values using column continuity', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.96, detectedPumpColumns: ['1', '2'], detectedTankColumns: ['1'], confidence: 0.8,
      rows: [
        { day: 1, tankReadings: [], receiptQuantity: 0, totalStock: null, nozzleReadings: [{ code: '1', meterReading: 15086.13 }, { code: '2', meterReading: 15086.13 }], testingQuantity: 25, salesQuantity: 1804.42, cumulativeSales: null, stockGainLoss: null, note: '' },
        { day: 2, tankReadings: [], receiptQuantity: 0, totalStock: null, nozzleReadings: [{ code: '1', meterReading: 15000 }, { code: '2', meterReading: 18914.09 }], testingQuantity: 5, salesQuantity: 1480.25, cumulativeSales: null, stockGainLoss: null, note: '' },
      ],
    };
    const suspicious = suspiciousNozzleCells(draft);
    expect(suspicious).toEqual(new Set(['1:1', '1:2', '2:1']));
  });

  it('does not erase a first-pass nozzle value when the exact audit is unreadable', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.96, detectedPumpColumns: ['1'], detectedTankColumns: ['1'], confidence: 0.8,
      rows: [{ day: 1, tankReadings: [{ code: '1', openingStock: 7929.83, dipReading: 83 }], receiptQuantity: 0, totalStock: 7929.83, nozzleReadings: [{ code: '1', meterReading: 15086.173 }], testingQuantity: 25, salesQuantity: 1804.42, cumulativeSales: 1779.42, stockGainLoss: null, note: '' }],
    };
    const merged = mergeExactNozzleAudit(draft, { columns: ['1'], rows: [{ day: 1, readings: [{ code: '1', raw: null }] }] });
    expect(merged.rows[0]?.nozzleReadings[0]?.meterReading).toBe(15086.173);
  });

  it('requests a visual verification pass for missing dips or decreasing cumulative meters', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.96, detectedPumpColumns: ['1'], detectedTankColumns: ['1'], confidence: 0.8,
      rows: [
        { day: 1, tankReadings: [{ code: '1', openingStock: 7929.83, dipReading: null }], receiptQuantity: null, totalStock: 7929.83, nozzleReadings: [{ code: '1', meterReading: 15086.173 }], testingQuantity: 25, salesQuantity: 1804.42, cumulativeSales: 1779.42, stockGainLoss: null, note: '' },
        { day: 2, tankReadings: [{ code: '1', openingStock: 6306.44, dipReading: 70.1 }], receiptQuantity: null, totalStock: 6306.44, nozzleReadings: [{ code: '1', meterReading: 1560.48 }], testingQuantity: 5, salesQuantity: 1480.25, cumulativeSales: 3260.27, stockGainLoss: null, note: '' },
      ],
    };
    expect(needsDsrVisualVerification(draft)).toBe(true);
  });

  it('maps visible tank and nozzle columns without inventing unreadable values', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.96, detectedPumpColumns: ['1', '2'], detectedTankColumns: ['HSD-1', 'HSD-2'], confidence: 0.82,
      rows: [{ day: 1, tankReadings: [{ code: 'HSD-1', openingStock: 7929.83, dipReading: 83 }, { code: 'HSD-2', openingStock: null, dipReading: null }], receiptQuantity: 0, totalStock: 7929.83, nozzleReadings: [{ code: 'D-1/HSD-1', meterReading: 15086.173 }, { code: 'D-1/HSD-2', meterReading: null }], testingQuantity: 25, salesQuantity: 1804.42, cumulativeSales: 1779.42, stockGainLoss: null, note: '' }],
    };
    const result = mapExtractedDsrDraft(draft, setup, '2026-10');
    expect(result.rows[0]).toMatchObject({ date: '2026-10-01', receiptQuantity: 0, salesQuantity: 1804.42, testingQuantity: 25, sellingPrice: 94 });
    expect(result.rows[0]?.tankReadings).toEqual([{ tankId: 'tank-1', openingStock: 7929.83, dipReading: 83 }, { tankId: 'tank-2', openingStock: 0 }]);
    expect(result.rows[0]?.nozzleReadings).toEqual([{ nozzleId: 'nozzle-1', meterReading: 15086.173 }, { nozzleId: 'nozzle-2', meterReading: 0 }]);
    expect(result.uncertainCells).toEqual(expect.arrayContaining(['2026-10-01:tank:tank-2:stock', '2026-10-01:nozzle:nozzle-2']));
    expect(result.warnings).toContain('2 cells could not be read confidently and must be reviewed.');
  });

  it('blocks a DSR whose visible pump layout has more columns than configured equipment', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.96, detectedPumpColumns: ['1', '2', '3', '4'], detectedTankColumns: ['HSD-1', 'HSD-2'], confidence: 0.9,
      rows: [{ day: 1, tankReadings: [], receiptQuantity: null, totalStock: null, nozzleReadings: [1, 2, 3, 4].map((column, index) => ({ code: String(column), meterReading: 15000 + index * 1000 })), testingQuantity: 0, salesQuantity: null, cumulativeSales: null, stockGainLoss: null, note: '' }],
    };
    const result = mapExtractedDsrDraft(draft, setup, '2026-10');
    expect(result.layoutIssues).toEqual([expect.stringContaining('contains 4 populated pump columns')]);
  });

  it('maps generic numbered pump headings by stable left-to-right equipment order when counts match', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.96, detectedPumpColumns: ['1', '2'], detectedTankColumns: ['HSD-1', 'HSD-2'], confidence: 0.9,
      rows: [{ day: 1, tankReadings: [{ code: '1', openingStock: 7000, dipReading: 82 }, { code: '2', openingStock: 6000, dipReading: 71 }], receiptQuantity: 0, totalStock: 13000, nozzleReadings: [{ code: '1', meterReading: 15086.173 }, { code: '2', meterReading: 18218.27 }], testingQuantity: 25, salesQuantity: 100, cumulativeSales: 75, stockGainLoss: null, note: '' }],
    };
    const result = mapExtractedDsrDraft(draft, setup, '2026-10');
    expect(result.rows[0]?.nozzleReadings).toEqual([{ nozzleId: 'nozzle-1', meterReading: 15086.173 }, { nozzleId: 'nozzle-2', meterReading: 18218.27 }]);
    expect(result.rows[0]?.tankReadings).toEqual([{ tankId: 'tank-1', openingStock: 7000, dipReading: 82 }, { tankId: 'tank-2', openingStock: 6000, dipReading: 71 }]);
    expect(result.layoutIssues).toEqual([]);
  });

  it('requires user confirmation when the DSR period is absent', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: '', periodPresent: false, periodConfidence: 0, detectedPumpColumns: ['1', '2'], detectedTankColumns: ['1', '2'], confidence: 0.9,
      rows: [{ day: 1, tankReadings: [{ code: '1', openingStock: 7000, dipReading: 82 }, { code: '2', openingStock: 6000, dipReading: 71 }], receiptQuantity: 0, totalStock: 13000, nozzleReadings: [{ code: '1', meterReading: 15086 }, { code: '2', meterReading: 18218 }], testingQuantity: 0, salesQuantity: 100, cumulativeSales: 100, stockGainLoss: null, note: '' }],
    };
    const result = mapExtractedDsrDraft(draft, setup, '2026-10');
    expect(result.periodNeedsConfirmation).toBe(true);
    expect(result.layoutIssues).toEqual([]);
  });

  it('ignores empty printed tank template columns and maps the one populated tank', () => {
    const oneTankSetup = { ...setup, tanks: [setup.tanks[0]] } as never;
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.98, detectedPumpColumns: ['1', '2'], detectedTankColumns: ['TANK 1', 'TANK 2', 'TANK 3'], confidence: 0.9,
      rows: [{ day: 1, tankReadings: [{ code: 'TANK 1', openingStock: 7929.83, dipReading: 83 }, { code: 'TANK 2', openingStock: null, dipReading: null }, { code: 'TANK 3', openingStock: null, dipReading: null }], receiptQuantity: 0, totalStock: 7929.83, nozzleReadings: [{ code: '1', meterReading: 15086 }, { code: '2', meterReading: 18218 }], testingQuantity: 25, salesQuantity: 100, cumulativeSales: 75, stockGainLoss: null, note: '' }],
    };
    const result = mapExtractedDsrDraft(draft, oneTankSetup, '2026-10');
    expect(result.detectedTankColumns).toEqual(['TANK 1']);
    expect(result.rows[0]?.tankReadings).toEqual([{ tankId: 'tank-1', openingStock: 7929.83, dipReading: 83 }]);
    expect(result.layoutIssues).toEqual([]);
  });

  it('uses a confidently read physical DSR period instead of the temporary selected month', () => {
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.98, detectedPumpColumns: ['1', '2'], detectedTankColumns: ['1', '2'], confidence: 0.9,
      rows: [{ day: 1, tankReadings: [{ code: '1', openingStock: 7000, dipReading: 82 }, { code: '2', openingStock: 6000, dipReading: 71 }], receiptQuantity: 0, totalStock: 13000, nozzleReadings: [{ code: '1', meterReading: 15086 }, { code: '2', meterReading: 18218 }], testingQuantity: 0, salesQuantity: 100, cumulativeSales: 100, stockGainLoss: null, note: '' }],
    };
    const result = mapExtractedDsrDraft(draft, setup, '2026-11');
    expect(result.effectiveMonth).toBe('2026-10');
    expect(result.periodSource).toBe('DOCUMENT');
    expect(result.rows[0]?.date).toBe('2026-10-01');
    expect(result.layoutIssues).toEqual([]);
  });

  it('uses the 20 KL UG master chart instead of an OCR volume and flags a material difference', () => {
    const calibratedSetup = { ...setup, tanks: [{ ...setup.tanks[0], nominalCapacity: '20000', tankType: 'UNDERGROUND' }] } as never;
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.98, detectedPumpColumns: ['1', '2'], detectedTankColumns: ['1'], confidence: 0.9,
      rows: [{ day: 1, tankReadings: [{ code: '1', openingStock: 13_700, dipReading: 126.5 }], receiptQuantity: 0, totalStock: 13_700, nozzleReadings: [{ code: '1', meterReading: 15086 }, { code: '2', meterReading: 18218 }], testingQuantity: 0, salesQuantity: 100, cumulativeSales: 100, stockGainLoss: null, note: '' }],
    };
    const result = mapExtractedDsrDraft(draft, calibratedSetup, '2026-10');
    expect(result.rows[0]?.tankReadings[0]).toMatchObject({
      dipReading: 126.5,
      openingStock: 13_614.54,
      calibration: { chartId: 'IOCL-20KL-UG-KOZHIKODE-IS-2166-1963-A', volumeLitres: 13_614.54, ocrVolumeLitres: 13_700, reviewConfirmed: false },
    });
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('chart-derived 13614.54 L')]));
  });

  it('does not silently accept a missing calibrated dip or a decreasing meter', () => {
    const calibratedSetup = { ...setup, tanks: [{ ...setup.tanks[0], nominalCapacity: '20000', tankType: 'UNDERGROUND' }], nozzles: [setup.nozzles[0]] } as never;
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.98, detectedPumpColumns: ['1'], detectedTankColumns: ['1'], confidence: 0.9,
      rows: [
        { day: 1, tankReadings: [{ code: '1', openingStock: 7929.83, dipReading: null }], receiptQuantity: 0, totalStock: 7929.83, nozzleReadings: [{ code: '1', meterReading: 15086.173 }], testingQuantity: 25, salesQuantity: 1804.42, cumulativeSales: 1779.42, stockGainLoss: null, note: '' },
        { day: 2, tankReadings: [{ code: '1', openingStock: 6306.44, dipReading: 70.1 }], receiptQuantity: 0, totalStock: 6306.44, nozzleReadings: [{ code: '1', meterReading: 1560.48 }], testingQuantity: 5, salesQuantity: 1480.25, cumulativeSales: 3260.27, stockGainLoss: null, note: '' },
      ],
    };
    const result = mapExtractedDsrDraft(draft, calibratedSetup, '2026-10');
    expect(result.uncertainCells).toEqual(expect.arrayContaining(['2026-10-01:tank:tank-1:stock', '2026-10-02:nozzle:nozzle-1']));
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('dip on 2026-10-01 was not read'), expect.stringContaining('leading digits were dropped')]));
  });

  it('derives sales from a monotonic meter sequence instead of trusting the OCR sales column', () => {
    const oneNozzleSetup = { ...setup, tanks: [setup.tanks[0]], nozzles: [setup.nozzles[0]] } as never;
    const draft: ExtractedDsrDraft = {
      detectedProduct: 'HSD', detectedMonth: 'October 2026', periodPresent: true, periodConfidence: 0.98, detectedPumpColumns: ['1'], detectedTankColumns: ['1'], confidence: 0.9,
      rows: [
        { day: 1, tankReadings: [{ code: '1', openingStock: 7929.83, dipReading: 83 }], receiptQuantity: 0, totalStock: 7929.83, nozzleReadings: [{ code: '1', meterReading: 1508.13 }], testingQuantity: 25, salesQuantity: 1804.42, cumulativeSales: 1779.42, stockGainLoss: null, note: '' },
        { day: 2, tankReadings: [{ code: '1', openingStock: 6306.44, dipReading: 70.1 }], receiptQuantity: 0, totalStock: 6306.44, nozzleReadings: [{ code: '1', meterReading: 1560.48 }], testingQuantity: 5, salesQuantity: 1480.25, cumulativeSales: 3260.27, stockGainLoss: null, note: '' },
      ],
    };
    const result = mapExtractedDsrDraft(draft, oneNozzleSetup, '2026-10');
    expect(result.uncertainCells).not.toEqual(expect.arrayContaining(['2026-10-01:nozzle:nozzle-1', '2026-10-02:nozzle:nozzle-1']));
    expect(result.rows[0]?.salesQuantity).toBe(27.35);
  });
});
