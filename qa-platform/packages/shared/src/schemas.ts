/**
 * Zod schemas — the validation layer shared by api, worker, web, and engine.
 * The AI engine is forced to return output matching the *result* schemas below,
 * so reasoning-step output is validated at the boundary (retry on mismatch).
 */
import { z } from 'zod';
import {
  PLATFORMS,
  LOCALES,
  ENVIRONMENTS,
  EXECUTION_TYPES,
  OTP_METHODS,
  TEST_DATA_TYPES,
  TEST_DATA_STATUSES,
  SETTING_GROUPS,
  GATED_ACTIONS,
  FRAMEWORK_TYPES,
  FRAMEWORK_PLATFORMS,
  FRAMEWORK_VALIDATION_STATUSES,
  platformNeeds,
  type Platform,
} from './domain.js';

// ── Story credentials (collected once in the wizard) ──────────────────────
export const StoryCredentials = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  otpMethod: z.enum(OTP_METHODS).default('slack'),
  extra: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
});
export type StoryCredentials = z.infer<typeof StoryCredentials>;

// ── Wizard input — everything the tester provides once ────────────────────
export const CreateStoryInput = z
  .object({
    // General
    jiraKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/, 'Expected a Jira key like B10-56336'),
    platform: z.enum(PLATFORMS),
    environment: z.enum(ENVIRONMENTS).default('testing'),
    locales: z.array(z.enum(LOCALES)).min(1).default(['en-US', 'ar-EG']),
    notes: z.string().optional(),
    // Application
    appUrl: z.string().url().optional(), // web
    adminUrl: z.string().url().optional(), // optional admin/web portal for mobile
    bsAppIds: z
      .object({ android: z.string().optional(), ios: z.string().optional() })
      .default({}),
    devices: z
      .object({ android: z.string().optional(), ios: z.string().optional() })
      .optional(),
    // Credentials
    credentials: StoryCredentials.optional(),
    // BrowserStack
    bsFolderId: z.string().optional(),
    executionType: z.enum(EXECUTION_TYPES).default('full'),
    // Automation / test data
    testDataFile: z.string().optional(),
    packageNumbers: z.string().optional(),
    // Runtime guidance — story-specific AI guidance + extra data that doesn't fit
    // a field. parse_instructions compiles executionInstructions into directives;
    // both are threaded into every node's context.
    executionInstructions: z.string().optional(),
    additionalInputs: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const needs = platformNeeds(data.platform as Platform);
    if (needs.web && !data.appUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['appUrl'], message: 'Application URL is required for web stories' });
    }
    if (needs.android && !data.bsAppIds.android) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bsAppIds', 'android'], message: 'Android BrowserStack App ID is required' });
    }
    if (needs.ios && !data.bsAppIds.ios) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bsAppIds', 'ios'], message: 'iOS BrowserStack App ID is required' });
    }
  });
export type CreateStoryInput = z.infer<typeof CreateStoryInput>;

// ── Settings ──────────────────────────────────────────────────────────────
export const SettingUpsert = z.object({
  key: z.string().min(1),
  group: z.enum(SETTING_GROUPS),
  value: z.string().default(''),
  secret: z.boolean().default(false),
});
export const SettingsBulkUpsert = z.object({ settings: z.array(SettingUpsert) });
export type SettingUpsert = z.infer<typeof SettingUpsert>;

// ── Test data ─────────────────────────────────────────────────────────────
export const TestDataUpsert = z.object({
  id: z.string().optional(),
  type: z.enum(TEST_DATA_TYPES),
  label: z.string().min(1),
  value: z.record(z.string(), z.any()).default({}),
  status: z.enum(TEST_DATA_STATUSES).default('available'),
  notes: z.string().optional(),
});
export type TestDataUpsert = z.infer<typeof TestDataUpsert>;

// ── AI step result schemas (engine output contracts) ──────────────────────
export const RequirementsAnalysis = z.object({
  businessObjective: z.string(),
  functionalRequirements: z.array(z.string()),
  nonFunctionalRequirements: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  missingRequirements: z.array(z.string()).default([]),
  testabilityConcerns: z.array(z.string()).default([]),
  commentOverrides: z.array(z.string()).default([]),
});
export type RequirementsAnalysis = z.infer<typeof RequirementsAnalysis>;

export const ImpactAnalysis = z.object({
  impactedAreas: z.array(z.string()),
  regressionAreas: z.array(z.string()),
  smokeCoverage: z.array(z.string()),
  automationImpact: z.array(z.string()),
});
export type ImpactAnalysis = z.infer<typeof ImpactAnalysis>;

export const ClarificationQuestions = z.object({
  questions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string(),
        why: z.string().optional(),
        suggestedAnswers: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});
export type ClarificationQuestions = z.infer<typeof ClarificationQuestions>;

// parse_instructions output — the tester's free-text guidance compiled to structure.
export const Directives = z.object({
  onlyFlows: z.array(z.string()).default([]), // "Test only this flow"
  skipNodes: z.array(z.string()).default([]), // "Skip automation generation" → ["automation_generation","review_automation"]
  accountOverride: z.string().optional(), // "Use this account for all tests"
  packageNumbers: z.array(z.string()).default([]), // "Use package number PKG-12345"
  ignoreIssues: z.array(z.string()).default([]), // "Ignore known issue B10-12345"
  focus: z.array(z.string()).default([]), // "Focus on regression scenarios"
  platforms: z.array(z.string()).default([]), // "Validate only Android" → ["android"]
  maxHls: z.number().int().positive().optional(), // "no more than 20 HLS" → 20
  notes: z.string().default(''),
});
export type Directives = z.infer<typeof Directives>;

// detect_prerequisites output — ready=true means nothing blocking; else ask.
export const PrerequisiteCheck = z.object({
  ready: z.boolean().default(true),
  missing: z.array(z.object({ item: z.string(), why: z.string() })).default([]),
  questions: z
    .array(z.object({ id: z.string(), question: z.string(), why: z.string().optional() }))
    .default([]),
});
export type PrerequisiteCheck = z.infer<typeof PrerequisiteCheck>;

export const Hls = z.object({
  storyName: z.string(),
  scenarios: z
    .array(z.object({ index: z.number(), text: z.string() }))
    .min(1),
});
export type Hls = z.infer<typeof Hls>;

export const TestCaseStep = z.object({
  action: z.string(),
  expectedResult: z.string(),
});
// Canonical BrowserStack test-case fields (browserstack-process.md §10.0).
export const TestCase = z.object({
  title: z.string(),
  description: z.string().default(''),
  preconditions: z.string().default(''),
  type: z.enum(['Functional', 'Acceptance', 'Regression', 'Usability', 'Smoke & Sanity']).default('Functional'),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).default('Medium'),
  automationStatus: z.enum(['Not Automated', 'Automated', 'Automation Not Required']).default('Not Automated'),
  steps: z.array(TestCaseStep).min(1),
});
export const TestCases = z.object({ cases: z.array(TestCase).min(1) });
export type TestCases = z.infer<typeof TestCases>;

export const AcceptanceCriteria = z.object({
  criteria: z.array(z.object({ id: z.string(), text: z.string(), testable: z.boolean().default(true), notes: z.string().optional() })),
  gaps: z.array(z.string()).default([]),
});
export type AcceptanceCriteria = z.infer<typeof AcceptanceCriteria>;

export const CommentsAnalysis = z.object({
  overrides: z.array(z.string()).default([]), // comments that override/invalidate AC
  clarifications: z.array(z.string()).default([]),
  newRequirements: z.array(z.string()).default([]),
  notes: z.string().default(''),
});
export type CommentsAnalysis = z.infer<typeof CommentsAnalysis>;

export const LinkedStories = z.object({
  links: z.array(z.object({ key: z.string(), relationship: z.string(), impact: z.string().optional() })).default([]),
  notes: z.string().default(''),
});
export type LinkedStories = z.infer<typeof LinkedStories>;

// STEP 2 — Figma design analysis.
// Primary export: Playwright MCP batch export (Ctrl+Shift+E → ZIP).
// Fallback: REST API via FigmaExporter (rate-limited on View seat — Retry-After up to 77h).
export const FigmaAnalysis = z.object({
  analyzed: z.boolean().default(false),
  fileKey: z.string().optional(),
  frames: z
    .array(z.object({ name: z.string(), file: z.string().optional(), nodeId: z.string().optional() }))
    .default([]),
  screens: z.array(z.object({ name: z.string(), summary: z.string() })).default([]),
  states: z.array(z.string()).default([]), // default / filled / empty / error / loading depicted
  validations: z.array(z.string()).default([]), // validation rules visible in the design
  gaps: z.array(z.string()).default([]), // gaps / contradictions vs description·AC·comments
  missingStates: z.array(z.string()).default([]),
  localizationNotes: z.array(z.string()).default([]), // en-US + ar-EG (RTL, truncation, copy)
  uxFindings: z.array(z.string()).default([]),
  notes: z.string().default(''),
});
export type FigmaAnalysis = z.infer<typeof FigmaAnalysis>;

// Manifest returned by the Playwright MCP batch export agent (tryPlaywrightBatchExport).
export const FigmaExportManifest = z.object({
  frames: z.array(z.object({ name: z.string(), file: z.string() })).default([]),
  fileKey: z.string().optional(),
  error: z.string().optional(),
});
export type FigmaExportManifest = z.infer<typeof FigmaExportManifest>;

export const ExploratoryNotes = z.object({
  charters: z.array(z.object({ area: z.string(), idea: z.string() })).default([]),
  riskAreas: z.array(z.string()).default([]),
  fragileFlows: z.array(z.string()).default([]),
  // Populated only when a live browser session actually probed the app (web stories
  // with an appUrl). Absent/empty for mobile or when no app URL is configured — in
  // that case exploratory_testing produced charters only, no hands-on probing.
  findings: z.array(z.object({ area: z.string(), observation: z.string(), screenshot: z.string().optional() })).default([]),
  probed: z.boolean().default(false),
});
export type ExploratoryNotes = z.infer<typeof ExploratoryNotes>;

export const AutomationPlan = z.object({
  reusableAssets: z.array(z.string()).default([]), // existing page objects/helpers to reuse
  newPageObjects: z.array(z.string()).default([]),
  specs: z.array(z.object({ name: z.string(), framework: z.string(), description: z.string() })).default([]),
  notes: z.string().default(''),
});
export type AutomationPlan = z.infer<typeof AutomationPlan>;

export const KnowledgeUpdate = z.object({
  proposals: z.array(z.object({ docPath: z.string(), summary: z.string(), rationale: z.string() })).default([]),
});
export type KnowledgeUpdate = z.infer<typeof KnowledgeUpdate>;

// ── Execution results (Phase 2 — real run via Playwright MCP / bs_helper) ──
// A single test case's outcome on one platform·locale combo.
export const CaseResult = z.object({
  title: z.string(),
  status: z.enum(['pass', 'fail', 'blocked', 'skipped']),
  combo: z.string().default('web · en-US'), // "<platform> · <locale>"
  stepsRun: z.number().int().nonnegative().default(0),
  failedStep: z.string().optional(), // the step text where it failed/blocked
  expected: z.string().optional(),
  actual: z.string().optional(),
  evidence: z.array(z.string()).default([]), // screenshot/file paths captured
  notes: z.string().default(''),
});
export type CaseResult = z.infer<typeof CaseResult>;

// A defect discovered during execution → candidate Jira bug (bug-reporting.md).
export const Defect = z.object({
  title: z.string(),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']).default('Medium'),
  priority: z.enum(['Critical', 'High', 'Medium', 'Low']).default('Medium'),
  caseTitle: z.string().optional(), // the test case that surfaced it
  combo: z.string().default('web · en-US'),
  stepsToReproduce: z.array(z.string()).default([]),
  expected: z.string().default(''),
  actual: z.string().default(''),
  evidence: z.array(z.string()).default([]),
});
export type Defect = z.infer<typeof Defect>;

export const ExecutionResults = z.object({
  executed: z.boolean().default(true),
  matrix: z.array(z.string()).default([]), // combos actually run, e.g. ["web · en-US"]
  summary: z.object({
    total: z.number().int().nonnegative().default(0),
    passed: z.number().int().nonnegative().default(0),
    failed: z.number().int().nonnegative().default(0),
    blocked: z.number().int().nonnegative().default(0),
    skipped: z.number().int().nonnegative().default(0),
  }),
  cases: z.array(CaseResult).default([]),
  defects: z.array(Defect).default([]),
  notes: z.string().default(''),
});
export type ExecutionResults = z.infer<typeof ExecutionResults>;

// Result of the Jira HLS push (external write via Atlassian MCP).
export const JiraPushResult = z.object({
  posted: z.boolean().default(false),
  url: z.string().optional(),
  error: z.string().optional(),
});
export type JiraPushResult = z.infer<typeof JiraPushResult>;

// ── Gate / clarification responses (from the UI) ──────────────────────────
export const ApproveGateInput = z.object({
  action: z.enum(GATED_ACTIONS),
  decision: z.enum(['approved', 'rejected']),
  feedback: z.string().optional(), // routed back to the AI node on reject
});
export type ApproveGateInput = z.infer<typeof ApproveGateInput>;

export const AnswerClarificationInput = z.object({
  answers: z.array(z.object({ id: z.string(), answer: z.string() })),
});
export type AnswerClarificationInput = z.infer<typeof AnswerClarificationInput>;

// Regenerate: reset a gate's upstream source node forward with tester feedback threaded in.
export const RegenerateStepInput = z.object({
  feedback: z.string().min(1, 'feedback is required to regenerate'),
});
export type RegenerateStepInput = z.infer<typeof RegenerateStepInput>;

// Runtime credential prompt: the tester's response to a `credential.awaiting`
// pause. `use-once` threads the values into just this run; `save` also persists
// them to Settings for future stories; `cancel` stops the run.
export const SubmitCredentialInput = z.object({
  decision: z.enum(['use-once', 'save', 'cancel']),
  values: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string().default(''),
        secret: z.boolean().default(false),
        group: z.enum(SETTING_GROUPS).optional(),
      }),
    )
    .default([]),
});
export type SubmitCredentialInput = z.infer<typeof SubmitCredentialInput>;

// ── Framework Registry (Phase D) ──────────────────────────────────────────
/** What the UI sends to register/update a framework. */
export const FrameworkInput = z.object({
  name: z.string().min(1),
  platform: z.enum(FRAMEWORK_PLATFORMS),
  type: z.enum(FRAMEWORK_TYPES),
  localPath: z.string().min(1),
  description: z.string().optional(),
});
export type FrameworkInput = z.infer<typeof FrameworkInput>;

/** A framework row as returned by the API (registry entry + scan status). */
export const Framework = FrameworkInput.extend({
  id: z.string(),
  validationStatus: z.enum(FRAMEWORK_VALIDATION_STATUSES),
  scanDetails: z.string().nullable().optional(),
  lastScan: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  gitCommit: z.string().nullable().optional(),
  gitBranch: z.string().nullable().optional(),
  lastSuccessfulGeneration: z.string().nullable().optional(),
  lastGenerationStory: z.string().nullable().optional(),
});
export type Framework = z.infer<typeof Framework>;

/** Compact map the worker consumes: first valid path per canonical type. */
export interface ResolvedFrameworks {
  playwright?: string;
  javaAppium?: string;
}
