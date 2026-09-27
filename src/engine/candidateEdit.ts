/**
 * Editing a candidate on the Review screen — every rule lives here, not in the UI.
 *
 * Each function returns a NEW candidate. A user's edit always wins: it sets the
 * matching confidence to "certain" and clears the parser's doubts, so the
 * "Not sure about…" hints disappear the moment the user has looked at a field.
 */
import type { LoopCandidate } from '@/parser/types';
import { fold } from '@/utils/fold';

import {
  classifyWaitingKind,
  defaultWaitingReview,
  suggestPromiseReview,
  suggestReturnLaterReview,
  suggestTaskReview,
  type ReviewSuggestion,
  type TimingInput,
} from './followUpPolicy';
import { DEFAULT_CLOSING, needsReviewTime, ownerFor, statedPolicy } from './typeRules';
import { MILESTONE_LABEL, type LoopType } from './types';

/** The parts of a candidate a user can change, and can therefore be "unsure" about. */
export type CandidateField = 'title' | 'type' | 'entity' | 'when' | 'context';

/** Below this the parser is guessing, and the UI says so. */
export const UNSURE_BELOW = 0.6;
/**
 * A person or company is only worth flagging when the source is genuinely doubtful.
 * The local parser rates a role like "the dentist" at 0.5 — that is a fair reading, not
 * a doubt — so the bar is lower than for types and times.
 */
export const UNSURE_NAME_BELOW = 0.4;
export const MAX_TITLE_LENGTH = 120;
export const MAX_CONTEXT_LENGTH = 2000;

const NO_TIMING: TimingInput = { at: null, hasTime: false, milestone: null };

/**
 * What a text field may hold WHILE the user is still typing: leading spaces and doubled
 * spaces are dropped, but a trailing space stays — otherwise "Dr. Yilmaz" could never be
 * typed, because the space after "Dr." would vanish the moment it was entered. The final
 * trim happens once, when the loop is kept (`confirmCandidates`).
 */
const tidyWhileTyping = (value: string): string => value.replace(/\s+/g, ' ').replace(/^\s+/, '');

export function editTitle(candidate: LoopCandidate, title: string): LoopCandidate {
  // Not trimmed to null: a blank title is a validation error the user must see, not something to hide.
  return { ...candidate, title: tidyWhileTyping(title) };
}

export function editEntity(candidate: LoopCandidate, value: string): LoopCandidate {
  const typed = tidyWhileTyping(value);
  const entityName = typed.trim() === '' ? null : typed;
  return { ...candidate, entityName, entityConfidence: entityName ? 1 : 0 };
}

export function editContext(candidate: LoopCandidate, value: string): LoopCandidate {
  const trimmed = value.trim();
  return { ...candidate, rawContext: trimmed === '' ? null : value };
}

/** The user chose a review time (or, with null, removed it). */
export function editWhen(candidate: LoopCandidate, when: Date | null): LoopCandidate {
  if (when === null) {
    return { ...candidate, nextReviewAt: null, timingSource: 'none', timingLabel: null, timingConfidence: 0 };
  }
  return {
    ...candidate,
    nextReviewAt: when.toISOString(),
    timingSource: 'stated',
    timingLabel: null,
    timingConfidence: 1,
    followUpPolicy: statedPolicy(candidate.type),
  };
}

function defaultReviewFor(candidate: LoopCandidate, type: LoopType, now: Date): ReviewSuggestion | null {
  switch (type) {
    case 'task':
      return suggestTaskReview(now, NO_TIMING);
    case 'promise':
      return suggestPromiseReview(now, NO_TIMING);
    case 'return_later':
      return suggestReturnLaterReview(now, NO_TIMING);
    case 'waiting':
      return defaultWaitingReview(
        now,
        classifyWaitingKind({ foldedText: fold(`${candidate.title} ${candidate.rawContext ?? ''}`), entity: candidate.entityName }),
      );
    case 'event':
    case 'reference':
      return null; // an event needs a real date from the user; a reference needs none
  }
}

/**
 * Changes a candidate's type. Owner follows the type; a type with no review time yet
 * gets that type's default suggestion; a reference loses its time (it never notifies).
 */
export function retypeCandidate(candidate: LoopCandidate, type: LoopType, now: Date): LoopCandidate {
  const next: LoopCandidate = {
    ...candidate,
    type,
    nextActionOwner: ownerFor(type),
    // The user has told us what this is.
    classificationConfidence: 1,
    needsUserConfirmation: false,
    confirmationQuestion: null,
  };

  // Swap the closing condition only if it was the previous type's stock wording — a specific
  // one from the parser ("link sent", "Refund received") is worth keeping.
  if (candidate.closingCondition === null || candidate.closingCondition === DEFAULT_CLOSING[candidate.type]) {
    next.closingCondition = DEFAULT_CLOSING[type];
  }

  if (!needsReviewTime(type)) {
    return { ...next, nextReviewAt: null, followUpPolicy: 'none', timingSource: 'none', timingLabel: null, timingConfidence: 0 };
  }
  if (next.nextReviewAt === null) {
    const suggestion = defaultReviewFor(candidate, type, now);
    if (suggestion?.at) {
      return {
        ...next,
        nextReviewAt: suggestion.at.toISOString(),
        followUpPolicy: suggestion.policy,
        timingSource: 'suggested',
        timingLabel: null,
        timingConfidence: suggestion.confidence,
      };
    }
  }
  return next;
}

// ---- validation ------------------------------------------------------------------------------

export type IssueCode = 'title_required' | 'title_too_long' | 'context_too_long' | 'when_required' | 'when_passed';

export interface Issue {
  field: CandidateField;
  code: IssueCode;
}

/**
 * Everything that must be fixed before this candidate can be kept. Pure and total:
 * `confirmCandidates` runs it again, so a stale or hand-built candidate cannot slip through.
 */
export function validateCandidate(candidate: LoopCandidate, now: Date): Issue[] {
  const issues: Issue[] = [];
  const title = candidate.title.trim();
  if (title === '') issues.push({ field: 'title', code: 'title_required' });
  else if (title.length > MAX_TITLE_LENGTH) issues.push({ field: 'title', code: 'title_too_long' });
  if ((candidate.rawContext?.length ?? 0) > MAX_CONTEXT_LENGTH) issues.push({ field: 'context', code: 'context_too_long' });

  if (needsReviewTime(candidate.type)) {
    if (candidate.nextReviewAt === null) issues.push({ field: 'when', code: 'when_required' });
    else if (new Date(candidate.nextReviewAt).getTime() <= now.getTime()) issues.push({ field: 'when', code: 'when_passed' });
  }
  return issues;
}

// ---- how sure are we? ----------------------------------------------------------------------------

/**
 * What to tell the user we are unsure about. Fields the user has already edited are
 * never flagged: they have looked at them.
 *
 *  type      — we may have picked the wrong kind of loop
 *  timing    — the review time is a low-confidence guess ("Not sure about the timing")
 *  name      — the person/company may be wrong
 *  payday    — the time came from "after payday", which we can only guess
 *  suggested — a reasonable default the user never stated (calm note, not a warning)
 */
export type Uncertainty = 'type' | 'timing' | 'name' | 'payday' | 'suggested';

export function uncertaintiesOf(candidate: LoopCandidate, edited: readonly CandidateField[]): Uncertainty[] {
  const out: Uncertainty[] = [];
  if (!edited.includes('type') && candidate.classificationConfidence < UNSURE_BELOW) out.push('type');

  const timingOpen = needsReviewTime(candidate.type) && !edited.includes('when');
  if (timingOpen && candidate.timingLabel === MILESTONE_LABEL.payday) {
    out.push('payday');
  } else if (timingOpen && candidate.timingConfidence < UNSURE_BELOW) {
    out.push('timing');
  } else if (timingOpen && candidate.timingSource === 'suggested' && candidate.nextReviewAt !== null) {
    out.push('suggested');
  }

  if (!edited.includes('entity') && candidate.entityName && candidate.entityConfidence < UNSURE_NAME_BELOW) out.push('name');
  return out;
}
