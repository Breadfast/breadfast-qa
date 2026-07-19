/**
 * Thin client the local worker uses to talk to the shared API: claim runs,
 * fetch full run detail (for resume), and ingest events.
 */
import type { RunEvent } from '@qa/shared';

const BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
const WORKER_ID = process.env.WORKER_ID ?? 'local-dev';

export interface StoryFacts {
  id: string;
  jiraKey: string;
  title: string;
  platform: string;
  locales: string;
  environment?: string | null;
  notes?: string | null;
  appUrl?: string | null;
  adminUrl?: string | null;
  bsAppIds?: { android?: string; ios?: string } | null;
  devices?: { android?: string; ios?: string } | null;
  executionType?: string | null;
  packageNumbers?: string | null;
  executionInstructions?: string | null;
  additionalInputs?: string | null;
  workspacePath?: string | null;
  bsFolderId?: string | null;
  credentials?: { username?: string; password?: string; otpMethod?: string; extra?: { key: string; value: string }[] } | null;
}

export interface StepDetail {
  id: string;
  name: string;
  type: string;
  ordinal: number;
  status: string;
  outputJson?: unknown;
  // Timing (M6 Activity Timeline — used to build the report's timeline section).
  startedAt?: string | null;
  finishedAt?: string | null;
  tokens?: number;
  costUsd?: number;
  /** Tester feedback from a Regenerate action, threaded into this node's prompt. */
  feedback?: string | null;
  approval?: { decision?: string | null; feedback?: string | null; payload?: unknown; createdAt?: string | null; decidedAt?: string | null } | null;
  clarification?: { questionsJson?: any; answersJson?: any; createdAt?: string | null; answeredAt?: string | null } | null;
}

export interface RunDetail {
  id: string;
  status: string;
  story: StoryFacts;
  steps: StepDetail[];
}

/** Minimal shape returned by /runs/claim. */
export interface ClaimedRun {
  id: string;
  storyId: string;
  status: string;
  story: StoryFacts;
}

export async function claimNextRun(): Promise<ClaimedRun | null> {
  const res = await fetch(`${BASE}/runs/claim?workerId=${encodeURIComponent(WORKER_ID)}`, { method: 'POST' });
  if (res.status !== 200) return null;
  const text = await res.text();
  return text ? (JSON.parse(text) as ClaimedRun) : null;
}

/** Full run detail incl. step outputs + approval/clarification — used to resume. */
export async function getRunDetail(runId: string): Promise<RunDetail> {
  const res = await fetch(`${BASE}/runs/${runId}/detail`); // unguarded worker route
  if (!res.ok) throw new Error(`getRunDetail ${runId} -> ${res.status}`);
  return (await res.json()) as RunDetail;
}

/** Cheap status-only poll used to detect a mid-flight Stop request. */
export async function getRunStatus(runId: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/runs/${runId}/status`); // unguarded worker route
    if (!res.ok) return null;
    const body = (await res.json()) as { status: string };
    return body.status;
  } catch {
    return null;
  }
}

/**
 * Artifact versioning (Run Lifecycle Management, §5b). Pure read: the next
 * version number for a logical artifact name within this run's story. Falls
 * back to 1 on any failure — worst case a restart re-clobbers a file it
 * would otherwise have versioned, no worse than today's un-versioned writes.
 */
export async function nextArtifactVersion(runId: string, name: string): Promise<number> {
  try {
    const res = await fetch(`${BASE}/runs/${runId}/artifacts/next-version?name=${encodeURIComponent(name)}`);
    if (!res.ok) return 1;
    const body = (await res.json()) as { version: number };
    return body.version ?? 1;
  } catch {
    return 1;
  }
}

/** Record a written artifact version. Fire-and-forget: never blocks the run. */
export async function recordArtifact(
  runId: string,
  rec: { kind: string; name: string; version: number; localPath: string },
): Promise<void> {
  try {
    await fetch(`${BASE}/runs/${runId}/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rec),
    });
  } catch {
    /* fire-and-forget */
  }
}

/** Resolved settings map (BrowserStack/Jira/etc.) for the local worker. */
export async function getSettings(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${BASE}/settings/resolved`);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Resolved framework paths from the Framework Registry (first valid per type). */
export async function getResolvedFrameworks(): Promise<{ playwright?: string; javaAppium?: string }> {
  try {
    const res = await fetch(`${BASE}/frameworks/resolved`);
    if (!res.ok) return {};
    return (await res.json()) as { playwright?: string; javaAppium?: string };
  } catch {
    return {};
  }
}

/**
 * Ingest a run event into the API with automatic retry.
 * Gate events (gate.awaiting) that are dropped because the API is momentarily
 * unavailable cause a run to stick forever — retrying 3 times with 2 s backoff
 * is enough to survive a brief restart or slow startup.
 * Never throws: a final failure is logged and swallowed so the worker can
 * continue (the step is still marked and the gate UI will show it when the
 * API comes back up).
 */
export async function ingest(event: RunEvent): Promise<void> {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = 2000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE}/runs/${event.runId}/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (res.ok || res.status < 500) return; // 4xx = don't retry (bad payload)
      lastErr = new Error(`ingest HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt));
    }
  }
  // Final failure — log to stderr but don't crash the worker.
  console.error(`[ingest] failed after ${MAX_ATTEMPTS} attempts for event ${event.kind}:`, (lastErr as Error)?.message ?? lastErr);
}

/** One AI call's audit record (LLM Request Log, #7). */
export interface LlmRequestRecord {
  runId?: string;
  runStepId?: string;
  node: string;
  schemaName?: string;
  model?: string;
  promptVersion?: string;
  workflowVersion?: string;
  systemPrompt?: string;
  userPrompt?: string;
  rawResponse?: string;
  validatedOutput?: unknown;
  status: string; // ok | repaired | parse_failed | schema_failed | error
  repaired?: boolean;
  repairStage?: string;
  tokens?: number;
  costUsd?: number;
  durationMs?: number;
  attempt?: number;
}

/**
 * Persist an LLM Request Log record. Fire-and-forget: never throws, never blocks
 * a run — an audit-log write must not be able to fail the workflow.
 */
export async function logLlmRequest(rec: LlmRequestRecord): Promise<void> {
  if (!rec.runId) return;
  try {
    await fetch(`${BASE}/runs/${rec.runId}/llm-log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rec),
    });
  } catch {
    /* fire-and-forget */
  }
}
