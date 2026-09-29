/**
 * The loop state machine (02_OPENLOOP_AUTOMATION_ENGINE.md → "Core transitions").
 *
 * Every function here is PURE: it takes the loops involved plus an
 * `EngineContext` (clock + id source) and returns an `EngineResult` describing
 * what should change — new loops, replacement rows, timeline events. Nothing is
 * stored, scheduled or sent here; `db/apply.ts` persists a result and the
 * notifications module re-syncs OS reminders from the loops it touched.
 *
 * Safety (spec): the engine never contacts anyone, sends anything, buys
 * anything or deletes user content. "Dismiss" archives; it does not delete.
 */
import type { LoopCandidate } from '@/parser/types';
import { formatWhen } from '@/utils/format';
import { toIso } from '@/utils/time';

import {
  defaultWaitingReview,
  nextReviewAfterStillWaiting,
  suggestTaskReview,
  type FollowUpPolicyKey,
  type TimingInput,
} from './followUpPolicy';
import { validateCandidate, type Issue } from './candidateEdit';
import { initialStatusFor, ownerFor, statedPolicy } from './typeRules';
import {
  CLOSED_STATUSES,
  type Capture,
  type EngineContext,
  type EngineResult,
  type Loop,
  type LoopEvent,
  type LoopEventType,
  type LoopType,
} from './types';

// Callers (and older imports) get the type rules from here as well.
export { initialStatusFor, ownerFor };

/** An operation the current state does not allow (e.g. "still waiting" on a task). */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

/** A candidate that cannot be kept yet. `issues[i]` belongs to the candidate at `index`. */
export class CandidateValidationError extends EngineError {
  readonly problems: { index: number; issues: Issue[] }[];

  constructor(problems: { index: number; issues: Issue[] }[]) {
    super(`${problems.length} loop(s) need fixing before they can be kept`);
    this.name = 'CandidateValidationError';
    this.problems = problems;
  }
}

// ---- small building blocks -------------------------------------------------------------

/** "No time given" — what the follow-up policy needs to pick a default. */
const NO_TIMING: TimingInput = { at: null, hasTime: false, milestone: null };

const isClosed = (loop: Loop): boolean => CLOSED_STATUSES.includes(loop.status);

function requireOpen(loop: Loop, action: string): void {
  if (isClosed(loop)) throw new EngineError(`Cannot ${action}: "${loop.title}" is already closed`);
}

/** A WAITING loop that stepped aside for its follow-up task ("active"): the user's move is that task. */
export const isSteppedAside = (loop: Loop): boolean => loop.type === 'waiting' && loop.status === 'active';

function requireNotSteppedAside(loop: Loop, action: string): void {
  if (isSteppedAside(loop)) {
    throw new EngineError(`Cannot ${action}: "${loop.title}" is waiting on its follow-up task — finish or set that aside first`);
  }
}

function requireType(loop: Loop, type: LoopType, action: string): void {
  if (loop.type !== type) throw new EngineError(`Cannot ${action}: "${loop.title}" is a ${loop.type} loop, not ${type}`);
}

function eventFor(ctx: EngineContext, loopId: string, eventType: LoopEventType, note: string | null = null): LoopEvent {
  return { id: ctx.newId(), loopId, eventType, note, createdAt: toIso(ctx.now) };
}

function newLoop(ctx: EngineContext, init: Partial<Loop> & Pick<Loop, 'type' | 'title'>): Loop {
  const stamp = toIso(ctx.now);
  return {
    id: ctx.newId(),
    captureId: null,
    status: initialStatusFor(init.type),
    rawContext: null,
    nextActionOwner: ownerFor(init.type),
    entityName: null,
    expectedEvent: null,
    nextReviewAt: null,
    closingCondition: null,
    followUpPolicy: null,
    classificationConfidence: null,
    timingConfidence: null,
    entityConfidence: null,
    parentLoopId: null,
    notificationId: null,
    createdAt: stamp,
    updatedAt: stamp,
    resolvedAt: null,
    ...init,
  };
}

/** A replacement row with a fresh `updated_at`. */
function touched(loop: Loop, ctx: EngineContext, changes: Partial<Loop>): Loop {
  return { ...loop, ...changes, updatedAt: toIso(ctx.now) };
}

const whenNote = (iso: string | null, ctx: EngineContext): string =>
  iso ? formatWhen(new Date(iso), ctx.now) : 'no date set';

// ---- capture → loops -----------------------------------------------------------------------

/**
 * The review screen's "Keep track of these": turns confirmed candidates into
 * stored loops, with their capture and first timeline events.
 */
export function confirmCandidates(candidates: readonly LoopCandidate[], rawText: string, ctx: EngineContext): EngineResult {
  if (candidates.length === 0) return { created: [], updated: [], events: [] };

  // The UI validates as the user edits; this is the backstop for stale or hand-built candidates.
  const problems = candidates
    .map((c, index) => ({ index, issues: validateCandidate(c, ctx.now) }))
    .filter((p) => p.issues.length > 0);
  if (problems.length > 0) throw new CandidateValidationError(problems);

  const capture: Capture = { id: ctx.newId(), rawText, createdAt: toIso(ctx.now) };
  const created: Loop[] = [];
  const events: LoopEvent[] = [];

  for (const c of candidates) {
    const title = c.title.trim();
    const loop = newLoop(ctx, {
      captureId: capture.id,
      type: c.type,
      title,
      rawContext: c.rawContext,
      nextActionOwner: c.nextActionOwner,
      entityName: c.entityName?.trim() || null,
      expectedEvent: c.expectedEvent,
      nextReviewAt: c.type === 'reference' ? null : c.nextReviewAt,
      closingCondition: c.type === 'reference' ? null : c.closingCondition,
      followUpPolicy: c.type === 'reference' ? 'none' : c.followUpPolicy,
      classificationConfidence: c.classificationConfidence,
      timingConfidence: c.timingConfidence,
      entityConfidence: c.entityConfidence,
    });
    created.push(loop);
    events.push(eventFor(ctx, loop.id, 'captured'));
    if (loop.type === 'waiting') events.push(eventFor(ctx, loop.id, 'waiting_started'));
    if (loop.nextReviewAt) {
      events.push(eventFor(ctx, loop.id, 'review_scheduled', `Review ${whenNote(loop.nextReviewAt, ctx)}`));
    }
  }
  return { capture, created, updated: [], events };
}

// ---- closing -----------------------------------------------------------------------------------

/**
 * Closes a loop: "Yes, done", "Got a reply", "Resolved", "Refund came". The
 * review time is kept as history, which also makes `reopenLoop` clean.
 */
export function resolveLoop(loop: Loop, ctx: EngineContext, note: string | null = null): EngineResult {
  requireOpen(loop, 'resolve');
  const stamp = toIso(ctx.now);
  const eventType: LoopEventType =
    loop.type === 'waiting' ? 'reply_received' : loop.type === 'task' || loop.type === 'promise' ? 'action_completed' : 'resolved';
  const events = [eventFor(ctx, loop.id, eventType, note)];
  // A distinct closing entry keeps the timeline readable: "Action completed" then "Resolved".
  if (eventType !== 'resolved') events.push(eventFor(ctx, loop.id, 'resolved'));
  return {
    created: [],
    updated: [touched(loop, ctx, { status: 'resolved', resolvedAt: stamp })],
    events,
  };
}

/** "Not relevant anymore" — archives (never deletes) and stops reminders. */
/** What the user actually said, appended to a timeline note — "Moved to Friday · 15:00 — “move the dentist to Friday”". */
export const withSaid = (note: string, said?: string): string => (said?.trim() ? `${note} — “${said.trim()}”` : note);

export function dismissLoop(loop: Loop, ctx: EngineContext, said?: string): EngineResult {
  requireOpen(loop, 'dismiss');
  return {
    created: [],
    updated: [touched(loop, ctx, { status: 'archived' })],
    events: [eventFor(ctx, loop.id, 'dismissed', withSaid('Not relevant anymore', said))],
  };
}

/** Undo for resolve/dismiss: back in play, reusing its review time if still ahead, else the next sensible slot. */
export function reopenLoop(loop: Loop, ctx: EngineContext): EngineResult {
  if (!isClosed(loop)) throw new EngineError(`Cannot reopen: "${loop.title}" is not closed`);
  const stillAhead = loop.nextReviewAt !== null && new Date(loop.nextReviewAt).getTime() > ctx.now.getTime();
  const fresh = loop.type === 'waiting' ? defaultWaitingReview(ctx.now, 'work') : suggestTaskReview(ctx.now, NO_TIMING);
  const nextReviewAt = loop.type === 'reference' ? null : stillAhead ? loop.nextReviewAt : fresh.at ? toIso(fresh.at) : null;
  return {
    created: [],
    updated: [touched(loop, ctx, { status: initialStatusFor(loop.type), resolvedAt: null, nextReviewAt })],
    events: [eventFor(ctx, loop.id, 'reopened')],
  };
}

// ---- TASK → WAITING ---------------------------------------------------------------------------

/** "HR reply" when we know who (and what) we are waiting for; otherwise it points back at the task. */
export function waitingTitleFromTask(task: Loop, entityName: string | null = task.entityName, expected = 'reply'): string {
  return entityName ? `${entityName} ${expected}` : `Response to: ${task.title}`;
}

export interface WaitingOptions {
  /** Override the generated title of the new WAITING loop. */
  title?: string;
  /** Who or what we are waiting on. Defaults to the task's own person/company; null = nobody named. */
  entityName?: string | null;
  /** What is awaited, e.g. "reply". */
  expectedEvent?: string;
  /** When to check. Defaults to the work-reply interval (1–2 business days). */
  reviewAt?: Date;
}

/**
 * The done-sheet's "I'm waiting for something": the task is completed AND a
 * linked WAITING loop starts, each timeline pointing at the other.
 */
export function completeTaskAndWait(task: Loop, ctx: EngineContext, options: WaitingOptions = {}): EngineResult {
  requireType(task, 'task', 'complete and wait');
  requireOpen(task, 'complete');

  if (options.reviewAt && options.reviewAt.getTime() <= ctx.now.getTime()) {
    throw new EngineError('That time has already passed');
  }
  const entityName = options.entityName === undefined ? task.entityName : options.entityName?.trim() || null;
  const expected = options.expectedEvent?.trim() || 'reply';
  const suggestion = defaultWaitingReview(ctx.now, 'work');
  const reviewAt = options.reviewAt ?? suggestion.at;
  const policy: FollowUpPolicyKey = options.reviewAt ? 'expected_date' : suggestion.policy;
  const waiting = newLoop(ctx, {
    captureId: task.captureId,
    type: 'waiting',
    title: options.title?.trim() || waitingTitleFromTask(task, entityName, expected),
    rawContext: task.rawContext,
    entityName,
    expectedEvent: expected,
    nextReviewAt: reviewAt ? toIso(reviewAt) : null,
    closingCondition: 'Reply received',
    followUpPolicy: policy,
    classificationConfidence: 1, // the user told us directly
    timingConfidence: options.reviewAt ? 1 : suggestion.confidence,
    entityConfidence: task.entityConfidence,
    parentLoopId: task.id,
  });

  const stamp = toIso(ctx.now);
  return {
    created: [waiting],
    updated: [touched(task, ctx, { status: 'resolved', resolvedAt: stamp })],
    events: [
      eventFor(ctx, task.id, 'action_completed', 'Marked done'),
      eventFor(ctx, task.id, 'waiting_started', `Now waiting: "${waiting.title}"`),
      eventFor(ctx, task.id, 'resolved'),
      eventFor(ctx, waiting.id, 'created', `After completing "${task.title}"`),
      eventFor(ctx, waiting.id, 'action_completed', `"${task.title}" was completed`),
      eventFor(ctx, waiting.id, 'waiting_started'),
      eventFor(ctx, waiting.id, 'review_scheduled', `Review ${whenNote(waiting.nextReviewAt, ctx)}`),
    ],
  };
}

// ---- WAITING → FOLLOW-UP TASK → WAITING ----------------------------------------------------------

/** "Follow up": a linked TASK appears; the waiting loop steps aside (it is the user's move now) but stays traceable. */
export function followUp(waiting: Loop, ctx: EngineContext, draft?: string): EngineResult {
  requireType(waiting, 'waiting', 'follow up');
  requireOpen(waiting, 'follow up');
  requireNotSteppedAside(waiting, 'follow up again');

  const suggestion = suggestTaskReview(ctx.now, NO_TIMING);
  const task = newLoop(ctx, {
    captureId: waiting.captureId,
    type: 'task',
    title: waiting.entityName ? `Follow up with ${waiting.entityName}` : `Follow up: ${waiting.title}`,
    rawContext: draft ? `${waiting.rawContext ? `${waiting.rawContext}\n\n` : ''}${draft}` : waiting.rawContext,
    entityName: waiting.entityName,
    nextReviewAt: suggestion.at ? toIso(suggestion.at) : null,
    closingCondition: 'You mark it done',
    followUpPolicy: suggestion.policy,
    classificationConfidence: 1,
    timingConfidence: suggestion.confidence,
    entityConfidence: waiting.entityConfidence,
    parentLoopId: waiting.id,
  });

  return {
    created: [task],
    updated: [touched(waiting, ctx, { status: 'active', nextActionOwner: 'user', nextReviewAt: null })],
    events: [
      eventFor(ctx, waiting.id, 'follow_up_created', `Follow-up: "${task.title}"`),
      eventFor(ctx, task.id, 'created', `Follow-up for "${waiting.title}"`),
      eventFor(ctx, task.id, 'review_scheduled', `Review ${whenNote(task.nextReviewAt, ctx)}`),
    ],
  };
}

/** Is `task` a follow-up whose parent is waiting for it to be done? */
export function isPendingFollowUp(task: Loop, parent: Loop | null): boolean {
  return (
    task.type === 'task' &&
    task.parentLoopId !== null &&
    parent !== null &&
    parent.id === task.parentLoopId &&
    parent.type === 'waiting' &&
    parent.status === 'active'
  );
}

/**
 * Puts a WAITING loop back on watch once its follow-up is over — however it ended. Without this
 * the parent would stay "active" (stepped aside for a follow-up that no longer exists), hidden
 * from Home with no reminder: the user's loop would simply vanish.
 */
function backOnWatch(task: Loop, parent: Loop, ctx: EngineContext, why: string): { loop: Loop; events: LoopEvent[] } {
  const next = nextReviewAfterStillWaiting(parent, ctx.now);
  const at = next.at ? toIso(next.at) : null;
  return {
    loop: touched(parent, ctx, { status: 'waiting', nextActionOwner: 'other', nextReviewAt: at, followUpPolicy: next.policy }),
    events: [
      eventFor(ctx, parent.id, 'follow_up_completed', `"${task.title}" ${why} — back to waiting`),
      eventFor(ctx, parent.id, 'waiting_started'),
      eventFor(ctx, parent.id, 'review_scheduled', `Review ${whenNote(at, ctx)}`),
    ],
  };
}

function requirePendingFollowUp(task: Loop, parent: Loop): void {
  if (!isPendingFollowUp(task, parent)) {
    throw new EngineError(`"${task.title}" is not a pending follow-up of "${parent.title}"`);
  }
}

/** The follow-up was done: the task closes and the parent returns to WAITING with a fresh review time. */
export function completeFollowUp(task: Loop, parent: Loop, ctx: EngineContext): EngineResult {
  requirePendingFollowUp(task, parent);
  requireOpen(task, 'complete');
  const back = backOnWatch(task, parent, ctx, 'done');
  return {
    created: [],
    updated: [touched(task, ctx, { status: 'resolved', resolvedAt: toIso(ctx.now) }), back.loop],
    events: [
      eventFor(ctx, task.id, 'action_completed', 'Marked done'),
      eventFor(ctx, task.id, 'resolved'),
      ...back.events,
    ],
  };
}

/** The follow-up is no longer needed ("Not relevant anymore"): it is set aside and the parent goes back to WAITING. */
export function dismissFollowUp(task: Loop, parent: Loop, ctx: EngineContext): EngineResult {
  requirePendingFollowUp(task, parent);
  requireOpen(task, 'dismiss');
  const back = backOnWatch(task, parent, ctx, 'set aside');
  return {
    created: [],
    updated: [touched(task, ctx, { status: 'archived' }), back.loop],
    events: [eventFor(ctx, task.id, 'dismissed', 'Not relevant anymore'), ...back.events],
  };
}

/** "Still waiting": keep the loop, ask again after the same kind of interval. */
export function stillWaiting(loop: Loop, ctx: EngineContext, said?: string): EngineResult {
  requireType(loop, 'waiting', 'keep waiting');
  requireOpen(loop, 'keep waiting');
  requireNotSteppedAside(loop, 'keep waiting');
  const next = nextReviewAfterStillWaiting(loop, ctx.now);
  const at = next.at ? toIso(next.at) : null;
  return {
    created: [],
    updated: [
      touched(loop, ctx, { status: 'waiting', nextActionOwner: 'other', nextReviewAt: at, followUpPolicy: next.policy }),
    ],
    events: [eventFor(ctx, loop.id, 'still_waiting', withSaid(`Next check: ${whenNote(at, ctx)}`, said))],
  };
}

// ---- RETURN_LATER / EVENT → TASK ----------------------------------------------------------------------

function spawnTask(source: Loop, title: string, ctx: EngineContext, sourceEvent: LoopEventType, sourceNote: string): EngineResult {
  const suggestion = suggestTaskReview(ctx.now, NO_TIMING);
  const task = newLoop(ctx, {
    captureId: source.captureId,
    type: 'task',
    title,
    rawContext: source.rawContext, // the reason travels with the item
    entityName: source.entityName,
    nextReviewAt: suggestion.at ? toIso(suggestion.at) : null,
    closingCondition: 'You mark it done',
    followUpPolicy: suggestion.policy,
    classificationConfidence: 1,
    timingConfidence: suggestion.confidence,
    entityConfidence: source.entityConfidence,
    parentLoopId: source.id,
  });
  return {
    created: [task],
    updated: [touched(source, ctx, { status: 'resolved', resolvedAt: toIso(ctx.now) })],
    events: [
      eventFor(ctx, source.id, sourceEvent, sourceNote),
      eventFor(ctx, source.id, 'resolved'),
      eventFor(ctx, task.id, 'created', `From "${source.title}"`),
      eventFor(ctx, task.id, 'review_scheduled', `Review ${whenNote(task.nextReviewAt, ctx)}`),
    ],
  };
}

/** RETURN_LATER "Act now": becomes a TASK that keeps the original context (the reason it was parked). */
export function actNow(loop: Loop, ctx: EngineContext): EngineResult {
  requireType(loop, 'return_later', 'act now');
  requireOpen(loop, 'act now');
  return spawnTask(loop, loop.title, ctx, 'act_now', 'Turned into a task');
}

/** EVENT "View result": the event happened; checking it becomes a TASK. */
export function eventToTask(event: Loop, ctx: EngineContext, title?: string): EngineResult {
  requireType(event, 'event', 'act on event');
  requireOpen(event, 'act on event');
  return spawnTask(event, title?.trim() || `Check ${event.title.charAt(0).toLowerCase()}${event.title.slice(1)}`, ctx, 'act_now', 'It happened — checking it');
}

// ---- timing changes -------------------------------------------------------------------------------------

/** "15 min later", "Later today", "Remind me later", "Bring back later". Waiting loops stay owned by the other party. */
export function snoozeLoop(loop: Loop, until: Date, ctx: EngineContext): EngineResult {
  requireOpen(loop, 'snooze');
  requireNotSteppedAside(loop, 'snooze');
  if (loop.type === 'reference') throw new EngineError('References do not resurface, so there is nothing to snooze');
  if (until.getTime() <= ctx.now.getTime()) throw new EngineError('A snooze must end in the future');
  const at = toIso(until);
  return {
    created: [],
    updated: [touched(loop, ctx, { status: 'snoozed', nextReviewAt: at })],
    events: [eventFor(ctx, loop.id, 'snoozed', `Until ${whenNote(at, ctx)}`)],
  };
}

/** "Move this to Friday": an explicit new time. No new loop, no duplicate. */
export function rescheduleLoop(loop: Loop, at: Date, ctx: EngineContext, said?: string): EngineResult {
  requireOpen(loop, 'reschedule');
  requireNotSteppedAside(loop, 'reschedule');
  if (loop.type === 'reference') throw new EngineError('References do not resurface, so there is nothing to reschedule');
  const iso = toIso(at);
  const status = loop.status === 'snoozed' ? initialStatusFor(loop.type) : loop.status;
  return {
    created: [],
    updated: [touched(loop, ctx, { status, nextReviewAt: iso, followUpPolicy: 'exact_time', timingConfidence: 1 })],
    events: [eventFor(ctx, loop.id, 'rescheduled', withSaid(`Moved to ${whenNote(iso, ctx)}`, said))],
  };
}

export interface LoopEdits {
  title?: string;
  /** The person or company; null/blank clears it. */
  entityName?: string | null;
  /** The note; null/blank clears it. */
  rawContext?: string | null;
  closingCondition?: string | null;
  /** A new review time, in the future. */
  reviewAt?: Date;
  /** A lightweight repeating task cadence, stored with its existing follow-up policy. */
  repeatEvery?: 'weekly' | 'monthly' | null;
}

const FIELD_LABELS = { title: 'title', entityName: 'person or company', rawContext: 'note', closingCondition: 'closing condition' } as const;

/**
 * User edits from the detail screen, applied together: text fields and (optionally) the
 * review time land in ONE updated row with one or two timeline entries. Fields that did
 * not actually change are ignored; if nothing changed the result is empty.
 */
export function editLoop(loop: Loop, edits: LoopEdits, ctx: EngineContext): EngineResult {
  requireOpen(loop, 'edit');
  const changes: Partial<Loop> = {};
  const changed: string[] = [];
  const set = <K extends keyof typeof FIELD_LABELS>(key: K, value: Loop[K]) => {
    if (loop[key] !== value) {
      changes[key] = value;
      changed.push(FIELD_LABELS[key]);
    }
  };

  if (edits.title !== undefined) {
    const title = edits.title.trim();
    if (!title) throw new EngineError('A loop needs a title');
    set('title', title);
  }
  if (edits.entityName !== undefined) set('entityName', edits.entityName?.trim() || null);
  if (edits.rawContext !== undefined) set('rawContext', edits.rawContext?.trim() ? edits.rawContext : null);
  if (edits.closingCondition !== undefined) set('closingCondition', edits.closingCondition?.trim() || null);
  if (edits.repeatEvery !== undefined) {
    const policy = edits.repeatEvery ? `repeat_${edits.repeatEvery}` : statedPolicy(loop.type);
    if (loop.followUpPolicy !== policy) { changes.followUpPolicy = policy; changed.push('repeat'); }
  }

  const events: LoopEvent[] = [];
  const reviewChanged = edits.reviewAt !== undefined && toIso(edits.reviewAt) !== loop.nextReviewAt;
  // Re-sending the loop's current time (an overdue loop whose title is being fixed) is not a change.
  if (reviewChanged && edits.reviewAt !== undefined) {
    requireNotSteppedAside(loop, 'reschedule');
    if (loop.type === 'reference') throw new EngineError('References do not resurface, so there is nothing to schedule');
    if (edits.reviewAt.getTime() <= ctx.now.getTime()) throw new EngineError('That time has already passed');
  }
  if (reviewChanged && edits.reviewAt) {
    Object.assign(changes, {
      nextReviewAt: toIso(edits.reviewAt),
      status: loop.status === 'snoozed' ? initialStatusFor(loop.type) : loop.status,
      followUpPolicy: statedPolicy(loop.type),
      timingConfidence: 1,
    });
  }

  if (changed.length === 0 && !reviewChanged) return { created: [], updated: [], events: [] };
  if (changed.length > 0) events.push(eventFor(ctx, loop.id, 'edited', `Changed: ${changed.join(', ')}`));
  if (reviewChanged && edits.reviewAt) {
    events.push(eventFor(ctx, loop.id, 'rescheduled', `Moved to ${whenNote(toIso(edits.reviewAt), ctx)}`));
  }
  return { created: [], updated: [touched(loop, ctx, changes)], events };
}

/** A repeated task stays open and moves forward; it never creates a duplicate. */
export function repeatTask(loop: Loop, ctx: EngineContext): EngineResult | null {
  if (loop.type !== 'task' || (loop.followUpPolicy !== 'repeat_weekly' && loop.followUpPolicy !== 'repeat_monthly')) return null;
  const next = new Date(ctx.now);
  if (loop.followUpPolicy === 'repeat_weekly') next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return { created: [], updated: [touched(loop, ctx, { status: 'scheduled', nextActionOwner: 'user', nextReviewAt: toIso(next) })], events: [eventFor(ctx, loop.id, 'rescheduled', `Repeats ${loop.followUpPolicy === 'repeat_weekly' ? 'weekly' : 'monthly'} — next ${whenNote(toIso(next), ctx)}`)] };
}

// ---- what "Done" means for a given task ------------------------------------------------------------------

export type DoneFlow =
  /** Show "Does this end here?" — Yes, done / I'm waiting for something. */
  | { kind: 'ask_if_it_ends' }
  /** A follow-up: no question, the parent goes back to waiting. */
  | { kind: 'return_to_waiting'; parent: Loop };

export function doneFlowFor(task: Loop, parent: Loop | null): DoneFlow {
  return parent !== null && isPendingFollowUp(task, parent)
    ? { kind: 'return_to_waiting', parent }
    : { kind: 'ask_if_it_ends' };
}

// ---- combining results ---------------------------------------------------------------------------------------

/**
 * Merges results that touch DIFFERENT loops (e.g. resolving a waiting loop and dismissing its
 * now-pointless follow-up task) so they can be persisted in one transaction. Two replacement
 * rows for the same loop would silently overwrite each other, so that is refused.
 */
export function combineResults(...results: EngineResult[]): EngineResult {
  const updatedIds = new Set<string>();
  for (const result of results) {
    for (const loop of result.updated) {
      if (updatedIds.has(loop.id)) throw new EngineError(`Two changes to the same loop (${loop.id}) cannot be combined`);
      updatedIds.add(loop.id);
    }
  }
  return {
    capture: results.find((r) => r.capture)?.capture,
    created: results.flatMap((r) => r.created),
    updated: results.flatMap((r) => r.updated),
    events: results.flatMap((r) => r.events),
  };
}
