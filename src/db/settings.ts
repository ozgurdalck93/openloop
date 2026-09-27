/** A small key/value table for app preferences (currently just the UI language override). */
import type { Db } from './types';

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

export async function deleteSetting(db: Db, key: string): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
}
