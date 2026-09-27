/**
 * The wire contract from 04_OPENLOOP_AI_OUTPUT_SCHEMA.json (snake_case JSON).
 * A future AI-backed parser returns this; `candidatesFromAiResponse` validates
 * it strictly and converts to `LoopCandidate`. `candidateToWire` goes the other
 * way, which is how tests prove the local parser speaks the same contract.
 *
 * Validation is per item: one malformed loop in an otherwise good response is
 * reported and skipped, never allowed to throw away the rest.
 */
import { LOOP_STATUSES, LOOP_TYPES, NEXT_ACTION_OWNERS } from '@/engine/types';

import type { LoopCandidate } from './types';

export interface WireLoop {
  type: string;
  title: string;
  status: string;
  raw_context?: string | null;
  next_action_owner: string;
  entity_name?: string | null;
  expected_event?: string | null;
  next_review_at?: string | null;
  closing_condition?: string | null;
  follow_up_policy?: string | null;
  classification_confidence: number;
  timing_confidence: number;
  entity_confidence: number;
  needs_user_confirmation?: boolean;
  confirmation_question?: string | null;
}

export interface AiParseOutcome {
  candidates: LoopCandidate[];
  /** One human-readable line per rejected loop or structural problem. */
  errors: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function optionalString(o: Record<string, unknown>, key: string, errors: string[]): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  errors.push(`${key} must be a string or null`);
  return null;
}

function confidence(o: Record<string, unknown>, key: string, errors: string[]): number {
  const v = o[key];
  if (typeof v === 'number' && v >= 0 && v <= 1) return v;
  errors.push(`${key} must be a number between 0 and 1`);
  return 0;
}

function oneOf<T extends string>(o: Record<string, unknown>, key: string, allowed: readonly T[], errors: string[]): T {
  const v = o[key];
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
  errors.push(`${key} must be one of ${allowed.join(', ')}`);
  return allowed[0];
}

export function candidatesFromAiResponse(json: unknown): AiParseOutcome {
  if (!isRecord(json) || !Array.isArray(json.loops)) {
    return { candidates: [], errors: ['Response must be an object with a "loops" array'] };
  }
  const candidates: LoopCandidate[] = [];
  const errors: string[] = [];

  json.loops.forEach((item, index) => {
    const problems: string[] = [];
    if (!isRecord(item)) {
      errors.push(`loops[${index}]: must be an object`);
      return;
    }
    const type = oneOf(item, 'type', LOOP_TYPES, problems);
    const status = oneOf(item, 'status', LOOP_STATUSES, problems);
    const owner = oneOf(item, 'next_action_owner', NEXT_ACTION_OWNERS, problems);
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null;
    if (!title) problems.push('title must be a non-empty string');

    const nextReviewAt = optionalString(item, 'next_review_at', problems);
    if (nextReviewAt !== null && Number.isNaN(Date.parse(nextReviewAt))) {
      problems.push('next_review_at must be an ISO-8601 date');
    }
    const classification = confidence(item, 'classification_confidence', problems);
    const timing = confidence(item, 'timing_confidence', problems);
    const entity = confidence(item, 'entity_confidence', problems);
    const question = optionalString(item, 'confirmation_question', problems);
    const flag = item.needs_user_confirmation;
    if (flag !== undefined && typeof flag !== 'boolean') problems.push('needs_user_confirmation must be a boolean');

    const candidate: LoopCandidate = {
      type,
      title: title ?? '',
      status,
      rawContext: optionalString(item, 'raw_context', problems),
      nextActionOwner: owner,
      entityName: optionalString(item, 'entity_name', problems),
      expectedEvent: optionalString(item, 'expected_event', problems),
      nextReviewAt,
      closingCondition: optionalString(item, 'closing_condition', problems),
      followUpPolicy: optionalString(item, 'follow_up_policy', problems),
      // The wire format has no such field: any time an AI gives us is a suggestion until the user confirms it.
      timingSource: nextReviewAt !== null ? 'suggested' : 'none',
      classificationConfidence: classification,
      timingConfidence: timing,
      entityConfidence: entity,
      needsUserConfirmation: flag === true,
      confirmationQuestion: question,
      timingLabel: null,
    };

    if (problems.length > 0) {
      errors.push(`loops[${index}]: ${problems.join('; ')}`);
    } else {
      candidates.push(candidate);
    }
  });

  return { candidates, errors };
}

export function candidateToWire(c: LoopCandidate): WireLoop {
  return {
    type: c.type,
    title: c.title,
    status: c.status,
    raw_context: c.rawContext,
    next_action_owner: c.nextActionOwner,
    entity_name: c.entityName,
    expected_event: c.expectedEvent,
    next_review_at: c.nextReviewAt,
    closing_condition: c.closingCondition,
    follow_up_policy: c.followUpPolicy,
    classification_confidence: c.classificationConfidence,
    timing_confidence: c.timingConfidence,
    entity_confidence: c.entityConfidence,
    needs_user_confirmation: c.needsUserConfirmation,
    confirmation_question: c.confirmationQuestion,
  };
}
