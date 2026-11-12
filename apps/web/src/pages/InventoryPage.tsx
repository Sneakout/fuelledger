import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Boxes, CheckCircle2, Droplets, History, Info, PackageCheck, ReceiptText, Scale, ShoppingCart } from 'lucide-react';
import { ApiRequestError, api, type InventoryBootstrap, type ReconciliationLine } from '../lib/api';

const quantity = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const signed = (value: number) => `${value > 0 ? '+' : ''}${quantity(value)}`;
const unit = (value: string) => value.toUpperCase() === 'LITRE' ? 'L' : value.toLowerCase();
const percentage = (value: number) => `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
const money = (value: number) => value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const productOrder = (code: string) => ({ MS: 1, HSD: 2, DEF: 3 }[code] ?? 10);

type View = 'all' | 'attention' | 'fuel' | 'shop';

function checkAge(readAt: string | null) {
  if (!readAt) return { label: 'Never physically checked', stale: true };
  const hours = Math.max(0, (Date.now() - new Date(readAt).getTime()) / 3_600_000);
  if (hours < 24) return { label: hours < 1 ? 'Checked less than an hour ago' : `Checked ${Math.floor(hours)} hr ago`, stale: false };
  const days = Math.floor(hours / 24);
  return { label: `Checked ${days} day${days === 1 ? '' : 's'} ago`, stale: days >= 7 };
}

const needsReview = (line: ReconciliationLine) => Boolean(line.tank) && (line.variance === null || Math.abs(line.variance) > .001 || checkAge(line.readAt).stale);

export function InventoryPage() {
  const [data, setData] = useState<InventoryBootstrap | null>(null);
  const [stationId, setStationId] = useState('');
  const [view, setView] = useState<View>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    api.inventoryBootstrap()
      .then(result => { setData(result); setStationId(current => current || result.stations[0]?.id || ''); })
      .catch(error => setError(error instanceof ApiRequestError ? error.message : 'Unable to load inventory.'));
  }, []);

  const lines = useMemo(() => data ? [...data.tanks, ...data.untanked].filter(line => line.station?.id === stationId) : [], [data, stationId]);
  const fuelLines = lines.filter(line => Boolean(line.tank) || ['FUEL', 'DEF'].includes(line.product.category ?? '')).sort((left, right) => productOrder(left.product.code) - productOrder(right.product.code) || left.product.code.localeCompare(right.product.code) || (left.tank?.code ?? '').localeCompare(right.tank?.code ?? ''));
  const packagedLines = lines.filter(line => !line.tank && !['FUEL', 'DEF'].includes(line.product.category ?? ''));
  const attentionLines = fuelLines.filter(needsReview);
  const currentChecks = fuelLines.filter(line => line.readAt && !checkAge(line.readAt).stale && line.variance !== null).length;
  const productPosition = [...fuelLines.reduce((map, line) => {
    const current = map.get(line.product.code) ?? { code: line.product.code, name: line.product.name, stock: 0, capacity: 0, tanks: 0, value: 0, purchasePrice: line.product.purchasePrice };
    current.stock += line.bookStock;
    current.capacity += line.tank?.workingCapacity ?? 0;
    current.tanks += line.tank ? 1 : 0;
    current.value += line.bookStock * line.product.purchasePrice;
    map.set(line.product.code, current);
    return map;
  }, new Map<string, { code: string; name: string; stock: number; capacity: number; tanks: number; value: number; purchasePrice: number }>()).values()].sort((left, right) => productOrder(left.code) - productOrder(right.code) || left.code.localeCompare(right.code));

  if (!data) return <main className="page"><div className="loading"><span/><p>Preparing inventory overview…</p></div></main>;
  const stationCode = data.stations.find(station => station.id === stationId)?.code;
  const ledger = data.ledger.filter(entry => entry.station.code === stationCode);
  const visibleFuel = view === 'attention' ? attentionLines : fuelLines;
  const showFuel = view !== 'shop';
  const showShop = view === 'all' || view === 'shop';

  return <main className="page inventory-page">
    <div className="page-heading"><div><span className="eyebrow">Inventory control room</span><h1>Know what is in every tank.</h1><p>Start with the answer. Open the calculation only when you need to audit it.</p></div><label className="station-switch"><span>Fuel station</span><select value={stationId} onChange={event => setStationId(event.target.value)}>{data.stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label></div>
    {error && <div className="form-error">{error}</div>}

    <section className="inventory-product-board" aria-label="Inventory by product">
      <header><div><span className="eyebrow">Inventory by product</span><h2>Fuel quantity and stock value</h2><p>Valued at each product’s current effective purchase price.</p></div><small>Never combines unlike products into one litre total</small></header>
      <div>{productPosition.map(product => {
        const productFill = product.capacity > 0 ? product.stock / product.capacity * 100 : 0;
        return <article className={product.code.toLowerCase()} key={product.code}><div className="inventory-product-name"><b>{product.code}</b><span><strong>{product.name}</strong><small>{product.tanks} tank{product.tanks === 1 ? '' : 's'} · {percentage(productFill)} full</small></span></div><div className="inventory-product-numbers"><span><small>Available</small><strong>{quantity(product.stock)} L</strong></span><span><small>Stock value</small><strong>{money(product.value)}</strong></span></div><div className="inventory-product-bar"><i style={{ width: `${clamp(productFill)}%` }}/></div><footer><span>{quantity(product.capacity)} L safe capacity</span><span>{money(product.purchasePrice)}/L purchase price</span></footer></article>;
      })}</div>
    </section>

    <section className="inventory-control-strip"><button type="button" className={attentionLines.length ? 'attention' : 'clear'} onClick={() => setView('attention')}><AlertTriangle/><span><small>Needs attention</small><b>{attentionLines.length} tank{attentionLines.length === 1 ? '' : 's'}</b></span></button><span><CheckCircle2/><span><small>Current physical checks</small><b>{currentChecks} of {fuelLines.length}</b></span></span><span><Boxes/><span><small>Shop products</small><b>{packagedLines.length} tracked</b></span></span></section>

    <section className="inventory-guide"><Info/><div><strong>Two truths, clearly separated</strong><p><b>Book stock</b> is the live system balance. <b>Physical stock</b> is a snapshot from the last dip. Compare both only at the time that dip was taken.</p></div><div className="inventory-source-flow"><span><ReceiptText/> Purchases</span><b>−</b><span><ShoppingCart/> Sales</span><b>±</b><span><Scale/> Corrections</span><b>=</b><span><PackageCheck/> Book stock</span></div></section>

    <div className="inventory-view-tabs" role="tablist" aria-label="Inventory views">
      <button className={view === 'all' ? 'selected' : ''} onClick={() => setView('all')}>Everything</button>
      <button className={view === 'attention' ? 'selected attention' : ''} onClick={() => setView('attention')}>Needs attention <b>{attentionLines.length}</b></button>
      <button className={view === 'fuel' ? 'selected' : ''} onClick={() => setView('fuel')}>Fuel tanks</button>
      <button className={view === 'shop' ? 'selected' : ''} onClick={() => setView('shop')}>Shop products</button>
    </div>

    {showFuel && <TankInventorySection attention={view === 'attention'} lines={visibleFuel}/>}
    {showShop && <InventorySection eyebrow="Shop inventory" title="Lubricants and other products" description="Simple on-hand balances for packaged inventory." icon={<PackageCheck/>} lines={packagedLines} summary={`${packagedLines.length} tracked products`} empty="No packaged inventory products are configured."/>}

    <section className="ledger-section"><div className="history-head"><div><span className="eyebrow">Stock story</span><h2>What changed recently</h2><p>Every movement that explains the current balance, newest first.</p></div><History size={18}/></div>{ledger.map(entry => <article key={entry.id}><span className={`ledger-type ${entry.type.toLowerCase()}`}>{entry.type.replaceAll('_', ' ')}</span><div><strong>{entry.product.name}{entry.tank ? ` · ${entry.tank.code}` : ''}</strong><small>{new Date(entry.occurredAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}{entry.note ? ` · ${entry.note}` : ''}</small></div><strong className={Number(entry.quantityDelta) < 0 ? 'out' : 'in'}>{signed(Number(entry.quantityDelta))} {unit(entry.product.unit)}</strong></article>)}{!ledger.length && <p className="history-empty">No stock movements have been recorded for this fuel station.</p>}</section>
  </main>;
}

function InventorySection({ eyebrow, title, description, icon, lines, summary, empty }: { eyebrow: string; title: string; description: string; icon: ReactNode; lines: ReconciliationLine[]; summary: string; empty: string }) {
  return <section className="inventory-overview-section"><div className="reconciliation-list-head"><div className="inventory-section-title"><span className="metric-icon green">{icon}</span><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div></div><span>{summary}</span></div><div className="inventory-card-list">{lines.map(line => <StockCard key={line.tank?.id ?? line.product.id} line={line} sequence={1}/>)}</div>{!lines.length && <div className="inventory-all-clear"><CheckCircle2/><strong>{empty}</strong></div>}</section>;
}

function TankInventorySection({ lines, attention }: { lines: ReconciliationLine[]; attention: boolean }) {
  const groups = [...lines.reduce((map, line) => {
    const group = map.get(line.product.code) ?? [];
    group.push(line);
    map.set(line.product.code, group);
    return map;
  }, new Map<string, ReconciliationLine[]>()).entries()];
  return <section className="inventory-overview-section tank-bank-section"><div className="reconciliation-list-head"><div className="inventory-section-title"><span className="metric-icon green">{attention ? <AlertTriangle/> : <Droplets/>}</span><div><span className="eyebrow">{attention ? 'Action list' : 'Inventory'}</span><h2>{attention ? 'Tanks to check' : 'Fuel tanks'}</h2>{attention && <p>Missing, old, or different physical checks.</p>}</div></div><span>{lines.length} {lines.length === 1 ? 'tank' : 'tanks'}</span></div>{groups.map(([code, productLines]) => {
    const stock = productLines.reduce((sum, line) => sum + line.bookStock, 0);
    const value = productLines.reduce((sum, line) => sum + line.bookStock * line.product.purchasePrice, 0);
    return <section className="inventory-product-tank-group" key={code}><header><span className={code.toLowerCase()}>{code}</span><div><strong>{productLines[0]!.product.name}</strong><small>{productLines.length} tank{productLines.length === 1 ? '' : 's'} · {quantity(stock)} L · {money(value)} stock value</small></div></header><div>{productLines.map((line, index) => <StockCard key={line.tank?.id ?? line.product.id} line={line} sequence={index + 1}/>)}</div></section>;
  })}{!lines.length && <div className="inventory-all-clear"><CheckCircle2/><strong>{attention ? 'Everything looks current. No tank needs attention.' : 'No active fuel tanks are configured for this fuel station.'}</strong></div>}</section>;
}

function StockCard({ line, sequence }: { line: ReconciliationLine; sequence: number }) {
  const variance = line.variance;
  const isTank = Boolean(line.tank);
  const capacity = line.tank?.workingCapacity ?? 0;
  const fill = capacity > 0 ? line.bookStock / capacity * 100 : 0;
  const age = checkAge(line.readAt);
  const review = needsReview(line);
  const differenceCopy = variance === null ? 'Take a physical dip to verify the system balance.' : Math.abs(variance) < .001 ? 'The physical dip matched the system exactly.' : `${quantity(Math.abs(variance))} ${unit(line.product.unit)} ${variance < 0 ? 'less' : 'more'} than the system expected at the last check.`;

  if (!isTank) return <article className="inventory-shop-card"><span className="tank-mark"><PackageCheck size={18}/></span><div><strong>{line.product.name}</strong><small>{line.product.code} · {unit(line.product.unit)}</small></div><span><small>On hand</small><b>{quantity(line.bookStock)} {unit(line.product.unit)}</b></span><details><summary>How calculated</summary><StockEquation line={line}/></details></article>;

  const colour = ['HSD'].includes(line.product.code) ? 'hsd' : line.product.code === 'DEF' ? 'def' : 'ms';
  const stockValue = line.bookStock * line.product.purchasePrice;
  return <article className={`inventory-tank-card inventory-orb-card ${colour} ${review ? 'review' : 'clear'}`}>
    <div className="inventory-tank-visual"><div className="fuel-orb" aria-label={`${line.product.code} Tank ${sequence}: ${percentage(fill)} full`}><span className="fuel-liquid" style={{ height: `${clamp(fill)}%` }}/><span className="fuel-percent">{percentage(fill)}</span></div><small>{quantity(capacity)} L safe capacity</small></div>
    <div className="inventory-tank-intel">
      <header><div><span className="fuel-product">{line.product.code}</span><h3>{line.product.code} Tank {sequence}</h3><small>Equipment ID {line.tank?.code}</small></div><span className={`tank-health ${review ? 'review' : 'clear'}`}>{review ? <AlertTriangle/> : <CheckCircle2/>}{variance === null ? 'Dip needed' : age.stale ? 'Check is old' : Math.abs(variance) < .001 ? 'Verified' : 'Review difference'}</span></header>
      <div className="inventory-tank-kpis"><span><small>Book stock now</small><b>{quantity(line.bookStock)} {unit(line.product.unit)}</b></span><span><small>Equivalent stock value</small><b>{money(stockValue)}</b></span><span><small>Purchase price</small><b>{money(line.product.purchasePrice)}/L</b></span>{line.density !== null && <span><small>Latest density</small><b>{quantity(line.density)} kg/m³</b></span>}</div>
      <div className="inventory-check-comparison">
        <span><small>System expected at check</small><b>{line.bookStockAtReading === null || line.bookStockAtReading === undefined ? '—' : `${quantity(line.bookStockAtReading)} ${unit(line.product.unit)}`}</b></span>
        <span><small>Physical stock at check</small><b>{line.physicalStock === null ? 'Not recorded' : `${quantity(line.physicalStock)} ${unit(line.product.unit)}`}</b></span>
        <span className={variance === null ? '' : Math.abs(variance) < .001 ? 'good' : 'variance'}><small>Difference at that moment</small><b>{variance === null ? '—' : `${signed(variance)} ${unit(line.product.unit)}`}</b></span>
      </div>
      <div className="inventory-plain-language"><span className={review ? 'review' : 'clear'}>{review ? <AlertTriangle/> : <CheckCircle2/>}</span><div><strong>{differenceCopy}</strong><small>{age.label}{line.readAt ? ` · ${new Date(line.readAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</small></div></div>
      <details className="inventory-calculation"><summary>Show how the current balance was calculated</summary><StockEquation line={line}/></details>
    </div>
  </article>;
}

function StockEquation({ line }: { line: ReconciliationLine }) {
  return <div className="stock-equation"><span>Opening <b>{quantity(line.opening)}</b></span><i>+</i><span>Purchased <b>{quantity(line.receipts)}</b></span><i>−</i><span>Sold <b>{quantity(line.sales)}</b></span><i>{line.adjustments >= 0 ? '+' : '−'}</i><span>Approved corrections <b>{quantity(Math.abs(line.adjustments))}</b></span><i>=</i><strong>Book stock now <b>{quantity(line.bookStock)}</b></strong></div>;
}
