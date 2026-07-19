/**
 * Activity Timeline — Roadmap Phase 2, Milestone 6.
 *
 * A DETERMINISTIC milestone timeline of a run, derived entirely from PERSISTED
 * data the platform already records: RunStep timing/status + Approval decisions +
 * Clarification prompts. Adds ZERO AI invocations (ADR-001) — pure aggregation.
 *
 * Same rows ⇒ same timeline. This is also a building block for Story Replay: the
 * ordered event stream is the audit trail of what happened, when, and how long.
 */

// Accepts Prisma Date objects, ISO strings, or null — normalized internally.
type TimeInput = Date | string | number | null | undefined;

export interface ActivityStepInput {
  name: string;
  type: string; // code | ai | gate | ask
  status: string;
  ordinal: number;
  startedAt?: TimeInput;
  finishedAt?: TimeInput;
  tokens?: number;
  costUsd?: number;
  approval?: { action?: string; decision?: string | null; createdAt?: TimeInput; decidedAt?: TimeInput } | null;
  clarification?: { createdAt?: TimeInput; answeredAt?: TimeInput } | null;
}

/**
 * A single Run.status transition (Run Lifecycle Management). `reason` carries
 * either the pause reason (gate|ask|credential|manual|usage_limit, when status
 * is 'paused'/'pausing') or the resume-cause (resume|retry|restart|
 * version_drift, when status is 'queued'/'running') — see REASON_KIND below
 * for the exact mapping. Sourced from the RunStatusEvent table, written once
 * per transition by RunsService.ingest()'s 'run.status' case.
 */
export interface ActivityStatusEventInput {
  status: string;
  reason?: string | null;
  at: TimeInput;
}

export interface ActivityTimelineInput {
  run: { createdAt?: TimeInput; startedAt?: TimeInput; finishedAt?: TimeInput; status?: string };
  steps: ActivityStepInput[];
  statusEvents?: ActivityStatusEventInput[];
}

export type ActivityKind =
  | 'run_created' | 'run_started' | 'node_started' | 'node_finished' | 'node_failed'
  | 'gate_awaiting' | 'gate_approved' | 'gate_rejected'
  | 'clarification_asked' | 'clarification_answered' | 'run_finished'
  // Run Lifecycle Management transitions (sourced from RunStatusEvent):
  | 'run_paused' | 'run_auto_paused' | 'run_resumed' | 'run_retried'
  | 'run_restarted' | 'run_cancelled' | 'run_version_drift';

/**
 * Maps a RunStatusEvent's (status, reason) to the ActivityKind it renders as.
 * Deliberately narrow: gate/ask/credential pauses are already visible via
 * gate_awaiting/clarification_asked, so they're intentionally NOT duplicated
 * here — only tester/system-initiated lifecycle actions get their own entry.
 */
const REASON_KIND: Record<string, ActivityKind> = {
  'paused:manual': 'run_paused',
  'paused:usage_limit': 'run_auto_paused',
  'queued:resume': 'run_resumed',
  'queued:retry': 'run_retried',
  'queued:restart': 'run_restarted',
};

export interface ActivityEvent {
  ts: string | null; // ISO 8601 (null ⇒ not yet reached; sorts last)
  kind: ActivityKind;
  node?: string;
  ordinal?: number;
  label: string;
  status?: string;
  durationMs?: number | null;
}

export interface ActivityMilestone {
  key: string;
  label: string;
  at: string | null;
  durationMs?: number | null;
}

export interface ActivityTimeline {
  events: ActivityEvent[];
  milestones: ActivityMilestone[];
  nodeCount: number;
  completedCount: number;
  failedCount: number;
  gateCount: number;
  totalDurationMs: number | null;
}

function toIso(v: TimeInput): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : d.toISOString();
}
function ms(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return new Date(b).getTime() - new Date(a).getTime();
}

// Tiebreak order when two events share a timestamp (and ordinal): a node starts
// before it finishes; a gate is asked before it is decided; the run frames all.
const KIND_ORDER: Record<ActivityKind, number> = {
  run_created: 0, run_started: 1, node_started: 2, clarification_asked: 3, clarification_answered: 4,
  gate_awaiting: 5, gate_approved: 6, gate_rejected: 6, node_finished: 7, node_failed: 7, run_finished: 8,
  run_paused: 9, run_auto_paused: 9, run_cancelled: 9,
  run_resumed: 10, run_retried: 10, run_restarted: 10, run_version_drift: 10,
};

const HUMAN_NODE = (n: string) => n.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Build the deterministic activity timeline for a run. Pure. */
export function buildActivityTimeline(input: ActivityTimelineInput): ActivityTimeline {
  const events: ActivityEvent[] = [];
  const runCreated = toIso(input.run.createdAt);
  const runStarted = toIso(input.run.startedAt);
  const runFinished = toIso(input.run.finishedAt);

  if (runCreated) events.push({ ts: runCreated, kind: 'run_created', label: 'Run created' });
  if (runStarted) events.push({ ts: runStarted, kind: 'run_started', label: 'Run started' });

  let completedCount = 0;
  let failedCount = 0;
  let gateCount = 0;

  const steps = [...input.steps].sort((a, b) => a.ordinal - b.ordinal);
  for (const s of steps) {
    const startedAt = toIso(s.startedAt);
    const finishedAt = toIso(s.finishedAt);
    const dur = ms(startedAt, finishedAt);
    const human = HUMAN_NODE(s.name);

    if (startedAt) {
      events.push({ ts: startedAt, kind: 'node_started', node: s.name, ordinal: s.ordinal, label: `${human} started` });
    }
    if (s.status === 'succeeded') {
      completedCount++;
      events.push({ ts: finishedAt, kind: 'node_finished', node: s.name, ordinal: s.ordinal, status: s.status, durationMs: dur, label: `${human} completed` });
    } else if (s.status === 'failed') {
      failedCount++;
      events.push({ ts: finishedAt, kind: 'node_failed', node: s.name, ordinal: s.ordinal, status: s.status, durationMs: dur, label: `${human} failed` });
    }

    if (s.approval) {
      gateCount++;
      const created = toIso(s.approval.createdAt);
      const decided = toIso(s.approval.decidedAt);
      const action = s.approval.action ? ` (${s.approval.action})` : '';
      events.push({ ts: created, kind: 'gate_awaiting', node: s.name, ordinal: s.ordinal, label: `Approval requested${action}` });
      if (s.approval.decision === 'approved') {
        events.push({ ts: decided, kind: 'gate_approved', node: s.name, ordinal: s.ordinal, label: `Approved${action}` });
      } else if (s.approval.decision === 'rejected') {
        events.push({ ts: decided, kind: 'gate_rejected', node: s.name, ordinal: s.ordinal, label: `Rejected${action}` });
      }
    }

    if (s.clarification) {
      const created = toIso(s.clarification.createdAt);
      const answered = toIso(s.clarification.answeredAt);
      events.push({ ts: created, kind: 'clarification_asked', node: s.name, ordinal: s.ordinal, label: `${human} — clarification requested` });
      if (answered) events.push({ ts: answered, kind: 'clarification_answered', node: s.name, ordinal: s.ordinal, label: `${human} — clarification answered` });
    }
  }

  if (runFinished) {
    events.push({ ts: runFinished, kind: 'run_finished', status: input.run.status, durationMs: ms(runStarted, runFinished), label: `Run ${input.run.status ?? 'finished'}` });
  }

  // Run Lifecycle Management: pause/resume/retry/restart/cancel transitions.
  // `reason==='version_drift'` is independent of status (logged alongside a
  // resume when the run's stamped versions differ from the platform's current
  // ones) and always renders regardless of the status:reason lookup below.
  const LABEL: Partial<Record<ActivityKind, string>> = {
    run_paused: 'Run paused',
    run_auto_paused: 'Paused automatically — Claude usage limit reached',
    run_resumed: 'Run resumed',
    run_retried: 'Retrying failed step',
    run_restarted: 'Restarted from an earlier step',
    run_cancelled: 'Run cancelled',
    run_version_drift: 'Resumed under an updated platform version',
  };
  for (const se of input.statusEvents ?? []) {
    const ts = toIso(se.at);
    if (se.reason === 'version_drift') {
      events.push({ ts, kind: 'run_version_drift', label: LABEL.run_version_drift! });
      continue;
    }
    const kind = se.status === 'cancelled' ? 'run_cancelled' : REASON_KIND[`${se.status}:${se.reason ?? ''}`];
    if (kind) events.push({ ts, kind, label: LABEL[kind]! });
  }

  // Deterministic chronological order; unresolved (null ts) events sort last but
  // keep their logical order via ordinal + kind priority.
  events.sort((a, b) => {
    if (a.ts && b.ts && a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
    if (!!a.ts !== !!b.ts) return a.ts ? -1 : 1;
    return (a.ordinal ?? -1) - (b.ordinal ?? -1) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });

  // Curated milestones — the high-level "what happened" markers.
  const first = (kinds: ActivityKind[], node?: string) =>
    events.find((e) => kinds.includes(e.kind) && (!node || e.node === node)) ?? null;
  const milestoneDefs: Array<{ key: string; label: string; ev: ActivityEvent | null }> = [
    { key: 'created', label: 'Run created', ev: first(['run_created']) },
    { key: 'requirements', label: 'Analysis started', ev: first(['node_finished'], 'requirements_analysis') },
    { key: 'testcases', label: 'Test cases generated', ev: first(['node_finished'], 'generate_testcases') },
    { key: 'execution', label: 'Execution complete', ev: first(['node_finished'], 'execution') },
    { key: 'report', label: 'Report generated', ev: first(['node_finished'], 'html_report') },
    { key: 'finished', label: 'Run finished', ev: first(['run_finished']) },
  ];
  const milestones: ActivityMilestone[] = milestoneDefs
    .filter((m) => m.ev)
    .map((m) => ({ key: m.key, label: m.label, at: m.ev!.ts, durationMs: m.ev!.durationMs ?? null }));

  return {
    events,
    milestones,
    nodeCount: steps.length,
    completedCount,
    failedCount,
    gateCount,
    totalDurationMs: ms(runStarted, runFinished),
  };
}
