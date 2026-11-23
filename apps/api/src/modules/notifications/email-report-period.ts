import { addIndiaDays, indiaDate, indiaDayRange } from '../../lib/india-time.js';

/** A short, explicitly dated recovery window; never replay customer debt reports. */
export const DAILY_EMAIL_RECOVERY_DAYS = 3;
export function dailyEmailDateEligible(date: string, now: Date) {
  try { indiaDayRange(date); } catch { return false; }
  return date >= addIndiaDays(indiaDate(now), -DAILY_EMAIL_RECOVERY_DAYS) && date <= indiaDate(now);
}
