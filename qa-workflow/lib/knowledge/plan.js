'use strict';

/**
 * Knowledge plan — the ONE answer to "which product knowledge may this session read?".
 *
 * Inputs: a team profile (teams/<team>.json → domains + surfaces), optionally the story's surfaces and
 * the operator-approved cross-domain reads recorded in qa-state.json. Output: an ordered, de-duplicated
 * file list, each file tagged with its layer and the reason it is included.
 *
 *   core      always (methodology, gates, org-wide standards and app facts)
 *   catalog   always (catalogs of the shared Java framework)
 *   surface   the surface packs for the story's surfaces (∩ the team's surfaces)
 *   domain    the team's domains (+ approved cross-domains), each file filtered by its `surfaces` tag
 *   team      teams/<team>/context.md, the team's onboarding output, when it exists
 *
 * Why: the phase skills used to hardcode `domains: [card, payment]`, so every team's story analysis
 * loaded Card rules. Skills now read this plan (`qa-cli.js knowledge`) instead.
 */

const fs = require('fs');
const path = require('path');
const team = require('../../../automation/config/team');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

class KnowledgePlanError extends Error {
  constructor(message) { super(message); this.name = 'KnowledgePlanError'; }
}

function loadRegistry(file = team.registryFile()) {
  let reg;
  try { reg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new KnowledgePlanError(`cannot read the knowledge registry ${file}: ${e.message}`);
  }
  return { core: reg.core || [], catalogs: reg.catalogs || [], surfacePacks: reg.surfacePacks || {}, domains: reg.domains || {}, file };
}

/** A domain file entry is either "path" or { path, surfaces? }. */
const fileEntry = (f) => (typeof f === 'string' ? { path: f } : f);

/**
 * @param {object} opts
 * @param {string} [opts.teamId]        defaults to the selected team (QA_TEAM / credentials.local.js)
 * @param {object} [opts.profile]       a loaded profile (skips loadTeam)
 * @param {string[]} [opts.storySurfaces] the story's surfaces; defaults to all of the team's
 * @param {object} [opts.crossDomains]  { <domain>: { approvedBy, reason, at } } — operator-approved
 * @param {string} [opts.registryFile]
 * @param {string} [opts.teamsDir]
 * @param {string} [opts.repoRoot]      used to check whether team context exists
 */
function knowledgePlan(opts = {}) {
  const profile = opts.profile || team.loadTeam({ id: opts.teamId, dir: opts.teamsDir });
  const reg = loadRegistry(opts.registryFile);
  const known = Object.keys(reg.domains).sort();
  const domains = team.teamDomains(profile, known);
  const surfaces = team.teamSurfaces(profile);

  const requested = (opts.storySurfaces && opts.storySurfaces.length) ? [...new Set(opts.storySurfaces)] : surfaces;
  const badSurface = requested.filter((s) => !team.SURFACES.includes(s));
  if (badSurface.length) throw new KnowledgePlanError(`unknown story surface(s): ${badSurface.join(', ')} (allowed: ${team.SURFACES.join(', ')})`);
  const storySurfaces = requested.filter((s) => surfaces.includes(s));
  const outsideTeam = requested.filter((s) => !surfaces.includes(s));

  const cross = opts.crossDomains || {};
  const crossIds = Object.keys(cross).filter((d) => !domains.includes(d));
  const unknownCross = crossIds.filter((d) => !known.includes(d));
  if (unknownCross.length) throw new KnowledgePlanError(`approved cross-domain(s) not in the registry: ${unknownCross.join(', ')}`);

  const files = [];
  const seen = new Map();
  const add = (p, layer, reason, extra = {}) => {
    if (seen.has(p)) { seen.get(p).reasons.push(reason); return; }
    const row = { path: p, layer, reason, reasons: [reason], ...extra };
    seen.set(p, row);
    files.push(row);
  };

  for (const p of reg.core) add(p, 'core', 'core — every team');
  for (const p of reg.catalogs) add(p, 'catalog', 'Java framework catalog — every team');
  for (const s of storySurfaces) for (const p of reg.surfacePacks[s] || []) add(p, 'surface', `surface pack: ${s}`);

  const screenDirs = [];
  const loadDomain = (id, reason) => {
    const d = reg.domains[id];
    for (const f of (d.files || []).map(fileEntry)) {
      if (f.surfaces && f.surfaces.length && !f.surfaces.some((s) => storySurfaces.includes(s))) continue;
      add(f.path, 'domain', reason, { domain: id });
    }
    if (d.screens && !screenDirs.includes(d.screens)) screenDirs.push(d.screens);
  };
  for (const id of domains) loadDomain(id, `domain ${id} (team ${profile.id})`);
  for (const id of crossIds) {
    const c = cross[id] || {};
    loadDomain(id, `cross-domain ${id} (approved by ${c.approvedBy || '?'}: ${c.reason || 'no reason recorded'})`);
  }

  const contextRel = path.relative(opts.repoRoot || REPO_ROOT, path.join(team.teamContextDir(profile, opts.teamsDir), 'context.md'));
  const contextAbs = path.join(opts.repoRoot || REPO_ROOT, contextRel);
  const contextExists = fs.existsSync(contextAbs);
  if (contextExists) add(contextRel, 'team', `team context (${profile.id})`);

  const loaded = [...domains, ...crossIds];
  return {
    team: profile.id,
    teamName: profile.name,
    domains,
    crossDomains: crossIds,
    excludedDomains: known.filter((d) => !loaded.includes(d)),
    teamSurfaces: surfaces,
    storySurfaces,
    surfacesOutsideTeam: outsideTeam,
    teamContext: { path: contextRel, exists: contextExists },
    screenDirs,
    files: files.map(({ reasons, ...r }) => (reasons.length > 1 ? { ...r, reason: reasons.join('; ') } : r)),
    registry: path.relative(opts.repoRoot || REPO_ROOT, reg.file),
  };
}

/** Human-readable plan (qa-cli.js knowledge without --json). */
function formatPlan(plan) {
  const out = [];
  out.push(`team ${plan.team} (${plan.teamName}) · domains: ${plan.domains.join(', ') || '(none)'}`
    + (plan.crossDomains.length ? ` · cross-domain: ${plan.crossDomains.join(', ')}` : '')
    + ` · surfaces: ${plan.storySurfaces.join(', ')}`);
  if (plan.surfacesOutsideTeam.length) out.push(`  ! story surface(s) outside the team's: ${plan.surfacesOutsideTeam.join(', ')} — ask the operator before testing them`);
  for (const layer of ['core', 'catalog', 'surface', 'domain', 'team']) {
    const rows = plan.files.filter((f) => f.layer === layer);
    if (!rows.length) continue;
    out.push(`\n  ${layer}:`);
    for (const r of rows) out.push(`    ${r.path}${layer === 'core' || layer === 'catalog' ? '' : `   ← ${r.reason}`}`);
  }
  if (!plan.teamContext.exists) out.push(`\n  team context: ${plan.teamContext.path} — MISSING (run team onboarding: qa-workflow/skills/team-onboarding)`);
  out.push(`\n  NOT loaded (other teams' domains): ${plan.excludedDomains.join(', ') || '—'}`);
  out.push('  Read only these files for product knowledge. A story that needs an excluded domain: ask the operator,'
    + ' then `qa-cli.js cross-domain <storyDir> <domain> --by "<operator>" --reason "<why>"`.');
  return out.join('\n') + '\n';
}

module.exports = { knowledgePlan, formatPlan, loadRegistry, KnowledgePlanError };
