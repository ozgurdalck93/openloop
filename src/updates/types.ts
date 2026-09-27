import type { Loop, Milestone } from '@/engine/types';

/** What the user is telling us about a loop they already have. */
export type UpdateIntent =
  /** It came / they sent it / it is done. */
  | 'resolve'
  /** Still no reply. */
  | 'still_waiting'
  /** Move it to Friday afternoon; remind me next month instead. */
  | 'reschedule'
  /** Not relevant anymore. */
  | 'dismiss';

export interface RankedLoop {
  loop: Loop;
  /** Higher = a better match. Only meaningful for comparing candidates of one proposal. */
  score: number;
}

/**
 *  high      one loop clearly fits — proposed, and still confirmed by the user
 *  ambiguous several fit about equally — the user chooses
 *  low       nothing in the words points at a loop ("they sent it", "next month instead") — the user chooses;
 *            we never guess
 */
export type MatchConfidence = 'high' | 'ambiguous' | 'low';

/** The new time the user named, before it is applied to a specific loop. */
export interface RescheduleWhen {
  at: Date | null;
  /** A clock time or part of day was named (otherwise the loop keeps its time of day). */
  hasTime: boolean;
  milestone: Milestone | null;
  label: string | null;
}

export interface UpdateProposal {
  /** Stable within one interpretation; used as a UI key. */
  id: string;
  /** The clause as the user wrote it. */
  said: string;
  intent: UpdateIntent;
  confidence: MatchConfidence;
  /** Every loop this update could apply to, best first. For 'high' the first one is what we propose. */
  candidates: RankedLoop[];
  /** Only for 'reschedule'. */
  when: RescheduleWhen | null;
}

export interface UpdateInterpretation {
  proposals: UpdateProposal[];
  /**
   * Clauses that sounded like an update but named something no open loop matches ("Nike refund came"
   * with no Nike loop). Nothing is changed for them — and nothing is invented.
   */
  unmatched: string[];
  /** What is left after the update clauses are taken out: text for the normal capture parser. */
  remainder: string;
}
