import type { UiLang } from '@/i18n';
/**
 * Domain model. Mirrors 02_OPENLOOP_AUTOMATION_ENGINE.md and the SQLite schema
 * in 06_OPENLOOP_CLAUDE_CODE_MASTER_PROMPT.md. TypeScript uses camelCase; the
 * db layer maps to/from snake_case columns.
 */

export const LOOP_TYPES = ['task', 'waiting', 'event', 'promise', 'return_later', 'reference'] as const;
export type LoopType = (typeof LOOP_TYPES)[number];

export const LOOP_STATUSES = [
  'draft',
  'active',
  'waiting',
  'scheduled',
  'snoozed',
  'resolved',
  'archived',
] as const;
export type LoopStatus = (typeof LOOP_STATUSES)[number];

export const NEXT_ACTION_OWNERS = ['user', 'other', 'system', 'none'] as const;
export type NextActionOwner = (typeof NEXT_ACTION_OWNERS)[number];

/** Statuses in which a loop is finished and never resurfaces on its own. */
export const CLOSED_STATUSES: readonly LoopStatus[] = ['resolved', 'archived'];

export interface Loop {
  id: string;
  captureId: string | null;
  type: LoopType;
  status: LoopStatus;
  title: string;
  rawContext: string | null;
  nextActionOwner: NextActionOwner;
  entityName: string | null;
  expectedEvent: string | null;
  /** ISO-8601 (UTC). When the loop should next resurface. */
  nextReviewAt: string | null;
  closingCondition: string | null;
  /** A FollowUpPolicyKey (see followUpPolicy.ts) or null. */
  followUpPolicy: string | null;
  classificationConfidence: number | null;
  timingConfidence: number | null;
  entityConfidence: number | null;
  parentLoopId: string | null;
  notificationId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/** Timeline entry. `event_type` is stored as free TEXT so new kinds never need a migration. */
export const LOOP_EVENT_TYPES = [
  'captured',
  'created',
  'action_completed',
  'waiting_started',
  'review_scheduled',
  'still_waiting',
  'reply_received',
  'follow_up_created',
  'follow_up_completed',
  'snoozed',
  'rescheduled',
  'act_now',
  'resolved',
  'dismissed',
  'reopened',
  'edited',
] as const;
export type LoopEventType = (typeof LOOP_EVENT_TYPES)[number];

export interface LoopEvent {
  id: string;
  loopId: string;
  eventType: LoopEventType;
  note: string | null;
  createdAt: string;
}

export interface Capture {
  id: string;
  rawText: string;
  createdAt: string;
}

/** Calendar-ish anchors the user can name instead of a date. */
export type Milestone = 'payday' | 'weekend' | 'this_week' | 'next_week' | 'next_month' | 'later';

/** What the Review screen shows instead of a raw date when a time came from a milestone. */
export const MILESTONE_LABEL: Record<Milestone, string> = {
  payday: 'After payday',
  weekend: 'This weekend',
  this_week: 'This week',
  next_week: 'Next week',
  next_month: 'Next month',
  later: 'Later',
};

/**
 * Everything the engine needs from the outside world. Injected so transitions
 * stay pure and deterministic under test.
 */
export interface EngineContext {
  now: Date;
  newId: () => string;
  /** Language for text the engine generates as TITLES (notes stay English and are translated on display). Default 'en'. */
  lang?: UiLang;
}

/**
 * The outcome of one engine operation. Nothing here touches storage or the OS;
 * `db/apply.ts` persists it and `notifications` syncs OS reminders from it.
 */
export interface EngineResult {
  capture?: Capture;
  created: Loop[];
  /** Full replacement rows for loops that already existed. */
  updated: Loop[];
  events: LoopEvent[];
}
