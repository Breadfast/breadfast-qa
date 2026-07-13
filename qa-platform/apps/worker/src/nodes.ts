/**
 * MVP workflow node implementations.
 *
 * - code  nodes do deterministic local work (folders, CSV, integrations).
 * - ai    nodes call the engine (headless Claude) for a schema-validated result.
 * - ask   nodes emit a clarification and block until the tester answers.
 * - gate  nodes emit an approval request and block until the tester decides;
 *         the external write (Jira/BrowserStack) runs only after approval.
 *
 * Phase-0 status: AI + ask + gate control flow is fully wired. The external
 * effects marked [PHASE 1] (Jira push, BrowserStack upload, Figma/Jira fetch
 * via MCP) are stubbed with clear seams — they slot into the same nodes.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { z } from 'zod';
import { runAiTask, runClaude, PLAYWRIGHT_TOOLS, FIGMA_EXPORT_TOOLS, type AiTaskOptions } from '@qa/engine';
import {
  RequirementsAnalysis,
  AcceptanceCriteria,
  CommentsAnalysis,
  LinkedStories,
  ImpactAnalysis,
  ClarificationQuestions,
  Hls,
  TestCases,
  FigmaAnalysis,
  FigmaExportManifest,
  Directives,
  PrerequisiteCheck,
  ExploratoryNotes,
  AutomationPlan,
  KnowledgeUpdate,
  ExecutionResults,
  makeEvent,
  type RunEvent,
  type GatedAction,
  type CredentialSpec,
} from '@qa/shared';
import {
  companionDir, companionPath, storyDir, figmaAuthPath,
  playwrightFrameworkDir, javaFrameworkDir,
} from '@qa/shared/paths';
import { ingest, getSettings, getResolvedFrameworks, type RunDetail, type StepDetail } from './api-client.js';
import { fetchJiraIssue, jiraSourceMarkdown, jiraContextBlock, extractFigmaUrls, type JiraSource } from './jira.js';
import { exportStoryFrames, type FigmaExportResult } from './figma.js';
import { fileDefects, resolveBugConfig, type DefectInput } from './jira-write.js';
import { verifyKnowledgeBase, knowledgeReminder, NODE_DOCS } from './knowledge.js';

/** Thrown by a gate/ask node when it needs tester input — pauses the run. */
export class PausedForInput extends Error {
  constructor() {
    super('paused-for-input');
    this.name = 'PausedForInput';
  }
}

const COMPANION_DIR = companionDir();
/** Saved Figma browser session — written by the Connect Figma flow; in the per-user workspace, not the repo. */
const FIGMA_AUTH_PATH = figmaAuthPath();
/** Session is considered expired after this many days — mirrors apps/api/src/figma-auth/figma-auth.service.ts. */
const FIGMA_AUTH_EXPIRY_DAYS = Number(process.env.FIGMA_AUTH_EXPIRY_DAYS ?? 25);

/**
 * Global external-write guard. While the platform builds toward parity, every
 * external write (Jira HLS push, BrowserStack upload, Jira bug filing) runs in
 * DRY-RUN: the approval gate is still exercised, but instead of writing the
 * payload is recorded locally + logged. Flip QA_DRY_RUN=false only at parity.
 */
const DRY_RUN = (process.env.QA_DRY_RUN ?? 'true').toLowerCase() !== 'false';
const MODEL = process.env.ENGINE_MODEL ?? 'claude-opus-4-8';
// Cheaper model for extraction-style phases; high-value reasoning keeps MODEL.
const MODEL_CHEAP = process.env.ENGINE_MODEL_CHEAP ?? 'claude-haiku-4-5-20251001';
// Execution drives tools turn-by-turn (many tool-call round trips) rather than
// deep one-shot reasoning — Sonnet at high effort matches quality at a fraction
// of Opus's token cost. Single flat headless run; no subagents (Task denied below).
const MODEL_EXECUTION = process.env.ENGINE_MODEL_EXECUTION ?? 'claude-sonnet-5';
const EFFORT_EXECUTION = (process.env.ENGINE_EFFORT_EXECUTION ?? 'high') as
  | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const STD_SUBFOLDERS = [
  'requirements-analysis', 'figma-analysis', 'hls', 'browserstack', 'testcases',
  'automation', 'execution-reports', 'screenshots', 'defects', 'evidence',
];

export interface NodeContext {
  run: RunDetail;
  step: StepDetail;
  /** Accumulated outputs from prior nodes (requirements, hls, testcases, …). */
  state: Record<string, unknown>;
  /** Per-step accumulators the runner reports on step.finished. */
  meta: { costUsd: number; tokens: number };
  log: (line: string) => Promise<void>;
  /** Aborted by a Stop request — every AI/child-process call must honor this. */
  signal: AbortSignal;
}

/** Run an AI task and accumulate its real cost/tokens onto the step. */
async function ai<S extends z.ZodTypeAny>(ctx: NodeContext, opts: AiTaskOptions<S>): Promise<z.infer<S>> {
  const { data, raw } = await runAiTask({ ...opts, signal: ctx.signal });
  ctx.meta.costUsd += raw.costUsd;
  ctx.meta.tokens += raw.outputTokens;
  return data;
}

export type NodeFn = (ctx: NodeContext) => Promise<unknown>;

const aiOpts = <S extends z.ZodTypeAny>(
  instruction: string,
  schema: S,
  schemaName: string,
  schemaHint: string,
  ctx: NodeContext,
  model: string = MODEL,
) => ({
  instruction,
  schema,
  schemaName,
  schemaHint,
  cwd: COMPANION_DIR,
  model,
  permissionMode: 'plan' as const,
  context: buildContext(ctx),
  onLog: (l: string) => void ctx.log(l),
});

/**
 * Context injected into every AI node: tester guidance (Execution Instructions
 * + Additional Inputs + parsed directives) FIRST so it conditions everything,
 * then the REAL Jira source (so analysis is grounded in the ticket, not just
 * its key), then the compact prior-node outputs.
 */
function buildContext(ctx: NodeContext): string {
  const guidance = guidanceBlock(ctx);
  const knowledge = knowledgeReminder(verifyKnowledgeBase(COMPANION_DIR), NODE_DOCS[ctx.step.name] ?? []);
  const jira = jiraContextBlock(ctx.state.jira as JiraSource | undefined);
  const rest = { ...ctx.state };
  delete (rest as any).jira;
  delete (rest as any).story;
  delete (rest as any).directives; // already surfaced in guidance
  const restStr = JSON.stringify(rest);
  const priors = restStr && restStr !== '{}' ? `=== PRIOR OUTPUTS ===\n${restStr.slice(0, 4000)}` : '';
  return [guidance, knowledge, jira.slice(0, 7000), priors].filter(Boolean).join('\n\n');
}

/** Tester guidance threaded into every node: execution instructions + extra inputs + parsed directives. */
function guidanceBlock(ctx: NodeContext): string {
  const story = ctx.run.story;
  const parts: string[] = [];
  if (ctx.step.feedback?.trim()) {
    parts.push(
      `Tester feedback from the previous attempt at this step (a Regenerate request) — ` +
        `address this directly in your new output:\n${ctx.step.feedback.trim()}`,
    );
  }
  if (story.executionInstructions?.trim()) {
    parts.push(
      `Execution Instructions (honor these throughout, while still following the canonical QA Companion process — ` +
        `they may scope/skip/override but never drop a mandatory quality gate):\n${story.executionInstructions.trim()}`,
    );
  }
  if (story.additionalInputs?.trim()) parts.push(`Additional Inputs (extra data/credentials):\n${story.additionalInputs.trim()}`);
  const directives = ctx.state.directives;
  if (directives && Object.keys(directives).length) parts.push(`Parsed directives: ${JSON.stringify(directives)}`);
  return parts.length ? `=== TESTER GUIDANCE ===\n${parts.join('\n\n')}` : '';
}

/** Standing rule: cap on the number of HLS scenarios. Default 20; overridable per-story
 *  via execution instructions (directives.maxHls), or globally via Settings
 *  hls.maxScenarios / env QA_HLS_MAX. */
const DEFAULT_HLS_CAP = 20;
async function resolveHlsCap(ctx: NodeContext, settings: Record<string, string>): Promise<number> {
  const fromDirective = (ctx.state.directives as { maxHls?: number } | undefined)?.maxHls;
  if (fromDirective && fromDirective > 0) return Math.floor(fromDirective);
  const fromSettings = Number(settings['hls.maxScenarios']);
  if (Number.isFinite(fromSettings) && fromSettings > 0) return Math.floor(fromSettings);
  const fromEnv = Number(process.env.QA_HLS_MAX);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return DEFAULT_HLS_CAP;
}

/** Reads FIGMA_AUTH_PATH and returns the figma.com cookies + savedAt, or null if unreadable/missing. */
function readFigmaAuth(): { cookies: Record<string, unknown>[]; savedAt?: string } | null {
  try {
    if (!existsSync(FIGMA_AUTH_PATH)) return null;
    let raw = readFileSync(FIGMA_AUTH_PATH, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // strip UTF-8 BOM
    const auth = JSON.parse(raw) as { cookies?: unknown[]; savedAt?: string };
    const cookies = (auth.cookies ?? []).filter(
      (c): c is Record<string, unknown> =>
        typeof c === 'object' && c !== null &&
        typeof (c as Record<string, unknown>).domain === 'string' &&
        ((c as Record<string, unknown>).domain as string).includes('figma.com'),
    );
    return { cookies, savedAt: auth.savedAt };
  } catch {
    return null;
  }
}

interface FigmaSessionStatus {
  status: 'connected' | 'expired' | 'disconnected';
  message: string;
  cookieCount?: number;
}

/**
 * Checks whether the Settings → Figma Browser Session cookies are present and
 * fresh, WITHOUT opening a browser. Mirrors FigmaAuthService.getStatus() in
 * apps/api/src/figma-auth/figma-auth.service.ts — kept in sync manually since
 * the worker and API are separate deployables with no shared package for this.
 * Gate this BEFORE any Playwright Figma navigation (see figma_analysis).
 */
function getFigmaSessionStatus(): FigmaSessionStatus {
  const auth = readFigmaAuth();
  if (!auth || !auth.cookies.length) {
    return {
      status: 'disconnected',
      message: 'No Figma session saved. Go to Settings → Figma Browser Session and click "Connect Figma".',
    };
  }
  if (auth.savedAt) {
    const ageDays = (Date.now() - new Date(auth.savedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > FIGMA_AUTH_EXPIRY_DAYS) {
      return {
        status: 'expired',
        cookieCount: auth.cookies.length,
        message: `Figma session expired (saved ${Math.round(ageDays)} day(s) ago). Go to Settings → Figma Browser Session and click "Reconnect Figma".`,
      };
    }
  }
  return {
    status: 'connected',
    cookieCount: auth.cookies.length,
    message: `Figma session active (${auth.cookies.length} cookie(s)).`,
  };
}

/**
 * Returns an instruction fragment that restores the saved Figma session cookies
 * into the Playwright MCP browser context BEFORE navigating to figma.com.
 *
 * Reads the auth file HERE in Node.js (worker side) and embeds the cookies as
 * a JSON literal in the instruction — so the agent just calls addCookies([...data...])
 * directly, with no file I/O in the browser context and no silent failure path.
 * Only called after getFigmaSessionStatus() has confirmed status === 'connected'.
 */
function figmaAuthRestoreStep(): string {
  const auth = readFigmaAuth();
  if (!auth || !auth.cookies.length) {
    return (
      `0. (Session restore — SKIPPED: no valid Figma session found)\n` +
      `   NOTE: If Figma redirects to /login, add "SESSION_EXPIRED" to the error message.\n\n`
    );
  }

  return (
    `0. (Session restore — REQUIRED, run BEFORE any navigation)\n` +
    `   Call browser_run_code_unsafe with this exact code to inject the saved Figma auth cookies:\n` +
    `     await page.context().addCookies(${JSON.stringify(auth.cookies)});\n` +
    `   Do NOT skip this step. After injecting, Figma should open directly to the design — not a login page.\n` +
    `   NOTE: If the page still shows a Figma login screen after navigation, the session may have expired;\n` +
    `   add "SESSION_EXPIRED" to the error message so the platform can detect it.\n\n`
  );
}

/**
 * PRIMARY Figma export method (testing-process.md §4.1/§4.5).
 * Drives the Playwright MCP browser to do a batch export (Ctrl+Shift+E → ZIP),
 * extracts the ZIP to outDir, and returns a FigmaExportResult.
 * The MCP browser is always authenticated — no API quota, no Retry-After.
 * Returns { frames: [], error } on any failure so the caller falls through to REST.
 */
async function tryPlaywrightBatchExport(
  ctx: NodeContext,
  urls: string[],
  outDir: string,
): Promise<FigmaExportResult> {
  const outDirEsc = outDir.replace(/\\/g, '\\\\');
  // Cross-platform ZIP extraction: pick the command for THIS OS in Node so the
  // agent never has to guess (no PowerShell assumption on macOS/Linux).
  const zipFile = path.join(outDir, 'figma_export.zip');
  const extractCmd =
    process.platform === 'win32'
      ? `powershell -NoProfile -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${outDir}' -Force"`
      : `unzip -o "${zipFile}" -d "${outDir}"`;
  try {
    const { data, raw } = await runAiTask({
      instruction:
        `Export Figma design frames for ${ctx.run.story.jiraKey} using the Playwright MCP batch export ` +
        `(testing-process.md §4.1).\n\n` +
        `Figma URL: ${urls[0]}\n` +
        `Output directory (already exists): ${outDirEsc}\n\n` +
        `Steps:\n` +
        figmaAuthRestoreStep() +
        `1. browser_navigate → ${urls[0]}\n` +
        `2. browser_wait_for → Figma canvas loads (title contains em-dash "–")\n` +
        `3. browser_run_code_unsafe → intercept the download BEFORE triggering the export:\n` +
        `   const downloadPromise = page.waitForEvent('download', {timeout:60000});\n` +
        `4. browser_press_key → "Control+Shift+E" to open the batch export dialog\n` +
        `5. Verify the dialog shows "N of N selected" (all frames selected)\n` +
        `6. browser_click → Export button (try: getByLabel('Export').getByRole('button',{name:'Export'}))\n` +
        `7. browser_run_code_unsafe → await the download and save the ZIP to outDir:\n` +
        `   const dl = await downloadPromise;\n` +
        `   const zipPath = require('path').join(${JSON.stringify(outDir)}, 'figma_export.zip');\n` +
        `   await dl.saveAs(zipPath);\n` +
        `8. Bash → extract the ZIP with this exact command (already selected for the current OS): ${extractCmd}\n` +
        `9. Bash → list extracted PNGs and return the manifest\n\n` +
        `If any step fails, return frames:[] with the error message.`,
      schema: FigmaExportManifest,
      schemaName: 'FigmaExportManifest',
      schemaHint:
        `{"frames":[{"name":"Sufficient balance","file":"${outDirEsc}\\\\Sufficient balance.png"}],"fileKey":"abc123"}`,
      agentic: true,
      permissionMode: 'default',
      cwd: COMPANION_DIR,
      allowedTools: FIGMA_EXPORT_TOOLS,
      model: MODEL,
      timeoutMs: 5 * 60 * 1000,
      onLog: (l) => void ctx.log(l),
      signal: ctx.signal,
    });
    ctx.meta.costUsd += raw.costUsd;
    ctx.meta.tokens += raw.outputTokens;
    if (!data.frames.length) {
      return { frames: [], error: data.error ?? 'playwright batch export returned no frames' };
    }
    return {
      fileKey: data.fileKey,
      frames: data.frames.map((f) => ({ id: 'batch', name: f.name, file: f.file ?? null, bytes: 0 })),
    };
  } catch (e) {
    return { frames: [], error: `playwright batch export: ${(e as Error).message}` };
  }
}

/**
 * TERTIARY Figma export: navigate directly to each frame URL, fit the view
 * (Ctrl+Shift+H), and take a Playwright browser screenshot.
 * Used when batch-export yields nothing (no designer-configured export settings)
 * AND the REST API is rate-limited (429 / Retry-After up to 77 h).
 * Never throws — returns { frames: [], error } on any failure.
 */
async function tryPlaywrightScreenshotFallback(
  ctx: NodeContext,
  urls: string[],
  outDir: string,
): Promise<FigmaExportResult> {
  const outDirEsc = outDir.replace(/\\/g, '\\\\');
  const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join('\n');
  try {
    const { data, raw } = await runAiTask({
      instruction:
        `Capture Figma frame screenshots for ${ctx.run.story.jiraKey} by navigating the browser directly to each frame URL.\n\n` +
        `Figma URLs:\n${urlList}\n\n` +
        `Output directory (already exists): ${outDirEsc}\n\n` +
        figmaAuthRestoreStep() +
        `For EACH URL in order:\n` +
        `1. browser_navigate → the URL (Figma web opens to that exact frame node)\n` +
        `2. browser_wait_for → page title contains a dash or the canvas is visible (timeout 20 s)\n` +
        `3. browser_press_key → "Control+Shift+H"  (fit frame/selection to screen)\n` +
        `4. browser_wait_for → 1000 ms for the view to settle\n` +
        `5. browser_take_screenshot → save to "${outDirEsc}\\\\figma_frame_<N>.png" where N is the 1-based URL index\n\n` +
        `Return a manifest with every screenshot actually saved. If a URL fails, set file:null for that entry and continue.`,
      schema: FigmaExportManifest,
      schemaName: 'FigmaExportManifest',
      schemaHint: `{"frames":[{"name":"figma_frame_1","file":"${outDirEsc}\\\\figma_frame_1.png"}],"fileKey":""}`,
      agentic: true,
      permissionMode: 'default',
      cwd: COMPANION_DIR,
      allowedTools: FIGMA_EXPORT_TOOLS,
      model: MODEL,
      timeoutMs: 5 * 60 * 1000,
      onLog: (l) => void ctx.log(l),
      signal: ctx.signal,
    });
    ctx.meta.costUsd += raw.costUsd;
    ctx.meta.tokens += raw.outputTokens;
    const captured = data.frames.filter((f) => f.file).length;
    if (!captured) {
      return { frames: [], error: data.error ?? 'playwright screenshot fallback: no frames captured' };
    }
    return {
      fileKey: data.fileKey,
      frames: data.frames.map((f) => ({ id: 'screenshot', name: f.name, file: f.file ?? null, bytes: 0 })),
    };
  } catch (e) {
    return { frames: [], error: `playwright screenshot fallback: ${(e as Error).message}` };
  }
}

export const NODES: Record<string, NodeFn> = {
  async create_workspace(ctx) {
    // Verify the QA Companion knowledge base (CLAUDE.md + docs/ai/**) is
    // actually present at COMPANION_DIR before doing any AI work — `claude -p`
    // relies entirely on cwd auto-load for this, so a misconfigured
    // COMPANION_DIR would otherwise silently produce lower-quality output.
    const manifest = verifyKnowledgeBase(COMPANION_DIR);
    if (!manifest.claudeMdFound) {
      throw new Error(
        `CLAUDE.md not found at ${COMPANION_DIR} — the AI would run with no project standards loaded. ` +
          `Set QA_COMPANION_DIR to the QA Companion root (contains CLAUDE.md + docs/ai/**) and re-run.`,
      );
    }
    await ctx.log(
      `knowledge base verified: CLAUDE.md (${manifest.claudeMdBytes} bytes) + ${manifest.docsAiFiles.length} docs/ai/*.md file(s)`,
    );
    const dir = ctx.run.story.workspacePath ?? storyDir(ctx.run.story.jiraKey);
    await mkdir(dir, { recursive: true });
    await Promise.all(STD_SUBFOLDERS.map((s) => mkdir(path.join(dir, s), { recursive: true })));
    await ctx.log(`workspace ready at ${dir}`);
    return { workspacePath: dir, subfolders: STD_SUBFOLDERS };
  },

  async fetch_jira(ctx) {
    // Real Jira ingestion (Milestone 1, P0): description, AC (HeroCoders
    // checklist), comments, linked issues, attachments + any Figma URL, via the
    // proven credentials.js loader. Stored in state for every downstream node.
    const jira = await fetchJiraIssue(ctx.run.story.jiraKey, (l) => void ctx.log(l));
    ctx.state.jira = jira;
    await artifact(ctx, 'requirements-analysis/jira-source.md', jiraSourceMarkdown(jira));
    return jira;
  },

  async parse_instructions(ctx) {
    // Compile the tester's free-text Execution Instructions into structured
    // directives that bias every node's context (guidanceBlock) and drive
    // conditional flow in the runner (skipNodes). No instructions → no AI call.
    const instr = ctx.run.story.executionInstructions?.trim();
    if (!instr) {
      await ctx.log('parse_instructions: no execution instructions');
      ctx.state.directives = {};
      return {};
    }
    const data = await ai(
      ctx,
      aiOpts(
        `Compile the tester's Execution Instructions for ${ctx.run.story.jiraKey} into structured directives. ` +
          `Map a stage skip to its lifecycle node name(s) — e.g. "skip automation generation" → ` +
          `skipNodes:["automation_generation","review_automation"]. Platforms use android/ios/web. ` +
          `A cap on scenarios ("no more than N HLS", "max N HLS") → maxHls:N. ` +
          `Only set fields the instructions actually imply; leave the rest empty.\n\nInstructions:\n${instr}`,
        Directives, 'Directives',
        '{"onlyFlows":["..."],"skipNodes":["..."],"accountOverride":"...","packageNumbers":["..."],"ignoreIssues":["..."],"focus":["..."],"platforms":["..."],"maxHls":20,"notes":"..."}',
        ctx, MODEL_CHEAP,
      ),
    );
    ctx.state.directives = data;
    await ctx.log(`parse_instructions → directives: ${JSON.stringify(data)}`);
    return data;
  },

  async detect_prerequisites(ctx) {
    // Ask ONLY for genuinely-missing, undecidable prerequisites (CLAUDE.md
    // auto-run policy). Reuses the ask/pause/resume machinery.
    const answers = ctx.step.clarification?.answersJson;
    if (answers) {
      ctx.state.prerequisites = { answers };
      await ctx.log('prerequisites provided — resuming');
      return { answers };
    }
    if (Array.isArray(ctx.step.clarification?.questionsJson) && ctx.step.clarification!.questionsJson.length) {
      throw new PausedForInput();
    }
    const data = await ai(
      ctx,
      aiOpts(
        `Identify ONLY the genuinely-missing prerequisites that BLOCK testing ${ctx.run.story.jiraKey} and that the ` +
          `platform cannot derive (an unknown OTP/account/BCID the system can't compute, a required backend status ` +
          `change, or story content that cannot be found). Auto-provisioning of a fresh card user and the test-data ` +
          `pool already cover most needs — do NOT ask for anything obtainable from them or from the Additional Inputs ` +
          `in Context. If nothing is blocking, set ready=true and return no questions.`,
        PrerequisiteCheck, 'PrerequisiteCheck',
        '{"ready":true,"missing":[{"item":"...","why":"..."}],"questions":[{"id":"p1","question":"...","why":"..."}]}',
        ctx, MODEL_CHEAP,
      ),
    );
    if (data.ready || !data.questions.length) {
      await ctx.log('prerequisites satisfied — proceeding');
      return data;
    }
    await emit(makeEvent<Extract<RunEvent, { kind: 'ask.awaiting' }>>({
      kind: 'ask.awaiting',
      runId: ctx.run.id,
      stepId: ctx.step.id,
      questions: data.questions.map((q) => ({ id: q.id, question: q.question, why: q.why })),
    }));
    await ctx.log(`awaiting ${data.questions.length} prerequisite input(s)`);
    throw new PausedForInput();
  },

  async review_requirements(ctx) {
    const d = await reviewGate(ctx, 'review.requirements',
      `Review the analysis for ${ctx.run.story.jiraKey} before generating HLS`,
      { requirements: ctx.state.requirements, impact: ctx.state.impact, figma: ctx.state.figma });
    return { reviewed: d.decision === 'approved', decision: d.decision };
  },

  async review_testcases(ctx) {
    const tc = ctx.state.testcases as TestCases | undefined;
    const d = await reviewGate(ctx, 'review.testcases',
      `Review ${tc?.cases.length ?? 0} test case(s) for ${ctx.run.story.jiraKey} before CSV/upload`,
      { count: tc?.cases.length ?? 0, titles: (tc?.cases ?? []).map((c) => c.title).slice(0, 30) });
    return { reviewed: d.decision === 'approved', decision: d.decision };
  },

  async review_automation(ctx) {
    const d = await reviewGate(ctx, 'review.automation',
      `Review the automation plan for ${ctx.run.story.jiraKey} before execution`,
      ctx.state.automationPlan);
    return { reviewed: d.decision === 'approved', decision: d.decision };
  },

  async review_exploratory(ctx) {
    const ex = ctx.state.exploratory as { charters?: unknown[] } | undefined;
    const d = await reviewGate(ctx, 'review.exploratory',
      `Review ${ex?.charters?.length ?? 0} exploratory charter(s) for ${ctx.run.story.jiraKey} before automation`,
      ctx.state.exploratory);
    return { reviewed: d.decision === 'approved', decision: d.decision };
  },

  async review_report(ctx) {
    const exec = ctx.state.execution as { summary?: Record<string, number> } | undefined;
    const d = await reviewGate(ctx, 'review.report',
      `Review the HTML report for ${ctx.run.story.jiraKey} before filing defects`,
      { reportPath: ctx.state.reportPath, summary: exec?.summary });
    return { reviewed: d.decision === 'approved', decision: d.decision };
  },

  async requirements_analysis(ctx) {
    const data = await ai(
      ctx,
      aiOpts(
        `Perform STEP 1 Requirements Analysis for Jira story ${ctx.run.story.jiraKey} ("${ctx.run.story.title}"). ` +
          `Use the REAL Jira source provided in Context (description, acceptance criteria, comments) — comments may ` +
          `override/clarify the AC. Analyze per CLAUDE.md.`,
        RequirementsAnalysis,
        'RequirementsAnalysis',
        '{"businessObjective":"...","functionalRequirements":["..."],"nonFunctionalRequirements":["..."],"dependencies":["..."],"risks":["..."],"missingRequirements":["..."],"testabilityConcerns":["..."],"commentOverrides":["..."]}',
        ctx,
      ),
    );
    ctx.state.requirements = data;
    await artifact(ctx, 'requirements-analysis/requirements-analysis.md',
      `# Requirements Analysis — ${ctx.run.story.jiraKey}\n\n## Business Objective\n${data.businessObjective}\n\n` +
      `## Functional Requirements\n${md(data.functionalRequirements)}\n\n## Non-Functional Requirements\n${md(data.nonFunctionalRequirements)}\n\n` +
      `## Dependencies\n${md(data.dependencies)}\n\n## Risks\n${md(data.risks)}\n\n## Missing Requirements\n${md(data.missingRequirements)}\n\n` +
      `## Testability Concerns\n${md(data.testabilityConcerns)}\n\n## Comment Overrides\n${md(data.commentOverrides)}\n`);
    return data;
  },

  async acceptance_criteria(ctx) {
    const data = await ai(
      ctx,
      aiOpts(
        `Extract and analyze the acceptance criteria for ${ctx.run.story.jiraKey}. Mark each as testable or not and note gaps.`,
        AcceptanceCriteria,
        'AcceptanceCriteria',
        '{"criteria":[{"id":"AC-1","text":"...","testable":true,"notes":"..."}],"gaps":["..."]}',
        ctx,
        MODEL_CHEAP,
      ),
    );
    ctx.state.acceptanceCriteria = data;
    return data;
  },

  async comments_analysis(ctx) {
    const data = await ai(
      ctx,
      aiOpts(
        `Analyze the Jira comments for ${ctx.run.story.jiraKey}. Comments may override/clarify/invalidate the original AC — surface overrides, clarifications, and any new requirements.`,
        CommentsAnalysis,
        'CommentsAnalysis',
        '{"overrides":["..."],"clarifications":["..."],"newRequirements":["..."],"notes":"..."}',
        ctx,
        MODEL_CHEAP,
      ),
    );
    ctx.state.comments = data;
    return data;
  },

  async linked_stories(ctx) {
    const data = await ai(
      ctx,
      aiOpts(
        `Identify linked/related tickets and linked docs for ${ctx.run.story.jiraKey} and their relationship and testing impact.`,
        LinkedStories,
        'LinkedStories',
        '{"links":[{"key":"B10-...","relationship":"blocks|relates|depends","impact":"..."}],"notes":"..."}',
        ctx,
        MODEL_CHEAP,
      ),
    );
    ctx.state.linkedStories = data;
    return data;
  },

  async figma_analysis(ctx) {
    // STEP 2: export per-story Figma frames then analyze design vs spec.
    // PRIMARY: check Settings → Figma Browser Session cookies, then open the
    // authenticated browser and do a manual export (Ctrl+Shift+E → ZIP).
    // Fallback: REST API via FigmaExporter (rate-limited on View seat, Retry-After up to 77h).
    // See testing-process.md §4.1/§4.5.
    const jira = ctx.state.jira as JiraSource | undefined;
    const dir = (ctx.state.workspacePath as string) ?? storyDir(ctx.run.story.jiraKey);
    const outDir = path.join(dir, 'figma-analysis');
    await mkdir(outDir, { recursive: true });

    // Figma URLs come from the Jira ticket (description/AC/comments), the tester's
    // Execution Instructions / Additional Inputs (testers frequently paste the
    // design link in the story instructions rather than the ticket — root cause of
    // B10-56729 "Export method: none"), and — as a last resort — a link the tester
    // supplies when the platform asks for it below. A tester-supplied link is
    // persisted to a sidecar so it survives a later pause in this same node (e.g.
    // the session re-auth gate re-runs the node from the top on resume).
    const urlSidecar = path.join(outDir, 'figma-urls.json');
    let urls = extractFigmaUrls(
      ...(jira?.figmaUrls ?? []),
      ctx.run.story.executionInstructions,
      ctx.run.story.additionalInputs,
      existsSync(urlSidecar) ? readFileSync(urlSidecar, 'utf8') : '',
    );

    // No Figma link found in the ticket OR the story instructions → PAUSE and ask
    // the tester for one. Answerable: paste a URL to validate against, or reply
    // "none" to proceed with a spec-only analysis (backend-only / design-less
    // stories). Mirrors the ask/pause/resume machinery used by detect_prerequisites.
    if (!urls.length) {
      const answers = ctx.step.clarification?.answersJson as { id?: string; answer?: string }[] | undefined;
      if (Array.isArray(answers) && answers.length) {
        urls = extractFigmaUrls(answers.map((a) => a?.answer ?? '').join('\n'));
        if (urls.length) {
          await writeFile(urlSidecar, JSON.stringify(urls, null, 2), 'utf8');
          await ctx.log(`figma_analysis: using tester-supplied Figma link(s) — ${urls.length} url(s)`);
        } else {
          await ctx.log('figma_analysis: tester supplied no Figma link — proceeding with spec-only analysis');
        }
      } else if (Array.isArray(ctx.step.clarification?.questionsJson) && ctx.step.clarification!.questionsJson.length) {
        throw new PausedForInput();
      } else {
        await emit(makeEvent<Extract<RunEvent, { kind: 'ask.awaiting' }>>({
          kind: 'ask.awaiting',
          runId: ctx.run.id,
          stepId: ctx.step.id,
          questions: [{
            id: 'figma_link',
            question:
              `No Figma design link was found in the Jira ticket or the story instructions for ${ctx.run.story.jiraKey}. ` +
              `Paste the Figma design URL to validate against, or reply "none" to continue with a spec-only analysis.`,
            why: 'STEP 2 Figma validation needs the per-story design link; it normally lives in the Jira ticket or the story instructions.',
          }],
        }));
        await ctx.log('figma_analysis: no Figma link found in ticket or instructions — awaiting tester input');
        throw new PausedForInput();
      }
    }

    // STEP 0 — mandatory session gate: verify the Figma Browser Session cookies
    // (Settings page) are saved and fresh BEFORE opening the browser for the
    // manual export. Never attempt the export against a missing/expired session
    // and silently fall through — pause and ask the tester to (re)authenticate.
    if (urls.length) {
      const session = getFigmaSessionStatus();
      if (session.status !== 'connected') {
        await ctx.log(`figma_analysis: Figma session ${session.status} — ${session.message}`);
        await emit(makeEvent<Extract<RunEvent, { kind: 'ask.awaiting' }>>({
          kind: 'ask.awaiting',
          runId: ctx.run.id,
          stepId: ctx.step.id,
          questions: [{
            id: 'figma_reauth',
            question:
              `Figma browser session is ${session.status}. Open Settings → Figma Browser Session and click ` +
              `"${session.status === 'expired' ? 'Reconnect' : 'Connect'} Figma" to log in, then type "done" to continue.`,
            why: session.message,
          }],
        }));
        throw new PausedForInput();
      }
      await ctx.log(`figma_analysis: Figma session connected (${session.cookieCount} cookie(s)) — proceeding with browser export`);
    }

    let exported: FigmaExportResult = { frames: [] };
    let exportMethod = 'none';

    if (urls.length) {
      // Step 1 — PRIMARY: Playwright Ctrl+Shift+E batch export.
      // Authenticated browser, no API quota, produces named PNGs from the ZIP.
      const batchResult = await tryPlaywrightBatchExport(ctx, urls, outDir);
      if (batchResult.frames.filter((f) => f.file).length) {
        exported = batchResult;
        exportMethod = 'playwright-batch';
        await ctx.log(`figma_analysis: Playwright batch export → ${exported.frames.length} frame(s)`);
      } else {
        // Step 2 — FALLBACK: REST API via FigmaExporter.js.
        // Rate-limited on the View seat (Retry-After up to 77h observed 2026-06-29).
        await ctx.log(
          `figma_analysis: Playwright batch export yielded no frames (${batchResult.error ?? 'none'}) ` +
          `— falling back to REST API (⚠ rate-limited; Retry-After up to 77h on View seat)`,
        );
        exported = await exportStoryFrames(urls, outDir, (l) => void ctx.log(l));
        const restFrames = exported.frames.filter((f) => f.file).length;
        exportMethod = restFrames ? 'rest-api' : 'none';
        if (restFrames) {
          await ctx.log(`figma_analysis: REST API fallback → ${restFrames} frame(s)`);
        } else {
          // Step 3 — TERTIARY FALLBACK: Playwright browser screenshot.
          // Navigate to each Figma URL directly, fit frame (Ctrl+Shift+H), screenshot.
          // No export settings needed, no Figma API quota.
          await ctx.log(
            `figma_analysis: REST API also yielded no frames (${exported.error ?? 'unknown'}) ` +
            `— trying Playwright browser screenshot fallback`,
          );
          exported = await tryPlaywrightScreenshotFallback(ctx, urls, outDir);
          const shotFrames = exported.frames.filter((f) => f.file).length;
          exportMethod = shotFrames ? 'playwright-screenshot' : 'none';
          if (shotFrames) await ctx.log(`figma_analysis: Playwright screenshot fallback → ${shotFrames} frame(s)`);
          else await ctx.log(`figma_analysis: all export methods failed — analysis will be spec-only`);
        }
      }
    }

    // Reconciliation: the tertiary (screenshot) tier is per-URL — figma_frame_<N>
    // maps 1:1 to urls[N-1] — and explicitly returns file:null for a failed URL
    // rather than omitting it. Retry just those once before deciding completeness.
    let missing = exported.frames.filter((f) => !f.file);
    if (missing.length && exportMethod === 'playwright-screenshot' && urls.length) {
      const missingUrls = missing
        .map((f) => Number(String(f.name).match(/figma_frame_(\d+)/)?.[1]))
        .filter((n): n is number => Number.isFinite(n))
        .map((n) => urls[n - 1])
        .filter(Boolean);
      if (missingUrls.length) {
        await ctx.log(`figma_analysis: retrying ${missingUrls.length} missing frame(s) via screenshot fallback`);
        const retry = await tryPlaywrightScreenshotFallback(ctx, missingUrls, outDir);
        const retried = new Map(retry.frames.filter((f) => f.file).map((f) => [f.name, f]));
        exported = { ...exported, frames: exported.frames.map((f) => retried.get(f.name) ?? f) };
        missing = exported.frames.filter((f) => !f.file);
      }
    }
    // Batch/REST tiers don't carry per-URL granularity, so completeness there is
    // judged on whether ANY frame came back at all — a total failure (0 frames
    // for a story that HAS a Figma URL) is just as "incomplete" as named gaps.
    const gotAnyFrame = exported.frames.filter((f) => f.file).length > 0;
    if (urls.length && (!gotAnyFrame || missing.length)) {
      await reviewGate(
        ctx,
        'review.figma_export',
        `Figma export incomplete for ${ctx.run.story.jiraKey} (via ${exportMethod}): ` +
          `${gotAnyFrame ? `${missing.length} frame(s) missing` : 'no frames exported at all'}. ` +
          `Approve to continue with a spec-only/partial analysis, or reject to stop and retry manually.`,
        {
          exportMethod,
          requested: urls,
          exported: exported.frames.filter((f) => f.file).map((f) => f.name),
          missing: missing.map((f) => f.name),
        },
      );
    }

    const frameFiles = exported.frames.filter((f) => f.file).map((f) => f.file as string);

    const baseInstr =
      `Perform STEP 2 Figma analysis for ${ctx.run.story.jiraKey}. Compare the design against the description, ` +
      `acceptance criteria and comments in Context. Surface screens, states (default/filled/empty/error/loading), ` +
      `validation rules, copy/localization (en-US + ar-EG incl. RTL/truncation), UX inconsistencies, and any ` +
      `gaps/contradictions/missing states vs the spec (testing-process.md §4).`;
    const hint =
      '{"analyzed":true,"screens":[{"name":"...","summary":"..."}],"states":["..."],"validations":["..."],' +
      '"gaps":["..."],"missingStates":["..."],"localizationNotes":["..."],"uxFindings":["..."],"notes":"..."}';

    let data;
    if (frameFiles.length) {
      data = await ai(ctx, {
        ...aiOpts(
          `${baseInstr} The exported design frames (PNG @2x, via ${exportMethod}) are these files — READ each one and analyze the actual pixels:\n` +
            frameFiles.map((f) => `- ${f.replace(/\\/g, '\\\\')}`).join('\n'),
          FigmaAnalysis, 'FigmaAnalysis', hint, ctx,
        ),
        agentic: true,
        permissionMode: 'default',
        allowedTools: ['Read'],
        timeoutMs: 8 * 60 * 1000,
      });
    } else {
      const why = urls.length
        ? `all export methods failed (${exported.error ?? 'unknown'})`
        : 'no Figma URL in the ticket';
      await ctx.log(`figma_analysis: ${why} — analyzing design expectations from the spec only`);
      data = await ai(
        ctx,
        aiOpts(
          `${baseInstr} NOTE: design frames could not be exported (${why}); analyze design expectations from the spec ` +
            `and explicitly flag that visual frames were unavailable.`,
          FigmaAnalysis, 'FigmaAnalysis', hint, ctx, MODEL_CHEAP,
        ),
      );
    }
    // Attach the export manifest + file key (set by code, not the model).
    // Batch-exported frames use synthetic id='batch'; suppress nodeId for those.
    data.frames = exported.frames.map((f) => ({
      name: f.name,
      file: f.file ?? undefined,
      nodeId: f.id !== 'batch' ? f.id : undefined,
    }));
    if (exported.fileKey) data.fileKey = exported.fileKey;
    ctx.state.figma = data;
    await artifact(ctx, 'figma-analysis/figma-analysis.md', renderFigmaMd(ctx.run.story.jiraKey, data, exported, exportMethod));
    return data;
  },

  async clarification(ctx) {
    // Resume: answers already submitted → consume and continue.
    const answers = ctx.step.clarification?.answersJson;
    if (answers) {
      ctx.state.clarification = { answers };
      await ctx.log('clarification answered — resuming');
      return { answers };
    }
    // Already asked, still waiting → pause again without re-spending an AI call.
    if (Array.isArray(ctx.step.clarification?.questionsJson) && ctx.step.clarification!.questionsJson.length) {
      throw new PausedForInput();
    }
    // First time: decide what (if anything) genuinely needs asking.
    const data = await ai(
      ctx,
      aiOpts(
        `Based on the analysis so far, produce the STEP 3 clarification questions genuinely needed before test design ` +
          `for ${ctx.run.story.jiraKey}. Only ask what truly blocks scope. If none, return an empty list.`,
        ClarificationQuestions,
        'ClarificationQuestions',
        '{"questions":[{"id":"q1","question":"...","why":"...","suggestedAnswers":["..."]}]}',
        ctx,
      ),
    );
    if (!data.questions.length) {
      await ctx.log('no clarifications needed');
      return { questions: [], answers: [] };
    }
    await emit(makeEvent<Extract<RunEvent, { kind: 'ask.awaiting' }>>({
      kind: 'ask.awaiting',
      runId: ctx.run.id,
      stepId: ctx.step.id,
      questions: data.questions.map((q) => ({ id: q.id, question: q.question, why: q.why })),
    }));
    await ctx.log(`awaiting ${data.questions.length} clarification answer(s)`);
    throw new PausedForInput();
  },

  async impact_analysis(ctx) {
    const data = await ai(
      ctx,
      aiOpts(
        `Perform STEP 4 Impact Analysis for ${ctx.run.story.jiraKey}: Impacted Areas, Regression Areas, ` +
          `Smoke Coverage, Automation Impact (regression-strategy.md §1).`,
        ImpactAnalysis,
        'ImpactAnalysis',
        '{"impactedAreas":["..."],"regressionAreas":["..."],"smokeCoverage":["..."],"automationImpact":["..."]}',
        ctx,
      ),
    );
    ctx.state.impact = data;
    return data;
  },

  async generate_hls(ctx) {
    // Standing rule: HLS count is capped (default 20). Resolution order:
    // execution-instruction override (directives.maxHls) → Settings hls.maxScenarios
    // → env QA_HLS_MAX → 20. Enforced in the prompt AND as a hard backstop so the
    // model can never exceed it even if it ignores the instruction.
    const s = await getSettings();
    const maxHls = await resolveHlsCap(ctx, s);
    const data = await ai(
      ctx,
      aiOpts(
        `Generate STEP 5 High Level Scenarios for ${ctx.run.story.jiraKey}. Cover happy paths, negatives, edge cases, ` +
          `state transitions, validations, navigation, permissions, localization (en-US + ar-EG), error handling, regression risks. ` +
          `HARD LIMIT: produce NO MORE THAN ${maxHls} scenarios — consolidate and prioritize the highest-risk coverage; ` +
          `do not pad. Number them 1..N (N ≤ ${maxHls}).`,
        Hls,
        'Hls',
        '{"storyName":"...","scenarios":[{"index":1,"text":"Verify ..."}]}',
        ctx,
      ),
    );
    // Hard backstop: truncate + re-index if the model overshot the cap.
    if (data.scenarios.length > maxHls) {
      await ctx.log(`HLS cap enforced: model returned ${data.scenarios.length}, truncating to ${maxHls}.`);
      data.scenarios = data.scenarios.slice(0, maxHls);
    }
    data.scenarios = data.scenarios.map((sc, i) => ({ ...sc, index: i + 1 }));
    ctx.state.hls = data;
    // Mirror to hls/ in the canonical "HLS || <name>" + "1- Verify ..." format.
    await artifact(ctx, 'hls/hls.md',
      `HLS || ${data.storyName}\n` + data.scenarios.map((sc) => `${sc.index}- ${sc.text}`).join('\n') + '\n');
    return data;
  },

  async gate_push_hls(ctx) {
    const hls = ctx.state.hls as { storyName: string; scenarios: { index: number; text: string }[] } | undefined;
    const decision = await gate(ctx, 'jira.push_hls', `Push ${hls?.scenarios.length ?? 0} HLS scenarios to ${ctx.run.story.jiraKey} as a checklist`, ctx.state.hls);
    if (decision.decision !== 'approved') return { pushed: false, decision: decision.decision };
    if (!hls) return { pushed: false };
    const body = `HLS || ${hls.storyName}\n` + hls.scenarios.map((s) => `${s.index}- ${s.text}`).join('\n');
    if (DRY_RUN) {
      await artifact(ctx, 'hls/jira-hls-payload.md', `<!-- DRY-RUN: would be added to ${ctx.run.story.jiraKey} as the HLS checklist -->\n${body}\n`);
      await ctx.log(`DRY-RUN: would push ${hls.scenarios.length} HLS scenario(s) to ${ctx.run.story.jiraKey}; saved to hls/jira-hls-payload.md (not posted).`);
      return { pushed: false, dryRun: true, scenarios: hls.scenarios.length };
    }
    // Real write via the Atlassian MCP (behind this approval gate). Adds a NEW
    // comment — never touches the description/AC. Falls back to the local
    // hls/hls.md file if the MCP write isn't available headless.
    try {
      const res = await runClaude({
        prompt:
          `Using your Atlassian/Jira tools, add a NEW comment to Jira issue ${ctx.run.story.jiraKey} containing EXACTLY this text ` +
          `(it is a separate HLS checklist section — do NOT modify the description or acceptance criteria):\n\n${body}\n\n` +
          `After adding the comment, reply with only the comment URL, or "FAILED: <reason>".`,
        cwd: COMPANION_DIR,
        model: MODEL,
        permissionMode: 'default',
        allowedTools: [
          'mcp__claude_ai_Atlassian_Rovo__addCommentToJiraIssue',
          'mcp__claude_ai_Atlassian_Rovo__getJiraIssue',
          'mcp__claude_ai_Atlassian_Rovo__getAccessibleAtlassianResources',
        ],
        timeoutMs: 180000,
        onLog: (l) => void ctx.log(l),
        signal: ctx.signal,
      });
      const ok = !res.isError && !/FAILED/i.test(res.text);
      await ctx.log(`Jira push ${ok ? 'OK' : 'result'}: ${res.text.slice(0, 200)}`);
      if (!ok) return { pushed: false, jira: res.text.slice(0, 300) };

      // Verify the comment actually landed by fetching the issue back.
      // Prevents a false "pushed:true" when the MCP silently fails.
      try {
        const verify = await runClaude({
          prompt:
            `Use getJiraIssue to fetch ${ctx.run.story.jiraKey}. ` +
            `Check whether any of the issue's comments contains the text "HLS ||". ` +
            `Reply ONLY with "VERIFIED: <commentId>" if found, or "NOT_FOUND" if not.`,
          cwd: COMPANION_DIR,
          model: MODEL_CHEAP,
          permissionMode: 'default',
          allowedTools: [
            'mcp__claude_ai_Atlassian_Rovo__getJiraIssue',
            'mcp__claude_ai_Atlassian_Rovo__getAccessibleAtlassianResources',
          ],
          timeoutMs: 60_000,
          onLog: (l) => void ctx.log(l),
          signal: ctx.signal,
        });
        const verified = !verify.isError && /VERIFIED/i.test(verify.text);
        await ctx.log(`Jira HLS verify: ${verify.text.slice(0, 120)}`);
        return { pushed: verified, jira: res.text.slice(0, 300), verified };
      } catch {
        // Verification failed (MCP unavailable) — trust the push response.
        return { pushed: ok, jira: res.text.slice(0, 300), verified: null };
      }
    } catch (e) {
      await ctx.log(`Jira push failed (HLS saved in hls/hls.md): ${(e as Error).message}`);
      return { pushed: false };
    }
  },

  async generate_testcases(ctx) {
    const data = await ai(
      ctx,
      aiOpts(
        `Generate STEP 6 detailed test cases for ${ctx.run.story.jiraKey} in the canonical granular standard ` +
          `(browserstack-process.md §10.0): one user action per step, every step has its OWN Expected Result, ` +
          `never combine actions; navigation/validation/verification are explicit steps. Cover all HLS scenarios. ` +
          `Set: type (Functional/Acceptance/Regression/Usability/Smoke & Sanity), priority (Critical/High/Medium/Low), ` +
          `automationStatus (default "Not Automated"), a one-line description, and preconditions.`,
        TestCases,
        'TestCases',
        '{"cases":[{"title":"...","description":"...","preconditions":"...","type":"Functional","priority":"High","automationStatus":"Not Automated","steps":[{"action":"...","expectedResult":"..."}]}]}',
        ctx,
      ),
    );
    ctx.state.testcases = data;
    return data;
  },

  async generate_csv(ctx) {
    const tc = ctx.state.testcases as TestCases | undefined;
    const dir = (ctx.state.workspacePath as string) ?? storyDir(ctx.run.story.jiraKey);
    const csv = toBrowserstackCsv(tc, ctx.run.story);
    const file = path.join(dir, 'testcases', `${ctx.run.story.jiraKey}_browserstack_testcases.csv`);
    await writeFile(file, csv, 'utf8');
    await ctx.log(`CSV written (24-col canonical): ${file}`);
    return { csvPath: file, rows: tc?.cases.length ?? 0 };
  },

  async gate_upload_browserstack(ctx) {
    const decision = await gate(ctx, 'browserstack.upload_testcases', `Upload test cases to BrowserStack (folder ${ctx.run.story.bsFolderId ?? 'default'})`, { csvPath: ctx.state.csvPath });
    if (decision.decision !== 'approved') return { uploaded: false, decision: decision.decision };
    const csv = ctx.state.csvPath as string | undefined;
    if (!csv) {
      await ctx.log('no CSV to upload');
      return { uploaded: false };
    }
    if (DRY_RUN) {
      await ctx.log(`DRY-RUN: would upload ${csv} to BrowserStack folder ${ctx.run.story.bsFolderId ?? 'default'} (not uploaded).`);
      return { uploaded: false, dryRun: true, csvPath: csv };
    }
    // Primary import method: Playwright browser UI (email + password). Needs the
    // BrowserStack login + target project. Rather than silently skipping when
    // these aren't configured, pause and ask the tester (Use Once / Save / Cancel).
    const s = await getSettings();
    const creds = await requireCredential(
      ctx,
      [
        {
          key: 'browserstack.username', label: 'BrowserStack Username', group: 'browserstack', secret: false,
          description: 'Login email for BrowserStack Test Management, used to import the generated test cases.',
          whenUsed: 'Used now — to sign in and import this story’s test cases.',
          obtainText: 'BrowserStack → Account & Profile → Settings → Username',
          obtainUrl: 'https://www.browserstack.com/accounts/profile/details',
        },
        {
          key: 'browserstack.uiPassword', label: 'BrowserStack Password', group: 'browserstack', secret: true,
          description: 'Password used to sign in and import test cases through the BrowserStack UI.',
          whenUsed: 'Used now — to sign in and import this story’s test cases.',
          obtainText: 'Your BrowserStack Test Management login password.',
        },
        {
          key: 'browserstack.defaultProject', label: 'Test Management Project', group: 'browserstack', secret: false,
          description: 'The Test Management project the generated test cases are imported into.',
          whenUsed: 'Used now — as the import destination.',
          obtainText: 'Test Management → open your project → the project ID is in the page URL.',
        },
      ],
      'Importing the generated test cases into BrowserStack Test Management needs your BrowserStack login and target project.',
      {
        'browserstack.username': process.env.BS_TM_UI_USERNAME || process.env.BS_TM_USERNAME,
        'browserstack.uiPassword': process.env.BS_TM_UI_PASSWORD,
        'browserstack.defaultProject': process.env.BS_TM_PROJECT,
      },
    );
    const uiUser = creds['browserstack.username'];
    const uiPass = creds['browserstack.uiPassword'];
    const projectId = creds['browserstack.defaultProject'];
    const folderId = ctx.run.story.bsFolderId || s['browserstack.defaultFolder'] || process.env.BS_TM_FOLDER || '';

    const csvEsc = csv.replace(/\\/g, '\\\\');
    const tmUrl = `https://test-management.browserstack.com/projects/${projectId}${folderId ? `/folder/${folderId}` : ''}/test-cases`;
    await ctx.log(`BrowserStack UI import: navigating to ${tmUrl}`);

    try {
      const uiResult = await runClaude({
        prompt:
          `Import a BrowserStack Test Management CSV via the browser UI.\n\n` +
          `Steps:\n` +
          `1. browser_navigate → https://www.browserstack.com/users/sign_in\n` +
          `   If already logged in, skip to step 4.\n` +
          `2. browser_fill_form → fill email "${uiUser}" and password "${uiPass}", then submit\n` +
          `3. browser_wait_for → URL contains "test-management" or "accounts" (login succeeded)\n` +
          `4. browser_navigate → ${tmUrl}\n` +
          `5. browser_wait_for → page contains "Import" button or "test-cases" heading\n` +
          `6. browser_click → the Import button (look for button with text "Import" near the test case list header)\n` +
          `7. browser_wait_for → import dialog or file input appears\n` +
          `8. browser_file_upload → find the hidden file input (selector: input[accept*="csv"]) and upload: ${csvEsc}\n` +
          `   If browser_file_upload is unavailable, use browser_run_code_unsafe with:\n` +
          `   await page.locator('input[accept*="csv"]').setInputFiles('${csvEsc.replace(/'/g, "\\'")}');\n` +
          `9. browser_wait_for → field mapping step (column headers shown)\n` +
          `10. browser_click → "Import Test Cases" or "Confirm" button\n` +
          `11. browser_wait_for → success toast or redirect to test-cases list\n` +
          `12. browser_take_screenshot → save to "${csvEsc.replace(/[^\\]+$/, '')}bs_import_result.png"\n\n` +
          `Reply "IMPORTED: <count> test cases" on success, or "FAILED: <reason>" on failure.`,
        cwd: COMPANION_DIR,
        model: MODEL,
        permissionMode: 'default',
        allowedTools: [...PLAYWRIGHT_TOOLS, 'Bash'],
        timeoutMs: 10 * 60 * 1000,
        onLog: (l) => void ctx.log(l),
        signal: ctx.signal,
      });
      const uiOk = !uiResult.isError && /IMPORTED/i.test(uiResult.text);
      await ctx.log(`BrowserStack UI import ${uiOk ? 'succeeded' : 'result'}: ${uiResult.text.slice(0, 200)}`);
      return { uploaded: uiOk, folder: folderId, method: 'ui' };
    } catch (e) {
      await ctx.log(`BrowserStack UI import error: ${(e as Error).message}`);
      return { uploaded: false, reason: 'ui-import-error' };
    }
  },

  async exploratory_testing(ctx) {
    // Step 1 — Plan: charters, risk areas, fragile flows (cheap model, no tools).
    const plan = await ai(
      ctx,
      aiOpts(
        `Produce exploratory testing charters for ${ctx.run.story.jiraKey} (exploratory-testing.md): areas to probe, risk areas, and fragile flows for ${ctx.run.story.platform}.`,
        ExploratoryNotes,
        'ExploratoryNotes',
        '{"charters":[{"area":"...","idea":"..."}],"riskAreas":["..."],"fragileFlows":["..."]}',
        ctx,
        MODEL_CHEAP,
      ),
    );

    const story = ctx.run.story;
    const isWeb = story.platform === 'web';
    if (!isWeb || !story.appUrl) {
      await ctx.log(
        isWeb
          ? 'exploratory_testing: no appUrl configured — charters only, no live probing'
          : 'exploratory_testing: mobile story — charters only (no BrowserStack session at this phase); hands-on probing happens during execution',
      );
      ctx.state.exploratory = plan;
      return plan;
    }

    // Step 2 — Probe: actually drive the live app per the charters above, like a
    // human exploratory tester (not scripted test-case steps — those come later
    // in generate_testcases/execution). Capture screenshots of anything unexpected.
    const dir = (ctx.state.workspacePath as string) ?? storyDir(story.jiraKey);
    const shotsDir = path.join(dir, 'screenshots');
    await mkdir(shotsDir, { recursive: true });
    const c = story.credentials ?? undefined;
    const creds = c?.username
      ? `Log in at ${story.appUrl} with username "${c.username}" and password "${c.password ?? ''}".` +
        (c.otpMethod && c.otpMethod !== 'none' ? ` OTP method: ${c.otpMethod} (see CLAUDE.md §7 for how to obtain it).` : '')
      : `Open ${story.appUrl}.`;
    const charterList = plan.charters.map((ch) => `- ${ch.area}: ${ch.idea}`).join('\n') || '(none planned — explore broadly around the story)';

    try {
      const probed = await ai(ctx, {
        ...aiOpts(
          `Use the Playwright browser tools to actually explore the live app for ${story.jiraKey} ("${story.title}"). ${creds}\n\n` +
            `Charters to probe (spend real time on each — try boundary values, invalid input, unusual navigation, rapid repeat actions, ` +
            `back/refresh mid-flow — the things a human exploratory tester would try, not the scripted happy-path steps from the test cases):\n` +
            `${charterList}\n\n` +
            `Also probe these risk areas: ${plan.riskAreas.join('; ') || '(none flagged)'}\n` +
            `And these fragile flows: ${plan.fragileFlows.join('; ') || '(none flagged)'}\n\n` +
            `For every genuinely unexpected or noteworthy result, use browser_take_screenshot to save evidence under ` +
            `"${shotsDir.replace(/\\/g, '\\\\')}" (name it exploratory_<n>_<slug>.png) and record it as a finding. Do NOT invent findings — ` +
            `only report what you actually observed while probing. Do not perform destructive/irreversible actions.`,
          ExploratoryNotes,
          'ExploratoryNotes',
          '{"charters":[],"riskAreas":[],"fragileFlows":[],"findings":[{"area":"...","observation":"...","screenshot":"<path>"}],"probed":true}',
          ctx,
        ),
        agentic: true,
        permissionMode: 'default',
        allowedTools: PLAYWRIGHT_TOOLS,
        disallowedTools: ['Task'],
        model: MODEL_EXECUTION,
        effort: EFFORT_EXECUTION,
        timeoutMs: 20 * 60 * 1000,
      });
      const data: ExploratoryNotes = { ...plan, findings: probed.findings, probed: true };
      await ctx.log(`exploratory_testing: probed live app — ${data.findings.length} finding(s)`);
      ctx.state.exploratory = data;
      return data;
    } catch (e) {
      await ctx.log(`exploratory_testing: live probing failed, falling back to charters only: ${(e as Error).message}`);
      ctx.state.exploratory = plan;
      return plan;
    }
  },

  async automation_generation(ctx) {
    // Step 1 — Plan: identify reusable assets + spec files to create.
    // Resolved, cross-platform paths (no hardcoded drive letters). Framework
    // locations come from the Framework Registry (env overrides); when unset a
    // clear "configure it" hint is surfaced instead of a broken D:\ path.
    const fw = await resolveFrameworks();
    const sharedPagesDir = companionPath('automation', 'pages');
    const pwFramework = fw.playwright ?? '(configure a Playwright framework in the Framework Registry)';
    const javaFramework = fw.javaAppium ?? '(configure a Java/Appium framework in the Framework Registry)';
    const data = await ai(
      ctx,
      aiOpts(
        `Plan automation for ${ctx.run.story.jiraKey} on ${ctx.run.story.platform}. ` +
        `Enforce reuse-before-build against the framework catalogs (docs/ai/automation/**): ` +
        `list reusable assets, any new page objects needed, and the spec files to create. ` +
        `For web: Playwright specs go to the story's automation/tests/ folder. ` +
        `Shared page objects go to ${sharedPagesDir}. ` +
        `For mobile: describe the Java/Appium test class plan (framework at ${javaFramework}).`,
        AutomationPlan,
        'AutomationPlan',
        '{"reusableAssets":["..."],"newPageObjects":["..."],"specs":[{"name":"...","framework":"playwright|appium","description":"..."}],"notes":"..."}',
        ctx,
      ),
    );
    ctx.state.automationPlan = data;

    const dir = (ctx.state.workspacePath as string) ?? storyDir(ctx.run.story.jiraKey);
    const automationDir = path.join(dir, 'automation');
    await mkdir(automationDir, { recursive: true });
    await artifact(ctx, 'automation/automation-plan.json', JSON.stringify(data, null, 2));
    await ctx.log(`automation plan ready: ${data.specs.length} spec(s) to create`);

    // Step 2 — Write: spawn an agentic agent to create the actual spec files.
    // For mobile (Appium) the agent describes what to create in a README since
    // the Java framework requires Maven build setup.
    const platform = ctx.run.story.platform;
    const isWeb = platform === 'web';
    const tc = ctx.state.testcases as { cases: Array<{ title: string; steps: unknown[] }> } | undefined;
    const caseCount = tc?.cases.length ?? 0;

    if (!caseCount) {
      await ctx.log('automation_generation: no test cases in state — skipping spec writing');
      return data;
    }

    try {
      await runClaude({
        prompt:
          `You are implementing automation specs for Jira story ${ctx.run.story.jiraKey} ("${ctx.run.story.title}").\n\n` +
          `Automation plan:\n${JSON.stringify(data, null, 2)}\n\n` +
          `Platform: ${platform}\n` +
          `Story workspace: ${dir.replace(/\\/g, '\\\\')}\n\n` +
          (isWeb
            ? `TASK (Playwright/JS):\n` +
              `1. Read the automation plan above carefully.\n` +
              `2. Check for existing reusable page objects / helpers in ${sharedPagesDir} and the configured Playwright framework's pages/ before writing anything new.\n` +
              `3. For each new page object in the plan: write it to ${sharedPagesDir} (follow the BasePage pattern in the configured Playwright framework: ${pwFramework}).\n` +
              `4. Write the test spec file(s) to ${automationDir.replace(/\\/g, '\\\\')}\\tests\\ — file name matching the spec name in the plan.\n` +
              `   Follow the coding standard at docs/ai/automation/coding-standards.md: ` +
              `   granular steps, env-var-gated destructive tests, const EXPECTED_* for copy assertions, beforeEach login.\n` +
              `5. Write a README.md to ${automationDir.replace(/\\/g, '\\\\')} describing how to run the specs and listing preconditions.\n` +
              `6. Verify the spec file(s) exist and contain valid JS (no TypeScript annotations).`
            : `TASK (Mobile/Appium — Java framework at ${javaFramework}):\n` +
              `1. Read the automation plan and the Java framework catalog at docs/ai/automation/java-framework.md.\n` +
              `2. DO NOT write Java files (the build requires Maven setup). Instead:\n` +
              `   a. Write a detailed framework-reference.md to ${automationDir.replace(/\\/g, '\\\\')}\\framework-reference.md ` +
              `      listing: which existing page objects / helpers to reuse, which new ones are needed, ` +
              `      class names + method signatures for all new page objects, and the step-by-step navigation needed for each spec.\n` +
              `   b. Write a README.md describing how to run the Appium test from ${javaFramework} via Maven.\n`) +
          `\nDo NOT add speculative features, TODOs, or placeholder comments. Write exactly what is needed for the test cases in the plan. ` +
          `Reply "DONE: <comma-separated list of files written>" when finished, or "PARTIAL: <files written> — <what failed>" if some files could not be written.`,
        cwd: COMPANION_DIR,
        model: MODEL,
        permissionMode: 'default',
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        timeoutMs: 15 * 60 * 1000,
        onLog: (l) => void ctx.log(l),
        signal: ctx.signal,
      });
      await ctx.log('automation spec generation complete');
    } catch (e) {
      await ctx.log(`automation spec generation failed (plan saved to automation/automation-plan.json): ${(e as Error).message}`);
    }
    return data;
  },

  async execution(ctx) {
    // Phase 2 — REAL execution. Web: a headless Claude agent drives the live app
    // through the Playwright MCP. Mobile: a headless agent drives BrowserStack
    // App Automate via bs_helper.js. Both return the same ExecutionResults shape.
    const story = ctx.run.story;
    const tc = ctx.state.testcases as TestCases | undefined;
    let cases = tc?.cases ?? [];
    if (!cases.length) {
      await ctx.log('execution: no test cases to run');
      return emptyExecution('no test cases generated');
    }
    // executionType scoping: smoke → Critical/High only.
    if ((story.executionType ?? 'full') === 'smoke') {
      const before = cases.length;
      cases = cases.filter((c) => c.priority === 'Critical' || c.priority === 'High');
      await ctx.log(`smoke run: ${cases.length}/${before} cases (Critical/High)`);
    }
    // en-US first (per scope decision); first configured locale wins.
    const locale = ((ctx.state as any).story?.locales?.[0] as string) ?? 'en-US';
    const dir = (ctx.state.workspacePath as string) ?? storyDir(story.jiraKey);
    const shotsDir = path.join(dir, 'screenshots');
    await mkdir(shotsDir, { recursive: true });
    // Write the case list to a file the agent READS — inlining it into the
    // `claude -p "<prompt>"` argv overflows the OS command-line limit (ENAMETOOLONG).
    const casesFile = path.join(dir, 'execution-reports', '_execution_input.md');
    await mkdir(path.dirname(casesFile), { recursive: true });
    await writeFile(casesFile, `# Test cases to execute — ${story.jiraKey}\n\n${renderCaseList(cases)}\n`, 'utf8');

    const isWeb = story.platform === 'web';
    const bs = story.bsAppIds ?? undefined;
    const hasMobileApp = !!(bs?.android || bs?.ios);
    if (!isWeb && !hasMobileApp) {
      await ctx.log('execution: mobile story has no BrowserStack app IDs — cannot run; recording as blocked');
      return emptyExecution('mobile story missing bsAppIds (android/ios) — execution skipped', false);
    }

    const common =
      `You are executing QA test cases for Jira story ${story.jiraKey} ("${story.title}") in the ${story.environment ?? 'testing'} ` +
      `environment, locale ${locale}. Execute ONLY against the ${story.environment ?? 'testing'} environment. For EACH test case: perform every step ` +
      `in order, compare the live result to its EXPECTED result, and decide a status: "pass" (all steps matched), "fail" (a step's ` +
      `actual ≠ expected — capture a defect), "blocked" (could not run, e.g. precondition/data/permission missing), or "skipped". ` +
      `Capture at least one screenshot per case into "${shotsDir.replace(/\\/g, '\\\\')}" (name it <index>_<short-slug>.png) and put the ` +
      `saved file path(s) in that case's "evidence". For a "fail" whose defect is a multi-step or state/DB-transition issue that a single ` +
      `screenshot cannot convey, ALSO capture a short screen recording (.mp4 or .webm) into that folder and add its path to "evidence" — ` +
      `recordings are attached to the Bug and preview inline in Jira, making the defect self-explanatory to the developer. For every "fail", ` +
      `add a Defect (title, severity, priority, caseTitle, combo, ` +
      `stepsToReproduce, expected, actual, evidence) per docs/ai/bug-reporting.md.\n\n` +
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
      `Do NOT perform destructive/irreversible actions; if a ` +
      `step would, mark the case blocked and note why. Keep going through all cases even if some fail.\n\n` +
      `The full list of test cases to execute (combo "${(isWeb ? 'web' : 'android/ios')} · ${locale}") is in this file — READ it first: ` +
      `"${casesFile.replace(/\\/g, '\\\\')}".`;

    // Card-service web stories: provision a FRESH test customer via API up to the
    // state the flow needs (ready-to-collect), so the agent tests against it
    // instead of whatever stale customer happens to exist. Best-effort teardown after.
    const frameworks = await resolveFrameworks();
    let provisioned: Record<string, unknown> | null = null;
    if (isWeb && needsCardProvisioning(story)) {
      const target = process.env.PROVISION_TARGET || 'ready';
      await ctx.log(`provisioning a fresh card user (target=${target}) via API…`);
      const pout = await runProvisioner([target], (l) => ctx.log(`[provision] ${l.slice(0, 160)}`), frameworks);
      provisioned = parseProvisioned(pout);
      if (provisioned) {
        await ctx.log(`provisioned: mobile ${provisioned.searchMobile} · status ${provisioned.status}` +
          (provisioned.packageNumber ? ` · package ${provisioned.packageNumber}` : ''));
      } else {
        await ctx.log('provisioning did not return an identity — proceeding without a fresh user (cases may block)');
      }
    }

    let toolset: string[];
    let instruction: string;
    if (isWeb) {
      const c = story.credentials ?? undefined;
      const creds = c?.username
        ? `Log in at ${story.appUrl} with username "${c.username}" and password "${c.password ?? ''}".` +
          (c.otpMethod && c.otpMethod !== 'none' ? ` OTP method: ${c.otpMethod} (see CLAUDE.md §7 for how to obtain it).` : '')
        : `Open ${story.appUrl}.`;
      const useUser = provisioned
        ? ` A FRESH test customer has been provisioned via API for THIS run — use ONLY this customer (do not pick any other): ` +
          `search the panel by mobile "${provisioned.searchMobile}" (national id ${provisioned.nationalId}, status ${provisioned.status}). ` +
          (provisioned.packageNumber
            ? `It is KYC-complete with card package "${provisioned.packageNumber}" ready to collect, so the "Card Collected" action should be available; ` +
              `when Popup 2 asks for a package number, use "${provisioned.packageNumber}". `
            : '') +
          `If the expected action/state is still not present for this customer, mark the case blocked and say so precisely.`
        : '';
      toolset = PLAYWRIGHT_TOOLS;
      instruction =
        `Use the Playwright browser tools to drive the live web app. ${creds}${useUser} Use browser_take_screenshot with a filename under the ` +
        `screenshots dir for evidence. ${common}`;
    } else {
      toolset = ['Bash', 'Read', 'Write', 'Glob', 'Grep'];
      const caps =
        `Devices: Android = Samsung Galaxy S23 / Android 13 (UiAutomator2)${bs?.android ? ` app "${bs.android}"` : ' (no app — skip)'}; ` +
        `iOS = iPhone 14 / iOS 18 (XCUITest)${bs?.ios ? ` app "${bs.ios}"` : ' (no app — skip)'}.`;
      instruction =
        `Drive BrowserStack App Automate via the helper at ${companionPath('bs_helper.js')} (functions: bsReq, screenshot, getSource, ` +
        `findElement(s), clickEl, typeText, tap(x,y), getAttr, sleep). Write a Node driver script under "${dir.replace(/\\/g, '\\\\')}\\automation" ` +
        `that: creates a session with the caps below, executes the cases, saves a screenshot per case into the screenshots dir, then run it with Bash ` +
        `("node <script>"). Run Android first, then iOS, for locale ${locale} only (Arabic is a later pass). Handle OTP/passcode/coordinate-tap ` +
        `quirks per CLAUDE.md §7. ${caps} ${common}`;
    }

    await ctx.log(`execution: ${isWeb ? 'web (Playwright)' : 'mobile (bs_helper)'} · ${cases.length} case(s) · ${locale}`);
    try {
      const data = await ai(ctx, {
        ...aiOpts(instruction, ExecutionResults, 'ExecutionResults',
          '{"executed":true,"matrix":["web · en-US"],"summary":{"total":0,"passed":0,"failed":0,"blocked":0,"skipped":0},' +
          '"cases":[{"title":"...","status":"pass|fail|blocked|skipped","combo":"web · en-US","stepsRun":0,"failedStep":"...","expected":"...","actual":"...","evidence":["<path>"],"notes":"..."}],' +
          '"defects":[{"title":"...","severity":"High","priority":"High","caseTitle":"...","combo":"web · en-US","stepsToReproduce":["..."],"expected":"...","actual":"...","evidence":["<path>"]}],"notes":"..."}',
          ctx),
        agentic: true,
        permissionMode: 'default',
        allowedTools: toolset,
        disallowedTools: ['Task'], // no subagents — this is a single flat headless run
        model: MODEL_EXECUTION,
        effort: EFFORT_EXECUTION,
        timeoutMs: 45 * 60 * 1000,
      });
      await ctx.log(`execution done: ${data.summary.passed}P/${data.summary.failed}F/${data.summary.blocked}B/${data.summary.skipped}S of ${data.summary.total}; ${data.defects.length} defect(s)`);
      return data;
    } catch (e) {
      await ctx.log(`execution error: ${(e as Error).message}`);
      return emptyExecution(`execution failed: ${(e as Error).message}`, false);
    } finally {
      // Tear down the provisioned user (best-effort — DB teardown can time out over SSH).
      if (provisioned?.phone) {
        await ctx.log(`tearing down provisioned user ${provisioned.phone} (best-effort)…`);
        const tout = await runProvisioner(['destroy', String(provisioned.phone)], (l) => ctx.log(`[teardown] ${l.slice(0, 160)}`), frameworks);
        if (!/__TEARDOWN__/.test(tout)) await ctx.log('teardown did not confirm — user may persist; clean up later if needed');
      }
    }
  },

  async html_report(ctx) {
    const dir = (ctx.state.workspacePath as string) ?? storyDir(ctx.run.story.jiraKey);
    const file = path.join(dir, 'execution-reports', `test_report_${ctx.run.story.jiraKey}.html`);
    await writeFile(file, renderReport(ctx), 'utf8');
    // Root index README per the folder standard (release-validation.md §6).
    await artifact(ctx, 'README.md',
      `# ${ctx.run.story.jiraKey} — QA Artifacts\n\n${ctx.run.story.title}\n\n` +
      `| Folder | Contents |\n|---|---|\n` +
      `| requirements-analysis/ | STEP 1 requirements |\n| figma-analysis/ | design vs implementation |\n` +
      `| hls/ | High-Level Scenarios (mirror of Jira) |\n| testcases/ | BrowserStack 24-col CSV |\n` +
      `| browserstack/ | import evidence |\n| automation/ | story-specific specs |\n` +
      `| execution-reports/ | test_report_${ctx.run.story.jiraKey}.html |\n| screenshots/ · evidence/ · defects/ | run evidence |\n`);
    await ctx.log(`HTML report + README written`);
    return { reportPath: file };
  },

  async gate_file_bugs(ctx) {
    const defects = ((ctx.state.execution as any)?.defects ?? []) as Array<Record<string, unknown>>;
    if (!defects.length) {
      await artifact(ctx, 'defects/defects.md', `# Defects — ${ctx.run.story.jiraKey}\n\nNo defects found in this run.\n`);
      await ctx.log('no defects to file');
      return { filed: 0 };
    }
    // Always persist the local defect record first (evidence trail).
    await artifact(ctx, 'defects/defects.md',
      `# Defects — ${ctx.run.story.jiraKey}\n\n` +
      defects.map((d, i) =>
        `## ${i + 1}. ${d.title}\n` +
        `- **Severity:** ${d.severity} · **Priority:** ${d.priority} · **Combo:** ${d.combo}\n` +
        `- **Test case:** ${d.caseTitle ?? '—'}\n` +
        `- **Steps to reproduce:**\n${md((d.stepsToReproduce as unknown[]) ?? [])}\n` +
        `- **Expected:** ${d.expected}\n- **Actual:** ${d.actual}\n` +
        `- **Evidence:** ${((d.evidence as string[]) ?? []).join(', ') || '—'}\n`,
      ).join('\n'));

    const decision = await gate(ctx, 'jira.file_bug', `File ${defects.length} defect(s) to Jira (project of ${ctx.run.story.jiraKey})`, defects);
    if (decision.decision !== 'approved') return { filed: 0, decision: decision.decision };

    // Real write via Jira REST (behind this approval gate): one Bug SUB-TASK per
    // defect, summary = actual result, ADF Steps/Actual/Expected/Environment +
    // Components/Platform/Squad, screenshots+videos attached (docs/ai/bug-reporting.md).
    // DRY-RUN by default (safe): builds + saves the payloads without posting until
    // parity is verified — set jira.bugDryRun=false (or JIRA_BUG_DRY_RUN=false) to file live.
    const settings = await getSettings();
    const cfg = resolveBugConfig(settings, ctx.run.story.platform);
    const dryRun = (settings['jira.bugDryRun'] ?? process.env.JIRA_BUG_DRY_RUN ?? 'true').toLowerCase() !== 'false';
    const res = await fileDefects(
      ctx.run.story.jiraKey,
      defects as unknown as DefectInput[],
      ctx.run.story.environment ?? 'testing',
      cfg,
      dryRun,
      (l) => void ctx.log(l),
    );
    if (res.dryRun) {
      await artifact(ctx, 'defects/jira-payloads.json',
        JSON.stringify(res.bugs.map((b) => ({ title: b.defectTitle, attachments: b.attachments, payload: b.payload })), null, 2));
      await ctx.log(
        `DRY-RUN: ${res.bugs.length} Bug sub-task payload(s) prepared & saved (defects/jira-payloads.json) — nothing posted. ` +
          `Set jira.bugDryRun=false in Settings (or JIRA_BUG_DRY_RUN=false) to file for real.`,
      );
      return { filed: 0, dryRun: true, prepared: res.bugs.length };
    }
    const failed = res.bugs.filter((b) => b.error);
    for (const b of failed) await ctx.log(`defect NOT filed ("${b.defectTitle}"): ${b.error}`);
    await ctx.log(`bug filing: ${res.filed}/${defects.length} filed${failed.length ? ` — ${failed.length} kept in defects/defects.md` : ''}`);
    return {
      filed: res.filed,
      issues: res.bugs.filter((b) => b.key).map((b) => b.key).join(', '),
      attachments: res.bugs.reduce((n, b) => n + b.attachments.length, 0),
    };
  },

  async knowledge_update(ctx) {
    const data = await ai(
      ctx,
      aiOpts(
        `Per the documentation governance protocol, propose reusable knowledge to persist from ${ctx.run.story.jiraKey} (new business rule, workflow, automation pattern, BrowserStack convention, regression rule). Only genuinely reusable items; map each to a docs/ai/** path.`,
        KnowledgeUpdate,
        'KnowledgeUpdate',
        '{"proposals":[{"docPath":"docs/ai/...","summary":"...","rationale":"..."}]}',
        ctx,
        MODEL_CHEAP,
      ),
    );
    ctx.state.knowledge = data;
    await ctx.log(`${data.proposals.length} knowledge proposal(s); review in the Knowledge Center`);
    return data;
  },
};

/** Self-contained HTML run report following release-validation.md §2 structure. */
function renderReport(ctx: NodeContext): string {
  const s = ctx.run.story;
  const st = ctx.state as any;
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
  const list = (arr?: unknown[]) => (arr?.length ? `<ul>${arr.map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul>` : '<p class="muted">—</p>');
  const cases: any[] = st.testcases?.cases ?? [];
  const exec = (st.execution ?? {}) as Partial<z.infer<typeof ExecutionResults>>;
  const results: any[] = exec.cases ?? [];
  const defects: any[] = exec.defects ?? [];
  const sum = exec.summary ?? { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 };
  const executed = !!exec.executed && results.length > 0;

  // Map a result back to its test case by title (best-effort) for the table.
  const byTitle = new Map(results.map((r) => [r.title, r]));
  const statusBadge = (status?: string) => {
    const m: Record<string, [string, string]> = {
      pass: ['pass', 'PASS'], fail: ['fail', 'FAIL'], blocked: ['note', 'BLOCKED'], skipped: ['no', 'SKIPPED'],
    };
    const [cls, txt] = m[status ?? ''] ?? ['no', executed ? 'NO RESULT' : 'NOT EXECUTED'];
    return `<span class="badge ${cls}">${txt}</span>`;
  };
  const fileLink = (paths?: string[]) =>
    paths?.length
      ? paths.map((p) => `<a href="file:///${esc(p).replace(/\\/g, '/')}">shot</a>`).join(' ')
      : '<span class="muted">—</span>';

  const caseRows = cases.map((c, i) => {
    const r = byTitle.get(c.title);
    return `<tr><td>${i + 1}</td><td>${esc(c.title)}</td><td>${esc(c.type)}</td>
    <td>${esc(c.priority)}</td><td>${c.steps?.length ?? 0}</td>
    <td>${statusBadge(r?.status)}</td><td>${fileLink(r?.evidence)}</td>
    <td>${esc(r?.actual ?? '')}</td></tr>`;
  }).join('');

  const defectRows = defects.length
    ? defects.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.title)}</td><td><span class="badge fail">${esc(d.severity)}</span></td>
      <td>${esc(d.priority)}</td><td>${esc(d.caseTitle ?? '')}</td><td>${esc(d.expected)}</td><td>${esc(d.actual)}</td></tr>`).join('')
    : '<tr><td colspan="7" class="muted">No defects recorded.</td></tr>';

  // ── Visual Testing: embed Actual screenshots + matched Figma Expected frames ──
  const dir = (ctx.state.workspacePath as string) ?? storyDir(s.jiraKey);
  const figmaDir = path.join(dir, 'figma-analysis');
  const embedImg = (abs?: string): string | null => {
    try {
      if (!abs || !existsSync(abs)) return null;
      const buf = readFileSync(abs);
      if (buf.length > 6_000_000) return null; // skip oversized to keep the HTML manageable
      const ext = abs.toLowerCase().endsWith('.jpg') || abs.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
      return `data:image/${ext};base64,${buf.toString('base64')}`;
    } catch { return null; }
  };
  // Figma Expected frames available in the workspace (exclude board banners).
  const figmaFrames: string[] = (() => {
    try {
      return readdirSync(figmaDir)
        .filter((f) => /\.(png|jpe?g)$/i.test(f) && !/^(header|section)/i.test(f))
        .map((f) => path.join(figmaDir, f));
    } catch { return []; }
  })();
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  // Best-effort Expected match: score each Figma frame by shared keywords with the
  // case title + evidence filenames; require a minimum overlap to avoid false pairs.
  const matchExpected = (title: string, evidence?: string[]): string | null => {
    const hay = norm(`${title} ${(evidence ?? []).map((e) => e.split(/[\\/]/).pop() ?? '').join(' ')}`);
    const words = new Set(hay.split(' ').filter((w) => w.length > 3 && !['with','from','that','when','both','test','case','then','popup','page'].includes(w)));
    let best: string | null = null, bestScore = 0;
    for (const f of figmaFrames) {
      const fn = new Set(norm(path.basename(f, path.extname(f))).split(' ').filter((w) => w.length > 2));
      let score = 0;
      for (const w of words) if (fn.has(w) || [...fn].some((x) => w.includes(x) || x.includes(w))) score++;
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return bestScore >= 1 ? best : null;
  };
  const verdictOf = (r: any): { label: string; cls: string } => {
    const txt = `${r?.notes ?? ''} ${r?.actual ?? ''}`.toLowerCase();
    if (/major/.test(txt) || r?.status === 'fail') return { label: 'MAJOR', cls: 'fail' };
    if (/minor/.test(txt)) return { label: 'MINOR', cls: 'note' };
    if (r?.status === 'pass') return { label: 'PASS', cls: 'pass' };
    if (r?.status === 'blocked') return { label: 'BLOCKED', cls: 'noref' };
    return { label: '—', cls: 'no' };
  };
  const visualResults = results.filter((r) => (r.evidence?.length ?? 0) > 0);
  const visualBlocks = visualResults.map((r) => {
    const actual = embedImg(r.evidence?.[0]);
    const expPath = matchExpected(r.title, r.evidence);
    const expected = embedImg(expPath ?? undefined);
    const v = verdictOf(r);
    const pane = (label: string, uri: string | null, sub: string) =>
      `<div class="vpane"><div class="vlabel">${label}</div>` +
      (uri ? `<img src="${uri}" alt="${label}"/>` : `<div class="vnone">${sub}</div>`) + `</div>`;
    return `<div class="vcard"><div class="vhead">${esc(r.title)} <span class="badge ${v.cls}">${v.label}</span></div>
      <div class="vrow">${pane('Expected (Figma)', expected, expPath ? '' : 'no Figma baseline for this state')}${pane('Actual (build)', actual, 'no screenshot')}</div>
      <div class="vdiff"><b>Observed:</b> ${esc(r.actual ?? '')}${r.notes ? `<br><b>Verdict:</b> ${esc(r.notes)}` : ''}</div></div>`;
  }).join('');
  const visualMatrixRows = visualResults.map((r, i) => {
    const v = verdictOf(r);
    return `<tr><td>${i + 1}</td><td>${esc(r.title)}</td><td><span class="badge ${v.cls}">${v.label}</span></td><td>${r.evidence?.length ?? 0} shot(s)</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No visual evidence captured.</td></tr>';
  const visualSection = executed
    ? `<h2>Visual Testing — coverage matrix</h2>
       <table><tr><th>#</th><th>Screen / state</th><th>Visual verdict</th><th>Evidence</th></tr>${visualMatrixRows}</table>
       <h2>Visual Testing — Expected (Figma) vs Actual</h2>
       ${visualBlocks || '<p class="muted">No screenshots were captured for visual comparison.</p>'}`
    : '';

  const combos: string[] = exec.matrix?.length ? exec.matrix : (s.platform === 'web' ? ['web · (not run)'] : ['mobile · (not run)']);
  const comboPass = (combo: string) => {
    const inCombo = results.filter((r) => r.combo === combo);
    if (!inCombo.length) return executed ? '<span class="badge no">NO CASES</span>' : '<span class="badge pend">NOT RUN</span>';
    const p = inCombo.filter((r) => r.status === 'pass').length;
    const f = inCombo.filter((r) => r.status === 'fail').length;
    const cls = f ? 'fail' : 'pass';
    return `<span class="badge ${cls}">${p}P / ${f}F / ${inCombo.length}</span>`;
  };
  const matrix = `<table><tr><th>Combo (platform · locale)</th><th>Result</th></tr>` +
    combos.map((cb) => `<tr><td><b>${esc(cb)}</b></td><td>${comboPass(cb)}</td></tr>`).join('') + '</table>';

  return `<!doctype html><html><head><meta charset="utf-8"><title>QA Report ${esc(s.jiraKey)}</title>
<style>body{font-family:Segoe UI,system-ui,sans-serif;color:#3D4A5C;max-width:1000px;margin:24px auto;padding:0 16px}
h1{color:#0F1B2D}h2{color:#0E6E8C;border-bottom:1px solid #E2E8F0;padding-bottom:4px;margin-top:28px}
.muted{color:#6B7787}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:14px 0}
.card{border:1px solid #E2E8F0;border-radius:10px;padding:12px}.card .n{font-size:1.6rem;font-weight:700;color:#0E6E8C}
.card .n.bad{color:#721c24}.card .n.good{color:#155724}
table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border-bottom:1px solid #E2E8F0;text-align:left;padding:6px 8px;font-size:.88rem;vertical-align:top}
.badge{font-size:.72rem;padding:2px 7px;border-radius:999px;border:1px solid;white-space:nowrap}
.pass{background:#d4edda;color:#155724;border-color:#c3e6cb}.fail{background:#f8d7da;color:#721c24;border-color:#f5c6cb}
.note{background:#fff3cd;color:#856404;border-color:#ffeeba}.noref{background:#e2e3e5;color:#383d41;border-color:#d6d8db}
.no{background:#e2e3e5;color:#383d41;border-color:#d6d8db}.pend{background:#fff3cd;color:#856404;border-color:#ffeeba}
.vcard{border:1px solid #E2E8F0;border-radius:10px;padding:12px;margin:14px 0}
.vhead{font-weight:600;color:#0F1B2D;margin-bottom:8px}
.vrow{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.vpane{border:1px solid #EEF2F6;border-radius:8px;padding:8px;background:#FAFBFC}
.vlabel{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:#6B7787;margin-bottom:6px}
.vpane img{width:100%;height:auto;border-radius:4px;border:1px solid #E2E8F0}
.vnone{color:#856404;background:#fff3cd;border:1px dashed #ffeeba;border-radius:4px;padding:18px;text-align:center;font-size:.82rem}
.vdiff{margin-top:8px;font-size:.85rem;color:#3D4A5C}</style></head>
<body><h1>QA Report — ${esc(s.jiraKey)}</h1>
<p class="muted">${esc(s.title)} · ${esc(s.platform)} · ${esc(s.environment ?? 'testing')} · ${executed ? esc((exec.matrix ?? []).join(', ')) : 'execution pending'}</p>
<div class="grid">
<div class="card"><div class="n">${cases.length}</div>Test cases</div>
<div class="card"><div class="n">${st.hls?.scenarios?.length ?? 0}</div>HLS scenarios</div>
<div class="card"><div class="n good">${sum.passed ?? 0}</div>Passed</div>
<div class="card"><div class="n bad">${sum.failed ?? 0}</div>Failed</div>
<div class="card"><div class="n">${sum.blocked ?? 0}</div>Blocked</div>
<div class="card"><div class="n bad">${defects.length}</div>Defects</div>
</div>
<h2>Coverage matrix (platform · language)</h2>${matrix}
${executed ? '' : '<p class="muted">Execution has not produced results for this run yet.</p>'}
${visualSection}
<h2>Business objective</h2><p>${esc(st.requirements?.businessObjective)}</p>
<h2>Impact analysis</h2><b>Impacted areas</b>${list(st.impact?.impactedAreas)}<b>Regression areas</b>${list(st.impact?.regressionAreas)}<b>Smoke coverage</b>${list(st.impact?.smokeCoverage)}
<h2>Test cases &amp; results (${cases.length})</h2>
<table><tr><th>#</th><th>Title</th><th>Type</th><th>Priority</th><th>Steps</th><th>Status</th><th>Evidence</th><th>Actual</th></tr>${caseRows}</table>
<h2>Defects (${defects.length})</h2>
<table><tr><th>#</th><th>Title</th><th>Severity</th><th>Priority</th><th>Test case</th><th>Expected</th><th>Actual</th></tr>${defectRows}</table>
<h2>Exploratory risk areas</h2>${list(st.exploratory?.riskAreas)}
<p class="muted">Generated by the Breadfast QA Platform · badges per release-validation.md §2.</p></body></html>`;
}

// ── helpers ────────────────────────────────────────────────────────────────
async function emit(event: RunEvent) {
  await ingest(event);
}

/**
 * M1b review checkpoint — a human-review gate with NO external write. Default
 * ON; a tester/lead can disable a specific stage via Settings
 * (e.g. `gates.review.requirements` = "off"), in which case it auto-passes.
 */
async function reviewGate(
  ctx: NodeContext,
  action: GatedAction,
  summary: string,
  payloadPreview: unknown,
): Promise<{ decision: string | null; feedback: string | null }> {
  // A decision already in (resume) shortcuts straight through gate().
  if (!ctx.step.approval?.decision) {
    const s = await getSettings();
    if ((s[`gates.${action}`] ?? 'on').toLowerCase() === 'off') {
      await ctx.log(`${action} review gate disabled in Settings — auto-pass`);
      return { decision: 'approved', feedback: null };
    }
  }
  return gate(ctx, action, summary, payloadPreview);
}

async function gate(
  ctx: NodeContext,
  action: GatedAction,
  summary: string,
  payloadPreview: unknown,
): Promise<{ decision: string | null; feedback: string | null }> {
  // Resume: a decision is in → return it so the node proceeds.
  const decision = ctx.step.approval?.decision;
  if (decision) return { decision, feedback: ctx.step.approval?.feedback ?? null };
  // Otherwise request approval and pause the run (no in-process blocking).
  await emit(makeEvent<Extract<RunEvent, { kind: 'gate.awaiting' }>>({
    kind: 'gate.awaiting',
    runId: ctx.run.id,
    stepId: ctx.step.id,
    action,
    summary,
    payloadPreview,
  }));
  await ctx.log(`awaiting approval: ${summary}`);
  throw new PausedForInput();
}

/**
 * Resolve credentials a node needs, prompting the tester mid-run for any that
 * aren't configured. Resolution order per key: values the tester just supplied
 * (this run) → saved Settings → caller-provided env fallback. If anything is
 * still missing, emits `credential.awaiting` (the run page shows a Use Once /
 * Save to My Settings / Cancel Run prompt) and pauses. On resume the submitted
 * values are read back here and the node proceeds. Returns key→value for all.
 */
async function requireCredential(
  ctx: NodeContext,
  specs: CredentialSpec[],
  reason: string,
  envFallback: Record<string, string | undefined> = {},
): Promise<Record<string, string>> {
  const settings = await getSettings();
  const submitted = (ctx.step.clarification?.answersJson ?? null) as
    | { decision?: string; values?: Array<{ key: string; value: string }> }
    | null;
  // A cancel decision cancels the run API-side, so the worker never resumes;
  // guard defensively so a stray resume doesn't proceed with missing creds.
  if (submitted?.decision === 'cancel') throw new PausedForInput();

  const provided: Record<string, string> = {};
  for (const v of submitted?.values ?? []) if (v.value) provided[v.key] = v.value;

  const result: Record<string, string> = {};
  const missing: CredentialSpec[] = [];
  for (const spec of specs) {
    const val = provided[spec.key] || settings[spec.key] || envFallback[spec.key] || '';
    if (val) result[spec.key] = val;
    else missing.push(spec);
  }
  if (!missing.length) return result;

  await emit(makeEvent<Extract<RunEvent, { kind: 'credential.awaiting' }>>({
    kind: 'credential.awaiting',
    runId: ctx.run.id,
    stepId: ctx.step.id,
    reason,
    credentials: missing,
  }));
  await ctx.log(`awaiting ${missing.length} credential(s): ${missing.map((m) => m.key).join(', ')}`);
  throw new PausedForInput();
}

function csvCell(v: string): string {
  return `"${(v ?? '').replace(/"/g, '""')}"`;
}

/** Path to the reusable BrowserStack importer (override via BS_IMPORTER_PATH). */
const BS_IMPORTER = process.env.BS_IMPORTER_PATH || companionPath('automation', 'import_browserstack_csv.js');

/** Run the importer CLI; resolves with combined stdout+stderr (never rejects). */
function runImporter(
  csv: string,
  project: string,
  folder: string,
  env: Record<string, string>,
  log: (l: string) => void,
): Promise<string> {
  return new Promise((resolve) => {
    const args = [BS_IMPORTER, '--file', csv, '--project', project];
    if (folder) args.push('--folder', folder);
    const child = spawn('node', args, {
      cwd: path.dirname(BS_IMPORTER),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { const s = d.toString(); out += s; for (const l of s.split('\n')) if (l.trim()) log(l.trim()); });
    child.stderr.on('data', (d) => { const s = d.toString(); out += s; });
    child.on('error', (e) => resolve(`spawn error: ${e.message}`));
    child.on('close', () => resolve(out));
  });
}

/** Card-user provisioner script + the runnable workspace whose node_modules it borrows. */
const PROVISIONER = process.env.PROVISIONER_PATH || companionPath('automation', 'provision_for_execution.js');

/** Framework paths: Framework Registry (via API) first, then env fallback. */
async function resolveFrameworks(): Promise<{ playwright?: string; javaAppium?: string }> {
  const r = await getResolvedFrameworks();
  return {
    playwright: r.playwright ?? playwrightFrameworkDir(),
    javaAppium: r.javaAppium ?? javaFrameworkDir(),
  };
}

/** Spawn the provisioner; resolves combined stdout/stderr (never rejects). */
function runProvisioner(
  args: string[],
  log: (l: string) => void,
  fw: { playwright?: string; javaAppium?: string } = {},
): Promise<string> {
  const pwDir = fw.playwright ?? playwrightFrameworkDir();
  const javaDir = fw.javaAppium ?? javaFrameworkDir();
  return new Promise((resolve) => {
    // Borrow the Playwright framework's node_modules (mysql2/ssh2/properties-reader),
    // and point the card-config scripts at the registered Java framework
    // (BF_JAVA_FRAMEWORK_DIR) — cross-platform, no hardcoded D:\ path.
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (pwDir) env.NODE_PATH = path.join(pwDir, 'node_modules');
    if (javaDir) env.BF_JAVA_FRAMEWORK_DIR = javaDir;
    const child = spawn('node', [PROVISIONER, ...args], {
      cwd: pwDir ?? companionDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { const s = d.toString(); out += s; for (const l of s.split('\n')) if (l.trim()) log(l.trim()); });
    child.stderr.on('data', (d) => { const s = d.toString(); out += s; for (const l of s.split('\n')) if (l.trim()) log(l.trim()); });
    child.on('error', (e) => resolve(`spawn error: ${e.message}`));
    child.on('close', () => resolve(out));
  });
}

/** True when a story should auto-provision a fresh card user (card-service web). */
function needsCardProvisioning(story: { platform: string; appUrl?: string | null }): boolean {
  return story.platform === 'web' && /card-panel/i.test(story.appUrl ?? '');
}

/** Parse the `__PROVISIONED__{json}` line the provisioner prints; null if absent. */
function parseProvisioned(out: string): Record<string, unknown> | null {
  const m = out.match(/__PROVISIONED__(\{.*\})/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Write a file under the story's workspace folder, creating parent dirs. */
async function artifact(ctx: NodeContext, rel: string, content: string): Promise<string> {
  const dir = (ctx.state.workspacePath as string) ?? storyDir(ctx.run.story.jiraKey);
  const file = path.join(dir, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
  return file;
}

const md = (arr?: unknown[]) => (arr?.length ? arr.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : '- (none)');

/** Render the Figma analysis (+ export manifest) to figma-analysis/figma-analysis.md. */
function renderFigmaMd(
  jiraKey: string,
  data: z.infer<typeof FigmaAnalysis>,
  exp: FigmaExportResult,
  exportMethod = 'rest-api',
): string {
  const frameLines = exp.frames.length
    ? exp.frames
        .map((f) =>
          `- ${f.name}${f.file ? ` → ${path.basename(f.file)}` : ' (render failed)'}` +
          (f.id !== 'batch' ? ` [${f.id}]` : ''),
        )
        .join('\n')
    : '- (none exported)';
  return (
    `# Figma Analysis — ${jiraKey}\n\n` +
    `Analyzed: ${data.analyzed} · File key: ${data.fileKey ?? '—'} · Export method: ${exportMethod}` +
    `${exp.error ? ` · export note: ${exp.error}` : ''}\n\n` +
    `## Exported frames\n${frameLines}\n\n` +
    `## Screens\n${md(data.screens.map((s) => `${s.name}: ${s.summary}`))}\n\n` +
    `## States depicted\n${md(data.states)}\n\n## Validations\n${md(data.validations)}\n\n` +
    `## Gaps vs spec\n${md(data.gaps)}\n\n## Missing states\n${md(data.missingStates)}\n\n` +
    `## Localization (en-US + ar-EG)\n${md(data.localizationNotes)}\n\n## UX findings\n${md(data.uxFindings)}\n\n` +
    `## Notes\n${data.notes || '—'}\n`
  );
}

/** A blank ExecutionResults (when there is nothing to run, or the run errored). */
function emptyExecution(note: string, executed = false): z.infer<typeof ExecutionResults> {
  return { executed, matrix: [], summary: { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 }, cases: [], defects: [], notes: note };
}

/** Compact, prompt-friendly rendering of the test cases for the execution agent. */
function renderCaseList(cases: TestCases['cases']): string {
  return cases
    .map((c, i) =>
      `${i + 1}. [${c.priority}/${c.type}] ${c.title}\n` +
      `   preconditions: ${c.preconditions || '—'}\n` +
      c.steps.map((s, j) => `   step ${j + 1}: ${s.action}  =>  EXPECT: ${s.expectedResult}`).join('\n'),
    )
    .join('\n\n');
}

/**
 * Canonical 24-column BrowserStack Test Management import CSV
 * (browserstack-process.md §10.1–10.6). First row carries case metadata +
 * step 1; each continuation row is blank except Steps + Expected Result.
 */
const BS_COLUMNS = [
  'Test Case ID', 'Title', 'Folder ID', 'Folder Path', 'State', 'Owner', 'Priority',
  'Type of Test Case', 'Automation Status', 'Description', 'Preconditions', 'Template',
  'Steps', 'Expected Result', 'Issues', 'Tags', 'Status (latest)', 'Attachments',
  'Created At', 'Created By', 'Last Updated At', 'Last Updated By', 'Project Name', 'Test Case URL',
];

function toBrowserstackCsv(tc: TestCases | undefined, story: { jiraKey: string; bsFolderId?: string | null }): string {
  const rows: string[] = [BS_COLUMNS.map(csvCell).join(',')];
  const folderId = story.bsFolderId ?? '';
  for (const c of tc?.cases ?? []) {
    c.steps.forEach((s, i) => {
      const first = i === 0;
      const row = [
        '', // Test Case ID (assigned on import)
        first ? c.title : '',
        first ? folderId : '',
        '', // Folder Path
        first ? 'Active' : '',
        first ? 'Fintech' : '',
        first ? c.priority : '',
        first ? c.type : '',
        first ? c.automationStatus : '',
        first ? (c.description || c.title) : '',
        first ? c.preconditions : '',
        first ? 'Steps' : '',
        s.action,
        s.expectedResult,
        first ? story.jiraKey : '', // Issues
        first ? 'ai-created' : '', // Tags
        '', '', '', '', '', '', // Status, Attachments, Created/Updated system cols (blank for import)
        first ? 'BCard Squad' : '', // Project Name
        '', // Test Case URL
      ];
      rows.push(row.map(csvCell).join(','));
    });
  }
  return rows.join('\r\n');
}
