import type { Capture } from '@/engine/types';

import type { Db } from './types';

interface CaptureRow {
  id: string;
  raw_text: string;
  created_at: string;
}

const toCapture = (row: CaptureRow): Capture => ({
  id: row.id,
  rawText: row.raw_text,
  createdAt: row.created_at,
});

export async function insertCapture(db: Db, capture: Capture): Promise<void> {
  await db.runAsync('INSERT INTO captures (id, raw_text, created_at) VALUES (?, ?, ?)', [
    capture.id,
    capture.rawText,
    capture.createdAt,
  ]);
}

export async function getCapture(db: Db, id: string): Promise<Capture | null> {
  const row = await db.getFirstAsync<CaptureRow>('SELECT * FROM captures WHERE id = ?', [id]);
  return row ? toCapture(row) : null;
}

export async function listCaptures(db: Db, limit = 50): Promise<Capture[]> {
  const rows = await db.getAllAsync<CaptureRow>(
    'SELECT * FROM captures ORDER BY created_at DESC, rowid DESC LIMIT ?',
    [limit],
  );
  return rows.map(toCapture);
}
