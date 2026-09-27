import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LOOP_STATUSES, LOOP_TYPES, NEXT_ACTION_OWNERS } from '@/engine/types';

import { at } from '../../test/fixtures';
import { candidateToWire, candidatesFromAiResponse } from './aiSchema';
import { parseText } from './localParser';

interface SchemaFile {
  properties: { loops: { items: { required: string[]; properties: Record<string, { enum?: string[] }> } } };
}
const schema = JSON.parse(readFileSync(join(process.cwd(), '04_OPENLOOP_AI_OUTPUT_SCHEMA.json'), 'utf8')) as SchemaFile;
const item = schema.properties.loops.items;

const valid = {
  type: 'waiting',
  title: 'HR reply',
  status: 'waiting',
  raw_context: 'I emailed HR',
  next_action_owner: 'other',
  entity_name: 'HR',
  expected_event: 'reply',
  next_review_at: '2026-09-25T08:00:00.000Z',
  closing_condition: 'Reply received',
  follow_up_policy: 'reply_work',
  classification_confidence: 0.9,
  timing_confidence: 0.4,
  entity_confidence: 0.8,
  needs_user_confirmation: false,
  confirmation_question: null,
};

describe('our enums match 04_OPENLOOP_AI_OUTPUT_SCHEMA.json', () => {
  it('type, status and next_action_owner enums are identical', () => {
    expect(item.properties.type.enum).toEqual([...LOOP_TYPES]);
    expect(item.properties.status.enum).toEqual([...LOOP_STATUSES]);
    expect(item.properties.next_action_owner.enum).toEqual([...NEXT_ACTION_OWNERS]);
  });
});

describe('candidatesFromAiResponse', () => {
  it('accepts a schema-valid response', () => {
    const { candidates, errors } = candidatesFromAiResponse({ loops: [valid] });
    expect(errors).toEqual([]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'waiting',
      title: 'HR reply',
      nextActionOwner: 'other',
      entityName: 'HR',
      nextReviewAt: '2026-09-25T08:00:00.000Z',
      classificationConfidence: 0.9,
    });
  });

  it('accepts only the required fields (everything else is optional/nullable)', () => {
    const minimal = Object.fromEntries(item.required.map((k) => [k, (valid as Record<string, unknown>)[k]]));
    const { candidates, errors } = candidatesFromAiResponse({ loops: [minimal] });
    expect(errors).toEqual([]);
    expect(candidates[0].rawContext).toBeNull();
    expect(candidates[0].needsUserConfirmation).toBe(false);
  });

  it.each(item.required)('rejects a loop missing required field %s', (field) => {
    const broken: Record<string, unknown> = { ...valid };
    delete broken[field];
    const { candidates, errors } = candidatesFromAiResponse({ loops: [broken] });
    expect(candidates).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('rejects out-of-range confidence, unknown enums, and bad dates', () => {
    const bad = [
      { ...valid, classification_confidence: 1.5 },
      { ...valid, timing_confidence: -0.1 },
      { ...valid, type: 'kanban' },
      { ...valid, status: 'done' },
      { ...valid, next_action_owner: 'everyone' },
      { ...valid, next_review_at: 'next friday-ish' },
      { ...valid, title: '   ' },
      { ...valid, raw_context: 42 },
      { ...valid, needs_user_confirmation: 'yes' },
    ];
    for (const b of bad) {
      const { candidates, errors } = candidatesFromAiResponse({ loops: [b] });
      expect(candidates).toEqual([]);
      expect(errors).toHaveLength(1);
    }
  });

  it('keeps the good loops when a sibling is malformed', () => {
    const { candidates, errors } = candidatesFromAiResponse({ loops: [valid, { nope: true }, 'text', valid] });
    expect(candidates).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });

  it('rejects structurally wrong responses without throwing', () => {
    for (const bad of [null, undefined, 'x', 42, [], {}, { loops: 'no' }]) {
      const out = candidatesFromAiResponse(bad);
      expect(out.candidates).toEqual([]);
      expect(out.errors.length).toBeGreaterThan(0);
    }
  });

  it('accepts an empty loops array (nothing found is a valid answer)', () => {
    expect(candidatesFromAiResponse({ loops: [] })).toEqual({ candidates: [], errors: [] });
  });
});

describe('the local parser speaks the same contract', () => {
  it('every local candidate survives a round trip through the wire format', () => {
    const now = at(2026, 9, 23, 10, 0);
    const text =
      "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived. I told Ozan I'd send him the link tonight. My passport number is in the blue folder. Bring this back after payday.";
    const { candidates } = parseText(text, now);
    expect(candidates.length).toBeGreaterThanOrEqual(5);

    const wire = candidates.map(candidateToWire);
    for (const w of wire) for (const key of item.required) expect(w).toHaveProperty(key);

    const back = candidatesFromAiResponse({ loops: wire });
    expect(back.errors).toEqual([]);
    expect(back.candidates.map((c) => c.title)).toEqual(candidates.map((c) => c.title));
    expect(back.candidates.map((c) => c.nextReviewAt)).toEqual(candidates.map((c) => c.nextReviewAt));
  });
});
