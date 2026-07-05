/**
 * Cross-platform "Stop the platform": kill whatever is listening on the API
 * and web ports (Windows / macOS / Linux). Used by `npm run stop` and the
 * double-click stop entry points.
 */
import { execSync } from 'node:child_process';

const PORTS = [Number(process.env.API_PORT) || 4000, Number(process.env.WEB_PORT) || 3000];

function stopPort(port) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ` +
          `ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore' },
      );
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || true`, { encoding: 'utf8' });
      const pids = out.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const pid of pids) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already gone */ }
      }
    }
    console.log(`[stop] cleared listeners on :${port}`);
  } catch {
    console.log(`[stop] no listener on :${port} (or already stopped)`);
  }
}

console.log('Stopping Breadfast QA Platform...');
for (const p of PORTS) stopPort(p);
console.log('Done.');
