# OPENLOOP parser server

The backend the AI-backed loop parser talks to. It exists for one reason:
`CLAUDE.md` and `06_OPENLOOP_CLAUDE_CODE_MASTER_PROMPT.md` both say never to
ship a private API key inside the app. This is the "backend you control" —
it holds `ANTHROPIC_API_KEY`, the app only ever holds this server's URL.

It does one thing: `POST /v1/parse` takes capture text and returns loop
candidates in the exact wire shape `src/parser/aiSchema.ts` already validates
(`04_OPENLOOP_AI_OUTPUT_SCHEMA.json`). It has no database and no other state.

## Run locally

```bash
cd server
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
npm run dev             # http://localhost:8787
```

Point the app at it by setting `EXPO_PUBLIC_AI_PARSER_URL=http://localhost:8787`
in a `.env` file at the repo root (see `.env.example` there), then restart
`npx expo start`. On a physical device or simulator, `localhost` won't reach
your machine — use your LAN IP instead (`http://192.168.x.x:8787`).

Without that env var set, the app runs local-parser-only, same as always —
see "How the app uses this" below.

## API

`POST /v1/parse`

```json
{ "text": "HR said they'd reply this week, and I need to call the dentist tomorrow", "now": "2026-09-29T18:00:00+03:00", "locale": "en-US" }
```

- `now` must be ISO-8601 **with an explicit UTC offset** (not `Z`) — it's how
  the model reasons in the user's local calendar. `src/utils/time.ts`'s
  `toLocalIsoWithOffset` produces this on the client.
- Response: `{ "loops": [...] }`, one entry per loop found, shaped exactly
  like `04_OPENLOOP_AI_OUTPUT_SCHEMA.json`. Can be `{ "loops": [] }`.
- `401` if `CLIENT_SHARED_SECRET` is set on the server and the request didn't
  send a matching `x-openloop-client-key` header.
- `400` on a malformed request, `429` on an upstream rate limit, `502` if
  Claude refused or returned something that didn't validate.

## How the app uses this

`src/parser/aiParser.ts` (`AiLoopParser`) calls this endpoint.
`src/parser/hybridParser.ts` (`HybridLoopParser`) wraps it with the existing
offline `LocalLoopParser` as a fallback — any failure here (unreachable,
timeout, bad response) silently falls back to local parsing, so the app never
hard-depends on this service being up. `createHybridParser` in
`src/parser/index.ts` wires the two together from `EXPO_PUBLIC_AI_PARSER_URL`.

## Deploying

Not deployed anywhere yet. It's a plain stateless Express app — any
Node host that reads `.env`/environment variables (Fly.io, Render, a small
VPS, etc.) works; set `ANTHROPIC_API_KEY` and optionally `CLIENT_SHARED_SECRET`
there, then point `EXPO_PUBLIC_AI_PARSER_URL` (and matching
`EXPO_PUBLIC_AI_PARSER_CLIENT_KEY`) at the deployed URL.

## Scripts

```bash
npm run dev         # tsx watch — local dev
npm run typecheck   # tsc --noEmit
npm test            # vitest — schema validation only, no network calls
npm run build        # tsc -> dist/
npm start            # node dist/index.js
```

This package is intentionally separate from the root `package.json` — it's
Node/Express, not Expo/React Native, and the root `npm run typecheck` /
`npm run lint` / `npm test` deliberately exclude it (see the root
`tsconfig.json` `exclude` and `eslint.config.js` `ignores`).
