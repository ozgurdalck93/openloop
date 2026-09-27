# OPENLOOP — Acceptance Scenarios

These examples are product tests, not marketing copy.

## Scenario 1 — Multiple loop types

Input:
“I emailed HR and I’m waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn’t arrived.”

Expected:
1. WAITING — HR reply
2. TASK — Call dentist — tomorrow around 15:00
3. WAITING — Zara refund

The user confirms all three.
All persist after restart.

---

## Scenario 2 — Completed action creates a waiting loop

Input:
“Send the application documents.”

User completes task.

App:
“Does this end here?”

User:
“I’m waiting for a reply.”

Expected:
- TASK becomes resolved.
- linked WAITING loop is created.
- timeline links both events.

---

## Scenario 3 — Waiting loop gets follow-up

Existing loop:
WAITING — Ticket company reply

Review notification:
“Still waiting for the ticket company?”

User selects:
Follow up

Expected:
- linked TASK created:
  “Follow up with ticket company”
- parent WAITING loop remains traceable.

---

## Scenario 4 — Refund closes automatically via status update

Existing:
WAITING — Zara refund

User says:
“Refund came.”

Expected:
- app identifies Zara refund as likely target,
- asks confirmation if ambiguity exists,
- resolves loop,
- records timeline event.

---

## Scenario 5 — Future-self note

Input:
“I like the brown jacket but M fit better than XS. Bring this back after payday.”

Expected:
Type: RETURN_LATER
Title: Reconsider brown jacket
Context includes: M fit better than XS
Review time: after payday or suggested date

When resurfaced, context is visible.

---

## Scenario 6 — Promise

Input:
“I told Ozan I’d send him the link tonight.”

Expected:
Type: PROMISE
Owner: user
Entity: Ozan
Review: tonight
Closing condition: link sent

---

## Scenario 7 — Reference only

Input:
“My passport number is in the blue folder.”

Expected:
REFERENCE
No notification by default.

---

## Scenario 8 — Low-confidence ambiguity

Input:
“Maybe Friday.”

Expected:
Do not invent a task.
Either:
- attach to recent loop if context is strong, or
- ask the user to confirm what Friday refers to.

---

## Scenario 9 — Natural-language reschedule

User:
“Move the dentist one to Friday afternoon.”

Expected:
Target correct dentist loop.
Change next review/due time.
Do not create duplicate.

---

## Scenario 10 — Ignore-guilt rule

If user ignores a reminder:
Do not show language like:
“You failed”
“You missed another task”
“You’re falling behind”

Use:
“Still relevant?”
or
“Want this brought back later?”
