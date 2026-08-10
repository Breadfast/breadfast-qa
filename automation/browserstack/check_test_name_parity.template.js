'use strict';
/**
 * Offline guard: every BrowserStack test-case name must appear VERBATIM as an automated test title,
 * or be explicitly declared here as not-automated with a reason.
 *
 * Why this exists: the run maps automated results onto BrowserStack cases by NAME. Edit a name on one
 * side only and results silently land on the wrong case, or nowhere. This check catches that in a
 * second — no browser, no device, no environment — so it can run even while the card backend is down.
 *
 * This story's automation lives in TWO mirrored Java classes (iOS + Android), where the title is
 * @Test(description = "...") and the case id is @TmsLink("TC-xxxxx"). Both must carry the SAME titles
 * and the SAME ids, so the guard checks: verbatim title parity, @TmsLink coverage, and iOS/Android
 * mirror equality.
 *
 * Usage:  node check_test_name_parity.js
 */
const fs = require('fs');
const path = require('path');
const { cases } = require('./cases.js');
const framework = require('../../automation/config/framework');

const CLASSES = {
  android: 'src/test/java/customerApp/androidNative/payHome/B10_56711_PerkDetailsTests.java',
  ios: 'src/test/java/customerApp/iosNative/payHome/B10_56711_PerkDetailsTests.java',
};

/** Cases deliberately NOT automated, with the reason. Anything else missing is a failure. */
const NOT_AUTOMATED = new Map([
  ['TC-02', 'AC1 — "one full-bleed cover image and no second background border" is the ABSENCE of a decorative element; nothing in the tree distinguishes one image from two stacked. Figma-vs-build visual comparison.'],
  ['TC-03', 'AC2 — logo circularity and its overlap of the cover image are geometric, i.e. visual.'],
  ['TC-04', 'AC3 — the assertion that matters is the title/tagline VERTICAL POSITION relative to the logo; Android clips bounds to the viewport. Visual.'],
  ['TC-05', 'AC3 — same geometric reason; the absent-tagline case is judged on layout collapse, which is visual.'],
  ['TC-09', 'AC6 — the clipboard leg needs a paste target outside the app. The copy CONTROL and the AC7 confirmation are asserted by TC-10; clipboard content is verified manually.'],
  ['TC-23', 'AC1–AC13 in ar/EG — RTL mirroring and per-locale artwork are visual comparisons.'],
]);

const frameworkPath = framework.resolve();
if (!frameworkPath) {
  console.error('check_test_name_parity: the Java framework could not be located.');
  console.error('  Set QA_FRAMEWORK_PATH to the folder containing pom.xml, then re-run.');
  process.exit(2);
}

const read = (rel) => {
  const p = path.join(frameworkPath, rel);
  if (!fs.existsSync(p)) {
    console.error(`check_test_name_parity: missing ${p}`);
    process.exit(2);
  }
  return fs.readFileSync(p, 'utf8');
};

/** description + TmsLink pairs, in file order. */
function parseClass(source) {
  const out = [];
  const re = /description\s*=\s*"((?:[^"\\]|\\.)*)"[\s\S]{0,400}?@TmsLink\("(TC-\d+)"\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({ title: m[1].replace(/\\"/g, '"'), tms: m[2] });
  }
  return out;
}

const parsed = Object.fromEntries(Object.entries(CLASSES).map(([k, rel]) => [k, parseClass(read(rel))]));
const bsIdFor = (index) => `TC-${54242 + index}`;

let failures = 0;
const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures++; };

console.log(`framework: ${frameworkPath}`);
console.log(`android tests parsed: ${parsed.android.length} · ios tests parsed: ${parsed.ios.length}\n`);

console.log('1. Every case is either automated with a VERBATIM title, or declared not-automated');
cases.forEach((c, i) => {
  const expectedTms = bsIdFor(i);
  const declared = NOT_AUTOMATED.has(c.id);
  const hit = parsed.android.find((t) => t.title === c.title);
  if (declared) {
    if (hit) fail(`${c.id} is declared NOT automated but a test titled "${c.title}" exists`);
    return;
  }
  if (!hit) {
    fail(`${c.id} "${c.title}" has no automated test with that title verbatim`);
    return;
  }
  if (hit.tms !== expectedTms) {
    fail(`${c.id} "${c.title}" carries @TmsLink("${hit.tms}") but the uploaded case is ${expectedTms}`);
  }
});

console.log('\n2. iOS and Android are exact mirrors (same titles, same @TmsLink ids, same order)');
if (parsed.ios.length !== parsed.android.length) {
  fail(`test counts differ: android ${parsed.android.length} vs ios ${parsed.ios.length}`);
} else {
  parsed.android.forEach((a, i) => {
    const b = parsed.ios[i];
    if (a.title !== b.title) fail(`position ${i}: android "${a.title}" vs ios "${b.title}"`);
    if (a.tms !== b.tms) fail(`position ${i} (${a.title}): android ${a.tms} vs ios ${b.tms}`);
  });
}

console.log('\n3. No duplicate @TmsLink ids within a class');
for (const [platform, tests] of Object.entries(parsed)) {
  const seen = new Set();
  tests.forEach((t) => {
    if (seen.has(t.tms)) fail(`${platform}: ${t.tms} is used by more than one test`);
    seen.add(t.tms);
  });
}

const automatedCount = cases.length - NOT_AUTOMATED.size;
console.log(`\ncases: ${cases.length} · automated: ${automatedCount} · declared manual: ${NOT_AUTOMATED.size}`);
console.log(failures === 0 ? 'PARITY OK' : `PARITY FAILED — ${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
