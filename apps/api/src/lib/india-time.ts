export const INDIA_TIME_ZONE = 'Asia/Kolkata';
const INDIA_OFFSET = '+05:30';
const DAY_MS = 86_400_000;

function parts(date: Date) {
  const values = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(values.find(part => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour') };
}

export function indiaParts(date = new Date()) { return parts(date); }

export function indiaDate(date = new Date()) {
  const value = parts(date);
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

export function addIndiaDays(value: string, days: number) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('INVALID_BUSINESS_DATE');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function indiaDayRange(value: string) {
  const start = new Date(`${value}T00:00:00${INDIA_OFFSET}`);
  if (Number.isNaN(start.getTime()) || indiaDate(start) !== value) throw new Error('INVALID_BUSINESS_DATE');
  return { start, endExclusive: new Date(start.getTime() + DAY_MS) };
}

export function indiaDayStart(date = new Date()) { return indiaDayRange(indiaDate(date)).start; }

export function indiaMonthStart(date = new Date()) {
  return indiaDayRange(`${indiaDate(date).slice(0, 7)}-01`).start;
}

/** Canonical value for Prisma fields backed by PostgreSQL DATE. */
export function databaseDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }
