/**
 * Keeps the OS's scheduled reminders in step with the database. All OS access goes
 * through `NotificationsApi`, so this logic is tested against a fake and real SQL;
 * `expoApi.ts` is the thin production binding.
 *
 * Contract: a reminder problem must NEVER lose or block a user's change. The loop is
 * already stored; if a reminder cannot be scheduled it is logged and the loop still
 * shows on Home.
 */
import { listLoops, setNotificationId } from '@/db/loops';
import type { Db } from '@/db/types';
import type { EngineResult, Loop } from '@/engine/types';
import type { UiLang } from '@/i18n';

import { planNotification } from './plan';
import { applyQuietHours } from './quietHours';
import { loadQuietHours } from './quietHoursStore';

export interface ScheduleRequest {
  title: string;
  body: string;
  categoryIdentifier: string;
  data: { loopId: string };
  fireAt: Date;
}

/** The slice of the OS notification API this app needs. */
export interface NotificationsApi {
  /** False where reminders cannot be scheduled at all (a browser). Everything then quietly does nothing. */
  readonly supported: boolean;
  getPermission(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermission(): Promise<boolean>;
  /** Channel + action-button categories, in the given language. Idempotent per language. */
  setUp(lang: UiLang): Promise<void>;
  schedule(request: ScheduleRequest): Promise<string>;
  cancel(id: string): Promise<void>;
}

export interface NotificationScheduler {
  /** Asks for permission if we still can. Call it in context — right after the user kept something. */
  ensurePermission(): Promise<boolean>;
  /** Re-syncs every loop an engine operation created or changed. */
  syncFor(result: EngineResult, now?: Date, lang?: UiLang): Promise<void>;
  syncLoops(loops: readonly Loop[], now?: Date, lang?: UiLang): Promise<void>;
  /** Self-heal at launch: make the OS schedule agree with the database. */
  resyncAll(now?: Date, lang?: UiLang): Promise<void>;
}

type Warn = (message: string, error: unknown) => void;

export function createScheduler(
  db: Db,
  api: NotificationsApi,
  warn: Warn = (m, e) => console.warn(m, e),
): NotificationScheduler {
  async function syncOne(loop: Loop, now: Date, lang: UiLang): Promise<void> {
    try {
      if (loop.notificationId) await api.cancel(loop.notificationId).catch(() => undefined);

      let id: string | null = null;
      const plan = api.supported ? planNotification(loop, now, lang) : null;
      if (plan && (await api.getPermission()).granted) {
        await api.setUp(lang);
        // Quiet hours hold the reminder back; the loop's own review time is untouched.
        const fireAt = applyQuietHours(plan.fireAt, await loadQuietHours(db));
        id = await api.schedule({
          title: plan.title,
          body: plan.body,
          categoryIdentifier: plan.categoryIdentifier,
          data: plan.data,
          fireAt,
        });
      }
      if (id !== loop.notificationId) await setNotificationId(db, loop.id, id);
    } catch (error) {
      warn(`Could not sync the reminder for "${loop.title}"`, error);
    }
  }

  const syncLoops = async (loops: readonly Loop[], now: Date = new Date(), lang: UiLang = 'en'): Promise<void> => {
    for (const loop of loops) await syncOne(loop, now, lang);
  };

  return {
    async ensurePermission() {
      if (!api.supported) return false;
      try {
        const current = await api.getPermission();
        if (current.granted) return true;
        if (!current.canAskAgain) return false;
        return await api.requestPermission();
      } catch (error) {
        warn('Could not check notification permission', error);
        return false;
      }
    },

    syncLoops,

    syncFor(result, now = new Date(), lang = 'en') {
      // A loop can appear once as created and once as updated; the last row wins.
      const byId = new Map<string, Loop>();
      for (const loop of [...result.created, ...result.updated]) byId.set(loop.id, loop);
      return syncLoops([...byId.values()], now, lang);
    },

    async resyncAll(now = new Date(), lang = 'en') {
      await syncLoops(await listLoops(db), now, lang);
    },
  };
}
