/**
 * Suggested follow-up timing (02_OPENLOOP_AUTOMATION_ENGINE.md → "Suggested
 * follow-up policy"). Every function returns a *suggestion*: the user can edit
 * it, and an explicit date from the user always wins.
 *
 * All computations are LOCAL time and pure (`now` is passed in).
 */
import {
  addBusinessDays,
  addDays,
  addHours,
  addMinutes,
  atTime,
  isSameDay,
  isWeekend,
  nextBusinessDay,
  nextWeekday,
  roundUpToHour,
  startOfNextMonth,
} from '@/utils/time';

import type { Loop, Milestone } from './types';

/** Stored in `loops.follow_up_policy` so a later "Still waiting" can reuse the same interval. */
export type FollowUpPolicyKey =
  | 'exact_time' // the user gave a date + time
  | 'context_time' // date (or nothing) given; time of day suggested from context
  | 'reply_work' // work reply: 1–2 business days
  | 'reply_casual' // casual reply: ~48h
  | 'admin_wait' // refund / admin: 3–5 business days
  | 'expected_date' // waiting, and the user named when to expect it
  | 'at_event' // event: at the expected date/time
  | 'before_due' // promise: before the commitment risks becoming late
  | 'milestone' // return-later: payday / weekend / next month / date
  | 'later_default' // a vague "later"
  | 'none'; // reference: no notification

export type WaitingKind = 'work' | 'casual' | 'admin';
export type TaskHint = 'call' | 'errand' | 'generic';

/** What the parser (or the user) already knows about when. */
export interface TimingInput {
  /** An absolute moment; check `hasTime` to know whether the clock part is real. */
  at: Date | null;
  /** True when the user gave a clock time or part of day (not just a date). */
  hasTime: boolean;
  milestone: Milestone | null;
  /** Human wording to show instead of a raw date, e.g. "After payday". */
  label?: string | null;
}

export interface ReviewSuggestion {
  at: Date | null;
  policy: FollowUpPolicyKey;
  /** How much to trust `at`: 0 = guessed from nothing, ~1 = user said exactly this. */
  confidence: number;
  label: string | null;
}

const MORNING_HOUR = 9;
const REVIEW_HOUR = 10; // business-hours follow-ups
const WAITING_DATE_HOUR = 11; // "Review Friday · 11:00"
const LATEST_HOUR = 20;

const dateOnlyHours: Record<TaskHint, number> = { call: 10, errand: 17, generic: 9 };

/** The next reasonable moment today (≥1h away, 09:00–20:00), else tomorrow morning. */
export function nextSlot(now: Date): Date {
  const candidate = roundUpToHour(addMinutes(now, 60));
  if (isSameDay(candidate, now)) {
    if (candidate.getHours() < MORNING_HOUR) return atTime(now, MORNING_HOUR);
    if (candidate.getHours() <= LATEST_HOUR) return candidate;
  }
  return atTime(addDays(now, 1), MORNING_HOUR);
}

/** A "later today" moment (~3h out, evening at the latest), else tomorrow at 10:00. */
export function laterSlot(now: Date): Date {
  const candidate = roundUpToHour(addHours(now, 3));
  if (isSameDay(candidate, now) && candidate.getHours() <= LATEST_HOUR) return candidate;
  return atTime(addDays(now, 1), REVIEW_HOUR);
}

/**
 * A day-only date plus a default hour ("today" + 10:00) can already be behind
 * us. Never suggest the past: fall back to the next reasonable slot, and trust
 * the result less.
 */
function settle(at: Date, now: Date, confidence: number): { at: Date; confidence: number } {
  if (at.getTime() > now.getTime()) return { at, confidence };
  return { at: nextSlot(now), confidence: Math.min(confidence, 0.5) };
}

/** ~48h out, on a clean hour (never "19:24"), kept inside waking hours. */
function casualReplySlot(now: Date): Date {
  const candidate = roundUpToHour(addHours(now, 48));
  if (candidate.getHours() < MORNING_HOUR) return atTime(candidate, MORNING_HOUR);
  if (candidate.getHours() > LATEST_HOUR) return atTime(addDays(candidate, 1), MORNING_HOUR);
  return candidate;
}

/** Friday 11:00 of this week; on/after that, the next business day; on a weekend, next Friday. */
function endOfWorkWeek(now: Date): Date {
  if (isWeekend(now)) return atTime(nextWeekday(now, 5), WAITING_DATE_HOUR);
  const friday = atTime(addDays(now, 5 - now.getDay()), WAITING_DATE_HOUR);
  if (friday.getTime() - now.getTime() > 60 * 60 * 1000) return friday;
  return atTime(nextBusinessDay(now), REVIEW_HOUR);
}

/**
 * The moment a named milestone points at. Most are exact enough ("this weekend").
 * "After payday" is NOT: we do not know the user's payday, so this is a plain
 * guess — just after the coming month boundary, when salaries are commonly paid.
 * Callers must present it as a suggestion the user can change (candidates carry
 * `timingSource: 'suggested'`); there is deliberately no payday setting yet.
 */
export function reviewForMilestone(now: Date, milestone: Milestone): Date {
  switch (milestone) {
    case 'payday':
      return atTime(addDays(startOfNextMonth(now), 1), REVIEW_HOUR);
    case 'weekend':
      // Saturday morning; if it is already Saturday, Sunday morning.
      return now.getDay() === 6 ? atTime(addDays(now, 1), REVIEW_HOUR) : atTime(nextWeekday(now, 6), REVIEW_HOUR);
    case 'this_week':
      return endOfWorkWeek(now);
    case 'next_week':
      return atTime(nextWeekday(now, 1), MORNING_HOUR);
    case 'next_month':
      return atTime(startOfNextMonth(now), MORNING_HOUR);
    case 'later':
      return laterSlot(now);
  }
}

function fromMilestone(now: Date, timing: TimingInput): ReviewSuggestion {
  const at = reviewForMilestone(now, timing.milestone as Milestone);
  // A guessed payday deserves less trust than "this weekend".
  const confidence = timing.milestone === 'payday' ? 0.35 : 0.5;
  return { at, policy: timing.milestone === 'later' ? 'later_default' : 'milestone', confidence, label: timing.label ?? null };
}

/** TASK: exact user time when available, otherwise a suggested time of day. */
export function suggestTaskReview(
  now: Date,
  timing: TimingInput,
  hint: TaskHint = 'generic',
): ReviewSuggestion {
  if (timing.at && timing.hasTime) {
    return { at: timing.at, policy: 'exact_time', confidence: 0.95, label: timing.label ?? null };
  }
  if (timing.at) {
    const s = settle(atTime(timing.at, dateOnlyHours[hint]), now, 0.75);
    return { ...s, policy: 'context_time', label: null };
  }
  if (timing.milestone) return fromMilestone(now, timing);
  return { at: nextSlot(now), policy: 'context_time', confidence: 0.3, label: null };
}

/** WAITING: an explicit expected date always wins; otherwise the interval depends on who we wait for. */
export function suggestWaitingReview(
  now: Date,
  timing: TimingInput,
  kind: WaitingKind,
): ReviewSuggestion {
  if (timing.at) {
    if (timing.hasTime) return { at: timing.at, policy: 'expected_date', confidence: 0.9, label: null };
    const s = settle(atTime(timing.at, WAITING_DATE_HOUR), now, 0.85);
    return { ...s, policy: 'expected_date', label: null };
  }
  if (timing.milestone === 'next_week') {
    // "they'll reply next week" → check at the end of next week.
    return {
      at: atTime(addDays(nextWeekday(now, 1), 4), WAITING_DATE_HOUR),
      policy: 'expected_date',
      confidence: 0.6,
      label: timing.label ?? null,
    };
  }
  if (timing.milestone && timing.milestone !== 'later') {
    return { ...fromMilestone(now, timing), policy: 'expected_date', confidence: 0.6 };
  }
  return defaultWaitingReview(now, kind);
}

/** The interval to use when nobody said when a reply is expected. */
export function defaultWaitingReview(now: Date, kind: WaitingKind): ReviewSuggestion {
  switch (kind) {
    case 'work':
      return { at: atTime(addBusinessDays(now, 2), REVIEW_HOUR), policy: 'reply_work', confidence: 0.4, label: null };
    case 'admin':
      return { at: atTime(addBusinessDays(now, 4), REVIEW_HOUR), policy: 'admin_wait', confidence: 0.4, label: null };
    case 'casual':
      return { at: casualReplySlot(now), policy: 'reply_casual', confidence: 0.4, label: null };
  }
}

/** EVENT: at the expected date/time. With no date at all there is nothing to schedule. */
export function suggestEventReview(now: Date, timing: TimingInput): ReviewSuggestion {
  if (timing.at && timing.hasTime) {
    return { at: timing.at, policy: 'at_event', confidence: 0.9, label: timing.label ?? null };
  }
  if (timing.at) {
    const s = settle(atTime(timing.at, MORNING_HOUR), now, 0.8);
    return { ...s, policy: 'at_event', label: null };
  }
  if (timing.milestone) return { ...fromMilestone(now, timing), policy: 'at_event' };
  return { at: null, policy: 'at_event', confidence: 0, label: null };
}

/** PROMISE: remind before the commitment risks becoming late (the morning of a due day). */
export function suggestPromiseReview(now: Date, timing: TimingInput): ReviewSuggestion {
  if (timing.at && timing.hasTime) {
    return { at: timing.at, policy: 'before_due', confidence: 0.9, label: timing.label ?? null };
  }
  if (timing.at) {
    const s = settle(atTime(timing.at, MORNING_HOUR), now, 0.8);
    return { ...s, policy: 'before_due', label: null };
  }
  if (timing.milestone) return { ...fromMilestone(now, timing), policy: 'before_due' };
  return { at: nextSlot(now), policy: 'before_due', confidence: 0.3, label: null };
}

/** RETURN_LATER: a contextual milestone when there is one, else a vague "later". */
export function suggestReturnLaterReview(
  now: Date,
  timing: TimingInput,
): ReviewSuggestion {
  if (timing.at && timing.hasTime) {
    return { at: timing.at, policy: 'exact_time', confidence: 0.9, label: timing.label ?? null };
  }
  if (timing.at) {
    const s = settle(atTime(timing.at, REVIEW_HOUR), now, 0.7);
    return { ...s, policy: 'milestone', label: timing.label ?? null };
  }
  if (timing.milestone) return fromMilestone(now, timing);
  return { at: laterSlot(now), policy: 'later_default', confidence: 0.3, label: null };
}

const CLOSED_OR_INACTIVE = new Set(['resolved', 'archived', 'draft']);

/** After "Still waiting": ask again after the same interval the loop was created with. */
export function nextReviewAfterStillWaiting(loop: Pick<Loop, 'followUpPolicy'>, now: Date): ReviewSuggestion {
  switch (loop.followUpPolicy) {
    case 'reply_casual':
      return defaultWaitingReview(now, 'casual');
    case 'admin_wait':
      return defaultWaitingReview(now, 'admin');
    default:
      // reply_work, or an expected date that has now passed: give it two more business days.
      return { ...defaultWaitingReview(now, 'work'), policy: (loop.followUpPolicy as FollowUpPolicyKey) ?? 'reply_work' };
  }
}

/** One soft follow-up if a reminder is ignored: tomorrow morning, phrased as "Still relevant?". */
export function softFollowUpAt(now: Date): Date {
  return atTime(addDays(now, 1), REVIEW_HOUR);
}

/** True when the loop should currently be resurfacing (open and its review time has arrived). */
export function isDue(loop: Pick<Loop, 'status' | 'nextReviewAt'>, now: Date): boolean {
  if (CLOSED_OR_INACTIVE.has(loop.status) || loop.nextReviewAt === null) return false;
  return new Date(loop.nextReviewAt).getTime() <= now.getTime();
}

const ADMIN_RE =
  /\b(refund|reimburs\w*|payment|paid|money|deposit|transfer|visa|permit|insurance|invoice|tax|bank|passport|claim|delivery|shipment|package|parcel|cargo|order|iade|para|odeme|vize|sigorta|fatura|vergi|banka|pasaport|kargo|siparis|paket)\b/;
const WORK_RE =
  /\b(hr|ik|manager|boss|client|recruit\w*|interview|offer|team|office|colleague|coworker|proposal|contract|hiring|job|application|mudur|patron|musteri|mulakat|ofis|teklif|sozlesme|basvuru)\b/;

/** How long a reply typically takes, from what we are waiting for and from whom. `text` must be folded (lowercase ASCII). */
export function classifyWaitingKind(input: { foldedText: string; entity?: string | null }): WaitingKind {
  const haystack = `${input.foldedText} ${(input.entity ?? '').toLowerCase()}`;
  if (ADMIN_RE.test(haystack)) return 'admin';
  if (WORK_RE.test(haystack)) return 'work';
  return 'casual';
}
