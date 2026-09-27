/**
 * The first-build acceptance test from 06_OPENLOOP_CLAUDE_CODE_MASTER_PROMPT.md,
 * run through every real layer except the UI and the OS: parser → engine →
 * SQLite (a real file, closed and reopened to simulate a restart) → transitions
 * → timeline. Notifications are checked at the planning level (what WOULD be
 * scheduled), since scheduling itself needs a device.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { applyEngineResult } from '@/db/apply';
import { listEvents } from '@/db/events';
import { getLoop, listChildLoops, listLoops, listLoopsDueBy, listOpenLoops } from '@/db/loops';
import { migrate } from '@/db/migrations';
import { groupForHome, summarizeHome } from '@/engine/sections';
import { availableActions, snoozeOptions } from '@/engine/suggestions';
import {
  actNow,
  completeFollowUp,
  completeTaskAndWait,
  confirmCandidates,
  doneFlowFor,
  followUp,
  resolveLoop,
  rescheduleLoop,
  snoozeLoop,
  stillWaiting,
} from '@/engine/transitions';
import type { Loop } from '@/engine/types';
import { planNotification } from '@/notifications/plan';
import { parseText } from '@/parser/localParser';

import { at, makeContext } from './fixtures';
import { openTestDb, type TestDb } from './nodeSqliteDb';

const INPUT =
  "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived.";

const NOW = at(2026, 9, 23, 10, 0); // Wednesday

let dir: string;
const dbs: TestDb[] = [];
let ctxCounter = 0;

/** Ids must stay unique across "sessions", as real UUIDs would. */
const ctxAt = (now: Date) => {
  const base = makeContext(now);
  const prefix = `s${(ctxCounter += 1)}`;
  return { now, newId: () => `${prefix}-${base.newId()}` };
};

async function open(file: string): Promise<TestDb> {
  const db = openTestDb(file);
  dbs.push(db);
  await migrate(db);
  return db;
}

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const newDbFile = () => {
  dir = mkdtempSync(join(tmpdir(), 'openloop-e2e-'));
  return join(dir, 'openloop.db');
};

const byTitle = (loops: Loop[], title: string): Loop => {
  const found = loops.find((l) => l.title === title);
  if (!found) throw new Error(`No loop titled "${title}" in: ${loops.map((l) => l.title).join(', ')}`);
  return found;
};

describe('first-build acceptance test', () => {
  it('capture → parse → confirm → persist → restart → all three loops survive', async () => {
    const file = newDbFile();
    const first = await open(file);

    // 1–5: capture, parse into 1..N candidates, (the user reviews and confirms), store
    const { candidates } = parseText(INPUT, NOW);
    expect(candidates.map((c) => c.title)).toEqual(['HR reply', 'Call dentist', 'Zara refund']);
    await applyEngineResult(first, confirmCandidates(candidates, INPUT, ctxAt(NOW)));
    first.close();

    // restart
    const second = await open(file);
    const loops = await listOpenLoops(second);
    // Open loops come back soonest-review first: the dentist call is tomorrow 15:00, HR is Friday, Zara next Tuesday.
    expect(loops.map((l) => [l.type, l.title])).toEqual([
      ['task', 'Call dentist'],
      ['waiting', 'HR reply'],
      ['waiting', 'Zara refund'],
    ]);

    // Home sections + summary
    const groups = groupForHome(loops, NOW);
    expect(groups.needs_you.map((l) => l.title)).toEqual(['Call dentist']);
    expect(groups.waiting.map((l) => l.title)).toEqual(['HR reply', 'Zara refund']);
    expect(summarizeHome(groups)).toBe('1 needs you · 2 are waiting');

    // every loop remembers where it came from
    expect((await listEvents(second, byTitle(loops, 'HR reply').id)).map((e) => e.eventType)).toEqual([
      'captured',
      'waiting_started',
      'review_scheduled',
    ]);
  });

  it('notifications: what would be scheduled, and what would not', async () => {
    const db = await open(newDbFile());
    const { candidates } = parseText(`${INPUT} My passport number is in the blue folder.`, NOW);
    await applyEngineResult(db, confirmCandidates(candidates, INPUT, ctxAt(NOW)));
    const all = await listLoops(db);

    const plans = all.map((l) => [l.title, planNotification(l, NOW)] as const);
    const planned = Object.fromEntries(plans.map(([title, plan]) => [title, plan?.categoryKey ?? null]));
    expect(planned['Call dentist']).toBe('task');
    expect(planned['HR reply']).toBe('waiting');
    expect(planned['Zara refund']).toBe('waiting');
    expect(planned['My passport number is in the blue folder']).toBeNull(); // reference: never notifies
    expect(plans.find(([t]) => t === 'Call dentist')?.[1]?.fireAt).toEqual(at(2026, 9, 24, 15));
  });

  it('resolve, snooze, follow-up, TASK → WAITING and the timeline all persist', async () => {
    const file = newDbFile();
    const db = await open(file);
    const { candidates } = parseText(INPUT, NOW);
    await applyEngineResult(db, confirmCandidates(candidates, INPUT, ctxAt(NOW)));
    let loops = await listOpenLoops(db);

    // ---- Friday afternoon: the HR review comes due -------------------------------------------------------
    const friday = at(2026, 9, 25, 11, 0);
    const due = await listLoopsDueBy(db, friday.toISOString());
    expect(due.map((l) => l.title)).toEqual(['Call dentist', 'HR reply']);
    expect(availableActions(byTitle(due, 'HR reply')).map((a) => a.label)).toEqual(
      expect.arrayContaining(['Still waiting', 'Got a reply', 'Follow up', 'Remind me later']),
    );

    // Still waiting → next check is pushed out and recorded
    const hr = byTitle(loops, 'HR reply');
    await applyEngineResult(db, stillWaiting(hr, ctxAt(friday)));
    const afterStill = (await getLoop(db, hr.id)) as Loop;
    expect(afterStill.status).toBe('waiting');
    expect(afterStill.nextReviewAt).toBe(at(2026, 9, 29, 10).toISOString()); // Friday + 2 business days, at 10:00

    // Follow up → linked task; parent steps aside but stays traceable
    await applyEngineResult(db, followUp(afterStill, ctxAt(friday)));
    const kids = await listChildLoops(db, hr.id);
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({ type: 'task', title: 'Follow up with HR', parentLoopId: hr.id });
    const parked = (await getLoop(db, hr.id)) as Loop;
    expect(parked).toMatchObject({ status: 'active', nextReviewAt: null });

    // Home shows the follow-up under NEEDS YOU and hides the parked parent
    loops = await listOpenLoops(db);
    const groups = groupForHome(loops, friday);
    expect(groups.needs_you.map((l) => l.title)).toContain('Follow up with HR');
    expect(groups.waiting.map((l) => l.title)).toEqual(['Zara refund']);

    // Completing the follow-up needs no question: the parent returns to WAITING
    const flow = doneFlowFor(kids[0], parked);
    expect(flow.kind).toBe('return_to_waiting');
    await applyEngineResult(db, completeFollowUp(kids[0], parked, ctxAt(friday)));
    expect(((await getLoop(db, hr.id)) as Loop).status).toBe('waiting');
    expect(((await getLoop(db, kids[0].id)) as Loop).status).toBe('resolved');

    // TASK → WAITING: the dentist call is done, and the user says they now wait for a callback
    const dentist = byTitle(loops, 'Call dentist');
    expect(doneFlowFor(dentist, null).kind).toBe('ask_if_it_ends');
    await applyEngineResult(db, completeTaskAndWait(dentist, ctxAt(friday), { title: 'Dentist callback', expectedEvent: 'callback' }));
    const dentistKids = await listChildLoops(db, dentist.id);
    expect(dentistKids).toHaveLength(1);
    expect(dentistKids[0]).toMatchObject({ type: 'waiting', title: 'Dentist callback', parentLoopId: dentist.id });
    expect(((await getLoop(db, dentist.id)) as Loop).status).toBe('resolved');

    // Zara: "Refund came." → resolved; snooze another; reschedule a third
    const zara = byTitle(loops, 'Zara refund');
    await applyEngineResult(db, resolveLoop(zara, ctxAt(friday), 'Refund came'));
    expect(((await getLoop(db, zara.id)) as Loop).status).toBe('resolved');

    // ---- "restart" and read everything back ------------------------------------------------------------------
    db.close();
    const reopened = await open(file);

    const hrEvents = (await listEvents(reopened, hr.id)).map((e) => e.eventType);
    expect(hrEvents).toEqual([
      'captured',
      'waiting_started',
      'review_scheduled',
      'still_waiting',
      'follow_up_created',
      'follow_up_completed',
      'waiting_started',
      'review_scheduled',
    ]);

    const dentistEvents = (await listEvents(reopened, dentist.id)).map((e) => e.eventType);
    expect(dentistEvents).toEqual(['captured', 'review_scheduled', 'action_completed', 'waiting_started', 'resolved']);
    const callbackEvents = await listEvents(reopened, dentistKids[0].id);
    expect(callbackEvents.map((e) => e.eventType)).toEqual(['created', 'action_completed', 'waiting_started', 'review_scheduled']);
    expect(callbackEvents[0].note).toContain('Call dentist'); // the timeline points back at its parent

    const zaraEvents = (await listEvents(reopened, zara.id)).map((e) => e.eventType);
    expect(zaraEvents).toEqual(['captured', 'waiting_started', 'review_scheduled', 'reply_received', 'resolved']);

    const stillOpen = await listOpenLoops(reopened);
    expect(stillOpen.map((l) => l.title).sort()).toEqual(['Dentist callback', 'HR reply']);
  });

  it('snooze, reschedule and RETURN_LATER "Act now" persist correctly', async () => {
    const db = await open(newDbFile());
    const text = 'I like the brown jacket but M fit better than XS. Bring this back after payday. Call the dentist tomorrow.';
    const { candidates } = parseText(text, NOW);
    await applyEngineResult(db, confirmCandidates(candidates, text, ctxAt(NOW)));
    const loops = await listOpenLoops(db);

    const dentist = byTitle(loops, 'Call dentist');
    const snoozeTo = snoozeOptions(NOW)[1].at; // "Later today"
    await applyEngineResult(db, snoozeLoop(dentist, snoozeTo, ctxAt(NOW)));
    expect(await getLoop(db, dentist.id)).toMatchObject({ status: 'snoozed', nextReviewAt: snoozeTo.toISOString() });

    await applyEngineResult(db, rescheduleLoop((await getLoop(db, dentist.id)) as Loop, at(2026, 9, 25, 15), ctxAt(NOW)));
    expect(await getLoop(db, dentist.id)).toMatchObject({ status: 'active', nextReviewAt: at(2026, 9, 25, 15).toISOString() });
    expect(await listLoops(db, { types: ['task'] })).toHaveLength(1); // rescheduling never duplicates

    const jacket = byTitle(loops, 'Reconsider brown jacket');
    await applyEngineResult(db, actNow(jacket, ctxAt(NOW)));
    const [task] = await listChildLoops(db, jacket.id);
    expect(task.rawContext).toContain('M fit better than XS'); // the reason came back with the item
    expect(((await getLoop(db, jacket.id)) as Loop).status).toBe('resolved');
  });

  it('a failed write leaves the database exactly as it was (atomicity through the real stack)', async () => {
    const db = await open(newDbFile());
    const { candidates } = parseText('Call the dentist tomorrow', NOW);
    const good = confirmCandidates(candidates, 'Call the dentist tomorrow', ctxAt(NOW));
    await applyEngineResult(db, good);

    const [loop] = good.created;
    const bad = completeTaskAndWait(loop, ctxAt(NOW));
    // sabotage the second half of the result: an update for a loop that does not exist
    bad.updated.push({ ...loop, id: 'ghost' });
    await expect(applyEngineResult(db, bad)).rejects.toThrow();

    expect(((await getLoop(db, loop.id)) as Loop).status).toBe('active'); // task NOT resolved
    expect(await listChildLoops(db, loop.id)).toEqual([]); // waiting loop NOT created
  });
});
