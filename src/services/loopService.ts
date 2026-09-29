/**
 * The one place that turns an intent ("Got a reply", "Done", "15 min later") into stored
 * state. The screens and the notification-response handler both call it, so no state
 * transition is ever re-implemented in the UI.
 *
 * Every mutation is the same four steps:
 *   1. load the loop (and its parent) from the database
 *   2. run a PURE engine transition to get an `EngineResult`
 *   3. persist the result atomically (loops + timeline events, one transaction)
 *   4. re-sync the OS reminders for every loop the result touched
 *
 * Step 4 can fail without losing anything (see `scheduler.ts`).
 */
import { applyEngineResult } from '@/db/apply';
import { listEvents } from '@/db/events';
import { getLoop, listChildLoops, listOpenLoops } from '@/db/loops';
import type { Db } from '@/db/types';
import { laterSlot } from '@/engine/followUpPolicy';
import type { LoopAction } from '@/engine/suggestions';
import {
  EngineError,
  actNow,
  combineResults,
  completeFollowUp,
  completeTaskAndWait,
  confirmCandidates,
  dismissLoop,
  dismissFollowUp,
  doneFlowFor,
  editLoop,
  eventToTask,
  followUp,
  isPendingFollowUp,
  rescheduleLoop,
  repeatTask,
  resolveLoop,
  snoozeLoop,
  stillWaiting,
  withSaid,
  type LoopEdits,
  type WaitingOptions,
} from '@/engine/transitions';
import type { EngineContext, EngineResult, Loop, LoopEvent, LoopType } from '@/engine/types';
import { strings, type UiLang } from '@/i18n';
import type { NotificationScheduler } from '@/notifications/scheduler';
import type { LoopCandidate } from '@/parser/types';
import { formatWhen } from '@/utils/format';
import { addMinutes } from '@/utils/time';

export interface ServiceDeps {
  db: Db;
  scheduler: NotificationScheduler;
  /** Injected so tests (and the web harness) control time. */
  now?: () => Date;
  newId: () => string;
  /** Called after anything is stored, so screens can refresh — including changes made by a notification button. */
  onChange?: () => void;
  /** The language flash messages and reminders are written in. Defaults to English. */
  lang?: UiLang;
}

/** Everything a detail screen needs about one loop. */
export interface LoopBundle {
  loop: Loop;
  /** The loop this one was created from (a follow-up's waiting loop, a task's origin), if any. */
  parent: Loop | null;
  children: Loop[];
  /** Oldest first. */
  events: LoopEvent[];
}

export interface ActionOutcome {
  /** True if anything was stored. */
  changed: boolean;
  /** A loop the UI should open next — e.g. the task an action just created. */
  focusLoopId: string | null;
  /** One calm sentence to show the user. */
  message: string;
  /** A TASK "Done" that must first ask "Does this end here?". Nothing has changed yet. */
  ask?: 'does_this_end_here';
}

/** The loop is gone, or the request needs something it was not given. */
export class ServiceError extends Error {
  constructor(
    readonly code: 'not_found' | 'needs_time' | 'unsupported',
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface LoopService {
  load(id: string): Promise<LoopBundle | null>;
  listOpen(): Promise<Loop[]>;
  /** The Review screen's "Keep track of these". */
  keep(candidates: readonly LoopCandidate[], rawText: string): Promise<ActionOutcome>;
  /**
   * Any action from the detail screen, a notification button, or a typed update. `until` is needed for the
   * snooze-choice actions; `said` is what the user typed/said, and is kept in the loop's timeline.
   */
  perform(id: string, action: LoopAction, args?: { until?: Date; said?: string }): Promise<ActionOutcome>;
  /** "Move it to Friday": an explicit new time for an existing loop. Never creates a duplicate. */
  reschedule(id: string, at: Date, said?: string): Promise<ActionOutcome>;
  /** The second half of a TASK "Done": "Yes, done" or "I'm waiting for something". */
  finishTask(id: string, how: { endsHere: true; said?: string } | { waiting: WaitingOptions }): Promise<ActionOutcome>;
  edit(id: string, edits: LoopEdits): Promise<ActionOutcome>;
}

const NOTHING: ActionOutcome = { changed: false, focusLoopId: null, message: '' };

const requireTypes = (loop: Loop, action: string, ...types: LoopType[]): void => {
  if (!types.includes(loop.type)) throw new EngineError(`"${action}" does not apply to a ${loop.type} loop`);
};

export function createLoopService(deps: ServiceDeps): LoopService {
  const { db, scheduler, newId } = deps;
  const now = deps.now ?? (() => new Date());
  const lang = deps.lang ?? 'en';
  const s = strings(lang).service;

  async function load(id: string): Promise<LoopBundle | null> {
    const loop = await getLoop(db, id);
    if (!loop) return null;
    const [parent, children, events] = await Promise.all([
      loop.parentLoopId ? getLoop(db, loop.parentLoopId) : Promise.resolve(null),
      listChildLoops(db, id),
      listEvents(db, id),
    ]);
    return { loop, parent, children, events };
  }

  const context = (): EngineContext => ({ now: now(), newId });

  /** Persist a result, then re-sync reminders. Empty results store nothing. */
  async function commit(result: EngineResult, ctx: EngineContext): Promise<boolean> {
    const empty = !result.capture && result.created.length === 0 && result.updated.length === 0 && result.events.length === 0;
    if (empty) return false;
    await applyEngineResult(db, result);
    await scheduler.syncFor(result, ctx.now, lang);
    deps.onChange?.();
    return true;
  }

  async function need(id: string): Promise<LoopBundle> {
    const bundle = await load(id);
    if (!bundle) throw new ServiceError('not_found', 'This loop is not here anymore');
    return bundle;
  }

  /**
   * Closing a WAITING loop whose follow-up task is still open would leave that task pointing at
   * something finished. The follow-up is moot: set it aside, in the same transaction.
   */
  function withMootFollowUps(bundle: LoopBundle, ctx: EngineContext, result: EngineResult): EngineResult {
    if (bundle.loop.type !== 'waiting' || bundle.loop.status !== 'active') return result;
    const moot = bundle.children.filter((c) => c.type === 'task' && (c.status === 'active' || c.status === 'snoozed'));
    return combineResults(result, ...moot.map((child) => dismissLoop(child, ctx)));
  }

  const done = (message: string, result: EngineResult): ActionOutcome => ({
    changed: true,
    focusLoopId: result.created[0]?.id ?? null,
    message,
  });

  async function perform(id: string, action: LoopAction, args: { until?: Date; said?: string } = {}): Promise<ActionOutcome> {
    const bundle = await need(id);
    const { loop } = bundle;
    const ctx = context();
    const at = (d: Date) => formatWhen(d, ctx.now, lang);
    let result: EngineResult;
    let message: string;

    switch (action) {
      case 'done': {
        if (loop.type === 'event') {
          result = resolveLoop(loop, ctx, withSaid('Seen', args.said));
          message = s.markedSeen;
          break;
        }
        requireTypes(loop, 'Done', 'task');
        const flow = doneFlowFor(loop, bundle.parent);
        // An ordinary task must first be asked whether it ends here; nothing changes yet.
        if (flow.kind === 'ask_if_it_ends') return { ...NOTHING, ask: 'does_this_end_here' };
        // A follow-up needs no question: finishing it puts the waiting loop back on watch.
        result = completeFollowUp(loop, flow.parent, ctx);
        message = s.backToWaiting(flow.parent.entityName);
        break;
      }
      case 'fulfilled':
        requireTypes(loop, 'Fulfilled', 'promise');
        result = resolveLoop(loop, ctx, withSaid('Fulfilled', args.said));
        message = s.markedKept;
        break;
      case 'got_reply':
        requireTypes(loop, 'Got a reply', 'waiting');
        result = withMootFollowUps(bundle, ctx, resolveLoop(loop, ctx, withSaid('Got a reply', args.said)));
        message = s.gotReplyResolved;
        break;
      case 'resolve':
        // A follow-up that is resolved or set aside must hand the waiting loop back, or it vanishes.
        result = isPendingFollowUp(loop, bundle.parent)
          ? completeFollowUp(loop, bundle.parent as Loop, ctx)
          : withMootFollowUps(bundle, ctx, resolveLoop(loop, ctx, args.said ? withSaid('Resolved', args.said) : null));
        message = s.resolved;
        break;
      case 'dismiss':
        result = isPendingFollowUp(loop, bundle.parent)
          ? dismissFollowUp(loop, bundle.parent as Loop, ctx)
          : withMootFollowUps(bundle, ctx, dismissLoop(loop, ctx, args.said));
        message = s.setAside;
        break;
      case 'snooze_15': {
        const until = addMinutes(ctx.now, 15);
        result = snoozeLoop(loop, until, ctx);
        message = s.backIn15;
        break;
      }
      case 'later_today': {
        const until = laterSlot(ctx.now);
        result = snoozeLoop(loop, until, ctx);
        message = s.snoozedUntil(at(until));
        break;
      }
      case 'remind_later':
      case 'bring_back_later': {
        if (!args.until) throw new ServiceError('needs_time', 'Pick when to bring this back');
        result = snoozeLoop(loop, args.until, ctx);
        message = s.snoozedUntil(at(args.until));
        break;
      }
      case 'still_waiting': {
        result = stillWaiting(loop, ctx, args.said);
        const next = result.updated[0]?.nextReviewAt;
        message = next ? s.stillWaitingAsk(at(new Date(next))) : s.stillWaitingBare;
        break;
      }
      case 'follow_up':
        result = followUp(loop, ctx, args.said);
        message = s.followUpAdded;
        break;
      case 'act_now':
        result = actNow(loop, ctx);
        message = s.turnedIntoTask;
        break;
      case 'view':
        result = eventToTask(loop, ctx);
        message = s.addedTaskToCheck;
        break;
      case 'edit':
        throw new ServiceError('unsupported', 'Use edit() to change a loop');
    }

    await commit(result, ctx);
    return done(message, result);
  }

  return {
    load,
    listOpen: () => listOpenLoops(db),

    async keep(candidates, rawText) {
      const ctx = context();
      const result = confirmCandidates(candidates, rawText, ctx);
      await applyEngineResult(db, result);
      // Ask in context — right after the user chose to keep things — and only AFTER the data is safe.
      await scheduler.ensurePermission();
      await scheduler.syncFor(result, ctx.now, lang);
      deps.onChange?.();
      const n = result.created.length;
      return { changed: n > 0, focusLoopId: null, message: s.keeping(n) };
    },

    perform,

    async reschedule(id, at, said) {
      const bundle = await need(id);
      const ctx = context();
      const result = rescheduleLoop(bundle.loop, at, ctx, said);
      await commit(result, ctx);
      return done(s.movedTo(formatWhen(at, ctx.now, lang)), result);
    },

    async finishTask(id, how) {
      const bundle = await need(id);
      const ctx = context();
      requireTypes(bundle.loop, 'Done', 'task');
      // A follow-up has no "does this end here?": finishing it always hands the waiting loop back.
      if (isPendingFollowUp(bundle.loop, bundle.parent)) {
        const result = completeFollowUp(bundle.loop, bundle.parent as Loop, ctx);
        await commit(result, ctx);
        return done(s.backToWaiting(bundle.parent?.entityName ?? null), result);
      }
      if ('endsHere' in how) {
        const result = repeatTask(bundle.loop, ctx) ?? resolveLoop(bundle.loop, ctx, withSaid('Marked done', how.said));
        await commit(result, ctx);
        return done(bundle.loop.followUpPolicy?.startsWith('repeat_') ? s.movedTo(formatWhen(new Date(result.updated[0].nextReviewAt as string), ctx.now, lang)) : s.done, result);
      }
      const result = completeTaskAndWait(bundle.loop, ctx, how.waiting);
      await commit(result, ctx);
      return done(s.nowWaiting(result.created[0].title), result);
    },

    async edit(id, edits) {
      const bundle = await need(id);
      const ctx = context();
      const result = editLoop(bundle.loop, edits, ctx);
      const changed = await commit(result, ctx);
      return { changed, focusLoopId: null, message: changed ? s.saved : s.nothingChanged };
    },
  };
}
