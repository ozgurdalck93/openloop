import 'dotenv/config';

import Anthropic from '@anthropic-ai/sdk';
import cors from 'cors';
import express from 'express';

import { AiParseError, parseCapture } from './anthropic.js';
import { parseRequestSchema } from './schema.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '64kb' }));

const clientSecret = process.env.CLIENT_SHARED_SECRET;

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/v1/parse', async (req, res) => {
  if (clientSecret && req.header('x-openloop-client-key') !== clientSecret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const parsedBody = parseRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: 'invalid request', details: parsedBody.error.flatten() });
    return;
  }
  const { text, now, locale } = parsedBody.data;

  try {
    const result = await parseCapture(text, now, locale ?? null);
    res.json(result);
  } catch (err) {
    if (err instanceof AiParseError) {
      res.status(502).json({ error: err.message });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'rate limited, try again shortly' });
    } else if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: `upstream error: ${err.message}` });
    } else {
      console.error('[parse] unexpected error', err);
      res.status(500).json({ error: 'internal error' });
    }
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`OPENLOOP parser server listening on :${port}`);
});
