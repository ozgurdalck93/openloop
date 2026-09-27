// Smoke test: does the exported web app boot, open + migrate SQLite, and render Home?
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
console.log('serving', server.url);
const profile = join(work, 'profile-smoke');
rmSync(profile, { recursive: true, force: true });
const app = await openApp(server.url, { userDataDir: profile, shots });
try {
  await app.see('Open Loops');
  console.log('Home rendered');
  console.log('screenshot:', await app.shot('smoke-home'));
} finally {
  console.log('--- problems (' + app.problems.length + ') ---');
  for (const p of app.problems) console.log(p);
  await app.close();
  await server.close();
  rmSync(profile, { recursive: true, force: true });
}
