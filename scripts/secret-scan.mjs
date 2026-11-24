#!/usr/bin/env node
/**
 * secret-scan — fails when a credential-looking literal is in the repo.
 *
 * Why: three live secrets reached this repo through ordinary commits (the card DB + SSH passwords as
 * `|| '<literal>'` fallbacks in CardConfig.js, and the BrowserStack access key in a doc). Nothing
 * stopped them. This runs inside `npm test`, so a literal turns the suite red before review.
 *
 *   node scripts/secret-scan.mjs            # every tracked file at HEAD (working tree) — the npm test gate
 *   node scripts/secret-scan.mjs --staged   # only what is staged — for .githooks/pre-commit
 *   node scripts/secret-scan.mjs --json
 *
 * It NEVER prints a matched value: a finding is `file:line  kind  <len N>`.
 * Known fixtures are allowlisted in scripts/secret-scan.allow.json by file + a hash of the line, so an
 * allowlist entry stops matching the moment that line changes.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// The patterns live in ONE place, shared with the knowledge lint (team context written by onboarding).
const require = createRequire(import.meta.url);
const patterns = require('../qa-workflow/lib/knowledge/secret-patterns.js');
export const KNOWN_FORMATS = patterns.KNOWN_FORMATS;

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|mp4|mov|woff2?|ttf|otf|jar|class|lock)$/i;

export const lineHash = (line) => createHash('sha256').update(line.trim()).digest('hex').slice(0, 16);

/** Scan one file's text. Returns findings with NO value in them. */
export function scanText(file, text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const f of patterns.scanLine(line)) out.push({ file, line: i + 1, ...f, hash: lineHash(line) });
  });
  return out;
}

export function loadAllowlist(file) {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')).allow || [];
}

export function isAllowed(finding, allow) {
  return allow.some((a) => a.file === finding.file && a.hash === finding.hash);
}

function gitFiles(root, staged) {
  // Default mode: tracked files PLUS new files git would pick up (untracked, not ignored), so a
  // literal is caught before it is ever staged. Gitignored files (credentials.local.js) are skipped.
  const args = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files', '--cached', '--others', '--exclude-standard'];
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n').filter(Boolean);
}

function readStaged(root, file) {
  return execFileSync('git', ['show', `:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
}

export function scanRepo(root, { staged = false, allowFile } = {}) {
  const allow = loadAllowlist(allowFile || path.join(root, 'scripts', 'secret-scan.allow.json'));
  const findings = [];
  for (const file of gitFiles(root, staged)) {
    if (BINARY.test(file)) continue;
    let text;
    try { text = staged ? readStaged(root, file) : readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const f of scanText(file, text)) if (!isAllowed(f, allow)) findings.push(f);
  }
  return findings;
}

// Compare REAL paths: through a symlinked directory (e.g. macOS /var → /private/var) the two spellings differ,
// and a mismatch here would make the script silently do nothing and exit 0 — a gate that always passes.
const realOrSelf = (p) => { try { return realpathSync(p); } catch { return p; } };
const isMain = !!process.argv[1] && realOrSelf(path.resolve(process.argv[1])) === realOrSelf(fileURLToPath(import.meta.url));
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const staged = process.argv.includes('--staged');
  const findings = scanRepo(root, { staged });
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + '\n');
  } else if (findings.length) {
    process.stderr.write(`secret-scan: ${findings.length} credential-looking literal(s) — values not shown:\n`);
    for (const f of findings) process.stderr.write(`   ${f.file}:${f.line}  ${f.kind}  <len ${f.length}>  (line hash ${f.hash})\n`);
    process.stderr.write('Move the value to automation/config/credentials.local.js or an env var. If it is a test\n'
      + 'fixture, add {file, hash, reason} to scripts/secret-scan.allow.json.\n');
  } else {
    process.stdout.write(`secret-scan: clean (${staged ? 'staged files' : 'tracked + new files'})\n`);
  }
  process.exit(findings.length ? 1 : 0);
}
