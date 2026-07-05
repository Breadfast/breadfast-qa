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
        return reject(
          new ClaudeRunError(`could not parse claude JSON output (exit ${code})`, stderr || stdout, code),
        );
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
