import type { EngineResult } from '@/engine/types';

import { insertCapture } from './captures';
import { insertEvent } from './events';
import { insertLoop, updateLoop } from './loops';
import type { Db } from './types';

/**
 * Persists one engine operation atomically: the capture, new loops, updated
 * loops and timeline events all commit together or not at all. Order matters
 * for foreign keys — capture, then new loops (parents first), then updates,
 * then events.
 */
export async function applyEngineResult(db: Db, result: EngineResult): Promise<void> {
  await db.transaction(async () => {
    if (result.capture) await insertCapture(db, result.capture);
    for (const loop of result.created) await insertLoop(db, loop);
    for (const loop of result.updated) {
      const found = await updateLoop(db, loop);
      if (!found) throw new Error(`Cannot update loop ${loop.id}: it does not exist`);
    }
    for (const event of result.events) await insertEvent(db, event);
  });
}
