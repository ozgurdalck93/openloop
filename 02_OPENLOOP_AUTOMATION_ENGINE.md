# OPENLOOP — Automation / State Engine

## Loop types

- task
- waiting
- event
- promise
- return_later
- reference

## Statuses

- draft
- active
- waiting
- scheduled
- snoozed
- resolved
- archived

## Next-action ownership

- user
- other
- system
- none

Examples:
- “Call dentist” → user
- “Waiting for HR” → other
- “Results publish Friday” → system
- “M fits better than XS” → none

## Required fields

Every loop may include:

- id
- type
- status
- title
- raw_context
- next_action_owner
- entity_name
- expected_event
- next_review_at
- closing_condition
- follow_up_policy
- classification_confidence
- timing_confidence
- entity_confidence
- parent_loop_id
- notification_id
- created_at
- updated_at
- resolved_at

## Closing conditions

TASK:
- user confirms action completed

WAITING:
- user confirms expected response/outcome arrived

EVENT:
- event occurred and was acknowledged

PROMISE:
- commitment fulfilled

RETURN_LATER:
- user acts, dismisses, or reschedules

REFERENCE:
- no closing condition required

## Core transitions

### TASK → WAITING

Example:
“Send documents to HR.”

After user marks Done:
**Does this end here?**
- Yes, done
- I’m waiting for something

Second option creates linked WAITING loop.

### WAITING → FOLLOW-UP TASK

At review:
“Still waiting for HR?”

Actions:
- Still waiting
- Got a reply
- Follow up

Follow up creates linked TASK:
“Follow up with HR”

### FOLLOW-UP TASK → WAITING

When the follow-up message/call is completed:
return the parent loop to WAITING.

### EVENT → TASK

Example:
“Results should be available today.”

When surfaced:
- View result
- Later

“View result” may become a TASK.

### RETURN_LATER → TASK

When resurfaced:
- Act now
- Bring back later
- Resolve

## Suggested follow-up policy

TASK:
- exact user time when available,
- otherwise suggested context time,
- one soft follow-up if ignored.

WAITING:
- work reply: 1–2 business days suggested,
- casual reply: ~48h,
- refund/admin: 3–5 business days,
- explicit expected date always wins.

EVENT:
- at expected date/time,
- optionally create action after event.

PROMISE:
- remind before commitment risks becoming late.

RETURN_LATER:
- use contextual milestone when possible:
  - after payday,
  - weekend,
  - next month,
  - given season/date.

REFERENCE:
- no notification.

All suggestions remain editable.

## Natural-language status updates

Supported examples:
- “still no reply”
- “they sent it”
- “refund came”
- “move this to Friday”
- “remind me next month instead”
- “done”
- “not relevant anymore”

If confidence is high, update the likely loop.
If confidence is low, show a confirmation choice instead of guessing.

## Safety / control

v0.1 may suggest actions, but must not autonomously:
- send messages,
- purchase things,
- modify third-party accounts,
- contact people,
- delete user content.
