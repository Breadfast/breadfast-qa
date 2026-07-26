/**
 * Prompt Registry — Roadmap Phase 1 #2.
 *
 * Centralizes the AI-node instruction prompts that previously lived inline in
 * apps/worker/src/nodes.ts. Each prompt is a versioned, owned, changelogged
 * asset so prompts can evolve WITHOUT touching workflow logic, and so every run
 * can be stamped with the prompt version that produced it (Workflow Registry &
 * Versioning, #3).
 *
 * Design rules:
 * - Lives in @qa/shared so BOTH the worker (execution) and the API (version
 *   stamping / display) can read prompt metadata — avoids the worker/API
 *   manual-sync problem noted elsewhere in the codebase.
 * - `build(vars)` returns the instruction string BYTE-IDENTICALLY to the prior
 *   inline strings, so this is a behavior-preserving refactor (guarded by
 *   prompts.test.mjs).
 * - The Zod result schema stays in the node (it is the engine's output
 *   contract); the registry owns the human-facing schemaName + the compact
 *   schemaHint that pairs with it.
 *
 * All node prompts (reasoning + agentic figma/exploratory/automation/execution)
 * plus the visual_comparison sub-capability now live here — the single source of
 * truth for every AI prompt.
 */
import { visualChecksByCategory, UI_COMPONENTS } from './visual.js';
import { DESIGN_TOKEN_KINDS } from './schemas.js';

export interface PromptChangelogEntry {
  version: string;
  date: string; // ISO date
  note: string;
}

export interface PromptDef<V = Record<string, never>> {
  /** Registry key — matches the lifecycle node name it serves. */
  key: string;
  /** Human-facing prompt name. */
  name: string;
  /** Semver; bump on any change to `build`, `schemaHint`, or `schemaName`. */
  version: string;
  /** One-line statement of what this prompt is for. */
  purpose: string;
  /** Team/role that owns changes to this prompt. */
  owner: string;
  /** Newest-first change history. */
  changelog: PromptChangelogEntry[];
  /** Name the engine uses for the JSON object in the prompt. */
  schemaName: string;
  /** Compact JSON example of the expected output shape. */
  schemaHint: string;
  /** Renders the instruction string from runtime variables. */
  build: (vars: V) => string;
}

const OWNER = 'qa-companion';

/**
 * Shared citation-emit directive (Phase 2 traceability). Appended to prompts
 * whose result schema has an optional `sources` field, instructing the model to
 * record provenance. Additive and optional — a model that omits it still
 * validates (back-compatible).
 */
function CITATION_DIRECTIVE(what: string, kinds: string): string {
  return (
    ` Populate "sources" with ${what} — each as {kind, ref}, ` +
    `kind ∈ (${kinds}), ref = the id/key (e.g. AC id, comment id, Figma frame name, or docs/ai rule path). ` +
    `Only cite what genuinely applies; leave "sources" empty if nothing does.`
  );
}
const V1: PromptChangelogEntry = {
  version: '1.0.0',
  date: '2026-07-15',
  note: 'Initial extraction from apps/worker/src/nodes.ts (behavior-preserving).',
};

// ── Prompt definitions (reasoning nodes) ──────────────────────────────────────

const parseInstructions: PromptDef<{ jiraKey: string; instructions: string }> = {
  key: 'parse_instructions',
  name: 'Parse execution instructions',
  version: '1.0.0',
  purpose: "Compile the tester's free-text Execution Instructions into structured Directives.",
  owner: OWNER,
  changelog: [V1],
  schemaName: 'Directives',
  schemaHint:
    '{"onlyFlows":["..."],"skipNodes":["..."],"accountOverride":"...","packageNumbers":["..."],"ignoreIssues":["..."],"focus":["..."],"platforms":["..."],"maxHls":20,"notes":"..."}',
  build: ({ jiraKey, instructions }) =>
    `Compile the tester's Execution Instructions for ${jiraKey} into structured directives. ` +
    `Map a stage skip to its lifecycle node name(s) — e.g. "skip automation generation" → ` +
    `skipNodes:["automation_generation","review_automation"]. Platforms use android/ios/web. ` +
    `A cap on scenarios ("no more than N HLS", "max N HLS") → maxHls:N. ` +
    `Only set fields the instructions actually imply; leave the rest empty.\n\nInstructions:\n${instructions}`,
};

const detectPrerequisites: PromptDef<{ jiraKey: string }> = {
  key: 'detect_prerequisites',
  name: 'Detect blocking prerequisites',
  version: '1.0.0',
  purpose: 'Identify only genuinely-missing, undecidable prerequisites that block testing.',
  owner: OWNER,
  changelog: [V1],
  schemaName: 'PrerequisiteCheck',
  schemaHint:
    '{"ready":true,"missing":[{"item":"...","why":"..."}],"questions":[{"id":"p1","question":"...","why":"..."}]}',
  build: ({ jiraKey }) =>
    `Identify ONLY the genuinely-missing prerequisites that BLOCK testing ${jiraKey} and that the ` +
    `platform cannot derive (an unknown OTP/account/BCID the system can't compute, a required backend status ` +
    `change, or story content that cannot be found). Auto-provisioning of a fresh card user and the test-data ` +
    `pool already cover most needs — do NOT ask for anything obtainable from them or from the Additional Inputs ` +
    `in Context. If nothing is blocking, set ready=true and return no questions.`,
};

const requirementsAnalysis: PromptDef<{ jiraKey: string; title: string }> = {
  key: 'requirements_analysis',
  name: 'Requirements analysis (STEP 1)',
  version: '1.1.0',
  purpose: 'Analyze the requirement grounded in the real Jira source (description, AC, comments).',
  owner: OWNER,
  changelog: [
    { version: '1.1.0', date: '2026-07-15', note: 'Emit citation sources (Phase 2 traceability); additive, output back-compatible.' },
    V1,
  ],
  schemaName: 'RequirementsAnalysis',
  schemaHint:
    '{"businessObjective":"...","functionalRequirements":["..."],"nonFunctionalRequirements":["..."],"dependencies":["..."],"risks":["..."],"missingRequirements":["..."],"testabilityConcerns":["..."],"commentOverrides":["..."],"sources":[{"kind":"ac","ref":"AC-1"}]}',
  build: ({ jiraKey, title }) =>
    `Perform STEP 1 Requirements Analysis for Jira story ${jiraKey} ("${title}"). ` +
    `Use the REAL Jira source provided in Context (description, acceptance criteria, comments) — comments may ` +
    `override/clarify the AC. Analyze per CLAUDE.md.` +
    CITATION_DIRECTIVE('the acceptance criteria, story comments, or business rules this analysis draws on', 'ac|comment|rule|requirement'),
};

const acceptanceCriteria: PromptDef<{ jiraKey: string }> = {
  key: 'acceptance_criteria',
  name: 'Acceptance criteria analysis',
  version: '1.0.0',
  purpose: 'Extract acceptance criteria, mark each testable, and note gaps.',
  owner: OWNER,
  changelog: [V1],
  schemaName: 'AcceptanceCriteria',
  schemaHint: '{"criteria":[{"id":"AC-1","text":"...","testable":true,"notes":"..."}],"gaps":["..."]}',
  build: ({ jiraKey }) =>
    `Extract and analyze the acceptance criteria for ${jiraKey}. Mark each as testable or not and note gaps.`,
};

const commentsAnalysis: PromptDef<{ jiraKey: string }> = {
  key: 'comments_analysis',
  name: 'Comments analysis',
  version: '1.0.0',
  purpose: 'Surface comment-driven overrides, clarifications, and new requirements.',
  owner: OWNER,
  changelog: [V1],
  schemaName: 'CommentsAnalysis',
  schemaHint: '{"overrides":["..."],"clarifications":["..."],"newRequirements":["..."],"notes":"..."}',
  build: ({ jiraKey }) =>
    `Analyze the Jira comments for ${jiraKey}. Comments may override/clarify/invalidate the original AC — surface overrides, clarifications, and any new requirements.`,
};

const linkedStories: PromptDef<{ jiraKey: string }> = {
  key: 'linked_stories',
  name: 'Linked stories',
  version: '1.0.0',
  purpose: 'Identify related tickets/docs and their relationship and testing impact.',
  owner: OWNER,
  changelog: [V1],
  schemaName: 'LinkedStories',
  schemaHint: '{"links":[{"key":"B10-...","relationship":"blocks|relates|depends","impact":"..."}],"notes":"..."}',
  build: ({ jiraKey }) =>
    `Identify linked/related tickets and linked docs for ${jiraKey} and their relationship and testing impact.`,
};

const figmaAnalysis: PromptDef<{
  jiraKey: string;
  mode?: 'base' | 'frames' | 'spec';
  exportMethod?: string;
  frameFiles?: string[];
  why?: string;
}> = {
  key: 'figma_analysis',
  name: 'Figma analysis (STEP 2)',
  version: '1.1.0',
  purpose: 'Compare the design against description/AC/comments — base, frame-read, and spec-only variants.',
  owner: OWNER,
  changelog: [
    { version: '1.1.0', date: '2026-07-15', note: 'Migrated frame-read + spec-only variants into the registry (byte-identical).' },
    V1,
  ],
  schemaName: 'FigmaAnalysis',
  schemaHint:
    '{"analyzed":true,"screens":[{"name":"...","summary":"..."}],"states":["..."],"validations":["..."],' +
    '"gaps":["..."],"missingStates":["..."],"localizationNotes":["..."],"uxFindings":["..."],"notes":"..."}',
  build: ({ jiraKey, mode, exportMethod, frameFiles, why }) => {
    const base =
      `Perform STEP 2 Figma analysis for ${jiraKey}. Compare the design against the description, ` +
      `acceptance criteria and comments in Context. Surface screens, states (default/filled/empty/error/loading), ` +
      `validation rules, copy/localization (en-US + ar-EG incl. RTL/truncation), UX inconsistencies, and any ` +
      `gaps/contradictions/missing states vs the spec (testing-process.md §4).`;
    if (mode === 'frames') {
      return (
        `${base} The exported design frames (PNG @2x, via ${exportMethod}) are these files — READ each one and analyze the actual pixels:\n` +
        (frameFiles ?? []).map((f) => `- ${f.replace(/\\/g, '\\\\')}`).join('\n')
      );
    }
    if (mode === 'spec') {
      return (
        `${base} NOTE: design frames could not be exported (${why}); analyze design expectations from the spec ` +
        `and explicitly flag that visual frames were unavailable.`
      );
    }
    return base;
  },
};

const clarification: PromptDef<{ jiraKey: string }> = {
  key: 'clarification',
  name: 'Clarification questions (STEP 3)',
  version: '1.0.0',
  purpose: 'Produce only the clarification questions that genuinely block scope.',
  owner: OWNER,
  changelog: [V1],
  schemaName: 'ClarificationQuestions',
  schemaHint: '{"questions":[{"id":"q1","question":"...","why":"...","suggestedAnswers":["..."]}]}',
  build: ({ jiraKey }) =>
    `Based on the analysis so far, produce the STEP 3 clarification questions genuinely needed before test design ` +
    `for ${jiraKey}. Only ask what truly blocks scope. If none, return an empty list.`,
};

const impactAnalysis: PromptDef<{ jiraKey: string }> = {
  key: 'impact_analysis',
  name: 'Impact analysis (STEP 4)',
  version: '1.0.0',
  purpose: 'Impacted/Regression/Smoke/Automation impact per regression-strategy.md §1.',
  owner: OWNER,
  changelog: [V1],
  schemaName: 'ImpactAnalysis',
  schemaHint: '{"impactedAreas":["..."],"regressionAreas":["..."],"smokeCoverage":["..."],"automationImpact":["..."]}',
  build: ({ jiraKey }) =>
    `Perform STEP 4 Impact Analysis for ${jiraKey}: Impacted Areas, Regression Areas, ` +
    `Smoke Coverage, Automation Impact (regression-strategy.md §1).`,
};

const generateHls: PromptDef<{ jiraKey: string; maxHls: number }> = {
  key: 'generate_hls',
  name: 'High level scenarios (STEP 5)',
  version: '1.1.0',
  purpose: 'Generate capped, prioritized high-level scenarios covering the full risk surface.',
  owner: OWNER,
  changelog: [
    { version: '1.1.0', date: '2026-07-15', note: 'Emit per-scenario citation sources (Phase 2 traceability).' },
    V1,
  ],
  schemaName: 'Hls',
  schemaHint: '{"storyName":"...","scenarios":[{"index":1,"text":"Verify ...","sources":[{"kind":"ac","ref":"AC-1"}]}]}',
  build: ({ jiraKey, maxHls }) =>
    `Generate STEP 5 High Level Scenarios for ${jiraKey}. Cover happy paths, negatives, edge cases, ` +
    `state transitions, validations, navigation, permissions, localization (en-US + ar-EG), error handling, regression risks. ` +
    `HARD LIMIT: produce NO MORE THAN ${maxHls} scenarios — consolidate and prioritize the highest-risk coverage; ` +
    `do not pad. Number them 1..N (N ≤ ${maxHls}).` +
    ` For each scenario,${CITATION_DIRECTIVE('the acceptance criteria or requirements it covers', 'ac|requirement').slice(1)}`,
};

const generateTestcases: PromptDef<{ jiraKey: string }> = {
  key: 'generate_testcases',
  name: 'Test case generation (STEP 6)',
  version: '1.1.0',
  purpose: 'Generate canonical granular BrowserStack test cases covering all HLS.',
  owner: OWNER,
  changelog: [
    { version: '1.1.0', date: '2026-07-15', note: 'Emit per-case citation sources for AC coverage (Phase 2 traceability).' },
    V1,
  ],
  schemaName: 'TestCases',
  schemaHint:
    '{"cases":[{"title":"...","description":"...","preconditions":"...","type":"Functional","priority":"High","automationStatus":"Not Automated","steps":[{"action":"...","expectedResult":"..."}],"sources":[{"kind":"ac","ref":"AC-1"}]}]}',
  build: ({ jiraKey }) =>
    `Generate STEP 6 detailed test cases for ${jiraKey} in the canonical granular standard ` +
    `(browserstack-process.md §10.0): one user action per step, every step has its OWN Expected Result, ` +
    `never combine actions; navigation/validation/verification are explicit steps. Cover all HLS scenarios. ` +
    `Set: type (Functional/Acceptance/Regression/Usability/Smoke & Sanity), priority (Critical/High/Medium/Low), ` +
    `automationStatus (default "Not Automated"), a one-line description, and preconditions.` +
    ` For each test case,${CITATION_DIRECTIVE('the acceptance criteria it validates', 'ac|requirement').slice(1)}`,
};

const exploratoryTesting: PromptDef<{
  jiraKey: string;
  platform?: string;
  mode?: 'plan' | 'probe';
  title?: string;
  creds?: string;
  charterList?: string;
  riskAreas?: string; // pre-joined "a; b; c"
  fragileFlows?: string; // pre-joined
  shotsDir?: string; // already path-escaped by the caller? no — escaped here
}> = {
  key: 'exploratory_testing',
  name: 'Exploratory testing',
  version: '1.1.0',
  purpose: 'Plan exploratory charters, and (probe mode) drive the live app per those charters.',
  owner: OWNER,
  changelog: [
    { version: '1.1.0', date: '2026-07-15', note: 'Migrated the live-probe variant into the registry (byte-identical).' },
    V1,
  ],
  schemaName: 'ExploratoryNotes',
  // plan-mode hint; the probe call passes its own hint below via schemaHintProbe.
  schemaHint: '{"charters":[{"area":"...","idea":"..."}],"riskAreas":["..."],"fragileFlows":["..."]}',
  build: (v) => {
    if (v.mode === 'probe') {
      return (
        `Use the Playwright browser tools to actually explore the live app for ${v.jiraKey} ("${v.title}"). ${v.creds}\n\n` +
        `Charters to probe (spend real time on each — try boundary values, invalid input, unusual navigation, rapid repeat actions, ` +
        `back/refresh mid-flow — the things a human exploratory tester would try, not the scripted happy-path steps from the test cases):\n` +
        `${v.charterList}\n\n` +
        `Also probe these risk areas: ${v.riskAreas}\n` +
        `And these fragile flows: ${v.fragileFlows}\n\n` +
        `For every genuinely unexpected or noteworthy result, use browser_take_screenshot to save evidence under ` +
        `"${(v.shotsDir ?? '').replace(/\\/g, '\\\\')}" (name it exploratory_<n>_<slug>.png) and record it as a finding. Do NOT invent findings — ` +
        `only report what you actually observed while probing. Do not perform destructive/irreversible actions.`
      );
    }
    return `Produce exploratory testing charters for ${v.jiraKey} (exploratory-testing.md): areas to probe, risk areas, and fragile flows for ${v.platform}.`;
  },
};

/** Probe-mode output hint (distinct from the plan hint). */
export const EXPLORATORY_PROBE_HINT =
  '{"charters":[],"riskAreas":[],"fragileFlows":[],"findings":[{"area":"...","observation":"...","screenshot":"<path>"}],"probed":true}';

const automationGeneration: PromptDef<{
  jiraKey: string;
  platform: string;
  sharedPagesDir: string;
  javaFramework: string;
  mode?: 'plan' | 'write';
  // write-mode extras:
  title?: string;
  planJson?: string;
  dir?: string;
  automationDir?: string;
  pwFramework?: string;
  isWeb?: boolean;
}> = {
  key: 'automation_generation',
  name: 'Automation generation',
  version: '1.1.0',
  purpose: 'Plan automation (reuse-before-build) and (write mode) implement the spec files.',
  owner: OWNER,
  changelog: [
    { version: '1.1.0', date: '2026-07-15', note: 'Migrated the spec-writing variant into the registry (byte-identical).' },
    V1,
  ],
  schemaName: 'AutomationPlan',
  schemaHint:
    '{"reusableAssets":["..."],"newPageObjects":["..."],"specs":[{"name":"...","framework":"playwright|appium","description":"..."}],"notes":"..."}',
  build: (v) => {
    if (v.mode === 'write') {
      return (
        `You are implementing automation specs for Jira story ${v.jiraKey} ("${v.title}").\n\n` +
        `Automation plan:\n${v.planJson}\n\n` +
        `Platform: ${v.platform}\n` +
        `Story workspace: ${(v.dir ?? '').replace(/\\/g, '\\\\')}\n\n` +
        (v.isWeb
          ? `TASK (Playwright/JS):\n` +
            `1. Read the automation plan above carefully.\n` +
            `2. Check for existing reusable page objects / helpers in ${v.sharedPagesDir} and the configured Playwright framework's pages/ before writing anything new.\n` +
            `3. For each new page object in the plan: write it to ${v.sharedPagesDir} (follow the BasePage pattern in the configured Playwright framework: ${v.pwFramework}).\n` +
            `4. Write the test spec file(s) to ${(v.automationDir ?? '').replace(/\\/g, '\\\\')}\\tests\\ — file name matching the spec name in the plan.\n` +
            `   Follow the coding standard at docs/ai/automation/coding-standards.md: ` +
            `   granular steps, env-var-gated destructive tests, const EXPECTED_* for copy assertions, beforeEach login.\n` +
            `5. Write a README.md to ${(v.automationDir ?? '').replace(/\\/g, '\\\\')} describing how to run the specs and listing preconditions.\n` +
            `6. Verify the spec file(s) exist and contain valid JS (no TypeScript annotations).`
          : `TASK (Mobile/Appium — Java framework at ${v.javaFramework}):\n` +
            `1. Read the automation plan and the Java framework catalog at docs/ai/automation/java-framework.md.\n` +
            `2. DO NOT write Java files (the build requires Maven setup). Instead:\n` +
            `   a. Write a detailed framework-reference.md to ${(v.automationDir ?? '').replace(/\\/g, '\\\\')}\\framework-reference.md ` +
            `      listing: which existing page objects / helpers to reuse, which new ones are needed, ` +
            `      class names + method signatures for all new page objects, and the step-by-step navigation needed for each spec.\n` +
            `   b. Write a README.md describing how to run the Appium test from ${v.javaFramework} via Maven.\n`) +
        `\nDo NOT add speculative features, TODOs, or placeholder comments. Write exactly what is needed for the test cases in the plan. ` +
        `Reply "DONE: <comma-separated list of files written>" when finished, or "PARTIAL: <files written> — <what failed>" if some files could not be written.`
      );
    }
    return (
      `Plan automation for ${v.jiraKey} on ${v.platform}. ` +
      `Enforce reuse-before-build against the framework catalogs (docs/ai/automation/**): ` +
      `list reusable assets, any new page objects needed, and the spec files to create. ` +
      `For web: Playwright specs go to the story's automation/tests/ folder. ` +
      `Shared page objects go to ${v.sharedPagesDir}. ` +
      `For mobile: describe the Java/Appium test class plan (framework at ${v.javaFramework}).`
    );
  },
};

const execution: PromptDef<{
  jiraKey: string;
  title: string;
  environment: string;
  locale: string;
  shotsDir: string;
  casesFile: string;
  isWeb: boolean;
  creds?: string;
  useUser?: string;
  caps?: string;
  bsHelperPath?: string;
  dir?: string;
}> = {
  key: 'execution',
  name: 'Execution (STEP: Phase 2 real run)',
  version: '1.2.0',
  purpose: 'Drive the live app (web Playwright / mobile BrowserStack) and return ExecutionResults, with the defect-grounding + blocker-handling gates.',
  owner: OWNER,
  changelog: [
    { version: '1.2.0', date: '2026-07-21', note: 'VT3 — optional best-effort structured UI dump (a11y/DOM/page-source) per screen, recorded in each case\'s structuredDump for the validation pyramid.' },
    { version: '1.1.0', date: '2026-07-15', note: 'Emit Defect citation sources (kind ac|figma|rule) for traceability (Phase 2).' },
    V1,
  ],
  schemaName: 'ExecutionResults',
  schemaHint:
    '{"executed":true,"matrix":["web · en-US"],"summary":{"total":0,"passed":0,"failed":0,"blocked":0,"skipped":0},' +
    '"cases":[{"title":"...","status":"pass|fail|blocked|skipped","combo":"web · en-US","stepsRun":0,"failedStep":"...","expected":"...","actual":"...","evidence":["<path>"],"notes":"..."}],' +
    '"defects":[{"title":"...","severity":"High","priority":"High","caseTitle":"...","combo":"web · en-US","stepsToReproduce":["..."],"expected":"...","actual":"...","evidence":["<path>"]}],"notes":"..."}',
  build: (v) => {
    const common =
      `You are executing QA test cases for Jira story ${v.jiraKey} ("${v.title}") in the ${v.environment} ` +
      `environment, locale ${v.locale}. Execute ONLY against the ${v.environment} environment. For EACH test case: perform every step ` +
      `in order, compare the live result to its EXPECTED result, and decide a status: "pass" (all steps matched), "fail" (a step's ` +
      `actual ≠ expected — capture a defect), "blocked" (could not run, e.g. precondition/data/permission missing), or "skipped". ` +
      `Capture at least one screenshot per case into "${v.shotsDir.replace(/\\/g, '\\\\')}" (name it <index>_<short-slug>.png) and put the ` +
      `saved file path(s) in that case's "evidence". For a "fail" whose defect is a multi-step or state/DB-transition issue that a single ` +
      `screenshot cannot convey, ALSO capture a short screen recording (.mp4 or .webm) into that folder and add its path to "evidence" — ` +
      `recordings are attached to the Bug and preview inline in Jira, making the defect self-explanatory to the developer. ` +
      `OPTIONAL (best-effort) structured evidence: for each screen also capture a structured UI dump — the accessibility/DOM ` +
      `structure (web) or page source (mobile) — save it beside the screenshot as "<index>_<short-slug>.dump.json" (or .txt) and put ` +
      `its path in that case's "structuredDump". This is optional; skip if unavailable and NEVER block or fail a case over it. For every "fail", ` +
      `add a Defect (title, severity, priority, caseTitle, combo, ` +
      `stepsToReproduce, expected, actual, evidence, sources) per docs/ai/bug-reporting.md. Populate each Defect's ` +
      `"sources" with what it violates — {kind, ref}, kind ∈ (ac|figma|rule), ref = the AC id, Figma frame name, or docs/ai rule path.\n\n` +
      `DEFECT GROUNDING (mandatory precision gate — apply to EVERY candidate "fail" BEFORE recording it as a Defect). A finding becomes a ` +
      `Defect ONLY if it passes ALL of the checks below; otherwise the case is "pass" (with a note) or the finding goes in "notes" as an ` +
      `OBSERVATION — never as a Defect:\n` +
      `1. SOURCE: you can cite the exact thing it violates — a specific acceptance criterion, a Figma design element, or an established ` +
      `business rule. If you cannot name the AC/design/rule, it is NOT a defect. Do NOT invent an "ideal" expectation the spec never states ` +
      `(e.g. an extra confirmation dialog, a disabled state, or a copy tweak that no AC/design calls for). Conversely, if the AC DOES state it ` +
      `(e.g. "the button must be disabled until X"), a deviation IS a real defect — check the AC before deciding either way.\n` +
      `2. NOT TEST DATA: seeded/garbage values in the testing environment — dropdown entries like "test", "dsa", "{{7*7}}", "@SUM(...)", ` +
      `duplicate demo branches — are NOT product defects.\n` +
      `3. REPRODUCIBLE: re-run the exact steps at least once more. A single, non-repeating observation is NOT a defect (record it as ` +
      `unconfirmed/flaky in notes).\n` +
      `4. NOT A TOOLING ARTIFACT: text extracted from a PDF (pdf-parse) reverses/re-orders Arabic (RTL) numerals and shaping. A digit-order ` +
      `or RTL difference seen ONLY in extracted text is NOT a defect unless you confirm it by visually inspecting the rendered PDF/screenshot.\n` +
      `5. NO CROSS-LANGUAGE / DERIVED-FIELD FALSE MISMATCHES: do not assert an English UI label must equal an Arabic stored value (e.g. a ` +
      `branch's Arabic name vs its English selection label — a correct branch CODE means the mapping is valid). Do not flag derived fields as ` +
      `inconsistent with a display label (e.g. Gender is derived from the Egyptian National ID 13th digit: odd=male, even=female).\n` +
      `6. ONE DEFECT = ONE PROBLEM: never bundle two distinct issues into one Defect; split them, and never combine a real issue with a weak one.\n\n` +
      `BLOCKER HANDLING (this is a SINGLE one-shot headless run — you cannot pause and resume). If you hit an ` +
      `environment/precondition/data blocker (e.g. the app or an API returns 5xx/502, a page never loads, login/OTP ` +
      `cannot be obtained, or required data is missing), do NOT wait, sleep, poll, retry indefinitely, or schedule a ` +
      `wakeup/cron/notification to "resume later" — none of those resume this run and they only waste the turn. Retry a ` +
      `transient failure at most 2–3 times inline; if it still fails, mark EVERY affected test case "blocked" with the ` +
      `precise reason in its "actual"/"notes", set "executed" to true (you did run — the environment blocked you), and ` +
      `return the ExecutionResults JSON NOW. Always finish your turn with the JSON object, never with a prose plan to continue.\n\n` +
      `Do NOT perform destructive/irreversible actions; if a ` +
      `step would, mark the case blocked and note why. Keep going through all cases even if some fail.\n\n` +
      `The full list of test cases to execute (combo "${(v.isWeb ? 'web' : 'android/ios')} · ${v.locale}") is in this file — READ it first: ` +
      `"${v.casesFile.replace(/\\/g, '\\\\')}".`;
    if (v.isWeb) {
      return (
        `Use the Playwright browser tools to drive the live web app. ${v.creds}${v.useUser} Use browser_take_screenshot with a filename under the ` +
        `screenshots dir for evidence; optionally use browser_snapshot to capture the accessibility tree and Write it as the "<index>_<short-slug>.dump.json" structured dump. ${common}`
      );
    }
    return (
      `Drive BrowserStack App Automate via the helper at ${v.bsHelperPath} (functions: bsReq, screenshot, getSource, ` +
      `findElement(s), clickEl, typeText, tap(x,y), getAttr, sleep). Write a Node driver script under "${(v.dir ?? '').replace(/\\/g, '\\\\')}\\automation" ` +
      `that: creates a session with the caps below, executes the cases, saves a screenshot per case into the screenshots dir (optionally also getSource() saved as the "<index>_<short-slug>.dump.json" structured dump), then run it with Bash ` +
      `("node <script>"). Run Android first, then iOS, for locale ${v.locale} only (Arabic is a later pass). Handle OTP/passcode/coordinate-tap ` +
      `quirks per CLAUDE.md §7. ${v.caps} ${common}`
    );
  },
};

const visualComparison: PromptDef<{
  jiraKey: string;
  screen: string;
  combo: string;
  acText: string;
  expectedFrame: string;
  actualScreenshot: string;
}> = {
  key: 'visual_comparison',
  name: 'Visual comparison (Senior-QA UI review)',
  version: '1.1.0',
  purpose: 'Compare one screen against its Figma frame AND the acceptance criteria across every visual dimension, returning reviewer-grade, design-system-aware findings.',
  owner: OWNER,
  changelog: [
    V1,
    {
      version: '1.1.0',
      date: '2026-07-15',
      note: 'M3.5 design-system awareness: identify the reusable component, cite the design token (root cause), and phrase recommendations at the shared-component/token level.',
    },
  ],
  schemaName: 'VisualScreenComparison',
  schemaHint:
    '{"screen":"...","combo":"web · en-US","expectedFrame":"...","actualScreenshot":"...","verdict":"pass|minor|major|no-frame",' +
    '"categoriesChecked":["layout","typography","content"],' +
    '"findings":[{"category":"typography","dimension":"sentence-case","severity":"minor","screen":"...","component":"Primary Button","token":{"kind":"typography","name":"type/button/label","expected":"sentence case","actual":"Title Case"},"expected":"Add to cart","actual":"Add To Cart","differenceDescription":"The Primary Button label uses title case instead of the sentence-case typography token in the Figma design.","recommendation":"Update the shared Primary Button typography token.","confidence":"high","sources":[{"kind":"figma","ref":"Checkout"},{"kind":"ac","ref":"AC-3"}]}]}',
  build: ({ jiraKey, screen, combo, acText, expectedFrame, actualScreenshot }) => {
    const byCat = visualChecksByCategory();
    const checklist = (Object.keys(byCat) as Array<keyof typeof byCat>)
      .map((cat) => `- ${cat}:\n` + byCat[cat].map((c) => `    · ${c.dimension} — ${c.description}`).join('\n'))
      .join('\n');
    return (
      `Act as a Senior QA Engineer performing a meticulous UI/UX review of ONE screen for ${jiraKey}. ` +
      `Compare the ACTUAL implementation screenshot against BOTH the EXPECTED Figma frame (expected implementation) ` +
      `AND the Acceptance Criteria (expected behavior). BOTH must be satisfied.\n\n` +
      `Screen: ${screen}\nCombo: ${combo}\n` +
      `Expected Figma frame image (READ it): ${expectedFrame.replace(/\\/g, '\\\\')}\n` +
      `Actual screenshot image (READ it): ${actualScreenshot.replace(/\\/g, '\\\\')}\n\n` +
      `Acceptance Criteria:\n${acText || '(none provided — validate against the Figma design)'}\n\n` +
      `Validate EVERY category below INDEPENDENTLY. Only raise a finding for a real discrepancy grounded in the ` +
      `Figma design or an acceptance criterion — do not invent issues the design/AC do not establish (same grounding ` +
      `discipline as defects). Remember the parity rule: compare an AR screen only to its AR frame, an EN screen only ` +
      `to its EN frame; per-platform rendering differences that match that platform's own frame are NOT defects.\n\n` +
      `Checklist:\n${checklist}\n\n` +
      `REASON ABOUT THE DESIGN SYSTEM, not just raw pixels. For EACH finding:\n` +
      `- "component": the reusable UI component it affects, when identifiable (e.g. ${UI_COMPONENTS.slice(0, 10).join(', ')}, …). ` +
      `Prefer the component name over the raw element.\n` +
      `- "token": the design token that is the ROOT CAUSE, when identifiable — {kind, name?, expected?, actual?} ` +
      `where kind ∈ (${DESIGN_TOKEN_KINDS.join('|')}). E.g. a color delta on a button is a color-token issue; a font delta is a typography-token issue.\n` +
      `- "recommendation": ACTIONABLE and at the ROOT-CAUSE level — prefer "Update the shared <Component>" / "Update the ` +
      `<kind> design token" over "fix this one screen". If the same issue would recur wherever the component/token is ` +
      `used, say so.\n` +
      `- Also provide: category, dimension (the specific check above), severity (critical|major|minor|info), expected, ` +
      `actual, differenceDescription (a precise, self-explaining sentence naming the component/token where possible, ` +
      `e.g. "The Primary Button uses the wrong typography token"), confidence (high|medium|low = your DETECTION ` +
      `certainty), and sources (cite the AC id and/or the Figma frame name).\n\n` +
      `Set "categoriesChecked" to every category you evaluated, and the screen "verdict": pass (no major/critical), ` +
      `minor (only minor/info), major (any major/critical), or no-frame (no Figma frame available to compare).`
    );
  },
};

const knowledgeUpdate: PromptDef<{ jiraKey: string }> = {
  key: 'knowledge_update',
  name: 'Knowledge update proposals',
  version: '1.0.0',
  purpose: 'Propose reusable knowledge to persist per the documentation governance protocol.',
  owner: OWNER,
  changelog: [V1],
  schemaName: 'KnowledgeUpdate',
  schemaHint: '{"proposals":[{"docPath":"docs/ai/...","summary":"...","rationale":"..."}]}',
  build: ({ jiraKey }) =>
    `Per the documentation governance protocol, propose reusable knowledge to persist from ${jiraKey} (new business rule, workflow, automation pattern, BrowserStack convention, regression rule). Only genuinely reusable items; map each to a docs/ai/** path.`,
};

// ── Registry ──────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export const promptRegistry = {
  parse_instructions: parseInstructions,
  detect_prerequisites: detectPrerequisites,
  requirements_analysis: requirementsAnalysis,
  acceptance_criteria: acceptanceCriteria,
  comments_analysis: commentsAnalysis,
  linked_stories: linkedStories,
  figma_analysis: figmaAnalysis,
  clarification,
  impact_analysis: impactAnalysis,
  generate_hls: generateHls,
  generate_testcases: generateTestcases,
  exploratory_testing: exploratoryTesting,
  automation_generation: automationGeneration,
  execution,
  visual_comparison: visualComparison,
  knowledge_update: knowledgeUpdate,
} as const;

/**
 * Registry keys that are NOT lifecycle nodes but sub-capabilities invoked within
 * a node (kept explicit so the invariant test stays honest).
 */
export const PROMPT_SUBCAPABILITIES = ['visual_comparison'] as const;

export type PromptKey = keyof typeof promptRegistry;

/** Look up a prompt definition by key (typed to the registry). */
export function getPrompt<K extends PromptKey>(key: K): (typeof promptRegistry)[K] {
  return promptRegistry[key];
}

/**
 * Aggregate registry version — a stable hash of every prompt's key@version.
 * Stamped onto each run by the Workflow Registry (#3) so a run records exactly
 * which prompt set produced it. Changes whenever any single prompt version bumps.
 */
export const PROMPT_REGISTRY_VERSION: string = (() => {
  const parts = Object.values(promptRegistry as Record<string, PromptDef<any>>)
    .map((p) => `${p.key}@${p.version}`)
    .sort();
  // Small deterministic FNV-1a hash → short hex, prefixed with the schema epoch.
  let h = 0x811c9dc5;
  const joined = parts.join('|');
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `1-${(h >>> 0).toString(16).padStart(8, '0')}`;
})();
