import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { LocalLoopParser, parseText } from './localParser';
import { createParser } from './index';
import type { LoopCandidate } from './types';

// Wednesday 23 Sep 2026, 10:00 local. Tomorrow = Thu 24th, Friday = 25th, next Monday = 28th.
const NOW = at(2026, 9, 23, 10, 0);

const parse = (text: string, now = NOW) => parseText(text, now).candidates;
const review = (c: LoopCandidate) => (c.nextReviewAt ? new Date(c.nextReviewAt) : null);
const one = (text: string): LoopCandidate => {
  const found = parse(text);
  expect(found).toHaveLength(1);
  return found[0];
};

describe('acceptance scenario 1 — multiple loop types (05_OPENLOOP_ACCEPTANCE_SCENARIOS.md)', () => {
  const input =
    "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived.";

  it('finds exactly three loops, in order: WAITING, TASK, WAITING', () => {
    const found = parse(input);
    expect(found.map((c) => c.type)).toEqual(['waiting', 'task', 'waiting']);
    expect(found.map((c) => c.title)).toEqual(['HR reply', 'Call dentist', 'Zara refund']);
  });

  it('WAITING — HR reply: owned by someone else, reviewed in ~2 business days (work reply)', () => {
    const [hr] = parse(input);
    expect(hr.nextActionOwner).toBe('other');
    expect(hr.entityName).toBe('HR');
    expect(hr.followUpPolicy).toBe('reply_work');
    expect(review(hr)).toEqual(at(2026, 9, 25, 10)); // Wed + 2 business days
    expect(hr.closingCondition).toBe('Reply received');
    expect(hr.needsUserConfirmation).toBe(false);
  });

  it('TASK — Call dentist: tomorrow around 15:00', () => {
    const task = parse(input)[1];
    expect(task.nextActionOwner).toBe('user');
    expect(review(task)).toEqual(at(2026, 9, 24, 15, 0));
    expect(task.followUpPolicy).toBe('exact_time');
    expect(task.timingConfidence).toBeGreaterThan(0.9);
  });

  it('WAITING — Zara refund: refund/admin interval (3–5 business days)', () => {
    const refund = parse(input)[2];
    expect(refund.entityName).toBe('Zara');
    expect(refund.followUpPolicy).toBe('admin_wait');
    expect(review(refund)).toEqual(at(2026, 9, 29, 10)); // Wed + 4 business days
    expect(refund.expectedEvent).toBe('refund');
  });
});

describe('acceptance scenarios 5–8', () => {
  it('scenario 5 — future-self note: RETURN_LATER "Reconsider brown jacket" keeps the reason as context', () => {
    const c = one('I like the brown jacket but M fit better than XS. Bring this back after payday.');
    expect(c.type).toBe('return_later');
    expect(c.title).toBe('Reconsider brown jacket');
    expect(c.rawContext).toContain('M fit better than XS');
    expect(c.timingLabel).toBe('After payday');
    expect(review(c)).toEqual(at(2026, 10, 2, 10)); // a suggestion just after the month boundary
    expect(c.nextActionOwner).toBe('user');
  });

  it('scenario 5 — "after payday" is offered as a SUGGESTION the user is asked to confirm, not a fact', () => {
    const c = one('I like the brown jacket but M fit better than XS. Bring this back after payday.');
    expect(c.timingSource).toBe('suggested');
    expect(c.timingLabel).toBe('After payday');
    expect(c.timingConfidence).toBeLessThan(0.5);
    expect(c.followUpPolicy).toBe('milestone');
  });

  it('scenario 6 — promise: owner user, entity Ozan, review tonight, closing "link sent"', () => {
    const c = one("I told Ozan I'd send him the link tonight.");
    expect(c.type).toBe('promise');
    expect(c.nextActionOwner).toBe('user');
    expect(c.entityName).toBe('Ozan');
    expect(c.title).toBe('Send Ozan the link');
    expect(review(c)).toEqual(at(2026, 9, 23, 20, 0));
    expect(c.closingCondition).toBe('link sent');
  });

  it('scenario 7 — reference only: no notification by default', () => {
    const c = one('My passport number is in the blue folder.');
    expect(c.type).toBe('reference');
    expect(c.nextActionOwner).toBe('none');
    expect(c.nextReviewAt).toBeNull();
    expect(c.followUpPolicy).toBe('none');
  });

  it('a bare note like "M fit better than XS" is a reference too', () => {
    expect(one('M fit better than XS.').type).toBe('reference');
  });

  it('scenario 8 — "Maybe Friday." invents nothing and asks what Friday refers to', () => {
    const result = parseText('Maybe Friday.', NOW);
    expect(result.candidates).toEqual([]);
    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0].question).toBe('What does Friday refer to?');
  });

  it('scenario 8 — Turkish', () => {
    const result = parseText('Belki cuma.', NOW);
    expect(result.candidates).toEqual([]);
    expect(result.clarifications[0].question).toBe('cuma neyle ilgili?');
  });

  it('scenario 8 — but a stray time right after a loop with no time attaches to that loop', () => {
    const c = one('Send the application documents. Tomorrow.');
    expect(c.type).toBe('task');
    expect(c.title).toBe('Send application documents');
    expect(review(c)).toEqual(at(2026, 9, 24, 9));
  });
});

describe('the sentence from 03_OPENLOOP_UX_FLOW.md (three loops in one breath)', () => {
  const input =
    "HR said they'd reply this week, I need to call the dentist tomorrow, and I want to look at that jacket again after payday…";

  it('splits into WAITING, TASK, RETURN_LATER', () => {
    const found = parse(input);
    expect(found.map((c) => [c.type, c.title])).toEqual([
      ['waiting', 'HR reply'],
      ['task', 'Call dentist'],
      ['return_later', 'Reconsider jacket'],
    ]);
  });

  it('"this week" → the waiting review lands on Friday 11:00 (the "Review Friday" card)', () => {
    const [hr] = parse(input);
    expect(review(hr)).toEqual(at(2026, 9, 25, 11));
    expect(hr.timingLabel).toBe('This week');
    expect(hr.followUpPolicy).toBe('expected_date'); // explicit date always wins over the 1–2 day default
  });

  it('a date-only task gets a suggested time of day (calls: 10:00)', () => {
    const task = parse(input)[1];
    expect(review(task)).toEqual(at(2026, 9, 24, 10));
    expect(task.followUpPolicy).toBe('context_time');
  });
});

describe('product-brief examples', () => {
  it('"Ayşe said she\'d send the file." → waiting on Ayşe', () => {
    const c = one('Ayşe said she’d send the file.');
    expect(c).toMatchObject({ type: 'waiting', title: 'File from Ayşe', entityName: 'Ayşe', nextActionOwner: 'other' });
  });

  it('"The test result comes out Friday." → an event owned by the system', () => {
    const c = one('The test result comes out Friday.');
    expect(c).toMatchObject({ type: 'event', title: 'Test result', nextActionOwner: 'system', followUpPolicy: 'at_event' });
    expect(review(c)).toEqual(at(2026, 9, 25, 9));
  });

  it('"I like this jacket, but I\'ll look again after payday" (one sentence, object in the first clause)', () => {
    const c = one("I like this jacket, but I'll look again after payday");
    expect(c.type).toBe('return_later');
    expect(c.title).toBe('Reconsider jacket');
  });

  it('"Send the application documents." → a task (scenario 2, step 1)', () => {
    expect(one('Send the application documents.')).toMatchObject({ type: 'task', title: 'Send application documents' });
  });
});

describe('English phrase coverage (06_OPENLOOP_CLAUDE_CODE_MASTER_PROMPT.md)', () => {
  it.each([
    ['Call the dentist today', 'task'],
    ['Call the dentist tomorrow', 'task'],
    ['I need to send the report tonight', 'task'],
    ['Pay the invoice by Friday', 'task'],
    ['I have to book flights this week', 'task'],
    ['Waiting for the landlord', 'waiting'],
    ["I'm waiting for my visa", 'waiting'],
    ['She should get back to me by Friday', 'waiting'],
    ['They said they will get back to me', 'waiting'],
    ["The refund hasn't arrived", 'waiting'],
    ['No reply from the bank yet', 'waiting'],
    ['I want to look at the coat again after payday', 'return_later'],
    ['Maybe reconsider the sofa next month', 'return_later'],
    ['I promised Mira I would return the book', 'promise'],
    ["I told Sam I'll pick up the keys", 'promise'],
    ['My exam results are announced next week', 'event'],
    ['Remind me later.', 'return_later'],
  ])('"%s" → %s', (text, type) => {
    expect(parse(text)[0]?.type).toBe(type);
  });

  it('"remind me later to call mom" is a task, not a return-later', () => {
    const c = one('Remind me later to call mom');
    expect(c.type).toBe('task');
    expect(c.title).toBe('Call mom');
    expect(c.followUpPolicy).toBe('later_default');
  });

  it('"get back to me" / "waiting for" name an entity when one is capitalised', () => {
    expect(one("I'm waiting for a reply from Acme").entityName).toBe('Acme');
  });
});

describe('Turkish phrase coverage', () => {
  it.each([
    ['yarın sabah doktoru aramam lazım', 'task', 'Doktoru ara'],
    ['Bugün eczaneye gitmem lazım', 'task', 'Eczaneye git'],
    ['bu akşam çiçek almayı unutmamam lazım', 'task', 'Çiçek al'],
    ['bu akşam Ozan\'a linki göndermem lazım', 'task', "Ozan'a linki gönder"],
    ['Faturayı öde', 'task', 'Faturayı öde'],
    ["Ozan'a linki göndereceğimi söyledim", 'promise', "Ozan'a linki gönder"],
    ["Ozan'a söz verdim, yarın göndereceğim", 'promise', "Ozan'a gönder"],
    ["HR'a mail attım cevap bekliyorum", 'waiting', 'HR cevabı'],
    ['HR geri dönecek', 'waiting', 'HR cevabı'],
    ['Ali dosyayı gönderecek', 'waiting', 'Ali dosyası'],
    ["Zara'ya iade ettim, para yatmadı", 'waiting', 'Zara iadesi'],
    ['kargo hala gelmedi', 'waiting', 'Kargo bekleniyor'],
    ['ceketi maaştan sonra tekrar bakarım', 'return_later', 'Tekrar bak: ceket'],
    ['Cuma günü sonuçlar açıklanacak', 'event', 'Sonuçlar'],
  ])('"%s" → %s "%s"', (text, type, title) => {
    const c = one(text);
    expect(c.type).toBe(type);
    expect(c.title).toBe(title);
  });

  it('time words: bugün, yarın, yarın sabah, öğleden sonra, bu akşam, cuma, pazartesi, bu hafta', () => {
    expect(review(one('Bugün annemi ara'))).toEqual(at(2026, 9, 23, 11)); // date only, today → next slot
    expect(review(one('yarın annemi ara'))).toEqual(at(2026, 9, 24, 10)); // calls: 10:00
    expect(review(one('yarın sabah annemi ara'))).toEqual(at(2026, 9, 24, 9));
    expect(review(one('yarın öğleden sonra annemi ara'))).toEqual(at(2026, 9, 24, 15));
    expect(review(one('bu akşam annemi ara'))).toEqual(at(2026, 9, 23, 19));
    expect(review(one('cuma annemi ara'))).toEqual(at(2026, 9, 25, 10));
    expect(review(one('pazartesi annemi ara'))).toEqual(at(2026, 9, 28, 10));
    expect(review(one('HR bu hafta dönecek'))).toEqual(at(2026, 9, 25, 11));
  });

  it('"sonra bakarım" alone is a return-later that asks what to bring back', () => {
    const c = one('sonra bakarım');
    expect(c.type).toBe('return_later');
    expect(c.needsUserConfirmation).toBe(true);
    expect(c.confirmationQuestion).toBe('Neyi geri getireyim?');
  });

  it('"maaştan sonra" → the payday milestone', () => {
    const c = one('Yeni telefona maaştan sonra tekrar bakarım');
    expect(c.type).toBe('return_later');
    expect(c.timingLabel).toBe('After payday');
  });

  it('Turkish diacritics are preserved in titles and entities', () => {
    expect(one("Ayşe'ye çiçek göndermem lazım")).toMatchObject({ entityName: 'Ayşe', title: "Ayşe'ye çiçek gönder" });
  });

  it('mixed Turkish + English in one input is split by sentence language', () => {
    const found = parse("I emailed HR and I'm waiting for a reply. Yarın sabah doktoru aramam lazım.");
    expect(found.map((c) => [c.type, c.title])).toEqual([
      ['waiting', 'HR reply'],
      ['task', 'Doktoru ara'],
    ]);
  });
});

describe('structure: how clauses become loops', () => {
  it('a past action + a waiting clause is ONE waiting loop, not two', () => {
    expect(parse("I emailed HR and I'm waiting for a reply")).toHaveLength(1);
    expect(parse("I returned the package but the refund hasn't arrived")).toHaveLength(1);
  });

  it('the same loop said across two sentences is merged when the entity agrees', () => {
    const found = parse('I sent the documents to HR yesterday. Still waiting for a reply.');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: 'waiting', title: 'HR reply' });
  });

  it('…but not when the entities differ', () => {
    const found = parse("I emailed HR. I'm waiting for a reply from Acme.");
    expect(found.map((c) => c.entityName)).toEqual(['HR', 'Acme']);
  });

  it('a past action alone becomes a waiting loop the user must confirm', () => {
    const c = one('I emailed HR.');
    expect(c.type).toBe('waiting');
    expect(c.needsUserConfirmation).toBe(true);
    expect(c.confirmationQuestion).toBe('Are you waiting to hear back from HR?');
    expect(c.classificationConfidence).toBeLessThan(0.6);
  });

  it('"I returned it" implies waiting for a refund; "I ordered it" for a delivery', () => {
    expect(one('I returned the Zara jacket.').title).toBe('Zara refund');
    expect(one('I ordered the Nike shoes.').title).toBe('Nike delivery');
  });

  it("a past action's date is history, not a plan", () => {
    const c = one("I emailed HR on Monday and I'm waiting for a reply");
    expect(review(c)).toEqual(at(2026, 9, 25, 10)); // default work interval, NOT next Monday
    expect(c.followUpPolicy).toBe('reply_work');
  });

  it('"and" splits two tasks when a new clause starts', () => {
    expect(parse('Call the dentist and email HR').map((c) => c.title)).toEqual(['Call dentist', 'Email HR']);
  });

  it('"and" inside a noun phrase does not split', () => {
    expect(parse('Buy salt and pepper').map((c) => c.title)).toEqual(['Buy salt and pepper']);
  });

  it('a comma list stays one task', () => {
    const c = one('buy milk, eggs, bread tomorrow');
    expect(c.title).toBe('Buy milk, eggs, bread');
    expect(review(c)).toEqual(at(2026, 9, 24, 17)); // errand
  });

  it('decimals and clock times do not end sentences', () => {
    const c = one('Call the dentist tomorrow at 15.30. ');
    expect(review(c)).toEqual(at(2026, 9, 24, 15, 30));
  });

  it('a bulleted or multi-line dump yields one loop per line', () => {
    const found = parse('- call the dentist tomorrow\n- waiting for the bank to reply\n- my passport is in the blue folder');
    expect(found.map((c) => c.type)).toEqual(['task', 'waiting', 'reference']);
  });

  it('hedging lowers confidence instead of blocking the loop', () => {
    const sure = one('Call the dentist Friday');
    const hedged = one('Maybe call the dentist Friday');
    expect(hedged.title).toBe('Call dentist');
    expect(hedged.classificationConfidence).toBeLessThan(sure.classificationConfidence);
    expect(hedged.timingConfidence).toBeLessThan(sure.timingConfidence);
  });

  it('noise produces nothing', () => {
    expect(parseText('Thanks!', NOW)).toEqual({ candidates: [], clarifications: [] });
    expect(parseText('   ', NOW)).toEqual({ candidates: [], clarifications: [] });
    expect(parseText('', NOW)).toEqual({ candidates: [], clarifications: [] });
    expect(parseText('ok', NOW)).toEqual({ candidates: [], clarifications: [] });
  });

  it('an event with no date asks when', () => {
    const c = one('My results come out soon');
    expect(c.type).toBe('event');
    expect(c.nextReviewAt).toBeNull();
    expect(c.confirmationQuestion).toBe('When do you expect this?');
  });
});

describe('harder, messier real-world phrasing', () => {
  it.each([
    ["I'll think about the vacation after payday", 'return_later', 'Reconsider vacation'],
    ["I want to buy the coat but I'll wait until next month", 'return_later', 'Reconsider coat'],
    ['Package should arrive Thursday', 'event', 'Package'],
    ["Waiting on Sarah's approval", 'waiting', 'Sarah approval'],
    ['Follow up with Maria next week', 'task', 'Follow up with Maria'],
    ['Return the shoes to Zara by Saturday', 'task', 'Return shoes to Zara'],
    ['Need to pick up the kids at 5', 'task', 'Pick up the kids'],
    ['Dentist appointment Friday at 3', 'event', 'Dentist appointment'],
    ['Pay rent on the 1st', 'task', 'Pay rent'],
    ['Meeting with the landlord on the 15th at 6pm', 'event', 'Meeting with the landlord'],
    ['Doktor sonuçları cuma gelecek', 'event', 'Doktor sonuçları'],
    ['Yarın toplantı var saat 14:00\'te', 'event', 'Toplantı'],
    ["Mert'ten haber bekliyorum ama hala yok", 'waiting', 'Mert cevabı'],
    ["The plumber didn't show up and hasn't called back", 'waiting', 'Plumber reply'],
  ])('"%s" → %s "%s"', (text, type, title) => {
    const c = one(text);
    expect(c.type).toBe(type);
    expect(c.title).toBe(title);
  });

  it('"for Sunday" / "on the 1st" leave no dangling words in the title', () => {
    expect(parse('Order the cake for Sunday, and ask Lena about the venue').map((c) => c.title)).toEqual([
      'Order cake',
      'Ask Lena about the venue',
    ]);
    expect(parse('Cuma günü Ali’yi aramam lazım. Ayrıca faturayı da ödemem gerek.').map((c) => c.title)).toEqual([
      'Ali’yi ara',
      'Faturayı öde',
    ]);
  });

  it('day-of-month and business-day expressions become concrete dates', () => {
    expect(review(one('Pay rent on the 1st'))).toEqual(at(2026, 10, 1, 9));
    expect(review(one('Meeting with the landlord on the 15th at 6pm'))).toEqual(at(2026, 10, 15, 18));
    expect(review(one("I'm waiting for the refund, they said 5 business days"))).toEqual(at(2026, 9, 30, 11)); // explicit date wins
    expect(review(one('iade parası hala yatmadı, banka dedi ki 5 iş günü'))).toEqual(at(2026, 9, 30, 11));
  });

  it('"still no reply" restates a wait instead of starting a second one', () => {
    expect(parse('Waiting for Ali. Still no reply.')).toHaveLength(1);
    expect(parse('I emailed HR. Still no reply.')).toHaveLength(1);
    expect(parse('Still no reply.')).toHaveLength(1); // ...but on its own it is still a wait
    expect(parse('Still no reply.')[0].type).toBe('waiting');
  });
});

describe('timing edge cases', () => {
  it('a time that already passed today moves to the next slot with reduced confidence', () => {
    const c = one('Call the dentist today at 8am');
    expect(review(c)).toEqual(at(2026, 9, 23, 11));
    expect(c.timingConfidence).toBeLessThanOrEqual(0.5);
  });

  it('a bare clock time that passed means tomorrow', () => {
    expect(review(one('Remind me to stretch at 9'))).toEqual(at(2026, 9, 24, 9));
  });

  it('an explicit date beats the follow-up default for waiting loops', () => {
    const c = one("Waiting for the visa decision, they said 15 October");
    expect(review(c)).toEqual(at(2026, 10, 15, 11));
    expect(c.followUpPolicy).toBe('expected_date');
  });

  it('review time is always in the future for loops that have one', () => {
    const inputs = [
      'Call the dentist',
      'I emailed HR.',
      'Bring this back after payday',
      'Send Ozan the link tonight',
      'Waiting for the refund',
    ];
    for (const text of inputs) {
      for (const c of parse(text)) {
        if (c.nextReviewAt) expect(new Date(c.nextReviewAt).getTime()).toBeGreaterThan(NOW.getTime());
      }
    }
  });

  it('late in the evening, "later" rolls to tomorrow morning', () => {
    const c = parseText('Remind me later to call mom', at(2026, 9, 23, 21, 30)).candidates[0];
    expect(review(c)).toEqual(at(2026, 9, 24, 10));
  });
});

describe('invariants across a corpus', () => {
  const corpus = [
    "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived.",
    'I like the brown jacket but M fit better than XS. Bring this back after payday.',
    "I told Ozan I'd send him the link tonight.",
    'My passport number is in the blue folder.',
    "HR said they'd reply this week, I need to call the dentist tomorrow, and I want to look at that jacket again after payday…",
    'Ayşe said she’d send the file. The test result comes out Friday.',
    "Zara'ya iade ettim, para yatmadı. Yarın sabah doktoru aramam lazım. Ozan'a söz verdim, yarın göndereceğim.",
    'I need to renew my passport by 15 October',
    'Maybe Friday.',
    'sonra bakarım',
  ];

  it('every candidate is a well-formed draft', () => {
    for (const text of corpus) {
      for (const c of parse(text)) {
        expect(c.status).toBe('draft');
        expect(c.title.trim().length).toBeGreaterThan(0);
        expect(c.title.length).toBeLessThanOrEqual(81);
        for (const n of [c.classificationConfidence, c.timingConfidence, c.entityConfidence]) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(1);
        }
        expect(['user', 'other', 'system', 'none']).toContain(c.nextActionOwner);
        if (c.nextReviewAt) expect(Number.isNaN(Date.parse(c.nextReviewAt))).toBe(false);
        if (c.type === 'reference') expect(c.nextReviewAt).toBeNull();
        if (c.needsUserConfirmation && c.classificationConfidence >= 0.6) expect(c.confirmationQuestion).toBeTruthy();
      }
    }
  });

  it('ownership follows the type', () => {
    for (const text of corpus) {
      for (const c of parse(text)) {
        const expected = { task: 'user', promise: 'user', return_later: 'user', waiting: 'other', reference: 'none' } as const;
        if (c.type in expected) expect(c.nextActionOwner).toBe(expected[c.type as keyof typeof expected]);
      }
    }
  });

  it('is deterministic', () => {
    for (const text of corpus) expect(parseText(text, NOW)).toEqual(parseText(text, NOW));
  });

  it('never returns a raw context that is empty', () => {
    for (const text of corpus) for (const c of parse(text)) expect(c.rawContext?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('robustness', () => {
  it('does not throw on hostile input', () => {
    const nasty = [
      '...',
      '!!!???',
      ',,,, ,',
      '- - - -',
      'a',
      '🙂🙂🙂',
      'Call 🙂 tomorrow 🙂',
      'x'.repeat(5000),
      'İİİİ ıııı ŞŞŞ',
      'tomorrow tomorrow tomorrow tomorrow',
      'at 99 on 45/99 in 0 days',
      '31 February',
      "'".repeat(50),
      '\n\n\n',
      'I told I would I said I promised waiting for waiting for',
      'Zara Zara Zara HR HR HR',
    ];
    for (const text of nasty) expect(() => parseText(text, NOW)).not.toThrow();
  });

  it('does not throw on random text (seeded fuzz)', () => {
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const words = [
      'call', 'tomorrow', 'waiting', 'for', 'HR', 'the', 'refund', 'hasn\'t', 'arrived', 'yarın', 'maaştan', 'sonra',
      'bakarım', 'Friday', 'at', '3', '15:30', 'and', 'but', ',', '.', 'ama', 've', 'I', 'told', 'Ozan', "I'd", 'send',
      'lazım', 'cevap', 'bekliyorum', 'again', 'after', 'payday', 'Ayşe', "'a", '—', '?', 'remind', 'me', 'to',
    ];
    for (let i = 0; i < 300; i += 1) {
      const n = 1 + Math.floor(rand() * 14);
      const text = Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(' ');
      expect(() => parseText(text, NOW), text).not.toThrow();
    }
  });

  it('handles a long realistic brain-dump', () => {
    const dump = Array.from(
      { length: 40 },
      (_, i) => `Note ${i}: I emailed HR and I'm waiting for a reply. Call the dentist tomorrow.`,
    ).join('\n');
    const result = parseText(dump, NOW);
    expect(result.candidates.length).toBeGreaterThanOrEqual(80);
  });
});

describe('LoopParser interface', () => {
  it('parse() resolves to the same candidates as parseText', async () => {
    const parser = new LocalLoopParser();
    const text = "I told Ozan I'd send him the link tonight.";
    expect(await parser.parse(text, NOW)).toEqual(parseText(text, NOW).candidates);
  });

  it('analyze() also returns clarifications', async () => {
    const result = await new LocalLoopParser().analyze('Maybe Friday.', NOW);
    expect(result.clarifications).toHaveLength(1);
  });

  it('createParser() hands back a LoopParser and forwards the locale', async () => {
    const dayFirst = await createParser({ locale: 'tr-TR' }).parse('Call the dentist 12/10 at 3pm', NOW);
    const monthFirst = await createParser({ locale: 'en-US' }).parse('Call the dentist 12/10 at 3pm', NOW);
    expect(review(dayFirst[0])).toEqual(at(2026, 10, 12, 15));
    expect(review(monthFirst[0])).toEqual(at(2026, 12, 10, 15));
  });
});

describe('numeric dates follow the locale (decision: tr-TR is day/month)', () => {
  const reviewIn = (text: string, locale?: string) => review(parseText(text, NOW, { locale }).candidates[0]);

  it('tr-TR and en-GB read 12/10 as 12 October; en-US as 10 December', () => {
    expect(reviewIn('Call the dentist on 12/10 at 3pm', 'tr-TR')).toEqual(at(2026, 10, 12, 15));
    expect(reviewIn('Call the dentist on 12/10 at 3pm', 'en-GB')).toEqual(at(2026, 10, 12, 15));
    expect(reviewIn('Call the dentist on 12/10 at 3pm', 'en-US')).toEqual(at(2026, 12, 10, 15));
  });

  it('text written in Turkish is always day-first, even on an en-US device', () => {
    expect(reviewIn('12/10 tarihinde doktoru aramam lazım', 'en-US')).toEqual(at(2026, 10, 12, 10));
  });

  it('with no locale, the language of the text decides: Turkish day-first, English month-first', () => {
    expect(reviewIn('12/10 doktoru aramam lazım')).toEqual(at(2026, 10, 12, 10));
    expect(reviewIn('Call the dentist on 12/10 at 3pm')).toEqual(at(2026, 12, 10, 15));
  });

  it('a number above 12 is unambiguous whatever the locale says', () => {
    expect(reviewIn('Call the dentist on 25/12 at 3pm', 'en-US')).toEqual(at(2026, 12, 25, 15));
    expect(reviewIn('Call the dentist on 10/25 at 3pm', 'tr-TR')).toEqual(at(2026, 10, 25, 15));
  });

  it('dotted and ISO dates never depend on the locale', () => {
    expect(reviewIn('Call the dentist on 12.10.2026 at 3pm', 'en-US')).toEqual(at(2026, 10, 12, 15));
    expect(reviewIn('Call the dentist on 2026-10-12 at 3pm', 'en-US')).toEqual(at(2026, 10, 12, 15));
  });
});

describe('timingSource — did the user say it, or did we suggest it?', () => {
  it('stated: an explicit date or time', () => {
    expect(one('Call the dentist tomorrow at 3pm').timingSource).toBe('stated');
    expect(one('Call the dentist Friday').timingSource).toBe('stated');
    expect(one('Waiting for HR, they said Friday').timingSource).toBe('stated');
  });

  it('suggested: a default interval, a milestone, or a time we had to move', () => {
    expect(one('Call the dentist').timingSource).toBe('suggested');
    expect(one("I'm waiting for a reply from HR").timingSource).toBe('suggested');
    expect(one('Look at the coat again after payday').timingSource).toBe('suggested');
    expect(one('Call the dentist today at 8am').timingSource).toBe('suggested'); // 8am had passed; we moved it
  });

  it('none: references and events with no date', () => {
    expect(one('My passport number is in the blue folder.').timingSource).toBe('none');
    expect(one('My results come out soon').timingSource).toBe('none');
  });
});

// Wednesday 23 Sep 2026, 10:00. "saat 9da" = the next 09:00 = tomorrow.
describe('Turkish clock times as people actually type them (apostrophe optional)', () => {
  const trParse = (text: string) => parseText(text, NOW, { locale: 'tr-TR' }).candidates;
  const cases: [string, number, number][] = [
    ['saat 9da toplantım var', 9, 0],
    ['saat 9’da toplantım var', 9, 0],
    ['toplantım saat 9da', 9, 0],
    ['yarın 9da toplantım var', 9, 0],
    ['bugün saat 15:30’da doktor randevum var', 15, 30],
    ['yarın 14.00 te toplantı', 14, 0],
    ['yarın 14:00 te toplantı', 14, 0],
    ['yarın 9.30da toplantı', 9, 30],
  ];
  for (const [text, hour, minute] of cases) {
    it(`"${text}" → ${hour}:${String(minute).padStart(2, '0')}`, () => {
      const [found] = trParse(text);
      expect(found, text).toBeDefined();
      expect(found.type).not.toBe('reference');
      expect(found.timingSource).toBe('stated');
      const when = new Date(found.nextReviewAt as string);
      expect([when.getHours(), when.getMinutes()]).toEqual([hour, minute]);
    });
  }

  it('"akşam 8de" is 20:00 and the time words do not stay in the title', () => {
    const [found] = trParse('akşam 8de Ali’yi ara');
    expect(new Date(found.nextReviewAt as string).getHours()).toBe(20);
    expect(found.title).toBe('Ali’yi ara');
  });

  it('a date like 12.10 is still a date, not a clock time', () => {
    const [found] = trParse('12.10 tarihinde kira öde');
    const when = found.nextReviewAt ? new Date(found.nextReviewAt) : null;
    expect(when === null || when.getHours() !== 12 || when.getMinutes() !== 10).toBe(true);
  });
});

// "10 Ekim küçük prens gösterisi" — a stated date with a noun phrase, no verb, no event keyword.
describe('a stated calendar date makes an event even without an event keyword', () => {
  const trParse = (text: string) => parseText(text, at(2026, 10, 3, 10, 0), { locale: 'tr-TR' }).candidates;
  const cases: [string, number, number][] = [
    ['10 ekim küçük prens gösterisi', 9, 10],
    ["10 Ekim'de Küçük Prens gösterisi var", 9, 10],
    ['20 kasım Ozan’ın doğum günü', 10, 20],
  ];
  for (const [text, month, day] of cases) {
    it(`"${text}" → an event on ${day}/${month + 1}`, () => {
      const [found] = trParse(text);
      expect(found, text).toBeDefined();
      expect(found.type).toBe('event');
      const when = new Date(found.nextReviewAt as string);
      expect([when.getMonth(), when.getDate()]).toEqual([month, day]);
    });
  }

  it('a duration is not a date: "5 business days" still just restates the wait', () => {
    expect(parse("I'm waiting for the refund, they said 5 business days")).toHaveLength(1);
  });
  it('a bare weekday is still a question, never an invented item', () => {
    expect(parse('Maybe Friday.')).toHaveLength(0);
  });
});

// Same date, however people type it: case, Turkish letters, apostrophes, dashes, dots, case suffixes.
describe('day + Turkish month, every common spelling is the same date', () => {
  const trParse = (text: string) => parseText(text, at(2026, 10, 3, 10, 0), { locale: 'tr-TR' }).candidates;
  const spellings = [
    '10 ekim',
    '10 Ekim',
    '10 EKİM',
    '10 ekım',
    "10'ekim",
    '10’ekim',
    '10-ekim',
    '10–ekim',
    '10. ekim',
    '10.ekim',
    "10 Ekim'de",
    '10 Ekim’de',
    '10 ekimde',
    '10 Ekim’e kadar',
  ];
  for (const date of spellings) {
    it(`"${date} küçük prens gösterisi" → 10 October`, () => {
      const [found] = trParse(`${date} küçük prens gösterisi`);
      expect(found, date).toBeDefined();
      expect(found.type).toBe('event');
      const when = new Date(found.nextReviewAt as string);
      expect([when.getFullYear(), when.getMonth(), when.getDate()]).toEqual([2026, 9, 10]);
      // the date words never stay in the title
      expect(found.title.toLowerCase()).not.toMatch(/ekim|10/);
    });
  }

  const months: [string, number][] = [
    ['OCAK', 0], ['Şubat', 1], ['mart', 2], ['NİSAN', 3], ['Mayıs', 4], ['haziran', 5],
    ['Temmuz', 6], ['AĞUSTOS', 7], ['Eylül', 8], ['EKİM', 9], ['Kasım', 10], ['ARALIK', 11],
  ];
  for (const [name, index] of months) {
    it(`month name "${name}" (any case, with Turkish letters) is month ${index + 1}`, () => {
      const [found] = trParse(`20 ${name} Ozan’ın doğum günü`);
      expect(found, name).toBeDefined();
      const when = new Date(found.nextReviewAt as string);
      expect([when.getMonth(), when.getDate()]).toEqual([index, 20]);
    });
  }

  it('does not turn ordinary words into dates ("10 market", "5 mart" stays March, "12.10" stays a date)', () => {
    const [found] = trParse('10 market alışverişi yap');
    const when = found?.nextReviewAt ? new Date(found.nextReviewAt) : null;
    expect(when === null || when.getMonth() !== 2).toBe(true);
  });
});
