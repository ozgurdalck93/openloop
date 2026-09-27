import {
  LOOP_STATUSES,
  LOOP_TYPES,
  NEXT_ACTION_OWNERS,
  type Loop,
  type LoopStatus,
  type LoopType,
} from '@/engine/types';

import type { Db, SqlValue } from './types';

interface LoopRow {
  id: string;
  capture_id: string | null;
  type: string;
  status: string;
  title: string;
  raw_context: string | null;
  next_action_owner: string | null;
  entity_name: string | null;
  expected_event: string | null;
  next_review_at: string | null;
  closing_condition: string | null;
  follow_up_policy: string | null;
  classification_confidence: number | null;
  timing_confidence: number | null;
  entity_confidence: number | null;
  parent_loop_id: string | null;
  notification_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], field: string): T {
  if (value !== null && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid ${field} in database: ${JSON.stringify(value)}`);
}

export function rowToLoop(row: LoopRow): Loop {
  return {
    id: row.id,
    captureId: row.capture_id,
    type: oneOf(row.type, LOOP_TYPES, 'loops.type'),
    status: oneOf(row.status, LOOP_STATUSES, 'loops.status'),
    title: row.title,
    rawContext: row.raw_context,
    nextActionOwner:
      row.next_action_owner === null
        ? 'none'
        : oneOf(row.next_action_owner, NEXT_ACTION_OWNERS, 'loops.next_action_owner'),
    entityName: row.entity_name,
    expectedEvent: row.expected_event,
    nextReviewAt: row.next_review_at,
    closingCondition: row.closing_condition,
    followUpPolicy: row.follow_up_policy,
    classificationConfidence: row.classification_confidence,
    timingConfidence: row.timing_confidence,
    entityConfidence: row.entity_confidence,
    parentLoopId: row.parent_loop_id,
    notificationId: row.notification_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

const INSERT_COLUMNS = [
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
] as const;

function loopToParams(l: Loop): SqlValue[] {
  return [
    l.id,
    l.captureId,
    l.type,
    l.status,
    l.title,
    l.rawContext,
    l.nextActionOwner,
    l.entityName,
    l.expectedEvent,
    l.nextReviewAt,
    l.closingCondition,
    l.followUpPolicy,
    l.classificationConfidence,
    l.timingConfidence,
    l.entityConfidence,
    l.parentLoopId,
    l.notificationId,
    l.createdAt,
    l.updatedAt,
    l.resolvedAt,
  ];
}

export async function insertLoop(db: Db, loop: Loop): Promise<void> {
  const placeholders = INSERT_COLUMNS.map(() => '?').join(', ');
  await db.runAsync(
    `INSERT INTO loops (${INSERT_COLUMNS.join(', ')}) VALUES (${placeholders})`,
    loopToParams(loop),
  );
}

/** Replaces every mutable column. `id`, `capture_id` and `created_at` never change. Returns false if the loop does not exist. */
export async function updateLoop(db: Db, loop: Loop): Promise<boolean> {
  const result = await db.runAsync(
    `UPDATE loops SET
       type = ?, status = ?, title = ?, raw_context = ?, next_action_owner = ?,
       entity_name = ?, expected_event = ?, next_review_at = ?, closing_condition = ?,
       follow_up_policy = ?, classification_confidence = ?, timing_confidence = ?,
       entity_confidence = ?, parent_loop_id = ?, notification_id = ?,
       updated_at = ?, resolved_at = ?
     WHERE id = ?`,
    [
      loop.type,
      loop.status,
      loop.title,
      loop.rawContext,
      loop.nextActionOwner,
      loop.entityName,
      loop.expectedEvent,
      loop.nextReviewAt,
      loop.closingCondition,
      loop.followUpPolicy,
      loop.classificationConfidence,
      loop.timingConfidence,
      loop.entityConfidence,
      loop.parentLoopId,
      loop.notificationId,
      loop.updatedAt,
      loop.resolvedAt,
      loop.id,
    ],
  );
  return result.changes > 0;
}

export async function getLoop(db: Db, id: string): Promise<Loop | null> {
  const row = await db.getFirstAsync<LoopRow>('SELECT * FROM loops WHERE id = ?', [id]);
  return row ? rowToLoop(row) : null;
}

export interface LoopFilter {
  statuses?: readonly LoopStatus[];
  types?: readonly LoopType[];
  parentLoopId?: string;
}

const ORDER = 'ORDER BY next_review_at IS NULL, next_review_at ASC, created_at ASC, rowid ASC';

export async function listLoops(db: Db, filter: LoopFilter = {}): Promise<Loop[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (filter.statuses) {
    where.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`);
    params.push(...filter.statuses);
  }
  if (filter.types) {
    where.push(`type IN (${filter.types.map(() => '?').join(', ')})`);
    params.push(...filter.types);
  }
  if (filter.parentLoopId !== undefined) {
    where.push('parent_loop_id = ?');
    params.push(filter.parentLoopId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await db.getAllAsync<LoopRow>(`SELECT * FROM loops ${clause} ${ORDER}`, params);
  return rows.map(rowToLoop);
}

/** Loops that are still in play: everything except drafts and closed loops. */
export function listOpenLoops(db: Db): Promise<Loop[]> {
  return listLoops(db, { statuses: ['active', 'waiting', 'scheduled', 'snoozed'] });
}

export function listChildLoops(db: Db, parentLoopId: string): Promise<Loop[]> {
  return listLoops(db, { parentLoopId });
}

/** Open loops whose review time has arrived — what to resurface when the app opens. */
export async function listLoopsDueBy(db: Db, nowIso: string): Promise<Loop[]> {
  const rows = await db.getAllAsync<LoopRow>(
    `SELECT * FROM loops
     WHERE status IN ('active', 'waiting', 'scheduled', 'snoozed')
       AND next_review_at IS NOT NULL AND next_review_at <= ?
     ${ORDER}`,
    [nowIso],
  );
  return rows.map(rowToLoop);
}

/** Records the OS notification id without touching `updated_at` (it is bookkeeping, not a user change). */
export async function setNotificationId(db: Db, loopId: string, notificationId: string | null): Promise<void> {
  await db.runAsync('UPDATE loops SET notification_id = ? WHERE id = ?', [notificationId, loopId]);
}

/** Hard delete. The product never deletes a user's loop (dismiss = archive) — this exists for the dev tooling's own scratch data. */
export async function deleteLoop(db: Db, id: string): Promise<void> {
  await db.runAsync('DELETE FROM loops WHERE id = ?', [id]);
}
