/**
 * Timeline notes are written by the engine in English and stored that way (the engine is pure and
 * language-free, and old rows must keep meaning). This translates them for display, so a Turkish
 * screen never shows "Not relevant anymore". Unknown notes — including text the user typed — pass
 * through untouched.
 */
import { strings, type UiLang } from './index';

const en = strings('en').format;
const tr = strings('tr').format;

/** "Tuesday · 10:00", "12 Oct · 09:00", "Today · 15:00" → Turkish words, same shape. */
export function localizeWhen(text: string, lang: UiLang): string {
  if (lang === 'en') return text;
  let out = text;
  const swap = (from: string, to: string) => {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  };
  swap(en.today, tr.today);
  swap(en.tomorrow, tr.tomorrow);
  swap(en.yesterday, tr.yesterday);
  en.weekdaysLong.forEach((name, i) => swap(name, tr.weekdaysLong[i]));
  en.months.forEach((name, i) => swap(name, tr.months[i]));
  return out.replace(/^no date set$/, 'tarih yok');
}

const FIELD_TR: Record<string, string> = {
  title: 'başlık',
  'person or company': 'kişi veya kurum',
  note: 'not',
  'closing condition': 'kapanış koşulu',
};

const EXACT_TR: Record<string, string> = {
  'Not relevant anymore': 'Artık geçerli değil',
  'Marked done': 'Tamamlandı olarak işaretlendi',
  Seen: 'Görüldü',
  Fulfilled: 'Yerine getirildi',
  'Got a reply': 'Cevap geldi',
  Resolved: 'Çözüldü',
};

type Rule = [RegExp, (m: RegExpMatchArray, when: (s: string) => string) => string];

const RULES_TR: Rule[] = [
  [/^Review (.+)$/, (m, w) => `Kontrol: ${w(m[1])}`],
  [/^Until (.+)$/, (m, w) => `Erteleme: ${w(m[1])}`],
  [/^Moved to (.+)$/, (m, w) => `Taşındı: ${w(m[1])}`],
  [/^Next check: (.+)$/, (m, w) => `Sonraki kontrol: ${w(m[1])}`],
  [/^Now waiting: (".*")$/, (m) => `Şimdi bekleniyor: ${m[1]}`],
  [/^After completing (".*")$/, (m) => `${m[1]} tamamlandıktan sonra`],
  [/^(".*") was completed$/, (m) => `${m[1]} tamamlandı`],
  [/^Follow-up: (".*")$/, (m) => `Takip: ${m[1]}`],
  [/^Follow-up for (".*")$/, (m) => `${m[1]} için takip`],
  [/^From (".*")$/, (m) => `${m[1]} kaydından`],
  [/^(".*") (done|set aside) — back to waiting$/, (m) => `${m[1]} ${m[2] === 'done' ? 'tamamlandı' : 'kenara bırakıldı'} — yeniden beklemede`],
  [/^Changed: (.+)$/, (m) => `Değişti: ${m[1].split(', ').map((f) => FIELD_TR[f] ?? f).join(', ')}`],
  [/^Repeats (weekly|monthly) — next (.+)$/, (m, w) => `${m[1] === 'weekly' ? 'Haftalık' : 'Aylık'} tekrar — sonraki: ${w(m[2])}`],
];

/** What the user said travels as a suffix: `Moved to Friday · 15:00 — “move the dentist…”`. */
const SAID_SPLIT = ' — “';

export function localizeNote(note: string, lang: UiLang): string {
  if (lang === 'en') return note;
  const cut = note.indexOf(SAID_SPLIT);
  const head = cut === -1 ? note : note.slice(0, cut);
  const said = cut === -1 ? '' : note.slice(cut);
  const when = (s: string) => localizeWhen(s, lang);

  if (EXACT_TR[head]) return EXACT_TR[head] + said;
  for (const [re, build] of RULES_TR) {
    const m = head.match(re);
    if (m) return build(m, when) + said;
  }
  return note;
}
