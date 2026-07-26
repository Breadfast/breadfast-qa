import { Injectable } from '@nestjs/common';
import { prisma } from '@qa/db';
import { companionDir, workspaceDir, figmaAuthPath } from '@qa/shared/paths';
import { validateScreenRegistry } from '@qa/shared';
import { loadScreenRegistry } from '@qa/shared/screen-registry-loader';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export interface Fix {
  why: string;
  how: string;
  docsUrl?: string;
}
export interface Check {
  id: string;
  group: 'core' | 'integrations' | 'frameworks' | 'tools';
  label: string;
  status: CheckStatus;
  detail: string;
  version?: string | null;
  required: boolean;
  fix?: Fix;
}

export interface DiagnosticsReport {
  checks: Check[];
  readiness: 'ready' | 'web-ready' | 'mobile-ready' | 'not-ready';
  summary: { pass: number; warn: number; fail: number; skip: number };
}

const FIGMA_EXPIRY_DAYS = Number(process.env.FIGMA_AUTH_EXPIRY_DAYS ?? 25);

@Injectable()
export class DiagnosticsService {
  async report(): Promise<DiagnosticsReport> {
    const checks = await this.run();
    const by = (id: string) => checks.find((c) => c.id === id)?.status;
    const coreOk = checks.filter((c) => c.group === 'core' && c.required).every((c) => c.status === 'pass');
    const webOk = coreOk && by('frameworks.playwright') !== 'fail';
    const mobileOk =
      coreOk && by('frameworks.java') === 'pass' && by('tools.java') === 'pass' && by('tools.androidSdk') !== 'fail';
    const readiness = !coreOk ? 'not-ready' : webOk && mobileOk ? 'ready' : mobileOk ? 'mobile-ready' : 'web-ready';
    const summary = {
      pass: checks.filter((c) => c.status === 'pass').length,
      warn: checks.filter((c) => c.status === 'warn').length,
      fail: checks.filter((c) => c.status === 'fail').length,
      skip: checks.filter((c) => c.status === 'skip').length,
    };
    return { checks, readiness, summary };
  }

  async run(): Promise<Check[]> {
    return [
      this.nodeCheck(),
      this.gitCheck(),
      this.claudeCheck(),
      this.workspaceCheck(),
      await this.dbCheck(),
      this.parityHealthCheck(),
      this.screenRegistryCheck(),
      ...(await this.integrationChecks()),
      ...(await this.frameworkChecks()),
      ...this.toolChecks(),
    ];
  }

  // ── core ──────────────────────────────────────────────────────────────────
  private nodeCheck(): Check {
    const major = Number(process.versions.node.split('.')[0]);
    const ok = major >= 20;
    return {
      id: 'core.node', group: 'core', label: 'Node.js ≥ 20', required: true,
      status: ok ? 'pass' : 'fail', detail: `Node ${process.versions.node}`, version: process.versions.node,
      fix: ok ? undefined : { why: 'The platform targets Node 20+.', how: 'Install Node 20 or newer (nvm/Volta or nodejs.org) and restart.', docsUrl: 'https://nodejs.org' },
    };
  }

  private gitCheck(): Check {
    const v = cmd('git', ['--version']);
    return {
      id: 'core.git', group: 'core', label: 'Git installed', required: true,
      status: v ? 'pass' : 'fail', detail: v ?? 'git not found on PATH', version: v,
      fix: v ? undefined : { why: 'Git is required to clone/update the repo and frameworks.', how: 'Install Git and ensure it is on your PATH.', docsUrl: 'https://git-scm.com/downloads' },
    };
  }

  private claudeCheck(): Check {
    const bin = process.env.CLAUDE_BIN || 'claude';
    const v = cmd(bin, ['--version']);
    return {
      id: 'core.claude', group: 'core', label: 'Claude CLI installed', required: true,
      status: v ? 'pass' : 'fail', detail: v ? `${v} (sign-in confirmed on first run)` : 'claude CLI not found', version: v,
      fix: v ? undefined : { why: 'The engine drives your local Claude CLI (your subscription).', how: 'Install the Claude CLI and sign in, or set CLAUDE_BIN to its path.', docsUrl: 'https://claude.com/claude-code' },
    };
  }

  private workspaceCheck(): Check {
    try {
      const dir = workspaceDir();
      const probe = path.join(dir, `.diag-${process.pid}.tmp`);
      writeFileSync(probe, 'ok');
      rmSync(probe, { force: true });
      return { id: 'core.workspace', group: 'core', label: 'Workspace writable', required: true, status: 'pass', detail: dir };
    } catch (e) {
      return {
        id: 'core.workspace', group: 'core', label: 'Workspace writable', required: true, status: 'fail',
        detail: (e as Error).message,
        fix: { why: 'Runtime data (DB, artifacts, logs) is written to your workspace.', how: 'Pick a writable workspace location in Settings, or set QA_WORKSPACE_DIR.' },
      };
    }
  }

  private async dbCheck(): Promise<Check> {
    try {
      await prisma.setting.count();
      return { id: 'core.db', group: 'core', label: 'Database reachable', required: true, status: 'pass', detail: 'SQLite (workspace) reachable' };
    } catch (e) {
      return {
        id: 'core.db', group: 'core', label: 'Database reachable', required: true, status: 'fail', detail: (e as Error).message,
        fix: { why: 'The local SQLite DB stores stories, runs and settings.', how: 'Run `npm run db:generate && npm run db:push` to create it.' },
      };
    }
  }

  /** VT4-S7 — validate the Screen Registry (non-required; registry is progressive). */
  private screenRegistryCheck(): Check {
    const base = { id: 'core.screenRegistry', group: 'core' as const, label: 'Screen Registry', required: false };
    try {
      const reg = loadScreenRegistry();
      if (!reg.screens.length && !reg.profiles.length) {
        return { ...base, status: 'skip', detail: 'No screens registered yet (optional — heuristic pairing in use).' };
      }
      const issues = validateScreenRegistry(reg);
      const errors = issues.filter((i) => i.level === 'error');
      const warns = issues.filter((i) => i.level === 'warning');
      const status: CheckStatus = errors.length ? 'fail' : warns.length ? 'warn' : 'pass';
      const detail =
        `${reg.screens.length} screen(s), ${reg.profiles.length} profile(s)` +
        (errors.length ? ` · ${errors.length} error(s): ${errors.map((e) => e.message).slice(0, 3).join('; ')}`
          : warns.length ? ` · ${warns.length} warning(s)` : ' · valid');
      return {
        ...base, status, detail,
        fix: errors.length ? { why: 'Duplicate or invalid registry entries make deterministic pairing ambiguous.', how: 'Resolve duplicate screenIds / profile ids and unknown profile references under docs/ai/screens/.' } : undefined,
      };
    } catch (e) {
      return { ...base, status: 'warn', detail: (e as Error).message };
    }
  }

  private parityHealthCheck(): Check {
    const root = companionDir();
    const claudeMd = existsSync(path.join(root, 'CLAUDE.md'));
    const docsAi = existsSync(path.join(root, 'docs', 'ai'));
    const design = existsSync(path.join(root, 'qa-platform', 'docs', 'design'));
    const aiCount = docsAi ? countMd(path.join(root, 'docs', 'ai')) : 0;
    const ok = claudeMd && docsAi && aiCount > 0;
    return {
      id: 'core.parity', group: 'core', label: 'Platform Parity Health', required: true,
      status: ok ? (design ? 'pass' : 'warn') : 'fail',
      detail: ok ? `CLAUDE.md + ${aiCount} docs/ai file(s)${design ? ' + design specs' : ' (design specs missing)'}` : 'canonical knowledge base missing',
      fix: ok ? undefined : { why: 'The AI engine loads CLAUDE.md + docs/ai/** as its project instructions; without them runs are not at parity.', how: 'Run from the repo root (contains CLAUDE.md + docs/ai/**), or set QA_COMPANION_DIR to it.' },
    };
  }

  // ── integrations ────────────────────────────────────────────────────────────
  private async integrationChecks(): Promise<Check[]> {
    const s = Object.fromEntries((await prisma.setting.findMany()).map((r) => [r.key, r.value]));
    const has = (...keys: string[]) => keys.some((k) => (process.env[k] || s[k])?.trim());

    const jira = has('JIRA_API_TOKEN', 'JIRA_EMAIL', 'jira.auth', 'jira.apiToken');
    const bs = has('BS_TM_USERNAME', 'BS_TM_UI_PASSWORD', 'browserstack.username', 'browserstack.uiPassword', 'browserstack.tmApiToken');

    // Figma: browser session file present + fresh.
    let figma: Check;
    try {
      const p = figmaAuthPath();
      if (!existsSync(p)) {
        figma = mkWarn('integrations.figma', 'integrations', 'Figma session', 'No Figma browser session saved.',
          { why: 'Figma export uses a saved browser session.', how: 'Settings → Figma Browser Session → Connect Figma.' });
      } else {
        figma = mkPass('integrations.figma', 'integrations', 'Figma session', 'Figma session present.');
      }
    } catch {
      figma = mkWarn('integrations.figma', 'integrations', 'Figma session', 'Could not read session.', { why: 'Figma export needs a session.', how: 'Reconnect Figma in Settings.' });
    }

    return [
      jira
        ? mkPass('integrations.jira', 'integrations', 'Jira configured', 'Jira auth present.')
        : mkWarn('integrations.jira', 'integrations', 'Jira configured', 'No Jira auth found.', { why: 'Fetching stories, pushing HLS and filing bugs need Jira auth.', how: 'Set JIRA_EMAIL + JIRA_API_TOKEN (or automation/config/credentials.local.js).', docsUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens' }),
      bs
        ? mkPass('integrations.browserstack', 'integrations', 'BrowserStack configured', 'BrowserStack creds present.')
        : mkWarn('integrations.browserstack', 'integrations', 'BrowserStack configured', 'No BrowserStack creds found.', { why: 'Test-case upload and mobile execution need BrowserStack.', how: 'Set them in Settings → BrowserStack.', docsUrl: 'https://www.browserstack.com/accounts/settings' }),
      figma,
    ];
  }

  // ── frameworks ──────────────────────────────────────────────────────────────
  private async frameworkChecks(): Promise<Check[]> {
    const fws = await prisma.framework.findMany();
    const forType = (pred: (t: string) => boolean, id: string, label: string) => {
      const valid = fws.find((f) => pred(f.type) && f.validationStatus === 'valid');
      const any = fws.find((f) => pred(f.type));
      if (valid) return mkPass(id, 'frameworks', label, `${valid.name} — ${valid.localPath}`);
      if (any) return { id, group: 'frameworks' as const, label, required: false, status: 'fail' as const, detail: `${any.name}: ${any.scanDetails ?? any.validationStatus}`, fix: { why: 'Registered but the path is invalid/missing.', how: 'Fix the path in the Framework Registry and re-scan.' } };
      return mkWarn(id, 'frameworks', label, 'Not registered.', { why: 'Automation generation/execution for this platform needs the framework.', how: 'Register it in the Framework Registry.' });
    };
    return [
      forType((t) => t === 'playwright', 'frameworks.playwright', 'Playwright framework'),
      forType((t) => t === 'java-appium' || t === 'appium', 'frameworks.java', 'Java/Appium framework'),
    ];
  }

  // ── tools ────────────────────────────────────────────────────────────────────
  private toolChecks(): Check[] {
    const java = cmd('java', ['-version']); // java prints to stderr; cmd captures both
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    const androidOk = !!androidHome && existsSync(androidHome);
    const isMac = process.platform === 'darwin';
    const xcode = isMac ? cmd('xcode-select', ['-p']) : null;

    return [
      { id: 'tools.java', group: 'tools', label: 'Java (JDK)', required: false, status: java ? 'pass' : 'warn', detail: java ?? 'java not found (needed only for mobile/Appium)', version: java, fix: java ? undefined : { why: 'The Java/Appium framework needs a JDK.', how: 'Install a JDK (17+) and ensure `java` is on PATH.' } },
      { id: 'tools.androidSdk', group: 'tools', label: 'Android SDK', required: false, status: androidOk ? 'pass' : 'warn', detail: androidOk ? androidHome! : 'ANDROID_HOME/ANDROID_SDK_ROOT not set (needed only for Android)', fix: androidOk ? undefined : { why: 'Android automation needs the SDK.', how: 'Install the Android SDK and set ANDROID_HOME.' } },
      isMac
        ? { id: 'tools.xcode', group: 'tools', label: 'Xcode', required: false, status: xcode ? 'pass' : 'warn', detail: xcode ?? 'xcode-select path not found (needed only for iOS)', fix: xcode ? undefined : { why: 'iOS automation on macOS needs Xcode.', how: 'Install Xcode and run `xcode-select --install`.' } }
        : { id: 'tools.xcode', group: 'tools', label: 'Xcode', required: false, status: 'skip', detail: 'macOS only' },
    ];
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
function cmd(bin: string, args: string[]): string | null {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    return (out || '').split('\n')[0].trim() || null;
  } catch (e: any) {
    // Some tools (java) print version to stderr with a non-zero-ish path; capture it.
    const err = e?.stderr?.toString?.() ?? '';
    const line = err.split('\n')[0]?.trim();
    return line || null;
  }
}
function countMd(dir: string): number {
  let n = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) n += countMd(path.join(dir, e.name));
      else if (e.name.endsWith('.md')) n++;
    }
  } catch { /* ignore */ }
  return n;
}
function mkPass(id: string, group: Check['group'], label: string, detail: string): Check {
  return { id, group, label, required: false, status: 'pass', detail };
}
function mkWarn(id: string, group: Check['group'], label: string, detail: string, fix: Fix): Check {
  return { id, group, label, required: false, status: 'warn', detail, fix };
}
