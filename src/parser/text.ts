/**
 * Text plumbing for the local parser.
 *
 * Central trick: `fold()` is LENGTH-PRESERVING (one UTF-16 unit in, one out).
 * We match cues on the folded (lowercase ASCII) text, but every index also
 * points into the original string, so titles and entity names can be cut out
 * with their real casing and Turkish letters intact.
 */

export type Lang = 'en' | 'tr';

export interface Span {
  start: number;
  end: number;
}

export { fold } from '@/utils/fold';

export function normalizeInput(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/** A 1–2 digit day just before a period ("10" in "10. ekim"), not part of a longer number. */
const ORDINAL_DAY_BEFORE = /(?:^|[^\d])\d{1,2}$/;
/** A month name right after the period (Turkish or English, any case). */
const MONTH_AFTER =
  /^\s*(?:ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik|january|february|march|april|may|june|july|august|september|october|november|december)(?![\p{L}])/iu;

/** Sentences, split on . ! ? … newlines and semicolons — but not inside "15.30" or "3,5". Terminators are excluded from spans. */
export function splitSentences(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  const push = (end: number) => {
    let s = start;
    let e = end;
    while (s < e && /[\s\-•*]/.test(text[s])) s += 1; // bullets / dashes
    while (e > s && /\s/.test(text[e - 1])) e -= 1;
    if (e > s) spans.push({ start: s, end: e });
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n' || c === ';') {
      push(i);
      start = i + 1;
      i += 1;
    } else if (c === '.' || c === '!' || c === '?' || c === '…') {
      if (c === '.' && isDigit(text[i - 1]) && isDigit(text[i + 1])) {
        i += 1; // 15.30 — a time or decimal, not a sentence end
        continue;
      }
      // "10. ekim" — a Turkish ordinal day, not a sentence end.
      if (c === '.' && ORDINAL_DAY_BEFORE.test(text.slice(Math.max(0, i - 3), i)) && MONTH_AFTER.test(text.slice(i + 1, i + 14))) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < text.length && /[.!?…]/.test(text[j])) j += 1; // "...", "?!"
      const next = text[j];
      if (next === undefined || /[\s"')\]]/.test(next)) {
        push(i);
        start = j;
      }
      i = j;
    } else {
      i += 1;
    }
  }
  push(text.length);
  return spans;
}

/** Word that can begin a clause after "and"/"ve" (a subject or a task verb). */
const CLAUSE_START =
  /^(?:i|we|they|he|she|it|my|our|remind|please|then|also|ben|biz|bana|benim|onlar|call|email|e-mail|send|buy|pay|book|schedule|text|message|write|check|ask|pick|order|cancel|renew|submit|return|reply|finish|print|sign|bring|get|make|take|look|ara|gonder|yolla|al|ode|yaz|sor)\b/;

/** Turkish clauses are verb-final, so "…ara ve …ode" is a clause break when the left side ends in a verb. */
const TR_VERB_END =
  /\b(?:ara|ode|gonder|yolla|al|yaz|sor|hallet|yenile|bitir|tamamla|kontrol et|iptal et|ilet|cevapla|getir|topla|hazirla|imzala|yukle|paylas|randevu al|rezervasyon yap|yap|git|gel|ver|bak)$/;

/**
 * Splits one sentence into clauses. Commas and contrast words ("but", "ama")
 * always split; "and"/"ve" only when a new clause plausibly starts after it.
 * Over-splitting is safe: the parser re-merges verbless fragments.
 */
export function splitClauses(folded: string, sentence: Span): Span[] {
  const text = folded.slice(sentence.start, sentence.end);
  const cuts: { from: number; to: number }[] = [];

  for (const m of text.matchAll(/,\s*(?:(?:and|but|ve|ama|fakat|ancak|also|then|so)\s+)?/g)) {
    const i = m.index;
    if (isDigit(text[i - 1]) && isDigit(text[i + 1])) continue; // 3,5
    cuts.push({ from: i, to: i + m[0].length });
  }
  for (const m of text.matchAll(/\s+(?:but|ama|fakat|ancak|lakin|however|yet)\s+/g)) {
    cuts.push({ from: m.index, to: m.index + m[0].length });
  }
  for (const m of text.matchAll(/\s+(?:and|ve|also|then|ayrica)\s+/g)) {
    const to = m.index + m[0].length;
    const right = text.slice(to);
    const left = text.slice(0, m.index);
    if (CLAUSE_START.test(right) || TR_VERB_END.test(left.trim())) cuts.push({ from: m.index, to });
  }

  cuts.sort((a, b) => a.from - b.from);
  const pieces: Span[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut.from < cursor) continue; // overlaps a cut we already took
    pieces.push({ start: cursor, end: cut.from });
    cursor = cut.to;
  }
  pieces.push({ start: cursor, end: text.length });

  return pieces
    .map((p) => trimSpan(text, p, sentence.start))
    .filter((p) => p.end > p.start);
}

function trimSpan(text: string, p: Span, offset: number): Span {
  let s = p.start;
  let e = p.end;
  while (s < e && /[\s,]/.test(text[s])) s += 1;
  while (e > s && /[\s,]/.test(text[e - 1])) e -= 1;
  return { start: s + offset, end: e + offset };
}

/**
 * Edits a string by masking out ranges while remembering original positions.
 * Regexes always run on `work` (folded, with removed chars blanked to spaces),
 * and the surviving ORIGINAL characters make up the result.
 */
export class Mask {
  private readonly keep: boolean[];
  private work: string;

  constructor(
    private readonly orig: string,
    folded: string,
  ) {
    this.keep = Array.from({ length: orig.length }, () => true);
    this.work = folded;
  }

  get folded(): string {
    return this.work;
  }

  removeSpan(start: number, end: number): this {
    const chars = this.work.split('');
    for (let i = Math.max(0, start); i < Math.min(end, this.orig.length); i += 1) {
      this.keep[i] = false;
      chars[i] = ' ';
    }
    this.work = chars.join('');
    return this;
  }

  /** Removes every match of `re` (must be global). */
  remove(re: RegExp): this {
    for (const m of [...this.work.matchAll(re)]) this.removeSpan(m.index, m.index + m[0].length);
    return this;
  }

  /**
   * For patterns shaped `(stem)(suffix…)`: keeps capture group 1 and removes the
   * rest of the match. Group 1 must start the match. Used to turn Turkish
   * "aramam lazım" into the stem "ara". With `dropVowelY`, a buffer "y" after a
   * vowel goes too ("arayacağımı" → "aray" → "ara").
   */
  keepStemOnly(re: RegExp, dropVowelY = false): this {
    for (const m of [...this.work.matchAll(re)]) {
      const stemEnd = m.index + m[1].length;
      const buffer = dropVowelY && /[aeıioöuü]y$/.test(m[1]) ? 1 : 0;
      this.removeSpan(stemEnd - buffer, m.index + m[0].length);
    }
    return this;
  }

  /**
   * The surviving original characters, whitespace-collapsed and stripped of stray
   * punctuation — including a comma left dangling next to removed text
   * ("Ozan'a söz verdim, yarın gönder" → "Ozan'a gönder", not "Ozan'a, gönder").
   */
  text(): string {
    const n = this.orig.length;
    const neighbourRemoved = (from: number, step: 1 | -1): boolean => {
      for (let j = from + step; j >= 0 && j < n; j += step) {
        if (/\s/.test(this.orig[j]) && this.keep[j]) continue;
        return !this.keep[j];
      }
      return false;
    };
    let out = '';
    for (let i = 0; i < n; i += 1) {
      const c = this.orig[i];
      const dangling = this.keep[i] && /[,;:]/.test(c) && (neighbourRemoved(i, -1) || neighbourRemoved(i, 1));
      out += this.keep[i] && !dangling ? c : ' ';
    }
    return out
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/^[\s,.;:!?\-–—'"]+|[\s,.;:!?\-–—'"]+$/g, '')
      .trim();
  }
}

const TR_UPPER: Record<string, string> = { i: 'İ', ı: 'I' };

export function capitalizeFirst(text: string, lang: Lang = 'en'): string {
  if (!text) return text;
  const first = text[0];
  const upper = lang === 'tr' && TR_UPPER[first] ? TR_UPPER[first] : first.toUpperCase();
  return upper + text.slice(1);
}

const TR_MARKERS =
  /\b(?:bugun|yarin|aksam|sabah|cevap|bekl\w+|lazim|gerek\w*|icin|ile|ama|ve|bir|bu|sonra|maastan|maas\w*|iade|yatmadi|soyledim|dedi|gonder\w*|aramam|hatirlat\w*|unut\w*|gelmedi|donecek|verdim|ettim|attim|cuma|pazartesi|persembe|carsamba|cumartesi|pazar|sali|haftaya|hafta|gelecek|onumuzdeki)\b/g;
const EN_MARKERS =
  /\b(?:the|and|to|is|are|my|for|with|i|i'm|i'll|i'd|waiting|tomorrow|today|tonight|remind|call|send|after|reply|refund|payday|told|promised|this|that|week|friday|monday|about|again)\b/g;

/**
 * Rough per-text language guess: Turkish letters or Turkish cue words vs
 * English function words. On a tie (e.g. one bare word) `fallback` decides —
 * callers pass the language of the whole input.
 */
export function detectLanguage(orig: string, folded: string, fallback: Lang = 'en'): Lang {
  const trChars = /[çğıöşüÇĞİÖŞÜ]/.test(orig) ? 2 : 0;
  const tr = trChars + (folded.match(TR_MARKERS)?.length ?? 0);
  const en = folded.match(EN_MARKERS)?.length ?? 0;
  if (tr === en) return fallback;
  return tr > en ? 'tr' : 'en';
}

const STOPWORDS = new Set(
  (
    'a an the and or but i me my we you he she it they them to of in on at by for with from is are was were be been am ' +
    'do does did have has had not no yes ok okay maybe perhaps probably just like about around this that these those ' +
    'there here so then also please thanks thank hi hello hey cool sure will would can could should shall ' +
    'ne ve ama bir bu su o ben biz sen bana beni benim icin ile de da mi mu belki sanirim herhalde tamam evet hayir ' +
    'iyi tesekkurler selam merhaba'
  ).split(' '),
);

/** Words that carry meaning once time expressions and filler are removed. */
export function contentWords(folded: string, ignore: Span[] = []): string[] {
  const chars = folded.split('');
  for (const s of ignore) for (let i = s.start; i < s.end && i < chars.length; i += 1) chars[i] = ' ';
  return chars
    .join('')
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w.replace(/'.*$/, '')));
}

export const HEDGE_RE = /\b(?:maybe|perhaps|probably|possibly|might|roughly|belki|herhalde|sanirim|galiba)\b/;
