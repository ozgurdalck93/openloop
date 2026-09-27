import { describe, expect, it } from 'vitest';

import { at, makeLoop } from '../../test/fixtures';
import { LOOP_TYPES } from '@/engine/types';
import { CATEGORY_ACTIONS, CATEGORY_IDS, categoryKeyFor } from './categories';
import { planNotification } from './plan';

const NOW = at(2026, 9, 23, 10, 0);
const iso = (d: Date) => d.toISOString();
const future = iso(at(2026, 9, 24, 15));

describe('categories match the master prompt', () => {
  const titles = (key: keyof typeof CATEGORY_ACTIONS) => CATEGORY_ACTIONS[key].map((a) => a.title);

  it('TASK: Done, 15 min later, Later today', () => {
    expect(titles('task')).toEqual(['Done', '15 min later', 'Later today']);
  });
  it('PROMISE: Fulfilled, 15 min later, Later today (a promise is closed, not asked "does this end here?")', () => {
    expect(titles('promise')).toEqual(['Fulfilled', '15 min later', 'Later today']);
  });
  it('WAITING: Still waiting, Got a reply, Follow up', () => {
    expect(titles('waiting')).toEqual(['Still waiting', 'Got a reply', 'Follow up']);
  });
  it('RETURN_LATER: Keep for later, Act now, Resolve', () => {
    expect(titles('return_later')).toEqual(['Keep for later', 'Act now', 'Resolve']);
  });
  it('EVENT: View, Later', () => {
    expect(titles('event')).toEqual(['View', 'Later']);
  });

  it('identifiers are unique, and so are action ids within a category', () => {
    expect(new Set(Object.values(CATEGORY_IDS)).size).toBe(5);
    for (const actions of Object.values(CATEGORY_ACTIONS)) {
      expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
    }
  });

  it('actions that need a screen open the app; quick ones do not', () => {
    const byId = Object.fromEntries(Object.values(CATEGORY_ACTIONS).flat().map((a) => [a.id, a.opensApp]));
    expect(byId.done).toBe(true); // completing a task asks "Does this end here?"
    expect(byId.follow_up).toBe(true);
    expect(byId.still_waiting).toBe(false);
    expect(byId.snooze_15_min).toBe(false);
  });

  it('every loop type maps to a category except reference', () => {
    expect(categoryKeyFor('reference')).toBeNull();
    expect(categoryKeyFor('promise')).toBe('promise');
    for (const type of LOOP_TYPES.filter((t) => t !== 'reference')) expect(categoryKeyFor(type)).not.toBeNull();
  });
});

describe('planNotification', () => {
  it('plans a reminder at the review time with copy and a category', () => {
    const plan = planNotification(makeLoop({ type: 'task', title: 'Call dentist', nextReviewAt: future }), NOW);
    expect(plan).toMatchObject({
      fireAt: at(2026, 9, 24, 15),
      title: 'Call dentist',
      body: 'You wanted to do this this afternoon.',
      categoryKey: 'task',
      categoryIdentifier: 'openloop.task',
      data: { loopId: 'loop-1' },
    });
  });

  it('uses the right category per type', () => {
    const key = (type: Parameters<typeof makeLoop>[0] & object) => planNotification(makeLoop({ nextReviewAt: future, ...type }), NOW)?.categoryKey;
    expect(key({ type: 'waiting', status: 'waiting' })).toBe('waiting');
    expect(key({ type: 'promise' })).toBe('promise');
    expect(key({ type: 'return_later', status: 'scheduled' })).toBe('return_later');
    expect(key({ type: 'event', status: 'scheduled' })).toBe('event');
  });

  it('REFERENCE has no notification by default, even if it somehow carries a date', () => {
    expect(planNotification(makeLoop({ type: 'reference', nextReviewAt: future }), NOW)).toBeNull();
  });

  it('no reminder for closed or draft loops, missing times, or times already behind us', () => {
    expect(planNotification(makeLoop({ status: 'resolved', nextReviewAt: future }), NOW)).toBeNull();
    expect(planNotification(makeLoop({ status: 'archived', nextReviewAt: future }), NOW)).toBeNull();
    expect(planNotification(makeLoop({ status: 'draft', nextReviewAt: future }), NOW)).toBeNull();
    expect(planNotification(makeLoop({ nextReviewAt: null }), NOW)).toBeNull();
    expect(planNotification(makeLoop({ nextReviewAt: iso(at(2026, 9, 23, 9)) }), NOW)).toBeNull();
    expect(planNotification(makeLoop({ nextReviewAt: iso(NOW) }), NOW)).toBeNull();
    expect(planNotification(makeLoop({ nextReviewAt: 'not a date' }), NOW)).toBeNull();
  });

  it('a waiting loop with a pending follow-up has no review time, so no reminder', () => {
    expect(planNotification(makeLoop({ type: 'waiting', status: 'active', nextReviewAt: null }), NOW)).toBeNull();
  });
});
