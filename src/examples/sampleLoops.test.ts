import { describe, expect, it } from 'vitest';

import { at } from '../../test/fixtures';
import { parseText } from '@/parser/localParser';
import { waitingCaption } from '@/utils/format';
import { CAPTURE_SUGGESTIONS, SAMPLE_TEXT } from './sampleLoops';

const NOW = at(2026, 9, 23, 10, 0);

describe('sample loops', () => {
  for (const lang of ['en', 'tr'] as const) {
    it(`${lang}: the example turns into three items, including one we are waiting on`, () => {
      const { candidates } = parseText(SAMPLE_TEXT[lang], NOW, { locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
      expect(candidates.length).toBe(3);
      expect(candidates.some((c) => c.type === 'waiting')).toBe(true);
    });

    it(`${lang}: every capture suggestion is understood on its own`, () => {
      for (const sentence of CAPTURE_SUGGESTIONS[lang]) {
        const { candidates } = parseText(sentence, NOW, { locale: lang === 'tr' ? 'tr-TR' : 'en-US' });
        expect(candidates.length, sentence).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

describe('waitingCaption', () => {
  const waiting = { type: 'waiting', createdAt: at(2026, 9, 20, 9, 0).toISOString() };
  it('says how long, calmly, in both languages', () => {
    expect(waitingCaption(waiting, NOW, 'en')).toBe('Waiting 3 days');
    expect(waitingCaption(waiting, NOW, 'tr')).toBe('3 gündür bekleniyor');
    expect(waitingCaption({ ...waiting, createdAt: at(2026, 9, 22, 9, 0).toISOString() }, NOW, 'en')).toBe('Waiting 1 day');
  });
  it('stays silent for new items and for other types', () => {
    expect(waitingCaption({ ...waiting, createdAt: NOW.toISOString() }, NOW, 'en')).toBeNull();
    expect(waitingCaption({ type: 'task', createdAt: waiting.createdAt }, NOW, 'en')).toBeNull();
  });
});
