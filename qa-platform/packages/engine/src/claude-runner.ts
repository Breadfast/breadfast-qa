/**
 * ClaudeRunner — wraps the local `claude` CLI in headless (`-p`) mode.
 *
 * This is the heart of the platform. Each reasoning step is a scoped task run
 * with cwd = the QA Companion directory, so CLAUDE.md + docs/ai/** load as
 * project instructions automatically (proven in the Phase-0 PoC). Runs use the
 * tester's own Claude subscription — no API key.
 */
import { spawn } from 'node:child_process';

export interface ClaudeRunOptions {
  /** The user/task prompt passed to `claude -p`. */
  prompt: string;
  /** Working dir — CLAUDE.md + docs/ai/** are auto-discovered from here. */
  cwd: string;
  /** Path to the claude executable (default "claude"). */
  bin?: string;
  /** Model id, e.g. "claude-opus-4-8" or the cheap model for mechanical steps. */
  model?: string;
  /** Reasoning effort for the session (low, medium, high, xhigh, max). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** plan = no writes (safe default for reasoning). acceptEdits/default for tool steps. */
  permissionMode?: 'plan' | 'default' | 'acceptEdits';
  /** Restrict tools; omit for none. e.g. ["mcp__Atlassian__getJiraIssue"]. */
  allowedTools?: string[];
  /** Explicitly deny tools even if otherwise permitted (e.g. ["Task"] to block subagent spawns). */
  disallowedTools?: string[];
  /** Extra MCP config files to load (Jira/Figma/Slack/BrowserStack). */
  mcpConfig?: string[];
  /** Resume a prior session for multi-turn continuity. */
  resumeSession?: string;
  /** Appended to the default (CLAUDE.md-derived) system prompt. */
  appendSystemPrompt?: string;
  /** Hard timeout in ms (default 10 min). */
  timeoutMs?: number;
  /** Streamed log line callback (stderr / progress). */
  onLog?: (line: string) => void;
  /** Abort signal — a Stop request SIGKILLs the child immediately. */
  signal?: AbortSignal;
}

export class ClaudeCancelledError extends Error {
  constructor() {
    super('claude run cancelled');
    this.name = 'ClaudeCancelledError';
  }
}

/**
 * Claude usage/rate limit hit (Run Lifecycle Management — Claude Usage Limit
 * Protection). Reactive only, by design: neither the `claude` CLI nor
 * Anthropic expose a queryable "% of plan used" signal, so there is no way to
 * warn BEFORE the limit is hit — only to recognize the CLI's own failure
 * signature when it happens and pause cleanly instead of failing the run.
 * `resetHint`, when the CLI's message includes one, is shown to the tester
 * verbatim rather than parsed into a timestamp (format is not guaranteed).
 */
export class UsageLimitError extends Error {
  constructor(readonly resetHint?: string) {
    super(`Claude usage limit reached${resetHint ? ` — ${resetHint}` : ''}`);
    this.name = 'UsageLimitError';
  }
}

/**
 * Heuristic, env-configurable detection of a usage/rate-limit signature in
 * the CLI's output. Deliberately a text match, not an API call: there is
 * nothing else to check against. `QA_USAGE_LIMIT_PATTERNS` (comma-separated
 * regex fragments, case-insensitive) lets this be tuned without a redeploy
 * once real production error text is observed — the defaults below are a
 * best-effort starting set, not a confirmed sample of the CLI's real wording.
 */
const DEFAULT_USAGE_LIMIT_PATTERNS = [
  'usage limit',
  'usage_limit',
  'rate limit',
  'rate_limit',
  '\\b5-hour limit\\b',
  '\\bweekly limit\\b',
  'claude ai usage limit',
];

function usageLimitPatterns(): RegExp[] {
  const extra = (process.env.QA_USAGE_LIMIT_PATTERNS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_USAGE_LIMIT_PATTERNS, ...extra].map((p) => new RegExp(p, 'i'));
}

function looksLikeUsageLimit(text: string): boolean {
  return Boolean(text) && usageLimitPatterns().some((re) => re.test(text));
}

/**
 * Session Continuity (Run Lifecycle Management) — heuristic, env-configurable
 * detection of a "--resume target doesn't exist/expired" signature, same
 * best-effort approach as the usage-limit patterns above: there's no API to
 * check a session id's validity ahead of time, only the CLI's own failure text
 * to recognize when a resume attempt didn't work. `QA_SESSION_NOT_FOUND_PATTERNS`
 * (comma-separated regex fragments, case-insensitive) lets this be tuned once
 * real production wording is observed.
 */
const DEFAULT_SESSION_NOT_FOUND_PATTERNS = [
  'no conversation found',
  'session .{0,40}not found',
  'no session found',
  'invalid session',
  'session .{0,40}expired',
  'could not resume',
];

function sessionNotFoundPatterns(): RegExp[] {
  const extra = (process.env.QA_SESSION_NOT_FOUND_PATTERNS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_SESSION_NOT_FOUND_PATTERNS, ...extra].map((p) => new RegExp(p, 'i'));
}

function looksLikeSessionNotFound(text: string): boolean {
  return Boolean(text) && sessionNotFoundPatterns().some((re) => re.test(text));
}

/** Best-effort "resets at/in ..." fragment straight out of the CLI's message. */
function extractResetHint(text: string): string | undefined {
  return text.match(/resets?\s+(?:at|in)\s+[^.\n]{1,60}/i)?.[0];
}

export interface ClaudeRunResult {
  text: string;
  sessionId: string | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  isError: boolean;
}

/** The JSON envelope `claude -p --output-format json` prints. */
interface ClaudeJsonEnvelope {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Session Continuity (Run Lifecycle Management) — the `--resume <id>` target
 * wasn't found or is no longer usable (wrong machine, expired, or a run whose
 * session was cleared by a Restart From Step). Callers are expected to catch
 * this and retry once with `resumeSession` omitted — the standard DB-rebuilt
 * prompt already contains everything needed, resuming was only ever an
 * optimization on top, never a dependency.
 */
export class SessionNotFoundError extends Error {
  constructor(readonly sessionId?: string) {
    super(`claude session not found or unusable${sessionId ? `: ${sessionId}` : ''}`);
    this.name = 'SessionNotFoundError';
  }
}

export class ClaudeRunError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = 'ClaudeRunError';
  }
}

export async function runClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const bin = opts.bin ?? process.env.CLAUDE_BIN ?? 'claude';
  const args = ['-p', opts.prompt, '--output-format', 'json'];

  args.push('--permission-mode', opts.permissionMode ?? 'plan');
  if (opts.model) args.push('--model', opts.model);
  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.resumeSession) args.push('--resume', opts.resumeSession);
  if (opts.appendSystemPrompt)
    args.push('--append-system-prompt', opts.appendSystemPrompt);
  if (opts.allowedTools?.length)
    args.push('--allowedTools', ...opts.allowedTools);
  if (opts.disallowedTools?.length)
    args.push('--disallowedTools', ...opts.disallowedTools);
  if (opts.mcpConfig?.length) args.push('--mcp-config', ...opts.mcpConfig);

  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;

  if (opts.signal?.aborted) throw new ClaudeCancelledError();

  return new Promise<ClaudeRunResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      // Ignore stdin so the CLI does not wait 3s for piped input.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let cancelled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new ClaudeRunError(`claude run timed out after ${timeoutMs}ms`, stderr, null));
    }, timeoutMs);

    const onAbort = () => {
      cancelled = true;
      child.kill('SIGKILL');
    };
    opts.signal?.addEventListener('abort', onAbort);
    const cleanupSignal = () => opts.signal?.removeEventListener('abort', onAbort);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (opts.onLog) for (const line of s.split('\n')) if (line.trim()) opts.onLog(line.trim());
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      cleanupSignal();
      reject(new ClaudeRunError(`failed to spawn ${bin}: ${err.message}`, stderr, null));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      cleanupSignal();
      if (cancelled) return reject(new ClaudeCancelledError());
      const env = extractEnvelope(stdout);
      if (!env) {
        const combined = stderr || stdout;
        if (looksLikeUsageLimit(combined)) return reject(new UsageLimitError(extractResetHint(combined)));
        if (opts.resumeSession && looksLikeSessionNotFound(combined)) {
          return reject(new SessionNotFoundError(opts.resumeSession));
        }
        return reject(
          new ClaudeRunError(`could not parse claude JSON output (exit ${code})`, stderr || stdout, code),
        );
      }
      if (env.is_error && looksLikeUsageLimit(env.result ?? '')) {
        return reject(new UsageLimitError(extractResetHint(env.result ?? '')));
      }
      if (env.is_error && opts.resumeSession && looksLikeSessionNotFound(env.result ?? '')) {
        return reject(new SessionNotFoundError(opts.resumeSession));
      }
      resolve({
        text: env.result ?? '',
        sessionId: env.session_id ?? null,
        costUsd: env.total_cost_usd ?? 0,
        inputTokens: env.usage?.input_tokens ?? 0,
        outputTokens: env.usage?.output_tokens ?? 0,
        durationMs: env.duration_ms ?? 0,
        isError: Boolean(env.is_error),
      });
    });
  });
}

/** The CLI may print warnings before the JSON; grab the last valid JSON object. */
function extractEnvelope(stdout: string): ClaudeJsonEnvelope | null {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as ClaudeJsonEnvelope;
  } catch {
    // Fall back: find the last {...} block in the stream.
    const start = trimmed.lastIndexOf('{"type"');
    if (start >= 0) {
      try {
        return JSON.parse(trimmed.slice(start)) as ClaudeJsonEnvelope;
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}
