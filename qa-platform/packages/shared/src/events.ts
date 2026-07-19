/**
 * Workflow run event protocol.
 * The worker emits these as it executes the graph; the API relays them over
 * SSE (GET /runs/:id/events); the web RunTimeline patches its cache from them.
 * This is the single source of truth for the live-progress wire format.
 */
import type { RunStatus, RunPauseReason, StepStatus, StepType, GatedAction } from './domain.js';

/**
 * Structured failure diagnostics captured when a step's status becomes 'failed'
 * or 'interrupted' — persisted to RunStep.errorJson so the Failure Details UI
 * panel doesn't need to parse the free-text `logs` blob. `stack` is sanitized
 * (secrets redacted) before it ever leaves the worker.
 */
export interface StepError {
  message: string;
  isTimeout: boolean;
  durationMs: number;
  stack?: string;
}

/**
 * A single credential a node discovered it needs mid-run. Self-documenting so
 * the run page can render the same "friendly name / why / where to get it"
 * affordances as the Settings page, without the tester leaving the run.
 */
export type CredentialSpec = {
  key: string;          // canonical settings key, e.g. "browserstack.username"
  label: string;        // friendly display name
  description: string;  // one sentence: what it is used for
  whenUsed: string;     // the step that needs it (usually "Used now, to …")
  secret: boolean;      // render as a password field + store masked
  group: string;        // storage group (SETTING_GROUPS) when saved
  obtainText?: string;  // "How to get this" copy
  obtainUrl?: string;   // optional external guide link
};

export type RunEvent =
  | {
      kind: 'run.status';
      runId: string;
      status: RunStatus;
      /** Set when status is (becoming) 'paused'/'pausing'; cleared otherwise. */
      reason?: RunPauseReason;
      at: string;
    }
  | {
      kind: 'step.started';
      runId: string;
      stepId: string;
      name: string;
      type: StepType;
      at: string;
    }
  | {
      kind: 'step.log';
      runId: string;
      stepId: string;
      line: string;
      at: string;
    }
  | {
      kind: 'step.finished';
      runId: string;
      stepId: string;
      status: StepStatus;
      output?: unknown;
      tokens?: number;
      costUsd?: number;
      /** Present when status is 'failed' or 'interrupted'. */
      error?: StepError;
      at: string;
    }
  | {
      // A gate is waiting for tester approval before an external write.
      kind: 'gate.awaiting';
      runId: string;
      stepId: string;
      action: GatedAction;
      summary: string;
      payloadPreview: unknown;
      at: string;
    }
  | {
      // A clarification step is waiting for tester answers.
      kind: 'ask.awaiting';
      runId: string;
      stepId: string;
      questions: Array<{ id: string; question: string; why?: string }>;
      at: string;
    }
  | {
      // A node needs a credential that isn't configured yet. The run pauses and
      // the tester can supply it Once, Save it to Settings, or Cancel the run.
      kind: 'credential.awaiting';
      runId: string;
      stepId: string;
      reason: string;               // why the run needs these now
      credentials: CredentialSpec[]; // the missing credentials
      at: string;
    };

export type RunEventKind = RunEvent['kind'];

/** Helper to stamp events without Date.now scattered through node code. */
export function makeEvent<T extends RunEvent>(e: Omit<T, 'at'>): T {
  return { ...(e as object), at: new Date().toISOString() } as T;
}
