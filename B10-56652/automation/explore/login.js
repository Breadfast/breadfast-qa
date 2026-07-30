'use strict';
/**
 * Drives customer-app login up to the Home screen, then into Pay.
 *
 * Locators mirror the canonical Java framework's androidNative/iosNative page objects
 * (content-desc based) — see modals/customerApp/androidNative/AndroidNativeLandingScreen,
 * AndroidNativePhoneNumberScreen, AndroidNativeOtpVerificationScreen, AndroidPasscodeScreen.
 * Login OTP comes from Google Chat (otp.js); the Pay-access OTP is the last 4 digits of the
 * account's mobile number (operator instruction 2026-07-28 + docs/ai/browserstack-process.md).
 *
 *   node login.js android en
 */
const fs = require('fs');
const path = require('path');
const { bsReq, sleep, screenshot, getSource, findElement, findElements, clickEl, typeText, tap } =
  require('../../../bs_helper.js');
const session = require('./session.js');
const otp = require('./otp.js');

const ACCOUNT = { local: '1064507660', e164: '+201064507660', passcode: '123321' };
const PAY_OTP = ACCOUNT.e164.slice(-4); // 7660

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let shotSeq = 0;
async function shot(sid, label) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const name = `${String(++shotSeq).padStart(2, '0')}_${label}.png`;
  await screenshot(sid, path.join(SHOTS, name));
  return name;
}

async function find(sid, xpath, { timeoutMs = 20000, pollMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = await findElement(sid, 'xpath', xpath);
    if (el) return el;
    await sleep(pollMs);
  }
  return null;
}

async function present(sid, xpath) {
  return (await findElements(sid, 'xpath', xpath)).length > 0;
}

async function step(sid, label, fn) {
  process.stdout.write(`→ ${label} ... `);
  const out = await fn();
  console.log('ok');
  return out;
}

async function run(platform, locale) {
  const { sid, created } = await session.ensure(platform, locale);
  console.log(`session ${sid} (${created ? 'new' : 'reused'})`);
  await sleep(created ? 12000 : 1000);
  await shot(sid, `${platform}-${locale}-01-launch`);

  const isAndroid = platform === 'android';
  const L = {
    authBtn: isAndroid
      ? "//android.view.View[@content-desc='onBoardingScreen_loginOrSignUp_btn']"
      : "//*[@name='onBoardingScreen_loginOrSignUp_btn']",
    phoneField: isAndroid
      ? "//android.view.View[@content-desc='phoneNumber_txtField']//android.widget.EditText"
      : "//*[@name='phoneNumber_txtField']//XCUIElementTypeTextField",
    nextBtn: isAndroid
      ? "//android.view.View[@content-desc='next_btn']"
      : "//*[@name='next_btn']",
    otpField: isAndroid ? '//android.widget.EditText' : '//XCUIElementTypeTextField',
    verifyBtn: isAndroid
      ? "//android.view.View[@content-desc='verify_btn']"
      : "//*[@name='verify_btn']",
  };

  // ---- landing → phone number ----
  const auth = await find(sid, L.authBtn, { timeoutMs: 45000 });
  if (auth) {
    await step(sid, 'tap login/sign-up', () => clickEl(sid, auth));
    await sleep(4000);
  } else {
    console.log('! landing auth button not found — app may already be past onboarding');
  }
  await shot(sid, `${platform}-${locale}-02-phone-screen`);

  const phone = await find(sid, L.phoneField, { timeoutMs: 25000 });
  if (!phone) throw new Error('phone number field not found');
  const marker = await otp.marker(ACCOUNT.e164);
  await step(sid, `enter phone ${ACCOUNT.local}`, () => typeText(sid, phone, ACCOUNT.local));
  await sleep(1500);
  await shot(sid, `${platform}-${locale}-03-phone-entered`);

  const next = await find(sid, L.nextBtn, { timeoutMs: 10000 });
  if (!next) throw new Error('next button not found');
  await step(sid, 'submit phone', () => clickEl(sid, next));
  await sleep(6000);
  await shot(sid, `${platform}-${locale}-04-otp-screen`);

  // ---- OTP from Google Chat ----
  const { otp: code, createTime } = await otp.waitForOtp(ACCOUNT.e164, { after: marker, timeoutMs: 150000 });
  console.log(`   OTP ${code} (created ${createTime}, marker ${marker})`);
  const otpField = await find(sid, L.otpField, { timeoutMs: 15000 });
  if (!otpField) throw new Error('OTP field not found');
  await step(sid, 'enter OTP', () => typeText(sid, otpField, code));
  await sleep(3000);
  await shot(sid, `${platform}-${locale}-05-otp-entered`);

  if (await present(sid, L.verifyBtn)) {
    const v = await find(sid, L.verifyBtn, { timeoutMs: 5000 });
    if (v) { await step(sid, 'tap verify', () => clickEl(sid, v)); }
  }
  await sleep(12000);
  await shot(sid, `${platform}-${locale}-06-after-login`);

  const src = await getSource(sid);
  fs.writeFileSync(path.join(SHOTS, `${platform}-${locale}-after-login-source.xml`), src);
  console.log(`   page source ${src.length} chars → screenshots/${platform}-${locale}-after-login-source.xml`);
  console.log('DONE login stage. Account', ACCOUNT.e164, '| passcode', ACCOUNT.passcode, '| Pay OTP', PAY_OTP);
  return sid;
}

module.exports = { run, ACCOUNT, PAY_OTP, find, present, shot, step };

if (require.main === module) {
  const [platform = 'android', locale = 'en'] = process.argv.slice(2);
  run(platform, locale).catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
