import { describe, expect, it } from 'vitest';

import { at, makeContext, makeLoop } from '../../test/fixtures';
import { parseText } from '@/parser/localParser';
import {
  CandidateValidationError,
  EngineError,
  actNow,
  completeFollowUp,
  completeTaskAndWait,
  confirmCandidates,
  dismissFollowUp,
  dismissLoop,
  doneFlowFor,
  editLoop,
  eventToTask,
  followUp,
  initialStatusFor,
  isPendingFollowUp,
  isSteppedAside,
  ownerFor,
  reopenLoop,
  rescheduleLoop,
  resolveLoop,
  snoozeLoop,
  stillWaiting,
} from './transitions';
import type { EngineResult, Loop, LoopType } from './types';

// Wednesday 23 Sep 2026, 10:00.
const NOW = at(2026, 9, 23, 10, 0);
const iso = (d: Date) => d.toISOString();

/** Freezes a loop so any accidental mutation by the engine throws. */
const frozen = (overrides: Partial<Loop> = {}): Loop => Object.freeze(makeLoop(overrides));

/** Applies a result to an in-memory list the way the db layer would. */
function applyInMemory(loops: Loop[], result: EngineResult): Loop[] {
  const byId = new Map(result.updated.map((l) => [l.id, l]));
  return [...loops.map((l) => byId.get(l.id) ?? l), ...result.created];
}
const eventTypes = (result: EngineResult, loopId: string) =>
  result.events.filter((e) => e.loopId === loopId).map((e) => e.eventType);

describe('type → owner / initial status', () => {
  it.each<[LoopType, string, string]>([
    ['task', 'user', 'active'],
    ['promise', 'user', 'active'],
    ['waiting', 'other', 'waiting'],
    ['event', 'system', 'scheduled'],
    ['return_later', 'user', 'scheduled'],
    ['reference', 'none', 'active'],
  ])('%s → owner %s, status %s', (type, owner, status) => {
    expect(ownerFor(type)).toBe(owner);
    expect(initialStatusFor(type)).toBe(status);
  });
});

describe('confirmCandidates (the review screen\'s "Keep track of these")', () => {
  const text =
    "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived.";

  it('turns the three acceptance candidates into stored-ready loops with a capture and timelines', () => {
    const ctx = makeContext(NOW);
    const { candidates } = parseText(text, NOW);
    const result = confirmCandidates(candidates, text, ctx);

    expect(result.capture).toEqual({ id: 'id-1', rawText: text, createdAt: iso(NOW) });
    expect(result.created.map((l) => [l.type, l.status, l.title])).toEqual([
      ['waiting', 'waiting', 'HR reply'],
      ['task', 'active', 'Call dentist'],
      ['waiting', 'waiting', 'Zara refund'],
    ]);
    for (const loop of result.created) {
      expect(loop.captureId).toBe('id-1');
      expect(loop.createdAt).toBe(iso(NOW));
      expect(loop.updatedAt).toBe(iso(NOW));
      expect(loop.resolvedAt).toBeNull();
      expect(loop.notificationId).toBeNull();
    }
    const [hr, dentist] = result.created;
    expect(eventTypes(result, hr.id)).toEqual(['captured', 'waiting_started', 'review_scheduled']);
    expect(eventTypes(result, dentist.id)).toEqual(['captured', 'review_scheduled']);
    expect(result.events.find((e) => e.loopId === dentist.id && e.eventType === 'review_scheduled')?.note).toBe(
      'Review Tomorrow · 15:00',
    );
    expect(result.updated).toEqual([]);
  });

  it('keeps user edits from the review screen (title, entity, time)', () => {
    const { candidates } = parseText('Call the dentist tomorrow', NOW);
    const edited = { ...candidates[0], title: '  Call Dr. Yılmaz  ', entityName: 'Dr. Yılmaz', nextReviewAt: iso(at(2026, 9, 24, 8, 30)) };
    const [loop] = confirmCandidates([edited], 'Call the dentist tomorrow', makeContext(NOW)).created;
    expect(loop).toMatchObject({ title: 'Call Dr. Yılmaz', entityName: 'Dr. Yılmaz', nextReviewAt: iso(at(2026, 9, 24, 8, 30)) });
  });

  it('trims the person/company and the title once, when kept', () => {
    const [c] = parseText('Call the dentist tomorrow', NOW).candidates;
    const [loop] = confirmCandidates([{ ...c, title: '  Call Dr. Yilmaz ', entityName: 'Dr. Yilmaz ' }], 'x', makeContext(NOW)).created;
    expect(loop.title).toBe('Call Dr. Yilmaz');
    expect(loop.entityName).toBe('Dr. Yilmaz');
    const [blank] = confirmCandidates([{ ...c, entityName: '   ' }], 'x', makeContext(NOW)).created;
    expect(blank.entityName).toBeNull();
  });

  it('references are stored without a review time or policy — they never notify', () => {
    const { candidates } = parseText('My passport number is in the blue folder.', NOW);
    const [ref] = confirmCandidates(candidates, 'x', makeContext(NOW)).created;
    expect(ref).toMatchObject({ type: 'reference', nextReviewAt: null, followUpPolicy: 'none', closingCondition: null, status: 'active' });
  });

  it('stores nothing for an empty list, and refuses a blank title', () => {
    expect(confirmCandidates([], 'x', makeContext(NOW))).toEqual({ created: [], updated: [], events: [] });
    const { candidates } = parseText('Call the dentist tomorrow', NOW);
    expect(() => confirmCandidates([{ ...candidates[0], title: '   ' }], 'x', makeContext(NOW))).toThrow(EngineError);
  });

  it('is the backstop for candidates the UI let through: stale times, missing dates, blank titles', () => {
    const [ok] = parseText('Call the dentist tomorrow', NOW).candidates;
    const stale = { ...ok, nextReviewAt: iso(at(2026, 9, 22, 9)) };
    const noTime = { ...ok, nextReviewAt: null };
    const blank = { ...ok, title: '  ' };
    try {
      confirmCandidates([ok, stale, noTime, blank], 'x', makeContext(NOW));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CandidateValidationError);
      const { problems } = error as CandidateValidationError;
      expect(problems.map((p) => [p.index, p.issues.map((i) => i.code)])).toEqual([
        [1, ['when_passed']],
        [2, ['when_required']],
        [3, ['title_required']],
      ]);
    }
  });

  it('writes nothing when any candidate is invalid (no partial saves)', () => {
    const [ok] = parseText('Call the dentist tomorrow', NOW).candidates;
    const ctx = makeContext(NOW);
    expect(() => confirmCandidates([ok, { ...ok, title: '' }], 'x', ctx)).toThrow(CandidateValidationError);
    expect(ctx.ids()).toEqual([]); // not even an id was drawn: validation runs before anything is built
  });
});

describe('acceptance scenario 2 — a completed action creates a waiting loop (TASK → WAITING)', () => {
  const task = frozen({
    id: 'task-1',
    title: 'Send application documents',
    rawContext: 'Send the application documents.',
    captureId: 'cap-1',
  });

  it('asks "Does this end here?" for an ordinary task', () => {
    expect(doneFlowFor(task, null)).toEqual({ kind: 'ask_if_it_ends' });
  });

  it('the TASK becomes resolved and a linked WAITING loop is created', () => {
    const result = completeTaskAndWait(task, makeContext(NOW));
    const [waiting] = result.created;
    const [resolved] = result.updated;

    expect(resolved).toMatchObject({ id: 'task-1', status: 'resolved', resolvedAt: iso(NOW), updatedAt: iso(NOW) });
    expect(waiting).toMatchObject({
      type: 'waiting',
      status: 'waiting',
      nextActionOwner: 'other',
      parentLoopId: 'task-1',
      captureId: 'cap-1',
      rawContext: 'Send the application documents.',
      title: 'Response to: Send application documents',
    });
    expect(waiting.nextReviewAt).toBe(iso(at(2026, 9, 25, 10))); // work reply: 2 business days
    expect(waiting.followUpPolicy).toBe('reply_work');
  });

  it('the timeline links both events, on both loops', () => {
    const result = completeTaskAndWait(task, makeContext(NOW));
    const [waiting] = result.created;
    expect(eventTypes(result, 'task-1')).toEqual(['action_completed', 'waiting_started', 'resolved']);
    expect(eventTypes(result, waiting.id)).toEqual(['created', 'action_completed', 'waiting_started', 'review_scheduled']);
    expect(result.events.find((e) => e.loopId === 'task-1' && e.eventType === 'waiting_started')?.note).toContain(waiting.title);
    expect(result.events.find((e) => e.loopId === waiting.id && e.eventType === 'created')?.note).toContain(task.title);
  });

  it('names the waiting loop after the entity when there is one, and honours overrides', () => {
    const withEntity = completeTaskAndWait(frozen({ entityName: 'HR', title: 'Send HR documents' }), makeContext(NOW));
    expect(withEntity.created[0].title).toBe('HR reply');
    expect(withEntity.created[0].entityName).toBe('HR');

    const custom = completeTaskAndWait(task, makeContext(NOW), {
      title: 'Visa office answer',
      expectedEvent: 'decision',
      reviewAt: at(2026, 10, 5, 9),
    });
    expect(custom.created[0]).toMatchObject({
      title: 'Visa office answer',
      expectedEvent: 'decision',
      nextReviewAt: iso(at(2026, 10, 5, 9)),
      followUpPolicy: 'expected_date',
    });
  });

  it('the waiting loop takes the person and expectation the user typed into the sheet', () => {
    const t = frozen({ id: 't', title: 'Send HR documents', entityName: 'HR' });
    const custom = completeTaskAndWait(t, makeContext(NOW), { entityName: 'Acme Corp', expectedEvent: 'contract' });
    expect(custom.created[0]).toMatchObject({ title: 'Acme Corp contract', entityName: 'Acme Corp', expectedEvent: 'contract' });
    const nobody = completeTaskAndWait(t, makeContext(NOW), { entityName: null });
    expect(nobody.created[0]).toMatchObject({ title: 'Response to: Send HR documents', entityName: null });
    const untouched = completeTaskAndWait(t, makeContext(NOW), {});
    expect(untouched.created[0]).toMatchObject({ title: 'HR reply', entityName: 'HR', expectedEvent: 'reply' });
    const blank = completeTaskAndWait(t, makeContext(NOW), { expectedEvent: '   ' });
    expect(blank.created[0].expectedEvent).toBe('reply');
  });

  it('a review time in the past is refused when starting to wait', () => {
    expect(() => completeTaskAndWait(frozen(), makeContext(NOW), { reviewAt: at(2026, 9, 22, 9) })).toThrow(/already passed/);
  });

  it('refuses anything that is not an open task', () => {
    const ctx = makeContext(NOW);
    expect(() => completeTaskAndWait(frozen({ type: 'waiting' }), ctx)).toThrow(EngineError);
    expect(() => completeTaskAndWait(frozen({ status: 'resolved' }), ctx)).toThrow(/already closed/);
  });
});

describe('acceptance scenario 3 — a waiting loop gets a follow-up (WAITING → TASK → WAITING)', () => {
  const waiting = frozen({
    id: 'w-1',
    type: 'waiting',
    status: 'waiting',
    title: 'Ticket company reply',
    entityName: 'ticket company',
    nextActionOwner: 'other',
    nextReviewAt: iso(at(2026, 9, 23, 9)),
    followUpPolicy: 'reply_casual',
    rawContext: 'Still waiting for the ticket company.',
  });

  it('creates a linked TASK "Follow up with ticket company"; the parent stays traceable', () => {
    const result = followUp(waiting, makeContext(NOW));
    const [task] = result.created;
    const [parent] = result.updated;

    expect(task).toMatchObject({
      type: 'task',
      status: 'active',
      title: 'Follow up with ticket company',
      parentLoopId: 'w-1',
      entityName: 'ticket company',
      nextActionOwner: 'user',
    });
    expect(task.nextReviewAt).not.toBeNull();
    expect(parent).toMatchObject({ id: 'w-1', status: 'active', nextActionOwner: 'user', nextReviewAt: null });
    expect(eventTypes(result, 'w-1')).toEqual(['follow_up_created']);
    expect(eventTypes(result, task.id)).toEqual(['created', 'review_scheduled']);
    expect(result.events.find((e) => e.eventType === 'follow_up_created')?.note).toContain('Follow up with ticket company');
  });

  it('falls back to the loop title when no one is named', () => {
    const result = followUp(frozen({ type: 'waiting', status: 'waiting', title: 'Refund', entityName: null }), makeContext(NOW));
    expect(result.created[0].title).toBe('Follow up: Refund');
  });

  it('completing the follow-up returns the parent to WAITING with a new review time (no question asked)', () => {
    const step1 = followUp(waiting, makeContext(NOW));
    const [task] = step1.created;
    const [parent] = step1.updated;

    expect(isPendingFollowUp(task, parent)).toBe(true);
    expect(doneFlowFor(task, parent)).toEqual({ kind: 'return_to_waiting', parent });

    const later = makeContext(at(2026, 9, 23, 14, 0));
    const step2 = completeFollowUp(task, parent, later);
    const byId = new Map(step2.updated.map((l) => [l.id, l]));
    expect(byId.get(task.id)).toMatchObject({ status: 'resolved', resolvedAt: iso(at(2026, 9, 23, 14)) });
    expect(byId.get(parent.id)).toMatchObject({ status: 'waiting', nextActionOwner: 'other' });
    expect(byId.get(parent.id)?.nextReviewAt).toBe(iso(at(2026, 9, 25, 14))); // casual: ~48h from now
    expect(eventTypes(step2, parent.id)).toEqual(['follow_up_completed', 'waiting_started', 'review_scheduled']);
  });

  it('setting a follow-up aside puts the parent back on watch, so it cannot vanish from Home', () => {
    const step1 = followUp(waiting, makeContext(NOW));
    const [task] = step1.created;
    const [parent] = step1.updated;
    const result = dismissFollowUp(task, parent, makeContext(at(2026, 9, 23, 14, 0)));
    const byId = new Map(result.updated.map((l) => [l.id, l]));
    expect(byId.get(task.id)).toMatchObject({ status: 'archived' });
    expect(byId.get(parent.id)).toMatchObject({ status: 'waiting', nextActionOwner: 'other' });
    expect(byId.get(parent.id)?.nextReviewAt).not.toBeNull();
    expect(eventTypes(result, task.id)).toEqual(['dismissed']);
    expect(eventTypes(result, parent.id)).toEqual(['follow_up_completed', 'waiting_started', 'review_scheduled']);
    expect(result.events.find((e) => e.eventType === 'follow_up_completed')?.note).toContain('set aside');
  });

  it('a waiting loop stepped aside for its follow-up cannot be snoozed, moved, kept waiting or followed up again', () => {
    const [, parent] = [null, followUp(waiting, makeContext(NOW)).updated[0]];
    const ctx = makeContext(NOW);
    expect(isSteppedAside(parent)).toBe(true);
    expect(() => snoozeLoop(parent, at(2026, 9, 24, 9), ctx)).toThrow(/follow-up task/);
    expect(() => rescheduleLoop(parent, at(2026, 9, 24, 9), ctx)).toThrow(/follow-up task/);
    expect(() => stillWaiting(parent, ctx)).toThrow(/follow-up task/);
    expect(() => followUp(parent, ctx)).toThrow(/follow-up task/);
    expect(() => editLoop(parent, { reviewAt: at(2026, 9, 24, 9) }, ctx)).toThrow(/follow-up task/);
    // …but its words can still be edited, and a reply still closes it
    expect(editLoop(parent, { title: 'HR answer' }, ctx).updated[0].title).toBe('HR answer');
    expect(() => resolveLoop(parent, ctx)).not.toThrow();
  });

  it('only a task whose parent is waiting on it counts as a pending follow-up', () => {
    const task = frozen({ id: 't', parentLoopId: 'w-1' });
    expect(isPendingFollowUp(task, waiting)).toBe(false); // parent is 'waiting', not 'active'
    expect(isPendingFollowUp(task, null)).toBe(false);
    expect(() => completeFollowUp(task, waiting, makeContext(NOW))).toThrow(EngineError);
  });

  it('refuses to follow up on things that are not waiting', () => {
    expect(() => followUp(frozen({ type: 'task' }), makeContext(NOW))).toThrow(EngineError);
    expect(() => followUp(frozen({ type: 'waiting', status: 'resolved' }), makeContext(NOW))).toThrow(EngineError);
  });
});

describe('still waiting', () => {
  it('keeps the loop and asks again after the same kind of interval', () => {
    const loop = frozen({ type: 'waiting', status: 'snoozed', followUpPolicy: 'admin_wait', nextReviewAt: iso(NOW) });
    const result = stillWaiting(loop, makeContext(NOW));
    expect(result.created).toEqual([]);
    expect(result.updated[0]).toMatchObject({ status: 'waiting', nextActionOwner: 'other', nextReviewAt: iso(at(2026, 9, 29, 10)) });
    expect(eventTypes(result, loop.id)).toEqual(['still_waiting']);
    expect(result.events[0].note).toBe('Next check: Tuesday · 10:00');
  });

  it('is only for waiting loops', () => {
    expect(() => stillWaiting(frozen({ type: 'task' }), makeContext(NOW))).toThrow(EngineError);
  });
});

describe('acceptance scenario 4 (engine half) — a refund arriving closes the loop', () => {
  it('resolving a WAITING loop records "reply received" then "resolved" and keeps the history', () => {
    const zara = frozen({ id: 'z', type: 'waiting', status: 'waiting', title: 'Zara refund', nextReviewAt: iso(at(2026, 9, 29, 10)) });
    const result = resolveLoop(zara, makeContext(NOW), 'Refund came');
    expect(result.updated[0]).toMatchObject({ status: 'resolved', resolvedAt: iso(NOW), nextReviewAt: zara.nextReviewAt });
    expect(eventTypes(result, 'z')).toEqual(['reply_received', 'resolved']);
    expect(result.events[0].note).toBe('Refund came');
    expect(result.created).toEqual([]);
  });

  it('tasks record "action completed"; other types just "resolved"', () => {
    expect(eventTypes(resolveLoop(frozen({ id: 'a', type: 'task' }), makeContext(NOW)), 'a')).toEqual(['action_completed', 'resolved']);
    expect(eventTypes(resolveLoop(frozen({ id: 'b', type: 'return_later' }), makeContext(NOW)), 'b')).toEqual(['resolved']);
  });

  it('cannot resolve twice', () => {
    expect(() => resolveLoop(frozen({ status: 'resolved' }), makeContext(NOW))).toThrow(/already closed/);
  });
});

describe('acceptance scenario 5 — RETURN_LATER "Act now" keeps the reason', () => {
  const jacket = frozen({
    id: 'j',
    type: 'return_later',
    status: 'scheduled',
    title: 'Reconsider brown jacket',
    rawContext: 'I like the brown jacket but M fit better than XS. Bring this back after payday.',
    nextActionOwner: 'user',
  });

  it('becomes a task that carries the original context; the parked loop is resolved', () => {
    const result = actNow(jacket, makeContext(NOW));
    const [task] = result.created;
    expect(task).toMatchObject({ type: 'task', title: 'Reconsider brown jacket', parentLoopId: 'j' });
    expect(task.rawContext).toContain('M fit better than XS');
    expect(result.updated[0]).toMatchObject({ id: 'j', status: 'resolved' });
    expect(eventTypes(result, 'j')).toEqual(['act_now', 'resolved']);
  });

  it('EVENT → TASK: "View result" becomes a task', () => {
    const event = frozen({ id: 'e', type: 'event', status: 'scheduled', title: 'Test result' });
    const result = eventToTask(event, makeContext(NOW));
    expect(result.created[0]).toMatchObject({ type: 'task', title: 'Check test result', parentLoopId: 'e' });
    expect(result.updated[0].status).toBe('resolved');
  });

  it('only applies to the right types', () => {
    expect(() => actNow(frozen({ type: 'task' }), makeContext(NOW))).toThrow(EngineError);
    expect(() => eventToTask(frozen({ type: 'task' }), makeContext(NOW))).toThrow(EngineError);
  });
});

describe('acceptance scenario 9 — natural-language reschedule does not duplicate', () => {
  it('moves the existing loop; nothing new is created', () => {
    const dentist = frozen({ id: 'd', nextReviewAt: iso(at(2026, 9, 24, 15)) });
    const result = rescheduleLoop(dentist, at(2026, 9, 25, 15), makeContext(NOW));
    expect(result.created).toEqual([]);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({ id: 'd', nextReviewAt: iso(at(2026, 9, 25, 15)), followUpPolicy: 'exact_time' });
    expect(eventTypes(result, 'd')).toEqual(['rescheduled']);
    expect(result.events[0].note).toBe('Moved to Friday · 15:00');
  });

  it('rescheduling a snoozed loop puts it back in play', () => {
    const result = rescheduleLoop(frozen({ status: 'snoozed' }), at(2026, 9, 25, 9), makeContext(NOW));
    expect(result.updated[0].status).toBe('active');
  });

  it('references have nothing to reschedule or snooze', () => {
    expect(() => rescheduleLoop(frozen({ type: 'reference' }), at(2026, 9, 25), makeContext(NOW))).toThrow(EngineError);
    expect(() => snoozeLoop(frozen({ type: 'reference' }), at(2026, 9, 25), makeContext(NOW))).toThrow(EngineError);
  });
});

describe('snooze, dismiss, reopen, edit', () => {
  it('snooze sets the status and the new review time; the past is not a valid snooze', () => {
    const result = snoozeLoop(frozen({ id: 's' }), at(2026, 9, 23, 10, 15), makeContext(NOW));
    expect(result.updated[0]).toMatchObject({ status: 'snoozed', nextReviewAt: iso(at(2026, 9, 23, 10, 15)) });
    expect(result.events[0]).toMatchObject({ eventType: 'snoozed', note: 'Until Today · 10:15' });
    expect(() => snoozeLoop(frozen(), NOW, makeContext(NOW))).toThrow(/future/);
  });

  it('a snoozed waiting loop stays owned by the other party', () => {
    const loop = frozen({ type: 'waiting', status: 'waiting', nextActionOwner: 'other' });
    expect(snoozeLoop(loop, at(2026, 9, 24, 9), makeContext(NOW)).updated[0].nextActionOwner).toBe('other');
  });

  it('dismiss archives — the loop and its history are kept, never deleted', () => {
    const result = dismissLoop(frozen({ id: 'x' }), makeContext(NOW));
    expect(result.updated[0].status).toBe('archived');
    expect(result.updated[0].resolvedAt).toBeNull();
    expect(result.events[0]).toMatchObject({ eventType: 'dismissed', note: 'Not relevant anymore' });
    expect(result.created).toEqual([]);
  });

  it('reopen brings a closed loop back, reusing a review time that is still ahead', () => {
    const closed = frozen({ status: 'resolved', resolvedAt: iso(NOW), nextReviewAt: iso(at(2026, 9, 30, 9)) });
    const result = reopenLoop(closed, makeContext(NOW));
    expect(result.updated[0]).toMatchObject({ status: 'active', resolvedAt: null, nextReviewAt: iso(at(2026, 9, 30, 9)) });
    expect(eventTypes(result, closed.id)).toEqual(['reopened']);
  });

  it('reopen picks a fresh time when the old one is past, per type', () => {
    const task = reopenLoop(frozen({ status: 'archived', nextReviewAt: iso(at(2026, 9, 1, 9)) }), makeContext(NOW));
    expect(task.updated[0].nextReviewAt).toBe(iso(at(2026, 9, 23, 11)));
    const waiting = reopenLoop(frozen({ type: 'waiting', status: 'resolved', nextReviewAt: null }), makeContext(NOW));
    expect(waiting.updated[0]).toMatchObject({ status: 'waiting', nextReviewAt: iso(at(2026, 9, 25, 10)) });
    const ref = reopenLoop(frozen({ type: 'reference', status: 'archived' }), makeContext(NOW));
    expect(ref.updated[0].nextReviewAt).toBeNull();
  });

  it('cannot reopen an open loop', () => {
    expect(() => reopenLoop(frozen(), makeContext(NOW))).toThrow(EngineError);
  });

  it('edit: text and time land in ONE row, with a timeline entry for each', () => {
    const loop = frozen({ id: 'e', type: 'task', title: 'Call dentist', nextReviewAt: iso(at(2026, 9, 24, 15)) });
    const result = editLoop(
      loop,
      { title: 'Call Dr. Yilmaz', entityName: 'Dr. Yilmaz', rawContext: 'about the crown', reviewAt: at(2026, 9, 25, 16) },
      makeContext(NOW),
    );
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({
      title: 'Call Dr. Yilmaz',
      entityName: 'Dr. Yilmaz',
      rawContext: 'about the crown',
      nextReviewAt: iso(at(2026, 9, 25, 16)),
      followUpPolicy: 'exact_time',
      timingConfidence: 1,
    });
    expect(eventTypes(result, 'e')).toEqual(['edited', 'rescheduled']);
    expect(result.events[0].note).toBe('Changed: title, person or company, note');
    expect(result.events[1].note).toBe('Moved to Friday · 16:00');
  });

  it('edit: fields that did not change produce no result at all', () => {
    const loop = frozen({ title: 'Call dentist', entityName: null, nextReviewAt: iso(at(2026, 9, 24, 15)) });
    const same = editLoop(loop, { title: ' Call dentist ', entityName: '  ', reviewAt: at(2026, 9, 24, 15) }, makeContext(NOW));
    expect(same).toEqual({ created: [], updated: [], events: [] });
  });

  it('edit: a time in the past, or on a reference, is refused; a blank note/person clears it', () => {
    const ctx = makeContext(NOW);
    expect(() => editLoop(frozen(), { reviewAt: at(2026, 9, 23, 9) }, ctx)).toThrow(/already passed/);
    expect(() => editLoop(frozen({ type: 'reference' }), { reviewAt: at(2026, 9, 25, 9) }, ctx)).toThrow(EngineError);
    const cleared = editLoop(frozen({ entityName: 'HR', rawContext: 'x' }), { entityName: ' ', rawContext: '  ' }, ctx);
    expect(cleared.updated[0]).toMatchObject({ entityName: null, rawContext: null });
  });

  it('edit: moving a snoozed loop puts it back in play; the policy follows the type', () => {
    const snoozed = frozen({ type: 'waiting', status: 'snoozed', nextActionOwner: 'other' });
    const r = editLoop(snoozed, { reviewAt: at(2026, 9, 30, 9) }, makeContext(NOW));
    expect(r.updated[0]).toMatchObject({ status: 'waiting', followUpPolicy: 'expected_date' });
  });

  it('edit: fixing the title of an OVERDUE loop works even though its review time is in the past', () => {
    const overdue = frozen({ id: 'o', nextReviewAt: iso(at(2026, 9, 20, 9)) });
    const result = editLoop(overdue, { title: 'Call the dentist', reviewAt: new Date(overdue.nextReviewAt as string) }, makeContext(NOW));
    expect(result.updated[0]).toMatchObject({ title: 'Call the dentist', nextReviewAt: overdue.nextReviewAt });
    expect(eventTypes(result, 'o')).toEqual(['edited']); // no bogus "rescheduled"
  });

  it('edit: a closed loop cannot be edited', () => {
    expect(() => editLoop(frozen({ status: 'resolved' }), { title: 'x' }, makeContext(NOW))).toThrow(/already closed/);
  });

  it('edit trims the title, keeps the rest, and records the edit', () => {
    const result = editLoop(frozen({ id: 'e' }), { title: '  Call Dr. Yılmaz ', entityName: 'Dr. Yılmaz' }, makeContext(NOW));
    expect(result.updated[0]).toMatchObject({ title: 'Call Dr. Yılmaz', entityName: 'Dr. Yılmaz', updatedAt: iso(NOW) });
    expect(eventTypes(result, 'e')).toEqual(['edited']);
    expect(() => editLoop(frozen(), { title: '  ' }, makeContext(NOW))).toThrow(EngineError);
  });
});

describe('engine hygiene', () => {
  it('never mutates its inputs (frozen loops would throw) and is deterministic', () => {
    const loop = frozen({ type: 'waiting', status: 'waiting', entityName: 'HR', followUpPolicy: 'reply_work' });
    const run = () => {
      const ctx = makeContext(NOW);
      return [stillWaiting(loop, ctx), followUp(loop, ctx), resolveLoop(loop, ctx), dismissLoop(loop, ctx)];
    };
    expect(run()).toEqual(run());
  });

  it('every event is stamped with the injected clock and a unique id', () => {
    const ctx = makeContext(NOW);
    const result = completeTaskAndWait(frozen({ id: 't' }), ctx);
    const ids = new Set([...result.events.map((e) => e.id), ...result.created.map((l) => l.id)]);
    expect(ids.size).toBe(result.events.length + result.created.length);
    for (const e of result.events) expect(e.createdAt).toBe(iso(NOW));
  });

  it('a chain of transitions keeps the parent/child graph consistent', () => {
    let loops: Loop[] = [frozen({ id: 'w', type: 'waiting', status: 'waiting', title: 'HR reply', entityName: 'HR', followUpPolicy: 'reply_work' })];
    const ctx = makeContext(NOW);

    loops = applyInMemory(loops, followUp(loops[0], ctx));
    const [parent, child] = loops;
    expect(child.parentLoopId).toBe(parent.id);
    expect(parent.status).toBe('active');

    loops = applyInMemory(loops, completeFollowUp(child, parent, ctx));
    expect(loops.find((l) => l.id === 'w')?.status).toBe('waiting');
    expect(loops.find((l) => l.id === child.id)?.status).toBe('resolved');

    loops = applyInMemory(loops, resolveLoop(loops[0], ctx, 'Got a reply'));
    expect(loops.every((l) => l.status === 'resolved')).toBe(true);
  });
});
