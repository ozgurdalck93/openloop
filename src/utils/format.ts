import { strings, type UiLang } from '@/i18n';

import { diffCalendarDays } from './time';

export function weekdayName(d: Date, lang: UiLang = 'en'): string {
  return strings(lang).format.weekdaysLong[d.getDay()];
}

export function formatClock(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** "Today · 15:00", "Tomorrow · 09:00", "Friday · 11:00", "12 Oct · 09:00". No Intl dependency. */
export function formatWhen(when: Date, now: Date, lang: UiLang = 'en'): string {
  const f = strings(lang).format;
  const days = diffCalendarDays(now, when);
  let day: string;
  if (days === 0) day = f.today;
  else if (days === 1) day = f.tomorrow;
  else if (days > 1 && days < 7) day = weekdayName(when, lang);
  else if (days === -1) day = f.yesterday;
  else {
    day = `${when.getDate()} ${f.months[when.getMonth()]}`;
    if (when.getFullYear() !== now.getFullYear()) day += ` ${when.getFullYear()}`;
  }
  return `${day} · ${formatClock(when)}`;
}

/** "Today", "Tomorrow", "Fri 25 Sep" (year added when it is not this year). */
export function formatDateLabel(when: Date, now: Date, lang: UiLang = 'en'): string {
  const f = strings(lang).format;
  const days = diffCalendarDays(now, when);
  if (days === 0) return f.today;
  if (days === 1) return f.tomorrow;
  const label = `${f.weekdaysShort[when.getDay()]} ${when.getDate()} ${f.months[when.getMonth()]}`;
  return when.getFullYear() === now.getFullYear() ? label : `${label} ${when.getFullYear()}`;
}

/** "this morning" / "this afternoon" / "this evening" — used in notification copy. */
export function partOfDayPhrase(d: Date, lang: UiLang = 'en'): string {
  const p = strings(lang).format.partOfDay;
  const h = d.getHours();
  if (h < 12) return p.morning;
  if (h < 17) return p.afternoon;
  return p.evening;
}

/** Calm, blame-free age text: "since this morning", "for 2 days". */
export function waitingAge(since: Date, now: Date, lang: UiLang = 'en'): string {
  const f = strings(lang).format;
  const days = diffCalendarDays(since, now);
  if (days <= 0) return f.sinceEarlierToday;
  if (days === 1) return f.sinceYesterday;
  return f.forDays(days);
}
