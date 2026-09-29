/**
 * Tries the AI parser first and silently falls back to the local parser on
 * any failure — unreachable server, timeout, a response that validates to
 * nothing. Keeps the v0.1 guarantee ("must work without an AI backend") true
 * even once an AI parser is wired in: offline is just the fallback path now,
 * not a separate mode the app has to remember to handle.
 */
import type { LoopCandidate, LoopParser, ParseResult } from './types';

async function runAnalyze(parser: LoopParser, text: string, now: Date): Promise<ParseResult> {
  if (parser.analyze) return parser.analyze(text, now);
  return { candidates: await parser.parse(text, now), clarifications: [] };
}

export class HybridLoopParser implements LoopParser {
  constructor(
    private readonly primary: LoopParser,
    private readonly fallback: LoopParser,
  ) {}

  async parse(text: string, now: Date): Promise<LoopCandidate[]> {
    return (await this.analyze(text, now)).candidates;
  }

  async analyze(text: string, now: Date): Promise<ParseResult> {
    try {
      const result = await runAnalyze(this.primary, text, now);
      if (result.candidates.length > 0 || result.clarifications.length > 0) return result;
    } catch (err) {
      console.warn('[HybridLoopParser] primary parser failed, falling back to local:', err);
    }
    return runAnalyze(this.fallback, text, now);
  }
}
