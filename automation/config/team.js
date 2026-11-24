'use strict';

/**
 * Team profile loader — the ONE place scripts get team-specific values (Jira project, bug squad and
 * components, BrowserStack project and folder). See teams/README.md.
 *
 * Why it exists: the process was written by one squad and its values were hard-coded (project B10,
 * BrowserStack PR-5, squad "Card Core"). Another team cloning the repo silently got card values.
 * Now every team-specific value comes from teams/<team>.json, and there is NO fallback: no team
 * selected, or a value still reading TODO, is an error that names the field.
 *
 * Selection, first match wins:
 *   1. env QA_TEAM
 *   2. `team` in automation/config/credentials.local.js (gitignored)
 * env QA_TEAMS_DIR overrides the profile directory (used by tests).
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'teams');
const UNFILLED = 'TODO';
const DEFAULT_LABELS = ['ai-created', 'qa-found'];
const DEFAULT_ENVIRONMENT = 'Egypt';
/** Any Jira issue key: PROJECT-123. */
const ANY_ISSUE_KEY = /[A-Z][A-Z0-9]+-\d+/;

class TeamProfileError extends Error {
  constructor(message) { super(message); this.name = 'TeamProfileError'; }
}

function localConfig() {
  try { return require('./credentials.local'); } catch (_) { return {}; }
}

function teamsDir() {
  return process.env.QA_TEAMS_DIR || DEFAULT_DIR;
}

/** Team ids that have a profile file (the template is excluded). */
function availableTeams(dir = teamsDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/**
 * The selected team id, or null when none is selected.
 * @param {object} [local] the credentials.local.js exports (injectable for tests)
 */
function selectedTeamId(local = localConfig()) {
  const fromEnv = process.env.QA_TEAM;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const fromLocal = (local || {}).team;
  if (fromLocal && String(fromLocal).trim() && fromLocal !== UNFILLED) return String(fromLocal).trim();
  return null;
}

function howToChoose(dir) {
  const teams = availableTeams(dir);
  return [
    `  Teams with a profile: ${teams.length ? teams.join(', ') : '(none)'}`,
    "  Choose yours once: add  team: '<id>'  to automation/config/credentials.local.js, or set QA_TEAM=<id>.",
    '  New team: copy teams/_template.json to teams/<id>.json, fill in every TODO, and commit it (teams/README.md).',
  ].join('\n');
}

/** Dotted paths of every value still reading TODO. Keys starting with "_" are documentation. */
function unfilledPaths(value, prefix = '') {
  if (value === UNFILLED) return [prefix];
  if (Array.isArray(value)) return value.includes(UNFILLED) ? [prefix] : [];
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([k]) => !k.startsWith('_'))
      .flatMap(([k, v]) => unfilledPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

/**
 * Load the selected (or given) team's profile.
 * @param {{id?: string, dir?: string, local?: object}} [opts]
 * @returns {object} the profile, plus `file` (its path)
 */
function loadTeam(opts = {}) {
  const dir = opts.dir || teamsDir();
  const id = opts.id || selectedTeamId(opts.local);
  if (!id) throw new TeamProfileError(`No QA team selected.\n${howToChoose(dir)}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new TeamProfileError(`Team id "${id}" is not valid — use lowercase letters, digits and hyphens.\n${howToChoose(dir)}`);
  }
  const file = path.join(dir, `${id}.json`);
  if (!fs.existsSync(file)) throw new TeamProfileError(`Unknown QA team "${id}" — there is no teams/${id}.json.\n${howToChoose(dir)}`);
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new TeamProfileError(`teams/${id}.json is not valid JSON: ${e.message}`);
  }
  return { ...profile, id: profile.id && profile.id !== UNFILLED ? profile.id : id, file };
}

/** The value at a dotted path; throws when it is missing, empty or still TODO. */
function teamValue(profile, dotted) {
  const value = dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), profile);
  const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
  if (empty || unfilledPaths(value).length) {
    throw new TeamProfileError(`teams/${profile.id}.json: "${dotted}" is not filled in yet. `
      + 'Get the value from your squad lead, put it in the file, and commit it so your teammates get it too '
      + '(teams/_template.json explains each field).');
  }
  return value;
}

/** web and backend-only bugs use the web values; every mobile combo uses the mobile values. */
function surfaceForCombo(combo) {
  return combo === 'web' || combo === 'be' ? 'web' : 'mobile';
}

/**
 * Bug-filing values for a combo. Values the spec already carries win; the rest come from the profile.
 * Throws TeamProfileError naming the first value that is needed but not filled in.
 */
function bugDefaults(profile, spec = {}) {
  const surface = surfaceForCombo(spec.combo);
  const bug = profile.jira?.bug || {};
  const has = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length);
  /** First of the given values that is present, else the fallback. */
  const firstOf = (fallback, ...values) => values.find(has) ?? fallback;
  return {
    projectKey: teamValue(profile, 'jira.projectKey'),
    issueTypeId: String(teamValue(profile, 'jira.bugIssueTypeId')),
    squad: has(spec.squad) ? spec.squad : teamValue(profile, `jira.bug.${surface}.squad`),
    components: has(spec.components) ? spec.components : teamValue(profile, `jira.bug.${surface}.components`),
    labels: firstOf(DEFAULT_LABELS, spec.labels, bug.labels),
    environment: firstOf(DEFAULT_ENVIRONMENT, spec.environment, bug.environment),
  };
}

/**
 * The BrowserStack Test Management project identifier (PR-<n>): the explicit value when one is given
 * (a --project flag, a plan's `project`), otherwise the selected team's. Throws TeamProfileError when
 * neither exists — there is no default project.
 */
function resolveBrowserstackProject(explicit, opts) {
  if (explicit && explicit !== UNFILLED) return explicit;
  return teamValue(loadTeam(opts), 'browserstack.project');
}

/** The pattern a story key must match: the team's project when it is filled in, otherwise any Jira key. */
function storyKeyPattern(profile) {
  const key = profile && profile.jira && profile.jira.projectKey;
  if (key && key !== UNFILLED && /^[A-Z][A-Z0-9]+$/.test(key)) return new RegExp(`${key}-\\d+`);
  return ANY_ISSUE_KEY;
}

// ── Knowledge selection: which product knowledge this team's sessions may load ────────────────
// `domains` and `surfaces` were collected in every profile but read by nothing, so every team's
// story-analysis loaded the card/payment rules. They now drive qa-cli.js `knowledge` (the plan),
// `record` (domain defaults + guard) and the doctor. See qa-workflow/registry/knowledge.json.

const SURFACES = ['web', 'mobile', 'backend'];

function registryFile() {
  return process.env.QA_KNOWLEDGE_REGISTRY
    || path.join(__dirname, '..', '..', 'qa-workflow', 'registry', 'knowledge.json');
}

/** Domain ids the knowledge registry knows. */
function knownDomains(file = registryFile()) {
  try { return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).domains || {}).sort(); } catch (_) { return []; }
}

/**
 * The team's domains, validated against the registry. `[]` is valid: core knowledge + team context only.
 * Throws TeamProfileError when the field is missing, TODO, or names a domain the registry doesn't have.
 */
function teamDomains(profile, known = knownDomains()) {
  const v = profile.domains;
  const where = `teams/${profile.id}.json: "domains"`;
  if (!Array.isArray(v)) throw new TeamProfileError(`${where} must be a list of domain ids (use [] for none). Known: ${known.join(', ') || '(none)'}`);
  if (v.includes(UNFILLED)) throw new TeamProfileError(`${where} is not filled in yet. Known domains: ${known.join(', ') || '(none)'} — or [] and let team onboarding create yours.`);
  const unknown = v.filter((d) => !known.includes(d));
  if (unknown.length) throw new TeamProfileError(`${where} names unknown domain(s): ${unknown.join(', ')}. Known: ${known.join(', ') || '(none)'} (qa-workflow/registry/knowledge.json).`);
  return [...new Set(v)];
}

/** The team's surfaces (web | mobile | backend), at least one. Throws TeamProfileError otherwise. */
function teamSurfaces(profile) {
  const v = profile.surfaces;
  const where = `teams/${profile.id}.json: "surfaces"`;
  if (!Array.isArray(v) || !v.length) throw new TeamProfileError(`${where} must list at least one of: ${SURFACES.join(', ')}`);
  if (v.includes(UNFILLED)) throw new TeamProfileError(`${where} is not filled in yet (any of: ${SURFACES.join(', ')}).`);
  const bad = v.filter((s) => !SURFACES.includes(s));
  if (bad.length) throw new TeamProfileError(`${where} has unknown value(s): ${bad.join(', ')} (allowed: ${SURFACES.join(', ')}).`);
  return [...new Set(v)];
}

/** The folder holding the team's onboarding output (context.md, repos.json). It may not exist yet. */
function teamContextDir(profile, dir = teamsDir()) {
  return path.join(dir, profile.id);
}

/** Same as loadTeam, but returns null instead of throwing when no team is selected or it can't be read. */
function tryLoadTeam(opts) {
  try {
    return loadTeam(opts);
  } catch (e) {
    if (e instanceof TeamProfileError) return null;
    throw e;
  }
}

module.exports = {
  ANY_ISSUE_KEY,
  SURFACES,
  TeamProfileError,
  UNFILLED,
  availableTeams,
  bugDefaults,
  knownDomains,
  loadTeam,
  registryFile,
  resolveBrowserstackProject,
  selectedTeamId,
  storyKeyPattern,
  surfaceForCombo,
  teamContextDir,
  teamDomains,
  teamSurfaces,
  teamValue,
  teamsDir,
  tryLoadTeam,
  unfilledPaths,
};
