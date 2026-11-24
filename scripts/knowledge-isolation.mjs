#!/usr/bin/env node
/**
 * knowledge-isolation — proves product knowledge stays out of the files every team loads.
 *
 *   core instruction files  (CLAUDE.md, AGENTS.md, registry `core`, every skill/workflow/entrypoint)
 *       must match NO domain marker and NO sensitive marker
 *   catalogs + surface packs  (the shared Java framework's catalogs — they name its real classes)
 *       must match NO sensitive marker (test phones, shared passcode, coordinate taps)
 *   teams/<team>/context.md
 *       must match no STRONG marker of a domain that team does not list — except under
 *       "## Integrations & dependencies", where naming another product as a dependency is the point.
 *       (Generic `terms` such as "cashback" or "Breadfast Pay" are only kept out of core.)
 *
 * Markers live in qa-workflow/registry/knowledge.json. A line that legitimately needs a marker (e.g. the
 * registry's own description of a domain) goes in scripts/knowledge-isolation.allow.json by file + line
 * hash + reason, so it stops being excused the moment the line changes.
 *
 *   node scripts/knowledge-isolation.mjs          # prints violations; exit 1 if any
 *   node scripts/knowledge-isolation.mjs --json
 */

import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const lineHash = (line) => createHash('sha256').update(line.trim()).digest('hex').slice(0, 16);

/** "(?i)src" → RegExp(src, 'i'); anything else → RegExp(src). */
export function compileMarker(src) {
  return src.startsWith('(?i)') ? new RegExp(src.slice(4), 'i') : new RegExp(src);
}

function listMd(dir, pattern) {
  const abs = path.join(REPO, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listMd(rel, pattern));
    else if (pattern.test(e.name)) out.push(rel);
  }
  return out;
}

/** The always-loaded instruction files: no product marker may appear in them. */
export function coreInstructionFiles(reg) {
  return [...new Set([
    'CLAUDE.md', 'AGENTS.md',
    ...reg.core,
    ...listMd('qa-workflow/skills', /^SKILL\.md$|^README\.md$/),
    ...listMd('qa-workflow/workflows', /\.md$/),
    ...listMd('.claude/skills', /^SKILL\.md$/),
    'qa-workflow/README.md', 'qa-workflow/domains/README.md', 'teams/README.md',
  ])].filter((f) => existsSync(path.join(REPO, f)));
}

export function loadRegistry(file = path.join(REPO, 'qa-workflow/registry/knowledge.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadAllow(file = path.join(REPO, 'scripts/knowledge-isolation.allow.json')) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).allow || [] : [];
}

/** Scan text against named marker sets; returns violations (no allowlist applied). */
export function scanText(file, text, markerSets) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [set, markers] of Object.entries(markerSets)) {
      for (const m of markers) {
        const re = compileMarker(m);
        const hit = line.match(re);
        if (hit) { out.push({ file, line: i + 1, set, marker: m, match: hit[0], hash: lineHash(line), text: line.trim().slice(0, 160) }); break; }
      }
    }
  });
  return out;
}

/** Blank out the "Integrations & dependencies" section (keeps line numbers): naming a dependency is allowed there. */
export function withoutDependencies(text) {
  let inDeps = false;
  return text.split(/\r?\n/).map((l) => {
    if (/^##\s/.test(l)) inDeps = /^##\s+Integrations & dependencies/.test(l);
    return inDeps && !/^##\s/.test(l) ? '' : l;
  }).join('\n');
}

export function checkIsolation({ reg = loadRegistry(), allow = loadAllow() } = {}) {
  const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
  const allDomainMarkers = Object.fromEntries(Object.entries(reg.domains).map(([id, d]) => [`domain:${id}`, [...(d.markers || []), ...(d.terms || [])]]));
  const strongMarkers = Object.fromEntries(Object.entries(reg.domains).map(([id, d]) => [`domain:${id}`, d.markers || []]));
  const sensitive = { sensitive: reg.sensitiveMarkers || [] };
  const violations = [];

  for (const f of coreInstructionFiles(reg)) {
    violations.push(...scanText(f, read(f), { ...allDomainMarkers, ...sensitive }).map((v) => ({ ...v, rule: 'core-has-product-knowledge' })));
  }
  const loose = [...(reg.catalogs || []), ...Object.values(reg.surfacePacks || {}).flat()];
  for (const f of loose.filter((x) => existsSync(path.join(REPO, x)))) {
    violations.push(...scanText(f, read(f), sensitive).map((v) => ({ ...v, rule: 'catalog-has-sensitive-data' })));
  }
  const teamsDir = path.join(REPO, 'teams');
  for (const e of existsSync(teamsDir) ? readdirSync(teamsDir, { withFileTypes: true }) : []) {
    const ctx = path.join('teams', e.name, 'context.md');
    if (!e.isDirectory() || !existsSync(path.join(REPO, ctx))) continue;
    let own = [];
    try { own = JSON.parse(read(path.join('teams', `${e.name}.json`))).domains || []; } catch { /* no profile */ }
    const foreign = Object.fromEntries(Object.entries(strongMarkers).filter(([k]) => !own.includes(k.slice('domain:'.length))));
    violations.push(...scanText(ctx, withoutDependencies(read(ctx)), { ...foreign, ...sensitive }).map((v) => ({ ...v, rule: 'team-context-has-foreign-knowledge' })));
  }
  return violations.filter((v) => !allow.some((a) => a.file === v.file && a.hash === v.hash));
}

// Compare REAL paths: through a symlinked directory (e.g. macOS /var → /private/var) the two spellings differ,
// and a mismatch here would make the script silently do nothing and exit 0 — a gate that always passes.
const realOrSelf = (p) => { try { return realpathSync(p); } catch { return p; } };
const isMain = !!process.argv[1] && realOrSelf(path.resolve(process.argv[1])) === realOrSelf(fileURLToPath(import.meta.url));
if (isMain) {
  const v = checkIsolation();
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  else if (!v.length) process.stdout.write('knowledge-isolation: clean\n');
  else {
    const byFile = {};
    for (const x of v) (byFile[x.file] = byFile[x.file] || []).push(x);
    for (const [f, list] of Object.entries(byFile)) {
      process.stdout.write(`\n${f}  (${list.length})\n`);
      for (const x of list) process.stdout.write(`  ${String(x.line).padStart(4)} [${x.set}: ${x.match}] ${x.text}\n`);
    }
    process.stdout.write(`\nknowledge-isolation: ${v.length} violation(s) in ${Object.keys(byFile).length} file(s)\n`);
  }
  process.exit(v.length ? 1 : 0);
}
