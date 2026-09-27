// PHASES C–E and the acceptance pass (G). These run in a FRESH profile and depend on each
// other in order — exactly like one user's first session. Notification buttons (flow 5) cannot
// run in a browser; they are covered by src/notifications/responses.test.ts and must be tried on
// a device (see README → Runtime verification).
import assert from 'node:assert/strict';

import {
  FLOW_1_TEXT,
  actionLabels,
  captureText,
  detailTitleText,
  doAction,
  flashText,
  goHome,
  has,
  hasNot,
  homeSection,
  openLoop,
  testId,
} from './helpers.mjs';

export const acceptance = {
  // Flow 1 — capture three loops, confirm, see them on Home in the right sections, restart.
  async 'g-flow-1'(app) {
    await app.see('Open Loops');
    await captureText(app, FLOW_1_TEXT);
    await app.see('Here’s what’s still open');
    assert.deepEqual(await app.values('title-'), ['HR reply', 'Call dentist', 'Zara refund']);
    await app.shot('g1-review');
    await app.tap('Keep track of these');
    await app.see('NEEDS YOU');

    has(await app.text(), '1 needs you · 2 are waiting');
    const needs = await homeSection(app, 'needs_you');
    const waiting = await homeSection(app, 'waiting');
    has(needs, 'Call dentist', 'the dentist call belongs under NEEDS YOU');
    has(waiting, 'HR reply', 'HR belongs under WAITING');
    has(waiting, 'Zara refund', 'the Zara refund belongs under WAITING');
    hasNot(needs, 'HR reply');
    await app.shot('g1-home');

    await app.reload(); // restart the app
    await app.see('NEEDS YOU');
    const again = await app.text();
    for (const title of ['HR reply', 'Call dentist', 'Zara refund']) has(again, title, `"${title}" did not survive the restart`);
    has(again, '1 needs you · 2 are waiting');
  },

  // Flow 2 — finishing a TASK asks "Does this end here?"; "I'm waiting" creates a linked WAITING loop.
  async 'g-flow-2'(app) {
    await goHome(app);
    await openLoop(app, 'Call dentist');
    assert.deepEqual(await actionLabels(app), ['Done', '15 min later', 'Later today', 'Edit', 'Not relevant anymore']);
    await app.shot('g2-task-detail');

    await doAction(app, 'done', false);
    await app.see('Does this end here?');
    has(await app.text(), 'Yes, done');
    has(await app.text(), 'I’m waiting for something');
    await app.shot('g2-done-sheet');

    // the sheet has changed nothing yet: dismiss it (scrim) and the task is still open
    await app.click(testId('done-sheet-backdrop'));
    await app.gone('Does this end here?');
    has(await app.text(), 'Needs you');

    await doAction(app, 'done', false);
    await app.click(testId('done-waiting'));
    await app.see('What are you waiting for?');
    // pre-filled from the task; the user corrects who, what and when
    assert.equal(await app.value(testId('waiting-expected')), 'reply');
    await app.type(testId('waiting-entity'), 'Dr. Yilmaz');
    await app.type(testId('waiting-expected'), 'callback');
    const dayBefore = await app.value(testId('waiting-when-day-value'));
    await app.click(testId('waiting-when-day-next'));
    assert.notEqual(await app.value(testId('waiting-when-day-value')), dayBefore);
    await app.shot('g2-waiting-form');
    await app.click(testId('waiting-start'));

    // we land on the NEW waiting loop, linked back to the finished task
    await app.see('Dr. Yilmaz callback');
    await app.waitFor(testId('linked'));
    const detail = await app.text();
    has(detail, 'Waiting on Dr. Yilmaz');
    has(detail, 'From: Call dentist');
    has(detail, 'Resolved');
    for (const label of ['Created', 'Action completed', 'Waiting started', 'Next review scheduled']) has(detail, label);
    await app.shot('g2-new-waiting');

    // the finished task's own timeline points forward
    await app.tap('From: Call dentist');
    await app.see('Action completed');
    const task = await app.text();
    for (const label of ['Action completed', 'Waiting started']) has(task, label);
    has(task, 'Dr. Yilmaz callback');
    assert.deepEqual(await actionLabels(app), [], 'a closed loop offers no actions');

    await goHome(app);
    const home = await app.text();
    has(home, '3 are waiting');
    hasNot(home, 'NEEDS YOU', 'nothing needs the user any more');
    has(await homeSection(app, 'waiting'), 'Dr. Yilmaz callback');
  },

  // Flow 3 — Follow up creates a linked TASK; completing it puts the loop back to WAITING.
  async 'g-flow-3'(app) {
    await goHome(app);
    await openLoop(app, 'HR reply');
    assert.deepEqual(await actionLabels(app), ['Still waiting', 'Got a reply', 'Follow up', 'Remind me later', 'Edit', 'Not relevant anymore']);
    await doAction(app, 'follow_up', false);

    await app.see('From: HR reply');
    assert.equal(await detailTitleText(app), 'Follow up with HR');
    assert.equal(await flashText(app), 'Follow-up added');
    await app.shot('g3-followup-task');

    await goHome(app);
    has(await homeSection(app, 'needs_you'), 'Follow up with HR');
    hasNot(await homeSection(app, 'waiting'), 'HR reply', 'the waiting loop steps aside while its follow-up is open');

    // finishing a follow-up does NOT ask "does this end here?": the parent goes straight back on watch
    await openLoop(app, 'Follow up with HR');
    await doAction(app, 'done', true);
    assert.equal(await flashText(app), 'Back to waiting on HR');
    await app.shot('g3-back-to-waiting');
    assert.equal(await app.exists(testId('done-sheet')), false, 'no question for a follow-up');
    has(await homeSection(app, 'waiting'), 'HR reply');
    assert.equal(await app.exists(testId('section-needs_you')), false);

    // and the parent remembers the whole story
    await openLoop(app, 'HR reply');
    const detail = await app.text();
    for (const label of ['Follow-up started', 'Follow-up done', 'Waiting started']) has(detail, label);
    has(detail, 'Follow up with HR');
    await app.shot('g3-hr-timeline');
  },

  // PHASE C — TASK: Done · 15 min later · Later today · Edit (with validation).
  async 'c-task-actions'(app) {
    await goHome(app);
    await captureText(app, 'Call the bank tomorrow at 3pm');
    await app.see('Here’s what’s still open');
    await app.tap('Keep track of these');
    await app.see('Call bank');
    await openLoop(app, 'Call bank');
    assert.deepEqual(await actionLabels(app), ['Done', '15 min later', 'Later today', 'Edit', 'Not relevant anymore']);

    await doAction(app, 'snooze_15');
    assert.equal(await flashText(app), 'Back in 15 minutes');
    has(await homeSection(app, 'bring_back_later'), 'Call bank'); // parked until it comes back

    await openLoop(app, 'Call bank');
    has(await app.text(), 'Snoozed');
    await doAction(app, 'later_today');
    assert.match(await flashText(app), /^Snoozed until /);

    // Edit: validation first — a blank title and a time in the past cannot be saved
    await openLoop(app, 'Call bank');
    await doAction(app, 'edit', false);
    await app.see('Edit');
    await app.type(testId('edit-title'), '');
    await app.see('Give it a title');
    assert.equal(await app.page.$eval(testId('edit-save'), (el) => el.getAttribute('aria-disabled')), 'true');
    await app.type(testId('edit-title'), 'Call the bank about the card');
    for (let i = 0; i < 4; i += 1) await app.click(testId('edit-when-day-prev'));
    await app.see('That time has already passed');
    assert.equal(await app.page.$eval(testId('edit-save'), (el) => el.getAttribute('aria-disabled')), 'true');
    for (let i = 0; i < 6; i += 1) await app.click(testId('edit-when-day-next'));
    await app.type(testId('edit-entity'), 'Garanti');
    await app.type(testId('edit-note'), 'the card is blocked');
    await app.shot('c1-edit-sheet');
    await app.click(testId('edit-save'));
    await app.see('Open Loops');
    assert.equal(await flashText(app), 'Saved');

    await app.tap('Call the bank about the card');
    await app.see('TIMELINE');
    const detail = await app.text();
    has(detail, 'Garanti');
    has(detail, 'the card is blocked');
    has(detail, 'Edited');
    has(detail, 'Time changed');

    // Done → "Does this end here?" → Yes
    await doAction(app, 'done', false);
    await app.see('Does this end here?');
    await app.click(testId('done-yes'));
    await app.see('Open Loops');
    assert.equal(await flashText(app), 'Done');
    hasNot(await app.text(), 'Call the bank about the card');
  },

  // PHASE C — WAITING: Still waiting · Got a reply · Follow up · Remind me later.
  async 'c-waiting-actions'(app) {
    await goHome(app);
    await captureText(app, "I'm waiting for a reply from Acme");
    await app.see('Here’s what’s still open');
    await app.tap('Keep track of these');
    await app.see('Acme reply');

    await openLoop(app, 'Acme reply');
    await doAction(app, 'still_waiting');
    assert.match(await flashText(app), /^Still waiting — I’ll ask again /);
    has(await homeSection(app, 'waiting'), 'Acme reply');

    await openLoop(app, 'Acme reply');
    await doAction(app, 'remind_later', false);
    await app.see('Remind me…');
    await app.shot('c2-snooze-sheet');
    await app.click(testId('snooze-tomorrow_morning'));
    await app.see('Open Loops');
    assert.match(await flashText(app), /^Snoozed until Tomorrow · 09:00$/);
    has(await homeSection(app, 'waiting'), 'Acme reply'); // snoozed, but still something we wait on

    await openLoop(app, 'Acme reply');
    await doAction(app, 'got_reply');
    assert.equal(await flashText(app), 'Got it — resolved');
    hasNot(await app.text(), 'Acme reply');
  },

  // PHASE C — PROMISE, EVENT and RETURN_LATER.
  async 'c-other-types'(app) {
    await goHome(app);

    // PROMISE: Fulfilled · Remind me later
    await captureText(app, "I told Mira I'd call her tonight.");
    await app.see('Here’s what’s still open');
    await app.tap('Keep track of these');
    await app.see('Call Mira');
    await openLoop(app, 'Call Mira');
    assert.deepEqual(await actionLabels(app), ['Fulfilled', 'Remind me later', 'Edit', 'Not relevant anymore']);
    await doAction(app, 'fulfilled');
    assert.equal(await flashText(app), 'Marked as kept');
    hasNot(await app.text(), 'Call Mira');

    // EVENT: View · Done · Later — View turns it into a task
    await captureText(app, 'The test result comes out Friday.');
    await app.see('Here’s what’s still open');
    await app.tap('Keep track of these');
    await app.see('COMING UP');
    await openLoop(app, 'Test result');
    assert.deepEqual(await actionLabels(app), ['View', 'Done', 'Later', 'Edit', 'Not relevant anymore']);
    await doAction(app, 'view', false);
    await app.see('From: Test result');
    assert.equal(await flashText(app), 'Added a task to check it');
    has(await app.text(), 'Check test result');

    // RETURN_LATER: Act now · Bring back later · Resolve — the reason comes back with the item
    await goHome(app);
    await captureText(app, 'I like the green coat but the sleeves run short. Bring this back after payday.');
    await app.see('Here’s what’s still open');
    await app.tap('Keep track of these');
    await app.see('BRING BACK LATER');
    await openLoop(app, 'Reconsider green coat');
    assert.deepEqual(await actionLabels(app), ['Act now', 'Bring back later', 'Resolve', 'Edit', 'Not relevant anymore']);
    await doAction(app, 'bring_back_later', false);
    await app.see('Bring this back…');
    await app.click(testId('snooze-custom'));
    await app.click(testId('snooze-when-day-next'));
    await app.click(testId('snooze-custom-set'));
    await app.see('Open Loops');
    assert.match(await flashText(app), /^Snoozed until /);
    await openLoop(app, 'Reconsider green coat');
    await doAction(app, 'act_now', false);
    await app.see('From: Reconsider green coat');
    has(await app.text(), 'the sleeves run short'); // the reason came back with the item
    await app.shot('c3-act-now');
  },

  // A follow-up that is set aside must hand the waiting loop back (regression found by the random-use test).
  async 'followup-set-aside'(app) {
    await goHome(app);
    await openLoop(app, 'Zara refund');
    await doAction(app, 'follow_up', false);
    await app.see('From: Zara refund');
    await app.click(testId('action-dismiss'));
    await app.see('Open Loops');
    assert.equal(await flashText(app), 'Set aside');
    has(await homeSection(app, 'waiting'), 'Zara refund'); // it must NOT have vanished
  },

  // Flow 4 — a plain sentence about an existing loop, typed instead of tapped, updates it: no new
  // capture is made, and nothing is guessed silently — the user still confirms.
  async 'g-flow-4'(app) {
    await goHome(app);
    has(await homeSection(app, 'waiting'), 'Zara refund'); // still open and untouched since Flow 1
    await captureText(app, 'Zara para iadesi geldi.');
    await app.see('Zara refund resolved?');
    has(await app.text(), 'Choose another'); // exactly the acceptance example: "Confirm" and "Choose another"
    await app.shot('g4-proposal');

    await app.click(testId('update-confirm-u0'));
    await app.see('✓ Confirm');
    assert.equal(await flashText(app), 'Got it — resolved');
    await app.shot('g4-confirmed');

    await app.tap('Not now');
    await app.see('Open Loops');
    hasNot(await app.text(), 'Zara refund', 'the resolved refund must leave Home');
  },
};
