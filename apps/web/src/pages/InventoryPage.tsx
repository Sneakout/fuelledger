import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Droplets, History, LockKeyhole, PackageCheck, ReceiptText, ShoppingCart } from 'lucide-react';
import { ApiRequestError, api, type InventoryBootstrap, type ReconciliationLine } from '../lib/api';

const quantity = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const signed = (value: number) => `${value > 0 ? '+' : ''}${quantity(value)}`;

export function InventoryPage() {
  const [data, setData] = useState<InventoryBootstrap | null>(null);
  const [stationId, setStationId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.inventoryBootstrap().then(result => { setData(result); setStationId(current => current || result.stations[0]?.id || ''); }).catch(error => setError(error instanceof ApiRequestError ? error.message : 'Unable to load inventory.')); }, []);
  const lines = useMemo(() => data ? [...data.tanks, ...data.untanked].filter(line => line.station?.id === stationId) : [], [data, stationId]);
  const fuelLines = lines.filter(line => Boolean(line.tank) || ['FUEL', 'DEF'].includes(line.product.category ?? ''));
  const packagedLines = lines.filter(line => !line.tank && !['FUEL', 'DEF'].includes(line.product.category ?? ''));
  const varianceCount = fuelLines.filter(line => line.tank && line.variance !== null && Math.abs(line.variance) > .001).length;
  if (!data) return <main className="page"><div className="loading"><span/><p>Preparing inventory overview…</p></div></main>;
  const stationCode = data.stations.find(station => station.id === stationId)?.code;
  const ledger = data.ledger.filter(entry => entry.station.code === stationCode);
  return <main className="page inventory-page">
    <div className="page-heading"><div><span className="eyebrow">Inventory overview</span><h1>Every product. One trusted balance.</h1><p>This page is read-only. Stock updates automatically from purchases, sales, shifts and approved corrections.</p></div><label className="station-switch"><span>Fuel station</span><select value={stationId} onChange={event => setStationId(event.target.value)}>{data.stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label></div>
    {error && <div className="form-error">{error}</div>}
    <section className="inventory-trust-banner"><div><LockKeyhole/><span><strong>No stock can be added or changed here</strong><small>Purchase invoices add stock. Sales and closed shifts reduce it. Physical dips only show differences.</small></span></div><div className="inventory-source-flow"><span><ReceiptText/> Purchases</span><b>+</b><span><ShoppingCart/> Sales & shifts</span><b>=</b><span><PackageCheck/> Current inventory</span></div></section>
    <InventorySection eyebrow="Fuel tanks" title="Fuel stock and reconciliation" description="Book stock comes from the complete stock timeline. The latest physical dip is shown only for comparison." icon={<Droplets/>} lines={fuelLines} summary={`${fuelLines.length} active tanks · ${varianceCount} ${varianceCount === 1 ? 'variance' : 'variances'} to review`} empty="No active fuel tanks are configured for this fuel station."/>
    <InventorySection eyebrow="Shop inventory" title="Lubricants and other products" description="All inventory-tracked packaged products are shown, including products with a zero balance." icon={<PackageCheck/>} lines={packagedLines} summary={`${packagedLines.length} tracked products`} empty="No packaged inventory products are configured."/>
    <section className="ledger-section"><div className="history-head"><div><span className="eyebrow">Inventory history</span><h2>Latest stock movements</h2><p>For reference only. Open Purchases, Sales or Operations to work with the source transaction.</p></div><History size={18}/></div>{ledger.map(entry => <article key={entry.id}><span className={`ledger-type ${entry.type.toLowerCase()}`}>{entry.type.replaceAll('_', ' ')}</span><div><strong>{entry.product.name}{entry.tank ? ` · ${entry.tank.code}` : ''}</strong><small>{new Date(entry.occurredAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}{entry.note ? ` · ${entry.note}` : ''}</small></div><strong className={Number(entry.quantityDelta) < 0 ? 'out' : 'in'}>{signed(Number(entry.quantityDelta))} {entry.product.unit.toLowerCase()}</strong></article>)}{!ledger.length && <p className="history-empty">No stock movements have been recorded for this fuel station.</p>}</section>
  </main>;
}

function InventorySection({ eyebrow, title, description, icon, lines, summary, empty }: { eyebrow: string; title: string; description: string; icon: ReactNode; lines: ReconciliationLine[]; summary: string; empty: string }) {
  return <section className="inventory-overview-section"><div className="reconciliation-list-head"><div className="inventory-section-title"><span className="metric-icon green">{icon}</span><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div></div><span>{summary}</span></div>{lines.map(line => <StockCard key={line.tank?.id ?? line.product.id} line={line}/>)}{!lines.length && <p className="history-empty">{empty}</p>}</section>;
}

function StockCard({ line }: { line: ReconciliationLine }) {
  const variance = line.variance;
  const isTank = Boolean(line.tank);
  return <article className="recon-card"><div className="recon-card-head"><span className="tank-mark">{isTank ? <Droplets size={18}/> : <PackageCheck size={18}/>}</span><div><strong>{line.product.name}</strong><small>{line.tank?.code ?? line.product.code} · {line.product.unit.toLowerCase()}</small></div>{isTank ? variance === null ? <span className="recon-state neutral">No recent dip</span> : <span className={Math.abs(variance) < .001 ? 'recon-state good' : 'recon-state variance'}>{Math.abs(variance) < .001 ? 'Matches dip' : 'Variance'}</span> : <span className="recon-state good">{quantity(line.bookStock)} on hand</span>}</div><div className="stock-equation"><span>Opening <b>{quantity(line.opening)}</b></span><i>+</i><span>Purchased <b>{quantity(line.receipts)}</b></span><i>−</i><span>Sold <b>{quantity(line.sales)}</b></span><i>{line.adjustments >= 0 ? '+' : '−'}</i><span>Approved corrections <b>{quantity(Math.abs(line.adjustments))}</b></span><i>=</i><strong>Current book stock <b>{quantity(line.bookStock)}</b></strong></div>{isTank && <><p>{line.readAt ? `Last physical dip: ${new Date(line.readAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · Book stock then: ${quantity(line.bookStockAtReading ?? line.bookStock)} ${line.product.unit.toLowerCase()}` : 'No physical dip has been recorded yet.'}</p><div className="physical-row"><div><span>Last physical stock {line.dipReading !== null ? `· dip ${quantity(line.dipReading)}` : ''}</span><strong>{line.physicalStock === null ? 'Not recorded' : quantity(line.physicalStock)}</strong></div><div><span>Difference at dip time</span><strong className={variance === null ? '' : Math.abs(variance) < .001 ? 'good-text' : 'variance-text'}>{variance === null ? '—' : signed(variance)}</strong></div></div></>}</article>;
}
