#!/usr/bin/env node
/**
 * Cross-platform Prisma CLI wrapper.
 *
 * Prisma's schema uses `url = env("DATABASE_URL")`, but a fresh clone has no
 * .env. This wrapper resolves DATABASE_URL from the single path resolver
 * (@qa/shared/paths → workspaceDbUrl(), i.e. <workspace>/qa.db) when it isn't
 * already set, then runs the requested prisma command with node (no shell, no
 * .cmd/.bin platform quirks). Existing scripts keep working; an explicit
 * DATABASE_URL still wins.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);

async function resolveDbUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL;
  try {
    const { workspaceDbUrl } = await import('@qa/shared/paths');
    return workspaceDbUrl();
  } catch {
    // Fallback (shared not built yet): mirror workspaceDbUrl() inline.
    const ws = process.env.QA_WORKSPACE_DIR?.trim() || path.join(os.homedir(), 'BreadfastQA', 'Workspace');
    return 'file:' + path.join(ws, 'qa.db').replace(/\\/g, '/');
  }
}

const args = process.argv.slice(2);
const DATABASE_URL = await resolveDbUrl();

// Resolve the prisma bin and run it via the current node — portable everywhere.
const prismaPkgJson = require.resolve('prisma/package.json');
const prismaBin = path.join(path.dirname(prismaPkgJson), require(prismaPkgJson).bin.prisma);

const res = spawnSync(process.execPath, [prismaBin, ...args], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL },
});
process.exit(res.status ?? 1);
