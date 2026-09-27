import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { formatDateLabel } from './format';
import { nudgeWhen, seedWhen } from './whenEdit';

describe('nudgeWhen', () => {
  const when = at(2026, 9, 23, 10, 30);

  it('days carry across months and years', () => {
    expect(nudgeWhen(when, 'day', 1)).toEqual(at(2026, 9, 24, 10, 30));
    expect(nudgeWhen(at(2026, 9, 30, 9, 0), 'day', 1)).toEqual(at(2026, 10, 1, 9, 0));
    expect(nudgeWhen(at(2026, 12, 31, 9, 0), 'day', 1)).toEqual(at(2027, 1, 1, 9, 0));
    expect(nudgeWhen(when, 'day', -1)).toEqual(at(2026, 9, 22, 10, 30));
  });

  it('hours step by one and wrap within the day without changing the date', () => {
    expect(nudgeWhen(when, 'hour', 1)).toEqual(at(2026, 9, 23, 11, 30));
    expect(nudgeWhen(when, 'hour', -1)).toEqual(at(2026, 9, 23, 9, 30));
    expect(nudgeWhen(at(2026, 9, 23, 23, 30), 'hour', 1)).toEqual(at(2026, 9, 23, 0, 30));
    expect(nudgeWhen(at(2026, 9, 23, 0, 30), 'hour', -1)).toEqual(at(2026, 9, 23, 23, 30));
  });

  it('minutes step by a quarter hour and wrap within the hour', () => {
    expect(nudgeWhen(when, 'minute', 1)).toEqual(at(2026, 9, 23, 10, 45));
    expect(nudgeWhen(when, 'minute', -1)).toEqual(at(2026, 9, 23, 10, 15));
    expect(nudgeWhen(at(2026, 9, 23, 10, 45), 'minute', 1)).toEqual(at(2026, 9, 23, 10, 0));
    expect(nudgeWhen(at(2026, 9, 23, 10, 0), 'minute', -1)).toEqual(at(2026, 9, 23, 10, 45));
  });

  it('minutes snap to the quarter hour first (a parsed 15:07 becomes 15:15, then 15:30)', () => {
    expect(nudgeWhen(at(2026, 9, 23, 15, 7), 'minute', 1)).toEqual(at(2026, 9, 23, 15, 15));
    expect(nudgeWhen(at(2026, 9, 23, 15, 53), 'minute', -1)).toEqual(at(2026, 9, 23, 15, 45));
  });

  it('a full lap of any stepper returns to the start', () => {
    let w = when;
    for (let i = 0; i < 24; i += 1) w = nudgeWhen(w, 'hour', 1);
    expect(w).toEqual(when);
    w = when;
    for (let i = 0; i < 4; i += 1) w = nudgeWhen(w, 'minute', 1);
    expect(w).toEqual(when);
  });
});

describe('seedWhen', () => {
  it('starts from the next reasonable slot, in the future', () => {
    expect(seedWhen(at(2026, 9, 23, 10, 0))).toEqual(at(2026, 9, 23, 11, 0));
    expect(seedWhen(at(2026, 9, 23, 21, 0))).toEqual(at(2026, 9, 24, 9, 0));
  });
});

describe('formatDateLabel', () => {
  const now = at(2026, 9, 23, 10, 0);
  it('says Today / Tomorrow, then a short date; adds the year when it differs', () => {
    expect(formatDateLabel(at(2026, 9, 23, 18), now)).toBe('Today');
    expect(formatDateLabel(at(2026, 9, 24, 9), now)).toBe('Tomorrow');
    expect(formatDateLabel(at(2026, 9, 25, 9), now)).toBe('Fri 25 Sep');
    expect(formatDateLabel(at(2026, 10, 15, 9), now)).toBe('Thu 15 Oct');
    expect(formatDateLabel(at(2027, 1, 4, 9), now)).toBe('Mon 4 Jan 2027');
  });
});
