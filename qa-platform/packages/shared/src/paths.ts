/**
 * Cross-platform path resolution — the SINGLE source of truth for where the
 * platform reads/writes on disk. Server-side only (uses node builtins); this
 * module is intentionally NOT re-exported from index.ts so the web bundle never
 * pulls node:fs/os. Import it via the "@qa/shared/paths" subpath.
 *
 * Two distinct roots (previously conflated under one D:\BreadfastQA):
 *   • COMPANION / repo root  — holds CLAUDE.md + docs/ai/** (the engine's cwd).
 *                              Auto-detected; override with QA_COMPANION_DIR.
 *   • WORKSPACE               — per-user RUNTIME data (SQLite DB, story
 *                              artifacts, logs, sessions), OUTSIDE the repo.
 *                              Defaults to ~/BreadfastQA/Workspace; override
 *                              with QA_WORKSPACE_DIR.
 * No hardcoded drive letters. All paths built with node:path (cross-platform).
 */
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A dir is the companion/repo root if it holds CLAUDE.md AND docs/ai. */
function looksLikeRepoRoot(dir: string): boolean {
  return existsSync(path.join(dir, 'CLAUDE.md')) && existsSync(path.join(dir, 'docs', 'ai'));
}

/** Walk up from startDir looking for the repo root; null if not found. */
function walkUpForRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (looksLikeRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let _companion: string | null = null;
/**
 * The QA Companion / repo root (engine cwd). Resolution:
 *   QA_COMPANION_DIR env → walk up from cwd → walk up from this module → cwd.
 * Cached after first resolution.
 */
export function companionDir(): string {
  if (_companion) return _companion;
  const env = process.env.QA_COMPANION_DIR?.trim();
  if (env) return (_companion = path.resolve(env));
  const fromCwd = walkUpForRoot(process.cwd());
  if (fromCwd) return (_companion = fromCwd);
  try {
    const fromModule = walkUpForRoot(path.dirname(fileURLToPath(import.meta.url)));
    if (fromModule) return (_companion = fromModule);
  } catch {
    /* import.meta unavailable (e.g. CJS interop) — fall through */
  }
  return (_companion = process.cwd());
}

/** Join a path under the companion/repo root. */
export function companionPath(...segments: string[]): string {
  return path.join(companionDir(), ...segments);
}

/** The shared automation dir (scripts, page objects, config) in the repo. */
export function automationDir(): string {
  return companionPath('automation');
}

let _workspace: string | null = null;
/**
 * Per-user runtime workspace (OUTSIDE the repo). Resolution:
 *   QA_WORKSPACE_DIR env → ~/BreadfastQA/Workspace (OS home). Created if missing.
 */
export function workspaceDir(): string {
  if (_workspace) return _workspace;
  const env = process.env.QA_WORKSPACE_DIR?.trim();
  _workspace = env ? path.resolve(env) : path.join(os.homedir(), 'BreadfastQA', 'Workspace');
  ensureDir(_workspace);
  return _workspace;
}

/** Ensure a directory exists (recursive); returns it. */
export function ensureDir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** A story's artifact root: <workspace>/stories/<jiraKey> (created). */
export function storyDir(jiraKey: string): string {
  return ensureDir(path.join(workspaceDir(), 'stories', jiraKey));
}

export function logsDir(): string { return ensureDir(path.join(workspaceDir(), 'logs')); }
export function cacheDir(): string { return ensureDir(path.join(workspaceDir(), 'cache')); }
export function browserSessionsDir(): string { return ensureDir(path.join(workspaceDir(), 'browser-sessions')); }

/** Saved Figma browser session file (per-user; in the workspace, never the repo). */
export function figmaAuthPath(): string {
  const env = process.env.FIGMA_AUTH_PATH?.trim();
  if (env) return path.resolve(env);
  return path.join(ensureDir(path.join(workspaceDir(), 'auth')), 'figma-auth.json');
}

/**
 * Default Prisma SQLite connection string, pointing at <workspace>/qa.db.
 * Uses forward slashes (valid + portable in a file: URL on all platforms).
 * Respects an explicit DATABASE_URL override elsewhere.
 */
export function workspaceDbUrl(): string {
  const file = path.join(workspaceDir(), 'qa.db');
  return 'file:' + file.replace(/\\/g, '/');
}

/** Registered Playwright web framework path (env override; undefined if unset). */
export function playwrightFrameworkDir(): string | undefined {
  return process.env.BF_B55168_DIR?.trim() || undefined;
}

/** Registered Java/Appium framework path (env override; undefined if unset). */
export function javaFrameworkDir(): string | undefined {
  return process.env.BF_JAVA_FRAMEWORK_DIR?.trim() || process.env.BF_JAVA_DIR?.trim() || undefined;
}
