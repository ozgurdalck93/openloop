import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { makeLoop } from '../../test/fixtures';
import { openTestDb, type TestDb } from '../../test/nodeSqliteDb';
import { applyEngineResult } from './apply';
import { getCapture, insertCapture, listCaptures } from './captures';
import { insertEvent, listEvents } from './events';
import {
  getLoop,
  insertLoop,
  listChildLoops,
  listLoops,
  listLoopsDueBy,
  listOpenLoops,
  setNotificationId,
  updateLoop,
} from './loops';
import { LATEST_SCHEMA_VERSION, getSchemaVersion, migrate } from './migrations';

const opened: TestDb[] = [];
async function freshDb(path?: string): Promise<TestDb> {
  const db = openTestDb(path);
  opened.push(db);
  await migrate(db);
  return db;
}
afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed by the test */
    }
  }
});

describe('migrations', () => {
  it('creates the schema and records the version', async () => {
    const db = await freshDb();
    expect(await getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(['captures', 'loop_events', 'loops', 'settings']);
  });

  it('is idempotent', async () => {
    const db = await freshDb();
    await migrate(db);
    await migrate(db);
    expect(await getSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('refuses a database written by a newer app', async () => {
    const db = openTestDb();
    opened.push(db);
    await db.execAsync(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });

  it('has the spec columns on every table', async () => {
    const db = await freshDb();
    const cols = async (table: string) =>
      (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
    expect(await cols('captures')).toEqual(['id', 'raw_text', 'created_at']);
    expect(await cols('loop_events')).toEqual(['id', 'loop_id', 'event_type', 'note', 'created_at']);
    expect(await cols('loops')).toEqual([
      'id',
      'capture_id',
      'type',
      'status',
      'title',
      'raw_context',
      'next_action_owner',
      'entity_name',
      'expected_event',
      'next_review_at',
      'closing_condition',
      'follow_up_policy',
      'classification_confidence',
      'timing_confidence',
      'entity_confidence',
      'parent_loop_id',
      'notification_id',
      'created_at',
      'updated_at',
      'resolved_at',
    ]);
  });
});

describe('loops repository', () => {
  it('round-trips every field', async () => {
    const db = await freshDb();
    await insertCapture(db, { id: 'cap-1', rawText: 'hello', createdAt: '2026-09-26T10:00:00.000Z' });
    const loop = makeLoop({
      captureId: 'cap-1',
      type: 'waiting',
      status: 'waiting',
      title: 'HR reply',
      rawContext: 'I emailed HR',
      nextActionOwner: 'other',
      entityName: 'HR',
      expectedEvent: 'reply',
      nextReviewAt: '2026-09-28T08:00:00.000Z',
      closingCondition: 'Reply received',
      followUpPolicy: 'reply_work',
      classificationConfidence: 0.9,
      timingConfidence: 0.4,
      entityConfidence: 0.8,
      notificationId: 'n-1',
    });
    await insertLoop(db, loop);
    expect(await getLoop(db, 'loop-1')).toEqual(loop);
  });

  it('returns null for a missing loop', async () => {
    const db = await freshDb();
    expect(await getLoop(db, 'nope')).toBeNull();
  });

  it('updates mutable columns but never id, capture_id or created_at', async () => {
    const db = await freshDb();
    const loop = makeLoop();
    await insertLoop(db, loop);
    const changed = { ...loop, title: 'Call the dentist', status: 'snoozed' as const, createdAt: 'tampered' };
    expect(await updateLoop(db, changed)).toBe(true);
    const stored = await getLoop(db, loop.id);
    expect(stored?.title).toBe('Call the dentist');
    expect(stored?.status).toBe('snoozed');
    expect(stored?.createdAt).toBe(loop.createdAt);
  });

  it('reports false when updating a loop that does not exist', async () => {
    const db = await freshDb();
    expect(await updateLoop(db, makeLoop({ id: 'ghost' }))).toBe(false);
  });

  it('rejects rows with an invalid enum value instead of silently returning them', async () => {
    const db = await freshDb();
    await insertLoop(db, makeLoop());
    await db.runAsync("UPDATE loops SET type = 'kanban' WHERE id = 'loop-1'");
    await expect(getLoop(db, 'loop-1')).rejects.toThrow(/loops\.type/);
  });

  it('lists open loops ordered by review time, undated last', async () => {
    const db = await freshDb();
    await insertLoop(db, makeLoop({ id: 'a', nextReviewAt: '2026-10-02T09:00:00.000Z' }));
    await insertLoop(db, makeLoop({ id: 'b', nextReviewAt: null }));
    await insertLoop(db, makeLoop({ id: 'c', nextReviewAt: '2026-09-30T09:00:00.000Z' }));
    await insertLoop(db, makeLoop({ id: 'd', status: 'resolved' }));
    await insertLoop(db, makeLoop({ id: 'e', status: 'archived' }));
    await insertLoop(db, makeLoop({ id: 'f', status: 'draft' }));
    expect((await listOpenLoops(db)).map((l) => l.id)).toEqual(['c', 'a', 'b']);
  });

  it('filters by type and status', async () => {
    const db = await freshDb();
    await insertLoop(db, makeLoop({ id: 'a', type: 'waiting', status: 'waiting' }));
    await insertLoop(db, makeLoop({ id: 'b', type: 'task', status: 'active' }));
    expect((await listLoops(db, { types: ['waiting'] })).map((l) => l.id)).toEqual(['a']);
    expect((await listLoops(db, { statuses: ['active'] })).map((l) => l.id)).toEqual(['b']);
    expect(await listLoops(db, { statuses: ['snoozed'] })).toEqual([]);
  });

  it('finds due loops and child loops', async () => {
    const db = await freshDb();
    await insertLoop(db, makeLoop({ id: 'p', nextReviewAt: '2026-09-26T09:00:00.000Z' }));
    await insertLoop(db, makeLoop({ id: 'later', nextReviewAt: '2026-09-27T09:00:00.000Z' }));
    await insertLoop(db, makeLoop({ id: 'closed', status: 'resolved', nextReviewAt: '2026-09-25T09:00:00.000Z' }));
    await insertLoop(db, makeLoop({ id: 'kid', parentLoopId: 'p' }));
    expect((await listLoopsDueBy(db, '2026-09-26T12:00:00.000Z')).map((l) => l.id)).toEqual(['p']);
    expect((await listChildLoops(db, 'p')).map((l) => l.id)).toEqual(['kid']);
  });

  it('stores a notification id without bumping updated_at', async () => {
    const db = await freshDb();
    await insertLoop(db, makeLoop());
    await setNotificationId(db, 'loop-1', 'os-notif-9');
    const stored = await getLoop(db, 'loop-1');
    expect(stored?.notificationId).toBe('os-notif-9');
    expect(stored?.updatedAt).toBe(makeLoop().updatedAt);
  });

  it('enforces foreign keys: events need an existing loop', async () => {
    const db = await freshDb();
    await expect(
      insertEvent(db, { id: 'e1', loopId: 'ghost', eventType: 'captured', note: null, createdAt: 'x' }),
    ).rejects.toThrow();
  });

  it('keeps children when a parent is deleted (parent_loop_id set to NULL) and drops its events', async () => {
    const db = await freshDb();
    await insertLoop(db, makeLoop({ id: 'p' }));
    await insertLoop(db, makeLoop({ id: 'kid', parentLoopId: 'p' }));
    await insertEvent(db, { id: 'e1', loopId: 'p', eventType: 'captured', note: null, createdAt: 'x' });
    await db.runAsync("DELETE FROM loops WHERE id = 'p'");
    expect((await getLoop(db, 'kid'))?.parentLoopId).toBeNull();
    expect(await listEvents(db, 'p')).toEqual([]);
  });
});

describe('events and captures', () => {
  it('returns the timeline oldest-first and keeps insertion order for same-instant events', async () => {
    const db = await freshDb();
    await insertLoop(db, makeLoop());
    const t = '2026-09-26T10:00:00.000Z';
    await insertEvent(db, { id: 'e1', loopId: 'loop-1', eventType: 'captured', note: null, createdAt: t });
    await insertEvent(db, { id: 'e2', loopId: 'loop-1', eventType: 'review_scheduled', note: 'Friday', createdAt: t });
    await insertEvent(db, { id: 'e0', loopId: 'loop-1', eventType: 'created', note: null, createdAt: '2026-09-25T10:00:00.000Z' });
    expect((await listEvents(db, 'loop-1')).map((e) => e.id)).toEqual(['e0', 'e1', 'e2']);
  });

  it('stores and lists captures newest-first', async () => {
    const db = await freshDb();
    await insertCapture(db, { id: 'c1', rawText: 'first', createdAt: '2026-09-25T10:00:00.000Z' });
    await insertCapture(db, { id: 'c2', rawText: 'second', createdAt: '2026-09-26T10:00:00.000Z' });
    expect((await listCaptures(db)).map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(await getCapture(db, 'c1')).toEqual({ id: 'c1', rawText: 'first', createdAt: '2026-09-25T10:00:00.000Z' });
  });
});

describe('applyEngineResult', () => {
  it('commits capture, loops, updates and events together', async () => {
    const db = await freshDb();
    await insertLoop(db, makeLoop({ id: 'old' }));
    await applyEngineResult(db, {
      capture: { id: 'cap', rawText: 'raw', createdAt: 'x' },
      created: [makeLoop({ id: 'new', captureId: 'cap' })],
      updated: [makeLoop({ id: 'old', status: 'resolved' })],
      events: [{ id: 'e', loopId: 'new', eventType: 'captured', note: null, createdAt: 'x' }],
    });
    expect((await getLoop(db, 'new'))?.captureId).toBe('cap');
    expect((await getLoop(db, 'old'))?.status).toBe('resolved');
    expect(await listEvents(db, 'new')).toHaveLength(1);
  });

  it('rolls everything back if any step fails', async () => {
    const db = await freshDb();
    await expect(
      applyEngineResult(db, {
        capture: { id: 'cap', rawText: 'raw', createdAt: 'x' },
        created: [makeLoop({ id: 'new', captureId: 'cap' })],
        updated: [makeLoop({ id: 'does-not-exist' })],
        events: [],
      }),
    ).rejects.toThrow(/does not exist/);
    expect(await getCapture(db, 'cap')).toBeNull();
    expect(await getLoop(db, 'new')).toBeNull();
  });

  it('survives an app restart (close and reopen the same file)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'openloop-'));
    const file = join(dir, 'restart.db');
    let second: TestDb | undefined;
    try {
      const first = await freshDb(file);
      await applyEngineResult(first, {
        capture: { id: 'cap', rawText: 'raw', createdAt: 'x' },
        created: [makeLoop({ id: 'kept', title: 'HR reply', type: 'waiting', status: 'waiting' })],
        updated: [],
        events: [{ id: 'e', loopId: 'kept', eventType: 'captured', note: null, createdAt: 'x' }],
      });
      first.close();

      second = await freshDb(file); // migrate() again on an existing file
      expect((await getLoop(second, 'kept'))?.title).toBe('HR reply');
      expect(await listEvents(second, 'kept')).toHaveLength(1);
      expect(await getSchemaVersion(second)).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      second?.close(); // Windows refuses to delete a file that is still open
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
