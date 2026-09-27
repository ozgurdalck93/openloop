import { describe, expect, it } from 'vitest';

import { at, makeLoop } from '../../test/fixtures';
import { LOOP_EVENT_TYPES, LOOP_TYPES, type Loop } from './types';
import { PROMPTS, availableActions, keepForLaterAt, waitingDefaultsFor, resurfaceCopy, snoozeOptions, softFollowUpCopy, timelineLabel } from './suggestions';

const NOW = at(2026, 9, 23, 10, 0);
const iso = (d: Date) => d.toISOString();

describe('snoozeOptions', () => {
  it('offers soonest-first choices with clear labels', () => {
    const options = snoozeOptions(NOW);
    expect(options.map((o) => o.key)).toEqual(['in_15_min', 'later_today', 'tomorrow_morning', 'this_weekend', 'next_week']);
    expect(options[0]).toMatchObject({ label: 'In 15 minutes', at: at(2026, 9, 23, 10, 15) });
    expect(options[1]).toMatchObject({ label: 'Later today · 13:00', at: at(2026, 9, 23, 13) });
    expect(options[2].at).toEqual(at(2026, 9, 24, 9));
    expect(options[3].at).toEqual(at(2026, 9, 26, 10));
    expect(options[4].at).toEqual(at(2026, 9, 28, 9));
  });

  it('every option is in the future and they are strictly increasing', () => {
    for (const now of [NOW, at(2026, 9, 26, 9), at(2026, 9, 27, 23), at(2026, 9, 25, 18)]) {
      const times = snoozeOptions(now).map((o) => o.at.getTime());
      expect(times.every((t) => t > now.getTime())).toBe(true);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(new Set(times).size).toBe(times.length);
    }
  });

  it('late in the evening there is no "later today" (it would just be tomorrow)', () => {
    const keys = snoozeOptions(at(2026, 9, 23, 21, 0)).map((o) => o.key);
    expect(keys).not.toContain('later_today');
    expect(keys).toContain('tomorrow_morning');
  });
});

describe('availableActions — exactly the buttons the product specifies, per type', () => {
  const main = (loop: Loop) => availableActions(loop).filter((a) => a.group === 'main').map((a) => a.label);
  const ids = (loop: Loop) => availableActions(loop).map((a) => a.id);

  it('TASK: Done · 15 min later · Later today · Edit', () => {
    const task = makeLoop({ type: 'task' });
    expect(main(task)).toEqual(['Done', '15 min later', 'Later today']);
    expect(ids(task)).toContain('edit');
  });

  it('WAITING: Still waiting · Got a reply · Follow up · Remind me later', () => {
    expect(main(makeLoop({ type: 'waiting', status: 'waiting' }))).toEqual([
      'Still waiting',
      'Got a reply',
      'Follow up',
      'Remind me later',
    ]);
  });

  it('RETURN_LATER: Act now · Bring back later · Resolve', () => {
    expect(main(makeLoop({ type: 'return_later', status: 'scheduled' }))).toEqual(['Act now', 'Bring back later', 'Resolve']);
  });

  it('EVENT: View · Done · Later', () => {
    expect(main(makeLoop({ type: 'event', status: 'scheduled' }))).toEqual(['View', 'Done', 'Later']);
  });

  it('PROMISE: Fulfilled · Remind me later', () => {
    expect(main(makeLoop({ type: 'promise' }))).toEqual(['Fulfilled', 'Remind me later']);
  });

  it('a waiting loop with an open follow-up does not offer to follow up (or wait) twice', () => {
    const waiting = makeLoop({ type: 'waiting', status: 'active' });
    expect(ids(waiting)).not.toContain('follow_up');
    expect(ids(waiting)).not.toContain('still_waiting');
    expect(ids(waiting)).toContain('got_reply');
  });

  it('every open loop can be edited and set aside; references offer only those', () => {
    for (const type of LOOP_TYPES) {
      const actions = ids(makeLoop({ type, status: 'active' }));
      expect(actions).toContain('edit');
      expect(actions).toContain('dismiss');
    }
    expect(ids(makeLoop({ type: 'reference' }))).toEqual(['edit', 'dismiss']);
  });

  it('closed and draft loops offer nothing', () => {
    expect(availableActions(makeLoop({ status: 'resolved' }))).toEqual([]);
    expect(availableActions(makeLoop({ status: 'archived' }))).toEqual([]);
    expect(availableActions(makeLoop({ status: 'draft' }))).toEqual([]);
  });

  it('"keep for later" from a notification waits until next week, so it never nags', () => {
    expect(keepForLaterAt(NOW)).toEqual(at(2026, 9, 28, 9));
  });
});

describe('resurfaceCopy — the notification words from 03_OPENLOOP_UX_FLOW.md', () => {
  it('TASK: the title, plus when they wanted to do it', () => {
    const loop = makeLoop({ type: 'task', title: 'Call the dentist', nextReviewAt: iso(at(2026, 9, 24, 15)) });
    expect(resurfaceCopy(loop, NOW)).toEqual({ title: 'Call the dentist', body: 'You wanted to do this this afternoon.' });
    expect(resurfaceCopy({ ...loop, nextReviewAt: iso(at(2026, 9, 24, 8)) }, NOW)?.body).toBe('You wanted to do this this morning.');
    expect(resurfaceCopy({ ...loop, nextReviewAt: iso(at(2026, 9, 24, 19)) }, NOW)?.body).toBe('You wanted to do this this evening.');
  });

  it('WAITING: "Still waiting for HR?"', () => {
    const loop = makeLoop({
      type: 'waiting',
      title: 'HR reply',
      entityName: 'HR',
      createdAt: iso(at(2026, 9, 21, 10)),
    });
    expect(resurfaceCopy(loop, NOW)).toEqual({ title: 'Still waiting for HR?', body: "You've been waiting for 2 days." });
    expect(resurfaceCopy({ ...loop, createdAt: iso(at(2026, 9, 22, 10)) }, NOW)?.body).toBe("You've been waiting since yesterday.");
  });

  it('WAITING with no one named still reads naturally', () => {
    const loop = makeLoop({ type: 'waiting', title: 'Waiting for refund', entityName: null, createdAt: iso(at(2026, 9, 20, 10)) });
    expect(resurfaceCopy(loop, NOW)).toEqual({ title: 'Still waiting?', body: 'Waiting for refund — waiting for 3 days.' });
  });

  it('PROMISE: "You said you\'d send Ozan the link."', () => {
    const loop = makeLoop({ type: 'promise', title: 'Send Ozan the link', entityName: 'Ozan' });
    expect(resurfaceCopy(loop, NOW)).toEqual({ title: "You said you'd send Ozan the link.", body: 'You told Ozan.' });
  });

  it('RETURN_LATER: "You wanted this brought back now." with the item underneath', () => {
    const loop = makeLoop({ type: 'return_later', title: 'Reconsider brown jacket' });
    expect(resurfaceCopy(loop, NOW)).toEqual({ title: 'You wanted this brought back now.', body: 'Reconsider brown jacket' });
  });

  it('EVENT names the thing', () => {
    expect(resurfaceCopy(makeLoop({ type: 'event', title: 'Test result' }), NOW)?.title).toBe('Test result');
  });

  it('REFERENCE never resurfaces', () => {
    expect(resurfaceCopy(makeLoop({ type: 'reference' }), NOW)).toBeNull();
  });
});

describe('waitingDefaultsFor — what the "waiting for something" sheet starts with', () => {
  it("keeps the task's person, expects a reply, and picks the interval for that kind of wait", () => {
    const work = waitingDefaultsFor(makeLoop({ title: 'Send HR documents', entityName: 'HR' }), NOW);
    expect(work).toEqual({ entityName: 'HR', expectedEvent: 'reply', reviewAt: at(2026, 9, 25, 10) }); // 2 business days
    const admin = waitingDefaultsFor(makeLoop({ title: 'Return the Zara package', entityName: 'Zara' }), NOW);
    expect(admin.reviewAt).toEqual(at(2026, 9, 29, 10)); // refunds/admin: 4 business days
    const casual = waitingDefaultsFor(makeLoop({ title: 'Send Ayse the photos', entityName: 'Ayse' }), NOW);
    expect(casual.reviewAt).toEqual(at(2026, 9, 25, 10)); // ~48h
  });

  it('works when the task names nobody, and always suggests a future time', () => {
    const d = waitingDefaultsFor(makeLoop({ title: 'Send the application documents', entityName: null }), NOW);
    expect(d.entityName).toBeNull();
    expect(d.reviewAt.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe('timelineLabel', () => {
  it('uses the spec\'s timeline wording', () => {
    expect(timelineLabel('captured')).toBe('Captured');
    expect(timelineLabel('action_completed')).toBe('Action completed');
    expect(timelineLabel('waiting_started')).toBe('Waiting started');
    expect(timelineLabel('review_scheduled')).toBe('Next review scheduled');
  });

  it('labels every event type the engine can emit', () => {
    for (const type of LOOP_EVENT_TYPES) expect(timelineLabel(type)).not.toBe(type);
  });

  it('degrades gracefully for an event type from a newer app version', () => {
    expect(timelineLabel('shared_with_partner')).toBe('shared with partner');
  });
});

describe('acceptance scenario 10 — the ignore-guilt rule', () => {
  const GUILT =
    /\b(?:fail\w*|miss(?:ed|ing)?|behind|overdue|falling|lazy|streaks?|crush\w*|goals?|productiv\w*|slack\w*|neglect\w*|ignor\w*|disappoint\w*|should have|still haven'?t|again!)\b/i;

  const everyLoop = (): Loop[] =>
    LOOP_TYPES.map((type) =>
      makeLoop({
        type,
        title: 'Something',
        entityName: 'Ozan',
        createdAt: iso(at(2026, 9, 1, 10)), // waiting for weeks
        nextReviewAt: iso(at(2026, 9, 2, 10)), // reviewed long ago
      }),
    );

  it('no reminder copy ever blames, however long something has been open', () => {
    for (const loop of everyLoop()) {
      const copy = resurfaceCopy(loop, NOW);
      if (!copy) continue;
      expect(`${copy.title} ${copy.body}`).not.toMatch(GUILT);
    }
  });

  it('the soft follow-up asks "Still relevant?" / "Want this brought back later?"', () => {
    expect(softFollowUpCopy(makeLoop({ type: 'waiting', title: 'HR reply' })).title).toBe('Still relevant?');
    expect(softFollowUpCopy(makeLoop({ type: 'task', title: 'Call dentist' })).title).toBe('Want this brought back later?');
    for (const loop of everyLoop()) {
      const copy = softFollowUpCopy(loop);
      expect(`${copy.title} ${copy.body}`).not.toMatch(GUILT);
    }
  });

  it('in-app prompts use the spec wording', () => {
    expect(PROMPTS).toEqual({
      doneSheetTitle: 'Does this end here?',
      doneSheetYes: 'Yes, done',
      doneSheetWaiting: 'I’m waiting for something',
    });
  });
});
