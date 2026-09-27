/**
 * What happens when the user taps a notification or one of its buttons. Pure with
 * respect to the OS: it only talks to `LoopService`, so the whole mapping — button →
 * engine transition → stored state → where the app should go next — is tested without a device.
 *
 * Buttons that need a screen (Done → "Does this end here?", Follow up, Act now, View)
 * bring the app forward; the rest resolve in the background.
 */
import { keepForLaterAt } from '@/engine/suggestions';
import { EngineError } from '@/engine/transitions';
import { CLOSED_STATUSES } from '@/engine/types';
import { ServiceError, type LoopService } from '@/services/loopService';

import { DEFAULT_TAP_ACTION, type NotificationActionId } from './categories';

/** Where the app should go after handling a response. */
export type Navigation =
  /** Open a loop's detail. `done` means "start the Done flow": the sheet asks "Does this end here?". */
  | { loopId: string; done?: boolean }
  | { home: true }
  | null;

export interface ResponseInput {
  /** `response.actionIdentifier`. */
  actionId: string;
  /** From the notification's `data.loopId`. */
  loopId: string | undefined;
}

export interface ResponseOutcome {
  /** False when nothing could be done (loop gone, already closed, unknown button). */
  handled: boolean;
  action: NotificationActionId | 'open' | 'unknown';
  navigate: Navigation;
  message: string | null;
}

const isNotificationAction = (id: string): id is NotificationActionId =>
  [
    'done', 'fulfilled', 'snooze_15_min', 'later_today', 'still_waiting', 'got_reply',
    'follow_up', 'keep_for_later', 'act_now', 'resolve', 'view', 'later',
  ].includes(id);

export async function handleNotificationResponse(
  service: LoopService,
  input: ResponseInput,
  now: Date,
): Promise<ResponseOutcome> {
  const home: ResponseOutcome = { handled: false, action: 'unknown', navigate: { home: true }, message: null };
  if (!input.loopId) return home;

  const bundle = await service.load(input.loopId);
  if (!bundle) return { ...home, message: 'That loop is not here anymore' };

  const { loopId } = input;
  const open = { loopId };

  // A plain tap, or something we do not recognise: just show the loop.
  if (input.actionId === DEFAULT_TAP_ACTION) return { handled: true, action: 'open', navigate: open, message: null };
  if (!isNotificationAction(input.actionId)) return { handled: false, action: 'unknown', navigate: open, message: null };
  const action = input.actionId;

  // The loop may have been dealt with in the app since the reminder was scheduled.
  if (CLOSED_STATUSES.includes(bundle.loop.status)) {
    return { handled: false, action, navigate: open, message: 'That one is already closed' };
  }

  try {
    switch (action) {
      case 'done':
        // No state change: the app opens and asks "Does this end here?" (a follow-up completes without asking).
        return { handled: true, action, navigate: { loopId, done: true }, message: null };

      case 'follow_up':
      case 'act_now':
      case 'view': {
        const outcome = await service.perform(loopId, action);
        return { handled: true, action, navigate: { loopId: outcome.focusLoopId ?? loopId }, message: outcome.message };
      }

      case 'keep_for_later': {
        const outcome = await service.perform(loopId, 'bring_back_later', { until: keepForLaterAt(now) });
        return { handled: true, action, navigate: null, message: outcome.message };
      }

      default: {
        const outcome = await service.perform(loopId, QUICK_ACTIONS[action]);
        return { handled: true, action, navigate: null, message: outcome.message };
      }
    }
  } catch (error) {
    if (error instanceof EngineError || error instanceof ServiceError) {
      return { handled: false, action, navigate: open, message: error.message };
    }
    throw error;
  }
}

/** Buttons that resolve in the background, and the loop action each one is. */
const QUICK_ACTIONS = {
  snooze_15_min: 'snooze_15',
  later_today: 'later_today',
  later: 'later_today',
  fulfilled: 'fulfilled',
  still_waiting: 'still_waiting',
  got_reply: 'got_reply',
  resolve: 'resolve',
} as const;
