import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { createWorldFactory } from '../../test/harness';
import { saveQuietHours } from './quietHoursStore';
import { applyQuietHours, DEFAULT_QUIET_HOURS, parseQuietHours, type QuietHours } from './quietHours';

const night: QuietHours = { enabled: true, startHour: 22, endHour: 8 };

describe('applyQuietHours', () => {
  it('leaves everything alone when quiet hours are off', () => {
    const t = at(2026, 9, 24, 23, 30);
    expect(applyQuietHours(t, { ...night, enabled: false })).toEqual(t);
  });

  it('leaves daytime reminders alone', () => {
    const t = at(2026, 9, 24, 15, 0);
    expect(applyQuietHours(t, night)).toEqual(t);
  });

  it('moves an evening reminder to the next morning when the window crosses midnight', () => {
    expect(applyQuietHours(at(2026, 9, 24, 23, 30), night)).toEqual(at(2026, 9, 25, 8, 0));
    expect(applyQuietHours(at(2026, 9, 24, 22, 0), night)).toEqual(at(2026, 9, 25, 8, 0));
  });

  it('moves an after-midnight reminder to the same morning', () => {
    expect(applyQuietHours(at(2026, 9, 25, 3, 15), night)).toEqual(at(2026, 9, 25, 8, 0));
  });

  it('the window end itself is not quiet', () => {
    const t = at(2026, 9, 25, 8, 0);
    expect(applyQuietHours(t, night)).toEqual(t);
  });

  it('works for a same-day window (13 → 15)', () => {
    const lunch: QuietHours = { enabled: true, startHour: 13, endHour: 15 };
    expect(applyQuietHours(at(2026, 9, 24, 14, 0), lunch)).toEqual(at(2026, 9, 24, 15, 0));
    expect(applyQuietHours(at(2026, 9, 24, 15, 0), lunch)).toEqual(at(2026, 9, 24, 15, 0));
  });

  it('equal start and end means no window', () => {
    const t = at(2026, 9, 24, 23, 0);
    expect(applyQuietHours(t, { enabled: true, startHour: 9, endHour: 9 })).toEqual(t);
  });
});

describe('parseQuietHours', () => {
  it('falls back to the default for missing or broken values', () => {
    expect(parseQuietHours(null)).toEqual(DEFAULT_QUIET_HOURS);
    expect(parseQuietHours('not json')).toEqual(DEFAULT_QUIET_HOURS);
    expect(parseQuietHours(JSON.stringify({ enabled: true, startHour: 99, endHour: -1 }))).toEqual({ enabled: true, startHour: 22, endHour: 8 });
  });
});

describe('scheduler — quiet hours', () => {
  const world = createWorldFactory();

  it('delays only the OS reminder, not the loop’s own review time', async () => {
    const w = world();
    await w.ready;
    await saveQuietHours(w.db, { enabled: true, startHour: 13, endHour: 17 });
    await w.keepText('Tomorrow afternoon remind me to call the dentist');
    const dentist = await w.byTitle('Call dentist');
    const [, request] = w.fake.forLoop(dentist.id)[0];
    expect(new Date(dentist.nextReviewAt as string)).toEqual(at(2026, 9, 24, 15, 0)); // unchanged
    expect(request.fireAt).toEqual(at(2026, 9, 24, 17, 0)); // held back to the end of the window
  });

  it('resyncAll applies a newly saved window to reminders that already exist', async () => {
    const w = world();
    await w.keepText('Tomorrow afternoon remind me to call the dentist');
    const dentist = await w.byTitle('Call dentist');
    expect(w.fake.forLoop(dentist.id)[0][1].fireAt).toEqual(at(2026, 9, 24, 15, 0));
    await saveQuietHours(w.db, { enabled: true, startHour: 13, endHour: 17 });
    await w.scheduler.resyncAll(w.clock.now);
    expect(w.fake.forLoop(dentist.id)).toHaveLength(1);
    expect(w.fake.forLoop(dentist.id)[0][1].fireAt).toEqual(at(2026, 9, 24, 17, 0));
  });
});
