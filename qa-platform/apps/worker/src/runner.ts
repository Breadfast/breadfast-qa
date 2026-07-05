/**
 * Executes (or resumes) one run. On claim it loads full run detail, rehydrates
 * the shared state from already-completed steps, then runs each non-terminal
 * step in order. Gate/ask nodes throw PausedForInput → the run is set to
 * "paused" and released; submitting an answer/approval re-queues it and a
 * worker resumes from exactly where it left off. No in-process blocking.
 */
import { ClaudeCancelledError } from '@qa/engine';
import { makeEvent, type RunEvent } from '@qa/shared';
import { ingest, getRunDetail, getRunStatus, type ClaimedRun, type RunDetail } from './api-client.js';
import { NODES, PausedForInput, type NodeContext } from './nodes.js';

const TERMINAL = new Set(['succeeded', 'skipped', 'rejected']);
const CANCEL_POLL_MS = Number(process.env.QA_CANCEL_POLL_MS ?? 2000);

/** node name → state key for rehydration on resume. */
const STATE_KEYS: Record<string, string> = {
  fetch_jira: 'jira',
  parse_instructions: 'directives',
  requirements_analysis: 'requirements',
  acceptance_criteria: 'acceptanceCriteria',
  comments_analysis: 'comments',
  linked_stories: 'linkedStories',
  figma_analysis: 'figma',
  detect_prerequisites: 'prerequisites',
  clarification: 'clarification',
  impact_analysis: 'impact',
  generate_hls: 'hls',
  generate_testcases: 'testcases',
  exploratory_testing: 'exploratory',
  automation_generation: 'automationPlan',
  execution: 'execution',
  knowledge_update: 'knowledge',
};

export async function executeRun(claim: ClaimedRun): Promise<void> {
  const run = await getRunDetail(claim.id);
  const state = hydrate(run);

  await ingest(status(run.id, 'running'));

  // Stop support: poll the API for a 'cancelling' status while this run is
  // active and abort the in-flight step's AI/child-process work immediately.
  const controller = new AbortController();
  let cancelling = false;
  const poller = setInterval(async () => {
    const s = await getRunStatus(run.id);
    if (s === 'cancelling' && !controller.signal.aborted) {
      cancelling = true;
      controller.abort();
    }
  }, CANCEL_POLL_MS);

  try {
    return await runSteps(run, state, controller.signal, () => cancelling);
  } finally {
    clearInterval(poller);
  }
}

async function runSteps(
  run: RunDetail,
  state: Record<string, unknown>,
  signal: AbortSignal,
  isCancelling: () => boolean,
): Promise<void> {
  for (const step of run.steps) {
    if (TERMINAL.has(step.status)) continue; // already done (resume)
    if (isCancelling()) {
      await finish(run.id, step.id, 'cancelled');
      continue;
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
      await ctx.log(`ERROR: ${(err as Error).message}`);
      await finish(run.id, step.id, 'failed');
      await ingest(status(run.id, 'failed'));
      return;
    }
  }
  await ingest(status(run.id, 'succeeded'));
}

function hydrate(run: RunDetail): Record<string, unknown> {
  const s = run.story;
  const state: Record<string, unknown> = {
    story: {
      jiraKey: s.jiraKey, platform: s.platform, environment: s.environment ?? 'testing',
      locales: (s.locales ?? '').split(',').filter(Boolean), appUrl: s.appUrl ?? undefined,
      adminUrl: s.adminUrl ?? undefined, bsAppIds: s.bsAppIds ?? undefined, devices: s.devices ?? undefined,
      executionType: s.executionType ?? 'full', packageNumbers: s.packageNumbers ?? undefined, notes: s.notes ?? undefined,
    },
  };
  for (const step of run.steps) {
    if (step.status !== 'succeeded' || !step.outputJson) continue;
    const o = step.outputJson as any;
    if (o && typeof o === 'object') {
      if ('workspacePath' in o) state.workspacePath = o.workspacePath;
      if ('csvPath' in o) state.csvPath = o.csvPath;
      if ('reportPath' in o) state.reportPath = o.reportPath;
      const key = STATE_KEYS[step.name];
      if (key) state[key] = o;
    }
  }
  return state;
}

function status(runId: string, s: 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled') {
  return makeEvent<Extract<RunEvent, { kind: 'run.status' }>>({ kind: 'run.status', runId, status: s });
}
async function finish(runId: string, stepId: string, st: string, output?: unknown, meta?: { costUsd: number; tokens: number }) {
  await ingest(makeEvent<Extract<RunEvent, { kind: 'step.finished' }>>({
    kind: 'step.finished', runId, stepId, status: st as any, output,
    costUsd: meta?.costUsd, tokens: meta?.tokens,
  }));
}
