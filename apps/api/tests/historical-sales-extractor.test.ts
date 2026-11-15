import { describe, expect, it } from 'vitest';
import { mapExtractedDsrDraft, type ExtractedDsrDraft } from '../src/modules/historical-sales/extractor.js';

const setup = {
  product: { id: 'product', code: 'HSD', name: 'High Speed Diesel', sellingPrice: '94' },
  tanks: [{ id: 'tank-1', code: 'HSD-1', workingCapacity: '19000', openingStock: '5000' }, { id: 'tank-2', code: 'HSD-2', workingCapacity: '19000', openingStock: '4000' }],
  nozzles: [{ id: 'nozzle-1', code: 'HSD-1', dispenserCode: 'D-1', openingMeter: '1000' }, { id: 'nozzle-2', code: 'HSD-2', dispenserCode: 'D-1', openingMeter: '2000' }],
} as never;

describe('DSR extraction mapping', () => {
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
});
