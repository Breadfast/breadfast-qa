/**
 * Local worker entrypoint. Polls the shared API for a queued run, claims it,
 * and executes the MVP graph on this machine (local Claude subscription, local
 * frameworks, internal-network access). One worker per tester workstation.
 */
import { claimNextRun } from './api-client.js';
import { executeRun } from './runner.js';

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const WORKER_ID = process.env.WORKER_ID ?? 'local-dev';
const BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Wait until the API is reachable before starting to poll.
 * A gate event emitted before the API is up causes a run to stick forever —
 * this ensures the API is healthy first.
 */
async function waitForApi(maxWaitMs = 60_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(`${BASE}/settings/resolved`, { signal: AbortSignal.timeout(3000) });
      if (res.ok || res.status === 401) {
        // eslint-disable-next-line no-console
        console.log(`[worker] API is up (attempt ${attempt})`);
        return;
      }
    } catch {
      // network error — keep waiting
    }
    // eslint-disable-next-line no-console
    console.log(`[worker] waiting for API at ${BASE}... (attempt ${attempt})`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  // eslint-disable-next-line no-console
  console.warn(`[worker] API did not respond within ${maxWaitMs / 1000}s — starting anyway`);
}

async function loop() {
  await waitForApi();
  // eslint-disable-next-line no-console
  console.log(`[worker ${WORKER_ID}] polling ${BASE} every ${POLL_MS}ms`);
  for (;;) {
    try {
      const run = await claimNextRun();
      if (run) {
        // eslint-disable-next-line no-console
        console.log(`[worker] claimed run ${run.id} for ${run.story.jiraKey}`);
        await executeRun(run);
        // eslint-disable-next-line no-console
        console.log(`[worker] finished run ${run.id}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[worker] loop error:', (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop();
