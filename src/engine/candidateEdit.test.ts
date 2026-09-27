import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { parseText } from '@/parser/localParser';
import type { LoopCandidate } from '@/parser/types';
import {
  editContext,
  editEntity,
  editTitle,
  editWhen,
  retypeCandidate,
  uncertaintiesOf,
  validateCandidate,
  type CandidateField,
} from './candidateEdit';

// Wednesday 23 Sep 2026, 10:00.
const NOW = at(2026, 9, 23, 10, 0);
const iso = (d: Date) => d.toISOString();
const first = (text: string): LoopCandidate => parseText(text, NOW).candidates[0];
const codes = (c: LoopCandidate) => validateCandidate(c, NOW).map((i) => `${i.field}:${i.code}`);

describe('editing fields', () => {
  it('title: keeps what the user typed (a blank title is a validation error, not silently fixed)', () => {
    const c = first('Call the dentist tomorrow');
    expect(editTitle(c, '  Call   Dr. Yılmaz').title).toBe('Call Dr. Yılmaz');
    expect(editTitle(c, '').title).toBe('');
    expect(codes(editTitle(c, ''))).toContain('title:title_required');
  });

  it('entity: a typed name is certain; clearing it removes the entity', () => {
    const c = first("I'm waiting for a reply from Acme");
    const named = editEntity(c, '  Acme Corp');
    expect(named).toMatchObject({ entityName: 'Acme Corp', entityConfidence: 1 });
    expect(editEntity(named, '   ')).toMatchObject({ entityName: null, entityConfidence: 0 });
  });

  it('typing "Dr. Yilmaz" one key at a time never loses the space after "Dr." (regression: found in a real browser)', () => {
    let c = first('Call the dentist tomorrow');
    for (const typed of ['D', 'Dr', 'Dr.', 'Dr. ', 'Dr. Y', 'Dr. Yilmaz']) c = editEntity(c, typed);
    expect(c.entityName).toBe('Dr. Yilmaz');
    let t = first('Call the dentist tomorrow');
    for (const typed of ['C', 'Ca', 'Call ', 'Call D', 'Call Dr. ']) t = editTitle(t, typed);
    expect(t.title).toBe('Call Dr. '); // a trailing space is kept while typing
  });

  it('while typing, only doubled and leading spaces are dropped — the final trim happens on keep', () => {
    expect(editEntity(first('Call the dentist tomorrow'), 'Dr. Yilmaz  ').entityName).toBe('Dr. Yilmaz ');
    expect(editEntity(first('Call the dentist tomorrow'), '   ').entityName).toBeNull();
  });

  it('context: blank becomes null', () => {
    const c = first('Call the dentist tomorrow');
    expect(editContext(c, 'ask about the crown').rawContext).toBe('ask about the crown');
    expect(editContext(c, '   ').rawContext).toBeNull();
  });

  it('when: a chosen time is stated, certain, and drops any "After payday" label', () => {
    const c = first('Look at the coat again after payday');
    expect(c.timingLabel).toBe('After payday');
    const moved = editWhen(c, at(2026, 10, 15, 9));
    expect(moved).toMatchObject({
      nextReviewAt: iso(at(2026, 10, 15, 9)),
      timingSource: 'stated',
      timingConfidence: 1,
      timingLabel: null,
    });
  });

  it('when: the follow-up policy matches the type', () => {
    const w = editWhen(first("I'm waiting for a reply from HR"), at(2026, 9, 30, 9));
    expect(w.followUpPolicy).toBe('expected_date');
    expect(editWhen(first('Call the dentist'), at(2026, 9, 30, 9)).followUpPolicy).toBe('exact_time');
    expect(editWhen(first("I told Ozan I'd send him the link"), at(2026, 9, 30, 9)).followUpPolicy).toBe('before_due');
  });

  it('when: null removes the time', () => {
    expect(editWhen(first('Call the dentist'), null)).toMatchObject({ nextReviewAt: null, timingSource: 'none' });
  });

  it('never mutates its input', () => {
    const c = Object.freeze(first('Call the dentist tomorrow'));
    expect(() => {
      editTitle(c, 'x');
      editEntity(c, 'x');
      editContext(c, 'x');
      editWhen(c, NOW);
      retypeCandidate(c, 'waiting', NOW);
    }).not.toThrow();
  });
});

describe('retypeCandidate', () => {
  it('owner follows the type, and the user\'s choice settles the parser\'s doubt', () => {
    const doubtful = first('I emailed HR.'); // a past action: the parser guessed "waiting" at 0.55
    expect(doubtful.classificationConfidence).toBeLessThan(0.6);
    expect(doubtful.confirmationQuestion).toBeTruthy();

    const asTask = retypeCandidate(doubtful, 'task', NOW);
    expect(asTask).toMatchObject({
      type: 'task',
      nextActionOwner: 'user',
      classificationConfidence: 1,
      needsUserConfirmation: false,
      confirmationQuestion: null,
    });
    expect(retypeCandidate(doubtful, 'event', NOW).nextActionOwner).toBe('system');
    expect(retypeCandidate(doubtful, 'reference', NOW).nextActionOwner).toBe('none');
  });

  it('a reference has no reminder: its time and policy are cleared', () => {
    const asRef = retypeCandidate(first('Call the dentist tomorrow'), 'reference', NOW);
    expect(asRef).toMatchObject({ nextReviewAt: null, followUpPolicy: 'none', timingSource: 'none', timingLabel: null });
    expect(asRef.closingCondition).toBeNull();
  });

  it('turning a note into a loop that needs a time gives it that type\'s default suggestion', () => {
    const note = first('M fit better than XS.'); // a reference: nothing in it says work or refund
    expect(note.nextReviewAt).toBeNull();

    const task = retypeCandidate(note, 'task', NOW);
    expect(task).toMatchObject({ timingSource: 'suggested', followUpPolicy: 'context_time' });
    expect(new Date(task.nextReviewAt as string).getTime()).toBeGreaterThan(NOW.getTime());

    const waiting = retypeCandidate(note, 'waiting', NOW);
    expect(waiting.followUpPolicy).toBe('reply_casual'); // nothing about it says "work" or "refund"
    expect(retypeCandidate(note, 'return_later', NOW).followUpPolicy).toBe('later_default');
    expect(retypeCandidate(note, 'promise', NOW).followUpPolicy).toBe('before_due');
  });

  it('a waiting loop picks its interval from what it is about', () => {
    const note = editTitle(first('Zara jacket should be refunded soon'), 'Zara refund');
    expect(retypeCandidate({ ...note, type: 'reference', nextReviewAt: null }, 'waiting', NOW).followUpPolicy).toBe('admin_wait');
  });

  it('an event still needs a real date from the user — no invented one', () => {
    const asEvent = retypeCandidate(first('My passport number is in the blue folder.'), 'event', NOW);
    expect(asEvent.nextReviewAt).toBeNull();
    expect(codes(asEvent)).toContain('when:when_required');
  });

  it('keeps an existing time when the new type also needs one', () => {
    const c = first('Call the dentist tomorrow at 3pm');
    expect(retypeCandidate(c, 'promise', NOW).nextReviewAt).toBe(c.nextReviewAt);
    expect(retypeCandidate(c, 'promise', NOW).timingSource).toBe('stated');
  });

  it('swaps the stock closing condition but keeps a specific one', () => {
    const task = first('Call the dentist tomorrow');
    expect(retypeCandidate(task, 'waiting', NOW).closingCondition).toBe('Reply received');
    const promise = first("I told Ozan I'd send him the link tonight."); // "link sent" is specific
    expect(promise.closingCondition).toBe('link sent');
    expect(retypeCandidate(promise, 'task', NOW).closingCondition).toBe('link sent');
  });
});

describe('validateCandidate — nothing invalid gets saved', () => {
  it('a parser candidate is valid', () => {
    for (const text of [
      'Call the dentist tomorrow',
      "I'm waiting for a reply from HR",
      'My passport number is in the blue folder.',
      "I told Ozan I'd send him the link tonight.",
    ]) {
      expect(codes(first(text))).toEqual([]);
    }
  });

  it('title: required, and not absurdly long', () => {
    const c = first('Call the dentist tomorrow');
    expect(codes({ ...c, title: '   ' })).toEqual(['title:title_required']);
    expect(codes({ ...c, title: 'x'.repeat(121) })).toEqual(['title:title_too_long']);
    expect(codes({ ...c, title: 'x'.repeat(120) })).toEqual([]);
  });

  it('time: every type except a reference needs one, and it must be ahead of now', () => {
    const c = first('Call the dentist tomorrow');
    expect(codes({ ...c, nextReviewAt: null })).toEqual(['when:when_required']);
    expect(codes({ ...c, nextReviewAt: iso(at(2026, 9, 23, 9, 59)) })).toEqual(['when:when_passed']);
    expect(codes({ ...c, nextReviewAt: iso(NOW) })).toEqual(['when:when_passed']); // "now" is already past
    expect(codes({ ...c, nextReviewAt: iso(at(2026, 9, 23, 10, 1)) })).toEqual([]);
    expect(codes({ ...c, type: 'reference', nextReviewAt: null })).toEqual([]);
  });

  it('a reference is never blocked by a time, even a stale one', () => {
    expect(codes({ ...first('Call the dentist tomorrow'), type: 'reference', nextReviewAt: null })).toEqual([]);
  });

  it('note length is capped', () => {
    const c = first('Call the dentist tomorrow');
    expect(codes({ ...c, rawContext: 'x'.repeat(2001) })).toEqual(['context:context_too_long']);
  });

  it('reports every problem at once, so the user can fix them in one pass', () => {
    const c = first('Call the dentist tomorrow');
    expect(codes({ ...c, title: '', nextReviewAt: null })).toEqual(['title:title_required', 'when:when_required']);
  });
});

describe('uncertaintiesOf — what the Review screen says we are unsure about', () => {
  const none: CandidateField[] = [];

  it('is quiet when the user said everything clearly', () => {
    expect(uncertaintiesOf(first('Tomorrow afternoon remind me to call the dentist'), none)).toEqual([]);
  });

  it('flags a shaky type: "I emailed HR." is only a guess that we are waiting', () => {
    expect(uncertaintiesOf(first('I emailed HR.'), none)).toContain('type');
  });

  it('flags a low-confidence time: nobody said when HR would reply', () => {
    const c = first("I'm waiting for a reply from HR");
    expect(c.timingConfidence).toBeLessThan(0.6);
    expect(uncertaintiesOf(c, none)).toContain('timing');
  });

  it('a guessed payday gets its own honest message instead of the generic one', () => {
    const list = uncertaintiesOf(first('Look at the coat again after payday'), none);
    expect(list).toContain('payday');
    expect(list).not.toContain('timing');
  });

  it('a reasonable default the user never stated is a calm "suggested", not a warning', () => {
    const c = first('Call the dentist'); // no time said; we suggest the next slot
    const list = uncertaintiesOf({ ...c, timingConfidence: 0.75 }, none);
    expect(list).toEqual(['suggested']);
  });

  it('a role like "the ticket company" is a fair reading, not a doubt — no "not sure about the name"', () => {
    const c = first('Waiting for the ticket company.');
    expect(c.entityName).toBe('ticket company');
    expect(c.entityConfidence).toBe(0.5);
    expect(uncertaintiesOf(c, none)).not.toContain('name');
  });

  it('flags a name only when the source is genuinely doubtful (e.g. an AI parser at 0.3), and only if there is one', () => {
    const c = { ...first('Waiting for the ticket company.'), entityConfidence: 0.3 };
    expect(uncertaintiesOf(c, none)).toContain('name');
    expect(uncertaintiesOf({ ...c, entityName: null }, none)).not.toContain('name');
    expect(uncertaintiesOf(c, ['entity'])).not.toContain('name');
  });

  it('never mentions timing for a reference', () => {
    expect(uncertaintiesOf(first('My passport number is in the blue folder.'), none)).toEqual([]);
  });

  it('stops flagging a field once the user has edited it', () => {
    const c = first('I emailed HR.');
    expect(uncertaintiesOf(c, ['type'])).not.toContain('type');
    const waiting = first("I'm waiting for a reply from HR");
    expect(uncertaintiesOf(waiting, ['when'])).toEqual([]);
  });
});
