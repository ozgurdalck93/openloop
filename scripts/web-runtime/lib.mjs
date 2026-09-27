/**
 * Real-browser runtime harness for the Expo app (web target).
 *
 * WHY THIS EXISTS: there is no Android emulator / iOS simulator on the machine this
 * was developed on, so the app is exercised as an Expo Router web build in real
 * Chrome. That runs the real React tree, Expo Router, screens, state, and the real
 * expo-sqlite code path (wa-sqlite / WebAssembly, persisted in the browser). It does
 * NOT exercise native modules or OS notifications — see README "Runtime verification".
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { launch } from 'puppeteer-core';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

/** Static server with the cross-origin-isolation headers wa-sqlite needs, and an SPA fallback. */
export function startStaticServer(root, port = 0) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(normalize(root))) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      // Client-side routes (/review, /loop/abc) fall back to the SPA shell.
      file = extname(url.pathname) ? file : join(root, 'index.html');
    }
    if (!existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

export function exportWeb(projectDir, outDir) {
  return new Promise((resolve, reject) => {
    // Run the Expo CLI with this same Node (no shell, so no npx/.cmd quoting issues on Windows).
    const cli = join(projectDir, 'node_modules', 'expo', 'bin', 'cli');
    const child = spawn(process.execPath, [cli, 'export', '--platform', 'web', '--output-dir', outDir], {
      cwd: projectDir,
      // RNDT_DEV stops the React Native DevTools binary (hundreds of MB) from being downloaded.
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1', RNDT_DEV: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('exit', (code) => (code === 0 ? resolve(log) : reject(new Error(`expo export failed (${code})\n${log.slice(-2000)}`))));
  });
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  return found;
}

/** A phone-sized page whose console errors, uncaught exceptions and failed requests are all recorded. */
export async function openApp(url, { userDataDir, shots, lang = 'en-US' }) {
  mkdirSync(userDataDir, { recursive: true });
  const browser = await launch({
    executablePath: findChrome(),
    headless: true,
    userDataDir,
    // --lang sets the browser locale, which is what Intl (and so the app's locale detection) reports.
    args: ['--no-first-run', '--disable-gpu', '--disable-extensions', '--disable-background-networking', `--lang=${lang}`],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
  const problems = [];
  const log = []; // every console message, for diagnosis — problems is the subset that fails a flow
  page.on('console', (m) => {
    log.push(`${m.type()}: ${m.text()}`);
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
  await page.goto(url, { waitUntil: 'networkidle2' });

  return {
    browser,
    page,
    problems,
    log,
    async shot(name) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // let fades and slides finish
      const file = join(shots, `${name}.png`);
      await page.screenshot({ path: file });
      return file;
    },
    /** Waits for VISIBLE text (innerText). Not `::-p-text`: that also matches <input> values, which are not on screen as text. */
    async see(text, timeout = 15000) {
      await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
    },
    async gone(text, timeout = 8000) {
      await page.waitForFunction((t) => !document.body.innerText.includes(t), { timeout }, text);
    },
    async tap(text, timeout = 15000) {
      const el = await page.waitForSelector(`::-p-text(${text})`, { timeout });
      await el.click();
    },
    async click(selector) {
      const el = await page.waitForSelector(selector, { timeout: 15000 });
      // Wait for the element to stop moving (screens and sheets animate in) before clicking it.
      let previous = null;
      for (let i = 0; i < 25; i += 1) {
        const box = await el.boundingBox();
        if (box && previous && Math.abs(box.x - previous.x) < 0.5 && Math.abs(box.y - previous.y) < 0.5) break;
        previous = box;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      await el.click();
    },
    /** Visible text of every element whose data-testid starts with the prefix (e.g. "action-" → the action buttons). */
    texts: (prefix) =>
      // Only what is on screen: earlier screens of the navigation stack stay mounted (display: none) underneath.
      page.$$eval(`[data-testid^="${prefix}"]`, (els) =>
        els.filter((el) => el.getClientRects().length > 0).map((el) => (el.innerText ?? '').trim()),
      ),
    /** Waits until an element with this data-testid exists. */
    async waitFor(selector, timeout = 15000) {
      await page.waitForSelector(selector, { timeout });
    },
    /** True if a VISIBLE element matches (screens underneath in the stack are display: none). */
    exists: (selector) =>
      page.$$eval(selector, (els) => els.some((el) => el.getClientRects().length > 0)),
    /** Values of every input whose data-testid starts with the prefix (e.g. "title-" → all card titles). */
    values: (prefix) => page.$$eval(`[data-testid^="${prefix}"]`, (els) => els.map((el) => el.value)),
    /** Current value of an input (or the text of any element). */
    value: (selector) =>
      page.$eval(selector, (el) => ('value' in el ? el.value : el.textContent ?? '')),
    async type(selector, value) {
      const el = await page.waitForSelector(selector, { timeout: 15000 });
      await el.focus();
      // Select-all + delete is the reliable way to replace an input's text (triple-click is not, on inputs).
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      if (value) await el.type(value, { delay: 5 });
    },
    text: () => page.evaluate(() => document.body.innerText),
    async reload() {
      await page.reload({ waitUntil: 'networkidle2' });
    },
    close: () => browser.close(),
  };
}
