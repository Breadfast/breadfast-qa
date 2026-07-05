import { Injectable } from '@nestjs/common';
import { prisma } from '@qa/db';
import type { FrameworkInput, ResolvedFrameworks } from '@qa/shared';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Framework Registry service. Scans a registered path (cheap filesystem checks
 * + version + git provenance) and never throws — a missing/invalid framework is
 * recorded, not fatal. Paths are machine-specific (per-user), stored in the
 * workspace SQLite DB.
 */
@Injectable()
export class FrameworksService {
  list() {
    return prisma.framework.findMany({ orderBy: { name: 'asc' } });
  }

  async create(input: FrameworkInput) {
    const scan = scanPath(input.type, input.localPath);
    return prisma.framework.create({ data: { ...input, ...scan } });
  }

  async update(id: string, input: Partial<FrameworkInput>) {
    const existing = await prisma.framework.findUnique({ where: { id } });
    if (!existing) throw new Error(`Framework ${id} not found`);
    const type = input.type ?? existing.type;
    const localPath = input.localPath ?? existing.localPath;
    const scan = scanPath(type, localPath);
    return prisma.framework.update({ where: { id }, data: { ...input, ...scan } });
  }

  remove(id: string) {
    return prisma.framework.delete({ where: { id } });
  }

  async scan(id: string) {
    const fw = await prisma.framework.findUnique({ where: { id } });
    if (!fw) throw new Error(`Framework ${id} not found`);
    return prisma.framework.update({ where: { id }, data: scanPath(fw.type, fw.localPath) });
  }

  /** Compact map for the worker: first VALID path per canonical type. */
  async resolved(): Promise<ResolvedFrameworks> {
    const all = await prisma.framework.findMany();
    const firstValid = (pred: (t: string) => boolean) =>
      all.find((f) => pred(f.type) && f.validationStatus === 'valid')?.localPath ??
      all.find((f) => pred(f.type))?.localPath;
    return {
      playwright: firstValid((t) => t === 'playwright'),
      javaAppium: firstValid((t) => t === 'java-appium' || t === 'appium'),
    };
  }
}

interface ScanResult {
  validationStatus: string;
  scanDetails: string | null;
  lastScan: Date;
  version: string | null;
  gitCommit: string | null;
  gitBranch: string | null;
}

/** Cheap, never-throwing validation + provenance scan for one framework path. */
function scanPath(type: string, localPath: string): ScanResult {
  const now = new Date();
  const base: ScanResult = {
    validationStatus: 'unscanned',
    scanDetails: null,
    lastScan: now,
    version: null,
    gitCommit: null,
    gitBranch: null,
  };
  try {
    if (!localPath || !existsSync(localPath) || !statSync(localPath).isDirectory()) {
      return { ...base, validationStatus: 'not-found', scanDetails: 'path does not exist or is not a directory' };
    }
  } catch {
    return { ...base, validationStatus: 'not-found', scanDetails: 'path not accessible' };
  }

  // Provenance (best-effort).
  const git = readGit(localPath);
  base.gitCommit = git.commit;
  base.gitBranch = git.branch;

  const pkgPath = path.join(localPath, 'package.json');
  const pomPath = path.join(localPath, 'pom.xml');

  if (type === 'playwright' || type === 'api') {
    if (!existsSync(pkgPath)) {
      return { ...base, validationStatus: 'invalid', scanDetails: 'no package.json found' };
    }
    const pkg = readJson(pkgPath);
    base.version = pkg?.version ?? null;
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    if (type === 'playwright' && !deps['@playwright/test'] && !existsSync(path.join(localPath, 'pages'))) {
      return { ...base, validationStatus: 'invalid', scanDetails: 'no @playwright/test dependency or pages/ dir' };
    }
    return { ...base, validationStatus: 'valid', scanDetails: `package.json ok${base.version ? ` (v${base.version})` : ''}` };
  }

  if (type === 'java-appium' || type === 'appium') {
    if (!existsSync(pomPath)) {
      return { ...base, validationStatus: 'invalid', scanDetails: 'no pom.xml found (Maven project expected)' };
    }
    base.version = readPomVersion(pomPath);
    return { ...base, validationStatus: 'valid', scanDetails: `pom.xml found${base.version ? ` (v${base.version})` : ''}` };
  }

  // other: existence is enough.
  return { ...base, validationStatus: 'valid', scanDetails: 'path exists' };
}

function readJson(file: string): any | null {
  try {
    let raw = readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readPomVersion(file: string): string | null {
  try {
    const xml = readFileSync(file, 'utf8');
    const m = xml.match(/<version>([^<]+)<\/version>/);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function readGit(dir: string): { commit: string | null; branch: string | null } {
  const run = (args: string[]) => {
    try {
      return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  return { commit: run(['rev-parse', '--short', 'HEAD']), branch: run(['rev-parse', '--abbrev-ref', 'HEAD']) };
}
