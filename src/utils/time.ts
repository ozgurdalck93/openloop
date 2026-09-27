/**
 * Date helpers. Everything is LOCAL time (the user's calendar), and only
 * serialised to UTC ISO strings at the storage boundary.
 */

export const MS_MINUTE = 60_000;
export const MS_HOUR = 60 * MS_MINUTE;
export const MS_DAY = 24 * MS_HOUR;

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_MINUTE);
}

export function addHours(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_HOUR);
}

/** Calendar-day arithmetic (keeps the wall-clock time across DST changes). */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Same calendar day as `d`, at hour:minute local time. */
export function atTime(d: Date, hour: number, minute = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function diffCalendarDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_DAY);
}

/** Adds `n` business days (Mon–Fri), keeping the time of day. */
export function addBusinessDays(d: Date, n: number): Date {
  let r = new Date(d);
  let left = n;
  while (left > 0) {
    r = addDays(r, 1);
    if (!isWeekend(r)) left -= 1;
  }
  return r;
}

/** First Mon–Fri day strictly after `d`. */
export function nextBusinessDay(d: Date): Date {
  return addBusinessDays(d, 1);
}

/**
 * The next occurrence of `weekday` (0 = Sunday … 6 = Saturday) strictly AFTER
 * today, at 00:00. "Friday" said on a Friday means next Friday.
 */
export function nextWeekday(from: Date, weekday: number): Date {
  const today = startOfDay(from);
  let diff = (weekday - today.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(today, diff);
}

export function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

/** Rounds up to the next full hour (an exact hour is kept). */
export function roundUpToHour(d: Date): Date {
  const r = new Date(d);
  if (r.getMinutes() > 0 || r.getSeconds() > 0 || r.getMilliseconds() > 0) {
    r.setHours(r.getHours() + 1, 0, 0, 0);
  }
  return r;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function toIso(d: Date): string {
  return d.toISOString();
}
