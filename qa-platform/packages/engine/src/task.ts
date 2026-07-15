/**
 * Scoped AI task runner. A workflow node calls runAiTask() with a zod schema;
 * the engine instructs the headless Claude run to emit ONLY JSON matching that
 * schema, then validates it (one retry on parse/validation failure). This is
 * how reasoning-step output is made deterministic enough to drive a workflow.
 */
import type { z } from 'zod';
import { runClaude, type ClaudeRunOptions, type ClaudeRunResult } from './claude-runner.js';
import { parseJsonTolerant } from './json.js';

export interface AiTaskOptions<S extends z.ZodTypeAny>
  extends Omit<ClaudeRunOptions, 'prompt' | 'appendSystemPrompt'> {
  /** The lifecycle step instruction, e.g. "Perform STEP 1 Requirements Analysis for B10-56336." */
  instruction: string;
  /** Optional extra context (clarification answers, prior outputs) injected verbatim. */
  context?: string;
  /** Output is validated against this schema. */
  schema: S;
  /** Human-readable schema name used in the prompt. */
  schemaName: string;
  /** A compact JSON example of the expected shape. */
  schemaHint: string;
  /**
   * Agentic task: the run is expected to USE tools (browser/shell) to actually
   * perform work, and only its FINAL message must be the JSON object. The plain
   * "output ONLY JSON, no tool use" wording would otherwise suppress tool use.
   */
  agentic?: boolean;
  /** Validation attempts. Defaults: 2 for reasoning tasks, 1 for agentic (re-running a tool run is expensive). */
  attempts?: number;
}

/**
 * Playwright MCP browser tools — the allowlist a web-execution agent needs to
 * drive the live app. Plus Read/Write so it can persist screenshots/evidence.
 */
export const PLAYWRIGHT_TOOLS = [
  'mcp__playwright__browser_navigate',
  'mcp__playwright__browser_snapshot',
  'mcp__playwright__browser_click',
  'mcp__playwright__browser_type',
  'mcp__playwright__browser_fill_form',
  'mcp__playwright__browser_select_option',
  'mcp__playwright__browser_press_key',
  'mcp__playwright__browser_hover',
  'mcp__playwright__browser_wait_for',
  'mcp__playwright__browser_take_screenshot',
  'mcp__playwright__browser_navigate_back',
  'mcp__playwright__browser_tabs',
  'mcp__playwright__browser_console_messages',
  'mcp__playwright__browser_network_requests',
  'Read',
  'Write',
];

/** Figma batch export tools — extends PLAYWRIGHT_TOOLS with download interception (browser_run_code_unsafe)
 *  and ZIP extraction (Bash). Used by the tryPlaywrightBatchExport step in figma_analysis. */
export const FIGMA_EXPORT_TOOLS = [
  ...PLAYWRIGHT_TOOLS,
  'mcp__playwright__browser_evaluate',
  'mcp__playwright__browser_run_code_unsafe',
  'Bash',
];

export interface AiTaskResult<T> {
  data: T;
  raw: ClaudeRunResult;
  /** Diagnostics for the LLM Request Log (#7) — how the JSON was obtained. */
  meta: { attempts: number; repaired: boolean; repairStage: string };
}

export async function runAiTask<S extends z.ZodTypeAny>(
  opts: AiTaskOptions<S>,
): Promise<AiTaskResult<z.infer<S>>> {
  const base = buildPrompt(opts.instruction, opts.schemaName, opts.schemaHint, opts.context, opts.agentic);
  const maxAttempts = opts.attempts ?? (opts.agentic ? 1 : 2);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt =
      attempt === 1
        ? base
        : base +
          '\n\nIMPORTANT: your previous reply was not valid JSON matching the schema. ' +
          'Reply with ONLY the JSON object, no markdown fences, no prose.';

    const raw = await runClaude({ ...opts, prompt });
    // Repair common JSON defects (fences, trailing commas, smart quotes, raw
    // control chars, …) BEFORE deciding to re-run Claude. Only a repair failure
    // — not a merely-messy but recoverable reply — costs another model call.
    const parsedJson = parseJsonTolerant(raw.text);
    if (parsedJson !== undefined) {
      if (parsedJson.repaired) opts.onLog?.(`JSON repaired via "${parsedJson.stage}" (attempt ${attempt}) — no re-run needed`);
      const parsed = opts.schema.safeParse(parsedJson.value);
      if (parsed.success)
        return { data: parsed.data, raw, meta: { attempts: attempt, repaired: parsedJson.repaired, repairStage: parsedJson.stage } };
      opts.onLog?.(`schema validation failed (attempt ${attempt}): ${parsed.error.message}`);
    } else {
      opts.onLog?.(`JSON parse failed after repair (attempt ${attempt})`);
    }
  }
  throw new Error(`AI task "${opts.schemaName}" did not return valid JSON after ${maxAttempts} attempt(s)`);
}

function buildPrompt(
  instruction: string,
  schemaName: string,
  schemaHint: string,
  context?: string,
  agentic?: boolean,
): string {
  const rules = agentic
    ? `\nRules: USE your available tools to actually perform the work described above — ` +
      `do not fabricate results. When you are done, your FINAL message (after all tool calls) MUST be ` +
      `ONLY a single JSON object named ${schemaName} matching the shape above — no prose, no explanation, ` +
      `no markdown code fences in that final message. Follow the QA standards in your project instructions (CLAUDE.md + docs/ai/**).`
    : `\nRules: output ONLY the JSON object. No prose, no explanation, no markdown code fences. ` +
      `Follow the QA standards in your project instructions (CLAUDE.md + docs/ai/**).`;
  return [
    instruction,
    context ? `\nContext:\n${context}` : '',
    `\nReturn your result as a single JSON object named ${schemaName} matching exactly this shape:`,
    schemaHint,
    rules,
  ]
    .filter(Boolean)
    .join('\n');
}

