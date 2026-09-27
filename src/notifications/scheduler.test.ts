import { describe, expect, it } from 'vitest';

import { at, makeLoop } from '../../test/fixtures';
import { FLOW_1, NOW, createWorld, createWorldFactory } from '../../test/harness';
import { insertLoop } from '@/db/loops';
import { createScheduler } from './scheduler';
import { createFakeNotifications } from '../../test/fakeNotifications';

describe('scheduler — OS reminders follow the database', () => {
  const world = createWorldFactory();

  it('schedules one reminder per loop that needs one, and remembers the OS id on the row', async () => {
    const w = world();
    const loops = await w.keepText(FLOW_1);
    expect(loops).toHaveLength(3);
    expect(w.fake.scheduled.size).toBe(3);

    for (const loop of loops) {
      const found = w.fake.forLoop(loop.id);
      expect(found).toHaveLength(1);
      const [id, request] = found[0];
      expect(loop.notificationId).toBe(id); // the row knows its reminder
      expect(request.fireAt).toEqual(new Date(loop.nextReviewAt as string));
      expect(request.data).toEqual({ loopId: loop.id });
    }
  });

  it('the reminder carries the calm copy and the right action-button category', async () => {
    const w = world();
    await w.keepText(FLOW_1);
    const dentist = await w.byTitle('Call dentist');
    const hr = await w.byTitle('HR reply');
    const [, task] = w.fake.forLoop(dentist.id)[0];
    expect(task).toMatchObject({
      title: 'Call dentist',
      body: 'You wanted to do this this afternoon.',
      categoryIdentifier: 'openloop.task',
      fireAt: at(2026, 9, 24, 15),
    });
    const [, waiting] = w.fake.forLoop(hr.id)[0];
    expect(waiting).toMatchObject({ title: 'Still waiting for HR?', categoryIdentifier: 'openloop.waiting' });
  });

  it('a note (REFERENCE) never gets a reminder', async () => {
    const w = world();
    await w.keepText('My passport number is in the blue folder.');
    expect(w.fake.scheduled.size).toBe(0);
  });

  it('moving a loop cancels the old reminder and schedules the new one', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow at 3pm');
    const before = await w.byTitle('Call dentist');
    const oldId = before.notificationId as string;

    await w.service.edit(before.id, { reviewAt: at(2026, 9, 25, 9) });
    const after = await w.byTitle('Call dentist');
    expect(w.fake.state.cancelled).toContain(oldId);
    expect(w.fake.scheduled.has(oldId)).toBe(false);
    expect(after.notificationId).not.toBe(oldId);
    expect(w.fake.forLoop(after.id)[0][1].fireAt).toEqual(at(2026, 9, 25, 9));
    expect(w.fake.scheduled.size).toBe(1); // no leaked duplicate
  });

  it('closing a loop cancels its reminder and clears the id', async () => {
    const w = world();
    await w.keepText("I'm waiting for a reply from HR");
    const hr = await w.byTitle('HR reply');
    await w.service.perform(hr.id, 'got_reply');
    expect(w.fake.scheduled.size).toBe(0);
    expect((await w.byTitle('HR reply')).notificationId).toBeNull();
  });
});

describe('scheduler — permission', () => {
  const world = createWorldFactory();

  it('asks in context when it still can, and schedules once allowed', async () => {
    const w = world();
    w.fake.state.granted = false;
    await w.keepText('Call the dentist tomorrow at 3pm');
    expect(w.fake.state.requestCalls).toBe(1);
    expect(w.fake.scheduled.size).toBe(1);
  });

  it('does not ask again once granted', async () => {
    const w = world();
    await w.keepText('Call the dentist tomorrow at 3pm');
    await w.keepText('Call the bank tomorrow at 4pm');
    expect(w.fake.state.requestCalls).toBe(0);
    expect(w.fake.scheduled.size).toBe(2);
  });

  it('if the user says no, the loop is still saved — it just has no reminder', async () => {
    const w = world();
    w.fake.state.granted = false;
    w.fake.state.userAllowsWhenAsked = false;
    const loops = await w.keepText('Call the dentist tomorrow at 3pm');
    expect(loops).toHaveLength(1);
    expect(loops[0].notificationId).toBeNull();
    expect(w.fake.scheduled.size).toBe(0);
  });

  it('after "don\'t ask again" it never prompts, and the loop is still saved', async () => {
    const w = world();
    w.fake.state.granted = false;
    w.fake.state.canAskAgain = false;
    const loops = await w.keepText('Call the dentist tomorrow at 3pm');
    expect(w.fake.state.requestCalls).toBe(0);
    expect(loops).toHaveLength(1);
    expect(w.fake.scheduled.size).toBe(0);
  });

  it('where reminders are unsupported (a browser) nothing is scheduled and nothing throws', async () => {
    const w = world();
    w.fake.state.supported = false;
    const loops = await w.keepText(FLOW_1);
    expect(loops).toHaveLength(3);
    expect(w.fake.scheduled.size).toBe(0);
    expect(await w.scheduler.ensurePermission()).toBe(false);
  });
});

describe('scheduler — failures never lose the user\'s change', () => {
  it('a refused schedule is reported and the loop is kept', async () => {
    const w = createWorld();
    const warnings: string[] = [];
    const scheduler = createScheduler(w.db, w.fake.api, (m) => warnings.push(m));
    await w.ready;
    await insertLoop(w.db, makeLoop({ id: 'a', title: 'Call dentist', nextReviewAt: at(2026, 9, 24, 15).toISOString() }));
    w.fake.state.failSchedule = true;
    await expect(scheduler.syncLoops([makeLoop({ id: 'a', title: 'Call dentist', nextReviewAt: at(2026, 9, 24, 15).toISOString() })], NOW)).resolves.toBeUndefined();
    expect(warnings).toEqual(['Could not sync the reminder for "Call dentist"']);
    w.close();
  });

  it('one bad loop does not stop the others from being scheduled', async () => {
    const w = createWorld();
    await w.ready;
    const good = makeLoop({ id: 'good', title: 'Good', nextReviewAt: at(2026, 9, 24, 15).toISOString() });
    const bad = makeLoop({ id: 'bad', title: 'Bad', nextReviewAt: at(2026, 9, 24, 16).toISOString() });
    await insertLoop(w.db, bad);
    await insertLoop(w.db, good);
    let first = true;
    const flaky = {
      ...w.fake.api,
      schedule: async (r: Parameters<typeof w.fake.api.schedule>[0]) => {
        if (first) {
          first = false;
          throw new Error('boom');
        }
        return w.fake.api.schedule(r);
      },
    };
    const scheduler = createScheduler(w.db, flaky, () => undefined);
    await scheduler.syncLoops([bad, good], NOW);
    expect(w.fake.forLoop('good')).toHaveLength(1);
    w.close();
  });

  it('a failed cancel does not block scheduling the new reminder', async () => {
    const w = createWorld();
    await w.keepText('Call the dentist tomorrow at 3pm');
    const loop = await w.byTitle('Call dentist');
    w.fake.state.failCancel = true;
    await w.service.edit(loop.id, { reviewAt: at(2026, 9, 25, 9) });
    expect((await w.byTitle('Call dentist')).nextReviewAt).toBe(at(2026, 9, 25, 9).toISOString());
    w.close();
  });
});

describe('scheduler — resyncAll heals drift (e.g. after a reboot or a restore)', () => {
  it('schedules missing reminders and cancels stale ones', async () => {
    const w = createWorld();
    await w.keepText(FLOW_1);
    // the OS forgets everything
    w.fake.scheduled.clear();
    // and a closed loop still claims a reminder
    const zara = await w.byTitle('Zara refund');
    await w.db.runAsync("UPDATE loops SET status = 'resolved', notification_id = 'ghost' WHERE id = ?", [zara.id]);

    await w.scheduler.resyncAll(NOW);
    expect(w.fake.scheduled.size).toBe(2); // dentist + HR
    expect(w.fake.state.cancelled).toContain('ghost');
    expect((await w.byTitle('Zara refund')).notificationId).toBeNull();
    w.close();
  });
});

describe('scheduler — syncFor', () => {
  it('handles created and updated loops once each', async () => {
    const w = createWorld();
    await w.ready;
    const fake = createFakeNotifications();
    const scheduler = createScheduler(w.db, fake.api, () => undefined);
    const loop = makeLoop({ id: 'x', title: 'X', nextReviewAt: at(2026, 9, 25, 9).toISOString() });
    await insertLoop(w.db, loop);
    await scheduler.syncFor({ created: [loop], updated: [loop], events: [] }, NOW);
    expect(fake.scheduled.size).toBe(1);
    w.close();
  });
});
