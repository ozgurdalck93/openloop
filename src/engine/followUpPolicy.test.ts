import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import {
  classifyWaitingKind,
  defaultWaitingReview,
  isDue,
  laterSlot,
  nextReviewAfterStillWaiting,
  nextSlot,
  reviewForMilestone,
  softFollowUpAt,
  suggestEventReview,
  suggestPromiseReview,
  suggestReturnLaterReview,
  suggestTaskReview,
  suggestWaitingReview,
  type TimingInput,
} from './followUpPolicy';

// Wednesday 23 Sep 2026, 10:00. Fri 25th, Sat 26th, Mon 28th.
const NOW = at(2026, 9, 23, 10, 0);
const NONE: TimingInput = { at: null, hasTime: false, milestone: null };
const dateOnly = (d: Date): TimingInput => ({ at: d, hasTime: false, milestone: null });
const exact = (d: Date): TimingInput => ({ at: d, hasTime: true, milestone: null });
const milestone = (m: TimingInput['milestone'], label: string | null = null): TimingInput => ({
  at: null,
  hasTime: false,
  milestone: m,
  label,
});

describe('slots', () => {
  it('nextSlot: at least an hour out, inside waking hours', () => {
    expect(nextSlot(NOW)).toEqual(at(2026, 9, 23, 11));
    expect(nextSlot(at(2026, 9, 23, 10, 20))).toEqual(at(2026, 9, 23, 12));
    expect(nextSlot(at(2026, 9, 23, 6, 15))).toEqual(at(2026, 9, 23, 9)); // too early → 09:00
    expect(nextSlot(at(2026, 9, 23, 19, 30))).toEqual(at(2026, 9, 24, 9)); // would be 21:00 → tomorrow
    expect(nextSlot(at(2026, 9, 23, 23, 50))).toEqual(at(2026, 9, 24, 9));
  });

  it('laterSlot: ~3h out today, else tomorrow 10:00', () => {
    expect(laterSlot(NOW)).toEqual(at(2026, 9, 23, 13));
    expect(laterSlot(at(2026, 9, 23, 15))).toEqual(at(2026, 9, 23, 18));
    expect(laterSlot(at(2026, 9, 23, 17, 30))).toEqual(at(2026, 9, 24, 10));
  });
});

describe('reviewForMilestone', () => {
  it('payday is a plain guess — just after the coming month boundary — not a configured day', () => {
    expect(reviewForMilestone(NOW, 'payday')).toEqual(at(2026, 10, 2, 10));
    expect(reviewForMilestone(at(2026, 12, 20, 10), 'payday')).toEqual(at(2027, 1, 2, 10)); // December rolls over
    expect(reviewForMilestone(at(2026, 10, 1, 8), 'payday')).toEqual(at(2026, 11, 2, 10)); // already the 1st: the NEXT boundary
  });

  it('a guessed payday is trusted less than other milestones, so Review flags it', () => {
    const payday = suggestReturnLaterReview(NOW, milestone('payday', 'After payday'));
    const weekend = suggestReturnLaterReview(NOW, milestone('weekend', 'This weekend'));
    expect(payday.confidence).toBeLessThan(0.5);
    expect(payday.confidence).toBeLessThan(weekend.confidence);
    expect(payday.label).toBe('After payday');
  });

  it('weekend: Saturday 10:00; on Saturday, Sunday', () => {
    expect(reviewForMilestone(NOW, 'weekend')).toEqual(at(2026, 9, 26, 10));
    expect(reviewForMilestone(at(2026, 9, 26, 9), 'weekend')).toEqual(at(2026, 9, 27, 10));
    expect(reviewForMilestone(at(2026, 9, 27, 9), 'weekend')).toEqual(at(2026, 10, 3, 10));
  });

  it('this week: Friday 11:00; late on Friday → next business day; on a weekend → next Friday', () => {
    expect(reviewForMilestone(NOW, 'this_week')).toEqual(at(2026, 9, 25, 11));
    expect(reviewForMilestone(at(2026, 9, 25, 9), 'this_week')).toEqual(at(2026, 9, 25, 11));
    expect(reviewForMilestone(at(2026, 9, 25, 10, 30), 'this_week')).toEqual(at(2026, 9, 28, 10));
    expect(reviewForMilestone(at(2026, 9, 26, 9), 'this_week')).toEqual(at(2026, 10, 2, 11));
  });

  it('next week → Monday 09:00; next month → the 1st, 09:00; later → a later slot', () => {
    expect(reviewForMilestone(NOW, 'next_week')).toEqual(at(2026, 9, 28, 9));
    expect(reviewForMilestone(NOW, 'next_month')).toEqual(at(2026, 10, 1, 9));
    expect(reviewForMilestone(NOW, 'later')).toEqual(at(2026, 9, 23, 13));
  });
});

describe('TASK: exact user time when available, otherwise a suggested time of day', () => {
  it('an exact time is used as given', () => {
    const s = suggestTaskReview(NOW, exact(at(2026, 9, 24, 15)));
    expect(s).toMatchObject({ at: at(2026, 9, 24, 15), policy: 'exact_time' });
    expect(s.confidence).toBeGreaterThan(0.9);
  });

  it('a date alone gets a time of day from context', () => {
    const day = at(2026, 9, 24);
    expect(suggestTaskReview(NOW, dateOnly(day), 'call').at).toEqual(at(2026, 9, 24, 10));
    expect(suggestTaskReview(NOW, dateOnly(day), 'errand').at).toEqual(at(2026, 9, 24, 17));
    expect(suggestTaskReview(NOW, dateOnly(day), 'generic').at).toEqual(at(2026, 9, 24, 9));
    expect(suggestTaskReview(NOW, dateOnly(day)).policy).toBe('context_time');
  });

  it('never suggests a moment that has already passed', () => {
    const today = suggestTaskReview(NOW, dateOnly(at(2026, 9, 23)), 'generic'); // 09:00 is behind us
    expect(today.at).toEqual(at(2026, 9, 23, 11));
    expect(today.confidence).toBeLessThanOrEqual(0.5);
  });

  it('a milestone is resolved; nothing at all falls back to the next slot', () => {
    expect(suggestTaskReview(NOW, milestone('payday', 'After payday')).at).toEqual(at(2026, 10, 2, 10));
    expect(suggestTaskReview(NOW, milestone('payday', 'After payday')).label).toBe('After payday');
    const bare = suggestTaskReview(NOW, NONE);
    expect(bare.at).toEqual(at(2026, 9, 23, 11));
    expect(bare.confidence).toBeLessThan(0.5);
  });
});

describe('WAITING: 1–2 business days for work, ~48h casual, 3–5 for refund/admin; explicit dates win', () => {
  it('work reply → 2 business days at 10:00', () => {
    expect(defaultWaitingReview(NOW, 'work')).toMatchObject({ at: at(2026, 9, 25, 10), policy: 'reply_work' });
    expect(defaultWaitingReview(at(2026, 9, 24, 10), 'work').at).toEqual(at(2026, 9, 28, 10)); // skips the weekend
  });

  it('admin → 4 business days; skips weekends', () => {
    expect(defaultWaitingReview(NOW, 'admin')).toMatchObject({ at: at(2026, 9, 29, 10), policy: 'admin_wait' });
    expect(defaultWaitingReview(at(2026, 9, 25, 10), 'admin').at).toEqual(at(2026, 10, 1, 10));
  });

  it('casual → ~48h, kept inside waking hours', () => {
    expect(defaultWaitingReview(NOW, 'casual')).toMatchObject({ at: at(2026, 9, 25, 10), policy: 'reply_casual' });
    expect(defaultWaitingReview(at(2026, 9, 23, 22, 30), 'casual').at).toEqual(at(2026, 9, 26, 9));
    expect(defaultWaitingReview(at(2026, 9, 23, 6, 0), 'casual').at).toEqual(at(2026, 9, 25, 9));
  });

  it('an explicit date beats every default interval', () => {
    const friday = suggestWaitingReview(NOW, dateOnly(at(2026, 9, 25)), 'admin');
    expect(friday).toMatchObject({ at: at(2026, 9, 25, 11), policy: 'expected_date' });
    const precise = suggestWaitingReview(NOW, exact(at(2026, 9, 24, 14, 30)), 'work');
    expect(precise.at).toEqual(at(2026, 9, 24, 14, 30));
  });

  it('"this week" → Friday 11:00; "next week" → the end of next week', () => {
    expect(suggestWaitingReview(NOW, milestone('this_week', 'This week'), 'work')).toMatchObject({
      at: at(2026, 9, 25, 11),
      policy: 'expected_date',
      label: 'This week',
    });
    expect(suggestWaitingReview(NOW, milestone('next_week'), 'work').at).toEqual(at(2026, 10, 2, 11));
  });

  it('no timing → the default interval for the kind', () => {
    expect(suggestWaitingReview(NOW, NONE, 'work').policy).toBe('reply_work');
    expect(suggestWaitingReview(NOW, NONE, 'casual').policy).toBe('reply_casual');
  });

  it('classifies who we are waiting on', () => {
    expect(classifyWaitingKind({ foldedText: 'the refund has not arrived', entity: 'Zara' })).toBe('admin');
    expect(classifyWaitingKind({ foldedText: 'i emailed hr', entity: 'HR' })).toBe('work');
    expect(classifyWaitingKind({ foldedText: 'ayse said she would send the file', entity: 'Ayşe' })).toBe('casual');
    expect(classifyWaitingKind({ foldedText: 'kargo hala gelmedi' })).toBe('admin');
  });

  it('the English word "is" does not make everything a work email (regression)', () => {
    expect(classifyWaitingKind({ foldedText: 'she is going to send it' })).toBe('casual');
  });
});

describe('EVENT, PROMISE, RETURN_LATER', () => {
  it('event: at the expected time; a date alone → 09:00; no date → nothing to schedule', () => {
    expect(suggestEventReview(NOW, exact(at(2026, 9, 25, 15, 30)))).toMatchObject({ at: at(2026, 9, 25, 15, 30), policy: 'at_event' });
    expect(suggestEventReview(NOW, dateOnly(at(2026, 9, 25))).at).toEqual(at(2026, 9, 25, 9));
    expect(suggestEventReview(NOW, NONE)).toMatchObject({ at: null, policy: 'at_event', confidence: 0 });
  });

  it('promise: remind before it risks being late (the morning of a due day)', () => {
    expect(suggestPromiseReview(NOW, dateOnly(at(2026, 9, 25))).at).toEqual(at(2026, 9, 25, 9));
    expect(suggestPromiseReview(NOW, exact(at(2026, 9, 23, 20))).at).toEqual(at(2026, 9, 23, 20));
    expect(suggestPromiseReview(NOW, NONE).policy).toBe('before_due');
  });

  it('return-later: contextual milestone when possible, else a vague "later"', () => {
    expect(suggestReturnLaterReview(NOW, milestone('payday', 'After payday'))).toMatchObject({
      at: at(2026, 10, 2, 10),
      policy: 'milestone',
      label: 'After payday',
    });
    expect(suggestReturnLaterReview(NOW, NONE)).toMatchObject({ at: at(2026, 9, 23, 13), policy: 'later_default' });
    expect(suggestReturnLaterReview(NOW, dateOnly(at(2026, 10, 15))).at).toEqual(at(2026, 10, 15, 10));
  });
});

describe('after "Still waiting"', () => {
  it('asks again after the interval the loop was created with', () => {
    expect(nextReviewAfterStillWaiting({ followUpPolicy: 'reply_casual' }, NOW).at).toEqual(at(2026, 9, 25, 10));
    expect(nextReviewAfterStillWaiting({ followUpPolicy: 'admin_wait' }, NOW).at).toEqual(at(2026, 9, 29, 10));
    expect(nextReviewAfterStillWaiting({ followUpPolicy: 'reply_work' }, NOW).at).toEqual(at(2026, 9, 25, 10));
  });

  it('an expected date that has passed gets the work interval and keeps its policy', () => {
    const s = nextReviewAfterStillWaiting({ followUpPolicy: 'expected_date' }, NOW);
    expect(s.at).toEqual(at(2026, 9, 25, 10));
    expect(s.policy).toBe('expected_date');
    expect(nextReviewAfterStillWaiting({ followUpPolicy: null }, NOW).policy).toBe('reply_work');
  });
});

describe('soft follow-up and due-ness', () => {
  it('one soft follow-up lands tomorrow morning', () => {
    expect(softFollowUpAt(at(2026, 9, 23, 21))).toEqual(at(2026, 9, 24, 10));
  });

  it('isDue: open loops whose review time has arrived', () => {
    const iso = (d: Date) => d.toISOString();
    expect(isDue({ status: 'active', nextReviewAt: iso(at(2026, 9, 23, 9)) }, NOW)).toBe(true);
    expect(isDue({ status: 'active', nextReviewAt: iso(NOW) }, NOW)).toBe(true);
    expect(isDue({ status: 'active', nextReviewAt: iso(at(2026, 9, 23, 11)) }, NOW)).toBe(false);
    expect(isDue({ status: 'active', nextReviewAt: null }, NOW)).toBe(false);
    expect(isDue({ status: 'resolved', nextReviewAt: iso(at(2026, 9, 23, 9)) }, NOW)).toBe(false);
    expect(isDue({ status: 'archived', nextReviewAt: iso(at(2026, 9, 23, 9)) }, NOW)).toBe(false);
  });
});
