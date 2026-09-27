/**
 * Splits what the user typed into "updates to loops I already have" and "new things to
 * capture". Pure and deterministic.
 *
 * The hard rule (04/05 acceptance scenarios 8–9, 02 engine doc → "Natural-language status
 * updates"): NEVER change a loop we are not sure about.
 *   - one loop clearly fits         → propose it (the user still confirms)
 *   - several fit about equally     → the user chooses
 *   - the words name nothing at all → the user chooses from what could apply
 *   - the words name something that matches NO open loop → change nothing, say so
 */
import { reviewForMilestone } from '@/engine/followUpPolicy';
import type { Loop } from '@/engine/types';
import { extractTime, type TimeSpec } from '@/parser/datetime';
import { detectLanguage, normalizeInput, splitClauses, splitSentences } from '@/parser/text';
import { fold } from '@/utils/fold';
import { dateOrderForLocale } from '@/utils/locale';
import { atTime } from '@/utils/time';

import { detectIntent, type DetectedIntent } from './intent';
import { MIN_RELEVANT, rankLoops, targetWords } from './match';
import type { MatchConfidence, RescheduleWhen, UpdateInterpretation, UpdateProposal } from './types';

/** Two candidates closer than this are "about equally good". */
const CLEAR_MARGIN = 1.5;

type Verdict = { kind: 'proposal'; proposal: UpdateProposal } | { kind: 'unmatched' } | { kind: 'capture' };

function whenFrom(spec: TimeSpec | null): RescheduleWhen | null {
  return spec ? { at: spec.at, hasTime: spec.hasTime, milestone: spec.milestone, label: spec.label } : null;
}

function decide(
  intent: DetectedIntent,
  said: string,
  folded: string,
  spec: TimeSpec | null,
  loops: readonly Loop[],
  id: string,
): Verdict {
  const words = targetWords(folded, spec?.spans);
  const ranked = rankLoops(intent, words, loops);
  // What to do with a clause that names something we cannot find: an ordinary sentence ("Push the
  // deploy…", "still no reply from Nike") may just be a NEW thing, so weak cues fall through to capture.
  const nothingFits: Verdict = intent.weak || intent.intent === 'still_waiting' ? { kind: 'capture' } : { kind: 'unmatched' };

  if (ranked.length === 0) return nothingFits;

  let confidence: MatchConfidence;
  if (words.length > 0) {
    const relevant = ranked.filter((r) => r.score >= MIN_RELEVANT);
    if (relevant.length === 0) return nothingFits;
    const [top, second] = relevant;
    confidence = !second || top.score - second.score >= CLEAR_MARGIN ? 'high' : 'ambiguous';
  } else {
    // Nothing in the words points at a loop. Only when there is exactly one thing it COULD be do we propose it.
    confidence = ranked.length === 1 ? 'high' : 'low';
  }

  return {
    kind: 'proposal',
    proposal: {
      id,
      said,
      intent: intent.intent,
      confidence,
      candidates: ranked,
      when: intent.intent === 'reschedule' ? whenFrom(spec) : null,
    },
  };
}

export interface InterpretOptions {
  /** Device locale — decides how "12/10" reads. */
  locale?: string;
}

export function interpretInput(
  text: string,
  loops: readonly Loop[],
  now: Date,
  options: InterpretOptions = {},
): UpdateInterpretation {
  const orig = normalizeInput(text);
  const folded = fold(orig);
  const docLang = detectLanguage(orig, folded);
  const localeOrder = dateOrderForLocale(options.locale) ?? 'mdy';

  const proposals: UpdateProposal[] = [];
  const unmatched: string[] = [];
  const kept: string[] = [];

  for (const sentence of splitSentences(orig)) {
    const keptClauses: string[] = [];
    for (const clause of splitClauses(folded, sentence)) {
      const said = orig.slice(clause.start, clause.end);
      const f = folded.slice(clause.start, clause.end);
      const lang = detectLanguage(said, f, docLang);
      const spec = extractTime(f, now, { dateOrder: lang === 'tr' ? 'dmy' : localeOrder });
      const intent = detectIntent(f, spec !== null);

      const verdict: Verdict = intent
        ? decide(intent, said, f, spec, loops, `u${proposals.length}`)
        : { kind: 'capture' };

      if (verdict.kind === 'proposal') proposals.push(verdict.proposal);
      else if (verdict.kind === 'unmatched') unmatched.push(said);
      else keptClauses.push(said);
    }
    if (keptClauses.length > 0) kept.push(keptClauses.join(', '));
  }

  return { proposals, unmatched, remainder: kept.join('. ') };
}

// ---- applying a proposal to a chosen loop -------------------------------------------------------------

/** The hour a rescheduled loop keeps when the user named only a day. */
const defaultHour = (loop: Loop): number => (loop.type === 'waiting' ? 11 : 9);

/**
 * The exact moment "move it to Friday" means for THIS loop: an explicit clock time wins; a day alone
 * keeps the loop's time of day; a milestone ("next month") uses its usual moment. Null if there is no
 * time to apply, or it is not in the future.
 */
export function rescheduleTarget(when: RescheduleWhen | null, loop: Loop, now: Date): Date | null {
  if (!when) return null;
  let at: Date | null = null;
  if (when.at && when.hasTime) at = when.at;
  else if (when.at) {
    const previous = loop.nextReviewAt ? new Date(loop.nextReviewAt) : null;
    at = atTime(when.at, previous ? previous.getHours() : defaultHour(loop), previous ? previous.getMinutes() : 0);
  } else if (when.milestone) at = reviewForMilestone(now, when.milestone);
  return at && at.getTime() > now.getTime() ? at : null;
}
