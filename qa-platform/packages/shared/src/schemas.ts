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
  EXECUTION_MODEL_IDS,
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
    // Steps & model — which lifecycle phases to run + which model drives execution.
    // `phases` = selected phase keys (see LIFECYCLE_PHASES); omitted/empty = run all.
    // Mandatory phases always run regardless. `executionModel` = model id for the
    // execution step; empty/omitted = platform default.
    phases: z.array(z.string()).optional(),
    executionModel: z.enum(EXECUTION_MODEL_IDS as [string, ...string[]]).optional(),
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

// ── Citation & Traceability (Phase 1 #4 — foundation) ─────────────────────
// A single provenance link on an AI-generated artifact. Jira/BrowserStack/
// Figma/KB-native (never an Azure DevOps concept). `ref` is the kind-specific
// identifier: story key, AC id, comment id, figma frame name, KB doc anchor, or
// test-case id. These fields are OPTIONAL everywhere they appear (default []),
// so old runs and any model omission never break validation — the completion
// work (resolver + rendering) lands in Phase 2.
export const CITATION_KINDS = ['story', 'ac', 'comment', 'figma', 'rule', 'testcase', 'requirement'] as const;
export type CitationKind = (typeof CITATION_KINDS)[number];
export const Citation = z.object({
  kind: z.enum(CITATION_KINDS),
  ref: z.string(), // "B10-56336" | "AC-3" | "10457" | "checkout-empty" | "business-rules#cashback" | "TC-49835"
  label: z.string().optional(),
});
export type Citation = z.infer<typeof Citation>;
/** Reusable optional citation list — attach as `sources` on any result schema. */
export const Citations = z.array(Citation).default([]);
export type Citations = z.infer<typeof Citations>;

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
  sources: Citations, // Phase 1 #4 — optional provenance (AC/comment/rule/figma)
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
    .array(z.object({ index: z.number(), text: z.string(), sources: Citations }))
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
  sources: Citations, // Phase 1 #4 — which AC/rule/requirement this case covers
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

// ── Visual Comparison (Phase 1 #6 foundation → Phase 2 M3 intelligence) ────
// Structured expected-Figma-frame ↔ actual-screenshot comparison against BOTH
// the Acceptance Criteria (expected behavior) and the Figma design (expected
// implementation). The AI vision comparator detects findings; the deterministic
// layer in run-eval/visual.ts scores health, pass rate, coverage. Feeds Parity
// Certification's "missing visual coverage".
export const VISUAL_VERDICTS = ['pass', 'minor', 'major', 'no-frame'] as const;
export type VisualVerdict = (typeof VISUAL_VERDICTS)[number];

// The 11 top-level validation CATEGORIES (each a first-class, independently
// validated area). The fine-grained checks within each live in visual.ts
// (VISUAL_CHECKS) so the taxonomy is deterministic and injectable into the prompt.
export const VISUAL_CATEGORIES = [
  'layout', 'positioning', 'typography', 'content', 'color',
  'components', 'dropdowns', 'states', 'navigation', 'responsive', 'accessibility',
] as const;
export type VisualCategory = (typeof VISUAL_CATEGORIES)[number];

// Legacy dimension vocabulary (kept for back-compat; findings now use category +
// a free-text `dimension` label drawn from VISUAL_CHECKS).
export const VISUAL_DIMENSIONS = [
  'typography', 'sentence-case', 'color', 'alignment', 'spacing',
  'missing-component', 'unexpected-component', 'ordering',
  'responsive', 'accessibility', 'content',
] as const;
export type VisualDimension = (typeof VISUAL_DIMENSIONS)[number];

export const VISUAL_SEVERITIES = ['critical', 'major', 'minor', 'info'] as const;
export type VisualSeverity = (typeof VISUAL_SEVERITIES)[number];
export const VISUAL_FINDING_CONFIDENCE = ['high', 'medium', 'low'] as const;

// ── Design-system awareness (M3.5) ─────────────────────────────────────────
// A reusable-component vocabulary and a design-token taxonomy so findings can
// reason about the design system ("Primary Button uses the wrong typography
// token") instead of raw visual deltas ("font size mismatch"). Both are OPEN:
// `component` is a free-text string (a suggested vocabulary, not an enum) and
// the token `kind` is constrained, so a model may name a component we haven't
// enumerated without breaking validation. This is the seam future Design-Token
// validation / Component-Library comparison / Figma Variables feed into.
export const UI_COMPONENTS = [
  'Primary Button', 'Secondary Button', 'Tertiary Button', 'Icon Button',
  'Dropdown', 'Text Field', 'Search Field', 'Checkbox', 'Radio', 'Toggle',
  'Card', 'List Item', 'Chip', 'Badge', 'Avatar', 'Tab Bar', 'Segmented Control',
  'Bottom Sheet', 'Modal', 'Dialog', 'Tooltip', 'Toast', 'Snackbar',
  'Navigation Bar', 'App Bar', 'Tab', 'Stepper', 'Progress Bar', 'Skeleton',
  'Empty State', 'Banner', 'Divider', 'Section Header', 'Card Header',
] as const;

export const DESIGN_TOKEN_KINDS = ['typography', 'color', 'spacing', 'layout', 'radius', 'shadow', 'component'] as const;
export type DesignTokenKind = (typeof DESIGN_TOKEN_KINDS)[number];

// A reference to the design token a finding implicates. `name` is the token id
// when the model knows it (e.g. "color/primary", "type/button/label"); the
// expected/actual values ground it. All optional — a finding may cite a token
// kind without a resolved name yet (before Figma-Variable extraction lands).
export const DesignTokenRef = z.object({
  kind: z.enum(DESIGN_TOKEN_KINDS),
  name: z.string().optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
});
export type DesignTokenRef = z.infer<typeof DesignTokenRef>;

// A single visual finding — the full reviewer-grade record (M3 + M3.5 design-system).
export const VisualFinding = z.object({
  category: z.enum(VISUAL_CATEGORIES).default('content'),
  dimension: z.string().default(''), // specific check, e.g. "sentence-case", "icon-label-spacing"
  severity: z.enum(VISUAL_SEVERITIES).default('minor'),
  screen: z.string().default(''),
  component: z.string().optional(), // M3.5 — the reusable UI component this affects (e.g. "Primary Button")
  token: DesignTokenRef.optional(), // M3.5 — the design token implicated (root cause)
  expected: z.string().default(''), // what Figma / the AC specifies
  actual: z.string().default(''), // what the app renders
  differenceDescription: z.string().default(''), // the precise, self-explaining "why"
  recommendation: z.string().default(''),
  confidence: z.enum(VISUAL_FINDING_CONFIDENCE).default('medium'), // AI DETECTION certainty (not Review Confidence)
  sources: Citations, // AC + Figma frame this finding references
});
export type VisualFinding = z.infer<typeof VisualFinding>;

export const VisualScreenComparison = z.object({
  screen: z.string(),
  combo: z.string().default('web · en-US'), // per-platform frame is the reference
  expectedFrame: z.string().optional(), // figma frame name/file (Expected evidence)
  actualScreenshot: z.string().optional(), // captured screenshot path (Actual evidence)
  verdict: z.enum(VISUAL_VERDICTS).default('no-frame'),
  categoriesChecked: z.array(z.enum(VISUAL_CATEGORIES)).default([]), // which categories this screen was validated against
  findings: z.array(VisualFinding).default([]),
});
export type VisualScreenComparison = z.infer<typeof VisualScreenComparison>;

// A recurring issue detected across screens/components (M3.5 pattern detection).
// One root cause that explains many findings — so reviewers fix the shared
// Button / typography token once instead of chasing N duplicate findings.
// Derived DETERMINISTICALLY from the findings (detectVisualPatterns in visual.ts),
// never model-authored — same findings ⇒ same patterns.
export const VisualPattern = z.object({
  key: z.string(), // stable grouping key (dimension + component/token)
  title: z.string(), // "Sentence case affecting 8 screens"
  category: z.enum(VISUAL_CATEGORIES),
  dimension: z.string().default(''),
  component: z.string().optional(),
  token: DesignTokenRef.optional(),
  severity: z.enum(VISUAL_SEVERITIES).default('minor'), // highest severity among the grouped findings
  occurrences: z.number().int().positive(),
  screens: z.array(z.string()).default([]),
  rootCause: z.string().default(''),
  recommendation: z.string().default(''), // actionable, root-cause-level fix
});
export type VisualPattern = z.infer<typeof VisualPattern>;

export const VisualComparison = z.object({
  compared: z.boolean().default(false),
  expectedFrames: z.number().int().nonnegative().default(0),
  comparedScreens: z.number().int().nonnegative().default(0),
  passRate: z.number().min(0).max(100).default(0),
  categoriesCovered: z.array(z.enum(VISUAL_CATEGORIES)).default([]),
  screens: z.array(VisualScreenComparison).default([]),
  patterns: z.array(VisualPattern).default([]), // M3.5 — recurring root causes across screens
  componentsAffected: z.array(z.string()).default([]), // M3.5 — reusable components with ≥1 finding
  notes: z.string().default(''),
});
export type VisualComparison = z.infer<typeof VisualComparison>;

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
  sources: Citations, // Phase 1 #4 — the AC/design/rule this defect violates
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

// Restart From Step (Run Lifecycle Management): re-run this step and every
// step after it, discarding what they already produced. Feedback is optional
// (unlike Regenerate's, which is gate-scoped and always has one) since a plain
// restart after a prompt/config fix doesn't require re-stating why.
export const RestartStepInput = z.object({
  feedback: z.string().optional(),
});
export type RestartStepInput = z.infer<typeof RestartStepInput>;

// Bulk Retry Failed Steps across the paused-run queue.
export const RetryFailedRunsInput = z.object({
  runIds: z.array(z.string().min(1)).min(1, 'at least one runId is required'),
});
export type RetryFailedRunsInput = z.infer<typeof RetryFailedRunsInput>;

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
