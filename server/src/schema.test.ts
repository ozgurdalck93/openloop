import { describe, expect, it } from 'vitest';

import { parseRequestSchema, parseResponseSchema, wireLoopSchema } from './schema.js';

const validLoop = {
  type: 'waiting',
  title: 'HR reply',
  status: 'draft',
  raw_context: 'HR said they would reply this week',
  next_action_owner: 'other',
  entity_name: 'HR',
  expected_event: 'a reply',
  next_review_at: '2026-10-03T09:00:00+03:00',
  closing_condition: 'You hear back',
  follow_up_policy: 'reply_work',
  classification_confidence: 0.9,
  timing_confidence: 0.7,
  entity_confidence: 0.8,
  needs_user_confirmation: false,
  confirmation_question: null,
};

describe('wireLoopSchema', () => {
  it('accepts a well-formed loop', () => {
    expect(wireLoopSchema.safeParse(validLoop).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    const result = wireLoopSchema.safeParse({ ...validLoop, type: 'reminder' });
    expect(result.success).toBe(false);
  });

  it('rejects a confidence outside 0-1', () => {
    const result = wireLoopSchema.safeParse({ ...validLoop, classification_confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects an unparsable next_review_at', () => {
    const result = wireLoopSchema.safeParse({ ...validLoop, next_review_at: 'sometime soon' });
    expect(result.success).toBe(false);
  });

  it('allows null on every optional field', () => {
    const result = wireLoopSchema.safeParse({
      ...validLoop,
      raw_context: null,
      entity_name: null,
      expected_event: null,
      next_review_at: null,
      closing_condition: null,
      follow_up_policy: null,
      confirmation_question: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('parseResponseSchema', () => {
  it('accepts an empty loops array', () => {
    expect(parseResponseSchema.safeParse({ loops: [] }).success).toBe(true);
  });

  it('rejects a missing loops field', () => {
    expect(parseResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('parseRequestSchema', () => {
  it('accepts a well-formed request', () => {
    const result = parseRequestSchema.safeParse({
      text: 'HR said they would reply this week',
      now: '2026-09-29T18:00:00+03:00',
      locale: 'tr-TR',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty text', () => {
    expect(parseRequestSchema.safeParse({ text: '', now: '2026-09-29T18:00:00+03:00' }).success).toBe(false);
  });

  it('rejects a non-ISO now', () => {
    expect(parseRequestSchema.safeParse({ text: 'hi', now: 'not a date' }).success).toBe(false);
  });

  it('treats locale as optional', () => {
    expect(parseRequestSchema.safeParse({ text: 'hi', now: '2026-09-29T18:00:00+03:00' }).success).toBe(true);
  });
});
