import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { uncertaintiesOf } from '@/engine/candidateEdit';
import { parseText } from '@/parser/localParser';
import { draftCandidates, draftReducer, initDraft, validateDraft, type ReviewDraft } from './reviewDraft';

const NOW = at(2026, 9, 23, 10, 0);
const FLOW_1 =
  "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived.";

const draftFor = (text: string): ReviewDraft => initDraft(parseText(text, NOW).candidates);
const item = (d: ReviewDraft, key: string) => d.items.find((i) => i.key === key)!;

describe('reviewDraft', () => {
  it('starts with one untouched card per candidate', () => {
    const d = draftFor(FLOW_1);
    expect(d.items.map((i) => i.candidate.title)).toEqual(['HR reply', 'Call dentist', 'Zara refund']);
    expect(d.items.every((i) => i.edited.length === 0)).toBe(true);
    expect(new Set(d.items.map((i) => i.key)).size).toBe(3);
  });

  it('every editable field can be changed, independently per card', () => {
    let d = draftFor(FLOW_1);
    d = draftReducer(d, { type: 'title', key: 'c1', value: 'Call Dr. Yılmaz' });
    d = draftReducer(d, { type: 'entity', key: 'c1', value: 'Dr. Yılmaz' });
    d = draftReducer(d, { type: 'context', key: 'c1', value: 'about the crown' });
    d = draftReducer(d, { type: 'when', key: 'c1', when: at(2026, 9, 25, 16, 30) });
    d = draftReducer(d, { type: 'retype', key: 'c1', to: 'promise', now: NOW });

    expect(item(d, 'c1').candidate).toMatchObject({
      title: 'Call Dr. Yılmaz',
      entityName: 'Dr. Yılmaz',
      rawContext: 'about the crown',
      type: 'promise',
      nextActionOwner: 'user',
      nextReviewAt: at(2026, 9, 25, 16, 30).toISOString(),
    });
    expect(item(d, 'c1').edited.sort()).toEqual(['context', 'entity', 'title', 'type', 'when']);
    // the other cards are untouched
    expect(item(d, 'c0').candidate.title).toBe('HR reply');
    expect(item(d, 'c2').edited).toEqual([]);
  });

  it('editing the same field twice records it once', () => {
    let d = draftFor(FLOW_1);
    d = draftReducer(d, { type: 'title', key: 'c0', value: 'A' });
    d = draftReducer(d, { type: 'title', key: 'c0', value: 'AB' });
    expect(item(d, 'c0').edited).toEqual(['title']);
  });

  it('removing a card leaves the others (and their keys) alone', () => {
    let d = draftFor(FLOW_1);
    d = draftReducer(d, { type: 'remove', key: 'c1' });
    expect(d.items.map((i) => i.key)).toEqual(['c0', 'c2']);
    expect(draftCandidates(d).map((c) => c.title)).toEqual(['HR reply', 'Zara refund']);
    d = draftReducer(d, { type: 'title', key: 'c2', value: 'Zara money back' });
    expect(draftCandidates(d).map((c) => c.title)).toEqual(['HR reply', 'Zara money back']);
  });

  it('removing everything leaves an empty draft', () => {
    let d = draftFor(FLOW_1);
    for (const key of ['c0', 'c1', 'c2']) d = draftReducer(d, { type: 'remove', key });
    expect(d.items).toEqual([]);
    expect(validateDraft(d, NOW)).toEqual({});
  });

  it('an unknown key changes nothing', () => {
    const d = draftFor(FLOW_1);
    expect(draftReducer(d, { type: 'title', key: 'nope', value: 'x' })).toEqual(d);
    expect(draftReducer(d, { type: 'remove', key: 'nope' })).toEqual(d);
  });

  it('is pure: the previous state is never mutated', () => {
    const d = Object.freeze(draftFor(FLOW_1)) as ReviewDraft;
    expect(() => draftReducer(d, { type: 'title', key: 'c0', value: 'x' })).not.toThrow();
    expect(d.items[0].candidate.title).toBe('HR reply');
  });

  describe('validation', () => {
    it('a fresh draft from the parser is valid', () => {
      expect(validateDraft(draftFor(FLOW_1), NOW)).toEqual({});
    });

    it('reports issues per card and clears them as the user fixes them', () => {
      let d = draftFor(FLOW_1);
      d = draftReducer(d, { type: 'title', key: 'c1', value: '   ' });
      d = draftReducer(d, { type: 'when', key: 'c2', when: at(2026, 9, 20, 9) });
      let problems = validateDraft(d, NOW);
      expect(Object.keys(problems).sort()).toEqual(['c1', 'c2']);
      expect(problems.c1.map((i) => i.code)).toEqual(['title_required']);
      expect(problems.c2.map((i) => i.code)).toEqual(['when_passed']);

      d = draftReducer(d, { type: 'title', key: 'c1', value: 'Call the dentist' });
      d = draftReducer(d, { type: 'when', key: 'c2', when: at(2026, 9, 28, 9) });
      problems = validateDraft(d, NOW);
      expect(problems).toEqual({});
    });

    it('a note retyped from a loop can always be kept, even though it lost its time', () => {
      let d = draftFor(FLOW_1);
      d = draftReducer(d, { type: 'retype', key: 'c1', to: 'reference', now: NOW });
      expect(validateDraft(d, NOW)).toEqual({});
    });
  });

  describe('the "Not sure about…" hints follow the edits', () => {
    it('drop a hint once the user has touched that field', () => {
      let d = draftFor("I emailed HR. I'm waiting for a reply from Acme.");
      // the second candidate's timing is a default interval: low confidence, so flagged
      const before = uncertaintiesOf(item(d, 'c1').candidate, item(d, 'c1').edited);
      expect(before).toContain('timing');
      d = draftReducer(d, { type: 'when', key: 'c1', when: at(2026, 9, 28, 9) });
      expect(uncertaintiesOf(item(d, 'c1').candidate, item(d, 'c1').edited)).not.toContain('timing');
    });

    it('a doubtful type is settled by choosing one', () => {
      let d = draftFor('I emailed HR.');
      expect(uncertaintiesOf(item(d, 'c0').candidate, item(d, 'c0').edited)).toContain('type');
      d = draftReducer(d, { type: 'retype', key: 'c0', to: 'waiting', now: NOW });
      expect(uncertaintiesOf(item(d, 'c0').candidate, item(d, 'c0').edited)).not.toContain('type');
    });
  });
});
