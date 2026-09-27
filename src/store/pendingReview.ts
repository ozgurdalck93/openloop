import type { Clarification, LoopCandidate } from '@/parser/types';
import type { UpdateProposal } from '@/updates/types';

/**
 * What Capture hands to Review. Nothing is stored yet — the user has not
 * confirmed. Held in memory (not route params) because candidates are too big
 * and structured to serialise into a URL, and a killed app should simply start
 * over at Capture rather than resurrect half a review.
 */
export interface PendingReview {
  rawText: string;
  candidates: LoopCandidate[];
  clarifications: Clarification[];
  /** Natural-language updates to loops that already exist ("Refund came") — never applied here, only proposed. */
  updates: UpdateProposal[];
  /** Sounded like an update but named something no open loop matches ("Acme refund came", no Acme loop). */
  unmatched: string[];
}

let pending: PendingReview | null = null;

export const setPendingReview = (review: PendingReview): void => {
  pending = review;
};

export const getPendingReview = (): PendingReview | null => pending;

export const clearPendingReview = (): void => {
  pending = null;
};
