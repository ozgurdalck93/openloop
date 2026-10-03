/**
 * Time-expression extraction for English and Turkish, over FOLDED text
 * (lowercase ASCII, see text.ts). Resolves to absolute local dates against a
 * caller-supplied `now`, and reports which character ranges it consumed so the
 * title cleaner can drop them.
 *
 * This module only says WHEN THE USER SAID; deciding what to suggest when they
 * said nothing (or something vague) is the engine's followUpPolicy.
 */
import { nextSlot } from '@/engine/followUpPolicy';
import { MILESTONE_LABEL, type Milestone } from '@/engine/types';
import type { DateOrder } from '@/utils/locale';
import {
  addBusinessDays,
  addDays,
  addMinutes,
  atTime,
  daysInMonth,
  isSameDay,
  nextWeekday,
  startOfDay,
} from '@/utils/time';

import type { Span } from './text';

export interface TimeSpec {
  /** Resolved moment. Null for a pure milestone ("after payday"). */
  at: Date | null;
  /** True when the user gave a clock time or a part of day (not just a date). */
  hasTime: boolean;
  milestone: Milestone | null;
  /** Wording to show instead of a raw date when `at` is null. */
  label: string | null;
  /** Ranges of the input this expression occupies, prepositions included. */
  spans: Span[];
  /** The moment had already passed today and was moved to the next sensible slot. */
  adjusted: boolean;
}

type Part = 'morning' | 'noon' | 'afternoon' | 'evening' | 'tonight' | 'night' | 'eod' | 'lunch';

interface Clock {
  hour: number;
  minute: number;
  meridian: 'am' | 'pm' | null;
}

const PART_HOUR: Record<Part, [number, number]> = {
  morning: [9, 0],
  noon: [12, 0],
  lunch: [12, 30],
  afternoon: [15, 0],
  evening: [19, 0],
  tonight: [20, 0],
  night: [22, 0],
  eod: [17, 0],
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thurs: 4, thur: 4,
  thu: 4, friday: 5, fri: 5, saturday: 6,
  pazar: 0, pazartesi: 1, sali: 2, carsamba: 3, persembe: 4, cuma: 5, cumartesi: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5,
  july: 6, jul: 6, august: 7, aug: 7, september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10,
  nov: 10, december: 11, dec: 11,
  ocak: 0, subat: 1, mart: 2, nisan: 3, mayis: 4, haziran: 5, temmuz: 6, agustos: 7, eylul: 8, ekim: 9,
  kasim: 10, aralik: 11,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  'a couple of': 2, 'couple of': 2,
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
};

const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_EN_ALT = 'monday|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sunday';
const WEEKDAY_TR_ALT = 'pazartesi|sali|carsamba|persembe|cumartesi|cuma|pazar';
const PREP = '(?:(?:on|by|before|until|till|for|due)\\s+)?';
const TR_CASE = "(?:'?(?:ya|ye|a|e|da|de|ta|te|dan|den|in|nin|yi|i|ki))?";

const RE = {
  laterToday:
    /\b(?:later today|later this (?:morning|afternoon|evening)|bugun (?:ilerleyen saatlerde|daha sonra)|ilerleyen saatlerde|birazdan|az sonra|in a bit|shortly|in a while)\b/,
  dateDM: new RegExp(
    `\\b${PREP}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})(?:'(?:ta|te|da|de|a|e|dan|den|in|ye|ya))?(?:\\s+(\\d{4}))?(?:\\s+kadar)?\\b`,
  ),
  dateMD: new RegExp(`\\b${PREP}(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`),
  dateIso: /\b(\d{4})-(\d{2})-(\d{2})\b/,
  // Dots are the European/Turkish way to write a date: always day.month.year.
  dateDotted: /\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})\b/,
  // Slashes are where locales disagree ("12/10"): the caller's DateOrder decides.
  dateSlash3: /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/,
  dateSlash2: /\b(\d{1,2})\/(\d{1,2})\b(?!\/)/,
  relEn:
    /\b(?:in|after|within)\s+(\d+|a couple of|couple of|an|a|one|two|three|four|five|six|seven|eight|nine|ten)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/,
  relEnLater:
    /\b(\d+|an|a|one|two|three|four|five)\s*(days?|weeks?|months?|hours?)\s+(?:from now|later)\b/,
  relTr: /\b(\d+|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)\s*(dakika|dk|saat|gun|hafta|ay)\s+(?:sonra|icinde)\b/,
  halfHour: /\b(?:in half an hour|yarim saat (?:sonra|icinde))\b/,
  dayOfMonth: /\b(?:(?:on|by|before|until|till|for)\s+(?:the\s+)?|the\s+)(\d{1,2})(?:st|nd|rd|th)\b/,
  businessDays:
    /\b(?:(?:in|after|within)\s+)?(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:business|working)\s+days?\b|\b(\d+)\s*is gunu(?:\s+(?:sonra|icinde))?\b/,
  dayAfterTomorrow: /\b(?:(?:for|by|before|until|till|on)\s+)?(?:day after tomorrow|obur gun|yarindan sonra|ertesi gun)\b/,
  tomorrow: /\b(?:(?:for|by|before|until|till|on)\s+)?(?:tomorrow|tmrw|tmr|yarin)\b/,
  today: /\b(?:(?:for|by|before|until|till|on)\s+)?(?:today|bugun|bu gun)\b/,
  tonight: /\b(?:(?:for|by|before|until|till|on)\s+)?(?:tonight|bu aksam|bu gece)\b/,
  weekdayEn: new RegExp(`\\b(?:(?:on|by|before|until|till|this|next|coming|last|for)\\s+)?(${WEEKDAY_EN_ALT})\\b(?:'s)?`, 'g'),
  weekdayTr: new RegExp(
    `\\b(?:(?:onumuzdeki|gelecek|bu)\\s+)?(${WEEKDAY_TR_ALT})${TR_CASE}\\b(?:\\s+gunu)?(?:\\s+kadar)?`,
  ),
  weekendNext: /\b(?:next weekend|gelecek hafta ?sonu\w*|onumuzdeki hafta ?sonu\w*)\b/,
  thisWeek:
    /\b(?:this week|(?:by |before )?(?:the )?end of (?:the |this )?week|bu hafta\w*|hafta ici|hafta sonuna kadar)\b/,
  weekend: /\b(?:(?:this|the|over the|on the)\s+)?weekend\b|\bhafta ?sonu\w*/,
  nextWeek: /\b(?:next week|gelecek hafta|onumuzdeki hafta|haftaya)\b/,
  endOfMonth: /\b(?:(?:by )?(?:the )?end of (?:the |this )?month|ay sonu\w*)(?:\s+kadar)?\b/,
  nextMonth:
    /\b(?:next month|gelecek ay\w*|onumuzdeki ay\w*|ay basi\w*|beginning of (?:the )?(?:next )?month)\b/,
  payday:
    /\b(?:(?:after|before|on|around)\s+)?pay ?day\b|\b(?:after|when) (?:i (?:get|am|'m) )?paid\b|\bmaas\w*\s+(?:sonra|yatinca|yatar\w*|alinca|gelince|gunu)\b|\bmaastan sonra\b/,
  hhmm: /\b(?:(?:at|around|about|by|@|until|before|saat)\s*)?(\d{1,2}):(\d{2})\s*(am|pm)?(?:\s*'?(?:te|ta|de|da)|'?(?:e|a))?(?![a-z])/,
  hDot: /\b(?:at|@|saat|around|about|by|before|until)\s*(\d{1,2})\.(\d{2})\s*(am|pm)?(?:\s*'?(?:te|ta|de|da)|'?(?:e|a))?(?![a-z])(?![./]\d)/,
  // "14.00 te" / "9.30'da" without a leading word: only with a Turkish time suffix, so "12.10" stays a date.
  hDotSuffix: /\b(\d{1,2})\.(\d{2})\s*'?(?:te|ta|de|da)(?![a-z])/,
  hAmPm: /\b(?:(?:at|around|about|by|@|until|before)\s*)?(\d{1,2})\s*(am|pm)\b/,
  hOclock: /\b(?:(?:at|around|about|by|@|until|before)\s*)?(\d{1,2})\s*o'?clock\b/,
  hSaat: /\bsaat\s*(\d{1,2})(?!\d)(?!\s*[:.]\d)(?:'?(?:te|ta|de|da)(?![a-z])|'(?:e|a)(?![a-z]))?/,
  hTrSuffix: /\b(\d{1,2})'?(?:te|ta|de|da)(?![a-z0-9])/,
  hAt: /\b(?:at|around|about|by|@|until|before)\s*(\d{1,2})\b(?!\s*[:.]\d)/,
  partEn:
    /\b(?:(this|in the|on the|by|by the|early|late)\s+)?(tonight|morning|afternoon|evening|night|noon|midday|lunchtime|lunch time|eod|end of (?:the )?day)\b/,
  partTr: /\b(bu\s+)?(ogleden sonra|oglen|ogle|sabah|aksam|gece|gun sonu)\w*/,
};

/** Blanks matched text as it is consumed so later patterns cannot claim it twice. */
class Scanner {
  spans: Span[] = [];
  constructor(public work: string) {}

  /** First match of a non-global pattern, without consuming it. */
  peek(re: RegExp): RegExpExecArray | null {
    return re.exec(this.work);
  }

  take(re: RegExp): RegExpExecArray | null {
    const m = this.peek(re);
    if (m) this.consume(m.index, m.index + m[0].length);
    return m;
  }

  consume(start: number, end: number): void {
    this.spans.push({ start, end });
    this.work = this.work.slice(0, start) + ' '.repeat(end - start) + this.work.slice(end);
  }
}

const partFromWord = (word: string): Part => {
  if (word.startsWith('tonight')) return 'tonight';
  if (word.startsWith('morning') || word.startsWith('sabah')) return 'morning';
  if (word.startsWith('afternoon') || word.startsWith('ogleden')) return 'afternoon';
  if (word.startsWith('evening') || word.startsWith('aksam')) return 'evening';
  if (word.startsWith('night') || word.startsWith('gece')) return 'night';
  if (word.startsWith('lunch')) return 'lunch';
  if (word.startsWith('eod') || word.startsWith('end of') || word.startsWith('gun sonu')) return 'eod';
  return 'noon'; // noon, midday, ogle, oglen
};

const toNumber = (word: string): number => (/^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word] ?? 1));

function resolveHour(h: number, part: Part | null, meridian: 'am' | 'pm' | null): { hour: number; nextDay: boolean } {
  if (meridian === 'pm') return { hour: h < 12 ? h + 12 : h, nextDay: false };
  if (meridian === 'am') return { hour: h === 12 ? 0 : h, nextDay: false };
  if (part === 'afternoon' || part === 'evening' || part === 'tonight') return { hour: h >= 1 && h < 12 ? h + 12 : h, nextDay: false };
  if (part === 'night') {
    if (h === 12) return { hour: 0, nextDay: true };
    return { hour: h >= 6 && h < 12 ? h + 12 : h, nextDay: false };
  }
  if (part === 'morning' || part === 'noon' || part === 'lunch') return { hour: h, nextDay: false };
  return { hour: h >= 1 && h <= 6 ? h + 12 : h, nextDay: false }; // "at 3" → 15:00; "at 8" → 08:00
}

/** "the 15th": the next such day of the month, today included. */
function resolveDayOfMonth(day: number, now: Date): Date | null {
  if (day < 1 || day > 31) return null;
  for (let offset = 0; offset < 3; offset += 1) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    if (day > daysInMonth(monthStart.getFullYear(), monthStart.getMonth())) continue;
    const candidate = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    if (candidate.getTime() >= startOfDay(now).getTime()) return candidate;
  }
  return null;
}

function resolveDate(day: number, month: number, year: number | null, now: Date): Date | null {
  if (month < 0 || month > 11 || day < 1) return null;
  const y = year ?? now.getFullYear();
  if (day > daysInMonth(y, month)) return null;
  const candidate = new Date(y, month, day);
  if (year === null && candidate.getTime() < startOfDay(now).getTime()) return new Date(y + 1, month, day);
  return candidate;
}

/**
 * Two numbers from "12/10" → [day, month]. A number above 12 cannot be a month,
 * so that reading is unambiguous whatever the locale prefers.
 */
function dayAndMonth(first: number, second: number, order: DateOrder): [number, number] {
  const [day, month] = order === 'dmy' ? [first, second] : [second, first];
  return month > 12 && day <= 12 ? [month, day] : [day, month];
}

const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));

export interface ExtractOptions {
  /** How to read "12/10". Default day-first. The parser passes the device locale's order. */
  dateOrder?: DateOrder;
}

/** Returns null when the text mentions no time at all. `folded` must come from `fold()`. */
export function extractTime(folded: string, now: Date, options: ExtractOptions = {}): TimeSpec | null {
  const order = options.dateOrder ?? 'dmy';
  const sc = new Scanner(folded);
  let day: Date | null = null;
  let exactAt: Date | null = null;
  let part: Part | null = null;
  let partImpliesToday = false;
  let milestone: Milestone | null = null;

  // "later today" is a vague milestone, matched before anything that could split it up.
  if (sc.take(RE.laterToday)) milestone = 'later';

  // ---- dates ----------------------------------------------------------------
  let m: RegExpExecArray | null;
  if ((m = sc.take(RE.dateDM))) day = resolveDate(Number(m[1]), MONTHS[m[2]], m[3] ? Number(m[3]) : null, now);
  else if ((m = sc.take(RE.dateMD))) day = resolveDate(Number(m[2]), MONTHS[m[1]], m[3] ? Number(m[3]) : null, now);
  else if ((m = sc.take(RE.dateIso))) day = resolveDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]), now);
  else if ((m = sc.take(RE.dateDotted))) {
    const [d, mo] = dayAndMonth(Number(m[1]), Number(m[2]), 'dmy');
    day = resolveDate(d, mo - 1, fullYear(m[3]), now);
  } else if ((m = sc.take(RE.dateSlash3))) {
    const [d, mo] = dayAndMonth(Number(m[1]), Number(m[2]), order);
    day = resolveDate(d, mo - 1, fullYear(m[3]), now);
  } else if ((m = sc.take(RE.dateSlash2))) {
    const [d, mo] = dayAndMonth(Number(m[1]), Number(m[2]), order);
    day = resolveDate(d, mo - 1, null, now);
  } else if ((m = sc.take(RE.dayOfMonth))) {
    day = resolveDayOfMonth(Number(m[1]), now);
  }

  // ---- relative offsets -------------------------------------------------------
  if (!day) {
    if ((m = sc.take(RE.businessDays))) day = addBusinessDays(startOfDay(now), toNumber(m[1] ?? m[2]));
    else if (sc.take(RE.halfHour)) exactAt = addMinutes(now, 30);
    else if ((m = sc.take(RE.relEn) ?? sc.take(RE.relEnLater) ?? sc.take(RE.relTr))) {
      const n = toNumber(m[1]);
      const unit = m[2];
      if (/^(?:min|dakika|dk)/.test(unit)) exactAt = addMinutes(now, n);
      else if (/^(?:hour|hr|saat)/.test(unit)) exactAt = addMinutes(now, n * 60);
      else if (/^(?:day|gun)/.test(unit)) day = addDays(startOfDay(now), n);
      else if (/^(?:week|hafta)/.test(unit)) day = addDays(startOfDay(now), n * 7);
      else day = new Date(now.getFullYear(), now.getMonth() + n, now.getDate());
    }
  }

  // ---- day words --------------------------------------------------------------
  if (!day && !exactAt) {
    if (sc.take(RE.dayAfterTomorrow)) day = addDays(startOfDay(now), 2);
    else if (sc.take(RE.tomorrow)) day = addDays(startOfDay(now), 1);
    else if ((m = sc.take(RE.tonight))) {
      day = startOfDay(now);
      part = m[0].includes('gece') ? 'night' : m[0].includes('aksam') ? 'evening' : 'tonight';
    } else if (sc.take(RE.today)) day = startOfDay(now);
  }

  // ---- weekdays (skipping "last Friday", which is the past) --------------------
  if (!day && !exactAt) {
    for (const wm of [...sc.work.matchAll(RE.weekdayEn)]) {
      if (/^last\b/.test(wm[0])) continue;
      sc.consume(wm.index, wm.index + wm[0].length);
      day = nextWeekday(now, WEEKDAYS[wm[1]]);
      break;
    }
    if (!day && (m = sc.take(RE.weekdayTr))) day = nextWeekday(now, WEEKDAYS[m[1]]);
  }

  // ---- milestones (a concrete day always wins over these) ----------------------
  if (!day && !exactAt) {
    if (sc.take(RE.weekendNext)) {
      day = addDays(nextWeekday(now, 6), now.getDay() === 6 ? 0 : 7);
    } else if (sc.take(RE.thisWeek)) milestone = 'this_week';
    else if (sc.take(RE.nextWeek)) milestone = 'next_week';
    else if (sc.take(RE.endOfMonth)) day = new Date(now.getFullYear(), now.getMonth(), daysInMonth(now.getFullYear(), now.getMonth()));
    else if (sc.take(RE.nextMonth)) milestone = 'next_month';
    else if (sc.take(RE.payday)) milestone = 'payday';
    else if (sc.take(RE.weekend)) milestone = 'weekend';
  }

  // ---- clock times --------------------------------------------------------------
  // Each pattern names which capture groups hold minutes / am-pm (0 = none). `??`
  // stops at the first pattern that matches, so later ones never consume text.
  const parseClock = (re: RegExp, minuteGroup: number, meridianGroup: number): Clock | null => {
    const c = sc.peek(re);
    if (!c) return null;
    const h = Number(c[1]);
    const mi = minuteGroup && c[minuteGroup] !== undefined ? Number(c[minuteGroup]) : 0;
    if (h > 23 || mi > 59) return null; // "at 45" is not a time; leave the digits alone
    sc.consume(c.index, c.index + c[0].length);
    const marker = meridianGroup ? c[meridianGroup] : undefined;
    return { hour: h, minute: mi, meridian: marker === 'am' || marker === 'pm' ? marker : null };
  };
  const clock: Clock | null = exactAt
    ? null
    : (parseClock(RE.hhmm, 2, 3) ??
      parseClock(RE.hDot, 2, 3) ??
      parseClock(RE.hDotSuffix, 2, 0) ??
      parseClock(RE.hAmPm, 0, 2) ??
      parseClock(RE.hSaat, 0, 0) ??
      parseClock(RE.hOclock, 0, 0) ??
      parseClock(RE.hTrSuffix, 0, 0) ??
      parseClock(RE.hAt, 0, 0));
  const hour = clock?.hour ?? null;
  const minute = clock?.minute ?? 0;
  const meridian = clock?.meridian ?? null;

  // ---- part of day ---------------------------------------------------------------
  if (!exactAt && part === null) {
    const pm = sc.take(RE.partEn) ?? sc.take(RE.partTr);
    if (pm) {
      part = partFromWord(pm[2]);
      partImpliesToday = pm[1] !== undefined && /^(?:this|bu)\b/.test(pm[1]);
    }
  }

  if (sc.spans.length === 0) return null;

  // ---- compose -----------------------------------------------------------------------
  let at: Date | null = null;
  let hasTime = false;
  let adjusted = false;

  if (exactAt) {
    at = exactAt;
    hasTime = true;
  } else if (day || hour !== null || part) {
    let base = day ?? startOfDay(now);
    if (hour !== null || part) {
      let h: number;
      let mi = minute;
      if (hour !== null) {
        const r = resolveHour(hour, part, meridian);
        h = r.hour;
        if (r.nextDay) base = addDays(base, 1);
      } else {
        [h, mi] = PART_HOUR[part as Part];
      }
      at = atTime(base, h, mi);
      hasTime = true;
      const dayIsToday = day ? isSameDay(day, now) : partImpliesToday;
      if (at.getTime() <= now.getTime()) {
        if (day && !dayIsToday) {
          // a past date the user named explicitly — leave as given
        } else if (dayIsToday) {
          at = nextSlot(now);
          adjusted = true;
        } else {
          at = addDays(at, 1); // "at 9" said at 10pm means tomorrow
        }
      }
    } else if (day) {
      at = startOfDay(day);
    }
  }

  // A concrete date or time is what the user said; a milestone next to it is just colour.
  const finalMilestone = at ? null : milestone;
  const label = finalMilestone ? MILESTONE_LABEL[finalMilestone] : null;

  return { at, hasTime, milestone: finalMilestone, label, spans: sc.spans, adjusted };
}
