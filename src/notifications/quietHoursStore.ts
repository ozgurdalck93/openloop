import { getSetting, setSetting } from '@/db/settings';
import type { Db } from '@/db/types';

import { DEFAULT_QUIET_HOURS, parseQuietHours, type QuietHours } from './quietHours';

const KEY = 'quiet_hours';

/** Never throws: a reminder must not be lost because a preference could not be read. */
export async function loadQuietHours(db: Db): Promise<QuietHours> {
  try {
    return parseQuietHours(await getSetting(db, KEY));
  } catch {
    return DEFAULT_QUIET_HOURS;
  }
}

export async function saveQuietHours(db: Db, value: QuietHours): Promise<void> {
  await setSetting(db, KEY, JSON.stringify(value));
}
