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
  'paused', // blocked on a gate or clarification
  'cancelling', // stop requested; worker's poller will abort the active step
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

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
