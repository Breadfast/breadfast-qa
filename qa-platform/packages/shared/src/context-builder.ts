/**
 * Context Builder (Run Lifecycle Management) — deterministically reconstructs
 * a run's working state from PERSISTED RunStep.outputJson rows. No AI (ADR-001).
 *
 * This is not a new capability so much as a promotion: the worker's runner
 * already called this on EVERY execution — a fresh run and a resume ran the
 * exact same code path — because every node is a stateless, one-shot `claude
 * -p` call whose prompt is rebuilt from whatever upstream state this function
 * assembles. Moving it here (out of apps/worker, where it was a private
 * `hydrate()` helper) makes that guarantee explicit and independently
 * testable: resuming a run never depends on anything a Claude session or a
 * worker process remembered — only on what's in the database.
 */

/** Minimal shape needed to build context — RunDetail/StepDetail satisfy this structurally. */
export interface ContextBuilderStory {
  jiraKey: string;
  platform: string;
  locales: string;
  environment?: string | null;
  appUrl?: string | null;
  adminUrl?: string | null;
  bsAppIds?: unknown;
  devices?: unknown;
  executionType?: string | null;
  packageNumbers?: string | null;
  notes?: string | null;
}
export interface ContextBuilderStep {
  name: string;
  status: string;
  outputJson?: unknown;
}
export interface ContextBuilderRun {
  story: ContextBuilderStory;
  steps: ContextBuilderStep[];
}

/** Lifecycle node name → state key under which its output is reassembled. */
export const STATE_KEYS: Record<string, string> = {
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

/**
 * Rebuild the in-memory `state` object a node's prompt is built from, purely
 * from persisted, succeeded steps' outputJson. Pure and deterministic: same
 * rows in, same state out — called identically whether this is node #1 of a
 * brand-new run or node #15 of a run resumed days later on a different machine.
 */
export function buildRunContext(run: ContextBuilderRun): Record<string, unknown> {
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
