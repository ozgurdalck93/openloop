/**
 * Notification categories and their action buttons (06_OPENLOOP_CLAUDE_CODE_MASTER_PROMPT.md
 * → "Notification categories"). Pure data — no native imports — so the planner, the
 * response handler and tests can use it. `expoApi.ts` registers these with the OS.
 */
import { strings, type UiLang } from '@/i18n';
import type { LoopType } from '@/engine/types';

export type NotificationCategoryKey = 'task' | 'promise' | 'waiting' | 'return_later' | 'event';

export const CATEGORY_IDS: Record<NotificationCategoryKey, string> = {
  task: 'openloop.task',
  promise: 'openloop.promise',
  waiting: 'openloop.waiting',
  return_later: 'openloop.return_later',
  event: 'openloop.event',
};

export type NotificationActionId =
  | 'done'
  | 'fulfilled'
  | 'snooze_15_min'
  | 'later_today'
  | 'still_waiting'
  | 'got_reply'
  | 'follow_up'
  | 'keep_for_later'
  | 'act_now'
  | 'resolve'
  | 'view'
  | 'later';

export interface NotificationAction {
  id: NotificationActionId;
  title: string;
  /**
   * Buttons that need a screen (a question to answer, a task to open) bring the
   * app forward; quick ones resolve in the background.
   */
  opensApp: boolean;
}

export const CATEGORY_ACTIONS: Record<NotificationCategoryKey, NotificationAction[]> = {
  // "Done" opens the app: completing a task asks "Does this end here?" — that transition is the product.
  task: [
    { id: 'done', title: 'Done', opensApp: true },
    { id: 'snooze_15_min', title: '15 min later', opensApp: false },
    { id: 'later_today', title: 'Later today', opensApp: false },
  ],
  // A promise has no "does this end here?" question: keeping it just closes it.
  promise: [
    { id: 'fulfilled', title: 'Fulfilled', opensApp: false },
    { id: 'snooze_15_min', title: '15 min later', opensApp: false },
    { id: 'later_today', title: 'Later today', opensApp: false },
  ],
  waiting: [
    { id: 'still_waiting', title: 'Still waiting', opensApp: false },
    { id: 'got_reply', title: 'Got a reply', opensApp: false },
    { id: 'follow_up', title: 'Follow up', opensApp: true },
  ],
  return_later: [
    { id: 'keep_for_later', title: 'Keep for later', opensApp: false },
    { id: 'act_now', title: 'Act now', opensApp: true },
    { id: 'resolve', title: 'Resolve', opensApp: false },
  ],
  event: [
    { id: 'view', title: 'View', opensApp: true },
    { id: 'later', title: 'Later', opensApp: false },
  ],
};

/** `CATEGORY_ACTIONS`, with button titles in the given language — what `expoApi.ts` actually registers. */
export function categoryActionsFor(lang: UiLang): Record<NotificationCategoryKey, NotificationAction[]> {
  const titles = strings(lang).notify.actions;
  const localized = (actions: NotificationAction[]): NotificationAction[] =>
    actions.map((action) => ({ ...action, title: titles[action.id] }));
  return {
    task: localized(CATEGORY_ACTIONS.task),
    promise: localized(CATEGORY_ACTIONS.promise),
    waiting: localized(CATEGORY_ACTIONS.waiting),
    return_later: localized(CATEGORY_ACTIONS.return_later),
    event: localized(CATEGORY_ACTIONS.event),
  };
}

/** expo-notifications reports a plain tap on the notification body with this identifier. */
export const DEFAULT_TAP_ACTION = 'expo.modules.notifications.actions.DEFAULT';

/** Which category a loop's reminder uses. References never notify. */
export function categoryKeyFor(type: LoopType): NotificationCategoryKey | null {
  switch (type) {
    case 'task':
      return 'task';
    case 'promise':
      return 'promise';
    case 'waiting':
      return 'waiting';
    case 'return_later':
      return 'return_later';
    case 'event':
      return 'event';
    case 'reference':
      return null;
  }
}
