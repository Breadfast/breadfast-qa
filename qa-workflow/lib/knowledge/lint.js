'use strict';

/**
 * knowledge-lint — keeps team-scoped knowledge honest.
 *
 * TEAM CONTEXT (teams/<team>/context.md, written by team onboarding):
 *   - a `verifiedAt: YYYY-MM-DD · verifiedBy: <name>` line
 *   - every required section present (Product … Open questions / unknowns)
 *   - every fact bullet outside "Open questions" ends with exactly one confidence tag:
 *       [confirmed: <src>; <date>]   src = repo:<id>@<sha>:<path>[:<line>] | doc:<url-or-path> | jira:<KEY>
 *       [inferred: <evidence>; <date>]
 *       [tester: <name>; <date>]
 *       [unknown]                    (then "Open questions / unknowns" must not be empty)
 *       [outdated: <superseded by>; <date>]
 *   - no credential-looking literal; no STRONG marker of a domain the team does not list (dependencies may be
 *     named under "Integrations & dependencies"; generic `terms` are allowed)
 *   - teams/<team>/repos.json, when present: [{ id, url, role, components? }]
 * DOMAIN FILES (qa-workflow/domains/<domain>/*.md): a provenance header and no credential-looking literal.
 *
 * Why: onboarding and repo discovery write knowledge another session will trust. A fact with no source reads
 * exactly like a confirmed one; this makes the difference visible and mechanical.
 */

const fs = require('fs');
const path = require('path');
const { scanLine } = require('./secret-patterns');

const SECTIONS = [
  'Product', 'Surfaces & locale support', 'Environments', 'Architecture', 'Tech stack', 'Repositories',
  'Documentation', 'Test data strategy', 'Integrations & dependencies', 'Open questions / unknowns',
];
const OPEN = 'Open questions / unknowns';
const DATE = '\\d{4}-\\d{2}-\\d{2}';
const TAG = new RegExp(String.raw`\[(confirmed|inferred|tester|unknown|outdated)(?::\s*([^\];]+?))?(?:;\s*(${DATE}))?\]\s*$`);
const SRC = /^(repo:[a-z0-9][a-z0-9._-]*@[0-9a-f]{7,40}:[^\s:]+(:\d+)?|doc:\S+|jira:[A-Z][A-Z0-9]+-\d+)$/;
const ROLES = ['backend', 'web', 'android', 'ios', 'shared', 'contracts', 'db', 'other'];

function compileMarker(src) {
  return src.startsWith('(?i)') ? new RegExp(src.slice(4), 'i') : new RegExp(src);
}

/** Split a context.md into { heading → lines[] } on `## ` headings. */
function sections(text) {
  const out = {};
  let cur = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const h = line.match(/^##\s+(.+?)\s*$/);
    // A heading satisfies a required section when it IS the name or starts with it ("Environments (URLs only)").
    if (h) { cur = SECTIONS.find((s) => h[1] === s || h[1].startsWith(s + ' ')) || h[1]; out[cur] = []; return; }
    if (cur) out[cur].push({ line, n: i + 1 });
  });
  return out;
}

/** Lint one tag; returns an error message or null. */
function checkTag(kind, arg, date) {
  if (kind === 'unknown') return arg || date ? '[unknown] takes no source or date' : null;
  if (!date) return `[${kind}: …] needs a date (YYYY-MM-DD)`;
  if (!arg || !arg.trim()) return `[${kind}] needs ${kind === 'tester' ? 'a name' : kind === 'confirmed' ? 'a source' : 'its evidence'}`;
  if (kind === 'confirmed' && !SRC.test(arg.trim())) return `[confirmed] source must be repo:<id>@<sha>:<path>[:line], doc:<url-or-path> or jira:<KEY> (got "${arg.trim()}")`;
  return null;
}

/**
 * Lint a team folder.
 * @param {string} teamDir    teams/<team>
 * @param {object} opts { ownDomains: string[], registry: {domains:{id:{markers}}} }
 */
function lintTeamContext(teamDir, opts = {}) {
  const errors = [];
  const warnings = [];
  const file = path.join(teamDir, 'context.md');
  const rel = (n) => `${path.basename(teamDir)}/context.md${n ? ':' + n : ''}`;
  if (!fs.existsSync(file)) return { errors: [{ at: rel(), code: 'missing', message: 'no context.md — run team onboarding' }], warnings, stats: null };
  const text = fs.readFileSync(file, 'utf8');

  const meta = text.match(new RegExp(String.raw`verifiedAt:\s*(${DATE})\s*·\s*verifiedBy:\s*([^\n·]+)`));
  if (!meta) errors.push({ at: rel(), code: 'no-verified-line', message: 'missing "verifiedAt: YYYY-MM-DD · verifiedBy: <name>" line' });

  const secs = sections(text);
  for (const s of SECTIONS) if (!secs[s]) errors.push({ at: rel(), code: 'missing-section', message: `missing section "## ${s}"` });

  const stats = { confirmed: 0, inferred: 0, tester: 0, unknown: 0, outdated: 0, untagged: 0, verifiedAt: meta ? meta[1] : null };
  for (const [name, lines] of Object.entries(secs)) {
    if (name === OPEN) continue;
    for (const { line, n } of lines) {
      if (!/^\s*[-*]\s+\S/.test(line)) continue; // facts are bullets
      const m = line.match(TAG);
      if (!m) { stats.untagged++; errors.push({ at: rel(n), code: 'untagged', message: `fact has no confidence tag: "${line.trim().slice(0, 80)}"` }); continue; }
      stats[m[1]]++;
      const bad = checkTag(m[1], m[2], m[3]);
      if (bad) errors.push({ at: rel(n), code: 'bad-tag', message: bad });
    }
  }
  const openItems = (secs[OPEN] || []).filter(({ line }) => /^\s*[-*]\s+\S/.test(line)).length;
  if (stats.unknown && !openItems) errors.push({ at: rel(), code: 'unknown-without-question', message: `${stats.unknown} fact(s) are [unknown] but "${OPEN}" lists no question` });

  text.split(/\r?\n/).forEach((line, i) => {
    for (const s of scanLine(line)) errors.push({ at: rel(i + 1), code: 'secret', message: `credential-looking literal (${s.kind}, len ${s.length}) — never put a secret in team context` });
  });

  const own = opts.ownDomains || [];
  const domains = (opts.registry && opts.registry.domains) || {};
  // Only STRONG markers count here, and naming another product under "Integrations & dependencies" is allowed:
  // a squad may depend on Pay or mention cashback without that being Pay's or Card's knowledge.
  let inDeps = false;
  const lines = text.split(/\r?\n/).map((l) => { if (/^##\s/.test(l)) inDeps = /^##\s+Integrations & dependencies/.test(l); return inDeps ? '' : l; });
  for (const [id, d] of Object.entries(domains)) {
    if (own.includes(id)) continue;
    const res = (d.markers || []).map(compileMarker);
    lines.forEach((line, i) => {
      const hit = res.find((re) => re.test(line));
      if (hit) errors.push({ at: rel(i + 1), code: 'foreign-domain', message: `mentions domain "${id}" (not this team's) — product knowledge of another team does not belong here` });
    });
  }

  const reposFile = path.join(teamDir, 'repos.json');
  if (fs.existsSync(reposFile)) {
    let repos;
    try { repos = JSON.parse(fs.readFileSync(reposFile, 'utf8')); } catch (e) { errors.push({ at: 'repos.json', code: 'repos-json', message: e.message }); }
    if (repos && !Array.isArray(repos)) errors.push({ at: 'repos.json', code: 'repos-json', message: 'must be an array' });
    else for (const [i, r] of (repos || []).entries()) {
      if (!r || !/^[a-z0-9][a-z0-9._-]*$/.test(r.id || '')) errors.push({ at: `repos.json[${i}]`, code: 'repos-json', message: 'id must be a lowercase slug' });
      if (!r || typeof r.url !== 'string' || !r.url) errors.push({ at: `repos.json[${i}]`, code: 'repos-json', message: 'url is required' });
      if (!r || !ROLES.includes(r.role)) errors.push({ at: `repos.json[${i}]`, code: 'repos-json', message: `role must be one of ${ROLES.join('|')}` });
      if (r && r.path) errors.push({ at: `repos.json[${i}]`, code: 'repos-json', message: 'no local paths in repos.json — paths and grants are per person (credentials.local.js → repos)' });
    }
  } else warnings.push({ at: 'repos.json', code: 'no-repos', message: 'no repos.json — repository discovery has nothing to read' });

  return { errors, warnings, stats };
}

/** Lint a domain folder: provenance header on each file, no secrets. */
function lintDomain(domainDir) {
  const errors = [];
  for (const name of fs.existsSync(domainDir) ? fs.readdirSync(domainDir) : []) {
    if (!name.endsWith('.md') || name === 'SKILL.md') continue;
    const text = fs.readFileSync(path.join(domainDir, name), 'utf8');
    const head = text.split(/\r?\n/).slice(0, 12).join('\n');
    if (!/\*\*Provenance:\*\*/.test(head)) errors.push({ at: `${path.basename(domainDir)}/${name}`, code: 'no-provenance', message: 'missing a **Provenance:** line in the header' });
    text.split(/\r?\n/).forEach((line, i) => {
      for (const s of scanLine(line)) errors.push({ at: `${path.basename(domainDir)}/${name}:${i + 1}`, code: 'secret', message: `credential-looking literal (${s.kind}, len ${s.length})` });
    });
  }
  return { errors, warnings: [], stats: null };
}

module.exports = { lintTeamContext, lintDomain, SECTIONS, ROLES };
