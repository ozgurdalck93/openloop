import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { FLOW_1, NOW, createWorldFactory, type World } from '../../test/harness';
import { getLoop, listLoops } from '@/db/loops';
import { listEvents } from '@/db/events';
import { EngineError } from '@/engine/transitions';
import type { LoopEventType } from '@/engine/types';
import { ServiceError } from './loopService';

const world = createWorldFactory();
const iso = (d: Date) => d.toISOString();
const eventTypes = async (w: World, id: string): Promise<LoopEventType[]> => (await listEvents(w.db, id)).map((e) => e.eventType);
const fresh = async (w: World, id: string) => (await getLoop(w.db, id))!;

describe('keep (Review → "Keep track of these")', () => {
  it('stores the capture, the loops and their first timeline, and says what it did', async () => {
    const w = world();
    await w.ready;
    const { candidates } = (await import('@/parser/localParser')).parseText(FLOW_1, NOW);
    const out = await w.service.keep(candidates, FLOW_1);
    expect(out).toEqual({ changed: true, focusLoopId: null, message: 'Keeping track of 3 things' });
    const loops = await w.loops();
    expect(loops.map((l) => l.title).sort()).toEqual(['Call dentist', 'HR reply', 'Zara refund']);
    expect(await eventTypes(w, (await w.byTitle('HR reply')).id)).toEqual(['captured', 'waiting_started', 'review_scheduled']);
  });

  it('refuses invalid candidates and stores nothing', async () => {
    const w = world();
    await w.ready;
    const { candidates } = (await import('@/parser/localParser')).parseText('Call the dentist tomorrow', NOW);
    await expect(w.service.keep([{ ...candidates[0], title: '' }], 'x')).rejects.toThrow(EngineError);
    expect(await w.loops()).toEqual([]);
    expect(w.fake.scheduled.size).toBe(0);
  });
});

describe('TASK actions', () => {
  it('15 min later: snoozes, moves the reminder, records it', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const dentist = await w.byTitle('Call dentist');
    const out = await w.service.perform(dentist.id, 'snooze_15');

    expect(out).toMatchObject({ changed: true, message: 'Back in 15 minutes' });
    const after = await fresh(w, dentist.id);
    expect(after).toMatchObject({ status: 'snoozed', nextReviewAt: iso(at(2026, 9, 23, 10, 15)) });
    expect(w.fake.state.cancelled).toContain(dentist.notificationId);
    expect(w.fake.forLoop(dentist.id)).toHaveLength(1);
    expect(w.fake.forLoop(dentist.id)[0][1].fireAt).toEqual(at(2026, 9, 23, 10, 15));
    expect((await eventTypes(w, dentist.id)).at(-1)).toBe('snoozed');
  });

  it('Later today: a slot a few hours out', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow');
    const dentist = await w.byTitle('Call dentist');
    const out = await w.service.perform(dentist.id, 'later_today');
    expect(out.message).toBe('Snoozed until Today · 13:00');
    expect((await fresh(w, dentist.id)).nextReviewAt).toBe(iso(at(2026, 9, 23, 13)));
  });

  it('Done on an ordinary task asks "Does this end here?" and changes NOTHING yet', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow');
    const dentist = await w.byTitle('Call dentist');
    const events = await eventTypes(w, dentist.id);

    const out = await w.service.perform(dentist.id, 'done');
    expect(out).toEqual({ changed: false, focusLoopId: null, message: '', ask: 'does_this_end_here' });
    expect(await fresh(w, dentist.id)).toEqual(dentist);
    expect(await eventTypes(w, dentist.id)).toEqual(events);
    expect(w.fake.forLoop(dentist.id)).toHaveLength(1); // its reminder is untouched
  });

  it('"Yes, done": resolves, cancels the reminder, keeps the history', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow');
    const dentist = await w.byTitle('Call dentist');
    const out = await w.service.finishTask(dentist.id, { endsHere: true });
    expect(out).toMatchObject({ changed: true, message: 'Done', focusLoopId: null });
    expect(await fresh(w, dentist.id)).toMatchObject({ status: 'resolved', resolvedAt: iso(NOW) });
    expect(w.fake.scheduled.size).toBe(0);
    expect(await eventTypes(w, dentist.id)).toEqual(['captured', 'review_scheduled', 'action_completed', 'resolved']);
  });

  it('"I\'m waiting for something": resolves the task and starts a linked WAITING loop (TASK → WAITING)', async () => {
    const w = world();
    await w.keepText('Send the application documents');
    const task = await w.byTitle('Send application documents');

    const out = await w.service.finishTask(task.id, {
      waiting: { title: 'HR reply', expectedEvent: 'reply', reviewAt: at(2026, 9, 25, 11) },
    });
    expect(out.message).toBe('Now waiting: HR reply');
    expect(out.focusLoopId).not.toBeNull();

    const waiting = await fresh(w, out.focusLoopId as string);
    expect(waiting).toMatchObject({
      type: 'waiting',
      status: 'waiting',
      title: 'HR reply',
      parentLoopId: task.id, // linked
      expectedEvent: 'reply',
      nextReviewAt: iso(at(2026, 9, 25, 11)),
      followUpPolicy: 'expected_date',
    });
    expect(await fresh(w, task.id)).toMatchObject({ status: 'resolved' });

    // the timeline links both events, on both loops
    expect(await eventTypes(w, task.id)).toEqual(['captured', 'review_scheduled', 'action_completed', 'waiting_started', 'resolved']);
    expect(await eventTypes(w, waiting.id)).toEqual(['created', 'action_completed', 'waiting_started', 'review_scheduled']);
    // and the OS follows: the task's reminder is gone, the new loop has one
    expect(w.fake.forLoop(task.id)).toEqual([]);
    expect(w.fake.forLoop(waiting.id)).toHaveLength(1);
    expect(w.fake.forLoop(waiting.id)[0][1].fireAt).toEqual(at(2026, 9, 25, 11));
  });

  it('is atomic: the task is resolved AND the waiting loop exists, or neither', async () => {
    const w = world();
    await w.keepText('Send the application documents');
    const task = await w.byTitle('Send application documents');
    // Sabotage the LAST write: the timeline entry "waiting_started" cannot be stored. By then the
    // task update and the new loop have already been written inside the transaction.
    await w.db.execAsync(
      `CREATE TRIGGER boom BEFORE INSERT ON loop_events WHEN NEW.event_type = 'waiting_started'
       BEGIN SELECT RAISE(ABORT, 'boom'); END;`,
    );
    const before = await w.loops();
    const eventsBefore = await eventTypes(w, task.id);
    await expect(w.service.finishTask(task.id, { waiting: {} })).rejects.toThrow(/boom/);
    expect(await fresh(w, task.id)).toEqual(task); // still active: the resolve was rolled back
    expect(await w.loops()).toEqual(before); // and no waiting loop was left behind
    expect(await eventTypes(w, task.id)).toEqual(eventsBefore);
    expect(w.fake.forLoop(task.id)).toHaveLength(1); // the reminder was never touched
  });

  it('Edit-only actions are refused by perform()', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow');
    const dentist = await w.byTitle('Call dentist');
    await expect(w.service.perform(dentist.id, 'edit')).rejects.toThrow(ServiceError);
  });
});

describe('WAITING actions', () => {
  it('Still waiting: stays on watch, asks again after the same kind of interval, records it', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    w.advance(2 * 24 * 3600 * 1000); // Friday 10:00: the review is due
    const out = await w.service.perform(hr.id, 'still_waiting');
    expect(out.message).toBe('Still waiting — I’ll ask again Tuesday · 10:00');
    const after = await fresh(w, hr.id);
    expect(after).toMatchObject({ status: 'waiting', nextReviewAt: iso(at(2026, 9, 29, 10)) });
    expect((await eventTypes(w, hr.id)).at(-1)).toBe('still_waiting');
    expect(w.fake.forLoop(hr.id)[0][1].fireAt).toEqual(at(2026, 9, 29, 10));
  });

  it('Got a reply: resolves and cancels the reminder', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const zara = await w.byTitle('Zara refund');
    const out = await w.service.perform(zara.id, 'got_reply');
    expect(out.message).toBe('Got it — resolved');
    expect(await fresh(w, zara.id)).toMatchObject({ status: 'resolved' });
    expect(w.fake.forLoop(zara.id)).toEqual([]);
    expect((await eventTypes(w, zara.id)).slice(-2)).toEqual(['reply_received', 'resolved']);
  });

  it('Follow up: creates a linked TASK, and the waiting loop steps aside (no double reminder)', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    const out = await w.service.perform(hr.id, 'follow_up');
    expect(out.message).toBe('Follow-up added');

    const task = await fresh(w, out.focusLoopId as string);
    expect(task).toMatchObject({ type: 'task', title: 'Follow up with HR', parentLoopId: hr.id, status: 'active' });
    expect(await fresh(w, hr.id)).toMatchObject({ status: 'active', nextActionOwner: 'user', nextReviewAt: null });
    expect(w.fake.forLoop(hr.id)).toEqual([]); // parent: no reminder while the follow-up is open
    expect(w.fake.forLoop(task.id)).toHaveLength(1); // child: reminded
    expect(await eventTypes(w, hr.id)).toContain('follow_up_created');
  });

  it('completing the follow-up needs no question: the waiting loop goes back on watch', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    const { focusLoopId } = await w.service.perform(hr.id, 'follow_up');

    const out = await w.service.perform(focusLoopId as string, 'done');
    expect(out.ask).toBeUndefined();
    expect(out).toMatchObject({ changed: true, message: 'Back to waiting on HR' });
    expect(await fresh(w, focusLoopId as string)).toMatchObject({ status: 'resolved' });
    const parent = await fresh(w, hr.id);
    expect(parent).toMatchObject({ status: 'waiting', nextActionOwner: 'other' });
    expect(parent.nextReviewAt).not.toBeNull();
    expect(w.fake.forLoop(hr.id)).toHaveLength(1); // its reminder is back
    expect(w.fake.forLoop(focusLoopId as string)).toEqual([]);
    expect((await eventTypes(w, hr.id)).slice(-3)).toEqual(['follow_up_completed', 'waiting_started', 'review_scheduled']);
  });

  it('REGRESSION: setting a follow-up aside puts the waiting loop back on watch (it used to vanish from Home)', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    const { focusLoopId } = await w.service.perform(hr.id, 'follow_up');

    const out = await w.service.perform(focusLoopId as string, 'dismiss');
    expect(out.message).toBe('Set aside');
    expect(await fresh(w, focusLoopId as string)).toMatchObject({ status: 'archived' });
    const parent = await fresh(w, hr.id);
    expect(parent).toMatchObject({ status: 'waiting', nextActionOwner: 'other' });
    expect(parent.nextReviewAt).not.toBeNull();
    expect(w.fake.forLoop(hr.id)).toHaveLength(1); // reminded again
    expect((await eventTypes(w, hr.id)).slice(-3)).toEqual(['follow_up_completed', 'waiting_started', 'review_scheduled']);
  });

  it('REGRESSION: resolving a follow-up directly also hands the waiting loop back', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    const { focusLoopId } = await w.service.perform(hr.id, 'follow_up');
    await w.service.perform(focusLoopId as string, 'resolve');
    expect(await fresh(w, focusLoopId as string)).toMatchObject({ status: 'resolved' });
    expect(await fresh(w, hr.id)).toMatchObject({ status: 'waiting' });
  });

  it('a follow-up is never asked "Does this end here?" — either choice hands the waiting loop back', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    const { focusLoopId } = await w.service.perform(hr.id, 'follow_up');
    const out = await w.service.finishTask(focusLoopId as string, { waiting: {} });
    expect(out.message).toBe('Back to waiting on HR');
    expect(await fresh(w, hr.id)).toMatchObject({ status: 'waiting' });
    expect((await w.loops()).filter((l) => l.type === 'waiting')).toHaveLength(2); // HR + Zara; no third loop
  });

  it('a reply that arrives while a follow-up is open also sets the pointless follow-up aside', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    const { focusLoopId } = await w.service.perform(hr.id, 'follow_up');

    await w.service.perform(hr.id, 'got_reply');
    expect(await fresh(w, hr.id)).toMatchObject({ status: 'resolved' });
    expect(await fresh(w, focusLoopId as string)).toMatchObject({ status: 'archived' });
    expect(w.fake.scheduled.size).toBe(2); // only the dentist and Zara remain
  });

  it('Remind me later needs a time; with one it snoozes but stays owned by the other party', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    await expect(w.service.perform(hr.id, 'remind_later')).rejects.toMatchObject({ code: 'needs_time' });
    await w.service.perform(hr.id, 'remind_later', { until: at(2026, 9, 28, 9) });
    expect(await fresh(w, hr.id)).toMatchObject({ status: 'snoozed', nextActionOwner: 'other', nextReviewAt: iso(at(2026, 9, 28, 9)) });
  });
});

describe('PROMISE, EVENT and RETURN_LATER actions', () => {
  it('PROMISE — Fulfilled closes it; Remind me later moves it', async () => {
    const w = world();
    await w.keepText("I told Ozan I'd send him the link tonight.");
    const promise = await w.byTitle('Send Ozan the link');
    await w.service.perform(promise.id, 'remind_later', { until: at(2026, 9, 24, 9) });
    expect((await fresh(w, promise.id)).status).toBe('snoozed');
    await w.service.perform(promise.id, 'fulfilled');
    expect(await fresh(w, promise.id)).toMatchObject({ status: 'resolved' });
    expect(w.fake.scheduled.size).toBe(0);
  });

  it('EVENT — View turns it into a task to check it; Done acknowledges; Later snoozes', async () => {
    const w = world();
    await w.keepText('The test result comes out Friday.');
    await w.keepText('My exam results come out Monday.');
    const [first, second] = (await w.loops()).filter((l) => l.type === 'event');

    const view = await w.service.perform(first.id, 'view');
    const task = await fresh(w, view.focusLoopId as string);
    expect(task).toMatchObject({ type: 'task', parentLoopId: first.id });
    expect(task.title.toLowerCase()).toContain('check');
    expect(await fresh(w, first.id)).toMatchObject({ status: 'resolved' });

    await w.service.perform(second.id, 'later_today');
    expect((await fresh(w, second.id)).status).toBe('snoozed');
    const events = await w.loops();
    const remaining = events.find((l) => l.id === second.id)!;
    expect(remaining.nextReviewAt).toBe(iso(at(2026, 9, 23, 13)));

    await w.service.perform(second.id, 'done');
    expect(await fresh(w, second.id)).toMatchObject({ status: 'resolved' });
  });

  it('RETURN_LATER — Act now keeps the reason; Bring back later moves it; Resolve closes it', async () => {
    const w = world();
    await w.keepText('I like the brown jacket but M fit better than XS. Bring this back after payday.');
    const jacket = await w.byTitle('Reconsider brown jacket');

    const act = await w.service.perform(jacket.id, 'act_now');
    const task = await fresh(w, act.focusLoopId as string);
    expect(task.rawContext).toContain('M fit better than XS');
    expect(await fresh(w, jacket.id)).toMatchObject({ status: 'resolved' });

    await w.keepText('Bring this back after payday. I like the green coat.');
    const later = (await w.loops()).find((l) => l.type === 'return_later' && l.status !== 'resolved')!;
    await w.service.perform(later.id, 'bring_back_later', { until: at(2026, 10, 5, 9) });
    expect(await fresh(w, later.id)).toMatchObject({ status: 'snoozed', nextReviewAt: iso(at(2026, 10, 5, 9)) });
    await w.service.perform(later.id, 'resolve');
    expect((await fresh(w, later.id)).status).toBe('resolved');
  });
});

describe('dismiss', () => {
  it('sets a loop aside without deleting anything', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow');
    const dentist = await w.byTitle('Call dentist');
    await w.service.perform(dentist.id, 'dismiss');
    expect(await fresh(w, dentist.id)).toMatchObject({ status: 'archived' });
    expect(w.fake.scheduled.size).toBe(0);
    expect((await eventTypes(w, dentist.id)).at(-1)).toBe('dismissed');
    expect(await w.loops()).toHaveLength(1); // still in the database
  });
});

describe('edit', () => {
  it('changes text and time together: one row, one reminder, timeline entries', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow at 3pm');
    const dentist = await w.byTitle('Call dentist');
    const out = await w.service.edit(dentist.id, {
      title: 'Call Dr. Yilmaz',
      entityName: 'Dr. Yilmaz',
      rawContext: 'about the crown',
      reviewAt: at(2026, 9, 25, 16),
    });
    expect(out).toEqual({ changed: true, focusLoopId: null, message: 'Saved' });
    const after = await fresh(w, dentist.id);
    expect(after).toMatchObject({ title: 'Call Dr. Yilmaz', entityName: 'Dr. Yilmaz', rawContext: 'about the crown', nextReviewAt: iso(at(2026, 9, 25, 16)) });
    expect(w.fake.forLoop(dentist.id)).toHaveLength(1);
    expect(w.fake.forLoop(dentist.id)[0][1]).toMatchObject({ title: 'Call Dr. Yilmaz', fireAt: at(2026, 9, 25, 16) });
    expect((await eventTypes(w, dentist.id)).slice(-2)).toEqual(['edited', 'rescheduled']);
  });

  it('saying nothing new stores nothing', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow at 3pm');
    const dentist = await w.byTitle('Call dentist');
    const out = await w.service.edit(dentist.id, { title: 'Call dentist' });
    expect(out).toEqual({ changed: false, focusLoopId: null, message: 'Nothing changed' });
    expect(await fresh(w, dentist.id)).toEqual(dentist);
  });
});

describe('errors', () => {
  it('an unknown loop is a ServiceError, not a crash', async () => {
    const w = world();
    await w.ready;
    await expect(w.service.perform('nope', 'resolve')).rejects.toMatchObject({ code: 'not_found' });
    await expect(w.service.edit('nope', { title: 'x' })).rejects.toBeInstanceOf(ServiceError);
    expect(await w.service.load('nope')).toBeNull();
  });

  it('actions that do not fit the loop type are refused, and change nothing', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const dentist = await w.byTitle('Call dentist');
    const hr = await w.byTitle('HR reply');
    await expect(w.service.perform(dentist.id, 'got_reply')).rejects.toThrow(EngineError);
    await expect(w.service.perform(dentist.id, 'fulfilled')).rejects.toThrow(EngineError);
    await expect(w.service.perform(dentist.id, 'still_waiting')).rejects.toThrow(EngineError);
    await expect(w.service.perform(hr.id, 'done')).rejects.toThrow(EngineError);
    expect(await fresh(w, dentist.id)).toEqual(dentist);
    expect(await fresh(w, hr.id)).toEqual(hr);
  });

  it('a closed loop cannot be acted on again (a double tap is harmless)', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow');
    const dentist = await w.byTitle('Call dentist');
    await w.service.perform(dentist.id, 'resolve');
    await expect(w.service.perform(dentist.id, 'resolve')).rejects.toThrow(/already closed/);
    expect((await eventTypes(w, dentist.id)).filter((t) => t === 'resolved')).toHaveLength(1);
  });
});

describe('load', () => {
  it('returns the loop with its parent, children and timeline', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const hr = await w.byTitle('HR reply');
    const { focusLoopId } = await w.service.perform(hr.id, 'follow_up');

    const parentView = await w.service.load(hr.id);
    expect(parentView?.children.map((c) => c.id)).toEqual([focusLoopId]);
    const childView = await w.service.load(focusLoopId as string);
    expect(childView?.parent?.id).toBe(hr.id);
    expect(childView?.events.map((e) => e.eventType)).toEqual(['created', 'review_scheduled']);
  });
});

describe('the whole flow, with restarts in between (real file database)', () => {
  it('survives closing and reopening, and reminders stay in step', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createWorld } = await import('../../test/harness');
    const dir = mkdtempSync(join(tmpdir(), 'openloop-svc-'));
    const file = join(dir, 'db.sqlite');
    let w2: World | undefined;
    try {
      const w1 = createWorld({ file });
      await w1.keepText(FLOW_1);
      const hr = await w1.byTitle('HR reply');
      await w1.service.perform(hr.id, 'follow_up');
      w1.close();

      w2 = createWorld({ file });
      await w2.ready;
      const loops = await listLoops(w2.db);
      expect(loops.map((l) => l.title).sort()).toEqual(['Call dentist', 'Follow up with HR', 'HR reply', 'Zara refund']);
      const parent = loops.find((l) => l.title === 'HR reply')!;
      const child = loops.find((l) => l.title === 'Follow up with HR')!;
      expect(child.parentLoopId).toBe(parent.id);
      const out = await w2.service.perform(child.id, 'done');
      expect(out.message).toBe('Back to waiting on HR');
    } finally {
      w2?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
