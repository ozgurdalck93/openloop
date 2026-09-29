# OPENLOOP

> Working title — not the App Store name.

**Your unfinished-things assistant.** Tell it, in messy natural language, what's going on. It works out what is still unresolved, who owns the next move, when it should come back, and what would close it — then follows through until the loop is closed.

```
Capture → Understand → Follow through → Close the loop
```

Product spec: the numbered `00`–`07` files in this folder. Working notes for contributors and Claude: [CLAUDE.md](CLAUDE.md).

## Run it

```bash
npm install
npm run typecheck && npm run lint && npm test
npx expo start        # then open in Expo Go or a development build
npm run e2e:web        # real-Chrome runtime pass — see "Runtime verification" below
```

The tests use Node's built-in `node:sqlite` (Node 22.13+; developed on Node 24). Local reminders work in Expo Go; notification **action buttons** need a development build (`expo-notifications` categories are not delivered inside Expo Go).

## Status

Every phase in `06_OPENLOOP_CLAUDE_CODE_MASTER_PROMPT.md` is implemented: capture, editable Review, Home, loop detail with per-type actions, the TASK → WAITING "Does this end here?" flow, notification categories/actions, and natural-language updates to existing loops. 571 tests pass (pure logic + real SQL via `node:sqlite`); `npm run typecheck` and `npm run lint` are clean. (`server/` — the AI parser backend — is a separate package with its own 11 tests; see `server/README.md`.)

| Area | State |
|---|---|
| Parser (English + Turkish, offline) | done |
| Engine (state machine, pure) | done |
| Database (SQLite, append-only migrations) | done, tested against real SQL |
| Capture → Review (editable, validated) | done |
| Home | done |
| Loop detail — per-type actions | done |
| TASK → WAITING sheet ("Does this end here?") | done |
| UI language (English/Turkish) | done — follows the device locale, with an EN/TR switch on Home; see "known limitation" below |
| Notifications — categories, planning, scheduling, response handling | done at the service level; **native delivery and action buttons not run on a device** (see below) |
| Natural-language updates to existing loops | done |
| Voice capture | built — on-device speech-to-text feeds the same editable Capture input; requires a development build and microphone permission |
| AI parser | built — `AiLoopParser` + `HybridLoopParser` (`src/parser/`) call a small backend (`server/`) that holds the Anthropic key; the app falls back to the local parser on any failure. **Not verified against a real deployed server or real Claude output** — only against mocked responses; see `server/README.md` |

### What works today

- Type a paragraph in English or Turkish → 1..N loops (`task`, `waiting`, `event`, `promise`, `return_later`, `reference`) with title, owner, entity, suggested review time and closing condition.
- Review: every field is editable (type, title, person/company, date, time, note); doubts the parser has ("Not sure about the timing") are shown until the field is touched; a candidate can be removed; nothing invalid can be saved.
- Loop detail: every type's actions (TASK: Done · 15 min later · Later today · Edit; WAITING: Still waiting · Got a reply · Follow up · Remind me later; RETURN_LATER: Act now · Bring back later · Resolve; EVENT: View · Done · Later; PROMISE: Fulfilled · Remind me later) go through one `LoopService`, so no transition logic is duplicated in the UI.
- Finishing a TASK asks "Does this end here?" — "Yes, done" resolves it; "I'm waiting for something" opens an editable form (entity, expected response, review time) and creates a linked WAITING loop. However that WAITING loop's own follow-up ends (resolved, dismissed, or completed as a task), the original loop returns to WAITING — it never vanishes.
- Typing about something you already have updates it instead of creating a duplicate: "Refund came", "para geldi", "still no reply", "hala cevap yok" match the right loop and propose an update ("Zara refund resolved? [Confirm] [Choose another]"); several equally-likely loops make the app ask which one; words that name nothing ("they sent it", "next month instead") let the user choose from what's open; something specific that matches no open loop changes **nothing** and says so. New capture and updates can be typed in the same breath — the update clauses are matched, the rest goes through the normal parser.
- The full acceptance pass (capture three loops → Review → Home sections → restart → per-type actions → follow-ups → natural-language update) runs end to end in a real browser against real SQLite — see below.
- Capture can optionally go through an AI parser instead of (well, in front of) the local one: `server/` is a small Express backend that holds `ANTHROPIC_API_KEY` and returns loop candidates in the same wire shape the local parser already speaks; `src/parser/hybridParser.ts` tries it first and silently falls back to the local parser on any failure, so the app never hard-depends on it being up. Off by default — set `EXPO_PUBLIC_AI_PARSER_URL` to turn it on. See `server/README.md`.
- **Browse** is the app's memory: search all loops by title, note, person or company; tap a person/company to see its related open and closed loops; inspect completed history and saved reference notes. Reference notes remain quiet on Home but are no longer hidden.
- A calm **Today** line on Home gives a short count-based check-in without urgency or guilt.
- **Follow up** now starts with an editable message draft. It never sends anything: choosing “Add follow-up to my list” only creates the linked task, and keeps the draft in that task's context for the user to use when ready.

## Runtime verification

There is no Android emulator, no iOS simulator, and (Windows, no Mac) no way to run an iOS build at all in this environment; disk space here is also very tight. Two things stand in for a device:

1. **`npm run e2e:web`** (`scripts/web-runtime/`) exports the app as an Expo Router **web** build and drives it with real Chrome (via `puppeteer-core`) at a phone-sized viewport. This is a real React tree, real Expo Router, real state — and a real `expo-sqlite` code path (`wa-sqlite`/WebAssembly, persisted in the browser profile, survives a page reload the same way a restart would). It is **not** native: no native modules, no OS notifications. Fifteen flows run in it today, covering every phase above, including two full restarts (Phase A) and the whole acceptance pass (Flows 1–4). Screenshots are written to `<run dir>/shots`.
2. **Unit/integration tests** (`npm test`) exercise the notification **plan**, **categories**, and **response handling** (`src/notifications/*.test.ts`) against a fake OS — the same code path a real device runs, minus the OS itself.

**Not verified on a device, and this needs checking on a phone before shipping:**
- Native `expo-sqlite` (native web tests only exercise the WASM build).
- Actual OS notification delivery, and — most importantly — **notification action buttons** (Done / 15 min later / Still waiting / Got a reply / Follow up, etc.) reaching `useNotificationResponses` and updating the right loop. This is Acceptance Flow 5; it cannot run in a browser.
- Background/killed-app notification scheduling and delivery.
- `npx expo-doctor` and a native (Android/iOS) bundle export were not run in this pass, to avoid risking further disk pressure; both are quick to run once there's headroom.
- **The AI parser has never called the real Claude API.** `server/` typechecks, its schema-validation tests pass, and `src/parser/aiParser.test.ts` / `hybridParser.test.ts` pass against mocked HTTP responses — but nobody has run `server/npm run dev` with a real `ANTHROPIC_API_KEY` and sent it real capture text yet. Do that (and sanity-check a few English + Turkish captures against `04_OPENLOOP_AI_OUTPUT_SCHEMA.json` expectations) before relying on it.

## Decisions made this pass

- **Payday** has no setting. "After payday" is shown in Review as a **suggested** date the user can change; there is no fixed "the 1st" assumption baked into what gets saved.
- **REFERENCE loops** are stored but appear on no Home section, per the UX spec — they need a future home (a "Remembered"/search screen); this pass confirmed the behaviour and added a regression test for it.
- **A notification's "Done" opens the app** (so "Does this end here?" can be asked); the other quick actions (snooze, still waiting, got a reply, follow up) resolve in the background.
- **Numeric dates are locale-aware**: `12/10` reads as 12 October under a Turkish/European locale and as December 10 under `en-US`, from the device locale — not a fixed assumption.
- **UI language**: every screen, sheet, notification and flash message is bilingual (`src/i18n`), read through `useLanguage()` (`src/store/language.tsx`) — the device locale by default, or an EN/TR override the user picks on Home, stored in a `settings` table (migration v2) so it survives a restart. Known limitation: `src/engine/transitions.ts`'s stored timeline notes and a few auto-generated loop titles (e.g. "Follow up with X", "Response to: X") are English-only for now — they are edited defaults, not fixed labels, and translating them was cut from this pass for scope.
