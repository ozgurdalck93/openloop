/**
 * Calls the OPENLOOP parser server (see server/README.md) and validates its
 * response through the same wire contract the local parser speaks
 * (`aiSchema.ts` / 04_OPENLOOP_AI_OUTPUT_SCHEMA.json). No API key lives here —
 * only the server's URL, which is not a secret.
 *
 * Never used alone by the app; `HybridLoopParser` wraps it with the offline
 * `LocalLoopParser` as a fallback. See `createHybridParser` in `index.ts`.
 */
import { toLocalIsoWithOffset } from '@/utils/time';

import { candidatesFromAiResponse } from './aiSchema';
import type { LoopCandidate, LoopParser, ParseOptions, ParseResult } from './types';

export interface AiParserOptions extends ParseOptions {
  /** Base URL of the parser server, e.g. "http://192.168.1.10:8787". No trailing slash. */
  baseUrl: string;
  /** Sent as x-openloop-client-key when the server has CLIENT_SHARED_SECRET set. */
  clientKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class AiLoopParser implements LoopParser {
  constructor(private readonly options: AiParserOptions) {}

  async parse(text: string, now: Date): Promise<LoopCandidate[]> {
    return (await this.analyze(text, now)).candidates;
  }

  async analyze(text: string, now: Date): Promise<ParseResult> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(`${this.options.baseUrl}/v1/parse`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.clientKey ? { 'x-openloop-client-key': this.options.clientKey } : {}),
        },
        body: JSON.stringify({
          text,
          now: toLocalIsoWithOffset(now),
          locale: this.options.locale ?? null,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`AI parser request failed: ${response.status}`);
    }
    const json: unknown = await response.json();
    const { candidates, errors } = candidatesFromAiResponse(json);
    if (errors.length > 0) {
      console.warn('[AiLoopParser] response had issues:', errors);
    }
    return { candidates, clarifications: [] };
  }
}
