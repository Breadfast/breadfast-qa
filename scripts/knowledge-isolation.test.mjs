// Knowledge isolation (P0 generalization, 2026-11-24): the files EVERY team loads carry no product knowledge,
// the registry is internally consistent, and the gate rules survived the move. Red = a leak or a lost rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO, checkIsolation, scanText, loadRegistry, compileMarker, coreInstructionFiles } from './knowledge-isolation.mjs';

const reg = loadRegistry();
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');

test('no always-loaded file carries product knowledge, and no catalog carries test accounts or coordinates', () => {
  const v = checkIsolation();
  assert.deepEqual(v.map((x) => `${x.file}:${x.line} [${x.set}: ${x.match}] (${x.rule})`), []);
});

test('the checker actually catches a planted leak (Card fact in core, sensitive data in a catalog, foreign domain in a team context)', () => {
  const markers = Object.fromEntries(Object.entries(reg.domains).map(([id, d]) => [`domain:${id}`, [...(d.markers || []), ...(d.terms || [])]]));
  assert.ok(scanText('CLAUDE.md', 'Use the card panel to seed data', markers).length);
  assert.ok(scanText('CLAUDE.md', 'Tap Get started on Pay home', markers).length);
  assert.ok(scanText('x.md', 'shared acct 01203365955', { sensitive: reg.sensitiveMarkers }).length);
  assert.ok(scanText('x.md', 'tap (195, 810)', { sensitive: reg.sensitiveMarkers }).length);
  assert.deepEqual(scanText('CLAUDE.md', 'Run qa-cli.js knowledge and read only your plan', markers), []);
});

test('registry: every listed file exists, owners are real teams, markers compile, no file is in two layers', () => {
  // Owners are checked against the team PROFILES, not a README table — a new squad must not have to edit a doc to pass.
  const teams = new Set(readdirSync(path.join(REPO, 'teams')).filter((n) => n.endsWith('.json') && !n.startsWith('_')).map((n) => n.slice(0, -5)));
  const layerOf = new Map();
  const claim = (p, layer) => {
    assert.ok(existsSync(path.join(REPO, p)), `missing: ${p}`);
    if (layerOf.has(p) && layerOf.get(p) !== layer && !layer.startsWith('domain')) assert.fail(`${p} is in ${layerOf.get(p)} and ${layer}`);
    layerOf.set(p, layerOf.get(p) || layer);
  };
  reg.core.forEach((p) => claim(p, 'core'));
  reg.catalogs.forEach((p) => claim(p, 'catalog'));
  Object.values(reg.surfacePacks).flat().forEach((p) => claim(p, 'surface'));
  for (const [id, d] of Object.entries(reg.domains)) {
    assert.ok(teams.has(d.owner), `domain ${id}: owner "${d.owner}" has no teams/${d.owner}.json`);
    assert.ok(existsSync(path.join(REPO, 'qa-workflow/domains', id, 'SKILL.md')), `domain ${id} has no SKILL.md`);
    for (const f of d.files) {
      const p = typeof f === 'string' ? f : f.path;
      claim(p, `domain:${id}`);
      assert.ok(p.startsWith(`qa-workflow/domains/${id}/`), `domain ${id} file outside its folder: ${p}`);
    }
    for (const m of [...(d.markers || []), ...(d.terms || [])]) compileMarker(m);
  }
  for (const m of reg.sensitiveMarkers) compileMarker(m);
});

test('every domain file on disk is registered (nothing loads by accident, nothing is orphaned)', () => {
  const listed = new Set(Object.values(reg.domains).flatMap((d) => d.files.map((f) => (typeof f === 'string' ? f : f.path))));
  for (const id of Object.keys(reg.domains)) {
    const dir = path.join(REPO, 'qa-workflow/domains', id);
    for (const name of readdirSafe(dir)) {
      if (!name.endsWith('.md') || name === 'SKILL.md') continue;
      assert.ok(listed.has(`qa-workflow/domains/${id}/${name}`), `unregistered domain file: qa-workflow/domains/${id}/${name}`);
    }
  }
});

test('no skill, workflow or entrypoint hardcodes a domain list again', () => {
  const files = coreInstructionFiles(reg).filter((f) => /SKILL\.md$|workflows\//.test(f));
  for (const f of files) {
    const t = read(f);
    const ids = Object.keys(reg.domains).join('|');
    assert.ok(!new RegExp(`--domains\\s+(${ids})\\b`).test(t), `${f} passes a literal --domains list`);
    const fm = t.match(/^\s+domains:\s*\[([^\]]+)\]/m);
    assert.ok(!fm, `${f} frontmatter lists domains [${fm && fm[1]}] — use \`domains: team\``);
  }
});

test('the gate rules survived the knowledge move (core-rules presence)', () => {
  const claude = read('CLAUDE.md');
  for (const phrase of [
    'Reviewing is yours; approving is not',
    'The Jira post contains the HLS and NOTHING ELSE',
    'Defect Grounding Gate',
    'complete-check',
    'coverage-changing decision',
    'BEFORE any automation is written',
    'Deferral is the operator\'s call, never yours',
    'Never use another team\'s values as a default',
  ]) assert.ok(claude.includes(phrase), `CLAUDE.md lost: "${phrase}"`);
  const bug = read('docs/ai/bug-reporting.md');
  for (const phrase of ['Defect Grounding Gate', 'customfield_10042', 'Is the design actually the AUTHORITY', 'Verify the observation is real']) {
    assert.ok(bug.includes(phrase), `bug-reporting.md lost: "${phrase}"`);
  }
});

function readdirSafe(dir) {
  try { return readdirSync(dir); } catch { return []; }
}
import { readdirSync } from 'node:fs';
