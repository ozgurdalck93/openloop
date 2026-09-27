# OPENLOOP — Claude Code Master Build Prompt

You are building a real mobile application named OPENLOOP.
OPENLOOP is a **working title only**.

Do not build a generic to-do app.

## Product definition

OPENLOOP is a personal AI workflow / unresolved-things assistant.

Users describe situations naturally:
- “I emailed HR and I’m waiting for a reply.”
- “I returned the package but the refund hasn’t arrived.”
- “Tomorrow afternoon remind me to call the dentist.”
- “I want to look at this jacket again after payday.”

The app identifies what remains unresolved and tracks it until closure.

## Required stack

- React Native
- Expo
- TypeScript
- Expo Router
- expo-notifications
- expo-sqlite

Use:
`npx expo install`
for Expo-managed packages.

Do not make a ZIP.
Work directly in project files.

## Supported loop types

- task
- waiting
- event
- promise
- return_later
- reference

## Supported statuses

- draft
- active
- waiting
- scheduled
- snoozed
- resolved
- archived

## Ownership

- user
- other
- system
- none

## Core MVP flow

1. Home / Open Loops
2. Capture natural-language text
3. Parse into 1..N candidates
4. Review/edit
5. Confirm
6. Store in SQLite
7. Schedule notifications where relevant
8. Resurface unresolved loops
9. Resolve/snooze/follow-up
10. TASK → WAITING transition
11. Store loop timeline events

## Required architecture

app/
  _layout.tsx
  index.tsx
  capture.tsx
  review.tsx
  loop/[id].tsx

src/
  db/
    index.ts
    migrations.ts
    loops.ts
    captures.ts
    events.ts
  parser/
    types.ts
    localParser.ts
    index.ts
  engine/
    types.ts
    transitions.ts
    followUpPolicy.ts
    suggestions.ts
  notifications/
    index.ts
    categories.ts
  components/
  theme/
  store/
  utils/

## Database

### captures
- id TEXT PRIMARY KEY
- raw_text TEXT NOT NULL
- created_at TEXT NOT NULL

### loops
- id TEXT PRIMARY KEY
- capture_id TEXT
- type TEXT NOT NULL
- status TEXT NOT NULL
- title TEXT NOT NULL
- raw_context TEXT
- next_action_owner TEXT
- entity_name TEXT
- expected_event TEXT
- next_review_at TEXT
- closing_condition TEXT
- follow_up_policy TEXT
- classification_confidence REAL
- timing_confidence REAL
- entity_confidence REAL
- parent_loop_id TEXT
- notification_id TEXT
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL
- resolved_at TEXT

### loop_events
- id TEXT PRIMARY KEY
- loop_id TEXT NOT NULL
- event_type TEXT NOT NULL
- note TEXT
- created_at TEXT NOT NULL

## Parser

Create interface:

`LoopParser.parse(text, now): Promise<LoopCandidate[]>`

v0.1 must work without an AI backend.

Build a deterministic local parser first.

Support common Turkish phrases:
- bugün
- yarın
- yarın sabah
- öğleden sonra
- bu akşam
- cuma / pazartesi etc.
- bu hafta
- cevap bekliyorum
- geri dönecek
- gönderecek
- iade ettim
- para yatmadı
- maaştan sonra
- sonra bakarım
- söz verdim
- unutmamam lazım

Support English equivalents:
- today
- tomorrow
- tonight
- Friday
- this week
- waiting for
- get back to me
- refund hasn’t arrived
- after payday
- I promised
- remind me later

Keep parser behind an interface so it can later be replaced or augmented by an AI service.

Do not ship a private API key in the app.

## Core transition

### TASK -> WAITING

When user completes a task:
show bottom sheet:

“Does this end here?”
- Yes, done
- I’m waiting for something

Second option:
create linked WAITING loop.

### WAITING review

Notification/screen:
“Still waiting for X?”

Actions:
- Still waiting
- Got it
- Follow up

Follow up:
create linked TASK.

### RETURN_LATER

On resurfacing:
- Act now
- Bring back later
- Resolve

## Home

Title:
Open Loops

Summary:
“2 need you · 3 are waiting · 1 is coming up”

Sections:
- Needs you
- Waiting
- Coming up
- Bring back later

CTA:
“Tell me what’s going on”

## Design

Calm, premium, minimal, human.

Avoid:
- neon gradients
- AI-purple
- heavy glassmorphism
- dense dashboards
- gamification
- productivity scores
- giant card grids

Prefer:
- warm off-white
- dark ink typography
- restrained natural accent
- generous whitespace
- subtle rounded corners
- native-feeling controls

## Notification categories

TASK:
- Done
- 15 min later
- Later today

WAITING:
- Still waiting
- Got a reply
- Follow up

RETURN_LATER:
- Keep for later
- Act now
- Resolve

EVENT:
- View
- Later

## First build acceptance test

Input:
“I emailed HR and I’m waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn’t arrived.”

Expected candidates:
1. WAITING — HR reply
2. TASK — Call dentist — tomorrow around 15:00
3. WAITING — Zara refund

Must work:
- confirm,
- persist,
- restart,
- notifications,
- resolve,
- snooze,
- follow-up,
- TASK → WAITING,
- timeline update.

## Build sequence

1. inspect repo
2. initialize Expo if needed
3. theme
4. SQLite + migrations
5. domain types
6. repositories
7. deterministic parser
8. loop engine
9. capture
10. review
11. home
12. loop detail
13. notification actions
14. transitions
15. tests
16. polish

After every phase:
- run TypeScript checks,
- fix errors before continuing,
- keep modules small,
- do not place the entire application in App.tsx.

### Start now

Implement phases 1–8 first.

Do not stop at a plan.
Create the actual files and working foundation.

At the end, report:
- file tree,
- what works,
- commands to run,
- remaining blockers.
