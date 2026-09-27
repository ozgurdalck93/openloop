// Runs the runtime flows in a real browser. Usage:
//   node scripts/web-runtime/run.mjs [flow ...]        (no args = every flow)
// Env: SKIP_EXPORT=1 reuses an existing build in $WEB_RUNTIME_DIR/dist; VERBOSE=1 prints the console on failure.
//
// A flow is a function (app) => …, or { lang, run } to run in a browser with another UI language.
// Flows run in order and SHARE one browser profile per language (the SQLite database lives in it),
// so later flows build on the data earlier ones created — like a real user's session.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flows } from './flows.mjs';
import { exportWeb, openApp, startStaticServer } from './lib.mjs';

const project = process.cwd();
const work = process.env.WEB_RUNTIME_DIR ?? join(tmpdir(), 'openloop-web-runtime');
const dist = join(work, 'dist');
const shots = join(work, 'shots');
mkdirSync(shots, { recursive: true });

if (!process.env.SKIP_EXPORT) {
  console.log('exporting web bundle…');
  await exportWeb(project, dist);
}
const server = await startStaticServer(dist);
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(flows);

const apps = new Map(); // lang -> open app
async function appFor(lang) {
  if (!apps.has(lang)) {
    const profile = join(work, `profile-${lang}`);
    rmSync(profile, { recursive: true, force: true });
    apps.set(lang, { profile, app: await openApp(server.url, { userDataDir: profile, shots, lang }) });
  }
  return apps.get(lang).app;
}

let failed = 0;
try {
  for (const name of names) {
    const entry = flows[name];
    if (!entry) throw new Error(`Unknown flow "${name}". Known: ${Object.keys(flows).join(', ')}`);
    const { lang = 'en-US', run } = typeof entry === 'function' ? { run: entry } : entry;
    const app = await appFor(lang);
    const before = app.problems.length;
    process.stdout.write(`▶ ${name} … `);
    try {
      await run(app);
      const fresh = app.problems.slice(before).filter((p) => !/favicon/.test(p));
      if (fresh.length) throw new Error(`runtime problems:\n  ${fresh.join('\n  ')}`);
      console.log('ok');
    } catch (error) {
      failed += 1;
      console.log('FAILED\n   ' + String(error.message).split('\n').join('\n   '));
      await app.shot(`FAILED-${name}`).catch(() => undefined);
      console.log('   body was:\n' + (await app.text().catch(() => '<unavailable>')).split('\n').map((l) => '     | ' + l).join('\n'));
      if (process.env.VERBOSE) console.log('   console log:\n' + app.log.map((l) => '     ~ ' + l).join('\n'));
    }
  }
} finally {
  const notes = new Set();
  for (const { app } of apps.values()) for (const l of app.log) if (/^(warning|error|warn):/.test(l)) notes.add(l);
  if (notes.size) console.log('\nconsole warnings/errors seen:\n  ' + [...notes].join('\n  '));
  console.log(`\nscreenshots: ${shots}`);
  for (const { app, profile } of apps.values()) {
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
  await server.close();
}
process.exit(failed ? 1 : 0);
