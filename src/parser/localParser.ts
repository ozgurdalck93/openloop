/**
 * Deterministic, dependency-free parser: messy English/Turkish text in, 1..N
 * loop candidates out. No network, no API key. It sits behind `LoopParser`, so
 * an AI-backed parser can replace or augment it later.
 *
 * Pipeline
 *   1. split into sentences, then clauses ("pieces"); over-splitting is fine
 *   2. analyse each piece: time expression, cue kind, how much real content
 *   3. merge pieces into "units" — one unit per loop (e.g. "I returned the
 *      package" + "the refund hasn't arrived" is ONE waiting loop)
 *   4. turn each unit into a candidate: title, owner, entity, review time,
 *      closing condition, confidences
 * Anything it cannot place ("Maybe Friday.") becomes a clarification — never a
 * made-up loop.
 */
import {
  classifyWaitingKind,
  suggestEventReview,
  suggestPromiseReview,
  suggestReturnLaterReview,
  suggestTaskReview,
  suggestWaitingReview,
  type ReviewSuggestion,
  type TaskHint,
  type TimingInput,
} from '@/engine/followUpPolicy';

import { dateOrderForLocale, type DateOrder } from '@/utils/locale';

import { classifyCue, isBareContinuation, type Cue, type CueKind } from './cues';
import { extractTime, type TimeSpec } from './datetime';
import { defaultAwaited, findAwaited, findEntity, impliedAwaited, type Awaited, type Entity } from './extract';
import {
  HEDGE_RE,
  contentWords,
  detectLanguage,
  fold,
  normalizeInput,
  splitClauses,
  splitSentences,
  type Lang,
  type Span,
} from './text';
import {
  eventTitle,
  promiseTitle,
  referenceTitle,
  returnLaterObject,
  returnLaterTitle,
  taskTitle,
  waitingTitle,
  type ClauseText,
} from './titles';
import type { Clarification, LoopCandidate, LoopParser, ParseOptions, ParseResult } from './types';

// ---- working types ---------------------------------------------------------------------

type PieceKind = CueKind | 'info' | 'fragment';
type UnitKind = CueKind | 'info';

interface Piece {
  span: Span;
  lang: Lang;
  kind: PieceKind;
  cue: Cue | null;
  time: TimeSpec | null;
  /** Meaningful words left after filler and time expressions are removed. */
  content: number;
  hedged: boolean;
  /** "still no reply" — restates a wait we already track instead of starting a new one. */
  continuation: boolean;
}

interface Unit {
  /** Everything this loop covers, attached context included. */
  span: Span;
  lang: Lang;
  kind: UnitKind;
  /** The piece whose cue decided the kind. */
  primary: Piece;
  pieces: Piece[];
  /** Where the title text ends: the primary piece plus trailing list items ("buy milk, eggs"). */
  titleEnd: number;
  /** Built from a stray fragment rather than a full statement — less sure. */
  fromFragment: boolean;
}

interface Source {
  orig: string;
  folded: string;
  now: Date;
  /** How to read "12/10" in text that is not written in Turkish (Turkish is always day-first). */
  dateOrder: DateOrder;
}

/** Cue kinds that a stray "tomorrow at 3" may be attached to. */
const TIMEABLE: ReadonlySet<UnitKind> = new Set(['task', 'wait', 'promise', 'return_later', 'event', 'past_action']);

const blank = (text: string, spans: Span[]): string => {
  const chars = text.split('');
  for (const s of spans) for (let i = s.start; i < s.end; i += 1) chars[i] = ' ';
  return chars.join('');
};

// An explicit calendar date (a month name or 12.10 / 12/10) — not a duration like "5 business days".
const EXPLICIT_DATE =
  /(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)|d{1,2}[./]d{1,2}/;

// ---- step 2: analyse a piece ------------------------------------------------------------

function analysePiece(src: Source, span: Span, lang: Lang): Piece {
  const folded = src.folded.slice(span.start, span.end);
  const time = extractTime(folded, src.now, { dateOrder: lang === 'tr' ? 'dmy' : src.dateOrder });
  const timeSpans = time?.spans ?? [];
  const content = contentWords(folded, timeSpans).length;
  let cue = classifyCue(folded, blank(folded, timeSpans), time !== null, lang);
  // A stated date with something to say about it and no other cue ("10 ekim küçük prens gösterisi") is an event.
  // Weak on purpose: the Review screen shows it and the user can change the type. A bare "Friday" stays a question.
  if (!cue && time && time.at !== null && time.milestone === null && content >= 2 && EXPLICIT_DATE.test(folded)) {
    cue = { kind: 'event', match: 'dated', strength: 0.5 };
  }
  const kind: PieceKind = cue ? cue.kind : content >= 3 ? 'info' : 'fragment';
  const continuation = cue?.kind === 'wait' && isBareContinuation(folded);
  return { span, lang, kind, cue, time, content, hedged: HEDGE_RE.test(folded), continuation };
}

// ---- step 3: merge pieces into units ------------------------------------------------------

const unitOf = (p: Piece): Unit => ({
  span: { ...p.span },
  lang: p.lang,
  kind: p.kind === 'fragment' ? 'info' : p.kind,
  primary: p,
  pieces: [p],
  titleEnd: p.span.end,
  fromFragment: p.kind === 'fragment',
});

function extend(unit: Unit, span: Span): void {
  unit.span = { start: Math.min(unit.span.start, span.start), end: Math.max(unit.span.end, span.end) };
}

/**
 * A stray fragment joins the loop it sits next to. A bare time just sets the time;
 * a fragment with real words after a task/promise is part of what it is about
 * ("buy milk, eggs, bread tomorrow"; "Ozan'a söz verdim, yarın göndereceğim").
 */
function attachFragment(unit: Unit, frag: Piece, trailing: boolean): void {
  unit.pieces.push(frag);
  extend(unit, frag.span);
  if (trailing && frag.content > 0 && (unit.kind === 'task' || unit.kind === 'promise')) {
    unit.titleEnd = Math.max(unit.titleEnd, frag.span.end);
  }
}

function mergeInto(unit: Unit, p: Piece): void {
  unit.pieces.push(p);
  extend(unit, p.span);
  const kinds = new Set<PieceKind>([unit.kind, p.kind]);
  if (kinds.has('past_action') && kinds.has('wait')) {
    // "I emailed HR" + "I'm waiting for a reply": one waiting loop, anchored on the waiting clause.
    unit.kind = 'wait';
    if (p.kind === 'wait') {
      unit.primary = p;
      unit.titleEnd = p.span.end;
    }
  }
}

const canMerge = (unit: Unit, p: Piece): boolean =>
  (unit.kind === 'past_action' && p.kind === 'wait') ||
  (unit.kind === 'wait' && p.kind === 'past_action') ||
  (unit.kind === 'info' && p.kind === 'info' && !unit.fromFragment);

/** Merges the pieces of one sentence. Fragments seen before any unit are returned as leftovers. */
function unitsForSentence(pieces: Piece[]): { units: Unit[]; leftovers: Piece[] } {
  const units: Unit[] = [];
  let pending: Piece[] = [];
  for (const p of pieces) {
    const last = units[units.length - 1];
    if (p.continuation && last && (last.kind === 'wait' || last.kind === 'past_action')) {
      attachFragment(last, p, false); // "…bekliyorum ama hala yok": the same wait, restated
    } else if (p.kind === 'info' && p.time && last?.kind === 'wait' && !unitTime(last)) {
      attachFragment(last, p, false); // "…hasn't arrived, the bank said 5 business days": says WHEN to expect it
    } else if (p.kind === 'fragment') {
      if (last) attachFragment(last, p, true);
      else pending.push(p);
    } else if (last && canMerge(last, p)) {
      mergeInto(last, p);
    } else {
      const unit = unitOf(p);
      for (const frag of pending) attachFragment(unit, frag, false);
      pending = [];
      units.push(unit);
    }
  }
  return { units, leftovers: pending };
}

/** The time that applies to a loop. A past action's date ("emailed on Monday") is history, not a plan. */
function unitTime(unit: Unit): { spec: TimeSpec; piece: Piece } | null {
  const usable = unit.pieces.filter((p) => p.time && p.kind !== 'past_action');
  const chosen = usable.find((p) => p === unit.primary) ?? usable[0];
  return chosen?.time ? { spec: chosen.time, piece: chosen } : null;
}

function clauseOf(src: Source, start: number, end: number, pieces: Piece[]): ClauseText {
  const timeSpans: Span[] = [];
  for (const p of pieces) {
    if (!p.time || p.span.start < start || p.span.end > end) continue;
    for (const s of p.time.spans) {
      timeSpans.push({ start: p.span.start + s.start - start, end: p.span.start + s.end - start });
    }
  }
  return { orig: src.orig.slice(start, end), folded: src.folded.slice(start, end), timeSpans };
}

const primaryClause = (src: Source, u: Unit): ClauseText => clauseOf(src, u.primary.span.start, u.titleEnd, u.pieces);

/**
 * Whatever the unit covers BEFORE its deciding clause: a leading fragment ("I like
 * this jacket, but I'll look again…") or an earlier sentence attached to it.
 */
function contextClause(src: Source, u: Unit): ClauseText | null {
  return u.span.start < u.primary.span.start ? clauseOf(src, u.span.start, u.primary.span.start, []) : null;
}

/** What a return-later loop is ABOUT ("brown jacket"), or null if nothing names it. */
const returnObject = (src: Source, u: Unit): string | null =>
  returnLaterObject(primaryClause(src, u), contextClause(src, u), u.lang);

// ---- step 4: candidates ----------------------------------------------------------------------

const T = {
  en: {
    doneClosing: 'You mark it done',
    returnClosing: 'You act on it, dismiss it, or move it',
    eventClosing: 'It happened and you have seen it',
    whenExpected: 'When do you expect this?',
    keepNote: 'Keep this as a note?',
    whatBringBack: 'What should I bring back?',
    waitingFor: (who: string | null) => `Are you waiting to hear back${who ? ` from ${who}` : ''}?`,
    refers: (t: string) => `What does ${t} refer to?`,
    plan: (t: string) => `What should I do about "${t}"?`,
  },
  tr: {
    doneClosing: 'Yaptığını işaretlersin',
    returnClosing: 'Harekete geçersin, vazgeçersin ya da ertelersin',
    eventClosing: 'Gerçekleşti ve gördün',
    whenExpected: 'Bunu ne zaman bekliyorsun?',
    keepNote: 'Bunu not olarak saklayayım mı?',
    whatBringBack: 'Neyi geri getireyim?',
    waitingFor: (who: string | null) => `${who ? `${who} ` : ''}bir dönüş mü bekliyorsun?`,
    refers: (t: string) => `${t} neyle ilgili?`,
    plan: (t: string) => `"${t}" için ne yapayım?`,
  },
} as const;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

function timingOf(unit: Unit, laterCue: boolean): { input: TimingInput; spec: TimeSpec | null } {
  const found = unitTime(unit);
  if (!found) {
    return { input: { at: null, hasTime: false, milestone: laterCue ? 'later' : null, label: null }, spec: null };
  }
  const { spec } = found;
  return { input: { at: spec.at, hasTime: spec.hasTime, milestone: spec.milestone, label: spec.label }, spec };
}

const HINT_CALL = /\b(?:call|phone|ring|ara|aramam)\b/;
const HINT_ERRAND = /\b(?:buy|pick up|shop|store|pharmacy|groceries|market|eczane|al\b)/;
const hintFor = (folded: string): TaskHint => (HINT_CALL.test(folded) ? 'call' : HINT_ERRAND.test(folded) ? 'errand' : 'generic');

const OWNS_THE_EVENT = /\b(?:appointment|meeting|exam|interview|flight|surgery|randevu|sinav|mulakat|ucus|toplanti|ameliyat)\w*/;

function candidateFrom(
  unit: Unit,
  src: Source,
  extra: {
    type: LoopCandidate['type'];
    title: string;
    owner: LoopCandidate['nextActionOwner'];
    entity: Entity | null;
    expectedEvent: string | null;
    closing: string | null;
    suggestion: ReviewSuggestion | null;
    spec: TimeSpec | null;
    classification: number;
    question?: string | null;
  },
): LoopCandidate {
  const { suggestion, spec } = extra;
  const hedged = unit.pieces.some((p) => p.hedged);
  let timing = suggestion ? suggestion.confidence : 0;
  if (spec?.adjusted) timing = Math.min(timing, 0.5); // we moved a passed time to the next slot
  if (spec && hedged) timing -= 0.2; // "maybe Friday"
  const classification = clamp01(extra.classification - (hedged ? 0.15 : 0) - (unit.fromFragment ? 0.2 : 0));
  const question = extra.question ?? null;
  const context = src.orig.slice(unit.span.start, unit.span.end).trim(); // includes any attached earlier sentence

  return {
    type: extra.type,
    title: extra.title,
    status: 'draft',
    rawContext: context || null,
    nextActionOwner: extra.owner,
    entityName: extra.entity?.name ?? null,
    expectedEvent: extra.expectedEvent,
    nextReviewAt: suggestion?.at ? suggestion.at.toISOString() : null,
    closingCondition: extra.closing,
    followUpPolicy: suggestion?.policy ?? 'none',
    timingSource: !suggestion?.at ? 'none' : spec?.at && !spec.adjusted ? 'stated' : 'suggested',
    classificationConfidence: classification,
    timingConfidence: clamp01(timing),
    entityConfidence: extra.entity?.confidence ?? 0,
    needsUserConfirmation: question !== null || classification < 0.6,
    confirmationQuestion: question,
    timingLabel: suggestion?.label ?? null,
  };
}

function buildCandidate(unit: Unit, src: Source): LoopCandidate {
  const { lang } = unit;
  const strings = T[lang];
  const whole = { orig: src.orig.slice(unit.span.start, unit.span.end), folded: src.folded.slice(unit.span.start, unit.span.end) };
  const cueStrength = unit.primary.cue?.strength ?? 0.5;
  const primary = primaryClause(src, unit);
  const laterCue = /\b(?:later|sonra)\b/.test(primary.folded) && unit.kind !== 'wait';
  const { input, spec } = timingOf(unit, laterCue);

  switch (unit.kind) {
    case 'task': {
      const entity = findEntity(whole.orig, whole.folded, lang);
      return candidateFrom(unit, src, {
        type: 'task',
        title: taskTitle(primary, lang),
        owner: 'user',
        entity,
        expectedEvent: null,
        closing: strings.doneClosing,
        suggestion: suggestTaskReview(src.now, input, hintFor(primary.folded)),
        spec,
        classification: cueStrength,
      });
    }

    case 'promise': {
      const entity = findEntity(whole.orig, whole.folded, lang);
      const { title, closing } = promiseTitle(primary, entity?.name ?? null, lang);
      return candidateFrom(unit, src, {
        type: 'promise',
        title,
        owner: 'user',
        entity,
        expectedEvent: null,
        closing,
        suggestion: suggestPromiseReview(src.now, input),
        spec,
        classification: cueStrength,
      });
    }

    case 'event': {
      const suggestion = suggestEventReview(src.now, input);
      const title = eventTitle(primary, lang);
      return candidateFrom(unit, src, {
        type: 'event',
        title,
        owner: OWNS_THE_EVENT.test(primary.folded) ? 'user' : 'system',
        entity: findEntity(whole.orig, whole.folded, lang),
        expectedEvent: title,
        closing: strings.eventClosing,
        suggestion,
        spec,
        classification: cueStrength,
        question: suggestion.at === null ? strings.whenExpected : null,
      });
    }

    case 'return_later': {
      const object = returnObject(src, unit);
      return candidateFrom(unit, src, {
        type: 'return_later',
        title: returnLaterTitle(object, lang),
        owner: 'user',
        entity: null,
        expectedEvent: null,
        closing: strings.returnClosing,
        suggestion: suggestReturnLaterReview(src.now, input),
        spec,
        classification: object ? cueStrength : Math.min(cueStrength, 0.5),
        question: object ? null : strings.whatBringBack,
      });
    }

    case 'wait':
    case 'past_action': {
      // Prefer the entity/awaited thing named in the waiting clause; fall back to the whole unit.
      const entity =
        findEntity(whole.orig, whole.folded, lang, { subjectFirst: unit.kind === 'wait' }) ?? null;
      const pastPiece = unit.pieces.find((p) => p.kind === 'past_action');
      const pastFolded = pastPiece ? src.folded.slice(pastPiece.span.start, pastPiece.span.end) : null;
      const impliedByPast = pastFolded ? impliedAwaited(pastFolded) : null;
      let awaited: Awaited =
        (unit.kind === 'wait' ? findAwaited(primary.folded) : null) ??
        impliedByPast ??
        findAwaited(whole.folded) ??
        defaultAwaited();
      // "I returned it, the money hasn't come" — the money IS the refund.
      if (awaited.key === 'payment' && impliedByPast?.key === 'refund') awaited = impliedByPast;
      const implied = unit.kind === 'past_action'; // "I emailed HR." — we assume they now wait
      const waitKind = classifyWaitingKind({ foldedText: whole.folded, entity: entity?.name ?? null });
      return candidateFrom(unit, src, {
        type: 'waiting',
        title: waitingTitle(entity?.name ?? null, awaited, lang),
        owner: 'other',
        entity,
        expectedEvent: lang === 'tr' ? awaited.trBare : awaited.en,
        closing: lang === 'tr' ? awaited.closeTr : awaited.closeEn,
        suggestion: suggestWaitingReview(src.now, input, waitKind),
        spec,
        classification: implied ? 0.55 : cueStrength,
        question: implied ? strings.waitingFor(entity?.name ?? null) : null,
      });
    }

    case 'info': {
      const text = whole.orig.replace(/\s+/g, ' ').trim();
      return candidateFrom(unit, src, {
        type: 'reference',
        title: referenceTitle(text, lang),
        owner: 'none',
        entity: findEntity(whole.orig, whole.folded, lang),
        expectedEvent: null,
        closing: null,
        suggestion: null,
        spec: null,
        classification: unit.fromFragment ? 0.45 : 0.6,
        question: unit.fromFragment ? strings.keepNote : null,
      });
    }
  }
}

// ---- entry point -------------------------------------------------------------------------------

/** Does this return-later unit still need its object from an earlier sentence? */
const needsObject = (unit: Unit, src: Source): boolean => unit.kind === 'return_later' && returnObject(src, unit) === null;

const sameEntity = (a: Entity | null, b: Entity | null): boolean =>
  a === null || b === null || a.name.toLowerCase() === b.name.toLowerCase();

const entityOf = (unit: Unit, src: Source): Entity | null =>
  findEntity(src.orig.slice(unit.span.start, unit.span.end), src.folded.slice(unit.span.start, unit.span.end), unit.lang);

/** Parses `rawText` into candidates plus anything it declined to guess about. Pure and synchronous. */
export function parseText(rawText: string, now: Date, options: ParseOptions = {}): ParseResult {
  const orig = normalizeInput(rawText);
  const folded = fold(orig);
  const src: Source = { orig, folded, now, dateOrder: dateOrderForLocale(options.locale) ?? 'mdy' };
  const docLang = detectLanguage(orig, folded);

  const units: Unit[] = [];
  const clarifications: Clarification[] = [];

  for (const sentence of splitSentences(orig)) {
    const lang = detectLanguage(orig.slice(sentence.start, sentence.end), folded.slice(sentence.start, sentence.end), docLang);
    const pieces = splitClauses(folded, sentence).map((span) => analysePiece(src, span, lang));
    const { units: sentenceUnits, leftovers } = unitsForSentence(pieces);

    if (sentenceUnits.length === 0 && leftovers.length > 0) {
      placeLeftovers(leftovers, src, units, clarifications, lang);
      continue;
    }

    for (const unit of sentenceUnits) {
      const prev = units[units.length - 1];
      if (
        prev &&
        (prev.kind === 'wait' || prev.kind === 'past_action') &&
        unit.kind === 'wait' &&
        unit.pieces.length === 1 &&
        unit.primary.continuation
      ) {
        // "Waiting for Ali. Still no reply." — the second sentence adds nothing new.
        prev.pieces.push(...unit.pieces);
        extend(prev, unit.span);
        if (prev.kind === 'past_action') {
          prev.kind = 'wait';
          prev.primary = unit.primary;
          prev.titleEnd = unit.titleEnd;
        }
      } else if (prev && prev.kind === 'past_action' && unit.kind === 'wait' && sameEntity(entityOf(prev, src), entityOf(unit, src))) {
        // "I emailed HR yesterday." / "Still waiting for a reply." — the same loop, said in two sentences.
        prev.pieces.push(...unit.pieces);
        extend(prev, unit.span);
        prev.kind = 'wait';
        prev.primary = unit.primary;
        prev.titleEnd = unit.titleEnd;
      } else if (prev && prev.kind === 'info' && needsObject(unit, src)) {
        // "I like the brown jacket but M fits better. Bring this back after payday." — the earlier
        // sentence is this loop's context, not a separate note.
        unit.pieces.unshift(...prev.pieces);
        extend(unit, prev.span);
        units[units.length - 1] = unit;
      } else {
        units.push(unit);
      }
    }
  }

  return { candidates: units.map((u) => buildCandidate(u, src)), clarifications };
}

/** Fragments that could not join a loop in their own sentence: attach a bare time to the previous loop, or ask. */
function placeLeftovers(
  leftovers: Piece[],
  src: Source,
  units: Unit[],
  clarifications: Clarification[],
  lang: Lang,
): void {
  const time = leftovers.find((p) => p.time)?.time ?? null;
  const content = leftovers.reduce((n, p) => n + p.content, 0);
  const text = leftovers.map((p) => src.orig.slice(p.span.start, p.span.end)).join(', ');
  const strings = T[lang];

  if (time && content === 0) {
    const prev = units[units.length - 1];
    if (prev && TIMEABLE.has(prev.kind) && !unitTime(prev)) {
      for (const frag of leftovers) attachFragment(prev, frag, false);
      return;
    }
    const first = leftovers.find((p) => p.time) as Piece;
    const said = time.spans.map((s) => src.orig.slice(first.span.start + s.start, first.span.start + s.end)).join(' ').trim();
    clarifications.push({ text, question: strings.refers(said || text) });
    return;
  }
  if (content === 0) return; // "ok", "thanks" — nothing to keep

  if (time) {
    clarifications.push({ text, question: strings.plan(text) });
    return;
  }
  const unit = unitOf(leftovers[0]);
  for (const frag of leftovers.slice(1)) attachFragment(unit, frag, false);
  unit.kind = 'info';
  unit.fromFragment = true;
  units.push(unit);
}

export class LocalLoopParser implements LoopParser {
  private readonly options: ParseOptions;

  constructor(options: ParseOptions = {}) {
    this.options = options;
  }

  async parse(text: string, now: Date): Promise<LoopCandidate[]> {
    return parseText(text, now, this.options).candidates;
  }

  /** Like `parse`, but also returns what the parser declined to guess (see `Clarification`). */
  async analyze(text: string, now: Date): Promise<ParseResult> {
    return parseText(text, now, this.options);
  }
}
