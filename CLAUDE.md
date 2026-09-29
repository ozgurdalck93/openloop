# OPENLOOP — working notes for Claude

OPENLOOP is a working title. It is a personal AI workflow / **unresolved-things assistant** (React Native + Expo SDK 57 + TypeScript + Expo Router + expo-sqlite + expo-notifications). Not a to-do app, not a calendar.

The product spec is the numbered files at the repo root — read `06_OPENLOOP_CLAUDE_CODE_MASTER_PROMPT.md` first, then `00`–`05` and `07`. They win over anything in this file.

## Commands

```bash
npm run typecheck   # tsc for everything, then tsc for app code only (no Node types)
npm test            # vitest — pure logic + real SQL via node:sqlite
npm run lint        # expo lint (ESLint + React Compiler rules)
npx expo start      # run the app (development build needed for full notification behaviour)
npm run e2e:web     # real Chrome + Expo Router web build + real (WASM) sqlite — see README "Runtime verification"
npx expo-doctor
```

`server/` (the AI parser backend) is a separate package, excluded from all of the above — `cd server && npm run typecheck && npm test`. See `server/README.md`.

Install Expo-managed packages with `npx expo install <pkg>`, never `npm i`. Before touching any Expo/RN API, check the SDK 57 docs (`https://docs.expo.dev/versions/v57.0.0/`) — APIs here differ from older releases. Run typecheck, lint and tests before calling work done.

## Layers (dependencies point downward only)

```
app/            Expo Router screens — thin; no business rules
src/components  UI atoms          src/theme   colors, type, spacing
src/store       React context / in-memory handoff between screens
src/notifications  index.ts talks to the OS; plan.ts + categories.ts are pure
src/db          Db interface (types.ts), migrations, repositories, apply.ts
src/engine      state machine — PURE (types, followUpPolicy, transitions, suggestions, sections)
src/parser      text → LoopCandidate[], behind the LoopParser interface. localParser.ts is PURE/deterministic;
                aiParser.ts + hybridParser.ts call out to server/ and fall back to local on failure
src/updates     natural-language updates to EXISTING loops — PURE (intent, match, interpret) + apply.ts (goes through LoopService)
src/services    LoopService — the one place any action (button, notification, typed update) turns into a stored transition
src/utils       time (local calendar), format, id
server/         separate Node/Express package: holds ANTHROPIC_API_KEY for the AI parser, nothing else. Own
                package.json/tsconfig/tests — excluded from root typecheck/lint. See server/README.md
```

- **The engine is pure.** Transitions take loops + `EngineContext {now, newId}` and return an `EngineResult` (created / updated / events). They never touch storage, the OS or the clock. `db/apply.ts` persists a result atomically; `notifications` re-syncs reminders from the loops it touched. Keep it that way — it is why the engine is testable and deterministic.
- **The local parser is pure and offline.** No network, no API key in the app, ever. `createParser()` (`parser/index.ts`) always returns it. An AI parser now plugs in behind the same `LoopParser` interface and returns the contract in `04_OPENLOOP_AI_OUTPUT_SCHEMA.json` (`parser/aiSchema.ts` validates it): `parser/aiParser.ts`'s `AiLoopParser` calls `server/` (a small Express backend that holds `ANTHROPIC_API_KEY` — never the app), and `parser/hybridParser.ts`'s `HybridLoopParser` wraps it with the local parser as a fallback on any failure, so `createHybridParser()` (what Capture actually uses) still works with no backend deployed. See `server/README.md`.
- **`src/updates` never touches a loop on its own.** `interpretInput(text, openLoops, now)` (pure) turns a typed sentence into `UpdateProposal`s — matched by scoring each candidate loop's entity/title/concept/context against the clause's words (`match.ts`), never by guessing. The hard rule: one loop clearly fits → still shown for the user to confirm; several fit about equally, or the words name nothing → the user chooses; the words name something no open loop matches → nothing changes, and it's reported (`unmatched`), never silently applied to the nearest-sounding loop. `apply.ts` carries out a confirmed proposal through the same `LoopService` every button uses, so it is transactional and lands in the timeline in the user's own words (`withSaid`).
- **`db/types.ts` has no native imports.** Repositories depend on the `Db` interface; `db/index.ts` adapts expo-sqlite; tests adapt `node:sqlite` (`test/nodeSqliteDb.ts`) so SQL is exercised for real.
- **Migrations are append-only** (`PRAGMA user_version`). Enum columns have no CHECK constraints on purpose; validate in `db/loops.ts`.
- **Time is local**, stored as UTC ISO strings. Tests build dates with `at(y, m, d, h, min)` from `test/fixtures.ts` (1-based month) so they don't depend on the machine's timezone.
- Path alias: `@/` → `src/`. TypeScript 6 no longer auto-includes `@types/*`; `tsconfig.json` lists `types: ["node"]` (tests), `tsconfig.app.json` uses `[]` so app code can't accidentally use Node APIs.
- **`scripts/web-runtime/`** is the closest thing to a device here (no emulator/simulator is available in this environment): it exports the app as Expo Router **web** and drives it with real Chrome + real `expo-sqlite` (WASM). See README → "Runtime verification" for what that does and does not prove.

## Parser notes

Matching runs on **folded** text (`fold()` in `parser/text.ts`: lowercase ASCII, Turkish diacritics stripped, length-preserving), so every index also addresses the original string and titles keep their real casing and letters. To support a new phrase, add a pattern to the right list in `parser/cues.ts` (or `datetime.ts` for time words) and a case to `localParser.test.ts`.

Deliberate behaviours worth knowing: "Maybe Friday." returns a *clarification*, never an invented loop; a past action's date ("emailed on Monday") is history, not a plan; "after payday" has no payday setting — it guesses the 1st of next month at low confidence (`timingConfidence` 0.35) and Review shows it as a *suggested* date the user can change, never a silent default baked into what gets saved.

## Product guardrails (from the spec)

- Tone: calm, brief, no guilt. Ignored reminders get "Still relevant?" — never "you missed…". `suggestions.test.ts` enforces this.
- Never autonomously send messages, purchase, contact people, modify third-party accounts, or delete user content (dismiss = archive).
- Out of scope for v0.1: calendar, Kanban, projects, streaks/scores, social, heavy dashboards, teams, background AI agent.
- Visual direction: warm off-white, dark ink, one restrained accent, generous whitespace, no neon / AI-purple / glassmorphism.
