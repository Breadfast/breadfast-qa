'use strict';

/**
 * The `lock` seam, wired.
 *
 * Two of the five staleness rules in docs/ai/architecture/qa-artifact-contract.md §5 were implemented
 * in reconcile.js and unit-tested, but nothing ever supplied their inputs:
 *   rule (d) generator-version — `opts.generators` was never populated, so bumping a skill's
 *            `version:` (ADR-001 §3.3's `lock` seam) invalidated nothing;
 *   rule (e) domain-changed    — reconcile was called with a hardcoded `domains: {}` and the
 *            top-level `state.domains` map was never written, so `domainChanged` always returned false.
 * This module supplies both, by reading the skill/domain frontmatter that already carries the versions.
 *
 * Frontmatter is read with a purpose-built reader, not a YAML library: qa-workflow is
 * dependency-free by design (ADR-001 §3.3), and the shape is fixed by templates/task-skill.template.md.
 */
const fs = require('fs');
const path = require('path');
const { sha256, fileChecksum } = require('./fingerprint');

/** Extract the frontmatter block (between the first two `---` lines), or '' if absent. */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : '';
}

/** Top-level `name:` (skills use it as the generator name). */
function readName(fm) {
  const m = /^name:\s*(.+?)\s*$/m.exec(fm);
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

/** `metadata.version:` — the value the `lock` seam bumps. */
function readVersion(fm) {
  const m = /^\s+version:\s*["']?([0-9]+\.[0-9]+)["']?\s*$/m.exec(fm);
  return m ? m[1] : null;
}

/**
 * `produces.artifacts: [a, b]`.
 * Scoped to the `produces:` block — `consumes:` carries an identically-named key, and matching the
 * first `artifacts:` in the file would silently map every skill to what it READS.
 */
function readProduces(fm) {
  const lines = fm.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s+produces:\s*$/.test(l));
  if (start < 0) return [];
  const indent = /^(\s*)/.exec(lines[start])[1].length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const ind = /^(\s*)/.exec(line)[1].length;
    if (ind <= indent) break;                       // left the produces block
    const m = /^\s+artifacts:\s*\[(.*?)\]\s*$/.exec(line);
    if (m) return m[1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Map each artifact key to the CURRENT generator that produces it: { <artifactKey>: '<skill>@<ver>' }.
 * Feeds reconcile()'s rule (d): a stored generator older than this marks the artifact stale.
 * An artifact no skill claims (execution, qa-summary, clarifications → grill-me) is simply absent,
 * and reconcile skips the rule for it.
 */
function loadGenerators(skillsDir) {
  const out = {};
  let entries = [];
  try { entries = fs.readdirSync(skillsDir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(skillsDir, e.name, 'SKILL.md');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const fm = frontmatter(text);
    const name = readName(fm) || e.name;
    const version = readVersion(fm);
    if (!version) continue;
    for (const key of readProduces(fm)) out[key] = `${name}@${version}`;
  }
  return out;
}

/**
 * Fingerprint each business domain: { <id>: { version, checksum } }.
 * Feeds reconcile()'s rule (e) and the `domains` map in qa-state.json.
 *
 * Per contract §4 the fingerprint is of the **domain skill** — its `version:` plus the sha256 of
 * SKILL.md — not of the `docs/ai/business/**` files it wraps. So editing a business doc invalidates
 * nothing until the domain's `version:` is bumped: that bump IS the lock. `sourcesHash` is reported
 * alongside (never stored) so `status` can point out when the wrapped docs moved and the version did not.
 */
function loadDomains(domainsDir, repoRoot) {
  const out = {};
  let entries = [];
  try { entries = fs.readdirSync(domainsDir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(domainsDir, e.name, 'SKILL.md');
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const fm = frontmatter(text);
    const version = readVersion(fm);
    if (!version) continue;
    const rec = { version, checksum: sha256(text) };
    const sources = readSources(fm);
    if (sources.length && repoRoot) {
      const hashes = sources.map((s) => fileChecksum(path.join(repoRoot, s))).filter(Boolean).sort();
      if (hashes.length) rec.sourcesHash = hashes.length === 1 ? hashes[0] : sha256(hashes.join(''));
    }
    out[readName(fm) || e.name] = rec;
  }
  return out;
}

/** `metadata.sources: [a, b]` on a domain knowledge skill. */
function readSources(fm) {
  const m = /^\s+sources:\s*\[(.*?)\]\s*$/m.exec(fm);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** The subset of `all` the artifact declares — what gets written into state.domains. */
function pickDomains(all, ids) {
  const out = {};
  for (const id of ids || []) if (all[id]) out[id] = { version: all[id].version, checksum: all[id].checksum };
  return out;
}

module.exports = { loadGenerators, loadDomains, pickDomains, frontmatter, readName, readVersion, readProduces, readSources };
