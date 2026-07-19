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
  getPrompt,
  promptRegistry,
  computeParityCertification,
  computeReviewConfidence,
  computeStoryHealth,
  computeRecommendations,
  buildActivityTimeline,
  lintKnowledgeProposals,
  type KnowledgeCorpusEntry,
  computeVisualHealth,
  detectVisualPatterns,
  VisualScreenComparison,
  NODE_STATE_KEY,
  redactSecrets,
  EXPLORATORY_PROBE_HINT,
  resolveCitations,
  type CitationContext,
  type VisualComparison,
  type RunEvent,
  type GatedAction,
  type CredentialSpec,
} from '@qa/shared';
import {
  companionDir, companionPath, storyDir, figmaAuthPath,
  playwrightFrameworkDir, javaFrameworkDir,
} from '@qa/shared/paths';
import {
  ingest,
  getSettings,
  getResolvedFrameworks,
  logLlmRequest,
  getRunDetail,
  nextArtifactVersion,
  recordArtifact,
  type RunDetail,
  type StepDetail,
} from './api-client.js';
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

/** Run an AI task, accumulate cost/tokens, and capture the LLM Request Log (#7). */
async function ai<S extends z.ZodTypeAny>(ctx: NodeContext, opts: AiTaskOptions<S>): Promise<z.infer<S>> {
  const { data, raw, meta } = await runAiTask({ ...opts, signal: ctx.signal });
  ctx.meta.costUsd += raw.costUsd;
  ctx.meta.tokens += raw.outputTokens;
  // Fire-and-forget audit capture — the durable record behind Story Replay +
  // AI Explainability, and the source of exact per-call token/cost.
  void logLlmRequest({
    runId: ctx.run.id,
    runStepId: ctx.step.id,
    node: ctx.step.name,
    schemaName: opts.schemaName,
    model: opts.model,
    promptVersion: promptRegistry[ctx.step.name as keyof typeof promptRegistry]?.version,
    workflowVersion: (ctx.run as { workflowVersion?: string }).workflowVersion,
    systemPrompt: redactSecrets(opts.instruction),
    userPrompt: redactSecrets(opts.context),
    rawResponse: raw.text?.slice(0, 20000),
    validatedOutput: data,
    status: meta.repaired ? 'repaired' : 'ok',
    repaired: meta.repaired,
    repairStage: meta.repairStage,
    tokens: raw.outputTokens,
    costUsd: raw.costUsd,
    durationMs: raw.durationMs,
    attempt: meta.attempts,
  });
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
 * aiOpts sourced from the Prompt Registry (Phase 1 #2). The instruction,
 * schemaName, and schemaHint all come from the versioned prompt definition, so
 * prompts evolve in @qa/shared without editing workflow logic here.
 */
const aiOptsP = <S extends z.ZodTypeAny, V>(
  prompt: { build: (v: V) => string; schemaName: string; schemaHint: string },
  vars: V,
  schema: S,
  ctx: NodeContext,
  model: string = MODEL,
) => aiOpts(prompt.build(vars), schema, prompt.schemaName, prompt.schemaHint, ctx, model);

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
        `GOAL: export EVERY frame of the section/page the URL points to — one PNG per frame — ` +
        `NOT just the handful that happen to carry an export preset. The node-id in the URL usually ` +
        `points at a SECTION (e.g. "Phase 1") that contains many frames (often dozens).\n\n` +
        `Steps:\n` +
        figmaAuthRestoreStep() +
        `1. browser_navigate → ${urls[0]}\n` +
        `2. browser_wait_for → Figma canvas loads (title contains em-dash "–"). The node-id selects the section.\n` +
        `3. SELECT ALL FRAMES IN THE SECTION — this is the critical step, and it must be VERIFIED, not assumed. ` +
        `Selecting only the section node (or a single frame) exports a tiny subset (we have seen 1 and 11). This ` +
        `section holds dozens of frames (expect ~60-75). Try the tactics below IN ORDER, and after EACH one take a ` +
        `browser_take_screenshot AND read Figma's live selection count (top toolbar shows "N selected"; the right ` +
        `properties panel header shows the count). Only stop once the count is in the dozens (≥ ~50). If a tactic ` +
        `yields 1 or a handful, it FAILED — press "Escape" and move to the next tactic:\n` +
        `   TACTIC A (page-level select-all): press "Escape" to deselect, click once on an EMPTY canvas area to ` +
        `focus the canvas, then press "Control+a". If the frames are top-level this selects them all.\n` +
        `   TACTIC B (enter section, then select-all): double-click the "Phase 1" section body (or select it and ` +
        `press "Enter") to enter it so the selection context is INSIDE the section, then press "Control+a" to ` +
        `select all its child frames. Verify focus is on the canvas (not a panel/text field) before Control+a.\n` +
        `   TACTIC C (marquee / rubber-band): press "Shift+1" (Zoom to fit) so every frame is visible, press ` +
        `"Escape", then browser_run_code_unsafe to drag-select across the whole canvas — e.g.\n` +
        `     const b = await page.viewportSize();\n` +
        `     await page.mouse.move(80, 160); await page.mouse.down();\n` +
        `     await page.mouse.move(b.width-40, b.height-40, {steps:20}); await page.mouse.up();\n` +
        `   (start the drag on empty canvas, NOT on a frame, so it rubber-bands instead of moving a frame).\n` +
        `   Do NOT proceed to export until a screenshot + the selection count confirm the full set is selected.\n` +
        `4. FORCE AN EXPORT PRESET ON THE WHOLE SELECTION so frames without their own export setting are still ` +
        `included: in the right panel's Export section click "+" to add a preset (PNG, 2x). With all frames ` +
        `selected this applies to every one. (If the frames already export fine this is harmless.)\n` +
        `5. browser_run_code_unsafe → intercept the download BEFORE triggering the export:\n` +
        `   const downloadPromise = page.waitForEvent('download', {timeout:120000});\n` +
        `6. browser_press_key → "Control+Shift+E" to open the batch export dialog.\n` +
        `7. Verify the dialog header shows the FULL count ("Export N layers" / "N of N selected") — N must match ` +
        `the number of frames from step 3, not a small subset. If N is small, close the dialog and redo step 3.\n` +
        `8. browser_click → Export button (try: getByLabel('Export').getByRole('button',{name:'Export'})).\n` +
        `9. browser_run_code_unsafe → await the download and save the ZIP to outDir:\n` +
        `   const dl = await downloadPromise;\n` +
        `   const zipPath = require('path').join(${JSON.stringify(outDir)}, 'figma_export.zip');\n` +
        `   await dl.saveAs(zipPath);\n` +
        `10. Bash → extract the ZIP with this exact command (already selected for the current OS): ${extractCmd}\n` +
        `11. Bash → list extracted PNGs and return the manifest. Sanity-check the count reflects all frames; ` +
        `if only a few PNGs came out, the selection was incomplete — go back to step 3.\n\n` +
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
      timeoutMs: 12 * 60 * 1000,
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
      aiOptsP(
        getPrompt('parse_instructions'),
        { jiraKey: ctx.run.story.jiraKey, instructions: instr },
        Directives, ctx, MODEL_CHEAP,
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
      aiOptsP(
        getPrompt('detect_prerequisites'),
        { jiraKey: ctx.run.story.jiraKey },
        PrerequisiteCheck, ctx, MODEL_CHEAP,
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
    const plan = ctx.state.automationPlan as
      | { specs?: unknown[]; specsWritten?: number; specFiles?: string[]; blocked?: boolean; agentReply?: string }
      | undefined;
    const planned = plan?.specs?.length ?? 0;
    const written = plan?.specsWritten ?? 0;
    const summary = plan?.blocked
      ? `⚠ Automation BLOCKED for ${ctx.run.story.jiraKey}: 0 of ${planned} planned spec(s) were written. ` +
        `Reason: ${plan?.agentReply?.slice(0, 200) || 'spec-writing produced no files'}. ` +
        `Approve to proceed WITHOUT automation (deferred), or reject to stop and resolve the blocker.`
      : `Review automation for ${ctx.run.story.jiraKey}: ${written} of ${planned} spec(s) written` +
        (plan?.specFiles?.length ? ` (${plan.specFiles.join(', ')})` : '');
    const d = await reviewGate(ctx, 'review.automation', summary, plan);
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
    const exec = ctx.state.execution as
      | { summary?: Record<string, number>; executed?: boolean; blocked?: boolean; notRun?: number; notes?: string }
      | undefined;
    // Execution did not actually run (agent error / env outage / no valid JSON):
    // lead the gate summary with a warning so it can't be rubber-stamped as a pass.
    const didNotRun = exec ? exec.executed === false || exec.blocked === true : false;
    const warn = didNotRun
      ? `⚠ EXECUTION DID NOT RUN — 0 of ${exec?.notRun ?? exec?.summary?.total ?? '?'} case(s) executed` +
        `${exec?.notes ? ` (${exec.notes})` : ''}. Nothing was actually tested; do NOT approve as a pass — ` +
        `re-run once the blocker clears. `
      : '';
    const d = await reviewGate(ctx, 'review.report',
      `${warn}Review the HTML report for ${ctx.run.story.jiraKey} before filing defects`,
      { reportPath: ctx.state.reportPath, executed: exec?.executed !== false && !exec?.blocked, summary: exec?.summary });
    return { reviewed: d.decision === 'approved', decision: d.decision, executionRan: !didNotRun };
  },

  async requirements_analysis(ctx) {
    const data = await ai(
      ctx,
      aiOptsP(
        getPrompt('requirements_analysis'),
        { jiraKey: ctx.run.story.jiraKey, title: ctx.run.story.title },
        RequirementsAnalysis, ctx,
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
      aiOptsP(
        getPrompt('acceptance_criteria'),
        { jiraKey: ctx.run.story.jiraKey },
        AcceptanceCriteria, ctx, MODEL_CHEAP,
      ),
    );
    ctx.state.acceptanceCriteria = data;
    return data;
  },

  async comments_analysis(ctx) {
    const data = await ai(
      ctx,
      aiOptsP(
        getPrompt('comments_analysis'),
        { jiraKey: ctx.run.story.jiraKey },
        CommentsAnalysis, ctx, MODEL_CHEAP,
      ),
    );
    ctx.state.comments = data;
    return data;
  },

  async linked_stories(ctx) {
    const data = await ai(
      ctx,
      aiOptsP(
        getPrompt('linked_stories'),
        { jiraKey: ctx.run.story.jiraKey },
        LinkedStories, ctx, MODEL_CHEAP,
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

    let data;
    if (frameFiles.length) {
      data = await ai(ctx, {
        ...aiOptsP(
          getPrompt('figma_analysis'),
          { jiraKey: ctx.run.story.jiraKey, mode: 'frames', exportMethod, frameFiles },
          FigmaAnalysis, ctx,
        ),
        agentic: true,
        permissionMode: 'default',
        allowedTools: ['Read'],
        // CERTIFICATION DECISION (2026-07-16): analyze ALL exported frames to
        // maximize Platform Parity. A single Figma board node can fan out to
        // 60+ frames (B10-56759: one node → 60+ PNGs), and an agentic Read loop
        // over that many images blew the old 8-min cap (run cmrn79iss timed out
        // at 480000ms → uncaught → step failed). Raised to 25 min to comfortably
        // cover large boards. Future: intelligent frame selection / batched
        // analysis (see docs/certification). Do not lower without that in place.
        timeoutMs: 25 * 60 * 1000,
      });
    } else {
      const why = urls.length
        ? `all export methods failed (${exported.error ?? 'unknown'})`
        : 'no Figma URL in the ticket';
      await ctx.log(`figma_analysis: ${why} — analyzing design expectations from the spec only`);
      data = await ai(
        ctx,
        aiOptsP(
          getPrompt('figma_analysis'),
          { jiraKey: ctx.run.story.jiraKey, mode: 'spec', why },
          FigmaAnalysis, ctx, MODEL_CHEAP,
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
      aiOptsP(
        getPrompt('clarification'),
        { jiraKey: ctx.run.story.jiraKey },
        ClarificationQuestions, ctx,
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
      aiOptsP(
        getPrompt('impact_analysis'),
        { jiraKey: ctx.run.story.jiraKey },
        ImpactAnalysis, ctx,
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
      aiOptsP(
        getPrompt('generate_hls'),
        { jiraKey: ctx.run.story.jiraKey, maxHls },
        Hls, ctx,
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
      aiOptsP(
        getPrompt('generate_testcases'),
        { jiraKey: ctx.run.story.jiraKey },
        TestCases, ctx,
      ),
    );
    ctx.state.testcases = data;
    return data;
  },

  async generate_csv(ctx) {
    const tc = ctx.state.testcases as TestCases | undefined;
    const csv = toBrowserstackCsv(tc, ctx.run.story);
    const file = await artifact(ctx, `testcases/${ctx.run.story.jiraKey}_browserstack_testcases.csv`, csv);
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
      aiOptsP(
        getPrompt('exploratory_testing'),
        { jiraKey: ctx.run.story.jiraKey, platform: ctx.run.story.platform },
        ExploratoryNotes, ctx, MODEL_CHEAP,
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
          getPrompt('exploratory_testing').build({
            jiraKey: story.jiraKey,
            mode: 'probe',
            title: story.title,
            creds,
            charterList,
            riskAreas: plan.riskAreas.join('; ') || '(none flagged)',
            fragileFlows: plan.fragileFlows.join('; ') || '(none flagged)',
            shotsDir,
          }),
          ExploratoryNotes,
          'ExploratoryNotes',
          EXPLORATORY_PROBE_HINT,
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
      aiOptsP(
        getPrompt('automation_generation'),
        { jiraKey: ctx.run.story.jiraKey, platform: ctx.run.story.platform, sharedPagesDir, javaFramework },
        AutomationPlan, ctx,
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

    let agentReply = '';
    // Spec-writing prompt sourced from the Prompt Registry (#2 completion).
    const writePrompt = getPrompt('automation_generation').build({
      jiraKey: ctx.run.story.jiraKey,
      title: ctx.run.story.title,
      platform,
      sharedPagesDir,
      javaFramework,
      pwFramework,
      mode: 'write',
      planJson: JSON.stringify(data, null, 2),
      dir,
      automationDir,
      isWeb,
    });
    try {
      const res = await runClaude({
        prompt: writePrompt,
        cwd: COMPANION_DIR,
        model: MODEL,
        permissionMode: 'default',
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        timeoutMs: 15 * 60 * 1000,
        onLog: (l) => void ctx.log(l),
        signal: ctx.signal,
      });
      agentReply = (res?.text ?? '').trim();
      ctx.meta.costUsd += res?.costUsd ?? 0;
      ctx.meta.tokens += res?.outputTokens ?? 0;
      // Record this direct runClaude interaction in the LLM Request Log (#7) so
      // EVERY AI interaction — not just ai()-schema calls — carries a prompt version.
      void logLlmRequest({
        runId: ctx.run.id,
        runStepId: ctx.step.id,
        node: ctx.step.name,
        schemaName: 'automation-spec-write',
        model: MODEL,
        promptVersion: getPrompt('automation_generation').version,
        workflowVersion: (ctx.run as { workflowVersion?: string }).workflowVersion,
        systemPrompt: redactSecrets(writePrompt),
        userPrompt: undefined,
        rawResponse: agentReply.slice(0, 20000),
        status: 'ok',
        tokens: res?.outputTokens ?? 0,
        costUsd: res?.costUsd ?? 0,
        durationMs: res?.durationMs ?? 0,
        attempt: 1,
      });
      await ctx.log('automation spec generation complete');
    } catch (e) {
      agentReply = `ERROR: ${(e as Error).message}`;
      await ctx.log(`automation spec generation failed (plan saved to automation/automation-plan.json): ${(e as Error).message}`);
    }

    // Verify specs were ACTUALLY written — the spec-writing sub-agent can no-op
    // (e.g. it hits a blocker in the plan) while this node still "succeeds". Never
    // report success on an empty plan: count the real output and surface a blocker
    // so review_automation shows it instead of the plan silently looking complete.
    const testsDir = path.join(automationDir, 'tests');
    const specFiles = isWeb
      ? (existsSync(testsDir) ? readdirSync(testsDir).filter((f) => /\.spec\.(js|ts)$/.test(f)) : [])
      : (existsSync(path.join(automationDir, 'framework-reference.md')) ? ['framework-reference.md'] : []);
    const blocked = caseCount > 0 && specFiles.length === 0;
    const out = {
      ...data,
      specsWritten: specFiles.length,
      specFiles,
      agentReply: agentReply.slice(0, 800),
      blocked,
    };
    if (blocked) {
      await ctx.log(
        `automation_generation: 0 automation file(s) written despite ${caseCount} test case(s) — ` +
          `surfacing as a blocker at review_automation. Agent reply: ${agentReply.slice(0, 300) || '(empty)'}`,
      );
    } else {
      await ctx.log(`automation_generation: ${specFiles.length} automation file(s) written (${specFiles.join(', ') || 'none'})`);
    }
    ctx.state.automationPlan = out;
    return out;
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
      instruction = getPrompt('execution').build({
        jiraKey: story.jiraKey, title: story.title, environment: story.environment ?? 'testing',
        locale, shotsDir, casesFile, isWeb: true, creds, useUser,
      });
    } else {
      toolset = ['Bash', 'Read', 'Write', 'Glob', 'Grep'];
      const caps =
        `Devices: Android = Samsung Galaxy S23 / Android 13 (UiAutomator2)${bs?.android ? ` app "${bs.android}"` : ' (no app — skip)'}; ` +
        `iOS = iPhone 14 / iOS 18 (XCUITest)${bs?.ios ? ` app "${bs.ios}"` : ' (no app — skip)'}.`;
      instruction = getPrompt('execution').build({
        jiraKey: story.jiraKey, title: story.title, environment: story.environment ?? 'testing',
        locale, shotsDir, casesFile, isWeb: false, caps,
        bsHelperPath: companionPath('bs_helper.js'), dir,
      });
    }

    // Per-story model override for execution (set in the New Story wizard); falls
    // back to the platform default (MODEL_EXECUTION) when unset.
    const executionModel = (story as { executionModel?: string | null }).executionModel || MODEL_EXECUTION;
    await ctx.log(`execution: ${isWeb ? 'web (Playwright)' : 'mobile (bs_helper)'} · ${cases.length} case(s) · ${locale} · model ${executionModel}`);
    try {
      const data = await ai(ctx, {
        ...aiOpts(instruction, ExecutionResults, 'ExecutionResults',
          '{"executed":true,"matrix":["web · en-US"],"summary":{"total":0,"passed":0,"failed":0,"blocked":0,"skipped":0},' +
          '"cases":[{"title":"...","status":"pass|fail|blocked|skipped","combo":"web · en-US","stepsRun":0,"failedStep":"...","expected":"...","actual":"...","evidence":["<path>"],"notes":"..."}],' +
          '"defects":[{"title":"...","severity":"High","priority":"High","caseTitle":"...","combo":"web · en-US","stepsToReproduce":["..."],"expected":"...","actual":"...","evidence":["<path>"]}],"notes":"..."}',
          ctx),
        agentic: true,
        // Agentic default is 1 attempt; give execution a 2nd so a single bad final
        // message (e.g. the agent ended with prose instead of the JSON) isn't fatal.
        attempts: 2,
        permissionMode: 'default',
        allowedTools: toolset,
        // No subagents (Task); and block the "pause/resume later" tools — in a one-shot
        // headless run they don't resume anything, they just end the turn with prose
        // (not the required JSON), which fails the whole execution. The agent must
        // finish inline with the ExecutionResults JSON (see BLOCKER HANDLING in the prompt).
        disallowedTools: ['Task', 'ScheduleWakeup', 'CronCreate', 'CronDelete', 'CronList', 'PushNotification', 'RemoteTrigger'],
        model: executionModel,
        effort: EFFORT_EXECUTION,
        timeoutMs: 45 * 60 * 1000,
      });
      await ctx.log(`execution done: ${data.summary.passed}P/${data.summary.failed}F/${data.summary.blocked}B/${data.summary.skipped}S of ${data.summary.total}; ${data.defects.length} defect(s)`);
      return data;
    } catch (e) {
      // The agent errored or never returned valid JSON — nothing was actually
      // executed. Do NOT report this as a clean run: flag it blocked so the
      // review_report gate (and the report) surface it loudly instead of showing
      // a benign 0/0/0/0 pass. `cases.length` is the count we FAILED to run.
      await ctx.log(`execution error (0 of ${cases.length} case(s) ran): ${(e as Error).message}`);
      return { ...emptyExecution(`execution failed: ${(e as Error).message}`, false), blocked: true, notRun: cases.length };
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
    // Parity Certification (#5): deterministic run evaluation over accumulated
    // state. Stashed in ctx.state so renderReport can show it, returned so the
    // API persists it to Run.parityJson.
    const st = ctx.state as Record<string, any>;
    const rawLocales = (ctx.run.story as { locales?: unknown }).locales;
    const locales = Array.isArray(rawLocales)
      ? (rawLocales as string[])
      : typeof rawLocales === 'string' && rawLocales
        ? rawLocales.split(',').map((l) => l.trim()).filter(Boolean)
        : ['en-US'];
    // Improvement #2: completed nodes come from AUTHORITATIVE RunStep.status
    // (execution truth), not inferred from accumulated state keys. Falls back to
    // state-key inference only if the detail fetch fails (never block the report).
    let completedNodes: string[];
    try {
      const detail = await getRunDetail(ctx.run.id);
      completedNodes = (detail.steps ?? [])
        .filter((s) => s.status === 'succeeded')
        .map((s) => s.name);
    } catch {
      completedNodes = Object.keys(NODE_STATE_KEY).filter((n) => st[NODE_STATE_KEY[n]] != null);
    }
    // Visual Testing Intelligence (M3): run the Senior-QA vision comparison
    // (best-effort) if not already produced, so parity/review/report consume it.
    if (st.visual == null) {
      try {
        const v = await runVisualComparison(ctx);
        if (v) st.visual = v;
      } catch (e) {
        await ctx.log(`visual comparison skipped: ${(e as Error).message}`);
      }
    }
    const evalInput = {
      platform: ctx.run.story.platform,
      locales,
      enabledNodes: Array.isArray((ctx.run.story as { enabledNodes?: unknown }).enabledNodes)
        ? ((ctx.run.story as { enabledNodes?: string[] }).enabledNodes as string[])
        : null,
      completedNodes,
      acceptanceCriteria: st.acceptanceCriteria,
      testCases: st.testcases,
      execution: st.execution,
      figmaFrameCount: st.figma?.frames?.length ?? 0,
      visual: st.visual,
      automation: st.automationPlan,
    };
    // Parity Certification (#5) + Review Confidence (M2) share the one evaluation
    // input — both deterministic, both from authoritative RunStep.status.
    const parity = computeParityCertification(evalInput);
    const review = computeReviewConfidence(evalInput);
    // Story Health (M4) — deterministic six-dimension roll-up REUSING parity +
    // review + visual health + defects. No AI call (ADR-001).
    const vcForHealth = st.visual as VisualComparison | undefined;
    const visualHealth = vcForHealth && vcForHealth.compared ? computeVisualHealth(vcForHealth) : null;
    const defectsForEval = (st.execution?.defects ?? []) as Array<{ title?: string; severity?: string; caseTitle?: string; component?: string }>;
    const health = computeStoryHealth(evalInput, parity, review, { visualHealth, defects: defectsForEval });
    // Recommendations (M5) — deterministic + rule-based, REUSING parity + review +
    // health + visual patterns + defects + traceability. No AI call (ADR-001).
    const recommendations = computeRecommendations({
      parity, review, health, visual: vcForHealth ?? null, visualHealth,
      defects: defectsForEval, testCases: st.testcases,
    });
    ctx.state.parity = parity;
    ctx.state.review = review;
    ctx.state.health = health;
    ctx.state.recommendations = recommendations;
    // Jira base URL for citation deep-links in the report (best-effort; labels
    // still render without it).
    try {
      const settings = await getSettings();
      const base = settings['jira.baseUrl'] || settings['jira.host'];
      if (base) ctx.state.jiraBaseUrl = base;
    } catch {
      /* citations fall back to labels-only */
    }
    await ctx.log(
      `Parity Certification: ${parity.certification.toUpperCase()} (score ${parity.score}) — ` +
        `${parity.executedCombos.length}/${parity.requiredCombos.length} combos, ` +
        `${parity.missingWorkflowStages.length} missing stage(s)`,
    );
    await ctx.log(
      `Review Confidence: ${review.level.toUpperCase()} (score ${review.score})` +
        (review.reductions.length ? ` — reduced: ${review.reductions.join('; ')}` : ''),
    );
    await ctx.log(
      `Story Health: ${health.level.toUpperCase()} (score ${health.score}) across ` +
        `${health.dimensions.filter((d) => d.applicable).length} dimension(s)`,
    );
    await ctx.log(`Recommendations: ${recommendations.length} (deterministic, 0 AI calls)`);
    // Activity Timeline (M6) — deterministic, from persisted steps; embedded in the
    // report so the artifact is a complete, self-contained audit trail (0 AI).
    try {
      const detail = await getRunDetail(ctx.run.id);
      ctx.state.timeline = buildActivityTimeline({
        run: { createdAt: (detail as { createdAt?: string }).createdAt, startedAt: (detail as { startedAt?: string }).startedAt, finishedAt: (detail as { finishedAt?: string }).finishedAt, status: detail.status },
        steps: detail.steps.map((s) => ({
          name: s.name, type: s.type, status: s.status, ordinal: s.ordinal,
          startedAt: s.startedAt, finishedAt: s.finishedAt,
          approval: s.approval ? { action: (s.approval as { action?: string }).action, decision: s.approval.decision, createdAt: s.approval.createdAt, decidedAt: s.approval.decidedAt } : null,
          clarification: s.clarification ? { createdAt: s.clarification.createdAt, answeredAt: s.clarification.answeredAt } : null,
        })),
      });
    } catch (e) {
      await ctx.log(`activity timeline skipped: ${(e as Error).message}`);
    }
    const file = await artifact(ctx, `execution-reports/test_report_${ctx.run.story.jiraKey}.html`, renderReport(ctx));
    // Root index README per the folder standard (release-validation.md §6).
    await artifact(ctx, 'README.md',
      `# ${ctx.run.story.jiraKey} — QA Artifacts\n\n${ctx.run.story.title}\n\n` +
      `| Folder | Contents |\n|---|---|\n` +
      `| requirements-analysis/ | STEP 1 requirements |\n| figma-analysis/ | design vs implementation |\n` +
      `| hls/ | High-Level Scenarios (mirror of Jira) |\n| testcases/ | BrowserStack 24-col CSV |\n` +
      `| browserstack/ | import evidence |\n| automation/ | story-specific specs |\n` +
      `| execution-reports/ | test_report_${ctx.run.story.jiraKey}.html |\n| screenshots/ · evidence/ · defects/ | run evidence |\n`);
    await ctx.log(`HTML report + README written`);
    return { reportPath: file, parity, review, health, recommendations, visual: st.visual ?? null };
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
      aiOptsP(
        getPrompt('knowledge_update'),
        { jiraKey: ctx.run.story.jiraKey },
        KnowledgeUpdate, ctx, MODEL_CHEAP,
      ),
    );
    ctx.state.knowledge = data;
    // Knowledge Lint (M8) — deterministic governance check (placement/duplicate/
    // conflict/quality) vs the existing docs/ai corpus. No AI (ADR-001). Flags
    // for human confirmation; never auto-persists or auto-rejects.
    const lint = lintKnowledgeProposals({ proposals: data.proposals, corpus: knowledgeCorpus() });
    ctx.state.knowledgeLint = lint;
    await ctx.log(
      `Knowledge Lint: ${lint.summary.ok} ok · ${lint.summary.review} review · ${lint.summary.reject} reject` +
        (lint.summary.duplicates ? ` · ${lint.summary.duplicates} possible duplicate(s)` : '') +
        (lint.summary.conflicts ? ` · ${lint.summary.conflicts} possible conflict(s)` : ''),
    );
    await ctx.log(`${data.proposals.length} knowledge proposal(s); review in the Knowledge Center`);
    return { ...data, lint };
  },
};

/**
 * Best-effort corpus of existing knowledge for Knowledge Lint (M8): every
 * docs/ai/**\/*.md as {path, title (first heading), text (leading excerpt)}.
 * Tries a couple of candidate roots (repo root vs qa-platform cwd); returns []
 * if none found — the linter still runs placement/quality/in-batch checks.
 */
function knowledgeCorpus(): KnowledgeCorpusEntry[] {
  const roots = [
    path.join(process.cwd(), 'docs', 'ai'),
    path.join(process.cwd(), '..', 'docs', 'ai'),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const files = readdirSync(root, { recursive: true }) as string[];
      const rootAbs = path.resolve(root);
      const repoRel = (abs: string) => path.relative(process.cwd(), abs).replace(/\\/g, '/');
      return files
        .filter((f) => typeof f === 'string' && /\.md$/i.test(f))
        .map((f) => {
          const abs = path.join(root, f);
          let text = '';
          try {
            text = readFileSync(abs, 'utf8').slice(0, 2000);
          } catch {
            /* skip unreadable */
          }
          const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
          // Normalize to a docs/ai-relative path so it matches proposal docPaths.
          const rel = repoRel(abs);
          const docPath = rel.includes('docs/ai/') ? rel.slice(rel.indexOf('docs/ai/')) : `docs/ai/${String(f).replace(/\\/g, '/')}`;
          void rootAbs;
          return { path: docPath, title: heading, text };
        });
    } catch {
      /* fall through to next root */
    }
  }
  return [];
}

/** Image screenshots for visual comparison: prefer execution evidence, else the screenshots dir. */
function collectScreenshots(execState: { cases?: Array<{ evidence?: string[] }> } | undefined, shotsDir: string): string[] {
  const isImg = (p: string) => /\.(png|jpe?g|webp)$/i.test(p);
  const fromEvidence = (execState?.cases ?? []).flatMap((c) => c.evidence ?? []).filter(isImg);
  if (fromEvidence.length) return [...new Set(fromEvidence)];
  try {
    if (existsSync(shotsDir)) return readdirSync(shotsDir).filter(isImg).map((f) => path.join(shotsDir, f));
  } catch {
    /* ignore */
  }
  return [];
}

/** Best actual-screenshot match for a Figma frame by normalized token overlap; index fallback. */
function bestShot(frameName: string, shots: string[], index: number): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const frameTokens = new Set(norm(frameName));
  let best = shots[index % shots.length];
  let bestScore = -1;
  for (const s of shots) {
    const overlap = norm(path.basename(s)).filter((t) => frameTokens.has(t)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = s;
    }
  }
  return best;
}

/**
 * Visual Testing Intelligence (M3) — best-effort. For each exported Figma frame
 * matched to an actual screenshot, run the Senior-QA `visual_comparison` vision
 * task (reads both images + the AC) and aggregate into a VisualComparison. The
 * deterministic health/coverage/pass-rate is computed later by computeVisualHealth.
 * Never blocks the report: any failure degrades to fewer/zero compared screens.
 * One AI vision comparator today; future pixel/OCR/axe comparators append findings
 * to the same shape with no architecture change.
 */
async function runVisualComparison(ctx: NodeContext): Promise<VisualComparison | undefined> {
  const st = ctx.state as Record<string, any>;
  const frames = ((st.figma?.frames ?? []) as Array<{ name: string; file?: string }>).filter((f) => f.file);
  if (!frames.length) return undefined;
  const dir = (st.workspacePath as string) ?? storyDir(ctx.run.story.jiraKey);
  const shots = collectScreenshots(st.execution, path.join(dir, 'screenshots'));
  if (!shots.length) {
    return { compared: false, expectedFrames: frames.length, comparedScreens: 0, passRate: 0, categoriesCovered: [], screens: [], patterns: [], componentsAffected: [], notes: 'No actual screenshots captured to compare against Figma.' };
  }
  const acText = ((st.acceptanceCriteria?.criteria ?? []) as Array<{ id: string; text: string }>)
    .map((a) => `${a.id}: ${a.text}`)
    .join('\n');
  const combo = (st.execution?.matrix?.[0] as string) ?? (ctx.run.story.platform === 'web' ? 'web · en-US' : 'android · en-US');
  const MAX = Number(process.env.QA_VISUAL_MAX_SCREENS ?? 12);
  const screens: z.infer<typeof VisualScreenComparison>[] = [];
  for (const [i, frame] of frames.slice(0, MAX).entries()) {
    if (ctx.signal.aborted) break;
    const shot = bestShot(frame.name, shots, i);
    try {
      const r = await ai(ctx, {
        ...aiOptsP(
          getPrompt('visual_comparison'),
          { jiraKey: ctx.run.story.jiraKey, screen: frame.name, combo, acText, expectedFrame: frame.file as string, actualScreenshot: shot },
          VisualScreenComparison, ctx,
        ),
        agentic: true,
        permissionMode: 'default',
        allowedTools: ['Read'],
        timeoutMs: 4 * 60 * 1000,
      });
      screens.push({ ...r, screen: r.screen || frame.name, combo, expectedFrame: frame.file, actualScreenshot: shot });
    } catch (e) {
      await ctx.log(`visual_comparison: "${frame.name}" failed — ${(e as Error).message}`);
    }
  }
  const comparedScreens = screens.filter((s) => s.verdict !== 'no-frame').length;
  const passRate = comparedScreens ? Math.round((screens.filter((s) => s.verdict === 'pass').length / comparedScreens) * 100) : 0;
  const categoriesCovered = [...new Set(screens.flatMap((s) => s.categoriesChecked ?? []))];
  // M3.5 — deterministic design-system aggregation: recurring root causes + components touched.
  const vc: VisualComparison = { compared: screens.length > 0, expectedFrames: frames.length, comparedScreens, passRate, categoriesCovered, screens, patterns: [], componentsAffected: [], notes: '' };
  vc.patterns = detectVisualPatterns(vc);
  vc.componentsAffected = [...new Set(screens.flatMap((s) => (s.findings ?? []).map((f) => f.component).filter(Boolean) as string[]))].sort();
  await ctx.log(`visual_comparison: ${screens.length} screen(s) compared · pass rate ${passRate}% · ${vc.patterns.length} recurring pattern(s)`);
  return vc;
}

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

  // ── Citation & Traceability rendering (Phase 2 M1) ──
  const citeCtx: CitationContext = {
    jiraBaseUrl: typeof st.jiraBaseUrl === 'string' ? st.jiraBaseUrl : undefined,
    storyKey: s.jiraKey,
    figmaFileKey: st.figma?.fileKey,
    acById: Object.fromEntries(
      ((st.acceptanceCriteria?.criteria ?? []) as Array<{ id: string; text: string }>).map((a) => [a.id, a.text]),
    ),
  };
  const chips = (srcs?: unknown[]) => {
    const rc = resolveCitations(srcs as any, citeCtx);
    if (!rc.length) return '';
    return `<div class="cites">${rc
      .map((c) =>
        c.href
          ? `<a class="cite" href="${esc(c.href)}" title="${esc(c.title ?? '')}">${esc(c.label)}</a>`
          : `<span class="cite" title="${esc(c.title ?? '')}">${esc(c.label)}</span>`,
      )
      .join(' ')}</div>`;
  };

  const caseRows = cases.map((c, i) => {
    const r = byTitle.get(c.title);
    return `<tr><td>${i + 1}</td><td>${esc(c.title)}${chips(c.sources)}</td><td>${esc(c.type)}</td>
    <td>${esc(c.priority)}</td><td>${c.steps?.length ?? 0}</td>
    <td>${statusBadge(r?.status)}</td><td>${fileLink(r?.evidence)}</td>
    <td>${esc(r?.actual ?? '')}</td></tr>`;
  }).join('');

  const defectRows = defects.length
    ? defects.map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.title)}${chips(d.sources)}</td><td><span class="badge fail">${esc(d.severity)}</span></td>
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

  // Parity Certification block (#5) + version footer (#3).
  const parity = st.parity as
    | {
        score: number;
        certification: string;
        requiredCombos: string[];
        executedCombos: string[];
        missingWorkflowStages: string[];
        missingAcCoverage: string[];
        missingVisualCoverage: string[];
        missingAutomationCoverage: string[];
        notes?: string;
      }
    | undefined;
  const parityCls = parity
    ? parity.certification === 'certified'
      ? 'pass'
      : parity.certification === 'partial'
        ? 'note'
        : 'fail'
    : 'no';
  const missBlock = (label: string, arr?: string[]) =>
    arr && arr.length ? `<b>${label}</b>${list(arr)}` : '';
  const parityBlock = parity
    ? `<h2>Platform Parity Certification</h2>
       <p><span class="badge ${parityCls}">${esc(parity.certification.toUpperCase())} · score ${parity.score}</span>
       &nbsp;${parity.executedCombos.length}/${parity.requiredCombos.length} required combo(s) executed</p>
       ${missBlock('Missing workflow stages', parity.missingWorkflowStages)}
       ${missBlock('Missing AC coverage', parity.missingAcCoverage)}
       ${missBlock('Missing visual coverage', parity.missingVisualCoverage)}
       ${missBlock('Missing automation coverage', parity.missingAutomationCoverage)}
       ${parity.notes ? `<p class="muted">${esc(parity.notes)}</p>` : ''}`
    : '';
  // Review Confidence block (M2) — deterministic, evidence-based.
  const review = st.review as
    | { score: number; level: string; reductions: string[]; signals: Array<{ label: string; applicable: boolean; satisfied: boolean }> }
    | undefined;
  const reviewCls = review ? (review.level === 'high' ? 'pass' : review.level === 'medium' ? 'note' : 'fail') : 'no';
  const reviewBlock = review
    ? `<h2>Review Confidence</h2>
       <p><span class="badge ${reviewCls}">${esc(review.level.toUpperCase())} · score ${review.score}</span>
       &nbsp;evidence-based (deterministic), not model-estimated.</p>
       ${review.reductions.length ? `<b>Why below 100%</b>${list(review.reductions)}` : ''}
       <table><tr><th>Evidence signal</th><th>Status</th></tr>${review.signals
         .filter((s) => s.applicable)
         .map((s) => `<tr><td>${esc(s.label)}</td><td><span class="badge ${s.satisfied ? 'pass' : 'fail'}">${s.satisfied ? '✓' : '✗'}</span></td></tr>`)
         .join('')}</table>`
    : '';
  // Story Health block (M4) — deterministic six-dimension roll-up (reuses parity/review/visual).
  const health = st.health as
    | { score: number; level: string; summary: string; reductions: string[];
        dimensions: Array<{ key: string; label: string; applicable: boolean; score: number; level: string; detail: string }> }
    | undefined;
  const healthCls = health ? (health.level === 'high' ? 'pass' : health.level === 'medium' ? 'note' : 'fail') : 'no';
  const dimCls = (lvl: string) => (lvl === 'high' ? 'pass' : lvl === 'medium' ? 'note' : 'fail');
  const storyHealthBlock = health
    ? `<h2>Story Health</h2>
       <p><span class="badge ${healthCls}">OVERALL ${health.score} · ${esc(health.level.toUpperCase())}</span>
       &nbsp;<span class="muted">deterministic roll-up (no AI) · reuses Parity + Review Confidence + Visual Health</span></p>
       <div class="grid">${health.dimensions.map((d) =>
         `<div class="card"><div class="n ${d.applicable ? '' : 'muted'}">${d.applicable ? d.score : '—'}</div>` +
         `${esc(d.label)} ${d.applicable ? `<span class="badge ${dimCls(d.level)}">${esc(d.level)}</span>` : '<span class="badge no">n/a</span>'}</div>`).join('')}</div>
       <table><tr><th>Dimension</th><th>Score</th><th>Detail</th></tr>${health.dimensions.map((d) =>
         `<tr><td>${esc(d.label)}</td><td>${d.applicable ? `<span class="badge ${dimCls(d.level)}">${d.score}</span>` : '<span class="muted">n/a</span>'}</td><td>${esc(d.detail)}</td></tr>`).join('')}</table>`
    : '';
  // Recommendations block (M5) — deterministic + rule-based, prioritized.
  const recs = (st.recommendations ?? []) as Array<{
    id: string; title: string; category: string; severity: string; impact: string; effort: string;
    expectedBenefit: string; confidence: string; priorityScore: number; rootCause: string;
    actions: string[]; eliminatesFindings: number; layer: string;
    sources?: Array<{ kind: string; ref: string; label?: string }>; derivedFrom: string[];
  }>;
  const recCards = recs.map((r) =>
    `<div class="vfind"><div><span class="badge ${sevCls(r.severity)}">${esc(r.severity)}</span> ` +
    `<b>${esc(r.title)}</b> <span class="muted">· ${esc(r.category)} · P${r.priorityScore}</span></div>` +
    `<div class="cites"><span class="dschip comp">impact ${esc(r.impact)}</span><span class="dschip tok">effort ${esc(r.effort)}</span>` +
    `<span class="dschip comp">confidence ${esc(r.confidence)}</span>${r.eliminatesFindings > 1 ? `<span class="dschip tok">clears ${r.eliminatesFindings}</span>` : ''}` +
    `<span class="dschip comp">${esc(r.layer)}</span></div>` +
    (r.rootCause ? `<div><b>Root cause:</b> ${esc(r.rootCause)}</div>` : '') +
    (r.actions?.length ? `<div class="muted"><b>Action:</b> ${esc(r.actions.join(' '))}</div>` : '') +
    `<div class="muted"><b>Benefit:</b> ${esc(r.expectedBenefit)}</div>` +
    chips(r.sources) + '</div>').join('');
  const recommendationsBlock = recs.length
    ? `<h2>Recommendations (${recs.length})</h2>
       <p class="muted">Deterministic + rule-based · derived from existing outputs · 0 AI invocations (ADR-001) · prioritized (fix-one-clear-many first).</p>
       ${recCards}`
    : '';
  // Visual Testing Intelligence section (M3) — from the structured VisualComparison.
  const vc = st.visual as VisualComparison | undefined;
  const vh = vc && vc.compared ? computeVisualHealth(vc) : undefined;
  const sevCls = (sev: string) => (sev === 'critical' || sev === 'major' ? 'fail' : sev === 'minor' ? 'note' : 'no');
  const vhCls = vh ? (vh.level === 'high' ? 'pass' : vh.level === 'medium' ? 'note' : 'fail') : 'no';
  const sevRow = vh ? Object.entries(vh.findingsBySeverity).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(' · ') : '';
  const catRow = vh ? Object.entries(vh.findingsByCategory).map(([k, n]) => `${k}: ${n}`).join(' · ') : '';
  // M3.5 — design-system tag: component and/or token chip on a finding.
  const dsTag = (f: { component?: string; token?: { kind: string; name?: string } }) => {
    const parts: string[] = [];
    if (f.component) parts.push(`<span class="dschip comp">${esc(f.component)}</span>`);
    if (f.token) parts.push(`<span class="dschip tok">${esc(f.token.kind)}${f.token.name ? ` · ${esc(f.token.name)}` : ''} token</span>`);
    return parts.length ? `<div class="cites">${parts.join('')}</div>` : '';
  };
  const findingCards = vc
    ? vc.screens.flatMap((scr) => (scr.findings ?? []).map((f) =>
        `<div class="vfind"><div><span class="badge ${sevCls(f.severity)}">${esc(f.severity)}</span> ` +
        `<b>${esc(f.category)}/${esc(f.dimension)}</b> — ${esc(f.screen || scr.screen)} ` +
        `<span class="muted">(${esc(f.confidence)} confidence)</span></div>` +
        dsTag(f) +
        `<div>${esc(f.differenceDescription || '')}</div>` +
        `<div class="muted"><b>Expected:</b> ${esc(f.expected)} &nbsp;·&nbsp; <b>Actual:</b> ${esc(f.actual)}</div>` +
        (f.recommendation ? `<div class="muted"><b>Fix:</b> ${esc(f.recommendation)}</div>` : '') +
        chips(f.sources) + '</div>')).join('')
    : '';
  // M3.5 — Recurring Patterns: one root cause explaining many findings.
  const patterns = vc?.patterns ?? [];
  const patternCards = patterns.length
    ? `<h3 class="vsub">Recurring patterns (${patterns.length})</h3>` +
      patterns.map((p) =>
        `<div class="vfind"><div><span class="badge ${sevCls(p.severity)}">${esc(p.severity)}</span> ` +
        `<b>${esc(p.title)}</b> <span class="muted">(${p.occurrences}×)</span></div>` +
        dsTag(p) +
        `<div>${esc(p.rootCause)}</div>` +
        (p.recommendation ? `<div class="muted"><b>Root-cause fix:</b> ${esc(p.recommendation)}</div>` : '') +
        (p.screens.length ? `<div class="muted"><b>Screens:</b> ${esc(p.screens.join(', '))}</div>` : '') +
        '</div>').join('')
    : '';
  const compAffected = vh?.componentsAffected?.length
    ? `<p class="muted"><b>Components affected:</b> ${vh.componentsAffected.map((c) => `<span class="dschip comp">${esc(c)}</span>`).join(' ')}</p>`
    : '';
  const visualIntel = vh
    ? `<h2>Visual Testing Intelligence</h2>
       <div class="grid">
        <div class="card"><div class="n">${vc!.expectedFrames}</div>Figma frames</div>
        <div class="card"><div class="n">${vh.screensValidated}</div>Screens validated</div>
        <div class="card"><div class="n good">${vh.screensPassed}</div>Passed</div>
        <div class="card"><div class="n bad">${vh.screensFailed}</div>Failed</div>
        <div class="card"><div class="n">${vh.passRate}%</div>Visual pass rate</div>
        <div class="card"><div class="n">${vh.coverage}%</div>Category coverage</div>
       </div>
       <p><span class="badge ${vhCls}">VISUAL HEALTH ${vh.visualHealth} · ${esc(vh.level.toUpperCase())}</span>${sevRow ? ` &nbsp; Findings — ${esc(sevRow)}` : ''}</p>
       ${catRow ? `<p class="muted">By category — ${esc(catRow)}</p>` : ''}
       ${compAffected}
       ${patternCards}
       ${patterns.length ? '<h3 class="vsub">All findings</h3>' : ''}
       ${findingCards || '<p class="muted">No visual findings — screens matched the design.</p>'}`
    : vc && !vc.compared
      ? `<h2>Visual Testing Intelligence</h2><p class="muted">${esc(vc.notes || 'Visual comparison not performed.')}</p>`
      : '';
  // ── Activity Timeline section (M6 → embedded in the report, M7) ──
  const fmtDur = (msv?: number | null) => {
    if (msv == null) return '';
    const sec = Math.round(msv / 1000);
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    return m < 60 ? `${m}m ${sec % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const fmtT = (ts?: string | null) => (ts && !Number.isNaN(new Date(ts).getTime()) ? new Date(ts).toISOString().slice(11, 19) : '—');
  const tl = st.timeline as
    | { events: Array<{ ts: string | null; label: string; durationMs?: number | null }>; nodeCount: number; completedCount: number; failedCount: number; gateCount: number; totalDurationMs: number | null }
    | undefined;
  const timelineBlock = tl && tl.events?.length
    ? `<h2 id="timeline">Activity Timeline</h2>
       <p class="muted">${tl.completedCount}/${tl.nodeCount} steps${tl.failedCount ? ` · ${tl.failedCount} failed` : ''}${tl.gateCount ? ` · ${tl.gateCount} gate(s)` : ''}${tl.totalDurationMs != null ? ` · ${fmtDur(tl.totalDurationMs)}` : ''} · deterministic, 0 AI.</p>
       <table><tr><th>Time</th><th>Event</th><th>Duration</th></tr>${tl.events
         .map((e) => `<tr><td class="mono">${esc(fmtT(e.ts))}</td><td>${esc(e.label)}</td><td class="mono">${e.durationMs != null ? esc(fmtDur(e.durationMs)) : ''}</td></tr>`)
         .join('')}</table>`
    : '';

  // ── Remaining sections as blocks (so the report is section-addressable) ──
  const objectiveBlock = st.requirements?.businessObjective
    ? `<h2 id="objective">Business objective</h2><p>${esc(st.requirements.businessObjective)}</p>${chips(st.requirements?.sources)}`
    : '';
  const impactBlock = st.impact
    ? `<h2 id="impact">Impact analysis</h2><b>Impacted areas</b>${list(st.impact?.impactedAreas)}<b>Regression areas</b>${list(st.impact?.regressionAreas)}<b>Smoke coverage</b>${list(st.impact?.smokeCoverage)}`
    : '';
  const testcasesBlock = `<h2 id="testcases">Test cases &amp; results (${cases.length})</h2>
<table><tr><th>#</th><th>Title</th><th>Type</th><th>Priority</th><th>Steps</th><th>Status</th><th>Evidence</th><th>Actual</th></tr>${caseRows}</table>`;
  const defectsBlock = `<h2 id="defects">Defects (${defects.length})</h2>
<table><tr><th>#</th><th>Title</th><th>Severity</th><th>Priority</th><th>Test case</th><th>Expected</th><th>Actual</th></tr>${defectRows}</table>`;
  const exploratoryBlock = st.exploratory?.riskAreas?.length
    ? `<h2 id="exploratory">Exploratory risk areas</h2>${list(st.exploratory?.riskAreas)}`
    : '';
  const coverageBlock = `<h2 id="coverage">Coverage matrix (platform · language)</h2>${matrix}`;

  // ── Knowledge Lint section (M8) — governance check on knowledge proposals ──
  const kl = st.knowledgeLint as
    | { proposals: Array<{ docPath: string; summary: string; verdict: string; issues: Array<{ kind: string; severity: string; message: string }> }>;
        summary: { total: number; ok: number; review: number; reject: number; duplicates: number; conflicts: number; placementIssues: number } }
    | undefined;
  const klCls = (v: string) => (v === 'ok' ? 'pass' : v === 'reject' ? 'fail' : 'note');
  const knowledgeLintBlock = kl && kl.proposals.length
    ? `<h2 id="knowledge-lint">Knowledge Lint</h2>
       <p class="muted">${kl.summary.ok} ok · ${kl.summary.review} review · ${kl.summary.reject} reject${kl.summary.duplicates ? ` · ${kl.summary.duplicates} duplicate(s)` : ''}${kl.summary.conflicts ? ` · ${kl.summary.conflicts} conflict(s)` : ''} · deterministic governance check (§6), 0 AI.</p>
       ${kl.proposals.map((p) =>
         `<div class="vfind"><div><span class="badge ${klCls(p.verdict)}">${esc(p.verdict)}</span> <b>${esc(p.docPath)}</b></div>` +
         `<div>${esc(p.summary)}</div>` +
         (p.issues.length ? `<ul class="klissues">${p.issues.map((x) => `<li><span class="dschip ${x.severity === 'error' ? 'tok' : 'comp'}">${esc(x.kind)}</span> ${esc(x.message)}</li>`).join('')}</ul>` : '<div class="muted">No governance issues.</div>') +
         '</div>').join('')}`
    : '';

  // ── Executive summary band — the Phase-2 intelligence at a glance ──
  const bandItem = (label: string, cls: string, text: string) =>
    `<div class="kpiband"><div class="kl">${esc(label)}</div><div><span class="badge ${cls}">${esc(text)}</span></div></div>`;
  const execItems: string[] = [];
  if (health) execItems.push(bandItem('Story Health', healthCls, `${health.score} · ${health.level.toUpperCase()}`));
  if (review) execItems.push(bandItem('Review Confidence', reviewCls, `${review.score} · ${review.level.toUpperCase()}`));
  if (parity) execItems.push(bandItem('Platform Parity', parityCls, `${parity.score} · ${parity.certification.toUpperCase()}`));
  if (vh) execItems.push(bandItem('Visual Health', vhCls, `${vh.visualHealth} · ${vh.level.toUpperCase()}`));
  if (recs.length) execItems.push(bandItem('Recommendations', 'note', `${recs.length} action(s)`));
  const execSummary = execItems.length ? `<div class="band">${execItems.join('')}</div>` : '';

  // ── Assemble present sections + a navigable table of contents ──
  const sectionDefs: Array<[string, string, string]> = [
    ['story-health', 'Story Health', storyHealthBlock],
    ['recommendations', 'Recommendations', recommendationsBlock],
    ['coverage', 'Coverage', coverageBlock],
    ['parity', 'Platform Parity', parityBlock],
    ['review', 'Review Confidence', reviewBlock],
    ['visual', 'Visual Testing', `${visualIntel}${visualSection}`],
    ['timeline', 'Activity Timeline', timelineBlock],
    ['objective', 'Business objective', objectiveBlock],
    ['impact', 'Impact analysis', impactBlock],
    ['testcases', 'Test cases', testcasesBlock],
    ['defects', 'Defects', defectsBlock],
    ['exploratory', 'Exploratory', exploratoryBlock],
    ['knowledge-lint', 'Knowledge Lint', knowledgeLintBlock],
  ];
  const present = sectionDefs.filter(([, , html]) => html && html.trim());
  const toc = `<nav class="toc"><span class="tl">On this page</span>${present.map(([id, title]) => `<a href="#${id}">${esc(title)}</a>`).join('')}</nav>`;
  const bodySections = present.map(([id, , html]) => `<section id="${id}" class="sec">${html}</section>`).join('\n');

  const rv = ctx.run as { workflowVersion?: string; promptVersion?: string; platformVersion?: string };
  const versionFooter =
    rv.workflowVersion || rv.promptVersion || rv.platformVersion
      ? `<p class="muted">Workflow ${esc(rv.workflowVersion ?? '—')} · Prompts ${esc(rv.promptVersion ?? '—')} · Platform ${esc(rv.platformVersion ?? '—')}</p>`
      : '';

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
.vfind{border:1px solid #E2E8F0;border-left:3px solid #CBD5E1;border-radius:8px;padding:10px 12px;margin:8px 0;font-size:.85rem;display:flex;flex-direction:column;gap:3px}
.vsub{color:#0F1B2D;font-size:.95rem;margin:18px 0 4px}
.dschip{font-size:.68rem;padding:1px 7px;border-radius:6px;border:1px solid;font-weight:600}
.dschip.comp{background:#E7F1FF;color:#0B4FA0;border-color:#BcD6F5}
.dschip.tok{background:#F3ECFF;color:#5B2A9E;border-color:#DDCBF7}
.cites{margin-top:4px;display:flex;flex-wrap:wrap;gap:4px}
.cite{font-size:.68rem;padding:1px 6px;border-radius:999px;background:#EEF2F6;color:#334155;border:1px solid #D6DEE8;text-decoration:none}
a.cite:hover{background:#DDE6F0}
.vnone{color:#856404;background:#fff3cd;border:1px dashed #ffeeba;border-radius:4px;padding:18px;text-align:center;font-size:.82rem}
.vdiff{margin-top:8px;font-size:.85rem;color:#3D4A5C}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:.8rem;color:#4A5568;white-space:nowrap}
.band{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}
.kpiband{border:1px solid #E2E8F0;border-radius:10px;padding:10px 14px;min-width:150px;background:#FAFBFC}
.kpiband .kl{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:#6B7787;margin-bottom:6px}
.kpiband .badge{font-size:.82rem;padding:3px 10px}
.toc{position:sticky;top:0;background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:10px 12px;margin:16px 0;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;z-index:5}
.toc .tl{font-weight:600;color:#0F1B2D;font-size:.82rem;margin-right:4px}
.toc a{font-size:.8rem;color:#0E6E8C;text-decoration:none;padding:2px 8px;border-radius:999px;background:#EEF6F9}
.toc a:hover{background:#DDEDF2}
.sec{scroll-margin-top:64px}
.klissues{margin:4px 0 0;padding-left:18px;font-size:.82rem}.klissues li{margin:2px 0}
@media print{.toc{position:static}}</style></head>
<body><h1>QA Report — ${esc(s.jiraKey)}</h1>
<p class="muted">${esc(s.title)} · ${esc(s.platform)} · ${esc(s.environment ?? 'testing')} · ${executed ? esc((exec.matrix ?? []).join(', ')) : 'execution pending'}</p>
${execSummary}
<div class="grid">
<div class="card"><div class="n">${cases.length}</div>Test cases</div>
<div class="card"><div class="n">${st.hls?.scenarios?.length ?? 0}</div>HLS scenarios</div>
<div class="card"><div class="n good">${sum.passed ?? 0}</div>Passed</div>
<div class="card"><div class="n bad">${sum.failed ?? 0}</div>Failed</div>
<div class="card"><div class="n">${sum.blocked ?? 0}</div>Blocked</div>
<div class="card"><div class="n bad">${defects.length}</div>Defects</div>
</div>
${toc}
${executed ? '' : '<p class="muted">Execution has not produced results for this run yet.</p>'}
${bodySections}
${versionFooter}
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

/** Map a relative artifact path to its ARTIFACT_KINDS bucket. */
function artifactKindOf(rel: string): string {
  if (rel.endsWith('.csv')) return 'csv';
  if (/execution-reports\/.*\.html$/.test(rel)) return 'report';
  return 'evidence';
}

/** Insert a version suffix before the extension: "hls/hls.md" v2 -> "hls/hls.v2.md". */
function withVersionSuffix(rel: string, version: number): string {
  const ext = path.extname(rel);
  return `${rel.slice(0, rel.length - ext.length)}.v${version}${ext}`;
}

/**
 * Write a file under the story's workspace folder, creating parent dirs, and
 * record it in the Artifact table (Run Lifecycle Management, §5b). A Restart
 * From Step that re-runs this node never clobbers the prior file: version 2+
 * gets a `.vN`-suffixed path and its own Artifact row, so the previous
 * version stays on disk and queryable — `rel` is the artifact's stable
 * logical name across versions.
 */
async function artifact(ctx: NodeContext, rel: string, content: string): Promise<string> {
  const dir = (ctx.state.workspacePath as string) ?? storyDir(ctx.run.story.jiraKey);
  const version = await nextArtifactVersion(ctx.run.id, rel);
  const versionedRel = version > 1 ? withVersionSuffix(rel, version) : rel;
  const file = path.join(dir, versionedRel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
  void recordArtifact(ctx.run.id, { kind: artifactKindOf(rel), name: rel, version, localPath: file });
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
