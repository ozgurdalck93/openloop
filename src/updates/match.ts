/**
 * Which of the user's open loops does a clause talk about? Scoring, not guessing:
 * a loop only ranks when the WORDS point at it (its person/company, its title, or a
 * concept it shares — "iade" and "refund" and "para" are one concept). Ties and
 * near-ties are reported as ambiguous so the user chooses.
 */
import { isSteppedAside } from '@/engine/transitions';
import { CLOSED_STATUSES, type Loop } from '@/engine/types';
import { contentWords } from '@/parser/text';
import { fold } from '@/utils/fold';

import type { DetectedIntent } from './intent';
import type { RankedLoop, UpdateIntent } from './types';

/** Synonym groups across English and Turkish (folded). A word in any group means the whole concept. */
const CONCEPTS: Record<string, string[]> = {
  money: ['refund', 'refunded', 'reimbursement', 'reimbursed', 'iade', 'iadesi', 'iadem', 'money', 'para', 'parasi', 'parami', 'payment', 'odeme', 'odemesi', 'deposit', 'transfer', 'havale'],
  reply: ['reply', 'replied', 'response', 'respond', 'responded', 'answer', 'answered', 'feedback', 'news', 'cevap', 'cevabi', 'yanit', 'yaniti', 'donus', 'haber', 'email', 'mail', 'eposta'],
  call: ['call', 'called', 'callback', 'arama', 'telefon'],
  delivery: ['package', 'parcel', 'delivery', 'delivered', 'order', 'shipment', 'cargo', 'kargo', 'kargosu', 'paket', 'paketi', 'siparis', 'siparisi', 'teslimat'],
  file: ['file', 'files', 'document', 'documents', 'attachment', 'contract', 'invoice', 'form', 'report', 'dosya', 'dosyasi', 'dosyayi', 'belge', 'evrak', 'sozlesme', 'fatura'],
  link: ['link', 'linki', 'url'],
  result: ['result', 'results', 'sonuc', 'sonucu', 'sonuclar'],
  decision: ['decision', 'verdict', 'approval', 'approved', 'confirmation', 'confirmed', 'karar', 'onay', 'onayi'],
};

/** Words that say WHAT HAPPENED, not WHICH LOOP. Dropped before matching. */
const ACTION_WORDS = new Set(
  (
    'came come comes arrived arrive arrives got get gets received receive sent send sends replied responded answered called ' +
    'paid refunded delivered confirmed approved finally already still yet nothing hala henuz yok geldi geldiler gelmis gelmedi ' +
    'yatti yatmis ulasti gonderdi gonderdiler verdi verdiler aradi aradilar donus yapti yaptilar etti onayladi odedi ' +
    'move moved push pushed shift reschedule postpone delay bump make instead yerine ertele kaydir tasi cek al degistir ' +
    'bunu bunun onu sunu bu artik kapat close cancel forget never mind relevant anymore longer needed need done finished ' +
    'completed handled sorted bitti yaptim hallettim tamamladim tamam remind hatirlat that this it its they them he she we ' +
    'one ones iptal vazgectim gerek kalmadi lazim ilgi ilgisiz gitsin unut back here'
  ).split(' '),
);

const MIN_PREFIX = 4;

/** Same word, allowing Turkish/English endings: "iadesi" ~ "iade", "dentists" ~ "dentist". Short words must match exactly. */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < MIN_PREFIX || b.length < MIN_PREFIX) return false;
  return a.startsWith(b) || b.startsWith(a);
}

const wordsOf = (text: string): string[] =>
  contentWords(fold(text))
    .map((w) => w.replace(/'.*$/, ''))
    .filter((w) => w.length >= 2);

/** Which concepts do these words express? */
export function conceptsOf(words: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const word of words) {
    for (const [concept, members] of Object.entries(CONCEPTS)) {
      if (members.some((m) => sameWord(word, m))) found.add(concept);
    }
  }
  return found;
}

/** The words in a clause that could name a loop: no time words, no verbs of happening. */
export function targetWords(folded: string, timeSpans: { start: number; end: number }[] = []): string[] {
  const chars = folded.split('');
  for (const s of timeSpans) for (let i = s.start; i < s.end && i < chars.length; i += 1) chars[i] = ' ';
  return wordsOf(chars.join('')).filter((w) => !ACTION_WORDS.has(w));
}

export const SCORE = { entity: 4, titleWord: 2, concept: 2.5, contextWord: 0.5, typeFit: 0.5, hint: 1, unexplained: 1.5 } as const;

/** A clause needs at least this much to count as "about" a loop. */
export const MIN_RELEVANT = 2;

/** Can this kind of update even apply to this loop? */
export function compatible(intent: UpdateIntent, loop: Loop): boolean {
  if (CLOSED_STATUSES.includes(loop.status) || loop.status === 'draft') return false;
  switch (intent) {
    case 'still_waiting':
      return loop.type === 'waiting' && !isSteppedAside(loop);
    case 'resolve':
      return loop.type !== 'reference';
    case 'reschedule':
      return loop.type !== 'reference' && !isSteppedAside(loop);
    case 'dismiss':
      return true;
  }
}

/**
 * Score every compatible loop against the clause's target words; best first. Zero-score loops
 * are kept (for "choose another"). Each word counts through its SINGLE best channel — entity,
 * then title, then a shared concept, then plain context — never several at once, so a loop
 * cannot look well-matched just because one generic word ("refund") happens to hit it three
 * ways. A word whose concept plainly points somewhere else ("package" → delivery, on a loop
 * that is about money) counts against the loop even if the same string appears in its raw
 * context: "still no reply from Nike" is not about "HR reply" just because both say "reply",
 * and a package arriving does not by itself close a refund.
 */
export function rankLoops(
  intent: DetectedIntent,
  words: readonly string[],
  loops: readonly Loop[],
): RankedLoop[] {
  const ranked = loops
    .filter((loop) => compatible(intent.intent, loop))
    .map((loop): RankedLoop => {
      const entity = wordsOf(loop.entityName ?? '');
      const title = wordsOf(loop.title);
      const context = wordsOf(loop.rawContext ?? '');
      const loopConcepts = conceptsOf([...title, ...wordsOf(loop.expectedEvent ?? ''), ...entity]);

      let score = 0;
      let unexplained = 0;
      for (const w of words) {
        const wordConcepts = conceptsOf([w]);
        const conceptOverlap = wordConcepts.size > 0 && [...wordConcepts].some((c) => loopConcepts.has(c));
        const conceptMismatch = wordConcepts.size > 0 && !conceptOverlap;
        if (entity.some((e) => sameWord(w, e))) score += SCORE.entity;
        else if (title.some((t) => sameWord(w, t))) score += SCORE.titleWord;
        else if (conceptOverlap) score += SCORE.concept;
        else if (!conceptMismatch && context.some((c) => sameWord(w, c))) score += SCORE.contextWord;
        else unexplained += 1;
      }
      score -= Math.min(3, SCORE.unexplained * unexplained);
      score = Math.max(score, 0);

      // What kind of thing the phrase suggests, when the words themselves name nothing.
      if (loop.type === 'waiting' && (intent.arrival || intent.sent)) score += SCORE.typeFit;
      if ((loop.type === 'task' || loop.type === 'promise') && intent.completion) score += SCORE.typeFit;
      if (intent.sent && ['file', 'link', 'delivery'].some((c) => loopConcepts.has(c))) score += SCORE.hint;
      return { loop, score };
    });

  // Best first; among equals, the most recently touched loop.
  return ranked.sort((a, b) => b.score - a.score || (a.loop.updatedAt < b.loop.updatedAt ? 1 : -1));
}
