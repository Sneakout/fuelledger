import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, LoaderCircle, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { calculateHistoricalNozzleSales, calculateHistoricalTotalStock, compareDipWithOcrVolume, type HistoricalSalesImportInput, type HistoricalSalesRowInput } from '@fuelledger/shared';
import { api, ApiRequestError, historicalSalesSourceUrl, type HistoricalImportIssue, type HistoricalSalesImportSummary, type HistoricalSalesSetup } from '../lib/api';
import { useStation } from '../components/StationProvider';
import { deleteHistoricalDraft, draftFile, historicalDraftById, historicalDraftId, historicalDraftScope, latestHistoricalDraft, saveHistoricalDraft, type HistoricalOcrDraft } from '../lib/historical-draft-store';

const isoDate = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}`;
const reviewCellId = (cell: string) => `historical-review-${cell.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const daysInMonth = (month: string) => { const [year, value] = month.split('-').map(Number); return new Date(Date.UTC(year!, value!, 0)).getUTCDate(); };
const dsrMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dsrYears = Array.from({ length: 80 }, (_, index) => new Date().getFullYear() + 1 - index);
const fileBytes = (file: File) => new Promise<ArrayBuffer>((resolve, reject) => {
  if (typeof file.arrayBuffer === 'function') { void file.arrayBuffer().then(resolve, reject); return; }
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.readAsArrayBuffer(file);
});
const sha256 = async (file: File) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await fileBytes(file)))].map(value => value.toString(16).padStart(2, '0')).join('');
const base64 = (file: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });

function calculateReliableSales(rows: HistoricalSalesRowInput[], uncertainCells: string[]) {
  const uncertain = new Set(uncertainCells);
  const nextRows = rows.map(row => structuredClone(row));
  for (let index = 0; index < nextRows.length - 1; index += 1) {
    const row = nextRows[index]!, next = nextRows[index + 1]!;
    const hasUncertainMeter = [...row.nozzleReadings.map(reading => `${row.date}:nozzle:${reading.nozzleId}`), ...next.nozzleReadings.map(reading => `${next.date}:nozzle:${reading.nozzleId}`)].some(cell => uncertain.has(cell));
    if (hasUncertainMeter) continue;
    const calculated = calculateHistoricalNozzleSales(row, next);
    if (calculated === undefined) continue;
    row.salesQuantity = calculated;
    uncertain.delete(`${row.date}:salesQuantity`);
  }
  return { rows: nextRows, uncertainCells: [...uncertain] };
}

function calculateDraftRows(rows: HistoricalSalesRowInput[], uncertainCells: string[]) {
  const totals = rows.map(row => {
    const tankStockIncomplete = row.tankReadings.some(reading => uncertainCells.includes(`${row.date}:tank:${reading.tankId}:stock`));
    if (!tankStockIncomplete) return { ...row, totalStock: calculateHistoricalTotalStock(row) };
    const { totalStock: _ignored, ...withoutTotal } = row;
    return withoutTotal;
  });
  return calculateReliableSales(totals, uncertainCells);
}

function emptyRow(date: string, setup: HistoricalSalesSetup['products'][number], previous?: HistoricalSalesRowInput): HistoricalSalesRowInput {
  return {
    date,
    tankReadings: setup.tanks.map(tank => ({ tankId: tank.id, openingStock: previous?.tankReadings.find(item => item.tankId === tank.id)?.openingStock ?? 0, dipReading: previous?.tankReadings.find(item => item.tankId === tank.id)?.dipReading })),
    receiptQuantity: 0,
    nozzleReadings: setup.nozzles.map(nozzle => ({ nozzleId: nozzle.id, meterReading: previous?.nozzleReadings.find(item => item.nozzleId === nozzle.id)?.meterReading ?? 0 })),
    testingQuantity: 0, salesQuantity: 0, sellingPrice: Number(setup.product.sellingPrice),
  };
}

export function HistoricalSalesImportPage() {
  const location = useLocation();
  const routedDocument = (location.state as { intelligenceDocument?: { kind: 'DSR'; file: File; stationId?: string; productCode?: string } } | null)?.intelligenceDocument;
  const routedDocumentHandled = useRef(false);
  const documentPeriodSync = useRef(false);
  const restoredDraftScope = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { stations, selectedStationId, selectStation } = useStation();
  const today = new Date();
  const [stationId, setStationId] = useState(selectedStationId || stations[0]?.id || '');
  const [month, setMonth] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [setup, setSetup] = useState<HistoricalSalesSetup | null>(null);
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<HistoricalSalesRowInput[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [applyCutover, setApplyCutover] = useState(false);
  const [issues, setIssues] = useState<HistoricalImportIssue[]>([]);
  const [imports, setImports] = useState<HistoricalSalesImportSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [intelligenceActive, setIntelligenceActive] = useState(false);
  const [readerStatus, setReaderStatus] = useState('');
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [layoutIssues, setLayoutIssues] = useState<string[]>([]);
  const [uncertainCells, setUncertainCells] = useState<string[]>([]);
  const [periodNeedsConfirmation, setPeriodNeedsConfirmation] = useState(false);
  const [periodConfirmed, setPeriodConfirmed] = useState(false);
  const [periodSource, setPeriodSource] = useState<'DOCUMENT' | 'SELECTED'>('SELECTED');
  const [sourceFingerprint, setSourceFingerprint] = useState('');
  const [draftId, setDraftId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const selected = useMemo(() => setup?.products.find(item => item.product.id === productId), [setup, productId]);
  const pendingCalibrationReviews = useMemo(() => rows.flatMap(row => row.tankReadings.filter(reading => reading.calibration && !reading.calibration.reviewConfirmed).map(reading => ({ date: row.date, reading, tank: selected?.tanks.find(tank => tank.id === reading.tankId) }))), [rows, selected]);
  const reviewMessagesFor = (row: HistoricalSalesRowInput) => {
    const messages: Array<{ level: string; message: string; targetId?: string }> = issues.filter(issue => issue.date === row.date).map(issue => ({ level: issue.level, message: issue.message }));
    const unreadable = uncertainCells.filter(cell => cell.startsWith(`${row.date}:`));
    unreadable.forEach(cell => {
      const parts = cell.split(':');
      const label = parts[1] === 'tank'
        ? `${selected?.tanks.find(tank => tank.id === parts[2])?.code ?? 'Tank'} stock`
        : parts[1] === 'nozzle'
          ? `${selected?.nozzles.find(nozzle => nozzle.id === parts[2])?.dispenserCode ?? 'Dispenser'}/${selected?.nozzles.find(nozzle => nozzle.id === parts[2])?.code ?? 'nozzle'} meter`
          : 'Sales litres';
      messages.unshift({ level: 'ERROR', message: `${label} could not be read confidently.`, targetId: reviewCellId(cell) });
    });
    const calibration = pendingCalibrationReviews.filter(item => item.date === row.date).length;
    if (calibration) messages.unshift({ level: 'WARNING', message: `${calibration} chart-derived tank volume${calibration === 1 ? '' : 's'} need verification against the DSR.` });
    return messages;
  };
  useEffect(() => { if (!stationId) return; let active = true; setError(''); Promise.all([api.historicalSalesSetup(stationId), api.historicalSalesImports(stationId)]).then(([next, prior]) => { if (!active) return; setSetup(next); setImports(prior.imports); setProductId(current => next.products.some(item => item.product.id === current) ? current : next.products[0]?.product.id ?? ''); }).catch(caught => active && setError(caught instanceof ApiRequestError ? caught.message : 'Unable to prepare the historical import.')); return () => { active = false; }; }, [stationId]);
  useEffect(() => { if (!stationId && stations[0]) setStationId(stations[0].id); }, [stationId, stations]);
  useEffect(() => { let active = true; void api.subscription().then(value => { if (!active) return; const expires = value.intelligenceExpiresAt ? new Date(value.intelligenceExpiresAt) : null; setIntelligenceActive(Boolean(value.intelligenceEnabledAt) && (!expires || expires > new Date())); }).catch(() => undefined); return () => { active = false; }; }, []);
  useEffect(() => { if (!selected) return; if (documentPeriodSync.current) { documentPeriodSync.current = false; return; } setRows([]); setIssues([]); setPeriodConfirmed(false); }, [selected?.product.id, month]);
  useEffect(() => {
    if (!selected || !stationId || !productId) return;
    const scope = historicalDraftScope(stationId, productId);
    if (restoredDraftScope.current === scope) return;
    restoredDraftScope.current = scope;
    void latestHistoricalDraft(stationId, productId).then(draft => { if (draft) restoreDraft(draft, 'Saved OCR draft restored from this browser.'); }).catch(() => undefined);
  }, [selected, stationId, productId]);
  useEffect(() => {
    if (!rows.length) return;
    const calculated = calculateDraftRows(rows, uncertainCells);
    const derivedChanged = calculated.rows.some((row, index) => row.salesQuantity !== rows[index]?.salesQuantity || row.totalStock !== rows[index]?.totalStock);
    if (derivedChanged) setRows(calculated.rows);
    if (calculated.uncertainCells.length !== uncertainCells.length) setUncertainCells(calculated.uncertainCells);
  }, [uncertainCells]);
  useEffect(() => {
    if (!file || !draftId || !sourceFingerprint || !rows.length || busy) return;
    setDraftStatus('Saving draft in this browser…');
    const timer = window.setTimeout(() => {
      const draft: HistoricalOcrDraft = {
        id: draftId, scopeKey: historicalDraftScope(stationId, productId), stationId, productId, sourceFingerprint,
        sourceFileName: file.name, sourceMimeType: file.type || 'application/pdf', sourceLastModified: file.lastModified, sourceBlob: file,
        month, rows, extractionWarnings, layoutIssues, uncertainCells, periodNeedsConfirmation, periodConfirmed, periodSource, readerStatus, applyCutover, updatedAt: new Date().toISOString(),
      };
      void saveHistoricalDraft(draft).then(() => setDraftStatus(`Draft saved locally at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}. Nothing has been submitted.`)).catch(() => setDraftStatus('Browser autosave is unavailable. Keep this page open until you finish.'));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [file, draftId, sourceFingerprint, rows, extractionWarnings, layoutIssues, uncertainCells, periodNeedsConfirmation, periodConfirmed, periodSource, readerStatus, applyCutover, month, stationId, productId, busy]);
  useEffect(() => {
    if (!routedDocument || routedDocumentHandled.current || !setup || !intelligenceActive) return;
    if (routedDocument.stationId && stationId !== routedDocument.stationId) { setStationId(routedDocument.stationId); selectStation(routedDocument.stationId); return; }
    const routedProduct = routedDocument.productCode ? setup.products.find(item => item.product.code.toUpperCase() === routedDocument.productCode?.toUpperCase()) : undefined;
    if (routedProduct && productId !== routedProduct.product.id) { setProductId(routedProduct.product.id); return; }
    if (!productId) return;
    routedDocumentHandled.current = true;
    void attachRegister(routedDocument.file);
  }, [routedDocument, setup, intelligenceActive, stationId, productId, selectStation]);
  const changeRow = (index: number, change: (row: HistoricalSalesRowInput) => void) => setRows(previous => calculateDraftRows(previous.map((row, rowIndex) => { if (rowIndex !== index) return row; const next = structuredClone(row); change(next); return next; }), uncertainCells).rows);
  const markReviewed = (cell: string) => setUncertainCells(previous => previous.filter(item => item !== cell));
  const changePeriod = (nextMonth: string, preserveDraft = periodNeedsConfirmation) => {
    if (!/^\d{4}-\d{2}$/.test(nextMonth) || nextMonth === month) return;
    if (preserveDraft) {
      const dateChanges = new Map<string, string>();
      const remappedRows = rows.map(row => {
        const day = Math.min(Number(row.date.slice(-2)), daysInMonth(nextMonth));
        const date = isoDate(nextMonth, day);
        dateChanges.set(row.date, date);
        return { ...row, date };
      });
      setRows(remappedRows);
      setUncertainCells(current => current.map(cell => {
        const date = cell.slice(0, 10);
        return dateChanges.has(date) ? `${dateChanges.get(date)}${cell.slice(10)}` : cell;
      }));
      setLayoutIssues(current => current.filter(issue => !/DSR period/i.test(issue)));
      setPeriodSource('SELECTED');
      setPeriodConfirmed(false);
      documentPeriodSync.current = true;
    }
    setMonth(nextMonth);
  };
  const addDay = () => { if (!selected || rows.length >= daysInMonth(month)) return; const previous = rows.at(-1); setRows(current => calculateDraftRows([...current, emptyRow(isoDate(month, current.length + 1), selected, previous)], uncertainCells).rows); };
  function restoreDraft(draft: HistoricalOcrDraft, message: string) {
    if (draft.month !== month) { documentPeriodSync.current = true; setMonth(draft.month); }
    const calculated = calculateDraftRows(draft.rows, draft.uncertainCells);
    setFile(draftFile(draft)); setSourceFingerprint(draft.sourceFingerprint); setDraftId(draft.id); setRows(calculated.rows); setExtractionWarnings(draft.extractionWarnings); setLayoutIssues(draft.layoutIssues); setUncertainCells(calculated.uncertainCells); setPeriodNeedsConfirmation(draft.periodNeedsConfirmation); setPeriodConfirmed(draft.periodConfirmed); setPeriodSource(draft.periodSource); setReaderStatus(draft.readerStatus); setApplyCutover(draft.applyCutover); setDraftStatus(message); setError('');
  }
  function refreshCalibratedVolumes() {
    if (!selected) return;
    const nextRows = structuredClone(rows);
    const calibratedCells = new Set<string>();
    let calibrated = 0;
    let invalid = 0;
    for (const row of nextRows) for (const tank of selected.tanks) {
      const reading = row.tankReadings.find(item => item.tankId === tank.id);
      if (!reading || reading.dipReading === undefined || tank.tankType !== 'UNDERGROUND' || Number(tank.nominalCapacity) !== 20_000) continue;
      const cell = `${row.date}:tank:${tank.id}:stock`;
      const comparison = compareDipWithOcrVolume({ dipCm: reading.dipReading, ocrVolumeLitres: reading.calibration?.ocrVolumeLitres ?? (uncertainCells.includes(cell) ? undefined : reading.openingStock), toleranceLitres: 25 });
      if (comparison.calibration.status !== 'OK') { invalid += 1; continue; }
      reading.openingStock = Number(comparison.calibration.volumeLitres.toFixed(3));
      reading.calibration = { chartId: comparison.calibration.chartId, volumeLitres: comparison.calibration.volumeLitres, ...(comparison.ocrVolumeLitres !== undefined ? { ocrVolumeLitres: comparison.ocrVolumeLitres } : {}), ...(comparison.differenceLitres !== undefined ? { differenceLitres: comparison.differenceLitres } : {}), toleranceLitres: comparison.toleranceLitres, interpolated: comparison.calibration.interpolated, reviewConfirmed: reading.calibration?.reviewConfirmed === true && reading.calibration.volumeLitres === comparison.calibration.volumeLitres ? true : !comparison.requiresReview };
      calibratedCells.add(cell); calibrated += 1;
    }
    const nextUncertainCells = uncertainCells.filter(cell => !calibratedCells.has(cell));
    setRows(calculateDraftRows(nextRows, nextUncertainCells).rows);
    setUncertainCells(nextUncertainCells);
    setError(invalid ? `${invalid} dip reading${invalid === 1 ? ' is' : 's are'} outside the approved chart range and still need review.` : '');
    setDraftStatus(`${calibrated} chart-derived volume${calibrated === 1 ? '' : 's'} refreshed locally. OCR was not run again.`);
  }
  function updateDip(rowIndex: number, tank: HistoricalSalesSetup['products'][number]['tanks'][number], dip: number | undefined) {
    const nextRows = structuredClone(rows);
    const row = nextRows[rowIndex]!;
    const reading = row.tankReadings.find(item => item.tankId === tank.id)!;
    const cell = `${row.date}:tank:${tank.id}:stock`;
    const originalOcrVolume = reading.calibration?.ocrVolumeLitres ?? (uncertainCells.includes(cell) ? undefined : reading.openingStock);
    let nextUncertainCells = uncertainCells;
    reading.dipReading = dip;
    if (tank.tankType === 'UNDERGROUND' && Number(tank.nominalCapacity) === 20_000) {
      const comparison = compareDipWithOcrVolume({ dipCm: dip, ocrVolumeLitres: originalOcrVolume, toleranceLitres: 25 });
      if (comparison.calibration.status === 'OK') {
        reading.openingStock = Number(comparison.calibration.volumeLitres.toFixed(3));
        reading.calibration = { chartId: comparison.calibration.chartId, volumeLitres: comparison.calibration.volumeLitres, ...(comparison.ocrVolumeLitres !== undefined ? { ocrVolumeLitres: comparison.ocrVolumeLitres } : {}), ...(comparison.differenceLitres !== undefined ? { differenceLitres: comparison.differenceLitres } : {}), toleranceLitres: comparison.toleranceLitres, interpolated: comparison.calibration.interpolated, reviewConfirmed: !comparison.requiresReview };
        nextUncertainCells = uncertainCells.filter(item => item !== cell);
        setUncertainCells(nextUncertainCells);
        setError('');
      } else {
        delete reading.calibration;
        reading.openingStock = 0;
        nextUncertainCells = uncertainCells.includes(cell) ? uncertainCells : [...uncertainCells, cell];
        setUncertainCells(nextUncertainCells);
        setError(dip === undefined ? 'Enter a valid dip to calculate the official chart volume.' : `Dip ${dip} cm is outside the approved 1-210 cm chart range.`);
      }
    }
    setRows(calculateDraftRows(nextRows, nextUncertainCells).rows);
  }
  async function discardDraft() {
    if (!window.confirm('Discard this saved OCR draft and all manual corrections from this browser?')) return;
    const id = draftId; setDraftId(''); setSourceFingerprint(''); setFile(null); setExtractionWarnings([]); setLayoutIssues([]); setUncertainCells([]); setPeriodNeedsConfirmation(false); setPeriodConfirmed(false); setReaderStatus(''); setDraftStatus('Draft removed from this browser.'); setRows([]);
    if (id) await deleteHistoricalDraft(id).catch(() => undefined);
  }
  async function payload(): Promise<HistoricalSalesImportInput> { if (!file) throw new Error('Attach the scanned register first.'); const extension = file.name.toLowerCase().split('.').at(-1); const mime = file.type || (extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : 'image/jpeg'); return { stationId, productId, month, sourceFileName: file.name, sourceMimeType: mime as HistoricalSalesImportInput['sourceMimeType'], sourceSize: file.size, sourceContentBase64: await base64(file), sourceFingerprint: await sha256(file), rows, applyCutover }; }
  async function attachRegister(next: File | null, options: { forceOcr?: boolean } = {}) {
    setExtractionWarnings([]); setLayoutIssues([]); setUncertainCells([]); setPeriodNeedsConfirmation(false); setPeriodConfirmed(false); setPeriodSource('SELECTED'); setReaderStatus(''); setDraftStatus(''); setError('');
    if (!next) { setFile(null); return; }
    if (next.size > 5 * 1024 * 1024) { setError('The register scan must be 5 MB or smaller.'); return; }
    setFile(next);
    const fingerprint = await sha256(next);
    const nextDraftId = historicalDraftId(stationId, productId, fingerprint);
    setSourceFingerprint(fingerprint); setDraftId(nextDraftId);
    if (!options.forceOcr) {
      const saved = await historicalDraftById(nextDraftId).catch(() => undefined);
      if (saved) { restoreDraft(saved, 'This document already has a saved OCR draft. Restored without running OCR again.'); return; }
    }
    if (!intelligenceActive || !stationId || !productId) return;
    setBusy(true); setReaderStatus('Nerve Intelligence is reading the DSR layout and handwriting…');
    try {
      const extension = next.name.toLowerCase().split('.').at(-1);
      const mime = next.type || (extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : 'image/jpeg');
      const ocrEvidenceImagesBase64 = mime === 'application/pdf'
        ? await import('../lib/local-pdf-text').then(module => module.renderHistoricalDsrEvidence(next, selected?.nozzles.length ?? 8)).then(images => Promise.all(images.map(base64))).catch(() => undefined)
        : undefined;
      const result = await api.extractHistoricalSales({ stationId, productId, month, sourceFileName: next.name, sourceMimeType: mime as 'application/pdf' | 'image/jpeg' | 'image/png', sourceSize: next.size, sourceContentBase64: await base64(next), ...(ocrEvidenceImagesBase64 ? { ocrEvidenceImagesBase64 } : {}) });
      if (result.effectiveMonth !== month) { documentPeriodSync.current = true; setMonth(result.effectiveMonth); }
      const calculated = calculateDraftRows(result.rows, result.uncertainCells);
      if (calculated.rows.length) setRows(calculated.rows);
      setExtractionWarnings(result.warnings);
      setLayoutIssues(result.layoutIssues);
      setUncertainCells(calculated.uncertainCells);
      setPeriodSource(result.periodSource);
      setPeriodNeedsConfirmation(true);
      setReaderStatus(result.rows.length ? `Draft ready · ${result.rows.length} day${result.rows.length === 1 ? '' : 's'} recognised · ${Math.round(result.confidence * 100)}% document confidence` : 'No reliable rows were found. You can enter the register manually.');
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'FuelNerve could not read this DSR. You can still enter the rows manually.');
      setReaderStatus('Automatic reading stopped. The attached source remains available for manual entry.');
    } finally { setBusy(false); }
  }
  async function validate() { setBusy(true); setError(''); try { const result = await api.validateHistoricalSales(await payload()); setIssues(result.issues); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to validate this register.'); } finally { setBusy(false); } }
  async function save() { if (layoutIssues.length) { setError('Correct the fuel-station equipment layout or selected period and read the DSR again before confirming.'); return; } if (periodNeedsConfirmation && !periodConfirmed) { setError('Confirm the DSR month and year before importing.'); return; } if (uncertainCells.length) { setError(`Review the ${uncertainCells.length} highlighted unreadable value${uncertainCells.length === 1 ? '' : 's'} before confirming.`); return; } if (pendingCalibrationReviews.length) { setError('Verify every highlighted dip/volume difference before importing.'); return; } setBusy(true); setError(''); try { const result = await api.createHistoricalSalesImport(await payload()); setIssues(result.issues); setImports(previous => [result.record, ...previous]); if (draftId) await deleteHistoricalDraft(draftId).catch(() => undefined); setDraftId(''); setSourceFingerprint(''); setDraftStatus('Imported successfully. The local draft has been cleared.'); setFile(null); setApplyCutover(false); } catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : caught instanceof Error ? caught.message : 'Unable to import this register.'); } finally { setBusy(false); } }
  return <main className="page historical-import-page">
    <Link className="back-link" to="/stations"><ArrowLeft/> Back to petrol pumps</Link>
    <div className="page-heading"><div><span className="eyebrow">Customer onboarding</span><h1>Import the monthly sales register</h1><p>Record MS and HSD separately. FuelNerve checks the tank, receipt and nozzle chain before adding historical trends.</p></div></div>
    <section className="historical-import-controls"><label>Fuel station<select value={stationId} onChange={event => { setStationId(event.target.value); selectStation(event.target.value); }}>{stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label><label>Product<select value={productId} onChange={event => setProductId(event.target.value)}>{setup?.products.map(item => <option key={item.product.id} value={item.product.id}>{item.product.code} · {item.product.name}</option>)}</select></label><label>Month<input type="month" value={month} onChange={event => changePeriod(event.target.value)}/></label><label className="historical-file"><FileUp/><span>{file ? file.name : intelligenceActive ? 'Attach DSR — Nerve Intelligence will fill the table' : 'Attach register scan (PDF/JPG/PNG)'}</span><input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png" onChange={event => void attachRegister(event.target.files?.[0] ?? null)}/></label></section>
    {readerStatus && <div className={`historical-reader-status ${busy ? 'reading' : ''}`} aria-live="polite">{busy ? <LoaderCircle className="spin"/> : <Sparkles/>}<span><b>{busy ? 'Reading the DSR' : 'Automatic draft'}</b>{readerStatus}</span></div>}
    {extractionWarnings.length > 0 && <div className="historical-reader-warnings"><AlertTriangle/><span><b>Review before confirming</b>{extractionWarnings.map(warning => <small key={warning}>{warning}</small>)}</span></div>}
    {layoutIssues.length > 0 && <div className="form-error"><b>Equipment layout does not match this DSR.</b>{layoutIssues.map(issue => <div key={issue}>{issue}</div>)}<div>Update the fuel-station tanks and nozzles, then read the DSR again. Confirmation is blocked so no document column is silently ignored.</div></div>}
    {uncertainCells.length > 0 && <div className="historical-reader-warnings"><AlertTriangle/><span><b>{uncertainCells.length} unreadable value{uncertainCells.length === 1 ? '' : 's'} need review</b><small>FuelNerve has not assumed these readings are zero. Enter each highlighted value before confirming.</small></span></div>}
    {pendingCalibrationReviews.length > 0 && <div className="historical-reader-warnings calibration-review"><AlertTriangle/><span><b>{pendingCalibrationReviews.length} dip/volume difference{pendingCalibrationReviews.length === 1 ? '' : 's'} need verification</b><small>The official 20 KL UG calibration value is being used. Compare each highlighted item with the physical DSR and confirm it in the grid.</small></span></div>}
    {periodNeedsConfirmation && <div className="historical-period-confirm"><div className="historical-period-choice"><span>Actual DSR month and year</span><div className="historical-period-fields"><label><span>Month</span><select aria-label="Actual DSR month" value={month.slice(5, 7)} onChange={event => changePeriod(`${month.slice(0, 4)}-${event.target.value}`, true)}>{dsrMonths.map((name, index) => <option key={name} value={String(index + 1).padStart(2, '0')}>{name}</option>)}</select></label><label><span>Year</span><select aria-label="Actual DSR year" value={month.slice(0, 4)} onChange={event => changePeriod(`${event.target.value}-${month.slice(5, 7)}`, true)}>{dsrYears.map(year => <option key={year} value={year}>{year}</option>)}</select></label></div><small>Use the period written on the physical document. Changing it keeps the OCR values and moves every draft row to the chosen month.</small></div><label className="historical-period-ack"><input type="checkbox" checked={periodConfirmed} onChange={event => setPeriodConfirmed(event.target.checked)}/><span><b>Confirm DSR period: {month}</b><small>{periodSource === 'DOCUMENT' ? 'Nerve Intelligence suggested this month and year from the physical DSR. Correct it above if OCR was inaccurate, then confirm.' : 'This period was selected manually. Check it against the physical DSR before confirming.'}</small></span></label></div>}
    {file && rows.length > 0 && !busy && <div className="historical-draft-toolbar"><span><b>Browser draft</b><small>{draftStatus || 'Your OCR draft will save automatically in this browser. Nothing is submitted until you confirm the import.'}</small></span><div><button className="secondary small" type="button" onClick={refreshCalibratedVolumes}><RefreshCw/> Refresh calculated volumes</button><button className="secondary small" type="button" onClick={() => void attachRegister(file, { forceOcr: true })}><Sparkles/> Read source again</button><button className="secondary small danger" type="button" onClick={() => void discardDraft()}><Trash2/> Discard draft</button></div></div>}
    <div className="historical-safety"><CheckCircle2/><span><b>Historical only.</b> These rows power sales graphs and intelligence. They do not create cash, tax, customer or supplier entries.</span></div>
    {error && <div className="form-error">{error}</div>}
    {selected && rows.length === 0 && !busy && <section className="historical-grid-empty"><FileUp/><div><span className="eyebrow">No draft yet</span><h2>Attach a DSR to begin</h2><p>Nerve Intelligence will create the review grid from the source. Nothing is copied from current tank or nozzle balances.</p></div><span className="historical-empty-actions"><button className="historical-attach-action" type="button" onClick={() => fileInputRef.current?.click()}><FileUp/> Attach DSR</button><button className="secondary" type="button" onClick={addDay}><Plus/> Enter manually</button></span></section>}
    {selected && rows.length > 0 && <section className="historical-grid-card"><header><div><span className="eyebrow">Review grid</span><h2>{selected.product.code} · {month}</h2><p>{selected.tanks.length} tank{selected.tanks.length === 1 ? '' : 's'} · {selected.nozzles.length} nozzle{selected.nozzles.length === 1 ? '' : 's'}</p></div><button className="secondary small" onClick={addDay} disabled={rows.length >= daysInMonth(month)}><Plus/> Add next day</button></header>{issues.length > 0 && <div className="historical-inline-review-summary"><AlertTriangle/><span><b>{issues.length} data check{issues.length === 1 ? '' : 's'} found</b><small>Each message now appears directly beneath its affected row.</small></span></div>}<div className="historical-grid-wrap"><table className="historical-grid"><thead><tr><th>Date</th>{selected.tanks.map(tank => <th key={tank.id}>{tank.code}<small>Stock / dip</small></th>)}<th>Receipt</th><th>Total stock<small>Auto-calculated</small></th>{selected.nozzles.map((nozzle, nozzleIndex) => <th className={nozzleIndex === 0 ? 'nozzle-section-start' : ''} key={nozzle.id}>{nozzle.dispenserCode}/{nozzle.code}<small>Meter</small></th>)}<th>Testing</th><th>Sales L</th><th>RSP ₹/L</th><th>Cumulative</th><th>Gain/loss</th><th/></tr></thead><tbody>{rows.map((row, index) => { const rowMessages = reviewMessagesFor(row); return <Fragment key={row.date}><tr><td><input type="date" value={row.date} min={`${month}-01`} max={`${month}-${daysInMonth(month)}`} onChange={event => changeRow(index, next => { next.date = event.target.value; })}/></td>{selected.tanks.map(tank => { const reading = row.tankReadings.find(item => item.tankId === tank.id)!; const cell = `${row.date}:tank:${tank.id}:stock`; const calibrated = reading.calibration; return <td key={tank.id} className={calibrated && !calibrated.reviewConfirmed ? 'calibration-cell-review' : ''}><input className={uncertainCells.includes(cell) ? 'needs-review' : ''} aria-label={`${tank.code} stock ${row.date}`} type="number" min="0" step="0.01" readOnly={Boolean(calibrated)} value={uncertainCells.includes(cell) ? '' : reading.openingStock} placeholder={uncertainCells.includes(cell) ? 'Review' : '0'} onChange={event => { if (calibrated) return; changeRow(index, next => { next.tankReadings.find(item => item.tankId === tank.id)!.openingStock = Number(event.target.value); }); if (event.target.value !== '') markReviewed(cell); }}/><input aria-label={`${tank.code} dip ${row.date}`} placeholder="Dip" type="number" min="0" step="0.01" value={reading.dipReading ?? ''} onChange={event => updateDip(index, tank, event.target.value === '' ? undefined : Number(event.target.value))}/>{calibrated && <small className="calibration-note">Official chart: {calibrated.volumeLitres.toLocaleString('en-IN', { maximumFractionDigits: 2 })} L{calibrated.interpolated ? ' · interpolated' : ''}</small>}{calibrated && !calibrated.reviewConfirmed && <label className="calibration-confirm"><input type="checkbox" aria-label={`Verify ${tank.code} calibration ${row.date}`} checked={false} onChange={() => changeRow(index, next => { next.tankReadings.find(item => item.tankId === tank.id)!.calibration!.reviewConfirmed = true; })}/><span>Verified against DSR</span></label>}</td>; })}<Cell value={row.receiptQuantity} onChange={value => changeRow(index, next => { next.receiptQuantity = value; })}/><DerivedCell ariaLabel={`Total stock ${row.date}`} value={row.totalStock}/>{selected.nozzles.map((nozzle, nozzleIndex) => { const cell = `${row.date}:nozzle:${nozzle.id}`; return <Cell className={nozzleIndex === 0 ? 'nozzle-section-start' : ''} key={nozzle.id} needsReview={uncertainCells.includes(cell)} value={row.nozzleReadings.find(item => item.nozzleId === nozzle.id)!.meterReading} onChange={value => { changeRow(index, next => { next.nozzleReadings.find(item => item.nozzleId === nozzle.id)!.meterReading = value ?? 0; }); markReviewed(cell); }}/>; })}<Cell value={row.testingQuantity} onChange={value => changeRow(index, next => { next.testingQuantity = value ?? 0; })}/><Cell needsReview={uncertainCells.includes(`${row.date}:salesQuantity`)} value={row.salesQuantity} onChange={value => { changeRow(index, next => { next.salesQuantity = value ?? 0; }); markReviewed(`${row.date}:salesQuantity`); }}/><Cell value={row.sellingPrice} onChange={value => changeRow(index, next => { next.sellingPrice = value ?? 0; })}/><Cell optional value={row.cumulativeSales} onChange={value => changeRow(index, next => { next.cumulativeSales = value; })}/><Cell optional value={row.stockGainLoss} onChange={value => changeRow(index, next => { next.stockGainLoss = value; })}/><td><button aria-label={`Remove ${row.date}`} className="icon-button" onClick={() => setRows(current => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2/></button></td></tr>{rowMessages.length > 0 && <tr className="historical-row-review"><td colSpan={99}><AlertTriangle/><div><b>Review {row.date}</b>{rowMessages.map((message, messageIndex) => <p className={message.level.toLowerCase()} key={`${message.message}-${messageIndex}`}>{message.message}</p>)}</div></td></tr>}</Fragment>; })}</tbody></table></div><footer><label className="historical-cutover"><input type="checkbox" checked={applyCutover} onChange={event => setApplyCutover(event.target.checked)}/><span><b>Use the final row as the live starting position</b><small>Available only before this station has shifts, sales, stock movements or tank checks.</small></span></label><div><button className="secondary" disabled={busy || !file || !rows.length} onClick={() => void validate()}><AlertTriangle/> Check data</button><button className="primary" disabled={busy || !file || !rows.length} onClick={() => void save()}><Save/> {busy ? 'Checking…' : 'Confirm historical import'}</button></div></footer></section>}
    {imports.length > 0 && <section className="historical-import-list"><header><span className="eyebrow">Audit trail</span><h2>Imported registers</h2></header>{imports.map(item => <article key={item.id}><FileUp/><span><b>{item.product.code} · {item.monthStart.slice(0, 7)}</b><small>{item.sourceFileName} · imported by {item.importedBy.name}</small></span><a className="secondary small" href={historicalSalesSourceUrl(item.id)} target="_blank" rel="noreferrer">View source</a>{item.cutoverApplied && <em>Live cutover applied</em>}</article>)}</section>}
  </main>;
}

function Cell(props: ({ value: number; onChange(value: number): void; optional?: false } | { value: number | undefined; onChange(value: number | undefined): void; optional: true }) & { needsReview?: boolean; className?: string }) { const optional = props.optional === true; const visibleValue = props.needsReview && !(Number(props.value) > 0) ? '' : props.value ?? ''; return <td className={props.className}><input className={props.needsReview ? 'needs-review' : ''} type="number" step="0.001" value={visibleValue} placeholder={props.needsReview ? 'Review' : optional ? '—' : '0'} aria-invalid={props.needsReview || undefined} title={props.needsReview ? 'Verify this extracted value against the DSR' : undefined} onChange={event => { if (props.needsReview && event.target.value === '') return; const value = event.target.value === '' && optional ? undefined : Number(event.target.value); (props.onChange as (next: number | undefined) => void)(value); }}/></td>; }

function DerivedCell({ value, ariaLabel }: { value: number | undefined; ariaLabel: string }) { return <td className="historical-derived-cell"><input aria-label={ariaLabel} type="number" step="0.001" value={value ?? ''} placeholder="—" readOnly title="Calculated from calibrated morning stock plus receipts"/></td>; }
