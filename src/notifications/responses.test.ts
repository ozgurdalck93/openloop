import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { FLOW_1, NOW, createWorldFactory, type World } from '../../test/harness';
import { getLoop } from '@/db/loops';
import { listEvents } from '@/db/events';
import { CATEGORY_ACTIONS, DEFAULT_TAP_ACTION } from './categories';
import { handleNotificationResponse } from './responses';

const world = createWorldFactory();
const respond = (w: World, actionId: string, loopId: string | undefined) =>
  handleNotificationResponse(w.service, { actionId, loopId }, w.clock.now);
const fresh = async (w: World, id: string) => (await getLoop(w.db, id))!;
const eventTypes = async (w: World, id: string) => (await listEvents(w.db, id)).map((e) => e.eventType);

describe('notification buttons → engine → database (acceptance flow 5, without the OS)', () => {
  describe('WAITING: Still waiting · Got a reply · Follow up', () => {
    it('Still waiting keeps the loop and reschedules its reminder, in the background', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const hr = await w.byTitle('HR reply');
      w.advance(2 * 24 * 3600_000);
      const out = await respond(w, 'still_waiting', hr.id);
      expect(out).toMatchObject({ handled: true, action: 'still_waiting', navigate: null });
      expect(out.message).toContain('Still waiting');
      expect(await fresh(w, hr.id)).toMatchObject({ status: 'waiting', nextReviewAt: at(2026, 9, 29, 10).toISOString() });
      expect(w.fake.forLoop(hr.id)[0][1].fireAt).toEqual(at(2026, 9, 29, 10));
      expect((await eventTypes(w, hr.id)).at(-1)).toBe('still_waiting');
    });

    it('Got a reply resolves the loop and cancels its reminder', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const zara = await w.byTitle('Zara refund');
      const out = await respond(w, 'got_reply', zara.id);
      expect(out).toMatchObject({ handled: true, action: 'got_reply', navigate: null });
      expect(await fresh(w, zara.id)).toMatchObject({ status: 'resolved' });
      expect(w.fake.forLoop(zara.id)).toEqual([]);
    });

    it('Follow up creates the linked task and opens the app on it', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const hr = await w.byTitle('HR reply');
      const out = await respond(w, 'follow_up', hr.id);
      expect(out.handled).toBe(true);
      const nav = out.navigate as { loopId: string };
      expect(nav.loopId).not.toBe(hr.id); // it opens the NEW task, not the parent
      expect(await fresh(w, nav.loopId)).toMatchObject({ type: 'task', title: 'Follow up with HR', parentLoopId: hr.id });
      expect(await fresh(w, hr.id)).toMatchObject({ status: 'active' });
    });
  });

  describe('TASK: Done · 15 min later · Later today', () => {
    it('Done opens the app to ask "Does this end here?" — it changes nothing itself', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const dentist = await w.byTitle('Call dentist');
      const events = await eventTypes(w, dentist.id);
      const out = await respond(w, 'done', dentist.id);
      expect(out).toEqual({ handled: true, action: 'done', navigate: { loopId: dentist.id, done: true }, message: null });
      expect(await fresh(w, dentist.id)).toEqual(dentist);
      expect(await eventTypes(w, dentist.id)).toEqual(events);
    });

    it('15 min later snoozes and moves the reminder', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const dentist = await w.byTitle('Call dentist');
      const out = await respond(w, 'snooze_15_min', dentist.id);
      expect(out).toMatchObject({ handled: true, navigate: null });
      expect(await fresh(w, dentist.id)).toMatchObject({ status: 'snoozed', nextReviewAt: at(2026, 9, 23, 10, 15).toISOString() });
      expect(w.fake.forLoop(dentist.id)[0][1].fireAt).toEqual(at(2026, 9, 23, 10, 15));
    });

    it('Later today snoozes to a slot a few hours out', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const dentist = await w.byTitle('Call dentist');
      await respond(w, 'later_today', dentist.id);
      expect((await fresh(w, dentist.id)).nextReviewAt).toBe(at(2026, 9, 23, 13).toISOString());
    });
  });

  describe('PROMISE: Fulfilled · 15 min later · Later today', () => {
    it('Fulfilled closes it in the background', async () => {
      const w = world();
      await w.keepText("I told Ozan I'd send him the link tonight.");
      const promise = await w.byTitle('Send Ozan the link');
      const out = await respond(w, 'fulfilled', promise.id);
      expect(out).toMatchObject({ handled: true, navigate: null });
      expect((await fresh(w, promise.id)).status).toBe('resolved');
    });
  });

  describe('RETURN_LATER: Keep for later · Act now · Resolve', () => {
    const jacket = 'I like the brown jacket but M fit better than XS. Bring this back after payday.';

    it('Keep for later parks it until next week — it does not nag', async () => {
      const w = world();
      await w.keepText(jacket);
      const item = await w.byTitle('Reconsider brown jacket');
      const out = await respond(w, 'keep_for_later', item.id);
      expect(out).toMatchObject({ handled: true, navigate: null });
      expect(await fresh(w, item.id)).toMatchObject({ status: 'snoozed', nextReviewAt: at(2026, 9, 28, 9).toISOString() });
    });

    it('Act now opens the new task, which still carries the reason it was parked', async () => {
      const w = world();
      await w.keepText(jacket);
      const item = await w.byTitle('Reconsider brown jacket');
      const out = await respond(w, 'act_now', item.id);
      const nav = out.navigate as { loopId: string };
      expect((await fresh(w, nav.loopId)).rawContext).toContain('M fit better than XS');
      expect((await fresh(w, item.id)).status).toBe('resolved');
    });

    it('Resolve closes it', async () => {
      const w = world();
      await w.keepText(jacket);
      const item = await w.byTitle('Reconsider brown jacket');
      await respond(w, 'resolve', item.id);
      expect((await fresh(w, item.id)).status).toBe('resolved');
    });
  });

  describe('EVENT: View · Later', () => {
    it('View turns it into a task and opens that task; Later snoozes', async () => {
      const w = world();
      await w.keepText('The test result comes out Friday.');
      await w.keepText('My exam results come out Monday.');
      const [a, b] = (await w.loops()).filter((l) => l.type === 'event');
      const view = await respond(w, 'view', a.id);
      const nav = view.navigate as { loopId: string };
      expect(await fresh(w, nav.loopId)).toMatchObject({ type: 'task', parentLoopId: a.id });
      await respond(w, 'later', b.id);
      expect((await fresh(w, b.id)).status).toBe('snoozed');
    });
  });

  describe('taps and edge cases', () => {
    it('a plain tap on the notification just opens the loop', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const hr = await w.byTitle('HR reply');
      const out = await respond(w, DEFAULT_TAP_ACTION, hr.id);
      expect(out).toEqual({ handled: true, action: 'open', navigate: { loopId: hr.id }, message: null });
      expect(await fresh(w, hr.id)).toEqual(hr);
    });

    it('a loop that no longer exists sends the user Home, gently', async () => {
      const w = world();
      await w.ready;
      const out = await respond(w, 'got_reply', 'gone');
      expect(out).toMatchObject({ handled: false, navigate: { home: true } });
      expect(out.message).toBe('That loop is not here anymore');
    });

    it('a missing loop id (a foreign notification) is ignored', async () => {
      const w = world();
      await w.ready;
      expect(await respond(w, 'got_reply', undefined)).toMatchObject({ handled: false, navigate: { home: true } });
    });

    it('a button pressed on something already closed changes nothing and shows the loop', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const hr = await w.byTitle('HR reply');
      await w.service.perform(hr.id, 'got_reply'); // dealt with in the app after the reminder was scheduled
      const before = await fresh(w, hr.id);
      const out = await respond(w, 'still_waiting', hr.id);
      expect(out).toMatchObject({ handled: false, navigate: { loopId: hr.id }, message: 'That one is already closed' });
      expect(await fresh(w, hr.id)).toEqual(before);
    });

    it('a button that does not fit the loop (state changed since) is refused, not applied', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const hr = await w.byTitle('HR reply');
      await w.service.perform(hr.id, 'follow_up'); // HR is now waiting on its follow-up task
      const out = await respond(w, 'still_waiting', hr.id);
      expect(out.handled).toBe(false);
      expect(out.message).toMatch(/follow-up task/);
      expect((await fresh(w, hr.id)).status).toBe('active');
    });

    it('an unknown button just opens the loop', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const hr = await w.byTitle('HR reply');
      expect(await respond(w, 'something_new', hr.id)).toMatchObject({ handled: false, action: 'unknown', navigate: { loopId: hr.id } });
    });

    it('pressing the same button twice is harmless (notifications can be delivered twice)', async () => {
      const w = world();
      await w.keepText(FLOW_1);
      const zara = await w.byTitle('Zara refund');
      expect((await respond(w, 'got_reply', zara.id)).handled).toBe(true);
      expect((await respond(w, 'got_reply', zara.id)).handled).toBe(false);
      expect((await eventTypes(w, zara.id)).filter((t) => t === 'resolved')).toHaveLength(1);
    });
  });

  it('every button in every category is handled', async () => {
    // Guards against adding a button to categories.ts without teaching the handler about it.
    for (const [category, actions] of Object.entries(CATEGORY_ACTIONS)) {
      for (const action of actions) {
        const w = world();
        const seedText: Record<string, string> = {
          task: 'Call the dentist tomorrow',
          promise: "I told Ozan I'd send him the link tonight.",
          waiting: "I'm waiting for a reply from HR",
          return_later: 'I like the coat. Bring this back after payday.',
          event: 'The test result comes out Friday.',
        };
        await w.keepText(seedText[category]);
        const loop = (await w.loops())[0];
        const out = await respond(w, action.id, loop.id);
        expect(out.handled, `${category} → "${action.title}" (${action.id}) was not handled: ${out.message}`).toBe(true);
        expect(out.action).toBe(action.id);
      }
    }
    expect(NOW.getDay()).toBe(3);
  });
});
