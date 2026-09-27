/**
 * Turns a clause into a short, calm title: "Call dentist", "HR reply",
 * "Reconsider brown jacket". Everything is built by MASKING words out of the
 * user's own text (see `Mask`), so casing and Turkish letters survive.
 *
 * Style: terse, no leading article ("Call dentist", not "Call the dentist").
 */
import type { Awaited } from './extract';
import { HEDGE_RE, Mask, capitalizeFirst, type Lang, type Span } from './text';

export interface ClauseText {
  orig: string;
  folded: string;
  /** Time-expression ranges (relative to this clause) to drop from the title. */
  timeSpans: Span[];
}

const HEDGES = new RegExp(HEDGE_RE.source, 'g');
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const TASK_STRIP_EN: RegExp[] = [
  /^\s*(?:(?:and|but|so|then|also|ve|ama)\s+)+/g,
  /\bremind me\b(?:\s+later)?(?:\s+(?:to|about|of|that))?/g,
  /\blater\b/g,
  /\b(?:i|we)(?:'ve| have)?\s+(?:really |just )?(?:need|have|got|want|must|should|ought|gotta|better)(?:\s+got)?(?:\s+to)?\b/g,
  /\b(?:i|we)(?:'ll| will|'d| would)\b/g,
  /\bdon'?t forget(?: to)?\b/g,
  /\bdo not forget(?: to)?\b/g,
  /\bmake sure(?: i| to)?(?: to)?\b/g,
  /\b(?:need|have|got) to\b/g,
  /\bgotta\b/g,
  /\bplease\b/g,
  /\b(?:can|could) you\b/g,
];
// Turkish: reduce "aramam lazım" / "aramayı unutma" / "aramalıyım" to the stem "ara".
const TR_STEM_PATTERNS: RegExp[] = [
  /(\S+?)(?:mayi|meyi|mami|memi)\s+unutma\w*(?:\s+(?:lazim|gerek\w*))?/g,
  /(\S+?)(?:mam|mem)\s+(?:lazim|gerek\w*)/g,
  /(\S+?)(?:maliyim|meliyim|maliyiz|meliyiz)\b/g,
  /(\S+?)(?:mami|memi|mayi|meyi)\s+hatirla\w*/g,
];
const TASK_STRIP_TR: RegExp[] = [
  /^\s*(?:(?:ve|ama|sonra|ayrica)\s+)+/g,
  /\bbana\b/g,
  /\bsonra\b/g,
  /\b(?:da|de)\b/g,
  /\b(?:hatirlat\w*|lazim|gerek(?:iyor|li)?|unutma\w*)\b/g,
];

/** "call the dentist" → "call dentist": drop an article right after the leading verb. */
function dropArticle(text: string): string {
  return text.replace(/^(\S+)\s+(?:the|a|an)\s+/i, '$1 ').replace(/^(?:the|a|an)\s+/i, '');
}

function finish(text: string, lang: Lang, fallback: string): string {
  const cleaned = text.trim();
  return capitalizeFirst(cleaned || fallback.trim(), lang);
}

export function taskTitle(c: ClauseText, lang: Lang): string {
  const mask = new Mask(c.orig, c.folded);
  for (const s of c.timeSpans) mask.removeSpan(s.start, s.end);
  for (const re of TR_STEM_PATTERNS) mask.keepStemOnly(re);
  for (const re of lang === 'tr' ? TASK_STRIP_TR : TASK_STRIP_EN) mask.remove(re);
  mask.remove(HEDGES);
  return finish(lang === 'tr' ? mask.text() : dropArticle(mask.text()), lang, c.orig);
}

/** "HR reply" · "Zara refund" · "File from Ayşe" · "Waiting for reply" (no one named). */
export function waitingTitle(entity: string | null, awaited: Awaited, lang: Lang): string {
  if (lang === 'tr') {
    return entity ? `${entity} ${awaited.tr}` : `${capitalizeFirst(awaited.trBare, 'tr')} bekleniyor`;
  }
  if (!entity) return `Waiting for ${awaited.en}`;
  if (awaited.style === 'from') return `${capitalizeFirst(awaited.en)} from ${entity}`;
  return capitalizeFirst(`${entity} ${awaited.en}`);
}

const PROMISE_VERB_START: RegExp[] = [
  /\bi(?:'d|'ll| would| will| am going to|'m going to| was going to| shall)\s+/,
  /\bpromised(?:\s+[a-z']+)?(?:\s+that i(?:'d|'ll| would| will))?\s+to\s+/,
];
const PARTICIPLE: Record<string, string> = {
  send: 'sent', give: 'given', bring: 'brought', forward: 'forwarded', share: 'shared', email: 'emailed',
  text: 'texted', call: 'called', pay: 'paid', return: 'returned', book: 'booked', buy: 'bought', get: 'got',
  tell: 'told', help: 'helped', reply: 'replied', drop: 'dropped',
};

/** Title and closing condition for a promise: "Send Ozan the link" → "link sent". */
export function promiseTitle(
  c: ClauseText,
  entity: string | null,
  lang: Lang,
): { title: string; closing: string } {
  const mask = new Mask(c.orig, c.folded);
  for (const s of c.timeSpans) mask.removeSpan(s.start, s.end);

  if (lang === 'tr') {
    mask.keepStemOnly(/(\S+?)(?:ecegimi|acagimi|ecegim|acagim)\b/g, true);
    mask.remove(/\b(?:soyledim|dedim|soz verdim|soz vermistim)\b/g);
    mask.remove(/^\s*(?:(?:ve|ama)\s+)+/g);
    return { title: finish(mask.text(), lang, c.orig), closing: 'Söz yerine getirildi' };
  }

  let start = 0;
  for (const re of PROMISE_VERB_START) {
    const m = re.exec(c.folded);
    if (m) {
      start = m.index + m[0].length;
      break;
    }
  }
  if (start > 0) mask.removeSpan(0, start);
  else mask.remove(/\bi(?:'ve| have)?\s+(?:told|promised|said)\b/g);
  mask.remove(HEDGES);

  let phrase = dropArticle(mask.text());
  if (entity) phrase = phrase.replace(/\b(?:him|her|them)\b/i, entity);
  const title = finish(phrase, lang, c.orig);

  const verb = /^(\w+)\s*(.*)$/.exec(title.toLowerCase());
  const participle = verb ? PARTICIPLE[verb[1]] : undefined;
  if (verb && participle) {
    let object = verb[2];
    if (entity) object = object.replace(new RegExp(`\\b${escapeRegExp(entity.toLowerCase())}\\b`), '');
    object = object.replace(/^\s*(?:to\s+)?(?:the|a|an|my)\s+/, '').replace(/\s+/g, ' ').trim();
    if (object) return { title, closing: `${object} ${participle}` };
  }
  return { title, closing: 'Promise kept' };
}

const OBJECT_END = '(?=\\s+(?:again|later|after|when|next|in|on|around|before|because|but)\\b|[,.]|\\s*$)';
const DET = '(?:(?:the|this|that|my|a|an|these|those|some)\\s+)?';
const RETURN_OBJECT: RegExp[] = [
  new RegExp(`\\blook (?:at|into|over)\\s+${DET}(.+?)${OBJECT_END}`),
  new RegExp(`\\b(?:reconsider|revisit|rethink)\\s+${DET}(.+?)${OBJECT_END}`),
  new RegExp(`\\bthink about\\s+${DET}(.+?)${OBJECT_END}`),
  new RegExp(`\\bcome back to\\s+${DET}(.+?)${OBJECT_END}`),
  new RegExp(`\\bbring\\s+${DET}(.+?)\\s+back\\b`),
];
// What a preceding statement is "about": "I like the brown jacket" → "brown jacket".
const CONTEXT_OBJECT = new RegExp(
  `\\b(?:like|love|liked|loved|saw|found|considering|(?:want|wanted|need|prefer)(?:\\s+to\\s+\\w+)?)\\s+${DET}(.+?)(?=\\s+(?:but|because|though|and|again|for|from|at|in|on|is|are|was)\\b|[,.]|\\s*$)`,
);
const PRONOUN = /^(?:this|it|that|them|these|those|one)$/;

function firstObject(patterns: RegExp[], c: ClauseText): string | null {
  for (const re of patterns) {
    const m = re.exec(c.folded);
    if (!m || !m[1]) continue;
    const at = m.index + m[0].lastIndexOf(m[1]);
    const object = c.orig.slice(at, at + m[1].length).trim();
    if (object && !PRONOUN.test(object.toLowerCase()) && object.split(/\s+/).length <= 5) return object;
  }
  return null;
}

/** "Anaphoric" = the clause says "this"/"it" (or nothing) and needs the thing named elsewhere. */
export function returnLaterObject(primary: ClauseText, context: ClauseText | null, lang: Lang): string | null {
  if (lang === 'tr') {
    const mask = new Mask(primary.orig, primary.folded);
    for (const s of primary.timeSpans) mask.removeSpan(s.start, s.end);
    mask.remove(/\b(?:sonra|tekrar|yeniden|bir daha|ileride|bir ara|hatirlat\w*|bana)\b/g);
    mask.remove(/\b(?:bak|dusun|degerlendir|goz at)\w*/g);
    mask.remove(HEDGES);
    const text = mask.text();
    if (text && !/^(?:bunu|onu|sunu|bu|su|o)$/.test(text.toLowerCase())) return text;
    return null;
  }
  return firstObject(RETURN_OBJECT, primary) ?? (context ? firstObject([CONTEXT_OBJECT], context) : null);
}

/** "ceketi" → "ceket", "ayakkabıyı" → "ayakkabı". Best effort — the user can edit the title. */
function trStripAccusative(word: string): string {
  if (word.length >= 5 && /y[ıiuü]$/.test(word)) return word.slice(0, -2);
  if (word.length >= 4 && /[ıiuü]$/.test(word)) return word.slice(0, -1);
  return word;
}

export function returnLaterTitle(object: string | null, lang: Lang): string {
  if (lang === 'tr') {
    if (!object) return 'Tekrar bak';
    const words = object.split(/\s+/);
    words[words.length - 1] = trStripAccusative(words[words.length - 1]);
    return `Tekrar bak: ${words.join(' ')}`;
  }
  return object ? `Reconsider ${object}` : 'Revisit this';
}

export function eventTitle(c: ClauseText, lang: Lang): string {
  const mask = new Mask(c.orig, c.folded);
  for (const s of c.timeSpans) mask.removeSpan(s.start, s.end);
  mask.remove(/^\s*(?:(?:and|but|so|ve|ama)\s+)*(?:my|the|our|their|his|her|i have an?|i have)\b/g);
  if (lang === 'tr') {
    mask.remove(
      /\b(?:aciklan\w*|cikacak|cikiyor|cikar|belli ol\w*|yayinlan\w*|yayimlan\w*|gelecek|gelir|ulasacak|ulasir|teslim edilecek|var)\b.*$/g,
    );
  } else {
    mask.remove(
      /\b(?:comes?|coming|is|are|will|should|shall|arrives?|arriving|was|were|due|expected|goes|going to be|drops?|released|announced|published|available|ready|out)\b.*$/g,
    );
  }
  return finish(mask.text(), lang, c.orig);
}

/** A plain note: the sentence itself, trimmed to a sensible length. */
export function referenceTitle(orig: string, lang: Lang): string {
  const text = orig.replace(/[.!?…\s]+$/, '').trim();
  if (text.length <= 80) return capitalizeFirst(text, lang);
  const cut = text.slice(0, 80).replace(/\s+\S*$/, '');
  return `${capitalizeFirst(cut, lang)}…`;
}
