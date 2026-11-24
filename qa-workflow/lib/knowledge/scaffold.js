'use strict';

/**
 * Scaffolding so ANY squad bootstraps the same way — no hand-edited JSON, no forgotten registry entry.
 *
 *   initTeam(id, opts)     teams/<id>.json with the org-wide values filled in (Jira B10 + bug type 10084 —
 *                          operator decision D-15) and everything squad-specific either from opts or TODO.
 *   initDomain(id, opts)   qa-workflow/domains/<id>/ (SKILL.md with a version, so `record` accepts the domain;
 *                          a provenance-headed business-rules.md) + its entry in knowledge.json + the owner
 *                          team's `domains`.
 *
 * Both refuse to overwrite. Paths honour QA_TEAMS_DIR / QA_KNOWLEDGE_REGISTRY like the rest of the tooling.
 */

const fs = require('fs');
const path = require('path');
const team = require('../../../automation/config/team');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ID = /^[a-z0-9][a-z0-9-]*$/;
const ORG = { projectKey: 'B10', bugIssueTypeId: '10084', labels: ['ai-created', 'qa-found'], environment: 'Egypt' };

class ScaffoldError extends Error { constructor(m) { super(m); this.name = 'ScaffoldError'; } }

const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const orTodo = (v) => (list(v).length ? list(v) : ['TODO']);

/** Serialise the registry in its hand-maintained style: arrays of scalars and file objects stay on one line. */
function formatJson(value, indent = '') {
  const next = indent + '  ';
  const inline = (v) => JSON.stringify(v).replace(/^\{"/, '{ "').replace(/"\}$/, '" }').replace(/\],"/g, '], "')
    .replace(/","/g, '", "').replace(/":"/g, '": "').replace(/":\[/g, '": [').replace(/":(\d)/g, '": $1').replace(/\]\}$/, '] }');
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((x) => x === null || typeof x !== 'object')) {
      const one = '[' + value.map((x) => JSON.stringify(x)).join(', ') + ']';
      return one.length <= 110 ? one : '[\n' + value.map((x) => next + JSON.stringify(x)).join(',\n') + '\n' + indent + ']';
    }
    if (value.every((x) => x && typeof x === 'object' && !Array.isArray(x) && Object.values(x).every((y) => y === null || typeof y !== 'object' || Array.isArray(y)))) {
      return '[\n' + value.map((x) => next + inline(x)).join(',\n') + '\n' + indent + ']';
    }
    return '[\n' + value.map((x) => next + formatJson(x, next)).join(',\n') + '\n' + indent + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return '{\n' + keys.map((k) => `${next}${JSON.stringify(k)}: ${formatJson(value[k], next)}`).join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}

function initTeam(id, opts = {}) {
  if (!ID.test(id || '')) throw new ScaffoldError(`team id "${id}" must be lowercase letters, digits and hyphens (e.g. growth, shopping)`);
  const dir = opts.teamsDir || team.teamsDir();
  const file = path.join(dir, `${id}.json`);
  if (fs.existsSync(file)) throw new ScaffoldError(`teams/${id}.json already exists — edit it instead`);
  const surfaces = list(opts.surfaces);
  const bad = surfaces.filter((s) => !team.SURFACES.includes(s));
  if (bad.length) throw new ScaffoldError(`unknown surface(s): ${bad.join(', ')} (allowed: ${team.SURFACES.join(', ')})`);
  const domains = list(opts.domains);
  const known = team.knownDomains();
  const unknown = domains.filter((d) => !known.includes(d));
  if (unknown.length) throw new ScaffoldError(`unknown domain(s): ${unknown.join(', ')} (known: ${known.join(', ')}). Create yours with domain-init after the team exists.`);
  const profile = {
    _doc: `Team ${opts.name || id}. Created with \`qa-cli.js team-init\`. Jira project and bug type are org-wide (every squad files in B10 — D-15). Replace any TODO; see teams/_template.json for where each value comes from. Commit this file so your squad shares it.`,
    id,
    name: opts.name || id,
    jira: {
      projectKey: ORG.projectKey,
      bugIssueTypeId: ORG.bugIssueTypeId,
      bug: {
        web: { squad: orTodo(opts.webSquad), components: orTodo(opts.webComponents) },
        mobile: { squad: orTodo(opts.mobileSquad), components: orTodo(opts.mobileComponents) },
        labels: ORG.labels,
        environment: ORG.environment,
      },
    },
    browserstack: {
      project: opts.bsProject || 'TODO',
      numericProject: opts.bsNumericProject || 'TODO',
      suiteFolder: opts.bsFolder ? (/^\d+$/.test(String(opts.bsFolder)) ? Number(opts.bsFolder) : opts.bsFolder) : 'TODO',
    },
    surfaces: surfaces.length ? surfaces : ['TODO'],
    domains,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, formatJson(profile) + '\n');
  return { file, profile, todo: team.unfilledPaths(profile) };
}

function initDomain(id, opts = {}) {
  if (!ID.test(id || '')) throw new ScaffoldError(`domain id "${id}" must be lowercase letters, digits and hyphens`);
  if (!opts.owner) throw new ScaffoldError('--owner <team> is required (the squad that maintains this domain)');
  const owner = team.loadTeam({ id: opts.owner, dir: opts.teamsDir }); // throws on an unknown team
  const registryFile = opts.registryFile || team.registryFile();
  const reg = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  if (reg.domains && reg.domains[id]) throw new ScaffoldError(`domain "${id}" is already registered (owner: ${reg.domains[id].owner})`);
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const rel = `qa-workflow/domains/${id}`;
  const dir = path.join(repoRoot, rel);
  if (fs.existsSync(dir)) throw new ScaffoldError(`${rel}/ already exists`);
  const description = opts.description || `${owner.name} product knowledge`;
  const markers = list(opts.markers);
  const terms = list(opts.terms);
  for (const m of [...markers, ...terms]) {
    try { new RegExp(m.startsWith('(?i)') ? m.slice(4) : m); } catch (e) { throw new ScaffoldError(`marker/term "${m}" is not a valid regex: ${e.message}`); }
  }
  const today = (opts.today || new Date().toISOString()).slice(0, 10);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---
name: ${id}
description: ${description}
metadata:
  type: knowledge
  version: 1.0
  sources: [${rel}/business-rules.md]
---

# ${id} (domain knowledge)

Owner: \`${owner.id}\`. Files are listed in \`qa-workflow/registry/knowledge.json\` and reach a session only through
its knowledge plan (\`qa-cli.js knowledge\`). This SKILL.md is the domain's **freshness lock**: bump \`version\` when
the domain's rules change, so artifacts that consumed the old rules are re-checked.
`);
  fs.writeFileSync(path.join(dir, 'business-rules.md'), `# ${owner.name} — business rules

> **Domain \`${id}\`** · owner \`${owner.id}\` · loaded only through \`qa-cli.js knowledge\`.
> **Provenance:** created by \`qa-cli.js domain-init\` on ${today}; facts are added by team onboarding and by
> operator-approved knowledge proposals. Tag every fact: \`[confirmed: <src>; <date>]\` · \`[inferred: …]\` ·
> \`[tester: <name>; <date>]\` · \`[unknown]\` · \`[outdated: …]\`. No secrets.

## Business rules
`);

  reg.domains = reg.domains || {};
  reg.domains[id] = { owner: owner.id, description, files: [{ path: `${rel}/business-rules.md` }], markers, terms };
  fs.writeFileSync(registryFile, formatJson(reg) + '\n');

  let addedToTeam = false;
  if (opts.addToTeam !== false) {
    const teamFile = owner.file;
    const text = fs.readFileSync(teamFile, 'utf8');
    const m = text.match(/"domains"\s*:\s*\[([^\]]*)\]/);
    if (m) {
      const cur = JSON.parse(`[${m[1]}]`);
      if (!cur.includes(id)) {
        fs.writeFileSync(teamFile, text.replace(m[0], `"domains": ${JSON.stringify([...cur, id]).replace(/","/g, '", "')}`));
        addedToTeam = true;
      }
    }
  }
  return { dir, registryFile, addedToTeam, entry: reg.domains[id] };
}

module.exports = { initTeam, initDomain, formatJson, ScaffoldError };
