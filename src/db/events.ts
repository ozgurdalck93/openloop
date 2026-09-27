import type { LoopEvent, LoopEventType } from '@/engine/types';

import type { Db } from './types';

interface EventRow {
  id: string;
  loop_id: string;
  event_type: string;
  note: string | null;
  created_at: string;
}

// Unlike loop enums, unknown event types are tolerated: the timeline should
// still render if a newer app version wrote an event kind this one doesn't know.
const toEvent = (row: EventRow): LoopEvent => ({
  id: row.id,
  loopId: row.loop_id,
  eventType: row.event_type as LoopEventType,
  note: row.note,
  createdAt: row.created_at,
});

export async function insertEvent(db: Db, event: LoopEvent): Promise<void> {
  await db.runAsync(
    'INSERT INTO loop_events (id, loop_id, event_type, note, created_at) VALUES (?, ?, ?, ?, ?)',
    [event.id, event.loopId, event.eventType, event.note, event.createdAt],
  );
}

/** Timeline for one loop, oldest first. Same-instant events keep insertion order. */
export async function listEvents(db: Db, loopId: string): Promise<LoopEvent[]> {
  const rows = await db.getAllAsync<EventRow>(
    'SELECT * FROM loop_events WHERE loop_id = ? ORDER BY created_at ASC, rowid ASC',
    [loopId],
  );
  return rows.map(toEvent);
}
