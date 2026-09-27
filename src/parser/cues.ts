/**
 * The cue lexicon: which words and phrases signal which kind of loop, in
 * English and Turkish. Everything runs on FOLDED text (lowercase ASCII, so
 * "yarın" is "yarin", "öğleden sonra" is "ogleden sonra"), and apostrophes are
 * optional ("hasn't" / "hasnt").
 *
 * Adding a phrase = adding a pattern to the right list. Priority between kinds
 * lives in `classifyCue`.
 */

import type { Lang } from './text';

export type CueKind = 'promise' | 'wait' | 'return_later' | 'event' | 'task' | 'past_action';

export interface Cue {
  kind: CueKind;
  /** The cue text that triggered it (folded) — for debugging and for stripping from titles. */
  match: string;
  /** How sure we are from this cue alone: explicit phrase > imperative > implied. */
  strength: number;
}

// ---- PROMISE: the user committed something to somebody ----------------------------
const PROMISE: RegExp[] = [
  /\bi(?:'ve| have)?\s+(?:just |already )?promised\b/,
  /\bi (?:told|assured|texted|messaged|emailed|wrote to|said to|swore to)\s+[a-z']+(?:\s+that)?\s+i(?:'d|'ll| would| will| am going to|'m going to| was going to| shall)\b/,
  /\bi said i(?:'d|'ll| would| will)\b/,
  /\bi owe (?:you |him |her |them |[a-z']+ )?(?:a |an |the )?\w+/,
  /\bsoz ver(?:dim|mistim)\b/,
  /\b\w+(?:ecegimi|acagimi|ecegim|acagim)\b.*\b(?:soyledim|dedim|soz verdim)\b/,
  /\b\w+(?:ecegimi|acagimi)\s+soyledim\b/,
];

// ---- WAIT: the next move belongs to someone/something else --------------------------
const WAIT: RegExp[] = [
  /\bwaiting (?:for|on)\b/,
  /\bawaiting\b/,
  /\bexpecting (?:a |an |the |their |his |her )?(?:reply|response|answer|call|email|message|refund|payment|package|parcel|delivery|result|news)/,
  /\b(?:haven'?t|hasn'?t|have not|has not) (?:yet )?(?:heard|received|gotten|got)\b/,
  /\bno (?:reply|response|answer|word|news)\b/,
  /\bstill (?:no |waiting|pending|nothing)/,
  /\b(?:haven'?t|hasn'?t|have not|has not|didn'?t|did not|not) (?:yet )?(?:arrived?|come|came|replied|responded|answered|shown up|sent|paid|refunded|delivered|got back|gotten back|called|written|been (?:paid|sent|refunded|delivered|processed|approved))\b/,
  /\bgets? back to me\b/,
  /\bwrite back\b/,
  /\bhear back\b/,
  /\bhear from\b/,
  /\b(?:said|says|told me|promised me|promises)\s+(?:that\s+)?(?:they|he|she|it|we)?\s*(?:'ll|'d|will|would|is going to|are going to|gonna|should)\b/,
  /\b(?:they|he|she)(?:'ll|'d| will| would| should) (?:reply|respond|answer|get back|call|email|send|write|let me know|confirm|approve|pay|refund|review|check|update)\b/,
  /\bpending\b/,
  // Turkish
  /\bbekl[ei]\w*/,
  /\bgeri don\w*/,
  /\bdonus (?:yapacak|bekle\w*|yok|gelmedi)\b/,
  /\b(?:cevap|yanit|haber|donus|sonuc) (?:vermedi|gelmedi|yok|alamadim)\b/,
  /\b(?:gonder|yolla|ilet|ara|yaz|ode|yatir|onayla|bildir|cevapla|don)(?:ecek|acak)(?:ler|lar)?\b/,
  /\bhaber verecek\b|\bcevap verecek\b/,
  /\b(?:dedi|soyledi|soz verdi)\b.*\b\w+(?:ecek|acak)\b/,
  /\b(?:yatmadi|yatmamis|yatirmadi)\b/,
  /\b(?:gelmedi|gelmemis|ulasmadi|ulasmamis|gonderilmedi|onaylanmadi|cevaplanmadi|yanitlanmadi|donmedi|aramadi|yazmadi|vermedi|odemedi)\b/,
  /\b(?:hala|henuz) (?:gelmedi|yok|cevap|yatmadi|donmedi|haber|ulasmadi)\b/,
];

// ---- RETURN_LATER: nothing to do now; bring it back at a better time ------------------
const RETURN_STRONG: RegExp[] = [
  /\blook(?:ing)?\b[^.]{0,40}\bagain\b/,
  /\b(?:take|have) another look\b/,
  /\breconsider\b/,
  /\brevisit\b/,
  /\bcome back to (?:this|it|that|them)\b/,
  /\bbring (?:this|it|that|them|these|the \w+) back (?:to me |for me )?(?:after|later|when|next|around|in (?:a|an|\d+|one|two|three)|at the end)\b/,
  /\bthink about (?:it|this|that|them)\b/,
  /\bthink about\b[^.]{0,50}\b(?:later|after|when|next|again|soon)\b/,
  /\b(?:i'll|i will|i'd|let'?s|gonna) (?:wait|hold off)\b/,
  /\bhold off (?:until|till|on)\b/,
  /\bdecide later\b/,
  /\bcircle back\b/,
  /\bsleep on it\b/,
  // Turkish
  /\bsonra bak\w*/,
  /\bsonra dusun\w*/,
  /\bdusunurum\b/,
  /\b(?:tekrar|yeniden|bir daha) (?:bak|goz at|degerlendir|dusun)\w*/,
  /\bbir ara bak\w*/,
];
const RETURN_WEAK: RegExp[] = [/\bremind me\b/, /\bbring (?:it|this|that) back\b/, /\bsonra hatirlat\w*/, /\bhatirlat\w* sonra\b/];

// ---- EVENT: something should happen at a known/estimated time ---------------------------
const EVENT_STRONG: RegExp[] = [
  /\b(?:results?|scores?|grades?|decision|verdict|outcome|announcement)\b[^.]{0,40}\b(?:come|comes|coming|is|are|will be|should be|due|expected|available|out|released|published|announced|ready|drops?)\b/,
  /\b(?:comes?|coming|goes?|drops?) out\b/,
  /\bwill be (?:announced|released|published|ready|available|posted)\b/,
  /\bshould be (?:available|out|ready|announced|posted)\b/,
  /\b(?:should|will|is going to|is due to|is expected to|expected to)\s+(?:arrive|be delivered|be shipped|ship|get here)\b/,
  /\bi have (?:an? )?(?:appointment|exam|interview|flight|meeting)\b/,
  /\bmy (?:appointment|exam|interview|flight|meeting|surgery) (?:is|are)\b/,
  // Turkish
  /\bsonuc\w*\b[^.]{0,40}\b(?:aciklan\w*|cikacak|cikiyor|cikar|belli ol\w*|yayinlan\w*|yayimlan\w*|gelecek|gelir)\b/,
  /\b(?:aciklanacak|aciklaniyor|yayinlanacak|yayimlanacak|belli olacak)\b/,
  /\b(?:kargo|paket|siparis)\w*\b[^.]{0,30}\b(?:gelecek|ulasacak|teslim edilecek|gelir|ulasir)\b/,
  /\brandevum(?:u)?\b/,
];

/**
 * A bare "still nothing" said after something we already track. It adds no new
 * loop: it is the same wait, restated ("Mert'ten haber bekliyorum ama hala yok").
 */
const BARE_CONTINUATION =
  /^(?:(?:and|but|ama|ve)\s+)?(?:still |hala |henuz |yet |not )?(?:no (?:reply|response|answer|news|word)(?: yet)?|nothing(?: yet)?|not yet|yok|yet|gelmedi|yatmadi|donmedi)$/;

export const isBareContinuation = (folded: string): boolean =>
  BARE_CONTINUATION.test(folded.trim().replace(/[.!?,]+$/, ''));
/** Weaker: an event noun only counts when a time expression sits next to it. */
const EVENT_NOUN: RegExp[] = [
  /\b(?:exam|flight|interview|appointment|meeting|surgery|check-?up|concert|match|wedding|launch|release)\b/,
  /\b(?:sinav|ucus|mulakat|randevu|toplanti|ameliyat|konser|dugun|lansman)\w*\b/,
];

// ---- TASK: the user needs to do something ------------------------------------------------
const TASK: RegExp[] = [
  /\bremind me\b[^.]*\b(?:to|about|of)\b/,
  /\b(?:i|we) (?:need|have|got|ought) to\b/,
  /\b(?:i|we)(?:'ve| have) got to\b/,
  /\b(?:i|we) (?:must|should|gotta|better)\b/,
  /\b(?:need|have|got) to\b/,
  /\bdon'?t forget\b/,
  /\bdo not forget\b/,
  /\bmake sure (?:i|to)\b/,
  /\bto-?do\b/,
  // Turkish
  /\bhatirlat\w*/,
  /\blazim\b/,
  /\bgerek(?:iyor|li)?\b/,
  /\bunutma\w*/,
  /\b\w+(?:mali|meli)y(?:im|iz)\b/,
];

// ---- PAST_ACTION: "I did X" — usually the start of something we now wait on ---------------
const PAST_ACTION: RegExp[] = [
  /\bi(?:'ve| have)? (?:just |already |finally )?(?:e-?mailed|emailed|mailed|sent|wrote|texted|messaged|called|phoned|applied|submitted|returned|ordered|paid|booked|asked|filed|requested|forwarded|shipped|posted|dropped off|handed in|left a message|reached out)\b/,
  /\b(?:mail|mesaj|eposta|e-posta) atti\w*/,
  /\b(?:gonderdim|basvurdum|ilettim|odedim|sordum|yazdim|aradim|teslim ettim)\b/,
  /\biade\b[^.]{0,20}\b(?:ettim|verdim|gonderdim|yaptim)\b/,
  /\bsiparis verdim\b/,
  /\bbasvuru yaptim\b/,
];

/** Which awaited thing a past action implies ("I returned X" → a refund). */
export const PAST_ACTION_IMPLIES: { re: RegExp; awaited: 'reply' | 'refund' | 'delivery' | 'confirmation' }[] = [
  { re: /\b(?:returned|iade)\b/, awaited: 'refund' },
  { re: /\b(?:ordered|siparis)\b/, awaited: 'delivery' },
  { re: /\b(?:paid|booked|odedim)\b/, awaited: 'confirmation' },
  { re: /./, awaited: 'reply' }, // emailed, wrote, asked, applied, sent, submitted, gonderdim, …
];

const IMPERATIVE_EN = new Set(
  (
    'call email e-mail send buy pay book schedule text message write check ask pick order cancel renew submit return ' +
    'reply finish print sign bring get make take prepare organize fix clean update review plan pack upload download ' +
    'share forward follow contact confirm remember register apply drop collect water feed walk sort tidy wash cook ' +
    'charge'
  ).split(' '),
);
const IMPERATIVE_TR_END = new Set(
  (
    'ara ode gonder yolla al yaz sor hallet yenile bitir tamamla ilet cevapla getir topla hazirla imzala yukle ' +
    'paylas yap git gel ver hatirla'
  ).split(' '),
);
const IMPERATIVE_TR_END_PAIRS = /\b(?:kontrol et|iptal et|randevu al|rezervasyon yap|geri ara|geri don)$/;
const FILLER_START =
  /^(?:(?:please|also|then|and|just|ok|okay|so|now|hey|maybe|perhaps|probably|possibly|ve|ama|sonra|belki|herhalde)\s+)+/;

/**
 * `folded` is the piece; `cleaned` is the same text with time expressions
 * blanked (so "tomorrow" never looks like a verb). Returns the strongest cue,
 * or null when the piece is just a statement.
 */
export function classifyCue(folded: string, cleaned: string, hasTime: boolean, lang: Lang): Cue | null {
  const first = (patterns: RegExp[], text = folded): string | null => {
    for (const re of patterns) {
      const m = re.exec(text);
      if (m) return m[0];
    }
    return null;
  };
  const cue = (kind: CueKind, match: string, strength: number): Cue => ({ kind, match, strength });

  let m: string | null;
  if ((m = first(PROMISE))) return cue('promise', m, 0.9);
  if ((m = first(WAIT))) return cue('wait', m, 0.9);
  if ((m = first(RETURN_STRONG))) return cue('return_later', m, 0.85);
  if ((m = first(EVENT_STRONG))) return cue('event', m, 0.85);
  if ((m = first(TASK))) return cue('task', m, 0.9);

  const words = cleaned.replace(FILLER_START, '').trim().replace(/[.!?,]+$/, '').split(/\s+/);
  const firstWord = words[0]?.replace(/'.*$/, '') ?? '';
  const lastWord = words[words.length - 1] ?? '';
  if (words.length >= 2 && IMPERATIVE_EN.has(firstWord)) return cue('task', firstWord, 0.7);
  // Turkish is verb-final: a bare imperative stem ends the clause ("faturayı öde").
  if (
    lang === 'tr' &&
    words.length >= 2 &&
    (IMPERATIVE_TR_END.has(lastWord) || IMPERATIVE_TR_END_PAIRS.test(words.join(' ')))
  ) {
    return cue('task', lastWord, 0.7);
  }

  if (hasTime && (m = first(EVENT_NOUN))) return cue('event', m, 0.6);
  if ((m = first(RETURN_WEAK))) return cue('return_later', m, 0.6);
  if ((m = first(PAST_ACTION))) return cue('past_action', m, 0.55);
  return null;
}
