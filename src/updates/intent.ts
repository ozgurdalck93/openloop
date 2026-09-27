/**
 * What is this clause DOING to an existing loop? English and Turkish, over FOLDED text
 * (lowercase ASCII — "geldi", "yatmadı" → "yatmadi"). Rule-based and deterministic.
 *
 * Precedence: dismiss → reschedule → still-waiting → resolve. Negation matters: "the refund
 * hasn't arrived" is NOT "the refund arrived".
 */
import type { UpdateIntent } from './types';

export interface DetectedIntent {
  intent: UpdateIntent;
  /** The phrase that decided it (folded), for debugging and for stripping from the target words. */
  cue: string;
  /** Sounds like something arriving ("came", "geldi") — hints at a WAITING loop. */
  arrival: boolean;
  /** Sounds like the user finished something ("done", "yaptım") — hints at a TASK / PROMISE. */
  completion: boolean;
  /** "they sent it": hints at something awaited — a file, link, package. */
  sent: boolean;
  /**
   * A cue that could just as well be an ordinary task ("yarına al" = "take/buy it tomorrow").
   * With no matching loop the clause is left for the capture parser instead of reported as unmatched.
   */
  weak: boolean;
}

const first = (patterns: RegExp[], text: string): string | null => {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
};

const DISMISS: RegExp[] = [
  /\bnot relevant(?: anymore| any more)?\b/,
  /\bno longer (?:relevant|needed|important)\b/,
  /\bforget (?:it|about (?:it|this|that))\b/,
  /\bnever ?mind\b/,
  /\bcancel (?:it|that|this)\b/,
  /\bdrop (?:it|this|that)\b/,
  /\bdon'?t need (?:it|this|that)(?: anymore)?\b/,
  /\bartik (?:gerek|lazim|ilgi)\w*/,
  /\bgerek kalmadi\b/,
  /\bvazgectim\b/,
  /\biptal\b/,
  /\bartik\b.*\bkapat\b/,
  /\bkapat\b.*\bartik\b/,
  /\bilgisiz\b/,
];

const MOVE_EN = /\b(?:move|push|shift|reschedule|postpone|delay|bump|put off)\b/;
const RESCHEDULE_STRONG: RegExp[] = [
  MOVE_EN,
  /\binstead\b/,
  /\bmake it\b/,
  /\b(?:ertele\w*|kaydir\w*|tasi\w*|yerine)\b/,
];
/** "cumaya al" = "take it to Friday": only a reschedule when a dative-marked time precedes it. */
const RESCHEDULE_WEAK = /\b\w+(?:ya|ye)\s+(?:al|cek)\b|\b(?:haftaya|yarina|aya|pazartesiye|saliya)\s+(?:al|cek)\b/;

const STILL_WAITING: RegExp[] = [
  /\bstill (?:no|nothing|waiting|haven'?t|hasn'?t|not)\b/,
  /\bno (?:reply|response|answer|news|word|call|email|refund|update)(?: yet)?\b/,
  /\bnothing (?:yet|back|from)\b/,
  /\bnot (?:yet|here yet|back yet)\b/,
  /\b(?:hasn'?t|haven'?t|hadn'?t) \w+ yet\b/,
  /\b(?:hala|henuz)\b/,
  /\b(?:cevap|haber|donus|yanit) yok\b/,
];

const NEGATION = /\b(?:not|no|never|yet|without|hasn'?t|haven'?t|hadn'?t|didn'?t|wasn'?t|isn'?t|won'?t|gelmedi|gelmiyor|yatmadi|yatmiyor|ulasmadi|donmedi|vermedi|yok|henuz|hala|degil)\b|n't\b/;

const ARRIVAL: RegExp[] = [
  /\b(?:came|arrived|showed up|landed|cleared|went through|is here|are here|got here)\b/,
  // Any subject but "I" — "I sent/emailed X" is the user's own outgoing action, not something
  // coming back to them, so it is deliberately excluded here.
  /\b(?!i\b)[a-z]+ (?:has |have |had |finally |just |already )*(?:sent|replied|responded|answered|called|paid|refunded|delivered|confirmed|approved|emailed|wrote|got back|came back)\b/,
  /\b(?:got|received|have|has) (?:the |my |a |an |their )?(?:reply|response|answer|refund|money|payment|package|parcel|file|documents?|link|email|call|result|confirmation|approval|invoice|order)\b/,
  /\b(?:geldi|geldiler|gelmis|yatti|yatmis|ulasti|ulasmis|ulastilar|geri dondu|geri donduler)\b/,
  /\b(?:donus yapti|donus yaptilar|cevap verdi|cevap verdiler|gonderdi|gonderdiler|aradi|aradilar|onayladi|onayladilar|odedi|odediler|iade etti|iade ettiler)\b/,
];
const COMPLETION: RegExp[] = [
  /\b(?:done|finished|completed|handled|sorted|taken care of)\b/,
  /\bi (?:did|finished|completed|handled) (?:it|this|that)\b/,
  /\b(?:bitti|yaptim|hallettim|tamamladim|tamamlandi|halloldu|halledildi)\b/,
];
const CLOSE: RegExp[] = [/\bclose (?:it|this|that)\b/, /\bkapat\b/];

const SENT_HINT = /\b(?:sent|gonderdi|gonderdiler)\b/;

/** `hasTime` = the clause also named a date/time (a reschedule needs one). */
export function detectIntent(folded: string, hasTime: boolean): DetectedIntent | null {
  const make = (intent: UpdateIntent, cue: string, weak = false): DetectedIntent => ({
    intent,
    cue,
    arrival: ARRIVAL.some((re) => re.test(folded)),
    completion: COMPLETION.some((re) => re.test(folded)),
    sent: SENT_HINT.test(folded),
    weak,
  });

  let cue: string | null;
  if ((cue = first(DISMISS, folded))) return make('dismiss', cue);

  if (hasTime) {
    if ((cue = first(RESCHEDULE_STRONG, folded))) return make('reschedule', cue);
    if ((cue = RESCHEDULE_WEAK.exec(folded)?.[0] ?? null)) return make('reschedule', cue, true);
  }

  if ((cue = first(STILL_WAITING, folded))) return make('still_waiting', cue);

  if (!NEGATION.test(folded)) {
    if ((cue = first(ARRIVAL, folded))) return make('resolve', cue);
    if ((cue = first(COMPLETION, folded))) return make('resolve', cue);
    if ((cue = first(CLOSE, folded))) return make('resolve', cue);
  }
  return null;
}
