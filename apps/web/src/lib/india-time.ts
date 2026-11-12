export const INDIA_TIME_ZONE = 'Asia/Kolkata';

const indiaDateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: INDIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function indiaDate(value: Date | string | number = new Date()) {
  const parts = Object.fromEntries(indiaDateParts.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function indiaMonthStart(value: Date | string | number = new Date()) {
  return `${indiaDate(value).slice(0, 7)}-01`;
}

export function addIndiaDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function indiaDateTimeLocal(value: Date | string | number = new Date()) {
  const fields = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => fields.find(field => field.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function indiaCalendarDateIso(value: string) {
  return new Date(`${value}T00:00:00+05:30`).toISOString();
}

export function formatIndiaDateTime(value: Date | string | number) {
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: INDIA_TIME_ZONE });
}

export function formatIndiaDate(value: Date | string | number, options: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleDateString('en-IN', { ...options, timeZone: INDIA_TIME_ZONE });
}

export function formatIndiaCalendarDate(value: string, options: Intl.DateTimeFormatOptions) {
  return formatIndiaDate(`${value}T00:00:00+05:30`, options);
}
