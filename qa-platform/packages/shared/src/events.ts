/**
 * Workflow run event protocol.
 * The worker emits these as it executes the graph; the API relays them over
 * SSE (GET /runs/:id/events); the web RunTimeline patches its cache from them.
 * This is the single source of truth for the live-progress wire format.
 */
import type { RunStatus, StepStatus, StepType, GatedAction } from './domain.js';

export type RunEvent =
  | { kind: 'run.status'; runId: string; status: RunStatus; at: string }
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
    };

export type RunEventKind = RunEvent['kind'];

/** Helper to stamp events without Date.now scattered through node code. */
export function makeEvent<T extends RunEvent>(e: Omit<T, 'at'>): T {
  return { ...(e as object), at: new Date().toISOString() } as T;
}
