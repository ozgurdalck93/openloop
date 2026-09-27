import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { FLOW_1, createWorldFactory, type World } from '../../test/harness';
import { listEvents } from '@/db/events';
import { availableActions, type LoopAction } from '@/engine/suggestions';
import { EngineError } from '@/engine/transitions';
import { CLOSED_STATUSES } from '@/engine/types';
import { planNotification } from '@/notifications/plan';
import { ServiceError } from './loopService';

/** Small seeded generator so a failure is reproducible from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];

const SEEDS = [1, 7, 42, 2026, 90210, 314159];
const STEPS = 220;

async function seed(w: World) {
  await w.keepText(FLOW_1);
  await w.keepText("I told Ozan I'd send him the link tonight.");
  await w.keepText('The test result comes out Friday.');
  await w.keepText('I like the brown jacket but M fit better than XS. Bring this back after payday.');
  await w.keepText('My passport number is in the blue folder.');
  await w.keepText('Send the application documents');
}

/** Everything that must ALWAYS be true, whatever the user did. Returns a description of the first violation, or null. */
async function violation(w: World): Promise<string | null> {
  const loops = await w.loops();
  const byId = new Map(loops.map((l) => [l.id, l]));
  const now = w.clock.now;

  // 1. Reminders: a loop has an OS reminder exactly when it should, and the database knows about every one.
  for (const loop of loops) {
    const should = planNotification(loop, now) !== null;
    if (should !== (loop.notificationId !== null)) {
      return `reminder mismatch for "${loop.title}" (${loop.type}/${loop.status}): should=${should}, notificationId=${loop.notificationId}`;
    }
  }
  const stored = new Set(loops.map((l) => l.notificationId).filter((id): id is string => id !== null));
  const scheduled = new Set(w.fake.scheduled.keys());
  if (stored.size !== scheduled.size || [...stored].some((id) => !scheduled.has(id))) {
    return `OS has ${[...scheduled].join(',')} but the database points at ${[...stored].join(',')}`;
  }
  for (const [id, request] of w.fake.scheduled) {
    const owner = byId.get(request.data.loopId);
    if (!owner || owner.notificationId !== id) return `reminder ${id} belongs to no live loop`;
  }

  for (const loop of loops) {
    // 2. Links point somewhere real.
    if (loop.parentLoopId && !byId.has(loop.parentLoopId)) return `"${loop.title}" has a missing parent`;

    // 3. Ownership follows state.
    const open = !CLOSED_STATUSES.includes(loop.status);
    if (open && loop.type === 'reference' && loop.nextReviewAt !== null) return 'a reference has a review time';
    if (open && loop.type !== 'reference' && loop.nextReviewAt === null && !(loop.type === 'waiting' && loop.status === 'active')) {
      return `open loop "${loop.title}" (${loop.type}/${loop.status}) can never resurface: it has no review time`;
    }
    if (open && (loop.type === 'task' || loop.type === 'promise') && loop.nextActionOwner !== 'user') return `task "${loop.title}" not owned by the user`;
    if (open && loop.type === 'waiting' && loop.status !== 'active' && loop.nextActionOwner !== 'other') return `waiting "${loop.title}" not owned by the other party`;

    // 4. A WAITING loop that stepped aside for a follow-up must actually HAVE an open follow-up,
    //    or it is hidden from Home forever.
    if (open && loop.type === 'waiting' && loop.status === 'active') {
      const followUps = loops.filter((c) => c.parentLoopId === loop.id && c.type === 'task' && !CLOSED_STATUSES.includes(c.status));
      if (followUps.length === 0) return `waiting loop "${loop.title}" is stuck "active" with no open follow-up: it has vanished from Home`;
    }

    // 5. The timeline only moves forward, and closed loops say how they closed.
    const events = await listEvents(w.db, loop.id);
    for (let i = 1; i < events.length; i += 1) {
      if (events[i].createdAt < events[i - 1].createdAt) return `timeline of "${loop.title}" goes backwards`;
    }
    if (loop.status === 'resolved' && !events.some((e) => e.eventType === 'resolved')) return `"${loop.title}" is resolved but its timeline does not say so`;
    if (loop.status === 'resolved' && loop.resolvedAt === null) return `"${loop.title}" is resolved with no resolved_at`;
    if (loop.status === 'archived' && !events.some((e) => e.eventType === 'dismissed')) return `"${loop.title}" is archived but its timeline does not say so`;
  }
  return null;
}

/** Fresh things a user might say, so the run never starves for live loops. */
const POOL = [
  'Call the dentist tomorrow',
  "I'm waiting for a reply from Acme",
  "I told Mira I'd call her tonight",
  'My results come out Friday',
  'Bring this back after payday. I like the green coat.',
  'Send the report by Friday',
  "I emailed HR and I'm waiting for a reply",
  "I returned the Nike package but the refund hasn't arrived",
  'M fit better than XS.',
];

async function randomStep(w: World, r: () => number): Promise<string> {
  const all = await w.loops();
  const open = all.filter((l) => !CLOSED_STATUSES.includes(l.status));
  // Keep the run supplied with live loops: real use adds things all the time.
  if (open.length < 5) {
    await w.keepText(pick(r, POOL));
    return 'keep new loops';
  }
  const loop = r() < 0.92 ? pick(r, open) : pick(r, all); // mostly live loops; sometimes a closed one (must be refused)
  const now = w.clock.now;
  const later = new Date(now.getTime() + (1 + Math.floor(r() * 72)) * 3600_000);

  // Mostly valid actions for the loop's state, sometimes ones that do not fit.
  const valid = availableActions(loop).map((a) => a.id);
  const wild: LoopAction[] = ['done', 'fulfilled', 'still_waiting', 'got_reply', 'follow_up', 'act_now', 'view', 'resolve', 'dismiss', 'later_today', 'snooze_15'];
  const action: LoopAction = valid.length > 0 && r() < 0.85 ? pick(r, valid) : pick(r, wild);

  try {
    if (action === 'edit') {
      const roll = r();
      await w.service.edit(loop.id, {
        title: roll < 0.15 ? '   ' : `Edited ${Math.floor(r() * 100)}`,
        entityName: r() < 0.5 ? 'Someone' : null,
        reviewAt: r() < 0.6 ? later : new Date(now.getTime() - 3600_000), // sometimes in the past: must be refused
      });
      return `edit ${loop.title}`;
    }
    if (action === 'done' && loop.type === 'task') {
      const out = await w.service.perform(loop.id, 'done');
      if (out.ask) {
        if (r() < 0.5) await w.service.finishTask(loop.id, { endsHere: true });
        else await w.service.finishTask(loop.id, { waiting: r() < 0.5 ? { reviewAt: later } : {} });
      }
      return `done ${loop.title}`;
    }
    await w.service.perform(loop.id, action, { until: later });
    return `${action} ${loop.title}`;
  } catch (error) {
    if (error instanceof EngineError || error instanceof ServiceError) return `refused ${action} on ${loop.title}: ${error.message}`;
    throw error;
  }
}

describe('invariants hold under random use', () => {
  const world = createWorldFactory();

  for (const seedValue of SEEDS) {
    it(`seed ${seedValue}: ${STEPS} random actions never desync reminders, hide a loop, or corrupt the timeline`, async () => {
      const w = world();
      await w.ready;
      await seed(w);
      const r = rng(seedValue);
      const history: string[] = [];
      expect(await violation(w)).toBeNull();

      for (let step = 0; step < STEPS; step += 1) {
        history.push(await randomStep(w, r));
        // a tiny tick so timeline ordering is exercised across distinct instants
        w.clock.now = new Date(w.clock.now.getTime() + 1000);
        const problem = await violation(w);
        if (problem) throw new Error(`step ${step} (${history.at(-1)}): ${problem}\nlast actions:\n  ${history.slice(-8).join('\n  ')}`);
      }

      // The run must actually have DONE things, or "no violations" proves nothing.
      const succeeded = history.filter((h) => !h.startsWith('refused'));
      expect(succeeded.length).toBeGreaterThan(STEPS * 0.3);
      for (const kind of ['follow_up', 'dismiss', 'snooze', 'still_waiting', 'edit', 'done']) {
        expect(
          succeeded.some((h) => h.startsWith(kind)),
          `seed ${seedValue} never exercised "${kind}"`,
        ).toBe(true);
      }
    });
  }

  it('keeps every loop the user ever created — nothing is ever deleted', async () => {
    const w = world();
    await w.ready;
    await seed(w);
    const created = new Set((await w.loops()).map((l) => l.id));
    const r = rng(99);
    for (let i = 0; i < 150; i += 1) await randomStep(w, r);
    const after = new Set((await w.loops()).map((l) => l.id));
    for (const id of created) expect(after.has(id)).toBe(true);
  });

  it('at(…) sanity: the clock starts where the tests expect', () => {
    expect(at(2026, 9, 23, 10, 0).getDay()).toBe(3); // Wednesday
  });
});
