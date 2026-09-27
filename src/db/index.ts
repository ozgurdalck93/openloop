import * as SQLite from 'expo-sqlite';

import { migrate } from './migrations';
import type { Db } from './types';

export type { Db, RunResult, SqlParams, SqlValue } from './types';

const DATABASE_NAME = 'openloop.db';

/** Adapts expo-sqlite's connection to the app's `Db` interface. */
export function wrapExpoDatabase(raw: SQLite.SQLiteDatabase): Db {
  // Transactions on one connection must not overlap, or one caller's statements
  // would land inside another caller's transaction.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    execAsync: (sql) => raw.execAsync(sql),
    async runAsync(sql, params = []) {
      const result = await raw.runAsync(sql, [...params]);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    getAllAsync: (sql, params = []) => raw.getAllAsync(sql, [...params]),
    getFirstAsync: (sql, params = []) => raw.getFirstAsync(sql, [...params]),
    transaction<T>(task: () => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        let result!: T;
        await raw.withTransactionAsync(async () => {
          result = await task();
        });
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

let databasePromise: Promise<Db> | null = null;

/**
 * Opens (once) and migrates the app database. Safe to call from anywhere,
 * including notification handlers that run outside the React tree.
 */
export function getDatabase(): Promise<Db> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const raw = await SQLite.openDatabaseAsync(DATABASE_NAME);
      const db = wrapExpoDatabase(raw);
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      await migrate(db);
      return db;
    })().catch((error) => {
      databasePromise = null; // allow a retry after a failed open
      throw error;
    });
  }
  return databasePromise;
}
