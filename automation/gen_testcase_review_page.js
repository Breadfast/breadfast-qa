#!/usr/bin/env node
'use strict';
/**
 * Test-case review page — the standard review medium for ANY story (added 2026-08-10).
 *
 * Turns `<storyDir>/testcases/testcases.csv` into a self-contained HTML console the operator works
 * through one case at a time, recording a verdict and a comment per case:
 *
 *     Accept          the case is right as written
 *     Needs update    keep the case, change it — the comment carries the instructions
 *     Invalid         delete the case — the comment carries why
 *
 * Alongside the verdict it captures the **automation decision**: if the story has an
 * `<storyDir>/testcases/automation-plan.json`, each case shows a recommendation (layer, effort, reason,
 * blockers, reuse) with a checkbox, so the operator picks exactly which cases get automated. Only the
 * selected set is automated afterwards.
 *
 * "Copy review" then emits a structured block that can be pasted straight back into the session, so
 * the revisions and the automation scope are actionable text rather than a verbal summary. Verdicts and
 * selections persist in localStorage keyed by ticket, so a long review survives a closed tab.
 *
 * Why this exists: on B10-57776 the operator reviewed 24 cases through an ad-hoc page. A binary
 * ok/flag mark could say *that* something was wrong but not *what to change*, and there was nowhere
 * to say "delete this one". Per the operator's instruction, every story now uses this same page.
 *
 * Usage:
 *   node automation/gen_testcase_review_page.js --story "D:\\breadfast-qa\\B10-57776" [--out <path>]
 *   node automation/gen_testcase_review_page.js --csv <file> --ticket B10-XXXXX [--title "..."]
 *     --plan <file>   an automation plan somewhere other than <csvDir>/automation-plan.json
 *     --force         render even when the plan fails validation (PREVIEW ONLY — the automation
 *                     panel is not trustworthy, so do not review scope on a forced page)
 *
 * Contract: docs/ai/browserstack-process.md §10.1–10.4 (CSV format) · the page is built with the
 * repo's own parser, so it can never disagree with what `qa-cli testcase-lint` sees.
 */
const fs = require('fs');
const path = require('path');
const { parseTestCases } = require('../qa-workflow/lib/testcases/parse.js');

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const storyDir = flag('story');
let csvPath = flag('csv');
let ticket = flag('ticket');
let title = flag('title');

if (!storyDir && !csvPath) {
  console.error('usage: gen_testcase_review_page.js --story <storyDir> [--out <path>]');
  console.error('       gen_testcase_review_page.js --csv <file> --ticket <KEY> [--title "..."]');
  process.exit(2);
}

if (storyDir) {
  csvPath = csvPath || path.join(storyDir, 'testcases', 'testcases.csv');
  ticket = ticket || path.basename(storyDir.replace(/[\\/]+$/, ''));
  // story title: the H1 of requirements.md, minus the "Requirements Analysis — KEY ·" prefix
  if (!title) {
    const req = path.join(storyDir, 'requirements-analysis', 'requirements.md');
    if (fs.existsSync(req)) {
      const h1 = (fs.readFileSync(req, 'utf8').match(/^#\s+(.+)$/m) || [])[1] || '';
      title = h1.replace(/^.*?—\s*/, '').replace(new RegExp('^' + ticket + '\\s*[·:—-]\\s*'), '').trim();
    }
  }
}
if (!fs.existsSync(csvPath)) { console.error('cannot find the test-case CSV: ' + csvPath); process.exit(1); }
ticket = ticket || 'STORY';
title = title || 'Test cases';

const outPath = flag('out')
  || (storyDir ? path.join(storyDir, 'testcases', 'review-page.html')
    : path.join(path.dirname(csvPath), 'review-page.html'));

// ── data ────────────────────────────────────────────────────────────────────
// Optional automation plan: <csvDir>/automation-plan.json, authored per story. Absent is fine — the
// page then falls back to the CSV's Automation Status and says no plan has been authored.
//
// The plan is VALIDATED, not merely parsed. On B10-57777 the plan wrote `"recommend": true` while this
// generator compared `=== 'yes'`: nothing was pre-ticked, the bulk button read "Select all 0
// recommended", the chip printed the bare string `true`, and every operator pick was exported as an
// override of a recommendation the page had never displayed. The predicate was written inline in four
// places, so there was no single point to get right — hence `recommends()` below, one source of truth
// used by both the Node side and the browser side, plus a hard failure on any value it cannot read.
const planPath = flag('plan') || path.join(path.dirname(csvPath), 'automation-plan.json');
const force = argv.includes('--force');
let plan = null;
if (fs.existsSync(planPath)) {
  try { plan = JSON.parse(fs.readFileSync(planPath, 'utf8')); }
  catch (e) { console.error('automation-plan.json is not valid JSON, ignoring it: ' + e.message); }
}

/** Accepted `recommend` spellings → the canonical three. Returns null for anything unreadable. */
const RECOMMEND = { yes: 'yes', no: 'no', partial: 'partial', true: 'yes', false: 'no' };
const normalizeRecommend = (v) => {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return RECOMMEND[v.trim().toLowerCase()] || null;
  return null;
};
/** Pre-tick and override-detection predicate. `partial` IS a recommendation to automate — a case I
 *  flagged as partially automatable and you then selected is not an override of anything. */
const recommends = (p) => !!p && (p.recommend === 'yes' || p.recommend === 'partial');

const LAYERS = ['ui', 'api', 'api+ui', 'selenium', 'appium', 'manual'];
const EFFORTS = ['S', 'M', 'L'];
/** Exactly the fields the page renders. Keeping "known" == "read" is what makes the unknown-field
 *  warning meaningful — a field listed here but never displayed is a silent no-op again. */
const CASE_KEYS = ['n', 'recommend', 'layer', 'effort', 'reason', 'reuse', 'blockers', 'traps'];

/** Validates + normalizes plan.cases in place. Fatal problems exit 1 unless --force. */
function validatePlan(p, caseCount) {
  const fatal = [];
  const warn = [];
  const unknown = {};
  if (!Array.isArray(p.cases)) { fatal.push('`cases` is missing or not an array'); p.cases = []; }
  const seen = new Set();
  p.cases.forEach((e, i) => {
    const at = `cases[${i}]` + (e && e.n != null ? ` (case ${e.n})` : '');
    if (!e || typeof e !== 'object') { fatal.push(`${at}: not an object`); return; }
    if (!Number.isInteger(e.n) || e.n < 1 || e.n > caseCount) {
      fatal.push(`${at}: \`n\` must be an integer 1..${caseCount}, got ${JSON.stringify(e.n)}`);
    } else if (seen.has(e.n)) { fatal.push(`${at}: duplicate entry for case ${e.n}`); } else { seen.add(e.n); }
    const rec = normalizeRecommend(e.recommend);
    if (!rec) {
      fatal.push(`${at}: \`recommend\` is ${JSON.stringify(e.recommend)} — expected yes/no/partial (or true/false)`);
    }
    e.recommend = rec;                                     // normalize for every consumer downstream
    if (!e.reason || !String(e.reason).trim()) warn.push(`${at}: no \`reason\` — the operator reads this to decide`);
    if (e.layer && !LAYERS.includes(String(e.layer))) warn.push(`${at}: layer "${e.layer}" is outside ${LAYERS.join('/')}`);
    if (e.effort && !EFFORTS.includes(String(e.effort))) warn.push(`${at}: effort "${e.effort}" is outside ${EFFORTS.join('/')}`);
    ['reuse', 'blockers', 'traps'].forEach((k) => {
      if (e[k] != null && !Array.isArray(e[k])) warn.push(`${at}: \`${k}\` must be an array`);
    });
    Object.keys(e).filter((k) => !CASE_KEYS.includes(k))
      .forEach((k) => (unknown[k] = (unknown[k] || 0) + 1));
  });
  // one line per unknown field, not one per case — 24 copies of the same warning teaches people to
  // scroll past warnings, which is how `recommend: true` went unnoticed in the first place
  Object.entries(unknown).forEach(([k, n]) =>
    warn.push(`unknown field \`${k}\` on ${n} case(s) — nothing reads it (known: ${CASE_KEYS.join(', ')})`));
  // A plan covering only some cases is worse than no plan: the uncovered cases render as
  // "no automation plan authored", which reads as a story-level statement rather than a gap.
  const missing = [];
  for (let n = 1; n <= caseCount; n++) if (!seen.has(n)) missing.push(n);
  if (missing.length) fatal.push(`no entry for case(s) ${missing.join(', ')} — every case needs a recommendation`);

  warn.forEach((w) => console.error('WARNING: automation-plan.json: ' + w));
  if (fatal.length) {
    fatal.forEach((f) => console.error('ERROR: automation-plan.json: ' + f));
    if (!force) {
      console.error('\nThe automation panel would be wrong for this story. Fix the plan, or pass --force');
      console.error('to preview the page with the plan ignored where it is unreadable.');
      process.exit(1);
    }
    console.error('--force: carrying on with an invalid plan. Do NOT review automation scope on this page.');
  }
}
const parsed = parseTestCases(fs.readFileSync(csvPath, 'utf8'));
if (!parsed.cases.length) { console.error('no test cases parsed from ' + csvPath); process.exit(1); }
if (plan) validatePlan(plan, parsed.cases.length);

const planByCase = new Map((plan && plan.cases ? plan.cases : []).map((p) => [p.n, p]));
const cases = parsed.cases.map((c, i) => ({
  n: i + 1,
  title: c.title,
  priority: c.priority,
  type: c.type,
  automation: c.automationStatus,
  description: c.description,
  preconditions: c.preconditions,
  acs: c.acs,
  screens: c.screens,
  folder: c.folderPath,
  steps: c.steps.filter((s) => s.step).map((s) => ({ step: s.step, expected: s.expected })),
  plan: planByCase.get(i + 1) || null,
}));

const stepTotal = cases.reduce((a, c) => a + c.steps.length, 0);
const recCount = cases.filter((c) => recommends(c.plan)).length;
const acsCovered = [...new Set(cases.flatMap((c) => c.acs))]
  .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
const folder = cases[0].folder || '';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── page ────────────────────────────────────────────────────────────────────
const html = `<title>${esc(ticket)} — Test Case Review</title>
<style>
  :root{
    --paper:#FBF9FA; --surface:#FFFFFF; --raised:#F5F0F3;
    --ink:#1B141A; --muted:#7A6B75; --faint:#9A8B94;
    --rule:#E7DEE4; --rule-strong:#D3C3CD;
    --accent:#AA0082; --accent-soft:#F7E6F2; --accent-ink:#7C005F;
    --ok:#1F7A54; --ok-soft:#E4F1EA;
    --upd:#9A6510; --upd-soft:#FBEEDC;
    --bad:#B3123C; --bad-soft:#FBE4EA;
    --crit:#B3123C; --high:#9A6510; --med:#56617A;
    --shadow:0 1px 2px rgba(27,20,26,.06), 0 8px 24px -16px rgba(27,20,26,.28);
    --serif:"Iowan Old Style","Source Serif 4",Georgia,"Times New Roman",serif;
    --sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --mono:ui-monospace,"Cascadia Mono","Cascadia Code",Consolas,"SF Mono",monospace;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --paper:#161115; --surface:#1E181D; --raised:#251E24;
      --ink:#F2ECEF; --muted:#B3A3AD; --faint:#8B7B85;
      --rule:#362D34; --rule-strong:#4A3E47;
      --accent:#E86FC4; --accent-soft:#33132A; --accent-ink:#F5AEDF;
      --ok:#5FCB99; --ok-soft:#13291F;
      --upd:#E2A857; --upd-soft:#2E2211;
      --bad:#F2708F; --bad-soft:#33131C;
      --crit:#F2708F; --high:#E2A857; --med:#9AA6C2;
      --shadow:0 1px 2px rgba(0,0,0,.5), 0 8px 24px -16px rgba(0,0,0,.7);
    }
  }
  :root[data-theme="dark"]{
    --paper:#161115; --surface:#1E181D; --raised:#251E24;
    --ink:#F2ECEF; --muted:#B3A3AD; --faint:#8B7B85;
    --rule:#362D34; --rule-strong:#4A3E47;
    --accent:#E86FC4; --accent-soft:#33132A; --accent-ink:#F5AEDF;
    --ok:#5FCB99; --ok-soft:#13291F;
    --upd:#E2A857; --upd-soft:#2E2211;
    --bad:#F2708F; --bad-soft:#33131C;
    --crit:#F2708F; --high:#E2A857; --med:#9AA6C2;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 8px 24px -16px rgba(0,0,0,.7);
  }

  *{box-sizing:border-box}
  body{margin:0; background:var(--paper); color:var(--ink);
    font-family:var(--sans); font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased}
  .label{font-family:var(--mono); font-size:10.5px; letter-spacing:.1em;
    text-transform:uppercase; color:var(--faint)}

  header{position:sticky; top:0; z-index:20; background:var(--surface);
    border-bottom:1px solid var(--rule); padding:14px 22px;
    display:flex; align-items:center; gap:22px; flex-wrap:wrap}
  .brand{display:flex; flex-direction:column; gap:2px; margin-right:auto}
  .brand h1{margin:0; font-family:var(--serif); font-size:19px; font-weight:600;
    letter-spacing:-.01em; text-wrap:balance}
  .brand .sub{font-size:12.5px; color:var(--muted)}
  .brand .sub b{color:var(--ink); font-weight:600}
  .tally{display:flex; gap:18px; align-items:flex-end}
  .tally .cell{display:flex; flex-direction:column; gap:1px; text-align:right}
  .tally .num{font-family:var(--mono); font-size:17px; font-variant-numeric:tabular-nums;
    line-height:1.1}
  .num.ok{color:var(--ok)} .num.upd{color:var(--upd)} .num.bad{color:var(--bad)}

  .shell{display:grid; grid-template-columns:308px minmax(0,1fr); align-items:start}
  @media (max-width:900px){ .shell{grid-template-columns:1fr} }

  nav{border-right:1px solid var(--rule); background:var(--surface);
    position:sticky; top:63px; max-height:calc(100vh - 63px); overflow-y:auto}
  @media (max-width:900px){ nav{position:static; max-height:320px; border-right:0;
    border-bottom:1px solid var(--rule)} }
  nav .railhead{padding:14px 18px 8px; border-bottom:1px solid var(--rule);
    display:flex; align-items:baseline; gap:8px}
  .row{display:grid; grid-template-columns:26px 1fr auto; gap:9px; align-items:baseline;
    width:100%; text-align:left; background:none; border:0; cursor:pointer;
    padding:9px 16px 9px 12px; border-bottom:1px solid var(--rule);
    border-left:3px solid transparent; color:var(--ink); font:inherit}
  .row:hover{background:var(--raised)}
  .row[aria-current="true"]{background:var(--accent-soft); border-left-color:var(--accent)}
  .row .rn{font-family:var(--mono); font-size:11.5px; font-variant-numeric:tabular-nums;
    color:var(--faint); padding-top:2px}
  .row[aria-current="true"] .rn{color:var(--accent-ink)}
  .row .rt{font-size:12.9px; line-height:1.35}
  .row .mark{font-family:var(--mono); font-size:11px; line-height:1.6}
  .mark.accept{color:var(--ok)} .mark.update{color:var(--upd)} .mark.invalid{color:var(--bad)}
  .row.v-accept .rt{color:var(--muted)}
  .row.v-invalid .rt{text-decoration:line-through; text-decoration-color:var(--bad); color:var(--muted)}
  .row:focus-visible{outline:2px solid var(--accent); outline-offset:-2px}

  main{padding:26px 30px 190px; min-width:0}
  @media (max-width:700px){ main{padding:20px 16px 200px} }
  .eyebrow{display:flex; align-items:center; gap:10px; margin-bottom:9px}
  .eyebrow .of{font-family:var(--mono); font-size:11.5px; color:var(--faint);
    font-variant-numeric:tabular-nums}
  h2{margin:0 0 14px; font-family:var(--serif); font-weight:600; font-size:26px;
    line-height:1.24; letter-spacing:-.015em; max-width:34ch; text-wrap:balance}
  .chips{display:flex; flex-wrap:wrap; gap:6px; margin-bottom:20px}
  .chip{font-family:var(--mono); font-size:11px; letter-spacing:.03em; padding:3px 8px;
    border-radius:3px; border:1px solid var(--rule-strong); color:var(--muted);
    background:var(--surface); white-space:nowrap}
  .chip.ac{color:var(--accent-ink); border-color:var(--accent); background:var(--accent-soft)}
  .chip.p-Critical{color:var(--crit); border-color:currentColor}
  .chip.p-High{color:var(--high); border-color:currentColor}
  .chip.p-Medium{color:var(--med); border-color:currentColor}
  .chip.p-Low{color:var(--med); border-color:currentColor}

  .block{background:var(--surface); border:1px solid var(--rule); border-radius:5px;
    padding:15px 17px; margin-bottom:14px; box-shadow:var(--shadow)}
  .block .label{margin-bottom:6px; display:block}
  .block p{margin:0; font-size:14px; max-width:74ch}

  .tablewrap{overflow-x:auto; background:var(--surface); border:1px solid var(--rule);
    border-radius:5px; box-shadow:var(--shadow); margin-bottom:20px}
  table{border-collapse:collapse; width:100%; min-width:640px}
  thead th{text-align:left; padding:10px 14px; background:var(--raised);
    border-bottom:1px solid var(--rule-strong); font-family:var(--mono); font-size:10.5px;
    letter-spacing:.1em; text-transform:uppercase; color:var(--muted); font-weight:500}
  thead th:first-child{width:38px; text-align:right}
  tbody td{padding:11px 14px; border-bottom:1px solid var(--rule); vertical-align:top; font-size:14px}
  tbody tr:last-child td{border-bottom:0}
  tbody tr:nth-child(even) td{background:color-mix(in srgb, var(--raised) 45%, transparent)}
  td.sn{font-family:var(--mono); font-variant-numeric:tabular-nums; color:var(--faint);
    text-align:right; font-size:12px; padding-top:13px}
  td.exp{color:var(--muted); border-left:1px solid var(--rule)}

  /* ── verdict + comment ───────────────────────────────────── */
  .verdict{background:var(--surface); border:1px solid var(--rule-strong); border-radius:5px;
    padding:15px 17px; box-shadow:var(--shadow)}
  .verdict[data-v="accept"]{border-color:var(--ok); background:var(--ok-soft)}
  .verdict[data-v="update"]{border-color:var(--upd); background:var(--upd-soft)}
  .verdict[data-v="invalid"]{border-color:var(--bad); background:var(--bad-soft)}
  .vrow{display:flex; flex-wrap:wrap; gap:8px; margin:8px 0 12px}
  .vbtn{font:inherit; font-size:13px; padding:7px 13px; border-radius:4px;
    border:1px solid var(--rule-strong); background:var(--surface); color:var(--ink);
    cursor:pointer; display:inline-flex; align-items:center; gap:7px}
  .vbtn:hover{background:var(--raised)}
  .vbtn:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
  .vbtn kbd{font-family:var(--mono); font-size:10px; color:var(--faint);
    border:1px solid var(--rule); border-radius:3px; padding:1px 4px}
  .vbtn[aria-pressed="true"]{font-weight:600}
  .vbtn.accept[aria-pressed="true"]{background:var(--ok); border-color:var(--ok); color:#fff}
  .vbtn.update[aria-pressed="true"]{background:var(--upd); border-color:var(--upd); color:#fff}
  .vbtn.invalid[aria-pressed="true"]{background:var(--bad); border-color:var(--bad); color:#fff}
  .verdict textarea{width:100%; min-height:88px; resize:vertical; padding:10px 12px;
    border:1px solid var(--rule-strong); border-radius:4px; background:var(--paper);
    color:var(--ink); font-family:var(--sans); font-size:14px; line-height:1.5}
  .verdict textarea:focus{outline:2px solid var(--accent); outline-offset:1px; border-color:var(--accent)}
  .verdict textarea.wanted{border-color:var(--upd); background:var(--surface)}
  .vhint{font-size:12.5px; color:var(--muted); margin-top:7px}
  .vhint.warn{color:var(--upd)}

  /* ── automation suggestion ───────────────────────────────── */
  .auto{background:var(--surface); border:1px solid var(--rule); border-radius:5px;
    padding:15px 17px; margin-bottom:14px; box-shadow:var(--shadow)}
  .auto[data-sel="1"]{border-color:var(--accent)}
  .autohead{display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:9px}
  .rec{font-family:var(--mono); font-size:11px; letter-spacing:.04em; padding:3px 8px;
    border-radius:3px; border:1px solid currentColor; white-space:nowrap}
  .rec.yes{color:var(--ok)} .rec.no{color:var(--bad)} .rec.partial{color:var(--upd)}
  .auto p{margin:0 0 9px; font-size:14px; max-width:74ch; color:var(--ink)}
  .auto ul{margin:0 0 9px; padding-left:18px; font-size:13px; color:var(--muted)}
  .auto ul li{margin:2px 0}
  .auto ul.blockers li{color:var(--upd)}
  .pick{display:flex; align-items:center; gap:9px; padding:9px 11px; border-radius:4px;
    border:1px solid var(--rule-strong); background:var(--paper); cursor:pointer;
    font-size:14px; user-select:none}
  .pick:hover{background:var(--raised)}
  .pick input{width:16px; height:16px; accent-color:var(--accent); cursor:pointer; margin:0}
  .pick:focus-within{outline:2px solid var(--accent); outline-offset:1px}
  .auto[data-sel="1"] .pick{background:var(--accent-soft); border-color:var(--accent)}
  .pick .off{color:var(--muted)}
  .noplan{font-size:13px; color:var(--muted); margin:0}

  .bar{position:fixed; bottom:0; left:0; right:0; z-index:30; background:var(--surface);
    border-top:1px solid var(--rule-strong); padding:10px 22px;
    display:flex; align-items:center; gap:10px; flex-wrap:wrap;
    box-shadow:0 -8px 24px -20px rgba(27,20,26,.5)}
  button.act{font:inherit; font-size:13px; padding:7px 14px; border-radius:4px;
    border:1px solid var(--rule-strong); background:var(--surface); color:var(--ink); cursor:pointer}
  button.act:hover{background:var(--raised)}
  button.act:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
  button.act.primary{background:var(--accent); border-color:var(--accent); color:#fff}
  button.act.primary:hover{filter:brightness(1.08)}
  .bar .spacer{margin-left:auto}
  .bar .hint{font-size:12px; color:var(--faint)}

  dialog{border:1px solid var(--rule-strong); border-radius:6px; background:var(--surface);
    color:var(--ink); max-width:min(760px,94vw); padding:0; box-shadow:var(--shadow)}
  dialog::backdrop{background:rgba(27,20,26,.45)}
  dialog .dhead{padding:14px 18px; border-bottom:1px solid var(--rule);
    display:flex; align-items:center; gap:12px}
  dialog .dhead h3{margin:0; font-family:var(--serif); font-size:17px; font-weight:600}
  dialog textarea{width:100%; min-height:320px; border:0; resize:vertical; padding:14px 18px;
    font-family:var(--mono); font-size:12px; line-height:1.6; background:var(--paper); color:var(--ink)}
  dialog textarea:focus{outline:none}
  dialog .dfoot{padding:12px 18px; border-top:1px solid var(--rule); display:flex; gap:9px}
  @media (prefers-reduced-motion:reduce){ *{animation:none!important; transition:none!important} }
</style>

<header>
  <div class="brand">
    <h1>${esc(ticket)} — ${esc(title)}</h1>
    <div class="sub">Test-case review · <b>${cases.length} cases</b> · <b>${stepTotal} steps</b> · ${acsCovered.length} ACs referenced${folder ? ' · ' + esc(folder) : ''}</div>
  </div>
  <div class="tally">
    <div class="cell"><span class="num ok" id="tOk">0</span><span class="label">accept</span></div>
    <div class="cell"><span class="num upd" id="tUpd">0</span><span class="label">update</span></div>
    <div class="cell"><span class="num bad" id="tBad">0</span><span class="label">delete</span></div>
    <div class="cell"><span class="num" id="tLeft">${cases.length}</span><span class="label">left</span></div>
    ${plan ? `<div class="cell"><span class="num" id="tAuto" style="color:var(--accent)">0</span><span class="label">automate</span></div>` : ''}
  </div>
</header>

<div class="shell">
  <nav aria-label="Test case index">
    <div class="railhead"><span class="label">All cases</span></div>
    <div id="rail"></div>
  </nav>
  <main>
    <div class="eyebrow"><span class="of" id="ofLabel"></span></div>
    <h2 id="cTitle"></h2>
    <div class="chips" id="cChips"></div>
    <div class="block"><span class="label">Why this case exists</span><p id="cDesc"></p></div>
    <div class="block"><span class="label">Preconditions</span><p id="cPre"></p></div>
    <span class="label" style="display:block;margin:0 0 7px 2px">Steps</span>
    <div class="tablewrap">
      <table>
        <thead><tr><th>#</th><th>Action</th><th>Expected result</th></tr></thead>
        <tbody id="cSteps"></tbody>
      </table>
    </div>

    <div class="verdict" id="vBox">
      <span class="label">Your verdict on this case</span>
      <div class="vrow">
        <button class="vbtn accept"  id="vA" aria-pressed="false">Accept <kbd>A</kbd></button>
        <button class="vbtn update"  id="vU" aria-pressed="false">Needs update <kbd>U</kbd></button>
        <button class="vbtn invalid" id="vI" aria-pressed="false">Invalid — delete <kbd>D</kbd></button>
      <span class="label" style="align-self:center">${plan ? 'C comment · T toggle automation' : 'C comment'}</span>
      </div>
      <textarea id="vC" placeholder="Comment — what to change, which step, or why the case should be deleted. Referencing a step by its number helps (e.g. &quot;step 4 expected result is wrong&quot;)."></textarea>
      <div class="vhint" id="vH"></div>
    </div>

    <div class="auto" id="aBox" style="margin-top:14px">
      <div class="autohead">
        <span class="label">Automation</span>
        <span class="rec" id="aRec"></span>
        <span class="label" id="aMeta"></span>
      </div>
      <p id="aReason"></p>
      <ul class="reuse" id="aReuse"></ul>
      <ul class="blockers" id="aBlockers"></ul>
      <label class="pick" id="aPickWrap">
        <input type="checkbox" id="aPick">
        <span id="aPickLabel">Automate this case</span>
      </label>
      <p class="noplan" id="aNoPlan" hidden>No automation plan authored for this story yet.</p>
    </div>
  </main>
</div>

<div class="bar">
  <button class="act" id="bPrev">← Previous</button>
  <button class="act primary" id="bNext">Next →</button>
  <button class="act" id="bJump">Next unreviewed</button>
  ${plan ? `<button class="act" id="bAllRec">Select all ${recCount} recommended</button>` : ''}
  <span class="spacer"></span>
  <span class="hint" id="hint"></span>
  <button class="act" id="bSummary">Copy review</button>
</div>

<dialog id="dlg">
  <div class="dhead"><h3>Review result</h3><span class="label" id="dlgCount"></span></div>
  <textarea id="dlgText" readonly spellcheck="false"></textarea>
  <div class="dfoot">
    <button class="act primary" id="dlgCopy">Copy to clipboard</button>
    <button class="act" id="dlgClose">Close</button>
  </div>
</dialog>

<script>
const TICKET = ${JSON.stringify(ticket)};
const CASES = ${JSON.stringify(cases)};
const HAS_PLAN = ${plan ? 'true' : 'false'};
const KEY = 'tc-review:' + TICKET;
// One source of truth for "did I recommend automating this", mirroring recommends() on the Node side.
// \`recommend\` arrives already normalized to yes/no/partial, and \`partial\` counts as a recommendation.
const RECOMMENDED = (c) => !!c.plan && (c.plan.recommend === 'yes' || c.plan.recommend === 'partial');
// { n: { v:'accept'|'update'|'invalid', c:'comment', a:true|false } }  a = automate this case
let R = {};
try { R = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { R = {}; }
// first visit: pre-tick the recommended set so the operator overrides rather than starts from nothing
if (HAS_PLAN && !localStorage.getItem(KEY + ':seeded')) {
  CASES.forEach((c) => {
    if (RECOMMENDED(c)) { R[c.n] = R[c.n] || { v: null, c: '' }; R[c.n].a = true; }
  });
  try { localStorage.setItem(KEY + ':seeded', '1'); localStorage.setItem(KEY, JSON.stringify(R)); } catch (e) {}
}
let cur = 0;

const $ = (id) => document.getElementById(id);
const rail = $('rail');
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(R)); } catch (e) {} };
const rec = (n) => (R[n] = R[n] || { v: null, c: '' });

const MARK = { accept: '✓', update: '✎', invalid: '✕' };

function railRows(){
  rail.replaceChildren();
  CASES.forEach((c, i) => {
    const r = R[c.n] || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row' + (r.v ? ' v-' + r.v : '');
    b.setAttribute('aria-current', i === cur ? 'true' : 'false');
    b.innerHTML = '<span class="rn">' + String(c.n).padStart(2,'0') + '</span>'
      + '<span class="rt"></span>'
      + '<span class="mark ' + (r.v || '') + '">' + (MARK[r.v] || '') + (r.c ? '<span aria-hidden="true"> ·</span>' : '') + '</span>';
    b.querySelector('.rt').textContent = c.title.replace(/^Verify /, '');
    b.addEventListener('click', () => { commit(); cur = i; render(); });
    rail.appendChild(b);
  });
}

function tallies(){
  const v = Object.values(R);
  const n = (k) => v.filter((x) => x.v === k).length;
  const ok = n('accept'), upd = n('update'), bad = n('invalid');
  $('tOk').textContent = ok; $('tUpd').textContent = upd; $('tBad').textContent = bad;
  $('tLeft').textContent = CASES.length - ok - upd - bad;
  if (HAS_PLAN) $('tAuto').textContent = v.filter((x) => x.a).length;
  const done = ok + upd + bad === CASES.length;
  const missing = Object.entries(R).filter(([, x]) => (x.v === 'update' || x.v === 'invalid') && !x.c.trim()).length;
  $('hint').textContent = missing ? missing + ' case(s) marked without a comment'
    : done ? 'Every case has a verdict.' : '';
}

function render(){
  const c = CASES[cur];
  const r = rec(c.n);
  $('ofLabel').textContent = 'Case ' + c.n + ' of ' + CASES.length;
  $('cTitle').textContent = c.title;

  const cc = $('cChips'); cc.replaceChildren();
  [['chip p-' + c.priority, c.priority], ['chip', c.type], ['chip', c.automation],
    ...c.acs.map((a) => ['chip ac', a]), ...c.screens.map((s) => ['chip', 'screen: ' + s]),
    ['chip', c.steps.length + ' steps']].forEach(([cls, txt]) => {
    const s = document.createElement('span'); s.className = cls; s.textContent = txt; cc.appendChild(s);
  });

  $('cDesc').textContent = c.description;
  $('cPre').textContent = c.preconditions;

  const tb = $('cSteps'); tb.replaceChildren();
  c.steps.forEach((s, i) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.className = 'sn'; a.textContent = i + 1;
    const b = document.createElement('td'); b.textContent = s.step;
    const d = document.createElement('td'); d.className = 'exp'; d.textContent = s.expected;
    tr.append(a, b, d); tb.appendChild(tr);
  });

  ['A','U','I'].forEach((k, i) => {
    const want = ['accept','update','invalid'][i];
    $('v' + k).setAttribute('aria-pressed', r.v === want ? 'true' : 'false');
  });
  $('vBox').dataset.v = r.v || '';
  $('vC').value = r.c || '';
  const needs = (r.v === 'update' || r.v === 'invalid');
  $('vC').classList.toggle('wanted', needs && !r.c.trim());
  $('vH').className = 'vhint' + (needs && !r.c.trim() ? ' warn' : '');
  $('vH').textContent = r.v === 'update' ? 'Say what to change — I apply these as revisions to the CSV.'
    : r.v === 'invalid' ? 'Say why it is invalid — I remove the case and record the reason.'
    : r.v === 'accept' ? 'Accepted as written. A comment is optional.'
    : 'No verdict yet.';

  // ── automation suggestion ──
  const p = c.plan;
  $('aBox').dataset.sel = r.a ? '1' : '0';
  $('aNoPlan').hidden = !!p;
  ['aRec','aMeta','aReason','aReuse','aBlockers','aPickWrap'].forEach((id) => { $(id).hidden = !p; });
  if (p) {
    const REC = { yes: 'recommend: automate', no: 'recommend: do not automate', partial: 'recommend: partial' };
    $('aRec').className = 'rec ' + p.recommend;
    $('aRec').textContent = REC[p.recommend] || p.recommend;
    $('aMeta').textContent = [p.layer, p.effort ? 'effort ' + p.effort : ''].filter(Boolean).join(' · ');
    $('aReason').textContent = p.reason || '';
    const fill = (el, items, prefix) => {
      el.replaceChildren(); el.hidden = !(items && items.length);
      (items || []).forEach((t) => { const li = document.createElement('li'); li.textContent = prefix + t; el.appendChild(li); });
    };
    fill($('aReuse'), [].concat(p.reuse || [], p.traps || []).length ? [].concat((p.reuse || []).map((t) => 'reuse: ' + t), (p.traps || []).map((t) => 'watch: ' + t)) : [], '');
    fill($('aBlockers'), (p.blockers || []).map((t) => 'blocker: ' + t), '');
    $('aPick').checked = !!r.a;
    $('aPickLabel').textContent = r.a ? 'Automate this case' : 'Not automating this case';
    $('aPickLabel').className = r.a ? '' : 'off';
  }

  $('bPrev').disabled = cur === 0;
  tallies(); railRows();
  const active = rail.children[cur];
  if (active) active.scrollIntoView({ block: 'nearest' });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/** persist the textarea before navigating away from a case */
function commit(){
  const r = rec(CASES[cur].n);
  r.c = $('vC').value;
  if (!r.v && !r.c.trim()) delete R[CASES[cur].n];
  save();
}

function setV(v){
  const r = rec(CASES[cur].n);
  r.v = r.v === v ? null : v;
  r.c = $('vC').value;
  if (!r.v && !r.c.trim()) delete R[CASES[cur].n];
  save(); render();
  if (r.v === 'update' || r.v === 'invalid') $('vC').focus();
}
const go = (d) => { commit(); cur = (cur + d + CASES.length) % CASES.length; render(); };

$('vA').addEventListener('click', () => setV('accept'));
$('vU').addEventListener('click', () => setV('update'));
$('vI').addEventListener('click', () => setV('invalid'));
$('vC').addEventListener('input', () => {
  const r = rec(CASES[cur].n); r.c = $('vC').value; save();
  const needs = (r.v === 'update' || r.v === 'invalid');
  $('vC').classList.toggle('wanted', needs && !r.c.trim());
  railRows(); tallies();
});
function setAuto(on){
  const r = rec(CASES[cur].n);
  r.a = on; r.c = $('vC').value;
  if (!r.v && !r.c.trim() && !r.a) delete R[CASES[cur].n];
  save(); render();
}
$('aPick').addEventListener('change', (e) => setAuto(e.target.checked));
if (HAS_PLAN) {
  $('bAllRec').addEventListener('click', () => {
    commit();
    CASES.forEach((c) => { if (RECOMMENDED(c)) { rec(c.n).a = true; } });
    save(); render();
  });
}

$('bPrev').addEventListener('click', () => go(-1));
$('bNext').addEventListener('click', () => go(1));
$('bJump').addEventListener('click', () => {
  commit();
  const i = CASES.findIndex((c) => !(R[c.n] && R[c.n].v));
  if (i === -1) { $('hint').textContent = 'Every case has a verdict.'; return; }
  cur = i; render();
});

$('bSummary').addEventListener('click', () => {
  commit();
  const pick = (v) => CASES.filter((c) => (R[c.n] || {}).v === v);
  const accepted = pick('accept'), updates = pick('update'), invalid = pick('invalid');
  const none = CASES.filter((c) => !(R[c.n] && R[c.n].v));
  const L = [];
  L.push(TICKET + ' test-case review — ' + accepted.length + ' accepted, ' + updates.length
    + ' to update, ' + invalid.length + ' to delete, ' + none.length + ' unreviewed'
    + ' (of ' + CASES.length + ')');
  L.push('');
  if (updates.length){
    L.push('=== NEEDS UPDATE ===');
    updates.forEach((c) => {
      L.push('Case ' + c.n + ' — ' + c.title);
      L.push('  ' + ((R[c.n].c || '').trim() || '(no instructions given)'));
      L.push('');
    });
  }
  if (invalid.length){
    L.push('=== INVALID / DELETE ===');
    invalid.forEach((c) => {
      L.push('Case ' + c.n + ' — ' + c.title);
      L.push('  ' + ((R[c.n].c || '').trim() || '(no reason given)'));
      L.push('');
    });
  }
  const withNotes = accepted.filter((c) => (R[c.n].c || '').trim());
  if (withNotes.length){
    L.push('=== ACCEPTED, WITH A NOTE ===');
    withNotes.forEach((c) => { L.push('Case ' + c.n + ' — ' + c.title); L.push('  ' + R[c.n].c.trim()); L.push(''); });
  }
  if (none.length){
    L.push('=== NOT YET REVIEWED ===');
    none.forEach((c) => L.push('Case ' + c.n + ' — ' + c.title));
    L.push('');
  }
  if (!updates.length && !invalid.length && !none.length) L.push('All ' + CASES.length + ' cases accepted as written.');

  if (HAS_PLAN){
    // automation scope — exclude anything marked for deletion, it will not exist to automate
    const live = CASES.filter((c) => (R[c.n] || {}).v !== 'invalid');
    const chosen = live.filter((c) => (R[c.n] || {}).a);
    const declined = live.filter((c) => !(R[c.n] || {}).a);
    const overrides = live.filter((c) => !!(R[c.n] || {}).a !== RECOMMENDED(c));
    L.push('');
    L.push('=== AUTOMATE: ' + chosen.length + ' of ' + live.length + ' cases selected ===');
    chosen.forEach((c) => {
      const p = c.plan || {};
      L.push('Case ' + c.n + ' [' + (p.layer || '?') + '/' + (p.effort || '?') + '] ' + c.title);
    });
    if (!chosen.length) L.push('(none selected)');
    L.push('');
    L.push('=== DO NOT AUTOMATE: ' + declined.length + ' ===');
    declined.forEach((c) => L.push('Case ' + c.n + ' — ' + c.title));
    if (!declined.length) L.push('(none)');
    if (overrides.length){
      L.push('');
      L.push('=== OVERRIDES vs MY RECOMMENDATION: ' + overrides.length + ' ===');
      overrides.forEach((c) => {
        L.push('Case ' + c.n + ' — ' + (RECOMMENDED(c)
          ? 'I recommended automating; you excluded it'
          : 'I recommended NOT automating; you included it'));
      });
    }
    L.push('');
  }
  $('dlgText').value = L.join('\\n');
  $('dlgCount').textContent = accepted.length + ' / ' + updates.length + ' / ' + invalid.length;
  $('dlg').showModal();
});
$('dlgClose').addEventListener('click', () => $('dlg').close());
$('dlgCopy').addEventListener('click', async () => {
  const t = $('dlgText'); t.select();
  try { await navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand('copy'); }
  $('dlgCopy').textContent = 'Copied';
  setTimeout(() => { $('dlgCopy').textContent = 'Copy to clipboard'; }, 1600);
});

document.addEventListener('keydown', (e) => {
  if ($('dlg').open) return;
  if (e.target.matches('textarea,input')) {
    if (e.key === 'Escape') e.target.blur();
    return;                                   // never steal keys while typing a comment
  }
  const k = e.key.toLowerCase();
  if (e.key === 'ArrowRight' || k === 'j') { go(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || k === 'k') { go(-1); e.preventDefault(); }
  else if (k === 'a') { setV('accept'); e.preventDefault(); }
  else if (k === 'u') { setV('update'); e.preventDefault(); }
  else if (k === 'd') { setV('invalid'); e.preventDefault(); }
  else if (k === 'c') { $('vC').focus(); e.preventDefault(); }
  else if (k === 't' && HAS_PLAN) { setAuto(!(R[CASES[cur].n] || {}).a); e.preventDefault(); }
});
window.addEventListener('beforeunload', commit);

render();
</script>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');
console.log(`${ticket}: ${cases.length} cases · ${stepTotal} steps · ${acsCovered.length} ACs`);
// Print the plan's split. "Select all 0 recommended" was only ever visible inside the generated HTML,
// which is how B10-57777 shipped a review page whose automation panel recommended nothing at all.
if (plan) {
  const n = (v) => cases.filter((c) => c.plan && c.plan.recommend === v).length;
  console.log(`automation plan: ${recCount} of ${cases.length} recommended `
    + `(yes ${n('yes')} · partial ${n('partial')} · no ${n('no')}) — pre-ticked on first open`);
  if (!recCount) console.error('WARNING: the plan recommends NOTHING — verify that is deliberate before reviewing.');
} else {
  console.log(`automation plan: none authored (${planPath}) — the page will say so and fall back to the CSV`);
}
console.log(`-> ${outPath}  (${(html.length / 1024).toFixed(0)} KB)`);
