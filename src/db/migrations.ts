import type { Db } from './types';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Append-only. Never edit a released migration — add a new one. The schema
 * version lives in SQLite's `PRAGMA user_version`.
 *
 * Enum columns (type / status / owner / event_type) intentionally have no CHECK
 * constraints: SQLite cannot alter them in place, and adding a loop type later
 * would force a table rebuild. Values are validated at the TypeScript boundary
 * (see `db/loops.ts`).
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
CREATE TABLE captures (
  id TEXT PRIMARY KEY NOT NULL,
  raw_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE loops (
  id TEXT PRIMARY KEY NOT NULL,
  capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  raw_context TEXT,
  next_action_owner TEXT,
  entity_name TEXT,
  expected_event TEXT,
  next_review_at TEXT,
  closing_condition TEXT,
  follow_up_policy TEXT,
  classification_confidence REAL,
  timing_confidence REAL,
  entity_confidence REAL,
  parent_loop_id TEXT REFERENCES loops(id) ON DELETE SET NULL,
  notification_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE loop_events (
  id TEXT PRIMARY KEY NOT NULL,
  loop_id TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_loops_status_review ON loops (status, next_review_at);
CREATE INDEX idx_loops_parent ON loops (parent_loop_id);
CREATE INDEX idx_loops_capture ON loops (capture_id);
CREATE INDEX idx_loop_events_loop ON loop_events (loop_id, created_at);
`,
  },
  {
    version: 2,
    name: 'settings',
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function getSchemaVersion(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Brings the database up to LATEST_SCHEMA_VERSION. Each migration runs in its
 * own transaction together with its version bump, so a crash never leaves a
 * half-applied schema. Returns the resulting version.
 */
export async function migrate(db: Db): Promise<number> {
  const current = await getSchemaVersion(db);
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this app understands (v${LATEST_SCHEMA_VERSION}). Update the app.`,
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.transaction(async () => {
      await db.execAsync(migration.sql);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
  return LATEST_SCHEMA_VERSION;
}
