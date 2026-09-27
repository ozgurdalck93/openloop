import assert from 'node:assert/strict';

export const FLOW_1_TEXT =
  "I emailed HR and I'm waiting for a reply. Tomorrow afternoon remind me to call the dentist. I returned the Zara package but the refund hasn't arrived.";

export const has = (text, needle, message) =>
  assert.ok(text.includes(needle), message ?? `expected screen to contain "${needle}"`);
export const hasNot = (text, needle, message) =>
  assert.ok(!text.includes(needle), message ?? `expected screen NOT to contain "${needle}"`);

export const testId = (id) => `[data-testid="${id}"]`;

/** A full reload at the app root: the same as reopening the app. */
export async function goHome(app) {
  await app.page.goto(new URL('/', app.page.url()).href, { waitUntil: 'networkidle2' });
  await app.see('Open Loops');
}

/** Types a paragraph into Capture and taps "Make sense of this". */
export async function captureText(app, text) {
  await app.tap('Tell me what’s going on');
  await app.see('What’s going on?');
  await app.type('textarea', text);
  await app.tap('Make sense of this');
}

/** Opens a loop from Home by its title and waits for its detail screen. */
export async function openLoop(app, title) {
  await app.tap(title);
  await app.waitFor(testId('detail-title'));
  await app.see('TIMELINE');
  assert.equal(await app.page.$eval(testId('detail-title'), (el) => el.innerText.trim()), title, 'opened the wrong loop');
}

/**
 * Clicks the chip with this exact visible label among elements whose testid starts with
 * `prefix` (e.g. an update proposal's candidate chips) — via `app.click`, which waits for the
 * chip's position to stop moving first. `app.tap(text)` has no such wait, and a chip that
 * exists only because a screen just navigated in can still be mid-transition.
 */
export async function pickChip(app, prefix, label) {
  await app.waitFor(`[data-testid^="${prefix}"]`);
  const id = await app.page.$$eval(
    `[data-testid^="${prefix}"]`,
    (els, wanted) => els.find((el) => (el.innerText ?? '').trim() === wanted)?.getAttribute('data-testid') ?? null,
    label,
  );
  if (!id) throw new Error(`No chip labelled "${label}" under "${prefix}"`);
  await app.click(testId(id));
}

export const actionLabels = (app) => app.texts('action-');
export const flashText = (app) => app.page.$eval(testId('flash'), (el) => el.innerText.trim());
export const homeSection = (app, key) => app.page.$eval(testId(`section-${key}`), (el) => el.innerText);
export const detailTitleText = (app) => app.page.$eval(testId('detail-title'), (el) => el.innerText.trim());

/** Taps an action on the open detail screen; by default waits until Home is back. */
export async function doAction(app, action, expectHome = true) {
  await app.click(testId(`action-${action}`));
  if (expectHome) await app.see('Open Loops');
}
