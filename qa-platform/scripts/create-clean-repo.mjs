#!/usr/bin/env node
/**
 * Phase A — clean-repo migration (cross-platform, zero deps).
 *
 * Creates the shareable `breadfast-qa` repo by copying ONLY approved assets from
 * the companion working dir, excluding personal/runtime artifacts. Per the
 * simplified Phase-A decision, team-shared TESTING credentials in automation/**
 * are kept as-is (no sanitization). Personal data (DB, sessions, reports,
 * screenshots, videos, logs, story folders) is excluded.
 *
 * Usage:
 *   node scripts/create-clean-repo.mjs --dest <dir>            # DRY RUN (default): prints the plan
 *   node scripts/create-clean-repo.mjs --dest <dir> --execute  # actually copies + scaffolds
 *
 * SRC is auto-detected as the companion root (the parent of qa-platform/).
 */
import { promises as fs } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));      // <SRC>/qa-platform/scripts
const SRC = path.resolve(scriptDir, '..', '..');                     // companion root
const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const destArg = args[args.indexOf('--dest') + 1];
const DEST = path.resolve(destArg && !destArg.startsWith('--') ? destArg : path.resolve(SRC, '..', 'breadfast-qa'));

// ── Top-level entries to migrate (relative to SRC) ──────────────────────────
const INCLUDE = [
  'CLAUDE.md',
  'AGENTS.md',
  'bs_helper.js',       // → kept at automation/ (see MOVE_INTO_AUTOMATION)
  'gen_report.js',      // → kept at automation/
  'docs',               // knowledge base (docs/ai/**) at repo root
  'automation',         // shared scripts + page objects + team-shared testing config
  'qa-platform',        // the app (source only)
];
// bs_helper.js + gen_report.js stay at the repo root (referenced there by
// CLAUDE.md's quick-ref and by companionPath('bs_helper.js') in the worker).

// ── Exclusions (personal / runtime / generated) ─────────────────────────────
const EXCLUDE_DIR_SEGMENTS = new Set([
  'node_modules', 'dist', '.next', '.git', 'coverage',
  'test-results', 'playwright-report', '.playwright-mcp', '.history', 'browser-sessions',
]);
const EXCLUDE_BASENAMES = new Set([
  'figma-auth.json',        // live Figma session cookies (personal)
  'PARITY-PROPOSAL.pdf',
  '.env',                   // per-machine (absolute paths + live-write flags); .env.example is kept
]);
const EXCLUDE_EXT = new Set([
  '.db', '.db-journal', '.sqlite',
  '.log', '.tsbuildinfo',
  '.zip', '.mp4',
]);

function shouldExclude(relPath, name, isDir) {
  const segs = relPath.split(path.sep);
  if (segs.some((s) => EXCLUDE_DIR_SEGMENTS.has(s))) return true;
  if (isDir) return false;
  if (EXCLUDE_BASENAMES.has(name)) return true;
  if (name === '.env.example') return false; // keep the template
  if (EXCLUDE_EXT.has(path.extname(name).toLowerCase())) return true;
  return false;
}

// ── Walk + copy ─────────────────────────────────────────────────────────────
const stats = { copied: 0, bytes: 0, skipped: 0, skippedSamples: [] };

async function walk(absSrc, relBase, absDestBase) {
  const entries = await fs.readdir(absSrc, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(absSrc, e.name);
    const rel = relBase ? path.join(relBase, e.name) : e.name;
    if (shouldExclude(rel, e.name, e.isDirectory())) {
      stats.skipped++;
      if (stats.skippedSamples.length < 40) stats.skippedSamples.push(rel);
      continue;
    }
    const dest = path.join(absDestBase, e.name);
    if (e.isDirectory()) {
      if (EXECUTE) await fs.mkdir(dest, { recursive: true });
      await walk(abs, rel, dest);
    } else {
      stats.copied++;
      try { stats.bytes += statSync(abs).size; } catch {}
      if (EXECUTE) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(abs, dest);
      }
    }
  }
}

async function migrateEntry(name) {
  const abs = path.join(SRC, name);
  if (!existsSync(abs)) { console.log(`  (missing, skipped): ${name}`); return; }
  const isDir = statSync(abs).isDirectory();
  if (isDir) {
    const destBase = path.join(DEST, name);
    if (EXECUTE) await fs.mkdir(destBase, { recursive: true });
    await walk(abs, name, destBase);
  } else {
    const dest = path.join(DEST, name);
    stats.copied++;
    try { stats.bytes += statSync(abs).size; } catch {}
    if (EXECUTE) { await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.copyFile(abs, dest); }
  }
}

// ── Generated root scaffolding ──────────────────────────────────────────────
const ROOT_GITIGNORE = `# deps / build
node_modules/
dist/
.next/
*.tsbuildinfo
coverage/

# per-machine env (ship .env.example instead)
.env
.env.local

# personal / runtime (belt-and-suspenders — these live in the workspace, not the repo)
runtime/
stories/
**/*.db
**/*.db-journal
*.log
logs/
auth/figma-auth.json
browser-sessions/

# generated media / artifacts
*.zip
*.mp4
test-results/
playwright-report/
.playwright-mcp/
.history/
`;

const ROOT_README = `# breadfast-qa

Shareable monorepo for the Breadfast QA Platform + the canonical AI QA Companion.

- \`CLAUDE.md\` + \`docs/ai/**\` — the frozen canonical workflow + knowledge base (single source of truth).
- \`automation/\` — shared automation scripts, page objects, and team-shared QA testing config.
- \`qa-platform/\` — the platform app (npm workspaces). See [qa-platform/README.md](./qa-platform/README.md).

Runtime/personal data (SQLite DB, story artifacts, reports, screenshots, videos, logs,
browser/Figma sessions) lives in a per-user **workspace outside this repo** and is never committed.

## Quick start
\`\`\`
cd qa-platform
cp .env.example .env
npm install && npm run build
npm run dev
\`\`\`
`;

const PROJECT_DEFAULTS = {
  $schema: 'non-secret Project Profiles — see qa-platform/docs/design/project-profiles.md',
  profiles: [
    { id: 'card-service', name: 'Card Service', jiraProject: 'B10', defaultPlatform: 'web',
      defaultEnvironment: 'testing', defaultLocales: ['en-US', 'ar-EG'], defaultExecutionType: 'full',
      browserstack: {}, frameworks: [], urls: {}, notes: 'Card panel / card portal web QA.' },
    { id: 'customer-app', name: 'Customer App', jiraProject: 'B10', defaultPlatform: 'cross-platform',
      defaultEnvironment: 'testing', defaultLocales: ['en-US', 'ar-EG'], defaultExecutionType: 'full',
      browserstack: {}, frameworks: [], urls: {} },
    { id: 'control-room', name: 'Control Room', jiraProject: 'B10', defaultPlatform: 'web',
      defaultEnvironment: 'testing', defaultLocales: ['en-US'], defaultExecutionType: 'full',
      browserstack: {}, frameworks: [], urls: {} },
    { id: 'chatbot', name: 'Chatbot', jiraProject: 'B10', defaultPlatform: 'web',
      defaultEnvironment: 'testing', defaultLocales: ['en-US', 'ar-EG'], defaultExecutionType: 'full',
      browserstack: {}, frameworks: [], urls: {} },
  ],
};

async function scaffold() {
  const write = async (rel, content) => {
    const dest = path.join(DEST, rel);
    if (EXECUTE) { await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, content, 'utf8'); }
    console.log(`  scaffold: ${rel}${EXECUTE ? '' : ' (dry-run)'}`);
  };
  await write('.gitignore', ROOT_GITIGNORE);
  await write('README.md', ROOT_README);
  await write('project-defaults.json', JSON.stringify(PROJECT_DEFAULTS, null, 2) + '\n');
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\nBreadfast QA — clean-repo migration  [${EXECUTE ? 'EXECUTE' : 'DRY RUN'}]`);
console.log(`  SRC : ${SRC}`);
console.log(`  DEST: ${DEST}\n`);
if (EXECUTE && existsSync(DEST) && (await fs.readdir(DEST)).length) {
  console.error(`REFUSING: destination exists and is not empty: ${DEST}`);
  process.exit(2);
}
if (EXECUTE) await fs.mkdir(DEST, { recursive: true });
console.log('Migrating entries:');
for (const name of INCLUDE) { console.log(`  • ${name}`); await migrateEntry(name); }
console.log('\nScaffolding root files:');
await scaffold();
console.log('\nSummary:');
console.log(`  files ${EXECUTE ? 'copied' : 'to copy'}: ${stats.copied}`);
console.log(`  approx bytes:            ${(stats.bytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  entries excluded:        ${stats.skipped}`);
if (stats.skippedSamples.length) {
  console.log('  excluded samples:');
  for (const s of stats.skippedSamples) console.log(`    - ${s}`);
}
console.log(EXECUTE ? '\nDONE. Next: git init in DEST.' : '\nDRY RUN complete. Re-run with --execute to copy.');
