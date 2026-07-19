/**
 * Core domain enums + types for the Breadfast QA Platform.
 * Mirrors the entities in packages/db/prisma/schema.prisma. Keep in sync.
 */

export const PLATFORMS = ['web', 'android', 'ios', 'cross-platform', 'web-mobile'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  web: 'Web',
  android: 'Android',
  ios: 'iOS',
  'cross-platform': 'Cross Platform (Android + iOS)',
  'web-mobile': 'Web + Mobile',
};

/** Which inputs a platform needs — drives the wizard's conditional fields. */
export function platformNeeds(p: Platform) {
  const mobile = p === 'android' || p === 'ios' || p === 'cross-platform' || p === 'web-mobile';
  return {
    web: p === 'web' || p === 'web-mobile',
    android: p === 'android' || p === 'cross-platform' || p === 'web-mobile',
    ios: p === 'ios' || p === 'cross-platform' || p === 'web-mobile',
    mobile,
    adminUrlOptional: mobile, // mobile may have an admin/web portal
  };
}

export const LOCALES = ['en-US', 'ar-EG'] as const;
export type Locale = (typeof LOCALES)[number];

export const ENVIRONMENTS = ['testing', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const EXECUTION_TYPES = ['full', 'smoke', 'regression'] as const;
export type ExecutionType = (typeof EXECUTION_TYPES)[number];

/** Login OTP from Slack #testing-otp; card OTP = last 4 of phone; or manual. */
export const OTP_METHODS = ['slack', 'device-last4', 'manual', 'none'] as const;
export type OtpMethod = (typeof OTP_METHODS)[number];

/** Default devices per CLAUDE.md §7. */
export const DEFAULT_DEVICES = {
  android: 'Samsung Galaxy S23 / Android 13',
  ios: 'iPhone 14 / iOS 18',
} as const;

export const TEST_DATA_TYPES = ['phone', 'package', 'account', 'card', 'otp'] as const;
export type TestDataType = (typeof TEST_DATA_TYPES)[number];

export const TEST_DATA_STATUSES = ['available', 'reserved', 'consumed'] as const;
export type TestDataStatus = (typeof TEST_DATA_STATUSES)[number];

export const SETTING_GROUPS = ['jira', 'browserstack', 'figma', 'ai', 'automation', 'integrations'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const USER_ROLES = ['tester', 'lead', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STORY_STATUSES = [
  'draft',
  'analyzing',
  'awaiting_approval',
  'ready',
  'executing',
  'reported',
  'signed_off',
  'archived',
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'paused', // blocked on a gate/clarification/credential, a manual Pause, or an
            // auto-pause (usage limit) — see Run.pauseReason for which
  'pausing', // graceful-stop requested; worker finishes the in-flight step
             // normally, then stops before starting the next one (cf. 'cancelling',
             // which aborts the in-flight step immediately)
  'cancelling', // stop requested; worker's poller will abort the active step
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Why a Run is currently 'paused' — drives the Run Details pause banner/copy. */
export const RUN_PAUSE_REASONS = ['gate', 'ask', 'credential', 'manual', 'usage_limit'] as const;
export type RunPauseReason = (typeof RUN_PAUSE_REASONS)[number];

/** A workflow node is one of four kinds — see docs ARCHITECTURE.md §UX Flow. */
export const STEP_TYPES = ['code', 'ai', 'gate', 'ask'] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const STEP_STATUSES = [
  'pending',
  'running',
  'awaiting_input', // ask
  'awaiting_approval', // gate
  'succeeded',
  'rejected',
  'failed',
  'skipped',
  'cancelled', // interrupted by a Stop request; NOT terminal — a resume re-executes it
  'interrupted', // interrupted by a system-detected pause (e.g. Claude usage limit);
                 // NOT terminal — a resume re-executes it. Distinct from 'cancelled'
                 // so the UI never implies the tester stopped it themselves.
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * Gated actions. Two kinds:
 *  - external writes (jira.* / browserstack.*) — always gated.
 *  - review.* checkpoints (M1b) — pure human-review gates, no external write;
 *    configurable per project/story, default ON.
 */
export const GATED_ACTIONS = [
  'review.requirements',
  'jira.push_hls',
  'review.testcases',
  'browserstack.upload_testcases',
  'review.exploratory',
  'review.automation',
  'review.report',
  'jira.file_bug',
  'review.figma_export',
] as const;
export type GatedAction = (typeof GATED_ACTIONS)[number];

/** review.* gates are human-review checkpoints (no external write). */
export const REVIEW_GATES = [
  'review.requirements',
  'review.testcases',
  'review.exploratory',
  'review.automation',
  'review.report',
  'review.figma_export',
] as const;

export const ARTIFACT_KINDS = [
  'report',
  'screenshot',
  'video',
  'csv',
  'trace',
  'evidence',
  'figma_frame',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const INTEGRATION_PROVIDERS = ['jira', 'figma', 'slack'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

// ── Framework Registry (Phase D) ─────────────────────────────────────────────
export const FRAMEWORK_TYPES = ['playwright', 'appium', 'java-appium', 'api', 'other'] as const;
export type FrameworkType = (typeof FRAMEWORK_TYPES)[number];

export const FRAMEWORK_PLATFORMS = ['web', 'android', 'ios', 'mobile', 'api', 'cross-platform'] as const;
export type FrameworkPlatform = (typeof FRAMEWORK_PLATFORMS)[number];

export const FRAMEWORK_VALIDATION_STATUSES = ['valid', 'invalid', 'not-found', 'unscanned'] as const;
export type FrameworkValidationStatus = (typeof FRAMEWORK_VALIDATION_STATUSES)[number];

/**
 * The full QA lifecycle graph — one node per phase of the established QA
 * Companion process (CLAUDE.md §2 STEP 0–7 + §3/§4 web/mobile lifecycle).
 * Shared by API (seeding run steps) + worker (execution).
 */
export const LIFECYCLE_NODES = [
  'create_workspace', //        STEP 0 — artifact folder
  'fetch_jira', //              Story Retrieval (real Jira REST)
  'parse_instructions', //      compile Execution Instructions → directives
  'requirements_analysis', //   STEP 1
  'acceptance_criteria', //     AC analysis
  'comments_analysis', //       comments may override AC
  'linked_stories', //          related tickets / linked docs
  'figma_analysis', //          STEP 2 (FigmaExporter REST)
  'detect_prerequisites', //    ask for genuinely-missing test data / deps
  'clarification', //           STEP 3 (only if genuinely missing)
  'impact_analysis', //         STEP 4
  'review_requirements', //     M1b review gate (approve analysis)
  'generate_hls', //            STEP 5
  'gate_push_hls', //           STEP 5 write → Jira checklist
  'generate_testcases', //      STEP 6
  'review_testcases', //        M1b review gate (approve cases)
  'generate_csv', //            STEP 7 (CSV)
  'gate_upload_browserstack', // STEP 7 write → BrowserStack
  'exploratory_testing', //     §3.2 exploratory charters
  'review_exploratory', //      review gate (approve exploratory notes)
  'automation_generation', //   automation (reuse-before-build)
  'review_automation', //       M1b review gate (approve automation)
  'execution', //               execution (web Playwright / mobile 4-combo)
  'html_report', //             HTML report
  'review_report', //           review gate (approve the report before bug filing)
  'gate_file_bugs', //          defect reporting → Jira
  'knowledge_update', //        knowledge base update
] as const;
export type LifecycleNode = (typeof LIFECYCLE_NODES)[number];

export interface NodeDef {
  name: LifecycleNode;
  type: StepType;
  label: string;
}

export const LIFECYCLE_GRAPH: NodeDef[] = [
  { name: 'create_workspace', type: 'code', label: 'Create workspace' },
  { name: 'fetch_jira', type: 'code', label: 'Story retrieval (Jira)' },
  { name: 'parse_instructions', type: 'ai', label: 'Parse execution instructions' },
  { name: 'requirements_analysis', type: 'ai', label: 'Requirements analysis' },
  { name: 'acceptance_criteria', type: 'ai', label: 'Acceptance criteria' },
  { name: 'comments_analysis', type: 'ai', label: 'Comments analysis' },
  { name: 'linked_stories', type: 'ai', label: 'Linked stories' },
  { name: 'figma_analysis', type: 'ai', label: 'Figma analysis' },
  { name: 'detect_prerequisites', type: 'ask', label: 'Collect missing prerequisites' },
  { name: 'clarification', type: 'ask', label: 'Clarification (if needed)' },
  { name: 'impact_analysis', type: 'ai', label: 'Impact analysis' },
  { name: 'review_requirements', type: 'gate', label: 'Review → approve analysis' },
  { name: 'generate_hls', type: 'ai', label: 'High-level scenarios' },
  { name: 'gate_push_hls', type: 'gate', label: 'Approve → push HLS to Jira' },
  { name: 'generate_testcases', type: 'ai', label: 'BrowserStack test cases' },
  { name: 'review_testcases', type: 'gate', label: 'Review → approve test cases' },
  { name: 'generate_csv', type: 'code', label: 'Generate CSV' },
  { name: 'gate_upload_browserstack', type: 'gate', label: 'Approve → upload to BrowserStack' },
  { name: 'exploratory_testing', type: 'ai', label: 'Exploratory testing' },
  { name: 'review_exploratory', type: 'gate', label: 'Review → approve exploratory notes' },
  { name: 'automation_generation', type: 'ai', label: 'Automation generation' },
  { name: 'review_automation', type: 'gate', label: 'Review → approve automation' },
  { name: 'execution', type: 'code', label: 'Execution' },
  { name: 'html_report', type: 'code', label: 'HTML report' },
  { name: 'review_report', type: 'gate', label: 'Review → approve report' },
  { name: 'gate_file_bugs', type: 'gate', label: 'Bug reporting' },
  { name: 'knowledge_update', type: 'ai', label: 'Knowledge base update' },
];

/**
 * Maps a review/approval gate to the upstream node whose output it is
 * reviewing. "Regenerate" on a gate resets THIS node (and everything after
 * it, through the gate) back to pending with tester feedback threaded in —
 * not the gate itself, which has no content of its own to regenerate.
 * Gates absent from this map (e.g. `gate_file_bugs`, derived from the
 * expensive `execution` node) only support Approve/Reject, not Regenerate.
 */
export const GATE_SOURCE: Partial<Record<LifecycleNode, LifecycleNode>> = {
  review_requirements: 'requirements_analysis',
  gate_push_hls: 'generate_hls',
  review_testcases: 'generate_testcases',
  gate_upload_browserstack: 'generate_csv',
  review_exploratory: 'exploratory_testing',
  review_automation: 'automation_generation',
  review_report: 'html_report',
};

// ── Workflow Registry & Versioning (Phase 1 #3) ───────────────────────────
/** Bump when the lifecycle graph (nodes, order, types, or gates) changes. */
export const LIFECYCLE_VERSION = '1.0.0';
/** Platform app/run-shape version — bump on a breaking change to run structure. */
export const PLATFORM_VERSION = '0.1.0';

/**
 * Declarative per-node requirements used to build the Workflow Definition
 * manifest (see workflow.ts). Approvals are derived from node.type==='gate', so
 * only credential + integration requirements are encoded here. This DESCRIBES
 * the workflow; it does not drive execution (execution still follows
 * LIFECYCLE_GRAPH). Dynamic/registry-driven execution is intentionally deferred.
 */
export interface NodeRequirements {
  credentials?: string[]; // Settings keys / credential categories a node needs
  integrations?: string[]; // jira | figma | browserstack | playwright | slack
}
export const NODE_REQUIREMENTS: Partial<Record<LifecycleNode, NodeRequirements>> = {
  fetch_jira: { integrations: ['jira'] },
  figma_analysis: { integrations: ['figma'] },
  gate_push_hls: { integrations: ['jira'] },
  gate_upload_browserstack: {
    credentials: ['browserstack.username', 'browserstack.accessKey'],
    integrations: ['browserstack'],
  },
  exploratory_testing: { integrations: ['playwright'] },
  execution: { integrations: ['playwright', 'browserstack'] },
  gate_file_bugs: { integrations: ['jira'] },
};

/**
 * Tester-facing grouping of the lifecycle graph into selectable PHASES. The New
 * Story wizard renders one checkbox per phase; each maps to its underlying
 * node(s) + the review gate that belongs to it. `mandatory` phases always run
 * (setup/retrieval) and are not shown as unchecking options.
 *
 * `requires` lists other phase keys this phase depends on: unchecking a
 * dependency cascades to uncheck its dependents (a phase can't run without the
 * data an earlier phase produces — e.g. Execution needs Test cases).
 */
export interface LifecyclePhase {
  key: string;
  label: string;
  description: string;
  nodes: LifecycleNode[];
  mandatory?: boolean;
  requires?: string[];
}

export const LIFECYCLE_PHASES: LifecyclePhase[] = [
  {
    key: 'setup',
    label: 'Setup & story retrieval',
    description: 'Create the workspace, fetch the Jira story, compile execution instructions.',
    nodes: ['create_workspace', 'fetch_jira', 'parse_instructions'],
    mandatory: true,
  },
  {
    key: 'requirements',
    label: 'Requirements & impact analysis',
    description: 'Requirements, AC, comments, linked stories, prerequisites, clarification, impact.',
    nodes: [
      'requirements_analysis', 'acceptance_criteria', 'comments_analysis', 'linked_stories',
      'detect_prerequisites', 'clarification', 'impact_analysis', 'review_requirements',
    ],
  },
  {
    key: 'figma',
    label: 'Figma analysis',
    description: 'Fetch and analyze the design frames (design vs. requirements).',
    nodes: ['figma_analysis'],
  },
  {
    key: 'hls',
    label: 'High-level scenarios (HLS)',
    description: 'Generate HLS and push them to the Jira checklist.',
    nodes: ['generate_hls', 'gate_push_hls'],
  },
  {
    key: 'testcases',
    label: 'Test cases',
    description: 'Generate the detailed BrowserStack test cases.',
    nodes: ['generate_testcases', 'review_testcases'],
  },
  {
    key: 'browserstack',
    label: 'BrowserStack upload',
    description: 'Build the CSV and upload the cases to BrowserStack.',
    nodes: ['generate_csv', 'gate_upload_browserstack'],
    requires: ['testcases'],
  },
  {
    key: 'exploratory',
    label: 'Exploratory testing',
    description: 'Exploratory charters and notes.',
    nodes: ['exploratory_testing', 'review_exploratory'],
  },
  {
    key: 'automation',
    label: 'Automation generation',
    description: 'Generate the story-specific automation specs (reuse-before-build).',
    nodes: ['automation_generation', 'review_automation'],
    requires: ['testcases'],
  },
  {
    key: 'execution',
    label: 'Execution',
    description: 'Execute the test cases against the live app / device.',
    nodes: ['execution'],
    requires: ['testcases'],
  },
  {
    key: 'report',
    label: 'HTML report',
    description: 'Generate the HTML execution report.',
    nodes: ['html_report', 'review_report'],
  },
  {
    key: 'defects',
    label: 'File defects',
    description: 'File the defects found during execution to Jira.',
    nodes: ['gate_file_bugs'],
    requires: ['execution'],
  },
  {
    key: 'knowledge',
    label: 'Knowledge base update',
    description: 'Persist reusable knowledge learned from this story.',
    nodes: ['knowledge_update'],
  },
];

/** Phase keys enabled by default (everything). */
export const DEFAULT_PHASE_KEYS = LIFECYCLE_PHASES.map((p) => p.key);

/**
 * Expand a set of selected phase keys into the concrete lifecycle nodes to run.
 * Mandatory phases are always included. Unknown keys are ignored. Returns the
 * nodes in canonical LIFECYCLE_NODES order.
 */
export function phasesToNodes(selectedPhaseKeys: string[]): LifecycleNode[] {
  const selected = new Set(selectedPhaseKeys);
  const enabled = new Set<LifecycleNode>();
  for (const phase of LIFECYCLE_PHASES) {
    if (phase.mandatory || selected.has(phase.key)) {
      for (const n of phase.nodes) enabled.add(n);
    }
  }
  return LIFECYCLE_NODES.filter((n) => enabled.has(n));
}

/**
 * Cascade dependency rules over a selection: if a phase's required dependency is
 * off, the phase is forced off too. Iterates to a fixpoint so chains resolve
 * (e.g. testcases off → execution off → defects off). Returns the cleaned set.
 */
export function resolvePhaseSelection(selectedPhaseKeys: string[]): string[] {
  const selected = new Set(selectedPhaseKeys.filter((k) => !LIFECYCLE_PHASES.find((p) => p.key === k)?.mandatory));
  let changed = true;
  while (changed) {
    changed = false;
    for (const phase of LIFECYCLE_PHASES) {
      if (!selected.has(phase.key) || !phase.requires) continue;
      if (phase.requires.some((dep) => !selected.has(dep))) {
        selected.delete(phase.key);
        changed = true;
      }
    }
  }
  return LIFECYCLE_PHASES.filter((p) => !p.mandatory && selected.has(p.key)).map((p) => p.key);
}

/**
 * Selectable models for the execution step. Value = model id passed to the
 * Claude CLI; the empty string means "use the platform default".
 */
export const EXECUTION_MODELS = [
  { value: '', label: 'Platform default (Sonnet 5)' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8 — most capable' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5 — balanced' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fast & cheap' },
] as const;
export const EXECUTION_MODEL_IDS = EXECUTION_MODELS.map((m) => m.value).filter(Boolean) as string[];

/**
 * Full Claude model catalog for the Settings dropdowns (primary + fast model).
 * Ordered most→least capable. The Settings picker also injects whatever value is
 * currently saved if it isn't in this list, so custom/older model ids never break.
 */
export const CLAUDE_MODELS = [
  { value: 'claude-opus-4-8', label: 'Opus 4.8 — most capable' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5 — balanced' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fast & cheap' },
  { value: 'claude-fable-5', label: 'Fable 5' },
] as const;
