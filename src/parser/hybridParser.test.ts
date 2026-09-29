import { describe, expect, it, vi } from 'vitest';

import { at } from '../../test/fixtures';
import { HybridLoopParser } from './hybridParser';
import type { LoopCandidate, LoopParser, ParseResult } from './types';

const candidate = (title: string): LoopCandidate => ({
  type: 'task',
  title,
  status: 'draft',
  rawContext: null,
  nextActionOwner: 'user',
  entityName: null,
  expectedEvent: null,
  nextReviewAt: null,
  closingCondition: null,
  followUpPolicy: null,
  timingSource: 'none',
  classificationConfidence: 0.8,
  timingConfidence: 0,
  entityConfidence: 0,
  needsUserConfirmation: false,
  confirmationQuestion: null,
  timingLabel: null,
});

function stubParser(result: ParseResult | (() => Promise<ParseResult>)): LoopParser {
  return {
    parse: async () => (typeof result === 'function' ? (await result()).candidates : result.candidates),
    analyze: typeof result === 'function' ? result : async () => result,
  };
}

function throwingParser(err: unknown): LoopParser {
  return {
    parse: async () => {
      throw err;
    },
    analyze: async () => {
      throw err;
    },
  };
}

describe('HybridLoopParser', () => {
  it('uses the primary result when it finds candidates', async () => {
    const primary = stubParser({ candidates: [candidate('from AI')], clarifications: [] });
    const fallback = stubParser({ candidates: [candidate('from local')], clarifications: [] });
    const hybrid = new HybridLoopParser(primary, fallback);

    const result = await hybrid.analyze('text', at(2026, 9, 29, 18, 16));

    expect(result.candidates[0].title).toBe('from AI');
  });

  it('uses the primary result when it has clarifications but no candidates', async () => {
    const primary = stubParser({ candidates: [], clarifications: [{ text: 'Friday?', question: 'What does Friday refer to?' }] });
    const fallback = stubParser({ candidates: [candidate('from local')], clarifications: [] });
    const hybrid = new HybridLoopParser(primary, fallback);

    const result = await hybrid.analyze('text', at(2026, 9, 29, 18, 16));

    expect(result.clarifications).toHaveLength(1);
    expect(result.candidates).toHaveLength(0);
  });

  it('falls back to local when the primary throws', async () => {
    const primary = throwingParser(new Error('network down'));
    const fallback = stubParser({ candidates: [candidate('from local')], clarifications: [] });
    const hybrid = new HybridLoopParser(primary, fallback);

    const result = await hybrid.analyze('text', at(2026, 9, 29, 18, 16));

    expect(result.candidates[0].title).toBe('from local');
  });

  it('falls back to local when the primary returns nothing usable', async () => {
    const primary = stubParser({ candidates: [], clarifications: [] });
    const fallback = stubParser({ candidates: [candidate('from local')], clarifications: [] });
    const hybrid = new HybridLoopParser(primary, fallback);

    const result = await hybrid.analyze('text', at(2026, 9, 29, 18, 16));

    expect(result.candidates[0].title).toBe('from local');
  });

  it('parse() delegates to analyze() and returns just the candidates', async () => {
    const primary = stubParser({ candidates: [candidate('from AI')], clarifications: [] });
    const fallback = stubParser({ candidates: [], clarifications: [] });
    const hybrid = new HybridLoopParser(primary, fallback);

    const candidates = await hybrid.parse('text', at(2026, 9, 29, 18, 16));

    expect(candidates).toHaveLength(1);
  });

  it('never calls the fallback when the primary succeeds', async () => {
    const fallbackAnalyze = vi.fn(async () => ({ candidates: [], clarifications: [] }));
    const primary = stubParser({ candidates: [candidate('from AI')], clarifications: [] });
    const fallback: LoopParser = { parse: async () => [], analyze: fallbackAnalyze };
    const hybrid = new HybridLoopParser(primary, fallback);

    await hybrid.analyze('text', at(2026, 9, 29, 18, 16));

    expect(fallbackAnalyze).not.toHaveBeenCalled();
  });
});
