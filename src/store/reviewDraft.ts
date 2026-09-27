/**
 * The state of the Review screen, as a pure reducer. The screen only dispatches
 * actions and renders; every rule (what changing a type does to the time, what
 * counts as valid) lives in `engine/candidateEdit`.
 */
import {
  editContext,
  editEntity,
  editTitle,
  editWhen,
  retypeCandidate,
  validateCandidate,
  type CandidateField,
  type Issue,
} from '@/engine/candidateEdit';
import type { LoopType } from '@/engine/types';
import type { LoopCandidate } from '@/parser/types';

export interface DraftItem {
  /** Stable across edits and removals, so lists and error messages keep pointing at the same card. */
  key: string;
  candidate: LoopCandidate;
  /** Fields the user has touched: the parser's doubts about them are dropped. */
  edited: CandidateField[];
}

export interface ReviewDraft {
  items: DraftItem[];
}

export type DraftAction =
  | { type: 'title'; key: string; value: string }
  | { type: 'entity'; key: string; value: string }
  | { type: 'context'; key: string; value: string }
  | { type: 'when'; key: string; when: Date | null }
  | { type: 'retype'; key: string; to: LoopType; now: Date }
  | { type: 'remove'; key: string };

export function initDraft(candidates: readonly LoopCandidate[]): ReviewDraft {
  return { items: candidates.map((candidate, index) => ({ key: `c${index}`, candidate, edited: [] })) };
}

const touch = (item: DraftItem, field: CandidateField, candidate: LoopCandidate): DraftItem => ({
  ...item,
  candidate,
  edited: item.edited.includes(field) ? item.edited : [...item.edited, field],
});

export function draftReducer(state: ReviewDraft, action: DraftAction): ReviewDraft {
  if (action.type === 'remove') return { items: state.items.filter((i) => i.key !== action.key) };
  return {
    items: state.items.map((item) => {
      if (item.key !== action.key) return item;
      switch (action.type) {
        case 'title':
          return touch(item, 'title', editTitle(item.candidate, action.value));
        case 'entity':
          return touch(item, 'entity', editEntity(item.candidate, action.value));
        case 'context':
          return touch(item, 'context', editContext(item.candidate, action.value));
        case 'when':
          return touch(item, 'when', editWhen(item.candidate, action.when));
        case 'retype': {
          // A new type invalidates the parser's timing doubts only if the user also sets the time;
          // retyping alone marks just the type as reviewed.
          const retyped = retypeCandidate(item.candidate, action.to, action.now);
          return touch(item, 'type', retyped);
        }
      }
    }),
  };
}

export const draftCandidates = (state: ReviewDraft): LoopCandidate[] => state.items.map((i) => i.candidate);

/** Issues per card key (cards with none are absent). Empty object = everything can be kept. */
export function validateDraft(state: ReviewDraft, now: Date): Record<string, Issue[]> {
  const out: Record<string, Issue[]> = {};
  for (const item of state.items) {
    const issues = validateCandidate(item.candidate, now);
    if (issues.length > 0) out[item.key] = issues;
  }
  return out;
}
