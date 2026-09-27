import type { LoopStatus, LoopType, NextActionOwner } from '@/engine/types';

export type TimingSource = 'stated' | 'suggested' | 'none';

/**
 * A loop the parser thinks it found, before the user has confirmed it. Field
 * names mirror the AI response contract in 04_OPENLOOP_AI_OUTPUT_SCHEMA.json
 * (camelCase here, snake_case on the wire — see `aiSchema.ts`), so a future AI
 * parser can return the same shape.
 */
export interface LoopCandidate {
  type: LoopType;
  title: string;
  /**
   * Advisory. The local parser always says 'draft' (nothing is stored until the
   * user confirms); the engine derives the real initial status from `type`.
   */
  status: LoopStatus;
  rawContext: string | null;
  nextActionOwner: NextActionOwner;
  entityName: string | null;
  expectedEvent: string | null;
  /** ISO-8601, or null when there is nothing sensible to suggest. Always editable. */
  nextReviewAt: string | null;
  closingCondition: string | null;
  /** A FollowUpPolicyKey. */
  followUpPolicy: string | null;
  /**
   * Where the review time came from: the user SAID it ('stated'), we filled it in from a
   * default or a milestone like "after payday" ('suggested'), or there is none ('none').
   * The Review screen shows suggested times as suggestions.
   */
  timingSource: TimingSource;
  classificationConfidence: number;
  timingConfidence: number;
  entityConfidence: number;
  needsUserConfirmation: boolean;
  confirmationQuestion: string | null;
  /** What to show in the review card instead of a raw date, e.g. "After payday". */
  timingLabel: string | null;
}

/** Something the user said that the parser refuses to guess about (e.g. "Maybe Friday."). */
export interface Clarification {
  /** The fragment as the user wrote it. */
  text: string;
  question: string;
}

export interface ParseResult {
  candidates: LoopCandidate[];
  clarifications: Clarification[];
}

export interface ParseOptions {
  /**
   * The device locale (BCP-47, e.g. "tr-TR", "en-US"). It decides how a numeric date like
   * "12/10" reads: day-first for tr-TR / en-GB, month-first for en-US. Text written in
   * Turkish is always day-first.
   */
  locale?: string;
}

/**
 * The seam between capture and understanding. v0.1 ships a deterministic local
 * implementation; an AI-backed parser can replace or augment it without the
 * rest of the app noticing.
 */
export interface LoopParser {
  parse(text: string, now: Date): Promise<LoopCandidate[]>;
  /**
   * Optional richer entry point that also reports what the parser declined to
   * guess. Callers should go through `analyzeText` in `parser/index.ts`, which
   * falls back to `parse` for parsers that do not implement this.
   */
  analyze?(text: string, now: Date): Promise<ParseResult>;
}
