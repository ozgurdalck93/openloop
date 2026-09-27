import { DatabaseSync } from 'node:sqlite';

import type { Db } from '@/db/types';

export interface TestDb extends Db {
  close(): void;
}

/**
 * Test-only `Db` backed by Node's built-in SQLite, so repository and migration
 * tests run real SQL. Pass a file path to simulate an app restart (close, then
 * reopen the same path). Never imported by app code.
 */
export function openTestDb(path = ':memory:'): TestDb {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON;');
  let queue: Promise<unknown> = Promise.resolve();

  return {
    async execAsync(sql) {
      raw.exec(sql);
    },
    async runAsync(sql, params = []) {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    async getAllAsync<T>(sql: string, params: readonly (string | number | null)[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: readonly (string | number | null)[] = []) {
      return (raw.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    transaction<T>(task: () => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        raw.exec('BEGIN');
        try {
          const result = await task();
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
    close() {
      raw.close();
    },
  };
}
