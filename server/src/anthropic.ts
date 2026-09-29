import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { parseResponseSchema, type ParseResponse } from './schema.js';

const client = new Anthropic();

export class AiParseError extends Error {}

/**
 * Calls Claude to turn free-form capture text into OPENLOOP loop candidates.
 * Extraction/classification, not long-horizon agentic work, so effort stays
 * at "medium" rather than the default "high" — see the cost-optimization
 * guidance in the claude-api skill.
 */
export async function parseCapture(text: string, nowIso: string, locale: string | null): Promise<ParseResponse> {
  const response = await client.messages.parse({
    model: 'claude-opus-5',
    max_tokens: 8192,
    output_config: {
      effort: 'medium',
      format: zodOutputFormat(parseResponseSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(text, nowIso, locale) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new AiParseError('Claude declined to parse this text');
  }
  if (response.parsed_output === null) {
    throw new AiParseError('Claude response did not match the expected schema');
  }
  return response.parsed_output;
}
