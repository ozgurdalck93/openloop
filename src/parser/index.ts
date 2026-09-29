import { AiLoopParser } from './aiParser';
import { HybridLoopParser } from './hybridParser';
import { LocalLoopParser } from './localParser';
import type { LoopParser, ParseOptions, ParseResult } from './types';

export { LocalLoopParser, parseText } from './localParser';
export { AiLoopParser } from './aiParser';
export type { AiParserOptions } from './aiParser';
export { HybridLoopParser } from './hybridParser';
export { candidatesFromAiResponse, candidateToWire } from './aiSchema';
export type { Clarification, LoopCandidate, LoopParser, ParseOptions, ParseResult } from './types';

/**
 * The single place the app asks for a parser. Local-only, offline, no
 * network — the guarantee v0.1 makes. Use `createHybridParser` for the
 * AI-backed path.
 */
export function createParser(options: ParseOptions = {}): LoopParser {
  return new LocalLoopParser(options);
}

export interface HybridParserOptions extends ParseOptions {
  /** The parser server's URL (see server/README.md), typically from EXPO_PUBLIC_AI_PARSER_URL. Falsy = local-only. */
  aiBaseUrl?: string | null;
  aiClientKey?: string | null;
}

/**
 * Same contract as `createParser`, but tries the AI backend first when
 * `aiBaseUrl` is configured and falls back to the local parser on any
 * failure. With no `aiBaseUrl`, this is identical to `createParser` — the
 * app still works with no backend deployed, never a hard dependency.
 */
export function createHybridParser(options: HybridParserOptions = {}): LoopParser {
  const local = new LocalLoopParser(options);
  if (!options.aiBaseUrl) return local;
  const ai = new AiLoopParser({ baseUrl: options.aiBaseUrl, clientKey: options.aiClientKey ?? undefined, locale: options.locale });
  return new HybridLoopParser(ai, local);
}

/** Candidates plus clarifications from any parser, whether or not it implements `analyze`. */
export async function analyzeText(parser: LoopParser, text: string, now: Date): Promise<ParseResult> {
  if (parser.analyze) return parser.analyze(text, now);
  return { candidates: await parser.parse(text, now), clarifications: [] };
}
