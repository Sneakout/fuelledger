import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileUp, LoaderCircle, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { HistoricalSalesImportInput, HistoricalSalesRowInput } from '@fuelledger/shared';
import { api, ApiRequestError, historicalSalesSourceUrl, type HistoricalImportIssue, type HistoricalSalesImportSummary, type HistoricalSalesSetup } from '../lib/api';
import { useStation } from '../components/StationProvider';

const isoDate = (month: string, day: number) => `${month}-${String(day).padStart(2, '0')}`;
const daysInMonth = (month: string) => { const [year, value] = month.split('-').map(Number); return new Date(Date.UTC(year!, value!, 0)).getUTCDate(); };
const sha256 = async (file: File) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('');
const base64 = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });

function emptyRow(date: string, setup: HistoricalSalesSetup['products'][number], previous?: HistoricalSalesRowInput): HistoricalSalesRowInput {
  return {
    date,
    tankReadings: setup.tanks.map(tank => ({ tankId: tank.id, openingStock: previous?.tankReadings.find(item => item.tankId === tank.id)?.openingStock ?? Number(tank.openingStock), dipReading: previous?.tankReadings.find(item => item.tankId === tank.id)?.dipReading })),
    receiptQuantity: 0,
    nozzleReadings: setup.nozzles.map(nozzle => ({ nozzleId: nozzle.id, meterReading: previous?.nozzleReadings.find(item => item.nozzleId === nozzle.id)?.meterReading ?? Number(nozzle.openingMeter) })),
    testingQuantity: 0, salesQuantity: 0, sellingPrice: Number(setup.product.sellingPrice),
  };
}

export function HistoricalSalesImportPage() {
  const location = useLocation();
  const routedDocument = (location.state as { intelligenceDocument?: { kind: 'DSR'; file: File; stationId?: string; productCode?: string } } | null)?.intelligenceDocument;
  const routedDocumentHandled = useRef(false);
  const documentPeriodSync = useRef(false);
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
  const selected = useMemo(() => setup?.products.find(item => item.product.id === productId), [setup, productId]);
  useEffect(() => { if (!stationId) return; let active = true; setError(''); Promise.all([api.historicalSalesSetup(stationId), api.historicalSalesImports(stationId)]).then(([next, prior]) => { if (!active) return; setSetup(next); setImports(prior.imports); setProductId(current => next.products.some(item => item.product.id === current) ? current : next.products[0]?.product.id ?? ''); }).catch(caught => active && setError(caught instanceof ApiRequestError ? caught.message : 'Unable to prepare the historical import.')); return () => { active = false; }; }, [stationId]);
  useEffect(() => { if (!stationId && stations[0]) setStationId(stations[0].id); }, [stationId, stations]);
  useEffect(() => { let active = true; void api.subscription().then(value => { if (!active) return; const expires = value.intelligenceExpiresAt ? new Date(value.intelligenceExpiresAt) : null; setIntelligenceActive(Boolean(value.intelligenceEnabledAt) && (!expires || expires > new Date())); }).catch(() => undefined); return () => { active = false; }; }, []);
  useEffect(() => { if (!selected) return; if (documentPeriodSync.current) { documentPeriodSync.current = false; return; } setRows([emptyRow(isoDate(month, 1), selected)]); setIssues([]); setPeriodConfirmed(false); }, [selected?.product.id, month]);
  useEffect(() => {
    if (!routedDocument || routedDocumentHandled.current || !setup || !intelligenceActive) return;
    if (routedDocument.stationId && stationId !== routedDocument.stationId) { setStationId(routedDocument.stationId); selectStation(routedDocument.stationId); return; }
    const routedProduct = routedDocument.productCode ? setup.products.find(item => item.product.code.toUpperCase() === routedDocument.productCode?.toUpperCase()) : undefined;
    if (routedProduct && productId !== routedProduct.product.id) { setProductId(routedProduct.product.id); return; }
    if (!productId) return;
    routedDocumentHandled.current = true;
    void attachRegister(routedDocument.file);
  }, [routedDocument, setup, intelligenceActive, stationId, productId, selectStation]);
  const changeRow = (index: number, change: (row: HistoricalSalesRowInput) => void) => setRows(previous => previous.map((row, rowIndex) => { if (rowIndex !== index) return row; const next = structuredClone(row); change(next); return next; }));
  const markReviewed = (cell: string) => setUncertainCells(previous => previous.filter(item => item !== cell));
  const addDay = () => { if (!selected || rows.length >= daysInMonth(month)) return; const previous = rows.at(-1); setRows(current => [...current, emptyRow(isoDate(month, current.length + 1), selected, previous)]); };
  async function payload(): Promise<HistoricalSalesImportInput> { if (!file) throw new Error('Attach the scanned register first.'); const extension = file.name.toLowerCase().split('.').at(-1); const mime = file.type || (extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : 'image/jpeg'); return { stationId, productId, month, sourceFileName: file.name, sourceMimeType: mime as HistoricalSalesImportInput['sourceMimeType'], sourceSize: file.size, sourceContentBase64: await base64(file), sourceFingerprint: await sha256(file), rows, applyCutover }; }
  async function attachRegister(next: File | null) {
    setExtractionWarnings([]); setLayoutIssues([]); setUncertainCells([]); setPeriodNeedsConfirmation(false); setPeriodConfirmed(false); setPeriodSource('SELECTED'); setReaderStatus(''); setError('');
    if (!next) { setFile(null); return; }
    if (next.size > 5 * 1024 * 1024) { setError('The register scan must be 5 MB or smaller.'); return; }
    setFile(next);
    if (!intelligenceActive || !stationId || !productId) return;
    setBusy(true); setReaderStatus('Nerve Intelligence is reading the DSR layout and handwriting…');
    try {
      const extension = next.name.toLowerCase().split('.').at(-1);
      const mime = next.type || (extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : 'image/jpeg');
      const result = await api.extractHistoricalSales({ stationId, productId, month, sourceFileName: next.name, sourceMimeType: mime as 'application/pdf' | 'image/jpeg' | 'image/png', sourceSize: next.size, sourceContentBase64: await base64(next) });
      if (result.effectiveMonth !== month) { documentPeriodSync.current = true; setMonth(result.effectiveMonth); }
      if (result.rows.length) setRows(result.rows);
      setExtractionWarnings(result.warnings);
      setLayoutIssues(result.layoutIssues);
      setUncertainCells(result.uncertainCells);
      setPeriodSource(result.periodSource);
      setPeriodNeedsConfirmation(true);
      setReaderStatus(result.rows.length ? `Draft ready · ${result.rows.length} day${result.rows.length === 1 ? '' : 's'} recognised · ${Math.round(result.confidence * 100)}% document confidence` : 'No reliable rows were found. You can enter the register manually.');
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'FuelNerve could not read this DSR. You can still enter the rows manually.');
      setReaderStatus('Automatic reading stopped. The attached source remains available for manual entry.');
    } finally { setBusy(false); }
  }
  async function validate() { setBusy(true); setError(''); try { const result = await api.validateHistoricalSales(await payload()); setIssues(result.issues); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to validate this register.'); } finally { setBusy(false); } }
  async function save() { if (layoutIssues.length) { setError('Correct the fuel-station equipment layout or selected period and read the DSR again before confirming.'); return; } if (periodNeedsConfirmation && !periodConfirmed) { setError('Confirm the DSR month and year before importing.'); return; } if (uncertainCells.length) { setError(`Review the ${uncertainCells.length} highlighted unreadable value${uncertainCells.length === 1 ? '' : 's'} before confirming.`); return; } setBusy(true); setError(''); try { const result = await api.createHistoricalSalesImport(await payload()); setIssues(result.issues); setImports(previous => [result.record, ...previous]); setFile(null); setApplyCutover(false); } catch (caught) { setError(caught instanceof ApiRequestError ? caught.message : caught instanceof Error ? caught.message : 'Unable to import this register.'); } finally { setBusy(false); } }
  return <main className="page historical-import-page">
    <Link className="back-link" to="/stations"><ArrowLeft/> Back to petrol pumps</Link>
    <div className="page-heading"><div><span className="eyebrow">Customer onboarding</span><h1>Import the monthly sales register</h1><p>Record MS and HSD separately. FuelNerve checks the tank, receipt and nozzle chain before adding historical trends.</p></div></div>
    <section className="historical-import-controls"><label>Fuel station<select value={stationId} onChange={event => { setStationId(event.target.value); selectStation(event.target.value); }}>{stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label><label>Product<select value={productId} onChange={event => setProductId(event.target.value)}>{setup?.products.map(item => <option key={item.product.id} value={item.product.id}>{item.product.code} · {item.product.name}</option>)}</select></label><label>Month<input type="month" value={month} onChange={event => setMonth(event.target.value)}/></label><label className="historical-file"><FileUp/><span>{file ? file.name : intelligenceActive ? 'Attach DSR — Nerve Intelligence will fill the table' : 'Attach register scan (PDF/JPG/PNG)'}</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={event => void attachRegister(event.target.files?.[0] ?? null)}/></label></section>
    {readerStatus && <div className={`historical-reader-status ${busy ? 'reading' : ''}`} aria-live="polite">{busy ? <LoaderCircle className="spin"/> : <Sparkles/>}<span><b>{busy ? 'Reading the DSR' : 'Automatic draft'}</b>{readerStatus}</span></div>}
    {extractionWarnings.length > 0 && <div className="historical-reader-warnings"><AlertTriangle/><span><b>Review before confirming</b>{extractionWarnings.map(warning => <small key={warning}>{warning}</small>)}</span></div>}
    {layoutIssues.length > 0 && <div className="form-error"><b>Equipment layout does not match this DSR.</b>{layoutIssues.map(issue => <div key={issue}>{issue}</div>)}<div>Update the fuel-station tanks and nozzles, then read the DSR again. Confirmation is blocked so no document column is silently ignored.</div></div>}
    {uncertainCells.length > 0 && <div className="historical-reader-warnings"><AlertTriangle/><span><b>{uncertainCells.length} unreadable value{uncertainCells.length === 1 ? '' : 's'} need review</b><small>FuelNerve has not assumed these readings are zero. Enter each highlighted value before confirming.</small></span></div>}
    {periodNeedsConfirmation && <label className="historical-period-confirm"><input type="checkbox" checked={periodConfirmed} onChange={event => setPeriodConfirmed(event.target.checked)}/><span><b>Confirm DSR period: {month}</b><small>{periodSource === 'DOCUMENT' ? 'Nerve Intelligence read this month and year from the physical DSR and updated the register automatically. Confirm it against the source.' : 'The Month/Year heading was missing or uncertain. Check the source and confirm the selected period.'}</small></span></label>}
    <div className="historical-safety"><CheckCircle2/><span><b>Historical only.</b> These rows power sales graphs and intelligence. They do not create cash, tax, customer or supplier entries.</span></div>
    {error && <div className="form-error">{error}</div>}
    {selected && <section className="historical-grid-card"><header><div><span className="eyebrow">Review grid</span><h2>{selected.product.code} · {month}</h2><p>{selected.tanks.length} tank{selected.tanks.length === 1 ? '' : 's'} · {selected.nozzles.length} nozzle{selected.nozzles.length === 1 ? '' : 's'}</p></div><button className="secondary small" onClick={addDay} disabled={rows.length >= daysInMonth(month)}><Plus/> Add next day</button></header><div className="historical-grid-wrap"><table className="historical-grid"><thead><tr><th>Date</th>{selected.tanks.map(tank => <th key={tank.id}>{tank.code}<small>Stock / dip</small></th>)}<th>Receipt</th><th>Total stock</th>{selected.nozzles.map(nozzle => <th key={nozzle.id}>{nozzle.dispenserCode}/{nozzle.code}<small>Meter</small></th>)}<th>Testing</th><th>Sales L</th><th>RSP ₹/L</th><th>Cumulative</th><th>Gain/loss</th><th/></tr></thead><tbody>{rows.map((row, index) => <tr key={row.date}><td><input type="date" value={row.date} min={`${month}-01`} max={`${month}-${daysInMonth(month)}`} onChange={event => changeRow(index, next => { next.date = event.target.value; })}/></td>{selected.tanks.map(tank => { const reading = row.tankReadings.find(item => item.tankId === tank.id)!; const cell = `${row.date}:tank:${tank.id}:stock`; return <td key={tank.id}><input className={uncertainCells.includes(cell) ? 'needs-review' : ''} aria-label={`${tank.code} stock ${row.date}`} type="number" min="0" step="0.01" value={uncertainCells.includes(cell) ? '' : reading.openingStock} placeholder={uncertainCells.includes(cell) ? 'Review' : '0'} onChange={event => { changeRow(index, next => { next.tankReadings.find(item => item.tankId === tank.id)!.openingStock = Number(event.target.value); }); if (event.target.value !== '') markReviewed(cell); }}/><input aria-label={`${tank.code} dip ${row.date}`} placeholder="Dip" type="number" min="0" step="0.01" value={reading.dipReading ?? ''} onChange={event => changeRow(index, next => { next.tankReadings.find(item => item.tankId === tank.id)!.dipReading = event.target.value === '' ? undefined : Number(event.target.value); })}/></td>; })}<Cell value={row.receiptQuantity} onChange={value => changeRow(index, next => { next.receiptQuantity = value; })}/><Cell optional value={row.totalStock} onChange={value => changeRow(index, next => { next.totalStock = value; })}/>{selected.nozzles.map(nozzle => { const cell = `${row.date}:nozzle:${nozzle.id}`; return <Cell key={nozzle.id} needsReview={uncertainCells.includes(cell)} value={row.nozzleReadings.find(item => item.nozzleId === nozzle.id)!.meterReading} onChange={value => { changeRow(index, next => { next.nozzleReadings.find(item => item.nozzleId === nozzle.id)!.meterReading = value ?? 0; }); markReviewed(cell); }}/>; })}<Cell value={row.testingQuantity} onChange={value => changeRow(index, next => { next.testingQuantity = value ?? 0; })}/><Cell needsReview={uncertainCells.includes(`${row.date}:salesQuantity`)} value={row.salesQuantity} onChange={value => { changeRow(index, next => { next.salesQuantity = value ?? 0; }); markReviewed(`${row.date}:salesQuantity`); }}/><Cell value={row.sellingPrice} onChange={value => changeRow(index, next => { next.sellingPrice = value ?? 0; })}/><Cell optional value={row.cumulativeSales} onChange={value => changeRow(index, next => { next.cumulativeSales = value; })}/><Cell optional value={row.stockGainLoss} onChange={value => changeRow(index, next => { next.stockGainLoss = value; })}/><td><button aria-label={`Remove ${row.date}`} className="icon-button" onClick={() => setRows(current => current.filter((_, rowIndex) => rowIndex !== index))}><Trash2/></button></td></tr>)}</tbody></table></div><footer><label className="historical-cutover"><input type="checkbox" checked={applyCutover} onChange={event => setApplyCutover(event.target.checked)}/><span><b>Use the final row as the live starting position</b><small>Available only before this station has shifts, sales, stock movements or tank checks.</small></span></label><div><button className="secondary" disabled={busy || !file || !rows.length} onClick={() => void validate()}><AlertTriangle/> Check data</button><button className="primary" disabled={busy || !file || !rows.length || layoutIssues.length > 0 || uncertainCells.length > 0} onClick={() => void save()}><Save/> {busy ? 'Checking…' : 'Confirm historical import'}</button></div></footer></section>}
    {issues.length > 0 && <section className="historical-issues"><h2>Checks to review</h2>{issues.map((issue, index) => <div key={`${issue.date}-${issue.field}-${index}`} className={issue.level.toLowerCase()}><AlertTriangle/><span><b>{issue.date}</b>{issue.message}</span></div>)}</section>}
    {imports.length > 0 && <section className="historical-import-list"><header><span className="eyebrow">Audit trail</span><h2>Imported registers</h2></header>{imports.map(item => <article key={item.id}><FileUp/><span><b>{item.product.code} · {item.monthStart.slice(0, 7)}</b><small>{item.sourceFileName} · imported by {item.importedBy.name}</small></span><a className="secondary small" href={historicalSalesSourceUrl(item.id)} target="_blank" rel="noreferrer">View source</a>{item.cutoverApplied && <em>Live cutover applied</em>}</article>)}</section>}
  </main>;
}

function Cell(props: ({ value: number; onChange(value: number): void; optional?: false } | { value: number | undefined; onChange(value: number | undefined): void; optional: true }) & { needsReview?: boolean }) { const optional = props.optional === true; return <td><input className={props.needsReview ? 'needs-review' : ''} type="number" step="0.01" value={props.needsReview ? '' : props.value ?? ''} placeholder={props.needsReview ? 'Review' : optional ? '—' : '0'} onChange={event => { if (props.needsReview && event.target.value === '') return; const value = event.target.value === '' && optional ? undefined : Number(event.target.value); (props.onChange as (next: number | undefined) => void)(value); }}/></td>; }
