import { describe, expect, it } from 'vitest';

import { at, makeLoop } from '../../test/fixtures';
import { FLOW_1, NOW, createWorldFactory, type World } from '../../test/harness';
import { getLoop } from '@/db/loops';
import { listEvents } from '@/db/events';
import type { Loop } from '@/engine/types';
import { applyProposal } from './apply';
import { detectIntent } from './intent';
import { interpretInput, rescheduleTarget } from './interpret';
import { compatible, rankLoops, sameWord, targetWords } from './match';
import type { UpdateProposal } from './types';
import { extractTime } from '@/parser/datetime';
import { fold } from '@/utils/fold';

const intentOf = (text: string) => {
  const f = fold(text);
  return detectIntent(f, extractTime(f, NOW) !== null)?.intent ?? null;
};

describe('detectIntent — what is this clause doing to an existing loop?', () => {
  it.each([
    'Refund came.',
    'The refund arrived',
    'They sent it',
    'I got the reply',
    'HR replied',
    'Para geldi',
    'Zara para iadesi geldi',
    'Gönderdiler',
    'Cevap geldi',
    'İade geldi',
    'Bitti',
    'Yaptım',
    'Done',
    'Close this',
    'Kapat',
  ])('"%s" → resolve', (text) => expect(intentOf(text)).toBe('resolve'));

  it.each([
    'Still no reply',
    'Hala cevap yok',
    'Nothing yet',
    'Still waiting',
    'Henüz gelmedi',
    "The refund hasn't arrived yet",
    'Hâlâ haber yok',
  ])('"%s" → still_waiting', (text) => expect(intentOf(text)).toBe('still_waiting'));

  it.each([
    'Move the dentist to Friday afternoon',
    'dentist’i cumaya al',
    'Remind me next month instead',
    'Next month instead',
    'Push it to next week',
    'Bunu haftaya ertele',
    'Postpone the call to Monday',
  ])('"%s" → reschedule', (text) => expect(intentOf(text)).toBe('reschedule'));

  it.each([
    'Not relevant anymore',
    'Bunu artık kapat',
    'Forget it',
    'Vazgeçtim',
    'Never mind',
    'Artık gerek yok',
    'Cancel that',
  ])('"%s" → dismiss', (text) => expect(intentOf(text)).toBe('dismiss'));

  it.each([
    'Call the dentist tomorrow',
    "I emailed HR and I'm waiting for a reply",
    "I returned the Zara package but the refund hasn't arrived",
    'Tomorrow afternoon remind me to call the dentist',
    'Yarın sabah doktoru aramam lazım',
    'Faturayı öde',
    'I sent the documents to HR',
    'Gönderdim',
    'Yarın kitabı al', // "buy/take the book tomorrow" — a task, not a reschedule
    'Bring this back after payday',
    'My passport number is in the blue folder',
  ])('"%s" is NOT an update', (text) => expect(intentOf(text)).toBeNull());

  it('negation defeats "arrived": a refund that has not arrived is not a refund that did', () => {
    expect(intentOf("The refund hasn't arrived")).toBeNull();
    expect(intentOf('The refund did not arrive')).toBeNull();
    expect(intentOf('Para gelmedi')).toBeNull();
  });

  it('a reschedule needs a time', () => {
    expect(intentOf('Move the couch to the garage')).toBeNull();
  });

  it('marks cues that could be ordinary tasks as weak', () => {
    const f = fold('cumaya al');
    expect(detectIntent(f, true)?.weak).toBe(true);
    expect(detectIntent(fold('move it to friday'), true)?.weak).toBe(false);
  });
});

describe('matching helpers', () => {
  it('sameWord tolerates endings but not short coincidences', () => {
    expect(sameWord('iadesi', 'iade')).toBe(true);
    expect(sameWord('dentists', 'dentist')).toBe(true);
    expect(sameWord('hr', 'hr')).toBe(true);
    expect(sameWord('hr', 'hrm')).toBe(false); // too short for prefix matching
    expect(sameWord('cat', 'category')).toBe(false);
  });

  it('targetWords keeps names and things, drops verbs of happening, time words and pronouns', () => {
    const f = fold("Move the dentist'i to Friday afternoon");
    const spec = extractTime(f, NOW);
    expect(targetWords(f, spec?.spans)).toEqual(['dentist']);
    expect(targetWords(fold('Zara para iadesi geldi'))).toEqual(['zara', 'para', 'iadesi']);
    expect(targetWords(fold('they sent it'))).toEqual([]);
  });
});

const world = createWorldFactory();

/** The open loops after capturing the acceptance flow: HR reply, Call dentist, Zara refund. */
async function flow1(w: World): Promise<Loop[]> {
  await w.keepText(FLOW_1);
  return w.service.listOpen();
}
const titlesOf = (p: UpdateProposal) => p.candidates.map((c) => c.loop.title);

describe('interpretInput — the words the product asked for', () => {
  it('"refund came" → Zara refund is proposed', async () => {
    const w = world();
    const r = interpretInput('Refund came.', await flow1(w), NOW);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ intent: 'resolve', confidence: 'high', said: 'Refund came' });
    expect(titlesOf(r.proposals[0])[0]).toBe('Zara refund');
    expect(r.remainder).toBe('');
    expect(r.unmatched).toEqual([]);
  });

  it('"para geldi" → the same loop, in Turkish', async () => {
    const w = world();
    const r = interpretInput('Para geldi.', await flow1(w), NOW);
    expect(r.proposals[0]).toMatchObject({ intent: 'resolve', confidence: 'high' });
    expect(titlesOf(r.proposals[0])[0]).toBe('Zara refund');
  });

  it('"Zara para iadesi geldi." → Zara refund (acceptance flow 4)', async () => {
    const w = world();
    const r = interpretInput('Zara para iadesi geldi.', await flow1(w), NOW);
    expect(r.proposals[0]).toMatchObject({ intent: 'resolve', confidence: 'high' });
    expect(titlesOf(r.proposals[0])[0]).toBe('Zara refund');
  });

  it('"still no reply" → the loop waiting on a reply (HR), not the refund', async () => {
    const w = world();
    const r = interpretInput('Still no reply', await flow1(w), NOW);
    expect(r.proposals[0]).toMatchObject({ intent: 'still_waiting', confidence: 'high' });
    expect(titlesOf(r.proposals[0])[0]).toBe('HR reply');
  });

  it('"hala cevap yok" → HR reply', async () => {
    const w = world();
    const r = interpretInput('Hala cevap yok', await flow1(w), NOW);
    expect(r.proposals[0]).toMatchObject({ intent: 'still_waiting', confidence: 'high' });
    expect(titlesOf(r.proposals[0])[0]).toBe('HR reply');
  });

  it('"they sent it" / "gönderdiler" name nothing: the user chooses, best guesses first, nothing is guessed', async () => {
    const w = world();
    const loops = await flow1(w);
    for (const text of ['They sent it', 'Gönderdiler']) {
      const r = interpretInput(text, loops, NOW);
      expect(r.proposals[0].intent).toBe('resolve');
      expect(r.proposals[0].confidence).toBe('low');
      expect(titlesOf(r.proposals[0])).toHaveLength(3); // every open loop it could be
      expect(titlesOf(r.proposals[0]).slice(0, 2)).toEqual(expect.arrayContaining(['HR reply', 'Zara refund'])); // waiting ones lead
    }
  });

  it('"dentist’i cumaya al" → move the dentist call to Friday, keeping its 15:00', async () => {
    const w = world();
    const loops = await flow1(w);
    const r = interpretInput('dentist’i cumaya al', loops, NOW);
    const p = r.proposals[0];
    expect(p).toMatchObject({ intent: 'reschedule', confidence: 'high' });
    expect(titlesOf(p)[0]).toBe('Call dentist');
    expect(rescheduleTarget(p.when, p.candidates[0].loop, NOW)).toEqual(at(2026, 9, 25, 15));
  });

  it('"move the dentist to Friday afternoon" → Friday 15:00', async () => {
    const w = world();
    const loops = await flow1(w);
    const p = interpretInput('move the dentist to Friday afternoon', loops, NOW).proposals[0];
    expect(p).toMatchObject({ intent: 'reschedule', confidence: 'high' });
    expect(titlesOf(p)[0]).toBe('Call dentist');
    expect(p.when).toMatchObject({ hasTime: true });
    expect(rescheduleTarget(p.when, p.candidates[0].loop, NOW)).toEqual(at(2026, 9, 25, 15));
  });

  it('"next month instead" / "remind me next month instead" name no loop: the user chooses', async () => {
    const w = world();
    const loops = await flow1(w);
    for (const text of ['next month instead', 'remind me next month instead']) {
      const p = interpretInput(text, loops, NOW).proposals[0];
      expect(p).toMatchObject({ intent: 'reschedule', confidence: 'low' });
      expect(p.when?.milestone).toBe('next_month');
      expect(p.candidates).toHaveLength(3);
      expect(rescheduleTarget(p.when, p.candidates[0].loop, NOW)).toEqual(at(2026, 10, 1, 9));
    }
  });

  it('"bunu artık kapat" → dismiss, and the user chooses which', async () => {
    const w = world();
    const p = interpretInput('bunu artık kapat', await flow1(w), NOW).proposals[0];
    expect(p).toMatchObject({ intent: 'dismiss', confidence: 'low' });
    expect(p.candidates).toHaveLength(3);
  });

  it('a single open loop that the update could apply to is proposed (still with a confirm)', async () => {
    const w = world();
    await w.keepText("I'm waiting for a reply from HR");
    const p = interpretInput('they sent it', await w.service.listOpen(), NOW).proposals[0];
    expect(p).toMatchObject({ intent: 'resolve', confidence: 'high' });
    expect(titlesOf(p)).toEqual(['HR reply']);
  });
});

describe('interpretInput — never change a loop we are not sure about', () => {
  it('two loops fit equally → ambiguous, both offered', async () => {
    const w = world();
    await flow1(w);
    await w.keepText("I returned the Nike package but the refund hasn't arrived");
    const p = interpretInput('refund came', await w.service.listOpen(), NOW).proposals[0];
    expect(p.confidence).toBe('ambiguous');
    expect(titlesOf(p).slice(0, 2).sort()).toEqual(['Nike refund', 'Zara refund']);
  });

  it('naming the person breaks the tie', async () => {
    const w = world();
    await flow1(w);
    await w.keepText("I returned the Nike package but the refund hasn't arrived");
    const p = interpretInput('Nike refund came', await w.service.listOpen(), NOW).proposals[0];
    expect(p.confidence).toBe('high');
    expect(titlesOf(p)[0]).toBe('Nike refund');
  });

  it('something specific that matches no open loop changes NOTHING — it is reported, not guessed', async () => {
    const w = world();
    const r = interpretInput('Acme refund came', await flow1(w), NOW);
    expect(r.proposals).toEqual([]);
    expect(r.unmatched).toEqual(['Acme refund came']);
    expect(r.remainder).toBe('');
  });

  it('"still no reply from Nike" is not about HR just because both say "reply" — it is a new thing', async () => {
    const w = world();
    const r = interpretInput('still no reply from Nike', await flow1(w), NOW);
    expect(r.proposals).toEqual([]);
    expect(r.remainder).toBe('still no reply from Nike');
  });

  it('a package arriving does not close the REFUND just because they share a merchant', async () => {
    const w = world();
    const p = interpretInput('the Zara package arrived', await flow1(w), NOW).proposals[0];
    if (p) {
      // if anything is proposed at all, it must be low-scored enough that the user is asked, and never "clear"
      expect(p.candidates[0].score).toBeLessThan(4);
    }
  });

  it('with nothing open there is nothing to update: updates are reported, a bare "still waiting" becomes a new loop', async () => {
    const w = world();
    await w.ready;
    const none = await w.service.listOpen();
    expect(interpretInput('refund came', none, NOW)).toMatchObject({ proposals: [], unmatched: ['refund came'], remainder: '' });
    expect(interpretInput('still no reply', none, NOW)).toMatchObject({ proposals: [], unmatched: [], remainder: 'still no reply' });
  });

  it('closed loops are never candidates', async () => {
    const w = world();
    await flow1(w);
    const zara = await w.byTitle('Zara refund');
    await w.service.perform(zara.id, 'got_reply');
    const r = interpretInput('refund came', await w.service.listOpen(), NOW);
    expect(r.proposals).toEqual([]);
    expect(r.unmatched).toEqual(['refund came']);
  });

  it('a loop that stepped aside for its follow-up cannot be "still waiting" or moved', async () => {
    const w = world();
    await flow1(w);
    const hr = await w.byTitle('HR reply');
    await w.service.perform(hr.id, 'follow_up');
    const loops = await w.service.listOpen();
    const steppedAside = loops.find((l) => l.title === 'HR reply') as Loop;
    expect(compatible('still_waiting', steppedAside)).toBe(false);
    expect(compatible('reschedule', steppedAside)).toBe(false);
    const intent = detectIntent(fold('still no reply'), false)!;
    const ranked = rankLoops(intent, targetWords(fold('still no reply')), loops);
    expect(ranked.map((r) => r.loop.title)).not.toContain('HR reply');
  });

  it('notes can be set aside but never "resolved"', async () => {
    const w = world();
    await w.keepText('My passport number is in the blue folder.');
    const loops = await w.service.listOpen();
    expect(interpretInput('not relevant anymore', loops, NOW).proposals[0].candidates).toHaveLength(1);
    expect(interpretInput('done', loops, NOW).unmatched).toEqual(['done']);
  });

  it('a reschedule with a time in the past has nothing to apply', async () => {
    const w = world();
    const loops = await flow1(w);
    const p = interpretInput('move the dentist to Tuesday', loops, at(2026, 9, 29, 12)).proposals[0];
    expect(rescheduleTarget({ at: at(2026, 9, 22), hasTime: false, milestone: null, label: null }, loops[0], NOW)).toBeNull();
    expect(p).toBeDefined();
  });
});

describe('interpretInput — updates and new things in one breath', () => {
  it('splits an update from a new task', async () => {
    const w = world();
    const r = interpretInput('Refund came. Call the mechanic tomorrow.', await flow1(w), NOW);
    expect(r.proposals).toHaveLength(1);
    expect(r.remainder).toBe('Call the mechanic tomorrow');
  });

  it('splits within a sentence, at clause level', async () => {
    const w = world();
    const r = interpretInput('Refund came, and I need to call the bank', await flow1(w), NOW);
    expect(r.proposals).toHaveLength(1);
    expect(r.remainder.toLowerCase()).toContain('call the bank');
    expect(r.remainder.toLowerCase()).not.toContain('refund');
  });

  it('several updates at once', async () => {
    const w = world();
    const r = interpretInput('Refund came. Still no reply.', await flow1(w), NOW);
    expect(r.proposals.map((p) => [p.intent, titlesOf(p)[0]])).toEqual([
      ['resolve', 'Zara refund'],
      ['still_waiting', 'HR reply'],
    ]);
    expect(new Set(r.proposals.map((p) => p.id)).size).toBe(2);
  });

  it('ordinary captures are untouched: the whole text comes back as the remainder', async () => {
    const w = world();
    const loops = await flow1(w);
    for (const text of [
      FLOW_1,
      "HR said they'd reply this week, I need to call the dentist tomorrow, and I want to look at that jacket again after payday…",
      'Yarın sabah doktoru aramam lazım',
      'Yarın kitabı al',
      'I told Ozan I’d send him the link tonight.',
    ]) {
      const r = interpretInput(text, loops, NOW);
      expect(r.proposals, text).toEqual([]);
      expect(r.unmatched, text).toEqual([]);
      expect(r.remainder.length, text).toBeGreaterThan(0);
    }
  });

  it('is deterministic and never throws on odd input', async () => {
    const w = world();
    const loops = await flow1(w);
    for (const text of ['', '   ', '...', '🙂', 'x'.repeat(3000), 'refund '.repeat(200), '- - -', 'still still still', 'move move move to to']) {
      expect(() => interpretInput(text, loops, NOW)).not.toThrow();
      expect(interpretInput(text, loops, NOW)).toEqual(interpretInput(text, loops, NOW));
    }
  });

  it('candidates are always best-first', async () => {
    const w = world();
    const loops = await flow1(w);
    for (const text of ['refund came', 'still no reply', 'they sent it', 'next month instead', 'not relevant anymore']) {
      for (const p of interpretInput(text, loops, NOW).proposals) {
        const scores = p.candidates.map((c) => c.score);
        expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      }
    }
  });
});

describe('rescheduleTarget', () => {
  const loop = makeLoop({ type: 'task', nextReviewAt: at(2026, 9, 24, 15, 30).toISOString() });
  const waiting = makeLoop({ type: 'waiting', nextReviewAt: null });

  it('an explicit clock time wins', () => {
    expect(rescheduleTarget({ at: at(2026, 9, 25, 9), hasTime: true, milestone: null, label: null }, loop, NOW)).toEqual(at(2026, 9, 25, 9));
  });

  it('a bare day keeps the loop\'s time of day; with none, a sensible default per type', () => {
    const day = { at: at(2026, 9, 25), hasTime: false, milestone: null, label: null };
    expect(rescheduleTarget(day, loop, NOW)).toEqual(at(2026, 9, 25, 15, 30));
    expect(rescheduleTarget(day, waiting, NOW)).toEqual(at(2026, 9, 25, 11));
    expect(rescheduleTarget(day, { ...loop, nextReviewAt: null }, NOW)).toEqual(at(2026, 9, 25, 9));
  });

  it('a milestone uses its usual moment', () => {
    expect(rescheduleTarget({ at: null, hasTime: false, milestone: 'next_week', label: 'Next week' }, loop, NOW)).toEqual(at(2026, 9, 28, 9));
  });

  it('nothing usable → null', () => {
    expect(rescheduleTarget(null, loop, NOW)).toBeNull();
    expect(rescheduleTarget({ at: null, hasTime: false, milestone: null, label: null }, loop, NOW)).toBeNull();
    expect(rescheduleTarget({ at: at(2026, 9, 23, 9), hasTime: true, milestone: null, label: null }, loop, NOW)).toBeNull(); // past
  });
});

describe('applyProposal — confirmed updates go through the same service as every button', () => {
  const fresh = async (w: World, id: string) => (await getLoop(w.db, id)) as Loop;

  async function propose(w: World, text: string) {
    const loops = await w.service.listOpen();
    return interpretInput(text, loops, w.clock.now).proposals[0];
  }

  it('acceptance flow 4: "Zara para iadesi geldi" resolves Zara refund — and only that', async () => {
    const w = world();
    await flow1(w);
    const before = await w.loops();
    const p = await propose(w, 'Zara para iadesi geldi.');
    const zara = p.candidates[0].loop;
    const out = await applyProposal(w.service, p, zara, w.clock.now);

    expect(out.message).toBe('Got it — resolved');
    expect(await fresh(w, zara.id)).toMatchObject({ status: 'resolved' });
    expect(w.fake.forLoop(zara.id)).toEqual([]); // its reminder is cancelled
    for (const other of before.filter((l) => l.id !== zara.id)) expect(await fresh(w, other.id)).toEqual(other); // nothing else moved
    const events = await listEvents(w.db, zara.id);
    expect(events.map((e) => e.eventType).slice(-2)).toEqual(['reply_received', 'resolved']);
    expect(events.find((e) => e.eventType === 'reply_received')?.note).toBe('Got a reply — “Zara para iadesi geldi”'); // the user's own words
  });

  it('a chosen-instead loop is what changes ("Choose another")', async () => {
    const w = world();
    await flow1(w);
    const p = await propose(w, 'they sent it');
    const hr = p.candidates.find((c) => c.loop.title === 'HR reply')!.loop;
    await applyProposal(w.service, p, hr, w.clock.now);
    expect(await fresh(w, hr.id)).toMatchObject({ status: 'resolved' });
    expect((await w.byTitle('Zara refund')).status).toBe('waiting');
  });

  it('move: reschedules the SAME loop (no duplicate), moves its reminder, notes the words', async () => {
    const w = world();
    await flow1(w);
    const p = await propose(w, 'move the dentist to Friday afternoon');
    const dentist = p.candidates[0].loop;
    const loopsBefore = (await w.loops()).length;
    const out = await applyProposal(w.service, p, dentist, w.clock.now);

    expect(out.message).toBe('Moved to Friday · 15:00');
    expect((await w.loops()).length).toBe(loopsBefore); // acceptance scenario 9: no duplicate
    expect(await fresh(w, dentist.id)).toMatchObject({ nextReviewAt: at(2026, 9, 25, 15).toISOString(), status: 'active' });
    expect(w.fake.forLoop(dentist.id)[0][1].fireAt).toEqual(at(2026, 9, 25, 15));
    const note = (await listEvents(w.db, dentist.id)).find((e) => e.eventType === 'rescheduled')?.note;
    expect(note).toBe('Moved to Friday · 15:00 — “move the dentist to Friday afternoon”');
  });

  it('"next month instead" applied to a chosen loop', async () => {
    const w = world();
    await flow1(w);
    const p = await propose(w, 'remind me next month instead');
    const zara = p.candidates.find((c) => c.loop.title === 'Zara refund')!.loop;
    await applyProposal(w.service, p, zara, w.clock.now);
    expect((await fresh(w, zara.id)).nextReviewAt).toBe(at(2026, 10, 1, 9).toISOString());
  });

  it('still no reply: keeps waiting, schedules the next check, notes the words', async () => {
    const w = world();
    await flow1(w);
    const p = await propose(w, 'still no reply');
    const hr = p.candidates[0].loop;
    w.advance(2 * 24 * 3600_000);
    await applyProposal(w.service, p, hr, w.clock.now);
    expect(await fresh(w, hr.id)).toMatchObject({ status: 'waiting', nextReviewAt: at(2026, 9, 29, 10).toISOString() });
    const note = (await listEvents(w.db, hr.id)).find((e) => e.eventType === 'still_waiting')?.note;
    expect(note).toBe('Next check: Tuesday · 10:00 — “still no reply”');
  });

  it('done for a task means "yes, it ends here": resolved, without a question', async () => {
    const w = world();
    await flow1(w);
    const p = await propose(w, 'dentist done');
    const dentist = p.candidates[0].loop;
    expect(dentist.title).toBe('Call dentist');
    await applyProposal(w.service, p, dentist, w.clock.now);
    expect(await fresh(w, dentist.id)).toMatchObject({ status: 'resolved' });
    expect((await listEvents(w.db, dentist.id)).find((e) => e.eventType === 'action_completed')?.note).toBe('Marked done — “dentist done”');
  });

  it('dismiss sets it aside, keeping the words', async () => {
    const w = world();
    await flow1(w);
    const p = await propose(w, 'not relevant anymore');
    const zara = p.candidates.find((c) => c.loop.title === 'Zara refund')!.loop;
    await applyProposal(w.service, p, zara, w.clock.now);
    expect(await fresh(w, zara.id)).toMatchObject({ status: 'archived' });
    expect((await listEvents(w.db, zara.id)).find((e) => e.eventType === 'dismissed')?.note).toBe('Not relevant anymore — “not relevant anymore”');
  });

  it('resolving a follow-up by typing hands the waiting loop back, like the button', async () => {
    const w = world();
    await flow1(w);
    const hr = await w.byTitle('HR reply');
    const { focusLoopId } = await w.service.perform(hr.id, 'follow_up');
    const p = await propose(w, 'follow up with HR done');
    const child = p.candidates.find((c) => c.loop.id === focusLoopId)!.loop;
    await applyProposal(w.service, p, child, w.clock.now);
    expect(await fresh(w, hr.id)).toMatchObject({ status: 'waiting' });
  });

  it('refuses to move a loop to a time that has passed', async () => {
    const w = world();
    await flow1(w);
    const p = await propose(w, 'move the dentist to Friday afternoon');
    w.clock.now = at(2026, 9, 26, 12); // after Friday
    await expect(applyProposal(w.service, p, p.candidates[0].loop, w.clock.now)).rejects.toThrow(/future time/);
  });
});
