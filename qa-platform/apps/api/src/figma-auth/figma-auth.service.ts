import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const B55168_DIR    = process.env.BF_B55168_DIR    ?? 'D:\\Playwright\\b55168_pom';
const QA_PLATFORM   = process.env.QA_PLATFORM_DIR  ?? 'D:\\BreadfastQA\\qa-platform';
const AUTH_DIR      = path.join(QA_PLATFORM, 'auth');
export const FIGMA_AUTH_PATH =
  process.env.FIGMA_AUTH_PATH ?? path.join(AUTH_DIR, 'figma-auth.json');
const CONNECT_SCRIPT = path.join(AUTH_DIR, 'connect-figma.js');

/** Session is considered expired after this many days. Figma sessions last ~30 days. */
const EXPIRY_DAYS = Number(process.env.FIGMA_AUTH_EXPIRY_DAYS ?? 25);

type ConnectStatus = 'connected' | 'connecting' | 'disconnected' | 'expired';

export interface FigmaAuthStatus {
  status: ConnectStatus;
  savedAt?: string;
  cookieCount?: number;
  /** Last few lines from the connect script (useful while connecting). */
  recentLogs?: string[];
  /** Human-readable message explaining the current status. */
  message?: string;
}

@Injectable()
export class FigmaAuthService implements OnModuleDestroy {
  private child: ChildProcess | null = null;
  private logs: string[] = [];

  onModuleDestroy() {
    this.child?.kill('SIGKILL');
  }

  /**
   * Spawn the headed browser connect script.
   * If a connect process is already running, returns its current status instead
   * of opening a second browser window.
   */
  async connect(): Promise<FigmaAuthStatus> {
    if (this.child !== null && this.child.exitCode === null) {
      return { status: 'connecting', message: 'Browser is already open — please complete login.', recentLogs: this.recentLogs() };
    }

    // Clean up any previous exited child.
    this.child = null;
    this.logs = [];

    const child = spawn('node', [CONNECT_SCRIPT], {
      cwd: B55168_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_PATH: path.join(B55168_DIR, 'node_modules'),
        FIGMA_AUTH_PATH,
      },
      // DO NOT set windowsHide:true — the browser window must be visible.
    });

    child.stdout?.on('data', (d) => this.pushLog(d.toString()));
    child.stderr?.on('data', (d) => this.pushLog(d.toString()));
    child.on('error', (e) => this.pushLog(`spawn error: ${e.message}`));
    child.on('close', (code) => {
      this.pushLog(`connect-figma exited (code ${code})`);
      // Don't null out this.child here — getStatus() uses exitCode !== null to
      // distinguish "process finished" from "still running".
    });

    this.child = child;
    return {
      status: 'connecting',
      message: 'Browser opened. Please log in to Figma with Google — the window will close automatically on success.',
      recentLogs: [],
    };
  }

  /** Check the saved auth file and in-process connect state. */
  getStatus(): FigmaAuthStatus {
    const isRunning = this.child !== null && this.child.exitCode === null;

    if (!existsSync(FIGMA_AUTH_PATH)) {
      return {
        status: isRunning ? 'connecting' : 'disconnected',
        message: isRunning ? 'Waiting for login to complete…' : 'No Figma session saved. Click "Connect Figma" to authenticate.',
        recentLogs: this.recentLogs(),
      };
    }

    let auth: { savedAt?: string; cookies?: unknown[]; origins?: unknown[] };
    try {
      let raw = readFileSync(FIGMA_AUTH_PATH, 'utf8');
      // Strip UTF-8 BOM if present (some tools on Windows add it).
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
      auth = JSON.parse(raw);
    } catch {
      return { status: 'disconnected', message: 'Auth file is unreadable. Please reconnect.' };
    }

    const cookies = auth.cookies ?? [];
    if (!cookies.length) {
      return { status: 'disconnected', message: 'Auth file has no cookies. Please reconnect.' };
    }

    if (auth.savedAt) {
      const ageMs = Date.now() - new Date(auth.savedAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays > EXPIRY_DAYS) {
        return {
          status: 'expired',
          savedAt: auth.savedAt,
          cookieCount: cookies.length,
          message: `Session expired (saved ${Math.round(ageDays)} days ago). Please reconnect.`,
        };
      }
    }

    return {
      status: 'connected',
      savedAt: auth.savedAt,
      cookieCount: cookies.length,
      message: `Figma session active (${cookies.length} cookie(s)${auth.savedAt ? `, saved ${auth.savedAt.slice(0, 10)}` : ''}).`,
    };
  }

  /** Remove the saved session and kill any in-progress connect. */
  disconnect(): { ok: boolean } {
    this.child?.kill('SIGKILL');
    this.child = null;
    this.logs = [];
    if (existsSync(FIGMA_AUTH_PATH)) {
      rmSync(FIGMA_AUTH_PATH, { force: true });
    }
    return { ok: true };
  }

  private pushLog(raw: string) {
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (l) this.logs.push(l);
    }
    // Keep only the last 50 lines to avoid unbounded growth.
    if (this.logs.length > 50) this.logs = this.logs.slice(-50);
  }

  private recentLogs(): string[] {
    return this.logs.slice(-8);
  }
}
