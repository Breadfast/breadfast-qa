'use strict';

/**
 * Compare the Selenium (Java/TestNG) and Playwright suites on the SAME BrowserStack cases, from
 * each runner's machine-readable output rather than by eyeballing logs.
 *
 *   Selenium  : <java framework>/target/surefire-reports/testng-results.xml  (path resolved)
 *   Playwright: <storyDir>/execution-reports/playwright-results.json
 *
 * Both suites use the BrowserStack case NAME as the test title, so the two runs join on that name —
 * no hand-maintained mapping. Anything that fails to join is reported, not silently dropped.
 *
 * Usage: node automation/browserstack/compare_stacks.js --story-dir B10-xxxxx [--md]
 */
const fs = require('fs');
const path = require('path');

// Promoted 2026-08-10 out of a story folder. The story dir is an argument and the Java framework
// is resolved (never a hardcoded drive letter):
//   node automation/browserstack/compare_stacks.js --story-dir B10-xxxxx [--md]
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const STORY_DIR = path.resolve(argOf('--story-dir', process.cwd()));
const framework = require('../config/framework');

const frameworkRoot = framework.resolve();
if (!frameworkRoot) {
  console.error('compare_stacks: the Java framework could not be located.');
  console.error('  Set QA_FRAMEWORK_PATH to the folder containing pom.xml, then re-run.');
  process.exit(1);
}

const TESTNG_XML = path.join(frameworkRoot, 'target', 'surefire-reports', 'testng-results.xml');
const PW_JSON = path.join(STORY_DIR, 'execution-reports', 'playwright-results.json');
const CASE_MAP = path.join(STORY_DIR, 'automation', 'browserstack_case_map.json');
const AS_MD = process.argv.includes('--md');

// ask-never-block: name the missing input rather than throwing an ENOENT stack.
if (!fs.existsSync(CASE_MAP)) {
  console.error(`compare_stacks: cannot find the BrowserStack case map:\n  ${CASE_MAP}`);
  console.error('  -> it lists the cases both stacks ran, as { "cases": [ { "id": "TC-xxxxx", "title": "…" } ] }');
  console.error(`  (story dir resolved from --story-dir; currently "${STORY_DIR}")`);
  process.exit(1);
}

const cases = JSON.parse(fs.readFileSync(CASE_MAP, 'utf8')).cases;

/**
 * TestNG XML → { [title]: {status, ms, message, attempts} }. Read with a regex: no XML dep here.
 *
 * Both stacks retry once, so both can record more than one attempt per case. The LAST attempt is
 * the verdict and the count is the flake signal — reading the first attempt on one side and the
 * last on the other would make one stack look worse than it is.
 */
function readSelenium() {
  if (!fs.existsSync(TESTNG_XML)) return null;
  const xml = fs.readFileSync(TESTNG_XML, 'utf8');
  const out = {};
  const attempts = {};
  // <test-method status="FAIL" ... description="..." duration-ms="..." name="...">
  for (const m of xml.matchAll(/<test-method\b([^>]*)>([\s\S]*?)<\/test-method>|<test-method\b([^>]*)\/>/g)) {
    const attrs = m[1] || m[3] || '';
    const body = m[2] || '';
    const get = (k) => (attrs.match(new RegExp(`${k}="([^"]*)"`)) || [])[1];
    if (get('is-config') === 'true') continue;
    const description = decode(get('description') || '');
    if (!description) continue;
    const msg = (body.match(/<message>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/message>/) || [])[1]
      || (body.match(/<message>([\s\S]*?)<\/message>/) || [])[1] || '';
    attempts[description] = (attempts[description] || 0) + 1;
    out[description] = {
      status: (get('status') || '').toUpperCase(),
      ms: Number(get('duration-ms') || 0),
      message: decode(msg).replace(/\s+/g, ' ').trim().slice(0, 300),
      method: get('name'),
      attempts: attempts[description],
    };
  }
  return out;
}

/** Playwright JSON → { [title]: {status, ms, message, attempts} }. */
function readPlaywright() {
  if (!fs.existsSync(PW_JSON)) return null;
  const report = JSON.parse(fs.readFileSync(PW_JSON, 'utf8'));
  const out = {};
  const walk = (suites) => {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) {
        const run = (spec.tests || [])[0];
        const results = (run && run.results) || [];
        const result = results[results.length - 1];      // the retry, when there was one
        out[spec.title] = {
          status: result ? String(result.status).toUpperCase() : 'UNKNOWN',
          // The wall-clock cost of a case is every attempt, not only the one that counted.
          ms: results.reduce((n, r) => n + Number(r.duration || 0), 0),
          attempts: results.length,
          message: result && result.error
            ? String(result.error.message || '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').trim().slice(0, 300)
            : '',
          file: suite.file || '',
        };
      }
      walk(suite.suites);
    }
  };
  walk(report.suites);
  return out;
}

// Numeric character references must be decoded too, not just the named ones: TestNG writes an
// apostrophe as &#039;, so a title like "the new perk's own category" failed to join and TC-53958
// was reported as NOT AUTOMATED on the Selenium side while its test had in fact passed.
// &amp; is unescaped LAST so that an encoded "&amp;#039;" cannot turn into an apostrophe.
const decode = (s) => String(s)
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const norm = (s) => ({ PASS: 'PASS', PASSED: 'PASS', FAIL: 'FAIL', FAILED: 'FAIL', SKIP: 'SKIP', SKIPPED: 'SKIP', TIMEDOUT: 'FAIL', INTERRUPTED: 'SKIP' }[s] || s || '—');

const selenium = readSelenium();
const playwright = readPlaywright();
const secs = (ms) => (ms ? (ms / 1000).toFixed(1) + 's' : '—');

if (!selenium) console.log(`NOTE: no Selenium results at ${TESTNG_XML}`);
if (!playwright) console.log(`NOTE: no Playwright results at ${PW_JSON}`);

const rows = cases.map((c) => {
  const s = selenium && selenium[c.title];
  const p = playwright && playwright[c.title];
  return {
    id: c.id,
    title: c.title,
    sel: s ? norm(s.status) : 'NOT AUTOMATED',
    selMs: s ? s.ms : 0,
    selMsg: s ? s.message : '',
    selAttempts: s ? (s.attempts || 1) : 0,
    pw: p ? norm(p.status) : 'NOT AUTOMATED',
    pwMs: p ? p.ms : 0,
    pwMsg: p ? p.message : '',
    pwAttempts: p ? (p.attempts || 1) : 0,
  };
});

const tally = (key) => rows.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
const total = (key) => rows.reduce((n, r) => n + r[key], 0);
const agree = rows.filter((r) => r.sel === r.pw).length;
const disagree = rows.filter((r) => r.sel !== r.pw);

// A retried case is a flake signal on either stack, so show the attempt count next to the verdict.
const verdict = (status, attempts) => (attempts > 1 ? `${status} (${attempts}x)` : status);

if (AS_MD) {
  console.log('| Case | Selenium | Playwright | Sel time | PW time | Agree |');
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.id} | ${verdict(r.sel, r.selAttempts)} | ${verdict(r.pw, r.pwAttempts)} `
      + `| ${secs(r.selMs)} | ${secs(r.pwMs)} | ${r.sel === r.pw ? 'yes' : '**no**'} |`);
  }
} else {
  console.log(`\n${'CASE'.padEnd(10)}${'SELENIUM'.padEnd(20)}${'PLAYWRIGHT'.padEnd(20)}${'SEL'.padEnd(9)}${'PW'.padEnd(9)}AGREE`);
  for (const r of rows) {
    console.log(r.id.padEnd(10) + verdict(r.sel, r.selAttempts).padEnd(20) + verdict(r.pw, r.pwAttempts).padEnd(20)
      + secs(r.selMs).padEnd(9) + secs(r.pwMs).padEnd(9) + (r.sel === r.pw ? '' : 'NO'));
  }
}

const retried = (key) => rows.filter((r) => r[key] > 1).length;
console.log(`\nselenium   : ${JSON.stringify(tally('sel'))}  total ${secs(total('selMs'))}  retried ${retried('selAttempts')}`);
console.log(`playwright : ${JSON.stringify(tally('pw'))}  total ${secs(total('pwMs'))}  retried ${retried('pwAttempts')}`);
console.log(`verdict agreement: ${agree}/${rows.length}`);
if (disagree.length) {
  console.log('\ndisagreements (same case, different verdict):');
  for (const r of disagree) {
    console.log(`  ${r.id}  sel=${r.sel}  pw=${r.pw}\n      ${r.title.slice(0, 96)}`);
    if (r.selMsg) console.log(`      sel: ${r.selMsg.slice(0, 160)}`);
    if (r.pwMsg) console.log(`      pw : ${r.pwMsg.slice(0, 160)}`);
  }
}

// Failure messages matter as much as the verdict: a defect is only actionable if the message says why.
const failed = rows.filter((r) => r.sel === 'FAIL' || r.pw === 'FAIL');
if (failed.length) {
  console.log('\nfailure messages (diagnostic quality comparison):');
  for (const r of failed) {
    console.log(`\n  ${r.id} — ${r.title.slice(0, 90)}`);
    console.log(`    SELENIUM  : ${r.selMsg || '(no message / not automated)'}`);
    console.log(`    PLAYWRIGHT: ${r.pwMsg || '(no message / not automated)'}`);
  }
}

fs.writeFileSync(path.join(STORY_DIR, 'execution-reports', 'stack-comparison.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), rows,
    summary: { selenium: tally('sel'), playwright: tally('pw'),
      seleniumTotalMs: total('selMs'), playwrightTotalMs: total('pwMs'),
      seleniumRetried: retried('selAttempts'), playwrightRetried: retried('pwAttempts'),
      agreement: `${agree}/${rows.length}` } }, null, 2));
