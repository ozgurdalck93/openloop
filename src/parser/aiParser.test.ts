import { describe, expect, it, vi } from 'vitest';

import { at } from '../../test/fixtures';
import { AiLoopParser } from './aiParser';

const validWireLoop = {
  type: 'waiting',
  title: 'HR reply',
  status: 'draft',
  raw_context: 'HR said they would reply this week',
  next_action_owner: 'other',
  entity_name: 'HR',
  expected_event: 'a reply',
  next_review_at: '2026-10-03T09:00:00.000Z',
  closing_condition: 'You hear back',
  follow_up_policy: 'reply_work',
  classification_confidence: 0.9,
  timing_confidence: 0.7,
  entity_confidence: 0.8,
  needs_user_confirmation: false,
  confirmation_question: null,
};

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('AiLoopParser', () => {
  it('sends text, a locally-offset now and the locale to POST /v1/parse', async () => {
    const fetchImpl = fakeFetch({ loops: [] });
    const parser = new AiLoopParser({ baseUrl: 'http://localhost:8787', locale: 'tr-TR', fetchImpl });

    await parser.analyze('HR said they would reply this week', at(2026, 9, 29, 18, 16));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://localhost:8787/v1/parse');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      text: 'HR said they would reply this week',
      now: expect.stringMatching(/^2026-09-29T18:16:00[+-]\d{2}:\d{2}$/),
      locale: 'tr-TR',
    });
  });

  it('sends the client key header when configured', async () => {
    const fetchImpl = fakeFetch({ loops: [] });
    const parser = new AiLoopParser({ baseUrl: 'http://localhost:8787', clientKey: 'secret', fetchImpl });

    await parser.analyze('hello', at(2026, 9, 29, 18, 16));

    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers['x-openloop-client-key']).toBe('secret');
  });

  it('omits the client key header when not configured', async () => {
    const fetchImpl = fakeFetch({ loops: [] });
    const parser = new AiLoopParser({ baseUrl: 'http://localhost:8787', fetchImpl });

    await parser.analyze('hello', at(2026, 9, 29, 18, 16));

    const init = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers['x-openloop-client-key']).toBeUndefined();
  });

  it('converts a valid wire response into LoopCandidates', async () => {
    const fetchImpl = fakeFetch({ loops: [validWireLoop] });
    const parser = new AiLoopParser({ baseUrl: 'http://localhost:8787', fetchImpl });

    const result = await parser.analyze('HR said they would reply this week', at(2026, 9, 29, 18, 16));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ type: 'waiting', title: 'HR reply', entityName: 'HR' });
    expect(result.clarifications).toEqual([]);
  });

  it('drops an individual malformed loop but keeps the rest', async () => {
    const fetchImpl = fakeFetch({ loops: [validWireLoop, { ...validWireLoop, type: 'not-a-type' }] });
    const parser = new AiLoopParser({ baseUrl: 'http://localhost:8787', fetchImpl });

    const result = await parser.analyze('text', at(2026, 9, 29, 18, 16));

    expect(result.candidates).toHaveLength(1);
  });

  it('throws on a non-2xx response', async () => {
    const fetchImpl = fakeFetch({ error: 'nope' }, 502);
    const parser = new AiLoopParser({ baseUrl: 'http://localhost:8787', fetchImpl });

    await expect(parser.analyze('text', at(2026, 9, 29, 18, 16))).rejects.toThrow();
  });

  it('parse() returns just the candidates', async () => {
    const fetchImpl = fakeFetch({ loops: [validWireLoop] });
    const parser = new AiLoopParser({ baseUrl: 'http://localhost:8787', fetchImpl });

    const candidates = await parser.parse('text', at(2026, 9, 29, 18, 16));

    expect(candidates).toHaveLength(1);
  });
});
