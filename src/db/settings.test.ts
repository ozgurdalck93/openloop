import { afterEach, describe, expect, it } from 'vitest';

import { openTestDb, type TestDb } from '../../test/nodeSqliteDb';
import { deleteSetting, getSetting, setSetting } from './settings';
import { migrate } from './migrations';

const opened: TestDb[] = [];
async function freshDb(): Promise<TestDb> {
  const db = openTestDb();
  opened.push(db);
  await migrate(db);
  return db;
}
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe('settings', () => {
  it('returns null for a key that was never set', async () => {
    const db = await freshDb();
    expect(await getSetting(db, 'ui_lang')).toBeNull();
  });

  it('stores and overwrites a value', async () => {
    const db = await freshDb();
    await setSetting(db, 'ui_lang', 'tr');
    expect(await getSetting(db, 'ui_lang')).toBe('tr');
    await setSetting(db, 'ui_lang', 'en');
    expect(await getSetting(db, 'ui_lang')).toBe('en');
  });

  it('deletes a value', async () => {
    const db = await freshDb();
    await setSetting(db, 'ui_lang', 'tr');
    await deleteSetting(db, 'ui_lang');
    expect(await getSetting(db, 'ui_lang')).toBeNull();
  });
});
