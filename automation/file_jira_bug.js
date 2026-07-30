'use strict';

/**
 * File a B10 bug the ONE correct way — see docs/ai/bug-reporting.md §4.
 *
 * WHY THIS EXISTS
 * ---------------
 * On B10-56652 (2026-07-28) five bugs were filed by hand via the Atlassian MCP with the whole report
 * crammed into `description`, none of the three template fields set, Severity/Environment/Testing-Phase
 * left blank, and ZERO attachments. All five were rejected. The root cause was not carelessness in the
 * moment — it was that the correct shape lived only in a document, so it could be skipped. This script
 * makes the correct shape the executable path:
 *
 *   1. VALIDATE the spec against the real allowed values BEFORE any write (no half-created bugs).
 *   2. CREATE the sub-task with every required field, via REST v2 (plain strings, not ADF).
 *   3. ATTACH every evidence file with its correct Content-Type (an untyped part becomes an opaque
 *      download instead of an inline, playable preview).
 *   4. RE-READ the created issue and print what ACTUALLY landed — fields and attachment list — so a
 *      silent omission cannot pass as success. HTTP 201 is not proof of a well-formed bug.
 *
 * Usage
 *   node automation/file_jira_bug.js --spec <bug.json>          file it
 *   node automation/file_jira_bug.js --spec <bug.json> --dry     validate + preview, no write
 *   node automation/file_jira_bug.js --verify B10-58191          audit an existing bug against the standard
 *
 * Spec shape (JSON) — see the bottom of this file for a complete example:
 *   {
 *     "parent":      "B10-56652",
 *     "combo":       "android-en",              // web | ios-en | ios-ar | android-en | android-ar
 *     "title":       "<specific statement of the actual wrong behaviour>",
 *     "builds":      { "ios": {"version":"2026.31.0","build":"11084"},
 *                      "android": {"version":"2026.31.0","build":"1057"} },   // MOBILE ONLY. Omit for web.
 *     "language":    "Arabic",                  // ONLY when the bug is locale-specific. Omit otherwise.
 *     "precondition":["…"],                     // OMIT unless genuinely mandatory to reproduce
 *     "stepList":    ["Launch the app…", "…"],  // the script numbers them and builds the whole Steps block
 *     "actual":      "…concrete observed values…",
 *     "expected":    "…what should happen + Ref: design node <id> / the AC wording…",
 *     "severity":    "Major",                   // Blocker|Critical|Major|Minor|Enhancement
 *     "priority":    "High",                    // Highest|High|Medium|Low  (omit → mapped from severity)
 *     "testingPhase":"System Testing",          // omit → "System Testing"
 *     "bugType":     "Functional",              // Functional|UI/UX|Change Request |Performance
 *     "environment": "Egypt",                   // KSA|Egypt|Both (KSA, Egypt)   omit → "Egypt"
 *     "platform":    "Android",                 // iOS|Android|Both (iOS/Android)|BE|FE|FE/BE|…
 *     "squad":       ["Card Ops Squad"],
 *     "components":  ["Bcard Cst app"],
 *     "labels":      ["ai-created","qa-found"],
 *     "attachments": ["…/actual-x.png", "…/design-x.png", "…/F-01-x.mp4"]
 *   }
 */

const fs = require('fs');
const path = require('path');
const creds = require('./config/credentials.js');

const BASE = 'https://breadfast.atlassian.net';
const AUTH = creds.jira.authHeader();

// ── The standard, encoded ───────────────────────────────────────────────────
const F = {
  steps: 'customfield_10042',
  actual: 'customfield_10043',
  expected: 'customfield_10044',
  severity: 'customfield_10076',
  testingPhase: 'customfield_10078',
  bugType: 'customfield_10079',
  environment: 'customfield_10348',
  platform: 'customfield_10467',
  squad: 'customfield_10183',
};

// The exact option strings as the B10 schema returns them. Two of these carry a
// TRAILING SPACE ("Enhancement ", "Change Request ") — Jira rejects the trimmed
// form with "Select a valid option", so the spec is matched on trimmed text and
// the exact string is what gets sent. Verified against
// /rest/api/2/issue/createmeta/B10/issuetypes/10084 on 2026-07-29.
const ALLOWED = {
  severity: ['Blocker', 'Critical', 'Major', 'Minor', 'Enhancement '],
  priority: ['Highest', 'High', 'Medium', 'Low'],
  testingPhase: ['System Testing', 'Regression Testing', 'Sanity Testing', 'PM Review'],
  bugType: ['Functional', 'UI/UX', 'Change Request ', 'Performance'],
  environment: ['KSA', 'Egypt', 'Both (KSA, Egypt)'],
  platform: ['iOS', 'Android', 'Huawei', 'Android/Huawei', 'Both (iOS/Android)', 'BE', 'FE', 'FE/BE', 'None'],
  combo: ['web', 'ios-en', 'ios-ar', 'android-en', 'android-ar'],
};

const SEVERITY_TO_PRIORITY = {
  Blocker: 'Highest', Critical: 'High', Major: 'High', Minor: 'Medium', Enhancement: 'Low',
};

/** Resolve a spec value to the schema's exact option string (which may be padded). */
const canon = (key, value) => {
  if (value == null) return value;
  const hit = (ALLOWED[key] || []).find((v) => v.trim() === String(value).trim());
  return hit == null ? value : hit;
};

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain',
  '.json': 'application/json', '.xml': 'application/xml', '.csv': 'text/csv',
};

/**
 * Assemble the Steps field in the canonical B10 shape (operator-corrected 2026-07-28).
 *
 *   Environment:                     ← MOBILE ONLY. Version + Build Number, nothing else.
 *   IOS : Version: 2026.31.0             No device, no locale, no account, no session id.
 *   Build Number: 11084                  WEB bugs carry NO Environment block at all.
 *
 *   Android : Version: 2026.31.0
 *   Build Number: 1057
 *
 *   Language : Arabic               ← ONLY when the bug is locale-specific.
 *
 *   Precondition:                   ← OMIT unless genuinely mandatory to reproduce.
 *   - …
 *
 *   Steps:
 *   1. …
 */
function buildSteps(spec) {
  if (spec.steps) return spec.steps; // escape hatch: pre-assembled block
  const out = [];
  const b = spec.builds || {};
  const isWeb = spec.combo === 'web';
  if (!isWeb && (b.ios || b.android)) {
    out.push('Environment:');
    if (b.ios) out.push(`IOS : Version: ${b.ios.version}`, `Build Number: ${b.ios.build}`, '');
    if (b.android) out.push(`Android : Version: ${b.android.version}`, `Build Number: ${b.android.build}`, '');
  }
  if (spec.language) out.push(`Language : ${spec.language}`, '');
  if (spec.precondition && spec.precondition.length) {
    out.push('Precondition:');
    spec.precondition.forEach((p) => out.push(`- ${p}`));
    out.push('');
  }
  out.push('Steps:');
  (spec.stepList || []).forEach((s, i) => out.push(`${i + 1}. ${s}`));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Hedging / meta-commentary that makes a field read as machine-written rather than as a QA engineer's note.
const AI_TELLS = [
  /\bmeasured from the live\b/i, /\bso these are exact\b/i, /\brather than estimates\b/i,
  /\bnote for triage\b/i, /\bit is worth noting\b/i, /\bit should be noted\b/i,
  /\bthis (?:may|might) (?:well )?be\b/i, /\bplausibly\b/i, /\barguably\b/i,
  /\bin other words\b/i, /\bas such\b/i, /\bthat said\b/i, /\bfurthermore\b/i, /\bmoreover\b/i,
  /\bcomprehensive\b/i, /\brobust\b/i, /\bseamless\b/i, /\bdelve\b/i,
];

// ── Validation — runs BEFORE any write ─────────────────────────────────────
function validate(spec) {
  const errors = [];
  const warn = [];
  const need = ['parent', 'combo', 'title', 'actual', 'expected', 'severity', 'platform', 'squad', 'components'];
  for (const k of need) {
    const v = spec[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) errors.push(`missing required: ${k}`);
  }
  for (const [k, list] of Object.entries(ALLOWED)) {
    if (spec[k] != null && !list.some((v) => v.trim() === String(spec[k]).trim())) {
      errors.push(`${k} = "${spec[k]}" is not allowed. Allowed: ${list.map((v) => `"${v}"`).join(' | ')}`);
    }
  }
  if (spec.description) errors.push('description must be EMPTY for B10 bugs (operator decision 2026-07-28) — put the content in steps/actual/expected');
  if (spec.title) {
    if (/\bAC-?\d+/i.test(spec.title)) errors.push('title contains an AC number — forbidden in the title and in every field');
    if (/^\[System Testing\]\[/.test(spec.title)) errors.push('title must NOT include the prefix — it is added from `combo`; pass the statement only');
    if (spec.title.length < 25) warn.push(`title is short (${spec.title.length} chars) — it must describe the defect on its own`);
  }
  const steps = buildSteps(spec);
  for (const [k, v] of Object.entries({ steps, actual: spec.actual, expected: spec.expected })) {
    if (v && /\bAC-?\d+/i.test(v)) errors.push(`${k} contains an AC number — forbidden in every field; quote the AC's wording instead`);
    if (v && /severity\s*[:=]/i.test(v)) errors.push(`${k} restates Severity — it belongs in the field only`);
  }

  // ── Steps block shape (operator-corrected 2026-07-28) ────────────────────
  const isWeb = spec.combo === 'web';
  const hasBuilds = !!(spec.builds && (spec.builds.ios || spec.builds.android));
  if (!spec.steps && !(spec.stepList && spec.stepList.length)) errors.push('missing required: stepList (or a pre-assembled `steps` block)');
  if (isWeb && hasBuilds) errors.push('WEB bugs carry NO Environment block — drop `builds` for combo "web"');
  if (isWeb && /^\s*Environment\s*:/im.test(steps)) errors.push('WEB bugs carry NO Environment block — remove it from `steps`');
  if (!isWeb && !hasBuilds && !spec.steps) errors.push('mobile bugs need `builds` — e.g. {"ios":{"version":"2026.31.0","build":"11084"}}');
  for (const p of ['ios', 'android']) {
    const v = spec.builds && spec.builds[p];
    if (v && (!v.version || !v.build)) errors.push(`builds.${p} needs both "version" and "build"`);
  }
  // Environment must carry version + build ONLY — no device/locale/account/session noise.
  const envBlock = (steps.match(/^Environment:[\s\S]*?(?=\n\s*\n(?:Language|Precondition|Steps)\s*:|\nSteps\s*:)/im) || [''])[0];
  for (const banned of [/\bDevice\s*:/i, /\bLocale\s*:/i, /\bAccount\s*:/i, /\bsession\b/i, /\bBrowserStack\b/i, /\bbs:\/\//i]) {
    if (banned.test(envBlock)) errors.push(`Environment block must contain Version + Build Number ONLY — remove "${(envBlock.match(banned) || [''])[0]}"`);
  }
  if (spec.language && !/-ar$/.test(spec.combo || '')) {
    warn.push(`"Language : ${spec.language}" is set but combo is "${spec.combo}" — only add Language when the bug is locale-specific`);
  }
  if (spec.precondition && spec.precondition.length) {
    warn.push('Precondition present — OMIT it unless it is genuinely mandatory to reproduce the bug');
  }

  // ── Actual / Expected must read like a QA engineer wrote them ────────────
  for (const k of ['actual', 'expected']) {
    const v = spec[k] || '';
    const tell = AI_TELLS.find((re) => re.test(v));
    if (tell) warn.push(`${k} reads as machine-written ("${(v.match(tell) || [''])[0]}") — state the fact plainly and cut the commentary`);
    const words = v.split(/\s+/).filter(Boolean).length;
    if (words > 90) warn.push(`${k} is ${words} words — trim it; Actual/Expected should be short and direct`);
    if (/^\s*(?:I |We )/m.test(v)) warn.push(`${k} is written in the first person — describe the behaviour, not the tester`);
  }

  // Attachments: the whole point of the standard.
  const att = spec.attachments || [];
  if (!att.length) errors.push('NO ATTACHMENTS. Every B10 bug needs the actual screenshot, the design/expected frame (if a design exists) and a short screen recording.');
  const missing = att.filter((f) => !fs.existsSync(f));
  if (missing.length) errors.push('attachment file(s) not found: ' + missing.join(', '));
  const names = att.map((f) => path.basename(f).toLowerCase());
  if (att.length && !names.some((n) => n.startsWith('actual-'))) warn.push('no `actual-*` screenshot among the attachments');
  if (att.length && !names.some((n) => /\.(mp4|webm)$/.test(n))) warn.push('no screen recording among the attachments — strongly expected');
  if (names.some((n) => /^(image|screenshot|video)\d*\./.test(n))) errors.push('generic attachment name (image1.png / video.webm) — use actual-<slug>.png, design-<slug>.png, F-0N-<slug>.mp4');
  for (const f of att) {
    if (path.extname(f).toLowerCase() === '.webm') warn.push(`${path.basename(f)} is .webm — convert to .mp4 so Jira previews it inline`);
  }
  return { errors, warn };
}

function buildPayload(spec) {
  const severity = canon('severity', spec.severity);
  const fields = {
    project: { key: 'B10' },
    parent: { key: spec.parent },
    issuetype: { id: '10084' }, // Bug — a SUB-TASK in B10
    summary: `[System Testing][${spec.combo}] ${spec.title}`,
    // description is deliberately ABSENT — operator decision 2026-07-28.
    [F.steps]: buildSteps(spec),
    [F.actual]: spec.actual,
    [F.expected]: spec.expected,
    [F.severity]: { value: severity },
    [F.testingPhase]: { value: spec.testingPhase || 'System Testing' },
    [F.bugType]: { value: canon('bugType', spec.bugType) || 'Functional' },
    [F.environment]: { value: canon('environment', spec.environment) || 'Egypt' },
    [F.platform]: { value: canon('platform', spec.platform) },
    [F.squad]: (spec.squad || []).map((value) => ({ value })),
    components: (spec.components || []).map((name) => ({ name })),
    labels: spec.labels && spec.labels.length ? spec.labels : ['ai-created', 'qa-found'],
    priority: { name: spec.priority || SEVERITY_TO_PRIORITY[String(severity).trim()] || 'Medium' },
  };
  return { fields };
}

async function api(pathname, init = {}) {
  const res = await fetch(BASE + pathname, {
    ...init,
    headers: { Authorization: AUTH, Accept: 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, ok: res.ok, json };
}

async function attach(key, files) {
  const results = [];
  for (const file of files) {
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)], { type }), path.basename(file));
    const res = await fetch(`${BASE}/rest/api/3/issue/${key}/attachments`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'X-Atlassian-Token': 'no-check' },
      body: form,
    });
    const body = await res.json().catch(() => null);
    const landed = Array.isArray(body) && body[0];
    results.push({ file: path.basename(file), status: res.status, ok: res.ok, mime: landed ? landed.mimeType : type });
    console.log(`   ${res.ok ? '✓' : '✗'} ${path.basename(file)}  ${res.status}  ${landed ? landed.mimeType : type}`);
  }
  return results;
}

/** Re-read the issue and report it against the standard. HTTP 201 is not proof. */
async function verify(key) {
  const r = await api(`/rest/api/2/issue/${key}?fields=summary,description,attachment,priority,components,labels,${Object.values(F).join(',')}`);
  if (!r.ok) { console.log(`verify ${key} -> ${r.status}`, JSON.stringify(r.json).slice(0, 200)); return false; }
  const f = r.json.fields;
  const opt = (x) => (x && x.value) || (Array.isArray(x) ? x.map((y) => y.value || y.name).join('/') : null);
  const rows = [
    ['Title', f.summary, /^\[System Testing\]\[(web|ios-en|ios-ar|android-en|android-ar)\] .{20,}/.test(f.summary || '')],
    ['Steps', f[F.steps] ? `${String(f[F.steps]).length} chars` : null, !!f[F.steps]],
    ['Actual Result', f[F.actual] ? `${String(f[F.actual]).length} chars` : null, !!f[F.actual]],
    ['Expected Result', f[F.expected] ? `${String(f[F.expected]).length} chars` : null, !!f[F.expected]],
    ['Severity', opt(f[F.severity]), !!f[F.severity]],
    ['Priority', f.priority && f.priority.name, !!f.priority],
    ['Testing Phase', opt(f[F.testingPhase]), !!f[F.testingPhase]],
    ['Bug type', opt(f[F.bugType]), !!f[F.bugType]],
    ['Environment', opt(f[F.environment]), !!f[F.environment]],
    ['Platform', opt(f[F.platform]), !!f[F.platform]],
    ['Squad name', opt(f[F.squad]), !!(f[F.squad] || []).length],
    ['Components', (f.components || []).map((c) => c.name).join(', '), !!(f.components || []).length],
    ['Labels', (f.labels || []).join(', '), !!(f.labels || []).length],
    ['Description EMPTY', f.description ? `${String(f.description).length} chars — SHOULD BE EMPTY` : 'yes', !f.description],
    ['Attachments', `${(f.attachment || []).length}`, (f.attachment || []).length > 0],
  ];
  console.log(`\n── VERIFY ${key} — what actually landed ──`);
  let allOk = true;
  for (const [label, value, ok] of rows) {
    if (!ok) allOk = false;
    console.log(`  ${ok ? '✓' : '✗'} ${String(label).padEnd(18)} ${value == null || value === '' ? '(empty)' : value}`);
  }
  for (const a of f.attachment || []) console.log(`       • ${a.filename}  ${a.mimeType}  ${Math.round(a.size / 1024)}KB`);
  const names = (f.attachment || []).map((a) => a.filename.toLowerCase());
  if (!names.some((n) => n.startsWith('actual-'))) { console.log('  ✗ no actual-*.png attachment'); allOk = false; }
  if (!names.some((n) => /\.(mp4|webm)$/.test(n))) { console.log('  ✗ no screen recording attached'); allOk = false; }
  console.log(allOk ? `\n✓ ${key} conforms to docs/ai/bug-reporting.md §4` : `\n✗ ${key} DOES NOT conform — fix before announcing it`);
  return allOk;
}

// ── main ───────────────────────────────────────────────────────────────────
const arg = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : null; };

(async () => {
  const verifyKey = arg('--verify');
  if (verifyKey) { process.exitCode = (await verify(verifyKey)) ? 0 : 1; return; }

  const specPath = arg('--spec');
  if (!specPath) {
    console.log('usage: node automation/file_jira_bug.js --spec <bug.json> [--dry]   |   --verify <ISSUE-KEY>');
    process.exitCode = 2; return;
  }
  const specs = [].concat(JSON.parse(fs.readFileSync(specPath, 'utf8')));
  const dry = process.argv.includes('--dry');

  // Validate EVERYTHING before writing ANYTHING.
  let bad = false;
  specs.forEach((spec, i) => {
    const { errors, warn } = validate(spec);
    console.log(`\n[${i + 1}/${specs.length}] ${spec.title ? spec.title.slice(0, 90) : '(no title)'}`);
    warn.forEach((w) => console.log('   ! ' + w));
    errors.forEach((e) => console.log('   ✗ ' + e));
    if (errors.length) bad = true;
    else console.log('   ✓ spec valid · summary → ' + `[System Testing][${spec.combo}] ${spec.title}`.slice(0, 110));
  });
  if (bad) { console.log('\nFix the errors above. Nothing was written.'); process.exitCode = 1; return; }

  if (dry) {
    console.log('\n--dry: payload for the first spec:\n' + JSON.stringify(buildPayload(specs[0]), null, 2));
    console.log('\nAll specs valid. Re-run without --dry to file.');
    return;
  }

  for (const spec of specs) {
    const r = await api('/rest/api/2/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(spec)),
    });
    if (!r.ok) { console.log(`\n✗ create failed ${r.status}: ${JSON.stringify(r.json).slice(0, 400)}`); process.exitCode = 1; continue; }
    const key = r.json.key;
    console.log(`\n✓ created ${key} — ${BASE}/browse/${key}`);
    console.log('  attaching evidence:');
    await attach(key, spec.attachments || []);
    await verify(key);
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });

/* ── Example spec — MOBILE ───────────────────────────────────────────────────
The script assembles the Steps block, so the Environment shape cannot be got wrong.
Keep `actual` and `expected` short and factual: state what happened, state what should happen,
cite the authority. No methodology notes, no hedging, no "note for triage" essays.

[{
  "parent": "B10-56652",
  "combo": "android-en",
  "title": "\"Card perks\" carousel renders a 6th card when more than 5 perks are eligible",
  "builds": { "ios":     { "version": "2026.31.0", "build": "11084" },
              "android": { "version": "2026.31.0", "build": "1057"  } },
  "stepList": [
    "Log in and open the Pay tab.",
    "Enter passcode 123321, then the Pay-access OTP (last 4 digits of the number).",
    "Tap \"Not now\" on the \"Save card for a faster checkout\" interstitial.",
    "Scroll to the \"Card perks\" section.",
    "Swipe the carousel to its end and count the cards."
  ],
  "actual":   "Six cards are reachable: CC_8, CC_6, CC_2, CC_3, CC_7, CC_4.",
  "expected": "Exactly five cards are reachable and the carousel stops at the fifth.\n\nRef: design node 9163-7909.",
  "severity": "Major",
  "platform": "Android",
  "squad": ["Card Ops Squad"],
  "components": ["Bcard Cst app"],
  "attachments": ["…/actual-carousel-six-cards.png", "…/design-pay-home.png", "…/F-01-carousel-six-cards.mp4"]
}]

── Example spec — WEB (note: NO `builds`, so NO Environment block) ───────────
[{
  "parent": "B10-56750",
  "combo": "web",
  "title": "\"Add section\" modal has no X close icon to dismiss it",
  "stepList": ["Open Card Perks and click \"Add perk\".", "Select any Perk type.",
               "Open the \"Section (Mobile display)\" dropdown and click \"+ Add section\".",
               "Inspect the modal title bar for a close (X) control."],
  "actual":   "No X control in the modal header. The only ways out are \"Cancel\" and Escape.",
  "expected": "An X in the top-right of the modal header dismisses the modal and saves nothing.\n\nRef: design node 5893-401780.",
  "severity": "Major",
  "platform": "FE",
  "squad": ["Card Core"],
  "components": ["Bcard Dashboard"],
  "attachments": ["…/actual-modal-no-X.png", "…/design-modal-with-X.png", "…/F-01-no-x-close-icon.mp4"]
}]

Add "language": "Arabic" ONLY when the bug is locale-specific (combo ending -ar).
Add "precondition": ["…"] ONLY when it is genuinely mandatory to reproduce.
─────────────────────────────────────────────────────────────────────────── */
