import { Link } from 'react-router-dom';
import type { TankObservation } from '../lib/api';
import './tank-observation.css';

export function observationDate(observation: TankObservation) {
  const date = new Date(`${observation.date}T12:00:00+05:30`).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
  return observation.precision === 'MORNING' ? `${date} · morning` : new Date(observation.observedAt!).toLocaleString('en-IN', {dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}) + ' IST';
}
export function TankObservationNote({ observation, bookStock }: { observation: TankObservation; bookStock: number }) {
  return <div className="tank-observation-note">
    <span className="tank-observation-source">{observation.sourceLabel} · {observationDate(observation)}</span>
    <p>This is the last measured quantity, not a live dip. Later receipts and sales are tracked separately.</p>
    <div><span>Book stock now <strong>{bookStock.toLocaleString('en-IN', {maximumFractionDigits:2})} L</strong></span><Link to={observation.sourcePath}>View source →</Link></div>
    {observation.timingNote && <small>{observation.timingNote}</small>}
    {observation.precision === 'MORNING' && <small>The DSR records a morning date, without an exact time. A same-time book difference cannot be verified.</small>}
  </div>;
}
