import { LocalLoopParser } from './localParser';
import type { LoopParser, ParseOptions, ParseResult } from './types';

export { LocalLoopParser, parseText } from './localParser';
export { candidatesFromAiResponse, candidateToWire } from './aiSchema';
export type { Clarification, LoopCandidate, LoopParser, ParseOptions, ParseResult } from './types';

/**
 * The single place the app asks for a parser. v0.1 is fully local; swap this
 * for an AI-backed (or hybrid) implementation without touching any caller.
 * Never embed an API key in the app — a future AI parser must go through a
 * backend you control.
 */
export function createParser(options: ParseOptions = {}): LoopParser {
  return new LocalLoopParser(options);
}

/** Candidates plus clarifications from any parser, whether or not it implements `analyze`. */
export async function analyzeText(parser: LoopParser, text: string, now: Date): Promise<ParseResult> {
  if (parser.analyze) return parser.analyze(text, now);
  return { candidates: await parser.parse(text, now), clarifications: [] };
}
