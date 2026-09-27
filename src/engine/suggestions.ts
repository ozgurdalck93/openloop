/**
 * User-facing suggestions: snooze choices, which actions a loop offers, and the
 * words we use to resurface things.
 *
 * Tone (03_OPENLOOP_UX_FLOW.md): calm, brief, contextual. No guilt, no
 * productivity-bro language, no streak punishment. Ignored reminders are met
 * with "Still relevant?", never "You missed…" (acceptance scenario 10).
 */
import { strings, type UiLang } from '@/i18n';
import { formatClock, partOfDayPhrase, waitingAge } from '@/utils/format';
import { addDays, addMinutes, atTime, isSameDay } from '@/utils/time';

import { fold } from '@/utils/fold';

import { classifyWaitingKind, defaultWaitingReview, laterSlot, reviewForMilestone } from './followUpPolicy';
import { CLOSED_STATUSES, type Loop } from './types';

// ---- snooze choices ------------------------------------------------------------------------

export type SnoozeKey = 'in_15_min' | 'later_today' | 'tomorrow_morning' | 'this_weekend' | 'next_week';

export interface SnoozeOption {
  key: SnoozeKey;
  label: string;
  at: Date;
}

/** Ordered soonest-first; options that would land on the same moment collapse into the first. */
export function snoozeOptions(now: Date, lang: UiLang = 'en'): SnoozeOption[] {
  const s = strings(lang);
  const candidates: SnoozeOption[] = [{ key: 'in_15_min', label: s.snooze.in15Min, at: addMinutes(now, 15) }];

  const later = laterSlot(now);
  if (isSameDay(later, now))
    candidates.push({ key: 'later_today', label: `${s.actions.later_today} · ${formatClock(later)}`, at: later });

  candidates.push(
    { key: 'tomorrow_morning', label: s.snooze.tomorrowMorning, at: atTime(addDays(now, 1), 9) },
    { key: 'this_weekend', label: s.snooze.thisWeekend, at: reviewForMilestone(now, 'weekend') },
    { key: 'next_week', label: s.snooze.nextWeek, at: reviewForMilestone(now, 'next_week') },
  );

  const seen = new Set<number>();
  return candidates.filter((o) => {
    const t = o.at.getTime();
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

// ---- which actions a loop offers ---------------------------------------------------------------

/**
 * Everything a user (or a notification button) can do to an open loop. The UI and the
 * notification handler both speak this vocabulary; `LoopService.perform` is the one place
 * that turns it into engine transitions.
 */
export type LoopAction =
  | 'done' // TASK: starts "Does this end here?"; EVENT: acknowledged
  | 'fulfilled' // PROMISE: kept
  | 'snooze_15' // 15 min later
  | 'later_today'
  | 'remind_later' // opens the snooze choices
  | 'bring_back_later' // RETURN_LATER: opens the snooze choices
  | 'still_waiting'
  | 'got_reply'
  | 'follow_up'
  | 'act_now'
  | 'resolve'
  | 'view' // EVENT: it happened — checking it becomes a task
  | 'edit'
  | 'dismiss';

export interface ActionChoice {
  id: LoopAction;
  label: string;
  /** 'main' actions are the buttons; 'more' are quieter (edit, set aside). */
  group: 'main' | 'more';
}

const main = (id: LoopAction, label: string): ActionChoice => ({ id, label, group: 'main' });
const more = (id: LoopAction, label: string): ActionChoice => ({ id, label, group: 'more' });

/**
 * The detail-screen actions per type, as specified:
 *   TASK  Done · 15 min later · Later today · Edit
 *   WAITING  Still waiting · Got a reply · Follow up · Remind me later
 *   RETURN_LATER  Act now · Bring back later · Resolve
 *   EVENT  View · Done · Later
 *   PROMISE  Fulfilled · Remind me later
 * Every open loop can also be edited and set aside.
 */
export function availableActions(loop: Loop, lang: UiLang = 'en'): ActionChoice[] {
  if (CLOSED_STATUSES.includes(loop.status) || loop.status === 'draft') return [];
  const a = strings(lang).actions;
  const EDIT = more('edit', a.edit);
  const DISMISS = more('dismiss', a.dismiss);
  switch (loop.type) {
    case 'task':
      return [main('done', a.done), main('snooze_15', a.snooze_15), main('later_today', a.later_today), EDIT, DISMISS];
    case 'waiting':
      // While a follow-up task is open the user's move is that task: don't offer to follow up twice.
      return loop.status === 'active'
        ? [main('got_reply', a.got_reply), EDIT, DISMISS]
        : [
            main('still_waiting', a.still_waiting),
            main('got_reply', a.got_reply),
            main('follow_up', a.follow_up),
            main('remind_later', a.remind_later),
            EDIT,
            DISMISS,
          ];
    case 'return_later':
      return [main('act_now', a.act_now), main('bring_back_later', a.bring_back_later), main('resolve', a.resolve), EDIT, DISMISS];
    case 'event':
      return [main('view', a.view), main('done', a.done), main('later_today', a.later), EDIT, DISMISS];
    case 'promise':
      return [main('fulfilled', a.fulfilled), main('remind_later', a.remind_later), EDIT, DISMISS];
    case 'reference':
      return [EDIT, DISMISS];
  }
}

/** What the "I'm waiting for something" form starts with. Everything is editable. */
export interface WaitingDefaults {
  entityName: string | null;
  expectedEvent: string;
  reviewAt: Date;
}

/**
 * Sensible starting values for "I'm waiting for something" after completing `task`: the task's own
 * person/company, "reply", and the follow-up interval for that kind of wait (work / admin / casual).
 */
export function waitingDefaultsFor(task: Loop, now: Date, lang: UiLang = 'en'): WaitingDefaults {
  const kind = classifyWaitingKind({ foldedText: fold(`${task.title} ${task.rawContext ?? ''}`), entity: task.entityName });
  const review = defaultWaitingReview(now, kind);
  return { entityName: task.entityName, expectedEvent: strings(lang).sheets.done.defaultExpected, reviewAt: review.at ?? laterSlot(now) };
}

/** "Keep for later" from a notification: an unhurried default, so it does not nag. */
export const keepForLaterAt = (now: Date): Date => reviewForMilestone(now, 'next_week');

// ---- words ---------------------------------------------------------------------------------------

export interface Copy {
  title: string;
  body: string;
}

/**
 * What the reminder says when a loop resurfaces (UX flow → "Notification copy").
 * Returns null for loops that never notify (references).
 */
export function resurfaceCopy(loop: Loop, now: Date, lang: UiLang = 'en'): Copy | null {
  const n = strings(lang).notify;
  switch (loop.type) {
    case 'reference':
      return null;
    case 'task': {
      const when = loop.nextReviewAt ? partOfDayPhrase(new Date(loop.nextReviewAt), lang) : strings(lang).format.partOfDay.today;
      return { title: loop.title, body: n.task(when) };
    }
    case 'waiting': {
      const age = waitingAge(new Date(loop.createdAt), now, lang);
      return loop.entityName ? n.waitingWithEntity(loop.entityName, age) : n.waitingBare(loop.title, age);
    }
    case 'event':
      return { title: loop.title, body: n.event() };
    case 'promise':
      return n.promise(loop.title, loop.entityName);
    case 'return_later':
      return n.returnLater(loop.title);
  }
}

/** The single gentle nudge after a reminder was ignored. Never blames. */
export function softFollowUpCopy(loop: Loop, lang: UiLang = 'en'): Copy {
  const n = strings(lang).notify;
  return loop.type === 'waiting' ? n.softWaiting(loop.title) : n.softOther(loop.title);
}

/** Unknown event types (from a newer app version) still render, just unlabelled by us. */
export function timelineLabel(eventType: string, lang: UiLang = 'en'): string {
  const labels = strings(lang).timeline as Record<string, string>;
  return labels[eventType] ?? eventType.replace(/_/g, ' ');
}

/** Prompts shown in-app, in the spec's words. */
export const PROMPTS = strings('en').prompts;
