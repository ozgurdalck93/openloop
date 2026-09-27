/**
 * Pulls "who" (entity) and "what are we waiting for" (awaited thing) out of a
 * clause. Rule-based on purpose: the AI parser that may replace this later has
 * the same output contract.
 */
import { PAST_ACTION_IMPLIES } from './cues';
import { fold, type Lang } from './text';

// ---- entities ------------------------------------------------------------------------

export interface Entity {
  name: string;
  /** Proper noun / acronym → high; a role like "the bank" → medium. */
  confidence: number;
}

/** Capitalised words that are not names. Folded. */
const NOT_A_NAME = new Set(
  (
    "i i'm i'll i'd i've my me we our you your he she it they them his her their the a an and but so if then also " +
    'maybe perhaps please ok okay thanks thank hi hello hey yes no not still waiting remind call send email buy pay ' +
    'book tell ask look bring check need have tomorrow today tonight later after before when this that these those ' +
    'there here monday tuesday wednesday thursday friday saturday sunday january february march april may june july ' +
    'august september october november december morning afternoon evening night noon am pm asap fyi tbd todo ' +
    'any some nothing everything nobody anyone someone what why how who which where just now still already yet ' +
    'ben biz sen bu su o yarin bugun sonra belki tamam ama ve hatirlat unutma bana bir hala henuz ' +
    'pazartesi sali carsamba persembe cuma cumartesi pazar ocak subat mart nisan mayis haziran temmuz agustos ' +
    'eylul ekim kasim aralik sabah aksam gece'
  ).split(' '),
);

/** Verbs that, right after a capitalised sentence-opening word, mark it as a subject ("Ayşe said …"). */
const SUBJECT_VERBS =
  /^\s+(?:said|says|told|will|would|replied|sent|wrote|called|promised|texted|emailed|dedi|soyledi|gonderecek|cevap|aradi|yazdi|donecek|mail|haber)\b/;
const NAME_TOKEN = /[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşüâîûÂÎÛ]*(?:'[A-Za-zçğıöşü]+)?/g;
const FOLLOWS_RELATION =
  /(?:from|to|with|for|on|told|emailed|called|asked|texted|messaged|contacted|about|of)\s+(?:the\s+)?$/;

const ROLE_EN =
  /\b(?:the|a|an|my|their|his|her|our|your)\s+((?:[a-z]+\s+)?(?:company|bank|office|dentist|doctor|landlord|landlady|manager|school|airline|hospital|clinic|insurance|shop|store|agency|support|courier|neighbou?r|plumber|electrician|lawyer|accountant|teacher|professor|recruiter|customer service))\b/;
const ROLE_EN_BARE = /\b(dentist|doctor|landlord|landlady|bank|manager|recruiter|plumber|lawyer|accountant)\b/;
const ROLE_TR: [RegExp, string][] = [
  [/\bdis hekimi\w*/, 'Diş hekimi'],
  [/\bdisci\w*/, 'Dişçi'],
  [/\bdoktor\w*/, 'Doktor'],
  [/\bbanka\w*/, 'Banka'],
  [/\bev sahib\w*/, 'Ev sahibi'],
  [/\bokul\w*/, 'Okul'],
  [/\bhastane\w*/, 'Hastane'],
  [/\bsigorta\w*/, 'Sigorta'],
  [/\bsirket\w*/, 'Şirket'],
  [/\bmudur\w*/, 'Müdür'],
  [/\bavukat\w*/, 'Avukat'],
];

/**
 * Best entity in `orig` (whose folded twin is `folded`): a proper noun or
 * acronym near a relation word, else a role ("the bank", "the ticket company").
 */
export function findEntity(
  orig: string,
  folded: string,
  lang: Lang,
  options: { subjectFirst?: boolean } = {},
): Entity | null {
  const candidates: { name: string; index: number; score: number }[] = [];
  const tokens = [...orig.matchAll(NAME_TOKEN)];

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const full = tok[0];
    const base = full.replace(/'.*$/, '');
    const hasSuffix = full.includes("'");
    if (NOT_A_NAME.has(fold(base)) || NOT_A_NAME.has(fold(full))) continue;

    const before = orig.slice(0, tok.index).trimEnd();
    const atStart = before === '' || /[.!?…;\n]$/.test(before);
    const isAcronym = base.length >= 2 && /^[A-ZÇĞİÖŞÜ]+$/.test(base);
    const isSubject = SUBJECT_VERBS.test(folded.slice(tok.index + full.length));
    // A capital at the start of a sentence proves nothing — unless it carries a
    // Turkish suffix ("HR'a"), is an acronym, or is followed by "said"/"will".
    // When the caller knows the clause is about what someone ELSE will do
    // ("Ayşe dosyayı gönderecek"), an opening name is the subject — but "Refund
    // hasn't arrived" opens with a thing, not a person.
    const subjectFirst = options.subjectFirst === true && findAwaited(fold(base)) === null;
    if (atStart && !(hasSuffix || isAcronym || isSubject || subjectFirst)) continue;

    // Glue "Ticket Company" (adjacent capitalised words) into one name.
    let name = base;
    let end = tok.index + full.length;
    let j = i + 1;
    while (j < tokens.length && orig.slice(end, tokens[j].index) === ' ') {
      const next = tokens[j][0].replace(/'.*$/, '');
      if (NOT_A_NAME.has(fold(next)) || isAcronym) break;
      name += ` ${next}`;
      end = tokens[j].index + tokens[j][0].length;
      j += 1;
    }
    i = j - 1;

    const relation = FOLLOWS_RELATION.test(folded.slice(0, tok.index));
    const score = 1 + (relation ? 2 : 0) + (isSubject ? 2 : 0) + (isAcronym ? 1 : 0);
    candidates.push({ name, index: tok.index, score });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    return { name: candidates[0].name, confidence: 0.85 };
  }

  const role = ROLE_EN.exec(folded);
  if (role) {
    const start = role.index + role[0].length - role[1].length; // the group ends the match
    return { name: orig.slice(start, start + role[1].length), confidence: 0.5 };
  }
  if (lang === 'tr') {
    for (const [re, label] of ROLE_TR) if (re.test(folded)) return { name: label, confidence: 0.5 };
  }
  const bare = ROLE_EN_BARE.exec(folded);
  if (bare) return { name: orig.slice(bare.index, bare.index + bare[1].length), confidence: 0.5 };
  return null;
}

// ---- awaited things -----------------------------------------------------------------------

export type AwaitedKey =
  | 'refund'
  | 'payment'
  | 'delivery'
  | 'result'
  | 'confirmation'
  | 'decision'
  | 'file'
  | 'link'
  | 'reply';

export interface Awaited {
  key: AwaitedKey;
  /** English noun for titles: "reply", "refund". For files it is the word actually used ("invoice"). */
  en: string;
  /** Turkish noun in its possessed form ("cevabı", "iadesi") so "Zara iadesi" reads naturally. */
  tr: string;
  /** Bare Turkish noun, for titles with no entity: "Cevap bekleniyor". */
  trBare: string;
  /** compound → "HR reply"; from → "File from Ayşe". */
  style: 'compound' | 'from';
  closeEn: string;
  closeTr: string;
}

// Order = priority when a clause mentions several ("refund" beats "package").
const AWAITED: { re: RegExp; awaited: Awaited }[] = [
  { re: /\b(?:refunds?|reimburs\w*|iade\w*)\b/, awaited: { key: 'refund', en: 'refund', tr: 'iadesi', trBare: 'iade', style: 'compound', closeEn: 'Refund received', closeTr: 'İade geldi' } },
  { re: /\b(?:payments?|money|deposit|transfer|salary|odeme\w*|para\b|maas\w*)/, awaited: { key: 'payment', en: 'payment', tr: 'ödemesi', trBare: 'ödeme', style: 'compound', closeEn: 'Payment received', closeTr: 'Ödeme geldi' } },
  { re: /\b(?:package|parcel|delivery|order|shipment|cargo|kargo\w*|paket\w*|siparis\w*|teslimat\w*)\b/, awaited: { key: 'delivery', en: 'delivery', tr: 'kargosu', trBare: 'kargo', style: 'compound', closeEn: 'Delivered', closeTr: 'Teslim edildi' } },
  { re: /\b(?:results?|sonuc\w*)\b/, awaited: { key: 'result', en: 'result', tr: 'sonucu', trBare: 'sonuç', style: 'compound', closeEn: 'Result received', closeTr: 'Sonuç geldi' } },
  { re: /\b(?:confirmation|approval|onay\w*)\b/, awaited: { key: 'confirmation', en: 'confirmation', tr: 'onayı', trBare: 'onay', style: 'compound', closeEn: 'Confirmation received', closeTr: 'Onay geldi' } },
  { re: /\b(?:decision|verdict|karar\w*)\b/, awaited: { key: 'decision', en: 'decision', tr: 'kararı', trBare: 'karar', style: 'compound', closeEn: 'Decision received', closeTr: 'Karar geldi' } },
  { re: /\b(?:files?|documents?|attachments?|contract|invoice|form|report|dosya\w*|belge\w*|evrak\w*|sozlesme\w*|fatura\w*)\b/, awaited: { key: 'file', en: 'file', tr: 'dosyası', trBare: 'dosya', style: 'from', closeEn: 'File received', closeTr: 'Dosya geldi' } },
  { re: /\blinks?\b/, awaited: { key: 'link', en: 'link', tr: 'linki', trBare: 'link', style: 'from', closeEn: 'Link received', closeTr: 'Link geldi' } },
  { re: /\b(?:repl(?:y|ies|ied)|respon\w*|answer\w*|feedback|get back|gets back|hear back|heard back|write back|news|cevap\w*|yanit\w*|geri don\w*|donus\w*|haber\w*)\b/, awaited: { key: 'reply', en: 'reply', tr: 'cevabı', trBare: 'cevap', style: 'compound', closeEn: 'Reply received', closeTr: 'Cevap geldi' } },
];

const REPLY = AWAITED[AWAITED.length - 1].awaited;

/** First awaited thing mentioned in `folded`, by priority; null if none. */
export function findAwaited(folded: string): Awaited | null {
  for (const { re, awaited } of AWAITED) {
    const m = re.exec(folded);
    if (!m) continue;
    // Name the thing as the user did: "invoice", "documents" → "document", "approval".
    return awaited.key === 'file' || awaited.key === 'confirmation'
      ? { ...awaited, en: m[0].replace(/s$/, '') }
      : awaited;
  }
  return null;
}

/** "I returned X" → refund, "I ordered X" → delivery, "I emailed X" → reply. */
export function impliedAwaited(folded: string): Awaited {
  const key = PAST_ACTION_IMPLIES.find((p) => p.re.test(folded))?.awaited ?? 'reply';
  return AWAITED.find((a) => a.awaited.key === key)?.awaited ?? REPLY;
}

export const defaultAwaited = (): Awaited => REPLY;
