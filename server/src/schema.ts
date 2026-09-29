/**
 * Mirrors 04_OPENLOOP_AI_OUTPUT_SCHEMA.json and the `WireLoop` contract in
 * src/parser/aiSchema.ts. Keep the three in sync by hand — there is no shared
 * package between the app and this server, so this is the one place a field
 * rename here needs to be reflected there too.
 */
import { z } from 'zod';

export const LOOP_TYPES = ['task', 'waiting', 'event', 'promise', 'return_later', 'reference'] as const;
export const LOOP_STATUSES = ['draft', 'active', 'waiting', 'scheduled', 'snoozed', 'resolved', 'archived'] as const;
export const NEXT_ACTION_OWNERS = ['user', 'other', 'system', 'none'] as const;

/** src/engine/followUpPolicy.ts FollowUpPolicyKey. Any other string is accepted by the app but
 * ignored by the engine, so steering the model onto these keeps a suggestion useful. */
export const FOLLOW_UP_POLICIES = [
  'exact_time',
  'context_time',
  'reply_work',
  'reply_casual',
  'admin_wait',
  'expected_date',
  'at_event',
  'before_due',
  'milestone',
  'later_default',
  'none',
] as const;

const confidence = z.number().min(0).max(1);

export const wireLoopSchema = z.object({
  type: z.enum(LOOP_TYPES),
  title: z.string().min(1),
  // Always "draft" — the client-side engine derives the real initial status
  // from `type`. Kept as a field (not hardcoded) so it matches the wire contract.
  status: z.enum(LOOP_STATUSES),
  raw_context: z.string().nullable(),
  next_action_owner: z.enum(NEXT_ACTION_OWNERS),
  entity_name: z.string().nullable(),
  expected_event: z.string().nullable(),
  next_review_at: z
    .string()
    .nullable()
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), 'must be an ISO-8601 date'),
  closing_condition: z.string().nullable(),
  follow_up_policy: z.enum(FOLLOW_UP_POLICIES).nullable(),
  classification_confidence: confidence,
  timing_confidence: confidence,
  entity_confidence: confidence,
  needs_user_confirmation: z.boolean(),
  confirmation_question: z.string().nullable(),
});

export const parseResponseSchema = z.object({
  loops: z.array(wireLoopSchema),
});

export type WireLoop = z.infer<typeof wireLoopSchema>;
export type ParseResponse = z.infer<typeof parseResponseSchema>;

/** POST /v1/parse request body. */
export const parseRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  // ISO-8601 WITH an explicit UTC offset (e.g. "2026-09-29T18:16:00+03:00") so the
  // model can reason in the user's local calendar, per CLAUDE.md ("time is local").
  now: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO-8601 date'),
  locale: z.string().nullable().optional(),
});

export type ParseRequest = z.infer<typeof parseRequestSchema>;
