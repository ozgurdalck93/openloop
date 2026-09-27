/**
 * Per-type facts that several engine modules share. Kept in one tiny module so
 * `transitions` and `candidateEdit` can both use them without importing each other.
 */
import type { LoopStatus, LoopType, NextActionOwner } from './types';

/** Who owns the next move, by type. */
export function ownerFor(type: LoopType): NextActionOwner {
  switch (type) {
    case 'task':
    case 'promise':
    case 'return_later':
      return 'user';
    case 'waiting':
      return 'other';
    case 'event':
      return 'system';
    case 'reference':
      return 'none';
  }
}

/** The status a loop of this type has while it is simply "in play". */
export function initialStatusFor(type: LoopType): LoopStatus {
  switch (type) {
    case 'task':
    case 'promise':
    case 'reference':
      return 'active';
    case 'waiting':
      return 'waiting';
    case 'event':
    case 'return_later':
      return 'scheduled';
  }
}

/** The follow-up policy that goes with a time the USER stated (see followUpPolicy.ts). */
export function statedPolicy(type: LoopType): string {
  switch (type) {
    case 'waiting':
      return 'expected_date';
    case 'event':
      return 'at_event';
    case 'promise':
      return 'before_due';
    default:
      return 'exact_time';
  }
}

/** Only references are allowed to have no review time: everything else has to be able to resurface. */
export const needsReviewTime = (type: LoopType): boolean => type !== 'reference';

/** What "closed" means for each type (02_OPENLOOP_AUTOMATION_ENGINE.md → "Closing conditions"). */
export const DEFAULT_CLOSING: Record<LoopType, string | null> = {
  task: 'You mark it done',
  waiting: 'Reply received',
  event: 'It happened and you have seen it',
  promise: 'Promise kept',
  return_later: 'You act on it, dismiss it, or move it',
  reference: null,
};
