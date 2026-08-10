#!/usr/bin/env node
'use strict';

/**
 * qa-cli — the concrete qa-state operations the workflows invoke.
 * Thin wrapper over lib/ so agent-followed workflow steps are deterministic & testable.
 *
 * Usage:
 *   node qa-workflow/bin/qa-cli.js init <storyDir> <TICKET>
 *   node qa-workflow/bin/qa-cli.js fingerprint-jira <storyDir>            # issue JSON on stdin
 *   node qa-workflow/bin/qa-cli.js fingerprint-figma <storyDir> --file <key> --nodes 1:1,1:2 [--version v] [--frames <sha256>] [--last <iso>]
 *   node qa-workflow/bin/qa-cli.js checksum <file>
 *   node qa-workflow/bin/qa-cli.js branch-check <storyDir> [TICKET] [--repos a,b] [--year 2026]
 *          # STEP 0 gate: assert BOTH repos are on <year>/sprintQ<n>.<n>/<ticket>-<slug>. Exit 1 otherwise.
 *          #   The git hooks validate the branch NAME on push only, so they cannot catch "no branch was
 *          #   ever created" — the B10-56717 failure, where both repos stayed on the PREVIOUS story.
 *   node qa-workflow/bin/qa-cli.js complete-check <storyDir> [--profile shift-left|validate|full] [--expect a,b,...]
 *          # COMPLETION gate: exit 1 while any required artifact is missing or not "complete" and has no
 *          #   recorded operator deferral. `show` always exits 0, so it can never fail a run.
 *          #   --profile shift-left = the pre-development set (…hls, testcases, testcase-review,
 *          #   browserstack-import); validate/full = that set + automation…qa-summary. Default: full.
 *          #   Also fails when an APPROVED artifact drifted with no recorded testcase-reconciliation.
 *   node qa-workflow/bin/qa-cli.js approve <storyDir> <key> --by "<operator>" [--note "<note>"]
 *          # Records an operator approval and snapshots the artifact (<name>.approved<ext>). Required
 *          #   before `browserstack-import` can be recorded: only approved test cases are imported.
 *   node qa-workflow/bin/qa-cli.js defer <storyDir> <key> --by "<operator>" --reason "<why>"
 *          # The ONLY way past the phase dependency, the approval gate and complete-check.
 *          #   A deferral must have a name on it.
 *   node qa-workflow/bin/qa-cli.js skip <storyDir> <key> --by "<operator>" --reason "<why>"
 *          # Records that a CONDITIONAL phase (exploratory-notes, testcase-reconciliation) was
 *          #   deliberately not needed — so "decided against" never looks like "never considered".
 *   node qa-workflow/bin/qa-cli.js status <storyDir> [--profile shift-left|validate|full] [--json]
 *          # Where is this story? Per-artifact state, approvals, conditional phases, the NEXT phase and
 *          #   what blocks it, and any artifact whose generator predates the current methodology.
 *          #   Always exits 0 — it reports, it does not gate.
 *   node qa-workflow/bin/qa-cli.js testcase-lint <storyDir|csv> [--acs AC-1,AC-2] [--acs-from <file>]
 *          [--require-screens] [--new] [--json]
 *          # The mechanical half of the review gate: canonical 24-column format, one row per step,
 *          #   every step has an Expected Result, no duplicate titles/step-sequences, valid
 *          #   Priority/Type/Automation-Status vocabulary, `ac:` traceability tags and AC coverage.
 *          #   EXITS 1 on any error — so those checks are a gate, not a self-assessment.
 *   node qa-workflow/bin/qa-cli.js record <storyDir> <key> --path <rel> --generator <name@x.y>
 *          [--derive-sources jira,figma] [--derive-artifacts requirements,...] [--domains card,...] [--status complete]
 *   node qa-workflow/bin/qa-cli.js reconcile <storyDir> [--figma-file K --figma-nodes 1:1 --figma-version v]
 *          [--immaterial] [--apply-modified] [--expected requirements,figma-analysis,...]   # live jira issue JSON on stdin (optional)
 *          # Default set = the 8-key shift-left baseline (requirements → browserstack-import) plus any
 *          #   conditional artifact this story produced (exploratory-notes, testcase-reconciliation).
 *   node qa-workflow/bin/qa-cli.js show <storyDir>
 *   node qa-workflow/bin/qa-cli.js visual-compare [--in <file>]
 *          # input JSON on stdin/--in: { expected:Screen[], actual:Screen[], ctx? }
 *          #   OR { figmaFrames:[], dumps:[] (parsed) | rawDumps:[{screenId,raw}] (a11y/Appium-XML), ctx? }
 *          # runs the DETERMINISTIC Conformance pipeline (L1 pair → L2/L5 …) and prints findings+health.
 *          # This is the operator-skill bridge (ADR-003 §3.4): deterministic-first; the caller runs the LLM only on the residual/gaps.
 *   node qa-workflow/bin/qa-cli.js visual-evaluate [--in <file>] [--judge claude] [--figma-url <url>] [--model <m>]
 *          # FULL flow → evaluateStory: (optional `useRegistry` → figma-resolve(--figma-url) → build expected) + actual, then
 *          #   deterministic L1–L7, then the L8 residual runner. `--judge claude` runs ClaudeJudge on the residual ONLY
 *          #   (default: deterministic-only, no AI). Input adds `useRegistry`, `figmaUrl`, `nodeIdByFrameName`, `figmaByNode`,
 *          #   `platforms`, `locales` to the visual-compare shapes.
 *   node qa-workflow/bin/qa-cli.js figma-export --url <figmaUrl> (--story <dir> | --out <dir>) [--scale 2] [--page <name>] [--nodes a:b,c:d] [--name <base>]
 *          # STEP 2 one-liner: REST export (scale=2) of the story's Figma frames → PNGs. --url derives fileKey+node
 *          #   (a FRAME exports as-is; a SECTION explodes into child frames). Prints a manifest + framesHash; with
 *          #   --story it also writes sources.figma (fileKey/nodeIds/framesHash) into qa-state.json. Token: FIGMA_API_TOKEN or automation/config/figma.js.
 *
 * Jira issue JSON (stdin for fingerprint-jira / reconcile):
 *   { "updated": "<iso>", "summary": "...", "description": "...", "ac": "...", "comments": [ {"id":1,"body":"..."} ] }
 */

const fs = require('fs');
const path = require('path');
const qs = require('../lib/qa-state');
const { fingerprintJira, fingerprintFigma, fileChecksum } = require('../lib/freshness/fingerprint');
const { reconcile } = require('../lib/freshness/reconcile');
const { loadGenerators, loadDomains, pickDomains } = require('../lib/freshness/generators');

const QA_ROOT = path.join(__dirname, '..');            // qa-workflow/
const REPO_ROOT = path.join(QA_ROOT, '..');            // the companion repo
const currentGenerators = () => loadGenerators(path.join(QA_ROOT, 'skills'));
const currentDomains = () => loadDomains(path.join(QA_ROOT, 'domains'), REPO_ROOT);

function parseFlags(argv) {
  const flags = {}; const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true; flags[k] = v; }
    else positional.push(a);
  }
  return { flags, positional };
}
const csv = (v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
function die(msg) { process.stderr.write('qa-cli: ' + msg + '\n'); process.exit(2); }

// --- Run-integrity constants (added 2026-07-29, root cause analysis of B10-56717) --------------
/**
 * A phase that may not be recorded until its upstream phase is genuinely finished.
 *   execution ← automation            (2026-07-29) — automation is phase 4, execution phase 5.
 *   browserstack-import ← testcase-review (2026-08-09) — the mandatory test-case review gate:
 *     un-reviewed cases must not reach the test-management system.
 */
const PHASE_DEPS = { execution: 'automation', 'browserstack-import': 'testcase-review' };
/**
 * A phase that additionally requires a RECORDED OPERATOR APPROVAL of another artifact.
 * Reviewing is something this agent can do; approving is not — that is the whole point of the gate.
 * Satisfied by `approve`, or by a recorded `defer` of the reviewing artifact (same escape hatch,
 * same requirement that a name is attached).
 */
const APPROVAL_DEPS = { 'browserstack-import': { artifact: 'testcases', viaDeferralOf: 'testcase-review' } };
/** Completion profiles — the artifact set a finished run of each workflow must contain. */
const PROFILES = {
  // Workflow 1 now owns coverage definition end-to-end: cases, their review gate, and the import.
  'shift-left': [
    'requirements', 'figma-analysis', 'clarifications', 'impact', 'hls',
    'testcases', 'testcase-review', 'browserstack-import',
  ],
  validate: [
    'requirements', 'figma-analysis', 'clarifications', 'impact', 'hls',
    'testcases', 'testcase-review', 'browserstack-import',
    'automation', 'execution', 'visual-findings', 'defects', 'qa-summary',
  ],
};
PROFILES.full = PROFILES.validate;
/** The artifact set a finished post-development run must contain (default profile). */
const REQUIRED_ARTIFACTS = PROFILES.full;

/** Current git branch of a repo, or null. Kept dependency-free — no git library, no shell string building. */
function gitBranch(repo) {
  try {
    const out = require('child_process').execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const b = out.trim();
    return b && b !== 'HEAD' ? b : null;
  } catch { return null; }
}

/** The Java framework path, via the same loader the rest of the companion uses. */
function frameworkPath() {
  try { return require('../../automation/config/framework.js').resolve(); } catch { return null; }
}
function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }
function loadOrInit(dir, ticket) { return qs.load(dir) || qs.newState(ticket || 'B10-0'); }

/** Inspect a Figma node (name/type/direct frame-children) so export scopes correctly (FRAME vs SECTION). */
async function figmaInspectNode(token, fileKey, id) {
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(id)}&depth=1`;
  const res = await fetch(url, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(25000) });
  if (res.status !== 200) throw new Error(`Figma node inspect HTTP ${res.status}`);
  const data = await res.json();
  const doc = data.nodes && data.nodes[id] && data.nodes[id].document;
  if (!doc) throw new Error(`Figma node not found: ${id}`);
  const children = (doc.children || [])
    .filter((n) => ['FRAME', 'SECTION', 'COMPONENT', 'INSTANCE', 'GROUP'].includes(n.type))
    .map((n) => ({ id: n.id, name: n.name, type: n.type }));
  return { name: doc.name, type: doc.type, children };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseFlags(rest);

  switch (cmd) {
    case 'init': {
      const [dir, ticket] = positional;
      if (!dir || !ticket) die('init <storyDir> <TICKET>');
      fs.mkdirSync(dir, { recursive: true });
      const state = qs.load(dir) || qs.newState(ticket);
      state.ticket = ticket;
      // Skeleton is intentionally incomplete (no jira fingerprint yet) — becomes valid after fingerprint-jira.
      const file = qs.save(dir, state, { validate: false });
      process.stdout.write(file + '\n');
      break;
    }
    case 'fingerprint-jira': {
      const [dir] = positional;
      if (!dir) die('fingerprint-jira <storyDir>  (issue JSON on stdin)');
      const issue = JSON.parse(readStdin() || '{}');
      const fp = fingerprintJira(issue);
      const state = loadOrInit(dir);
      state.sources = state.sources || {};
      state.sources.jira = fp;
      qs.save(dir, state);
      process.stdout.write(JSON.stringify(fp) + '\n');
      break;
    }
    case 'fingerprint-figma': {
      const [dir] = positional;
      if (!dir || !flags.file) die('fingerprint-figma <storyDir> --file <key> [--nodes ..] [--version ..] [--frames ..] [--last ..]');
      const figma = {
        fileKey: flags.file,
        nodeIds: csv(flags.nodes),
        version: flags.version || undefined,
        lastModified: flags.last || undefined,
        framesHash: flags.frames || undefined,
      };
      const state = loadOrInit(dir);
      state.sources = state.sources || { jira: null };
      state.sources.figma = figma;
      qs.save(dir, state, { validate: false }); // jira may not be set yet during authoring
      process.stdout.write(fingerprintFigma(figma) + '\n');
      break;
    }
    case 'checksum': {
      const [file] = positional;
      if (!file) die('checksum <file>');
      const c = fileChecksum(file);
      if (!c) die('cannot read ' + file);
      process.stdout.write(c + '\n');
      break;
    }
    case 'record': {
      const [dir, key] = positional;
      if (!dir || !key || !flags.path || !flags.generator) die('record <storyDir> <key> --path <rel> --generator <name@x.y> [..]');
      const state = loadOrInit(dir);
      const derivedFrom = {};
      for (const s of csv(flags['derive-sources'])) {
        if (s === 'jira' && state.sources && state.sources.jira) derivedFrom.jira = state.sources.jira.hash;
        else if (s === 'figma' && state.sources && state.sources.figma) derivedFrom.figma = fingerprintFigma(state.sources.figma);
        else die('cannot derive from source "' + s + '" (fingerprint it first)');
      }
      for (const a of csv(flags['derive-artifacts'])) {
        const up = state.artifacts && state.artifacts[a];
        if (!up || !up.checksum) die('cannot derive from artifact "' + a + '" (record it first)');
        derivedFrom[a] = up.checksum;
      }
      const checksum = fileChecksum(path.join(dir, flags.path));
      if (!checksum) die('artifact file not found: ' + flags.path);
      const record = {
        path: flags.path,
        status: flags.status || 'complete',
        generatedAt: new Date().toISOString(),
        generator: flags.generator,
        derivedFrom,
        checksum,
      };
      const domains = csv(flags.domains);
      if (domains.length) {
        record.domains = domains;
        // Rule (e) compares the artifact's declared domains against the TOP-LEVEL fingerprint map, so
        // the map has to be written here — without it `domainChanged` sees no stored side and always
        // returns false, which is how a business-rule change quietly invalidated nothing.
        const known = currentDomains();
        const unknown = domains.filter((d) => !known[d]);
        if (unknown.length) die(`unknown domain(s): ${unknown.join(', ')} (expected one of: ${Object.keys(known).join(', ') || 'none found'})`);
        state.domains = { ...(state.domains || {}), ...pickDomains(known, domains) };
      }

      // ---- HARD PHASE DEPENDENCY (added 2026-07-29 after B10-56717) --------------------------
      // `automation-gen` is phase 4 and `execution` is phase 5, but nothing stopped execution from
      // being recorded while automation was still missing or `partial`. On B10-56717 the phases were
      // run out of order and automation ended up never generated at all — no test class, no page
      // objects, and not even a story branch — while every other artifact reported `complete`.
      // Recording `execution` now requires automation to be `complete`, or an explicit, recorded
      // operator deferral (`--automation-deferred-by "<who>: <reason>"`).
      for (const [k, dep] of Object.entries(PHASE_DEPS)) {
        if (key !== k) continue;
        const upstream = state.artifacts && state.artifacts[dep];
        const deferral = state.deferrals && state.deferrals[dep];
        if (deferral) continue;
        if (!upstream) die(`cannot record "${k}": "${dep}" has not been recorded yet (phase order), and no operator deferral exists.\n     -> generate it, or record the deferral: qa-cli.js defer <storyDir> ${dep} --by "<operator>" --reason "<reason>"`);
        if (upstream.status !== 'complete') die(`cannot record "${k}": "${dep}" is "${upstream.status}", not "complete", and no operator deferral exists.\n     -> finish it, or record the deferral: qa-cli.js defer <storyDir> ${dep} --by "<operator>" --reason "<reason>"`);
      }

      // ---- APPROVAL GATE (added 2026-08-09 with the shift-left test-case move) -----------------
      // Test cases are generated pre-development and reviewed against a checklist — but only an
      // OPERATOR approves them, and only approved cases are imported. Reviewing and approving cannot
      // be the same act by the same actor, or the gate is decorative (cf. B10-56717's self-granted
      // "or deferred with reason").
      const approvalDep = APPROVAL_DEPS[key];
      if (approvalDep) {
        const approved = state.approvals && state.approvals[approvalDep.artifact];
        const deferred = state.deferrals && state.deferrals[approvalDep.viaDeferralOf];
        if (!approved && !deferred) {
          die(`cannot record "${key}": "${approvalDep.artifact}" have not been approved by an operator.\n` +
              `     -> approve them:  qa-cli.js approve <storyDir> ${approvalDep.artifact} --by "<operator>"\n` +
              `     -> or record a deferral of the gate:  qa-cli.js defer <storyDir> ${approvalDep.viaDeferralOf} --by "<operator>" --reason "<why>"`);
        }
      }

      qs.setArtifact(state, key, record);
      qs.save(dir, state);
      process.stdout.write(JSON.stringify({ key, ...record }, null, 2) + '\n');
      break;
    }
    case 'defer': {
      // Record an OPERATOR-APPROVED deferral of a phase. This is the only way past PHASE_DEPS and the
      // only thing `complete-check` accepts in place of a `complete` artifact. It exists so a deferral
      // is a decision with a name attached, not a silent self-exemption — the failure on B10-56717,
      // where CLAUDE.md §5's "(or deferred with reason)" was invoked without ever asking the operator.
      const [dir, key] = positional;
      if (!dir || !key || !flags.by || !flags.reason) die('defer <storyDir> <key> --by "<operator>" --reason "<why>"');
      const state = loadOrInit(dir);
      state.deferrals = state.deferrals || {};
      state.deferrals[key] = { approvedBy: String(flags.by), reason: String(flags.reason), at: new Date().toISOString() };
      qs.save(dir, state);
      process.stdout.write(JSON.stringify({ deferred: key, ...state.deferrals[key] }, null, 2) + '\n');
      break;
    }
    case 'approve': {
      // Record an OPERATOR APPROVAL of an artifact and SNAPSHOT it, so the approved version survives
      // whatever validation does to the living file. Added 2026-08-09 with the shift-left test-case
      // move: Workflow 2 may add/update/remove cases, and "should not silently overwrite the original
      // baseline" needs a mechanism, not a promise. The snapshot + checksum is that mechanism —
      // `complete-check` fails a run whose approved artifact drifted with no reconciliation log.
      const [dir, key] = positional;
      if (!dir || !key || !flags.by) die('approve <storyDir> <key> --by "<operator>" [--note "<note>"]');
      const state = loadOrInit(dir);
      const rec = state.artifacts && state.artifacts[key];
      if (!rec) die(`cannot approve "${key}": it has not been recorded yet.`);
      if (rec.status !== 'complete' && rec.status !== 'modified') die(`cannot approve "${key}": status is "${rec.status}".`);

      const src = path.join(dir, rec.path);
      const ext = path.extname(rec.path);
      const snapshotRel = rec.path.slice(0, rec.path.length - ext.length) + '.approved' + ext;
      fs.copyFileSync(src, path.join(dir, snapshotRel));
      const checksum = fileChecksum(src);

      state.approvals = state.approvals || {};
      // Re-approval after a Phase-C reconciliation must not erase who approved the ORIGINAL suite —
      // the audit question is "what did each approver sign off, and when", not just the latest.
      const prior = state.approvals[key];
      const history = prior ? [...(prior.history || []), (({ history, ...rest }) => rest)(prior)] : [];
      state.approvals[key] = {
        approvedBy: String(flags.by),
        at: new Date().toISOString(),
        artifact: rec.path,
        snapshot: snapshotRel,
        checksum,
        ...(flags.note ? { note: String(flags.note) } : {}),
        ...(history.length ? { history } : {}),
      };
      qs.save(dir, state);
      process.stdout.write(JSON.stringify({ approved: key, ...state.approvals[key] }, null, 2) + '\n');
      break;
    }
    case 'skip': {
      // Record that a CONDITIONAL phase was deliberately not run. Distinct from `defer`: a deferral
      // postpones something the run owed you; a skip states that a conditional artifact was not needed.
      // Both carry a name, because "we decided not to" and "nobody thought about it" must not look alike.
      const [dir, key] = positional;
      if (!dir || !key || !flags.by || !flags.reason) die('skip <storyDir> <key> --by "<operator>" --reason "<why>"');
      const { DAG } = require('../lib/freshness/dag');
      if (!DAG[key] || !DAG[key].optional) {
        die(`"${key}" is not a conditional artifact — it cannot be skipped, only deferred.\n     -> qa-cli.js defer <storyDir> ${key} --by "<operator>" --reason "<why>"`);
      }
      const state = loadOrInit(dir);
      state.skips = state.skips || {};
      state.skips[key] = { decidedBy: String(flags.by), reason: String(flags.reason), at: new Date().toISOString() };
      qs.save(dir, state);
      process.stdout.write(JSON.stringify({ skipped: key, ...state.skips[key] }, null, 2) + '\n');
      break;
    }
    case 'testcase-lint': {
      // The mechanical half of the test-case review gate (skills/testcase-review/SKILL.md checks
      // 1, 3, 5-partial, 6 and 9). Exits 1 on any error, so the gate is an exit code rather than a
      // self-assessment. The judgement checks stay with the reviewer.
      const [dirOrFile] = positional;
      if (!dirOrFile) die('testcase-lint <storyDir|csvFile> [--acs AC-1,AC-2] [--acs-from <file>] [--require-screens] [--new] [--json]');
      const { parseTestCases, extractAcs } = require('../lib/testcases/parse');
      const { lintTestCases } = require('../lib/testcases/lint');

      let file = dirOrFile;
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        const state = qs.load(file);
        const rel = (state && state.artifacts && state.artifacts.testcases && state.artifacts.testcases.path) || 'testcases/testcases.csv';
        file = path.join(dirOrFile, rel);
      }
      if (!fs.existsSync(file)) die('testcase-lint: cannot find the test-case CSV: ' + file);

      let acs = csv(flags.acs);
      if (!acs.length && flags['acs-from']) {
        if (!fs.existsSync(String(flags['acs-from']))) die('testcase-lint: --acs-from file not found: ' + flags['acs-from']);
        acs = extractAcs(fs.readFileSync(String(flags['acs-from']), 'utf8'));
      }
      const parsed = parseTestCases(fs.readFileSync(file, 'utf8'));
      const result = lintTestCases(parsed, { acs, requireScreens: !!flags['require-screens'], newImport: !!flags.new });

      if (flags.json) process.stdout.write(JSON.stringify({ file, ...result }, null, 2) + '\n');
      else {
        const s = result.summary;
        process.stdout.write(`testcase-lint  ${file}\n`);
        process.stdout.write(`  ${s.cases} cases · ${s.steps} steps · AC declared ${s.acs.declared}, covered ${s.acs.covered.length}${s.acs.uncovered.length ? ', UNCOVERED ' + s.acs.uncovered.join(',') : ''}\n`);
        process.stdout.write(`  types: ${Object.entries(s.byType).filter(([, n]) => n).map(([t, n]) => `${t}=${n}`).join(' ') || '—'}\n`);
        for (const f of result.findings) {
          process.stdout.write(`  ${f.severity === 'error' ? 'ERROR' : 'warn '}  ${f.code.padEnd(24)} ${f.line ? 'line ' + String(f.line).padEnd(5) : '           '} ${f.message}\n`);
        }
        process.stdout.write(`  => ${result.errors} error(s), ${result.warnings} warning(s)\n`);
      }
      if (result.errors) process.exit(1);
      break;
    }
    case 'status': {
      // "Where is this story?" — the question `show` (a JSON dump) and `complete-check` (a gate)
      // both answer badly. Planned in ADR-001 §3.3 and never built. Always exits 0.
      const [dir] = positional;
      const state = qs.load(dir);
      if (!state) die('no qa-state.json in ' + dir);
      const { DAG } = require('../lib/freshness/dag');
      const profile = flags.profile ? String(flags.profile) : 'full';
      if (!PROFILES[profile]) die(`unknown --profile "${profile}" (one of: ${Object.keys(PROFILES).join(', ')})`);

      const generators = currentGenerators();
      const rows = PROFILES[profile].map((key) => {
        const a = (state.artifacts || {})[key];
        const deferral = (state.deferrals || {})[key];
        const approval = (state.approvals || {})[key];
        const want = generators[key];
        const outdated = !!(a && want && a.generator && a.generator !== want && a.generator.split('@')[0] === want.split('@')[0]);
        return {
          key,
          status: deferral ? 'deferred' : (a ? a.status : 'missing'),
          generator: a ? a.generator : null,
          currentGenerator: want || null,
          methodologyOutdated: outdated,
          approvedBy: approval ? approval.approvedBy : null,
          note: deferral ? `deferred by ${deferral.approvedBy}: ${deferral.reason}` : null,
        };
      });
      const conditional = Object.keys(DAG).filter((k) => DAG[k].optional).map((key) => ({
        key,
        status: (state.skips || {})[key] ? 'skipped' : ((state.artifacts || {})[key] ? state.artifacts[key].status : 'not run'),
        note: (state.skips || {})[key] ? `skipped by ${state.skips[key].decidedBy}: ${state.skips[key].reason}` : null,
      }));

      // What to do next, and what is standing in the way.
      const pending = rows.find((r) => r.status !== 'complete' && r.status !== 'modified' && r.status !== 'deferred');
      let next = pending ? pending.key : null;
      const blockers = [];
      if (next) {
        const dep = PHASE_DEPS[next];
        if (dep) {
          const up = (state.artifacts || {})[dep];
          if (!(state.deferrals || {})[dep] && (!up || up.status !== 'complete')) blockers.push(`${dep} is ${up ? up.status : 'missing'}`);
        }
        const ap = APPROVAL_DEPS[next];
        if (ap && !(state.approvals || {})[ap.artifact] && !(state.deferrals || {})[ap.viaDeferralOf]) {
          blockers.push(`${ap.artifact} awaiting operator approval (qa-cli.js approve "${dir}" ${ap.artifact} --by "<operator>")`);
        }
      }
      const outdatedKeys = rows.filter((r) => r.methodologyOutdated);
      const out = { ticket: state.ticket, profile, updatedAt: state.updatedAt, rows, conditional, next, blockers,
        methodologyOutdated: outdatedKeys.map((r) => `${r.key}: ${r.generator} → ${r.currentGenerator}`) };

      if (flags.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); break; }
      const done = rows.filter((r) => r.status === 'complete' || r.status === 'modified' || r.status === 'deferred').length;
      process.stdout.write(`${state.ticket}  ·  profile ${profile}  ·  ${done}/${rows.length} complete  ·  updated ${state.updatedAt || '—'}\n\n`);
      for (const r of rows) {
        const mark = r.status === 'complete' ? '✓' : r.status === 'modified' ? '±' : r.status === 'deferred' ? '–' : r.status === 'missing' ? ' ' : '!';
        const extra = [r.approvedBy ? `approved by ${r.approvedBy}` : null, r.note,
          r.methodologyOutdated ? `methodology moved on: ${r.generator} → ${r.currentGenerator}` : null].filter(Boolean).join('  ·  ');
        process.stdout.write(`  ${mark} ${r.key.padEnd(24)} ${String(r.status).padEnd(9)} ${(r.generator || '').padEnd(22)} ${extra}\n`);
      }
      process.stdout.write('\n  conditional:\n');
      for (const c of conditional) process.stdout.write(`    · ${c.key.padEnd(24)} ${String(c.status).padEnd(9)} ${c.note || ''}\n`);
      if (next) {
        process.stdout.write(`\n  → next: ${next}\n`);
        for (const b of blockers) process.stdout.write(`      blocked: ${b}\n`);
      } else process.stdout.write(`\n  → all ${profile} artifacts recorded. Run: qa-cli.js complete-check "${dir}" --profile ${profile}\n`);
      if (outdatedKeys.length) process.stdout.write(`\n  ! ${outdatedKeys.length} artifact(s) predate the current methodology — reconcile will mark them stale (rule d).\n`);
      break;
    }
    case 'branch-check': {
      // Assert BOTH repos are on this story's branch. The git hooks in D:\projects validate the branch
      // NAME on push only, so they can never catch the actual B10-56717 failure: no branch was created
      // at all and nothing was pushed, leaving both repos on the PREVIOUS story's branch while a full
      // QA run reported success. Call this at Step 0, where it costs one second.
      const [dir, ticketArg] = positional;
      const state = qs.load(dir);
      const ticket = ticketArg || (state && state.ticket);
      if (!ticket) die('branch-check <storyDir> [TICKET] — ticket not given and not in qa-state.json');
      const repos = csv(flags.repos).length ? csv(flags.repos) : [process.cwd(), frameworkPath()];
      const year = flags.year || String(new Date().getFullYear());
      const pattern = new RegExp(`^${year}/sprintQ\\d+\\.\\d+/${ticket.toLowerCase()}-[a-z0-9-]+$`, 'i');
      const rows = repos.filter(Boolean).map((repo) => {
        const branch = gitBranch(repo);
        return { repo, branch, ok: !!branch && pattern.test(branch) };
      });
      const bad = rows.filter((r) => !r.ok);
      process.stdout.write(JSON.stringify({ ticket, expected: `${year}/sprintQ<n>.<n>/${ticket.toLowerCase()}-<slug>`, repos: rows, ok: bad.length === 0 }, null, 2) + '\n');
      if (bad.length) {
        process.stderr.write('qa-cli: branch-check FAILED — these repos are not on this story\'s branch:\n');
        bad.forEach((r) => process.stderr.write(`     ${r.repo}  ->  ${r.branch || '(no branch)'}\n`));
        process.stderr.write(`     create it in EACH repo:  git checkout -b ${year}/sprintQ<n>.<n>/${ticket.toLowerCase()}-<slug>\n`);
        process.exit(1);
      }
      break;
    }
    case 'complete-check': {
      // Completion assertion for qa-full / W2. `show` prints state and always exits 0, so a `partial`
      // artifact could sit alongside eleven `complete` ones and never contradict the QA summary.
      // This exits non-zero on anything not `complete` without a recorded operator deferral.
      const [dir] = positional;
      const state = qs.load(dir);
      if (!state) die('no qa-state.json in ' + dir);
      const profile = flags.profile ? String(flags.profile) : 'full';
      if (!flags.expect && !PROFILES[profile]) die(`unknown --profile "${profile}" (one of: ${Object.keys(PROFILES).join(', ')})`);
      const required = csv(flags.expect).length ? csv(flags.expect) : PROFILES[profile];
      const problems = [];
      for (const key of required) {
        const a = state.artifacts && state.artifacts[key];
        const deferral = state.deferrals && state.deferrals[key];
        if (deferral) continue;
        if (!a) problems.push({ key, issue: 'missing' });
        else if (a.status !== 'complete') problems.push({ key, issue: a.status });
      }

      // Post-approval drift: an approved artifact that changed must carry a recorded reconciliation,
      // so validation can freely add/update/remove cases but can never do it silently.
      for (const [key, ap] of Object.entries(state.approvals || {})) {
        if (!required.includes(key)) continue;
        const a = state.artifacts && state.artifacts[key];
        if (!a || !ap.checksum) continue;
        const now = qs.checksumArtifact(dir, a.path);
        if (now && now !== ap.checksum && !(state.artifacts['testcase-reconciliation'])) {
          problems.push({ key, issue: `changed after approval by ${ap.approvedBy} with no recorded testcase-reconciliation` });
        }
      }

      const deferred = Object.entries(state.deferrals || {}).map(([k, v]) => ({ key: k, ...v }));
      const approved = Object.entries(state.approvals || {}).map(([k, v]) => ({ key: k, approvedBy: v.approvedBy, at: v.at }));
      process.stdout.write(JSON.stringify({ ticket: state.ticket, profile: flags.expect ? 'custom' : profile, required: required.length, problems, deferred, approved, ok: problems.length === 0 }, null, 2) + '\n');
      if (problems.length) {
        process.stderr.write('qa-cli: complete-check FAILED — the run is not complete:\n');
        problems.forEach((p) => process.stderr.write(`     ${p.key}: ${p.issue}\n`));
        process.stderr.write('     finish each, or record an operator-approved deferral:\n');
        process.stderr.write('     qa-cli.js defer <storyDir> <key> --by "<operator>" --reason "<why>"\n');
        process.exit(1);
      }
      break;
    }
    case 'reconcile': {
      // Compute the reuse/regenerate plan for Workflow 2. Live fingerprints come from the caller:
      //   - live Jira issue JSON on stdin (optional; else the stored hash = no jira change)
      //   - --figma-file/--figma-nodes/--figma-version[/--figma-frames] (optional; else stored = no change)
      //   - --immaterial  → treat a jira-only change to clarifications as immaterial (carry forward)
      //   - --apply-modified → re-baseline hand-edited artifacts (status "modified") and save
      //   - --expected a,b  → override the reconciled key set (default: baseline)
      const [dir] = positional;
      const state = qs.load(dir);
      if (!state) die('no qa-state.json in ' + dir);

      const stdin = readStdin().trim();
      const liveJira = stdin ? fingerprintJira(JSON.parse(stdin)).hash
        : (state.sources && state.sources.jira && state.sources.jira.hash) || null;
      const liveFigma = flags['figma-file']
        ? fingerprintFigma({ fileKey: flags['figma-file'], nodeIds: csv(flags['figma-nodes']), version: flags['figma-version'], framesHash: flags['figma-frames'] })
        : (state.sources && state.sources.figma ? fingerprintFigma(state.sources.figma) : null);

      const opts = {};
      if (flags.expected) opts.expected = csv(flags.expected);
      if (flags.immaterial) opts.materiality = () => false;
      // Rules (d) and (e), live. `--ignore-lock` suppresses both for a deliberate carry-forward
      // (e.g. a story mid-flight when a skill version bumps) — an explicit choice, printed in the plan.
      const lock = !flags['ignore-lock'];
      if (lock) opts.generators = currentGenerators();
      const liveDomains = lock ? currentDomains() : {};

      const plan = reconcile(state, { jira: { hash: liveJira }, figma: liveFigma, domains: liveDomains }, qs.makeIo(dir), opts);
      plan.lock = lock ? { generators: opts.generators, domains: Object.fromEntries(Object.entries(liveDomains).map(([k, v]) => [k, v.version])) } : 'ignored';

      if (flags['apply-modified'] && plan.modified.length) {
        qs.applyModified(state, plan.modified);
        qs.save(dir, state);
      }
      process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
      break;
    }
    case 'show': {
      const [dir] = positional;
      const state = qs.load(dir);
      if (!state) die('no qa-state.json in ' + dir);
      process.stdout.write(JSON.stringify(state, null, 2) + '\n');
      break;
    }
    case 'visual-compare': {
      // Operator-skill bridge (ADR-003 §3.4): run the deterministic Conformance
      // pipeline for the visual capability. No LLM here — the caller invokes the
      // residual on coverage-gaps / unresolved screens after reading this output.
      const { runScreens } = require('../lib/conformance');
      const visual = require('../capabilities/visual/capability');
      const { figmaExpectedProvider } = require('../capabilities/visual/expected/figma');
      const { dumpActualProvider } = require('../capabilities/visual/actual/dump');

      const raw = flags.in ? fs.readFileSync(flags.in, 'utf8') : readStdin();
      if (!raw || !raw.trim()) die('visual-compare: provide input JSON via --in <file> or stdin');
      let input;
      try { input = JSON.parse(raw); } catch (e) { die('visual-compare: invalid JSON (' + e.message + ')'); }

      let expected = Array.isArray(input.expected) ? input.expected : null;
      let actual = Array.isArray(input.actual) ? input.actual : null;
      if (!expected && Array.isArray(input.figmaFrames)) expected = figmaExpectedProvider.load(input.figmaFrames);
      if (!actual && Array.isArray(input.dumps)) actual = dumpActualProvider.capture(input.dumps);
      if (!actual && Array.isArray(input.rawDumps)) actual = dumpActualProvider.captureRaw(input.rawDumps);
      if (!Array.isArray(expected) || !Array.isArray(actual)) {
        die('visual-compare: need {expected:[],actual:[]} or {figmaFrames:[],dumps:[]|rawDumps:[]}');
      }

      const result = runScreens(visual, { expected, actual, ctx: input.ctx || {} });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      break;
    }
    case 'visual-evaluate': {
      // FULL story evaluation (ADR-003 Phase 3): deterministic-first, then the L8
      // residual runner. AI is opt-in via --judge claude (ClaudeJudge on the residual
      // only); the deterministic engine stays transport-agnostic either way.
      const { evaluateStory } = require('../lib/conformance');
      const visual = require('../capabilities/visual/capability');
      const { makeClaudeJudge } = require('../capabilities/visual/claude-judge');
      const { figmaExpectedProvider } = require('../capabilities/visual/expected/figma');
      const { dumpActualProvider } = require('../capabilities/visual/actual/dump');
      const { loadScreenRegistry } = require('../capabilities/visual/registry');
      const { expectedScreensFromRegistry } = require('../capabilities/visual/expected/build');
      const { enrichRegistryWithFigma } = require('../capabilities/visual/expected/figma-resolve');

      const raw = flags.in ? fs.readFileSync(flags.in, 'utf8') : readStdin();
      if (!raw || !raw.trim()) die('visual-evaluate: provide input JSON via --in <file> or stdin');
      let input;
      try { input = JSON.parse(raw); } catch (e) { die('visual-evaluate: invalid JSON (' + e.message + ')'); }

      let expected = Array.isArray(input.expected) ? input.expected : null;
      let actual = Array.isArray(input.actual) ? input.actual : null;

      if (!expected && input.useRegistry) {
        // Decision 2: registry stays stable; enrich live figma ids from the story URL.
        let reg = loadScreenRegistry();
        const figmaUrl = flags['figma-url'] || input.figmaUrl;
        if (figmaUrl || input.figmaFileKey || input.nodeIdByFrameName) {
          reg = enrichRegistryWithFigma(reg, { figmaUrl, fileKey: input.figmaFileKey, nodeIdByFrameName: input.nodeIdByFrameName });
        }
        expected = expectedScreensFromRegistry(reg, { figmaByNode: input.figmaByNode || {}, platforms: input.platforms, locales: input.locales });
      }
      if (!expected && Array.isArray(input.figmaFrames)) expected = figmaExpectedProvider.load(input.figmaFrames);
      if (!actual && Array.isArray(input.dumps)) actual = dumpActualProvider.capture(input.dumps);
      if (!actual && Array.isArray(input.rawDumps)) actual = dumpActualProvider.captureRaw(input.rawDumps);
      if (!Array.isArray(expected) || !Array.isArray(actual)) {
        die('visual-evaluate: need {expected,actual} or ({useRegistry}|{figmaFrames}) + {dumps|rawDumps}');
      }

      // Decision 1: AI transport is INJECTED. Default = no judge (deterministic-only).
      const judge = flags.judge === 'claude' ? makeClaudeJudge({ model: flags.model }) : undefined;
      const result = await evaluateStory(visual, { expected, actual }, { judge });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      break;
    }
    case 'figma-export': {
      // STEP 2 one-liner: REST export (scale=2) of a story's Figma frames → PNGs.
      // --url derives fileKey+node; a FRAME exports as-is, a SECTION explodes into
      // its child frames. Prints a manifest + framesHash; with --story it also writes
      // sources.figma (fileKey/nodeIds/framesHash) into qa-state.json.
      let FigmaExporter;
      try { FigmaExporter = require('../../automation/helpers/FigmaExporter'); }
      catch (e) { die('figma-export: cannot load FigmaExporter (' + e.message + ')'); }
      const { sha256, fileChecksum } = require('../lib/freshness/fingerprint');

      let fileKey = flags.file;
      let urlNode = null;
      if (flags.url) {
        try { fileKey = FigmaExporter.fileKeyFromUrl(flags.url); } catch (e) { die(e.message); }
        urlNode = FigmaExporter.nodeIdFromUrl(flags.url);
      }
      if (!fileKey) die('figma-export: need --url <figmaUrl> or --file <key>');
      const outDir = flags.out || (flags.story ? path.join(String(flags.story), 'figma-analysis', 'frames') : null);
      if (!outDir) die('figma-export: need --out <dir> or --story <storyDir>');
      const scale = Number(flags.scale) || 2;

      const fx = new FigmaExporter();
      let manifest;
      try {
        if (flags.page) {
          manifest = await fx.exportPage({ fileKey, pageName: String(flags.page), outDir, scale });
        } else {
          const explicit = csv(flags.nodes).map((s) => s.replace('-', ':'));
          let nodes;
          if (explicit.length) {
            nodes = explicit.map((id) => ({ id, name: flags.name ? `${flags.name}_${id.replace(':', '_')}` : id.replace(':', '_') }));
          } else if (urlNode) {
            // Inspect is an OPTIONAL optimization on the heavily rate-limited /v1/files
            // endpoint. If it 429s/fails, fall back to exporting the node directly via
            // /v1/images (far less limited) — never fatal.
            let info = null;
            try { info = await figmaInspectNode(fx.token, fileKey, urlNode); }
            catch (e) { process.stderr.write(`figma-export: node inspect skipped (${e.message}) — exporting the node directly via /images.\n`); }
            nodes = info && info.type === 'SECTION' && info.children.length
              ? info.children.map((k) => ({ id: k.id, name: k.name }))
              : [{ id: urlNode, name: flags.name || (info && info.name) || `frame_${urlNode.replace(':', '_')}` }];
          } else {
            die('figma-export: need a node — --url with node-id, --nodes a:b,c:d, or --page <name>');
          }
          manifest = await fx.exportNodes({ fileKey, outDir, scale, nodes });
        }
      } catch (e) {
        if (/HTTP 429/.test(e.message)) {
          die('figma-export: Figma REST rate-limited (' + e.message + ').\n' +
              '  REST quota likely exhausted (Starter-plan PAT monthly content limit). This is the FALLBACK path —\n' +
              '  use the PRIMARY browser-session Copy-as-PNG capture instead: check `node qa-workflow/bin/figma-connect.js --status`,\n' +
              '  reconnect via `node qa-workflow/bin/figma-connect.js` if not FRESH (session at auth/figma-auth.json), or retry after the reset.');
        }
        throw e;
      }

      const checks = manifest.filter((m) => m.file).map((m) => fileChecksum(m.file)).filter(Boolean).sort();
      const framesHash = checks.length === 0 ? null : checks.length === 1 ? checks[0] : sha256(checks.join(''));

      if (flags.story && framesHash) {
        const state = loadOrInit(String(flags.story), flags.ticket);
        state.sources = state.sources || { jira: null };
        state.sources.figma = { fileKey, nodeIds: manifest.map((m) => m.id), framesHash };
        qs.save(String(flags.story), state, { validate: false });
      }

      process.stdout.write(JSON.stringify({
        fileKey, outDir, scale, framesHash,
        frames: manifest.map((m) => ({ id: m.id, name: m.name, file: m.file, bytes: m.bytes, rendered: !!m.bytes })),
      }, null, 2) + '\n');
      break;
    }
    default:
      die('unknown command "' + (cmd || '') + '". See header for usage.');
  }
}

main().catch((e) => { process.stderr.write('qa-cli: ' + (e && e.message ? e.message : e) + '\n'); process.exit(1); });
