import { Link } from 'react-router-dom';
import type { OperationalStock, TankObservation, TankStockTimeline } from '../lib/api';
import './tank-observation.css';

export function observationDate(observation: TankObservation) {
  const date = new Date(`${observation.date}T12:00:00+05:30`).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
  return observation.precision === 'MORNING' ? `${date} · morning` : new Date(observation.observedAt!).toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}) + ' IST';
}
export function TankObservationNote({ observation, bookStock, timeline, operationalStock }: { operationalStock?: OperationalStock | null | undefined; observation: TankObservation; bookStock: number; timeline?: TankStockTimeline | null | undefined }) {
  return <div className="tank-observation-note">
    <span className="tank-observation-source">{observation.sourceLabel} · {observationDate(observation)}</span>
    <strong>Last measured: {observation.volume.toLocaleString('en-IN',{maximumFractionDigits:2})} L</strong>
    <p>This is the last measured quantity, not a live dip.</p>
    {operationalStock && <section aria-label="Stock since latest measurement">
      <strong>{operationalStock.incomplete ? 'Available before unrecorded sales' : 'Estimate from latest dip'}: {operationalStock.quantity.toLocaleString('en-IN',{maximumFractionDigits:2})} L</strong>
      <p>{operationalStock.opening.toLocaleString('en-IN')} L measured + {operationalStock.receipts.toLocaleString('en-IN')} L received − {operationalStock.sales.toLocaleString('en-IN')} L recorded sales ± {operationalStock.adjustments.toLocaleString('en-IN')} L adjustments.</p>
      {operationalStock.incomplete && <p>Consumption is not fully recorded. This figure is not a confirmed closing balance. Add the next morning readings or record a new physical dip.</p>}
      {operationalStock.issues.length > 0 && <details><summary>Checks for this estimate</summary><ul>{operationalStock.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></details>}
    </section>}
    <div><span>Cumulative book balance <strong>{bookStock.toLocaleString('en-IN', {maximumFractionDigits:2})} L</strong></span><Link to={observation.sourcePath}>View source →</Link></div>
    {timeline && <details><summary>How the cumulative book balance was calculated</summary><p>Verified opening on {timeline.anchorDate}: {timeline.opening?.toLocaleString('en-IN')} L + receipts {timeline.receipts?.toLocaleString('en-IN')} L − sales {timeline.sales?.toLocaleString('en-IN')} L ± adjustments {timeline.adjustments?.toLocaleString('en-IN')} L. Daily DSR totals include matching live entries once.</p></details>}
    {timeline?.issues.length ? <div role="status" className="tank-stock-review"><strong>Stock history needs review</strong><details><summary>{timeline.issues.length} checks to review</summary><ul>{timeline.issues.map(issue=><li key={issue}>{issue}</li>)}</ul></details></div> : null}
    {observation.timingNote && <small>{observation.timingNote}</small>}
    {observation.precision === 'MORNING' && <small>The DSR records a morning date, without an exact time. A same-time book difference cannot be verified.</small>}
  </div>;
}
