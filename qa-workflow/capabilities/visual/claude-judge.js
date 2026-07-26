'use strict';

/**
 * ClaudeJudge — the FIRST Judge adapter (ADR-003 Decision 1). Reviews a residual
 * screen with Claude via the local **Claude Code CLI "Read" workflow**: it builds a
 * prompt referencing the paired Figma frame + screenshot (image file paths the CLI
 * will `Read`), the residual reason, and the deterministic findings (so the AI does
 * NOT re-detect them), invokes `claude -p … --allowedTools Read`, and parses a JSON
 * findings array back.
 *
 * Transport independence (Decision 1): this file is the ONLY place that knows about
 * Claude. The Conformance core (`lib/conformance/*`) and `evaluateStory` never import
 * it — they accept the generic `Judge` produced by `composeJudge`. The CLI call is a
 * `transport` that is fully INJECTABLE (tests pass a fake); the default shells out to
 * the CLI and fail-safes to `[]` so a missing CLI never crashes a deterministic run.
 *
 * Note: when run from inside a Claude Code session this spawns a nested headless CLI;
 * that's intentional for the initial implementation. A Messages-API transport can
 * replace `defaultClaudeCliTransport` later with zero change to the engine.
 */

const { spawnSync } = require('child_process');
const { composeJudge } = require('../../lib/conformance/judge');

/** Build the visual-review request (prompt + artifact refs) from a residual item. */
function renderVisualReview(item) {
  const { screen, reason, expected, actual, deterministicFindings } = item || {};
  const framePath = expected && (expected.framePath || (expected.frame && expected.frame.path));
  const shotPath = actual && (actual.screenshotPath || (actual.screenshot && actual.screenshot.path));
  const det = deterministicFindings || [];
  const lines = [
    `Act as a Senior QA Engineer performing a RESIDUAL visual review of ONE screen ("${screen || ''}").`,
    `This screen reached AI review because: ${reason || 'residual'}.`,
  ];
  if (framePath) lines.push(`Expected Figma design frame — READ this image: ${framePath}`);
  if (shotPath) lines.push(`Actual application screenshot — READ this image: ${shotPath}`);
  lines.push(`Deterministic layers ALREADY reported these (do NOT repeat them): ${JSON.stringify(det)}.`);
  lines.push('Report ONLY additional visual defects a human reviewer would notice. Ignore dynamic data/state.');
  lines.push('Respond with ONLY a JSON array of findings, each:');
  lines.push('{"category":"","dimension":"","severity":"critical|major|minor|info","subject":"","expected":"","actual":"","description":""}');
  lines.push('If there are no additional defects, respond with exactly: []');
  return { prompt: lines.join('\n'), allowedTools: ['Read'], screen };
}

/** Extract the first JSON array from CLI output. Tolerant of surrounding prose/code fences. */
function parseFindings(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter((f) => f && typeof f === 'object') : [];
  } catch {
    return [];
  }
}

/** Default transport: invoke the local Claude Code CLI headless. Fail-safe → '[]'. */
function defaultClaudeCliTransport(request, item, opts = {}) {
  const cli = opts.cliPath || 'claude';
  const args = ['-p', request.prompt];
  if (request.allowedTools && request.allowedTools.length) args.push('--allowedTools', request.allowedTools.join(','));
  if (opts.model) args.push('--model', opts.model);
  try {
    const res = spawnSync(cli, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (res.error || res.status !== 0) return '[]';
    return res.stdout || '[]';
  } catch {
    return '[]';
  }
}

/**
 * Build the ClaudeJudge (a generic `Judge`). `opts.transport` overrides the CLI call
 * (used by tests / a future Messages-API adapter); otherwise the CLI is used.
 */
function makeClaudeJudge(opts = {}) {
  const transport = typeof opts.transport === 'function'
    ? opts.transport
    : (request, item) => defaultClaudeCliTransport(request, item, opts);
  return composeJudge({ render: renderVisualReview, transport, parse: parseFindings });
}

module.exports = { makeClaudeJudge, renderVisualReview, parseFindings, defaultClaudeCliTransport };
