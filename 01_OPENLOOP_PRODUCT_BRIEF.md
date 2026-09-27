# OPENLOOP — Product Brief v2

## Product category
Personal AI workflow / unresolved-things assistant.

Not:
- a normal reminder app,
- a generic to-do list,
- a calendar replacement,
- a chatbot with a task list attached.

## Core promise

**You don't need to keep unfinished things in your head.**

The user describes life naturally:

- “I emailed HR and I’m waiting for a reply.”
- “I returned the package but the refund hasn’t arrived.”
- “Ayşe said she’d send the file.”
- “Tomorrow afternoon remind me to call the dentist.”
- “I like this jacket, but I’ll look again after payday.”
- “The test result comes out Friday.”
- “I told Ozan I’d send him the link.”

OPENLOOP determines:
1. what happened,
2. what is still unresolved,
3. who owns the next action,
4. when it should resurface,
5. what would close the loop.

## Core object: a Loop

Every captured thought becomes one or more of:

### TASK
The user needs to do something.

Example:
“Call the dentist tomorrow.”

### WAITING
The next move belongs to someone/something else.

Example:
“HR said they’ll reply.”

### EVENT
Something should happen at a known or estimated future time.

Example:
“My results come out Friday.”

### PROMISE
The user committed something to another person.

Example:
“I told Ozan I’d send the link.”

### RETURN_LATER
Nothing needs doing now, but the thought should come back at a better time.

Example:
“I want this coat, but I’ll reconsider after payday.”

### REFERENCE
Useful context that should be remembered, but does not need a reminder by default.

Example:
“M fit better than XS.”

## Why this is different

Most productivity apps require the user to manage the system.

OPENLOOP manages the unresolved state.

A normal task app sees:
“Return package” → Done.

OPENLOOP can continue:
“Package returned” → Waiting for refund → Refund received → Loop closed.

A normal reminder app sees:
“Email HR” → Done.

OPENLOOP can continue:
“Email sent” → Waiting for reply → Follow up if needed → Response received → Loop closed.

That transition behavior is the product.

## MVP v0.1

Must support:
- natural-language capture,
- multiple loop extraction from one input,
- loop classification,
- suggested next-review time,
- review/edit before saving,
- local persistence,
- notifications,
- snooze,
- resolve,
- “still waiting”,
- follow-up creation,
- TASK → WAITING transition,
- simple timeline per loop.

## Do not build yet

No:
- full calendar,
- projects/folders,
- Kanban,
- habits/streaks,
- productivity scoring,
- teams,
- autonomous email sending,
- autonomous purchases,
- banking integrations,
- contacts sync,
- background AI agent.

## Positioning

Preferred:
**Your unfinished-things assistant.**

Alternative:
**The app that remembers what’s still unresolved.**

Product loop:
**Capture → Understand → Follow through → Close the loop**
