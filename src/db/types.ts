/**
 * The slice of a SQLite connection the app depends on. `expo-sqlite`'s
 * database is adapted to this in `db/index.ts`; tests adapt Node's built-in
 * `node:sqlite` (real SQL, no mocks). Keep this file free of native imports.
 */

export type SqlValue = string | number | null;
export type SqlParams = readonly SqlValue[];

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface Db {
  /** Runs one or more statements without parameters (DDL, PRAGMA). */
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: SqlParams): Promise<RunResult>;
  getAllAsync<T>(sql: string, params?: SqlParams): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: SqlParams): Promise<T | null>;
  /**
   * Runs `task` atomically: commit if it resolves, roll back if it throws.
   * Concurrent transactions are queued, never interleaved. Use this same `Db`
   * inside `task`.
   */
  transaction<T>(task: () => Promise<T>): Promise<T>;
}
