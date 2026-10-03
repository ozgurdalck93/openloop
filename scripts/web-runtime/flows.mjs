import assert from 'node:assert/strict';

import { acceptance } from './acceptance.mjs';
import { FLOW_1_TEXT, captureText, flashText, goHome, has, hasNot, pickChip, testId } from './helpers.mjs';

export const flows = {
  // PHASE A — the original slice, in a real runtime: Capture → Review → Home → Detail → restart.
  async 'phase-a'(app) {
    await app.see('Open Loops');
    await captureText(app, FLOW_1_TEXT);
    await app.see('Here’s what’s still open');
    assert.deepEqual(await app.values('title-'), ['HR reply', 'Call dentist', 'Zara refund']); // titles are inputs now
    await app.shot('a1-review');

    await app.tap('Keep track of these');
    await app.see('NEEDS YOU');
    const home = await app.text();
    has(home, '1 needs you · 2 are waiting');
    for (const title of ['HR reply', 'Call dentist', 'Zara refund']) has(home, title);
    await app.shot('a2-home');

    // restart: reload the page — the database lives in the browser profile, not in memory
    await app.reload();
    await app.see('NEEDS YOU');
    const afterRestart = await app.text();
    for (const title of ['HR reply', 'Call dentist', 'Zara refund']) has(afterRestart, title, `"${title}" did not survive a restart`);

    await app.tap('HR reply');
    await app.see('TIMELINE');
    const detail = await app.text();
    has(detail, 'Waiting on HR');
    has(detail, 'Captured');
    has(detail, 'Waiting started');
    has(detail, 'Next review scheduled');
    await app.shot('a3-detail');

    // Deep link + hydration: reloading ON the detail route must rebuild the screen from the database.
    await app.reload();
    await app.see('TIMELINE');
    has(await app.text(), 'HR reply', 'detail route did not hydrate after a reload');
  },

  // PHASE B — every candidate is editable, removable, validated; doubts are shown until edited.
  async 'phase-b-edit'(app) {
    await goHome(app);
    await captureText(
      app,
      "I emailed Acme and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Nike package but the refund hasn't arrived.",
    );
    await app.see('Here’s what’s still open');
    assert.deepEqual(await app.values('title-'), ['Acme reply', 'Call dentist', 'Nike refund']);
    has(await app.text(), 'Not sure about the timing', 'a default reply interval should be flagged as a guess');
    await app.shot('b1-review-hints');

    // the dentist card (c1): change title, person, note, date (+1 day) and time (+1 hour)
    await app.type(testId('title-c1'), 'Call Dr. Yilmaz');
    await app.type(testId('entity-c1'), 'Dr. Yilmaz');
    await app.type(testId('note-c1'), 'ask about the crown');
    const dayBefore = await app.value(testId('when-c1-day-value'));
    const hourBefore = Number(await app.value(testId('when-c1-hour-value')));
    await app.click(testId('when-c1-day-next'));
    await app.click(testId('when-c1-hour-next'));
    const dayAfter = await app.value(testId('when-c1-day-value'));
    const hourAfter = Number(await app.value(testId('when-c1-hour-value')));
    assert.notEqual(dayAfter, dayBefore, 'the date stepper did not move');
    assert.equal(hourAfter, (hourBefore + 1) % 24, 'the hour stepper did not move by one');

    // the Nike card (c2): change its type to TASK
    await app.click(testId('type-c2-task'));
    // remove the Acme card (c0)
    await app.click(testId('remove-c0'));
    assert.deepEqual(await app.values('title-'), ['Call Dr. Yilmaz', 'Nike refund'], 'a removed candidate must disappear');
    await app.shot('b2-edited');

    // validation: a blank title blocks saving, says why, and saves nothing
    await app.type(testId('title-c1'), '');
    await app.tap('Keep track of these');
    await app.see('Give it a title');
    await app.see('A couple of things need fixing first.');
    has(await app.text(), 'Here’s what’s still open', 'must stay on Review while invalid');
    await app.shot('b3-validation');

    await app.type(testId('title-c1'), 'Call Dr. Yilmaz');
    hasNot(await app.text(), 'Give it a title');
    await app.tap('Keep track of these');
    await app.see('Call Dr. Yilmaz');
    const home = await app.text();
    hasNot(home, 'Acme reply', 'the removed loop must not be saved');
    has(home, 'Nike refund');

    // what was saved is what was edited
    await app.tap('Call Dr. Yilmaz');
    await app.see('TIMELINE');
    const detail = await app.text();
    has(detail, 'Dr. Yilmaz');
    has(detail, 'ask about the crown');
    has(detail, `${String(hourAfter).padStart(2, '0')}:`);
    await app.shot('b4-saved-detail');
  },

  // PHASE B — doubts are honest, and settle when the user answers them.
  async 'phase-b-doubts'(app) {
    await goHome(app);
    await captureText(app, 'I emailed Mira.');
    await app.see('Not sure about the type');
    has(await app.text(), 'Are you waiting to hear back from Mira?');
    await app.click(testId('type-c0-waiting')); // the user confirms: yes, waiting
    hasNot(await app.text(), 'Not sure about the type', 'confirming the type must clear the doubt');
    await app.tap('Not now');
    await app.see('Open Loops');

    // "after payday": shown as a suggested date the user can change — no payday setting exists
    await captureText(app, 'I like the coat. Bring this back after payday.');
    await app.see('I don’t know your payday');
    has(await app.text(), 'After payday');
    assert.deepEqual(await app.values('title-'), ['Reconsider coat']);
    await app.shot('b5-payday');
    await app.click(testId('when-c0-day-next'));
    hasNot(await app.text(), 'I don’t know your payday', 'editing the date must clear the payday guess');
    await app.tap('Keep track of these');
    await app.see('Open Loops'); // Home first: the Review screen's type chip also says REVISIT
    await app.see('REVISIT');
    has(await app.text(), 'Reconsider coat');

    // a time in the past cannot be kept
    await captureText(app, 'Call the mechanic tomorrow');
    await app.see('Here’s what’s still open');
    for (let i = 0; i < 3; i += 1) await app.click(testId('when-c0-day-prev'));
    await app.tap('Keep track of these');
    await app.see('That time has already passed');
    // "tomorrow morning" always survives snoozeOptions' same-moment dedup (nothing earlier in its
    // list can collide with it), unlike "next week" — which IS today's moment on a Sunday.
    await app.click(testId('when-c0-preset-tomorrow_morning'));
    hasNot(await app.text(), 'That time has already passed');
    await app.tap('Not now');
    await app.see('Open Loops');
  },

  // Decision 2: REFERENCE loops are stored but never listed on Home.
  async 'reference-not-on-home'(app) {
    await goHome(app);
    await captureText(app, 'My passport number is in the blue folder.');
    await app.see('Notes never send reminders');
    await app.tap('Keep track of these');
    await app.shot('ref-after-keep');
    await app.see('Open Loops');
    await app.reload();
    await app.see('Open Loops');
    hasNot(await app.text(), 'passport', 'a reference must not appear in the Home sections');
  },

  // Decision 4 + Turkish UI: 12/10 is 12 October on tr-TR, and the hints speak Turkish.
  // The UI itself follows the device locale (with a manual EN/TR override on Home), so a
  // tr-TR device sees the whole app in Turkish, not just the Review editor's hints.
  'turkish-locale': {
    lang: 'tr-TR',
    async run(app) {
      await app.see('Açık Konular');
      await app.tap('Neler oluyor, anlat');
      await app.see('Neler oluyor?');
      await app.type('textarea', 'Call the dentist on 12/10 at 3pm');
      await app.tap('Bunu anlamlandır');
      await app.see('İşte hâlâ açık olanlar');
      has(await app.value(testId('when-c0-day-value')), '12 Eki', 'tr-TR must read 12/10 as 12 October');
      await app.tap('Şimdi değil');
      await app.see('Açık Konular');

      await app.tap('Neler oluyor, anlat');
      await app.type('textarea', 'I emailed HR.');
      await app.tap('Bunu anlamlandır');
      await app.see('Türden emin değilim');
      await app.shot('b6-turkish');
      await app.click(testId('remove-c0'));
      has(await app.text(), 'Kaydedilecek bir şey kalmadı.');
      await app.tap('Şimdi değil');
    },
  },

  'english-us-locale': {
    lang: 'en-US',
    async run(app) {
      await goHome(app);
      await captureText(app, 'Call the dentist on 12/10 at 3pm');
      await app.see('Here’s what’s still open');
      has(await app.value(testId('when-c0-day-value')), '10 Dec', 'en-US must read 12/10 as December 10');
      await app.tap('Not now');
    },
  },

  // The Home screen's EN/TR switch overrides the device locale, and the choice survives a restart
  // (it lives in the same SQLite database as everything else, not just in memory).
  'language-switch': {
    lang: 'en-GB',
    async run(app) {
      await app.see('Open Loops');
      await app.click(testId('language-tr'));
      await app.see('Açık Konular');

      await app.reload();
      await app.see('Açık Konular');

      await app.click(testId('language-en'));
      await app.see('Open Loops');
    },
  },

  // Phase F — when the words alone don't say which loop, the user chooses; nothing is guessed;
  // something specific that matches nothing changes NOTHING, and says so. Its own fresh profile,
  // so titles from other flows sharing the default en-US session can't collide with these.
  'update-choices': {
    lang: 'en-IE',
    async run(app) {
      await app.see('Open Loops');
      await captureText(
        app,
        "I returned the Zara package but the refund hasn't arrived. I returned the Nike package but the refund hasn't arrived.",
      );
      await app.see('Here’s what’s still open');
      await app.tap('Keep track of these');
      await app.see('Zara refund');
      has(await app.text(), 'Nike refund');

      // The words name nothing at all: BOTH loops could be it, so the user is asked — never guessed.
      // Skip: the user declines to say which, and nothing changes.
      await captureText(app, 'They sent it.');
      await app.see('Which one is this about?');
      assert.equal((await app.texts('update-pick-')).length, 2, 'both refunds must be offered');
      await app.shot('update-choose');
      await app.click(testId('update-skip-u0'));
      await app.see('Skip');
      await app.tap('Not now');
      await app.see('Open Loops');
      has(await app.text(), 'Zara refund', 'skipping an update must leave every loop as it was');
      has(await app.text(), 'Nike refund', 'skipping an update must leave every loop as it was');

      // "Refund came" ties on the generic word alone: still asked, not guessed — the user picks one.
      await captureText(app, 'Refund came.');
      await app.see('Which one is this about?');
      await app.shot('update-ambiguous');
      await pickChip(app, 'update-pick-', 'Nike refund');
      await app.see('✓ Confirm');
      assert.equal(await flashText(app), 'Got it — resolved');
      await app.tap('Not now');
      await app.see('Open Loops');
      hasNot(await app.text(), 'Nike refund', 'the chosen loop must be gone');
      has(await app.text(), 'Zara refund', 'the OTHER loop must be untouched');

      // Something specific that matches NO open loop: reported, never guessed onto the wrong one.
      await captureText(app, 'Acme refund came.');
      await app.see('match this to anything open');
      hasNot(await app.text(), 'resolved?', 'an unmatched update must not be offered as a proposal');
      await app.shot('update-unmatched');
      await app.tap('Not now');
    },
  },
};

// The acceptance pass runs in its own fresh profile (en-GB), in order.
for (const [name, run] of Object.entries(acceptance)) flows[name] = { lang: "en-GB", run };
