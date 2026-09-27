import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { extractTime } from './datetime';
import { fold } from './text';

// Wednesday 23 Sep 2026, 10:00 local. Friday = 25th, weekend Saturday = 26th, next Monday = 28th.
const NOW = at(2026, 9, 23, 10, 0);

const t = (text: string, now = NOW) => extractTime(fold(text), now);
const when = (text: string, now = NOW) => t(text, now)?.at ?? null;

describe('extractTime — day words', () => {
  it('finds nothing in text with no time', () => {
    expect(t('call the dentist')).toBeNull();
    expect(t('hello there')).toBeNull();
    expect(t('Ozan sends the link')).toBeNull();
  });

  it('tomorrow / yarın: date only, no clock time', () => {
    const spec = t('Call the dentist tomorrow');
    expect(spec?.at).toEqual(at(2026, 9, 24));
    expect(spec?.hasTime).toBe(false);
    expect(when('yarın')).toEqual(at(2026, 9, 24));
  });

  it('tomorrow afternoon → 15:00 (acceptance scenario 1)', () => {
    const spec = t('Tomorrow afternoon remind me to call the dentist');
    expect(spec?.at).toEqual(at(2026, 9, 24, 15, 0));
    expect(spec?.hasTime).toBe(true);
  });

  it('parts of day, English and Turkish', () => {
    expect(when('tomorrow morning')).toEqual(at(2026, 9, 24, 9));
    expect(when('yarın sabah')).toEqual(at(2026, 9, 24, 9));
    expect(when('yarın öğleden sonra')).toEqual(at(2026, 9, 24, 15));
    expect(when('yarın akşam')).toEqual(at(2026, 9, 24, 19));
    expect(when('tonight')).toEqual(at(2026, 9, 23, 20));
    expect(when('bu akşam')).toEqual(at(2026, 9, 23, 19));
    expect(when('bu gece')).toEqual(at(2026, 9, 23, 22));
    expect(when('today')).toEqual(at(2026, 9, 23));
    expect(when('bugün')).toEqual(at(2026, 9, 23));
  });

  it('day after tomorrow', () => {
    expect(when('day after tomorrow')).toEqual(at(2026, 9, 25));
    expect(when('öbür gün')).toEqual(at(2026, 9, 25));
  });
});

describe('extractTime — weekdays', () => {
  it('resolves to the next occurrence, English and Turkish', () => {
    expect(when('on Friday')).toEqual(at(2026, 9, 25));
    expect(when('cuma')).toEqual(at(2026, 9, 25));
    expect(when("cuma'ya kadar")).toEqual(at(2026, 9, 25));
    expect(when('cuma günü')).toEqual(at(2026, 9, 25));
    expect(when('pazartesi')).toEqual(at(2026, 9, 28));
    expect(when('cumartesi')).toEqual(at(2026, 9, 26));
    expect(when('next Monday')).toEqual(at(2026, 9, 28));
  });

  it('a weekday named on that weekday means next week', () => {
    expect(when('Wednesday')).toEqual(at(2026, 9, 30));
  });

  it('ignores the past ("last Friday")', () => {
    expect(t('I emailed them last Friday')).toBeNull();
  });

  it('combines a weekday with a part of day or a clock time', () => {
    expect(when('Friday afternoon')).toEqual(at(2026, 9, 25, 15));
    expect(when('cuma öğleden sonra')).toEqual(at(2026, 9, 25, 15));
    expect(when('Friday at 11')).toEqual(at(2026, 9, 25, 11));
    expect(when('cuma saat 15:30')).toEqual(at(2026, 9, 25, 15, 30));
  });
});

describe('extractTime — clock times', () => {
  it('reads explicit clock formats', () => {
    expect(when('tomorrow at 15:00')).toEqual(at(2026, 9, 24, 15));
    expect(when('tomorrow at 3pm')).toEqual(at(2026, 9, 24, 15));
    expect(when('tomorrow 9 am')).toEqual(at(2026, 9, 24, 9));
    expect(when('yarın saat 14.30')).toEqual(at(2026, 9, 24, 14, 30));
    expect(when("yarın 3'te")).toEqual(at(2026, 9, 24, 15));
    expect(when('tomorrow at 3 o’clock')).toEqual(at(2026, 9, 24, 15));
  });

  it('uses the part of day to pick am/pm', () => {
    expect(when("yarın akşam 8'de")).toEqual(at(2026, 9, 24, 20));
    expect(when("yarın sabah 9'da")).toEqual(at(2026, 9, 24, 9));
    expect(when('tomorrow evening at 7')).toEqual(at(2026, 9, 24, 19));
    expect(when('tomorrow at 8')).toEqual(at(2026, 9, 24, 8));
    expect(when('tomorrow at 2')).toEqual(at(2026, 9, 24, 14));
  });

  it('rolls a bare time that already passed to tomorrow', () => {
    expect(when('at 9')).toEqual(at(2026, 9, 24, 9));
    expect(when('at 5pm')).toEqual(at(2026, 9, 23, 17));
  });

  it('moves a passed "today" time to the next sensible slot and says so', () => {
    const spec = t('today at 8am');
    expect(spec?.adjusted).toBe(true);
    expect(spec?.at).toEqual(at(2026, 9, 23, 11));
  });

  it('does not read nonsense as a time', () => {
    expect(t('at 45')).toBeNull();
  });
});

describe('extractTime — dates and offsets', () => {
  it('month-name dates in both languages', () => {
    expect(when('October 15th')).toEqual(at(2026, 10, 15));
    expect(when('15 October')).toEqual(at(2026, 10, 15));
    expect(when("15 Ekim'e kadar")).toEqual(at(2026, 10, 15));
    expect(when('5 Mart')).toEqual(at(2027, 3, 5)); // already past this year
    expect(when('5 March 2028')).toEqual(at(2028, 3, 5));
  });

  it('numeric dates are day/month', () => {
    expect(when('15.10.2026')).toEqual(at(2026, 10, 15));
    expect(when('12/10')).toEqual(at(2026, 10, 12));
    expect(when('10/15')).toEqual(at(2026, 10, 15)); // 15 can only be a day
  });

  it('relative offsets', () => {
    expect(when('in 2 days')).toEqual(at(2026, 9, 25));
    expect(when('3 gün sonra')).toEqual(at(2026, 9, 26));
    expect(when('in a week')).toEqual(at(2026, 9, 30));
    expect(when('bir hafta sonra')).toEqual(at(2026, 9, 30));
    expect(when('in 15 minutes')).toEqual(at(2026, 9, 23, 10, 15));
    expect(when('2 saat sonra')).toEqual(at(2026, 9, 23, 12, 0));
    expect(t('in 15 minutes')?.hasTime).toBe(true);
    expect(t('in 2 days')?.hasTime).toBe(false);
  });

  it('end of month', () => {
    expect(when('by the end of the month')).toEqual(at(2026, 9, 30));
    expect(when('ay sonuna kadar')).toEqual(at(2026, 9, 30));
  });
});

describe('extractTime — milestones', () => {
  it.each([
    ['after payday', 'payday'],
    ['maaştan sonra', 'payday'],
    ['maaş yatınca', 'payday'],
    ['when I get paid', 'payday'],
    ['this week', 'this_week'],
    ['bu hafta', 'this_week'],
    ['next week', 'next_week'],
    ['haftaya', 'next_week'],
    ['next month', 'next_month'],
    ['gelecek ay', 'next_month'],
    ['this weekend', 'weekend'],
    ['hafta sonu', 'weekend'],
    ['later today', 'later'],
  ])('"%s" is the %s milestone, with no absolute date', (text, milestone) => {
    const spec = t(text);
    expect(spec?.milestone).toBe(milestone);
    expect(spec?.at).toBeNull();
    expect(spec?.label).toBeTruthy();
  });

  it('a concrete day beats a milestone', () => {
    const spec = t('this week, on Friday');
    expect(spec?.at).toEqual(at(2026, 9, 25));
    expect(spec?.milestone).toBeNull();
  });
});

describe('extractTime — numeric dates and DateOrder', () => {
  const atOrder = (text: string, dateOrder: 'dmy' | 'mdy') => extractTime(fold(text), NOW, { dateOrder })?.at ?? null;

  it('slash dates follow the requested order', () => {
    expect(atOrder('12/10', 'dmy')).toEqual(at(2026, 10, 12));
    expect(atOrder('12/10', 'mdy')).toEqual(at(2026, 12, 10));
    expect(atOrder('12/10/2027', 'dmy')).toEqual(at(2027, 10, 12));
    expect(atOrder('12/10/2027', 'mdy')).toEqual(at(2027, 12, 10));
  });

  it('a number above 12 fixes the reading in either order', () => {
    expect(atOrder('25/12', 'mdy')).toEqual(at(2026, 12, 25));
    expect(atOrder('10/25', 'dmy')).toEqual(at(2026, 10, 25));
  });

  it('dotted dates are always day.month.year; ISO is year-month-day', () => {
    expect(atOrder('12.10.2026', 'mdy')).toEqual(at(2026, 10, 12));
    expect(atOrder('2026-10-12', 'mdy')).toEqual(at(2026, 10, 12));
  });

  it('defaults to day-first', () => {
    expect(extractTime(fold('12/10'), NOW)?.at).toEqual(at(2026, 10, 12));
  });
});

describe('extractTime — spans', () => {
  it('reports the ranges to strip from a title, prepositions included', () => {
    const text = 'call the dentist on Friday afternoon';
    const spec = t(text);
    const removed = spec!.spans.map((s) => text.slice(s.start, s.end));
    expect(removed.join(' ')).toContain('Friday');
    expect(removed.join(' ')).toContain('afternoon');
    expect(removed.some((r) => r.startsWith('on '))).toBe(true);
  });
});
