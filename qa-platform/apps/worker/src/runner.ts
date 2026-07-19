/**
 * Executes (or resumes) one run. On claim it loads full run detail, rehydrates
 * the shared state from already-completed steps, then runs each non-terminal
 * step in order. Gate/ask nodes throw PausedForInput → the run is set to
 * "paused" and released; submitting an answer/approval re-queues it and a
 * worker resumes from exactly where it left off. No in-process blocking.
 *
 * Manual Pause (Run Lifecycle Management) is graceful, not an abort: the API
 * flips a running run's status to 'pausing'; the poller below notices (same
 * mechanism as the existing Stop/'cancelling' poll) but does NOT abort the
 * controller — the in-flight step finishes normally, and the boundary check
 * at the top of the loop stops before starting the next one.
 */
import { ClaudeCancelledError, UsageLimitError } from '@qa/engine';
import { buildRunContext, makeEvent, redactSecrets, STATE_KEYS, type RunEvent, type RunPauseReason } from '@qa/shared';
import { ingest, getRunDetail, getRunStatus, type ClaimedRun, type RunDetail } from './api-client.js';
import { NODES, PausedForInput, type NodeContext } from './nodes.js';

const TERMINAL = new Set(['succeeded', 'skipped', 'rejected']);
const CANCEL_POLL_MS = Number(process.env.QA_CANCEL_POLL_MS ?? 2000);

export async function executeRun(claim: ClaimedRun): Promise<void> {
  const run = await getRunDetail(claim.id);
  // Context Builder (@qa/shared): rebuilds `state` purely from persisted,
  // succeeded steps' outputJson — identical whether this is a brand-new run
  // or a resume, on this machine or a different one. See its module comment
  // for the cross-session guarantee this gives Run Lifecycle Management.
  const state = buildRunContext(run);

  await ingest(status(run.id, 'running'));

  // Stop support: poll the API for a 'cancelling' status while this run is
  // active and abort the in-flight step's AI/child-process work immediately.
  // Pause support: poll for 'pausing' too, but — unlike cancelling — never
  // abort; just flag it so the boundary check below stops before the next
  // step once the current one finishes on its own.
  const controller = new AbortController();
  let cancelling = false;
  let pausing = false;
  const poller = setInterval(async () => {
    const s = await getRunStatus(run.id);
    if (s === 'cancelling' && !controller.signal.aborted) {
      cancelling = true;
      controller.abort();
    } else if (s === 'pausing') {
      pausing = true;
    }
  }, CANCEL_POLL_MS);

  try {
    return await runSteps(run, state, controller.signal, () => cancelling, () => pausing);
  } finally {
    clearInterval(poller);
  }
}

async function runSteps(
  run: RunDetail,
  state: Record<string, unknown>,
  signal: AbortSignal,
  isCancelling: () => boolean,
  isPausing: () => boolean,
): Promise<void> {
  for (const step of run.steps) {
    if (TERMINAL.has(step.status)) continue; // already done (resume)
    if (isCancelling()) {
      await finish(run.id, step.id, 'cancelled');
      continue;
    }
    if (isPausing()) {
      // Graceful: the current step already finished (we're at the top of the
      // loop, between steps) — nothing to abort, nothing to finish early.
      // pauseReason was already set by the API's pause() call; don't touch it.
      await ingest(status(run.id, 'paused'));
      return;
    }
    const node = NODES[step.name];
    if (!node) {
      await finish(run.id, step.id, 'skipped');
      continue;
    }

    // Execution-instruction skip (directives.skipNodes) — honored, never silent.
    const directives = state.directives as { skipNodes?: string[] } | undefined;
    if (directives?.skipNodes?.includes(step.name)) {
      await ingest(makeEvent<Extract<RunEvent, { kind: 'step.log' }>>({
        kind: 'step.log', runId: run.id, stepId: step.id, line: 'skipped per execution instructions (directives.skipNodes)',
      }));
      await finish(run.id, step.id, 'skipped');
      continue;
    }

    await ingest(makeEvent<Extract<RunEvent, { kind: 'step.started' }>>({
      kind: 'step.started', runId: run.id, stepId: step.id, name: step.name, type: step.type as any,
    }));
    const stepStartedAt = Date.now();

    const ctx: NodeContext = {
      run, step, state, signal,
      meta: { costUsd: 0, tokens: 0 },
      log: (line) => ingest(makeEvent<Extract<RunEvent, { kind: 'step.log' }>>({ kind: 'step.log', runId: run.id, stepId: step.id, line })),
    };

    try {
      const output = await node(ctx);
      if (output && typeof output === 'object') {
        if ('workspacePath' in output) state.workspacePath = (output as any).workspacePath;
        if ('csvPath' in output) state.csvPath = (output as any).csvPath;
        const key = STATE_KEYS[step.name];
        if (key) state[key] = output;
      }
      const rejected = output && typeof output === 'object' && (output as any).decision === 'rejected';
      await finish(run.id, step.id, rejected ? 'rejected' : 'succeeded', output, ctx.meta);
      if (rejected) {
        await ingest(status(run.id, 'paused'));
        return; // tester rejected a gate — stop; re-run to retry
      }
    } catch (err) {
      if (err instanceof PausedForInput) {
        await ingest(status(run.id, 'paused')); // awaiting tester input; release the worker
        return;
      }
      if (err instanceof ClaudeCancelledError || isCancelling()) {
        await ctx.log('cancelled by Stop request');
        await finish(run.id, step.id, 'cancelled', undefined, ctx.meta);
        await ingest(status(run.id, 'cancelled'));
        return; // artifacts already written to disk are left as-is
      }
      if (err instanceof UsageLimitError) {
        // Claude Usage Limit Protection: this is not a real failure, so the
        // step is 'interrupted' (non-terminal, like 'cancelled') rather than
        // 'failed' — the next resume re-executes it from scratch, nothing to
        // retry-vs-restart about. Run-level pauseReason drives the tester-
        // facing "resume after your usage resets" banner.
        await ctx.log(`paused — ${err.message}`);
        await finish(run.id, step.id, 'interrupted', undefined, ctx.meta);
        await ingest(pauseStatus(run.id, 'usage_limit'));
        return;
      }
      // Persist a self-contained diagnostic line: which step, elapsed wall-clock,
      // and the error message (a claude-runner timeout arrives as "…timed out
      // after <ms>ms", so timeout info is captured verbatim). This lands in
      // RunStep.logs via the step.log ingest case, so a failed run is diagnosable
      // later from the UI + DB without the worker's live terminal output.
      const elapsedMs = Date.now() - stepStartedAt;
      const elapsedSec = Math.round(elapsedMs / 1000);
      const message = (err as Error)?.message ?? String(err);
      const isTimeout = /timed out after \d+ms/.test(message);
      await ctx.log(
        `ERROR: step "${step.name}" failed after ${elapsedSec}s` +
          `${isTimeout ? ' (hard timeout reached)' : ''}: ${message}`,
      );
      // Structured failure diagnostics (Failure Recovery) — the durable record
      // behind the Failure Details UI panel, independent of the free-text log
      // line above. Stack is redacted the same way prompts are before storage.
      const error: Extract<RunEvent, { kind: 'step.finished' }>['error'] = {
        message,
        isTimeout,
        durationMs: elapsedMs,
        stack: redactSecrets((err as Error)?.stack),
      };
      await finish(run.id, step.id, 'failed', undefined, ctx.meta, error);
      await ingest(status(run.id, 'failed'));
      return;
    }
  }
  await ingest(status(run.id, 'succeeded'));
}

function status(runId: string, s: 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled') {
  return makeEvent<Extract<RunEvent, { kind: 'run.status' }>>({ kind: 'run.status', runId, status: s });
}
/** Pause with a reason (Run Lifecycle Management) — e.g. an auto-pause on a Claude usage limit. */
function pauseStatus(runId: string, reason: RunPauseReason) {
  return makeEvent<Extract<RunEvent, { kind: 'run.status' }>>({ kind: 'run.status', runId, status: 'paused', reason });
}
async function finish(
  runId: string,
  stepId: string,
  st: string,
  output?: unknown,
  meta?: { costUsd: number; tokens: number },
  error?: Extract<RunEvent, { kind: 'step.finished' }>['error'],
) {
  await ingest(makeEvent<Extract<RunEvent, { kind: 'step.finished' }>>({
    kind: 'step.finished', runId, stepId, status: st as any, output,
    costUsd: meta?.costUsd, tokens: meta?.tokens, error,
  }));
}
