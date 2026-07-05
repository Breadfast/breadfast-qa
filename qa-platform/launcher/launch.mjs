/**
 * One-click launcher for the Breadfast QA Platform.
 * Starts api + worker + web (production build), waits until they are up,
 * opens the browser already signed in, and stops everything when this
 * window is closed.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_URL = 'http://localhost:3000';
// Proxied through the web origin (same-origin cookies) → dev sign-in → dashboard.
const LOGIN_URL = 'http://localhost:3000/api/auth/dev';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const banner = `
==========================================================
   Breadfast QA Platform
   Starting services (api + worker + web)...
   Keep this window open. Close it to STOP the platform.
==========================================================
`;
console.log(banner);

const services = [
  { name: 'api', args: ['run', 'start', '-w', '@qa/api'] },
  { name: 'worker', args: ['run', 'start', '-w', '@qa/worker'] },
  { name: 'web', args: ['run', 'start', '-w', '@qa/web'] },
];

const children = services.map((s) =>
  spawn(npm, s.args, { cwd: ROOT, stdio: 'inherit', shell: true }),
);

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await ping(url)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`[launcher] timed out waiting for ${label} (${url})`);
  return false;
}

function openBrowser(url) {
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { shell: false });
  else if (process.platform === 'darwin') spawn('open', [url]);
  else spawn('xdg-open', [url]);
}

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  console.log('\n[launcher] stopping services...');
  for (const c of children) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/t', '/f']);
      else c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
process.on('exit', stopAll);

(async () => {
  await waitFor('http://localhost:4000/auth/me', 'API');
  const webUp = await waitFor(WEB_URL, 'web app');
  if (webUp) {
    console.log(`\n[launcher] ready → opening ${WEB_URL}\n`);
    openBrowser(LOGIN_URL);
  }
})();
