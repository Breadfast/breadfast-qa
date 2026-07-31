'use strict';
/**
 * B10-57806 — BCard sign-up expiry-warning probe runner (Android; iOS handled by the Java framework).
 *
 * Usage:
 *   node run-expiry-probe.js <+20phone> <en|ar> <caseKey[,caseKey...]> [nationalId] [--continue]
 *
 * All expiry dates come from `expiry-dates.js`, derived from the DEVICE clock at run time — no literals,
 * so the same command yields the same verdicts on any calendar day.
 *
 * A case whose `expect` is 'warn' or 'nowarn' is ASSERTED. 'disputed' and 'unspecified' are REPORTED only:
 * the ACs do not define the 2-month boundary and say nothing about an already-expired ID, and per
 * CLAUDE.md §8.1 a clarification-gate answer is not a spec.
 */
const { bsReq, sleep, screenshot } = require('d:/breadfast-qa/bs_helper.js');
const { fetchOtp } = require('d:/breadfast-qa/B10-57806/automation/otp-google-chat.js');
const { deviceToday, buildCases, clampIsObservable, toIso } = require('./expiry-dates.js');
const fs = require('fs');

const args = process.argv.slice(2).filter((a) => a !== '--continue');
const TAP_CONTINUE = process.argv.includes('--continue');
const [PHONE, LOCALE = 'en', KEYS = '', NID = '28812092825919'] = args;
const APP = 'bs://f1f7d2d591861869c00cd10caafe482b2843d8ab';
const OUT = 'd:/breadfast-qa/B10-57806/screenshots';
const DUMP = 'd:/breadfast-qa/B10-57806/evidence';
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(DUMP, { recursive: true });

// Several content-desc test IDs are LOCALIZED in the Arabic build, so never key off English strings.
const L = {
  en: { apply: 'Apply', next: 'Next', submit: 'Submit', cont: 'Continue', back: 'Go back', step2: 'Enter your ID information', step3: 'Complete card setup', sheet: 'Renew ID before pickup' },
  ar: { apply: 'قدّم الطلب', next: 'التالي', submit: 'إرسال', cont: 'متابعة', back: 'الرجوع', step2: 'ادخل بيانات بطاقتك الشخصية', step3: 'إكمال إعداد البطاقة', sheet: 'جدد بطاقتك قبل الاستلام' },
}[LOCALE];

let sid = null;
const src = async () => (await bsReq('GET', `/wd/hub/session/${sid}/source`)).value || '';
async function find(xp) {
  const r = await bsReq('POST', `/wd/hub/session/${sid}/element`, { using: 'xpath', value: xp });
  return r.value ? (r.value.ELEMENT || r.value['element-6066-11e4-a52e-4f735466cecf']) : null;
}
/** Poll for an element instead of sleeping a fixed amount — the flow's timings vary a lot. */
async function waitFor(xp, label, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const e = await find(xp);
    if (e) return e;
    await sleep(1500);
  }
  console.log(`  [timeout] ${label}`);
  return null;
}
async function clickWhen(xp, label, timeoutMs) {
  const e = await waitFor(xp, label, timeoutMs);
  if (!e) return false;
  await bsReq('POST', `/wd/hub/session/${sid}/element/${e}/click`, {});
  console.log(`  [tap ] ${label}`);
  return true;
}
async function typeInto(xp, text, label) {
  const e = await waitFor(xp, label);
  if (!e) return false;
  await bsReq('POST', `/wd/hub/session/${sid}/element/${e}/click`, {}); await sleep(500);
  await bsReq('POST', `/wd/hub/session/${sid}/element/${e}/value`, { text, value: text.split('') });
  console.log(`  [type] ${label}`);
  return true;
}
async function tap(x, y, label) {
  await bsReq('POST', `/wd/hub/session/${sid}/actions`, { actions: [{ type: 'pointer', id: 'f1', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, x, y }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 90 }, { type: 'pointerUp', button: 0 }] }] });
  console.log(`  [tap ] (${x},${y}) ${label}`);
}
async function snap(name) {
  const x = await src();
  fs.writeFileSync(`${DUMP}/probe-${LOCALE}-${name}.xml`, x);
  await screenshot(sid, `${OUT}/probe-${LOCALE}-${name}.png`);
  return x;
}
const D = (i) => `(//android.widget.EditText)[${i}]`;

(async () => {
  const caps = {
    platformName: 'android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': APP,
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 900,
    'appium:language': LOCALE === 'ar' ? 'ar' : 'en',
    'appium:locale': LOCALE === 'ar' ? 'EG' : 'US',
    'bstack:options': {
      deviceName: 'Samsung Galaxy S23', osVersion: '13.0',
      projectName: 'B10-57806 ID Expiry Warning', buildName: 'B10-57806 expiry probe',
      sessionName: `probe-${LOCALE}-${PHONE}`, debug: true, networkLogs: true, video: true,
    },
  };
  const r = await bsReq('POST', '/wd/hub/session', { capabilities: { alwaysMatch: caps, firstMatch: [{}] } });
  sid = (r.value && r.value.sessionId) || r.sessionId;
  if (!sid) { console.log('SESSION FAILED ' + JSON.stringify(r).slice(0, 300)); process.exit(1); }
  fs.writeFileSync('d:/breadfast-qa/B10-57806/current_session.txt', sid);
  console.log(`session ${sid}  locale=${LOCALE}  phone=${PHONE}  nid=${NID}`);

  const results = [];
  try {
    await sleep(15000);
    await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`, { settings: { allowInvisibleElements: true } });

    const { date: today, source, raw } = await deviceToday(bsReq, sid);
    const clamp = clampIsObservable(today);
    console.log(`  device date = ${toIso(today)}  (source: ${source}, raw: ${raw})`);
    console.log(`  threshold   = ${clamp.clampedThresholdIso}  | naive overflow would be ${clamp.naiveOverflowIso} | clamp observable today: ${clamp.observable}`);
    const all = buildCases(today);
    const chosen = KEYS ? KEYS.split(',').map((k) => all.find((c) => c.key === k.trim())).filter(Boolean) : all;
    console.log('  cases: ' + chosen.map((c) => `${c.key}=${c.display}(${c.expect})`).join(', '));

    // --- login ---
    await tap(700, 1842, 'mobile field');
    await sleep(3500);
    await typeInto("//android.view.View[@content-desc='phoneNumber_txtField']//android.widget.EditText", PHONE.replace('+20', ''), 'phone');
    const sentAt = Date.now();
    await clickWhen("//android.view.View[@content-desc='next_btn']", 'Next');
    const otp = await fetchOtp(PHONE, { timeoutMs: 90000, notBefore: sentAt - 60000 });
    console.log('  login OTP = ' + (otp && otp.otp));
    if (!otp) throw new Error('login OTP not received');
    await typeInto('//android.widget.EditText', otp.otp, 'login otp');
    await sleep(14000);

    // --- Pay -> card application -> step 2/3 ---
    // Tap Pay by its test id, NOT by coordinate: the bottom bar has 3 items for an out-of-zone account
    // (Home/Pay/More) and 5 for an in-zone one (Home/Search/Cart/Pay/More), so a fixed x lands on Cart.
    if (!await clickWhen("//*[@content-desc='bottomBar_pay_btn']", 'Pay tab', 30000)) {
      await tap(540, 2035, 'Pay tab (coordinate fallback)');
    }
    // The Pay page intermittently fails to load ("Something went wrong" + Try again). Recover rather than
    // reporting a false "account already applied".
    let applyOk = false;
    for (let attempt = 1; attempt <= 4 && !applyOk; attempt++) {
      applyOk = await clickWhen(`//*[@content-desc='${L.apply}']`, `Apply (attempt ${attempt})`, attempt === 1 ? 45000 : 30000);
      if (applyOk) break;
      const page = await src();
      if (/Something went wrong|حدث خطأ ما/.test(page)) {
        console.log('  [recover] Pay page error — tapping Try again');
        if (!await clickWhen("//*[@text='Try again' or @content-desc='Try again' or @text='إعادة المحاولة']", 'Try again', 15000)) {
          await tap(540, 1240, 'Try again (coordinate fallback)');
        }
        await sleep(9000);
      } else {
        console.log('  [recover] re-selecting the Pay tab');
        await clickWhen("//*[@content-desc='bottomBar_pay_btn']", 'Pay tab (retry)', 15000);
        await sleep(8000);
      }
    }
    if (!applyOk) { await snap('pay-no-apply'); throw new Error('Apply never appeared after recovery attempts'); }
    if (!await clickWhen(`//*[@content-desc='${L.next}']`, 'Next (intro)', 45000)) throw new Error('intro Next never appeared');
    await sleep(6000);
    await typeInto('//android.widget.EditText', PHONE.slice(-4), 'card OTP 1/3 (last 4 of phone)');
    await sleep(11000);
    const s2 = await snap('step2of3');
    if (!s2.includes(L.step2)) throw new Error('did not reach step 2 of 3');
    console.log('  reached step 2 of 3');

    await typeInto(D(1), 'وليد', 'first name'); await sleep(700);
    await typeInto(D(2), 'احمد سليم', 'remaining name'); await sleep(700);
    await typeInto(D(3), NID, 'national id'); await sleep(700);

    // --- the scenarios ---
    for (const c of chosen) {
      const el = await find(D(4));
      await bsReq('POST', `/wd/hub/session/${sid}/element/${el}/click`, {}); await sleep(500);
      await bsReq('POST', `/wd/hub/session/${sid}/element/${el}/clear`, {}); await sleep(800);
      await bsReq('POST', `/wd/hub/session/${sid}/element/${el}/value`, { text: c.digits, value: c.digits.split('') });
      await sleep(1600);

      // never trust the write — read the field back before submitting
      const before = await src();
      const shown = (before.match(/<android\.widget\.EditText[^>]*text="([^"]*)"/g) || [])[3] || '';
      const fieldOk = shown.includes(c.display);
      if (!fieldOk) console.log(`  [warn] field shows ${JSON.stringify(shown)} but expected ${JSON.stringify(c.display)}`);

      await clickWhen(`//*[@content-desc='${L.submit}']`, `Submit ${c.display}`);
      await sleep(6500);
      const x = await snap(`case-${c.key}`);
      const warned = x.includes(L.sheet);
      const advanced = x.includes(L.step3);

      let verdict;
      if (c.expect === 'warn') verdict = warned ? 'PASS' : 'FAIL';
      else if (c.expect === 'nowarn') verdict = (!warned && advanced) ? 'PASS' : 'FAIL';
      else verdict = 'REPORT-ONLY';
      results.push({ case: c.key, date: c.display, expect: c.expect, warned, advanced, fieldVerified: fieldOk, verdict });
      console.log(`  >>> ${c.key.padEnd(15)} ${c.display}  warned=${warned} advanced=${advanced}  [${verdict}]`);

      if (warned) {
        if (TAP_CONTINUE && c === chosen[chosen.length - 1]) {
          await clickWhen(`//*[@content-desc='${L.cont}']`, 'Continue (AC-2)');
          await sleep(14000);
          const y = await snap('after-continue');
          const ok = y.includes(L.step3);
          results.push({ case: 'AC-2 Continue', date: c.display, expect: 'advance to 3/3', warned: false, advanced: ok, fieldVerified: true, verdict: ok ? 'PASS' : 'FAIL' });
          console.log(`  >>> AC-2 Continue -> reached 3/3 = ${ok}  [${ok ? 'PASS' : 'FAIL'}]`);
          break;
        }
        await clickWhen(`//*[@content-desc='${L.back}']`, 'Go back');
        await sleep(4500);
      } else {
        console.log('  (no warning -> advanced; account consumed, stopping)');
        break;
      }
    }
  } catch (e) {
    console.log('ERROR ' + e.message);
    try { await snap('error'); } catch (_) { }
  } finally {
    console.log('\n=== RESULTS ===');
    console.table ? console.table(results) : console.log(JSON.stringify(results, null, 2));
    try { await bsReq('DELETE', `/wd/hub/session/${sid}`); console.log('session closed'); } catch (_) { }
  }
})();
