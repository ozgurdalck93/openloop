import { afterEach } from 'vitest';

import { listLoops } from '@/db/loops';
import { migrate } from '@/db/migrations';
import { createScheduler } from '@/notifications/scheduler';
import { createLoopService, type LoopService } from '@/services/loopService';
import { parseText } from '@/parser/localParser';
import type { Loop } from '@/engine/types';

import { at } from './fixtures';
import { createFakeNotifications } from './fakeNotifications';
import { openTestDb, type TestDb } from './nodeSqliteDb';

/** Wednesday 23 Sep 2026, 10:00 local. */
export const NOW = at(2026, 9, 23, 10, 0);

export const FLOW_1 =
  "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived.";

/**
 * A complete app backend for tests: real SQLite (in memory or a file), the real
 * LoopService and scheduler, a fake OS, and a clock the test moves by hand.
 */
export function createWorld(options: { file?: string } = {}) {
  const db: TestDb = openTestDb(options.file);
  const fake = createFakeNotifications();
  const clock = { now: NOW };
  let counter = 0;
  // Unique across worlds (a restarted app reuses the same file), like the UUIDs used in production.
  const prefix = Math.random().toString(16).slice(2, 8);
  const scheduler = createScheduler(db, fake.api, () => undefined);
  const service: LoopService = createLoopService({
    db,
    scheduler,
    now: () => clock.now,
    newId: () => `${prefix}-${(counter += 1)}`,
  });

  const world = {
    db,
    fake,
    clock,
    scheduler,
    service,
    ready: migrate(db),
    /** Parses text at the current clock and keeps every candidate, like tapping "Keep track of these". */
    async keepText(text: string): Promise<Loop[]> {
      await world.ready;
      await service.keep(parseText(text, clock.now).candidates, text);
      return world.loops();
    },
    loops: () => listLoops(db),
    async byTitle(title: string): Promise<Loop> {
      const found = (await listLoops(db)).find((l) => l.title === title);
      if (!found) throw new Error(`No loop titled "${title}"`);
      return found;
    },
    /** Moves the clock forward. */
    advance(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    close() {
      db.close();
    },
  };
  return world;
}

export type World = ReturnType<typeof createWorld>;

/** Creates a world that is closed automatically after each test. */
export function createWorldFactory(options: { file?: string } = {}): () => World {
  const worlds: World[] = [];
  afterEach(() => {
    for (const w of worlds.splice(0)) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
  });
  return () => {
    const w = createWorld(options);
    worlds.push(w);
    return w;
  };
}
