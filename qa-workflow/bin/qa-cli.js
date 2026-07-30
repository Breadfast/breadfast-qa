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
 *   node qa-workflow/bin/qa-cli.js complete-check <storyDir> [--expect a,b,...]
 *          # COMPLETION gate: exit 1 while any required artifact is missing or not "complete" and has no
 *          #   recorded operator deferral. `show` always exits 0, so it can never fail a run.
 *   node qa-workflow/bin/qa-cli.js defer <storyDir> <key> --by "<operator>" --reason "<why>"
 *          # The ONLY way past the phase dependency and complete-check. A deferral must have a name on it.
 *   node qa-workflow/bin/qa-cli.js record <storyDir> <key> --path <rel> --generator <name@x.y>
 *          [--derive-sources jira,figma] [--derive-artifacts requirements,...] [--domains card,...] [--status complete]
 *   node qa-workflow/bin/qa-cli.js reconcile <storyDir> [--figma-file K --figma-nodes 1:1 --figma-version v]
 *          [--immaterial] [--apply-modified] [--expected requirements,figma-analysis,...]   # live jira issue JSON on stdin (optional)
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
/** A phase that may not be recorded until its upstream phase is genuinely finished. */
const PHASE_DEPS = { execution: 'automation' };
/** The artifact set a finished post-development run must contain. */
const REQUIRED_ARTIFACTS = [
  'requirements', 'figma-analysis', 'clarifications', 'impact', 'hls',
  'testcases', 'browserstack-import', 'automation', 'execution', 'visual-findings', 'defects', 'qa-summary',
];

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
      if (domains.length) record.domains = domains;

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
      const required = csv(flags.expect).length ? csv(flags.expect) : REQUIRED_ARTIFACTS;
      const problems = [];
      for (const key of required) {
        const a = state.artifacts && state.artifacts[key];
        const deferral = state.deferrals && state.deferrals[key];
        if (deferral) continue;
        if (!a) problems.push({ key, issue: 'missing' });
        else if (a.status !== 'complete') problems.push({ key, issue: a.status });
      }
      const deferred = Object.entries(state.deferrals || {}).map(([k, v]) => ({ key: k, ...v }));
      process.stdout.write(JSON.stringify({ ticket: state.ticket, required: required.length, problems, deferred, ok: problems.length === 0 }, null, 2) + '\n');
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

      const plan = reconcile(state, { jira: { hash: liveJira }, figma: liveFigma, domains: {} }, qs.makeIo(dir), opts);

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
