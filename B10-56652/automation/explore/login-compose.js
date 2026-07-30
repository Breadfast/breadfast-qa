'use strict';
/**
 * Login driver for the CURRENT build's Jetpack-Compose customer app (Android) /
 * SwiftUI-style iOS equivalent — locators discovered live 2026-07-28, they differ from the
 * framework's older androidNative page objects (which expect `content-desc` on
 * `android.view.View`; this build exposes Compose test tags as `resource-id`).
 *
 * Observed Android flow:
 *   onboarding carousel (resource-id `phone_input_clickable_component`, `skip_onboarding_button`)
 *     → tap it → login screen (`login_screen_container`, `phoneNumber_countryCode`,
 *       `phone_txtField_container`, `next_btn`)
 *     → OTP screen (`otp_textField`, `verify_btn`, `otpScreen_didntGetCode_btn`)
 *     → Home (`bottomBar_home_btn` / `bottomBar_pay_btn` / `bottomBar_more_btn`)
 *
 *   node login-compose.js <platform> <locale> <localPhone>
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource, findElement, typeText, tap, bsReq } = require('../../../bs_helper.js');
const session = require('./session.js');
const { inventory, centre } = require('./drive.js');
const otp = require('./otp.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');

async function src(sid) { return getSource(sid); }

async function rows(sid) { return inventory(await src(sid)); }

async function findRow(sid, pred, { timeoutMs = 30000, pollMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = (await rows(sid)).find(pred);
    if (hit) return hit;
    await sleep(pollMs);
  }
  return null;
}

const byId = (id) => (r) => r.id === id || r.id.endsWith(':id/' + id) || r.desc === id || r.name === id;
const byText = (t) => (r) => r.text === t || r.label === t || r.value === t;

async function tapRow(sid, row, label) {
  const c = centre(row.bounds);
  if (!c) throw new Error('no bounds for ' + label);
  await tap(sid, c.x, c.y);
  console.log(`  tapped ${label} @ ${c.x},${c.y}`);
}

async function keys(sid, text) {
  for (const ch of text) {
    await bsReq('POST', `/wd/hub/session/${sid}/actions`, {
      actions: [{ type: 'key', id: 'kb', actions: [{ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch }] }],
    });
    await sleep(220);
  }
}

async function shot(sid, tag, label) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await screenshot(sid, path.join(SHOTS, `${tag}-${label}.png`));
}

async function run(platform, locale, localPhone) {
  const e164 = '+20' + localPhone;
  const tag = `${platform}-${locale}`;
  const { sid, created } = await session.ensure(platform, locale);
  console.log(`session ${sid} (${created ? 'new' : 'reused'}) — logging in as ${e164}`);
  await sleep(created ? 15000 : 1000);

  // Onboarding → login screen
  const entry = await findRow(sid, (r) => byId('phone_input_clickable_component')(r) || byId('login_screen_container')(r), { timeoutMs: 60000 });
  if (!entry) { await shot(sid, tag, 'ERR-no-entry'); throw new Error('neither onboarding phone row nor login screen found'); }
  if (byId('phone_input_clickable_component')(entry)) {
    await tapRow(sid, entry, 'phone_input_clickable_component');
    await sleep(4000);
  }

  const field = await findRow(sid, byId('phone_txtField_container'), { timeoutMs: 30000 });
  if (!field) { await shot(sid, tag, 'ERR-no-phone-field'); throw new Error('phone field not found'); }
  await tapRow(sid, field, 'phone_txtField_container');
  await sleep(1500);
  await keys(sid, localPhone);
  await sleep(1200);

  const marker = new Date(Date.now() - 30000).toISOString();
  const next = await findRow(sid, byId('next_btn'), { timeoutMs: 15000 });
  if (!next) { await shot(sid, tag, 'ERR-no-next'); throw new Error('next_btn not found'); }
  await tapRow(sid, next, 'next_btn');
  await sleep(6000);
  await shot(sid, tag, 'otp-screen');

  const { otp: code, createTime } = await otp.waitForOtp(e164, { after: marker, timeoutMs: 180000 });
  console.log(`  OTP ${code} (created ${createTime})`);
  const otpField = await findRow(sid, byId('otp_textField'), { timeoutMs: 20000 });
  if (!otpField) { await shot(sid, tag, 'ERR-no-otp-field'); throw new Error('otp_textField not found'); }
  await tapRow(sid, otpField, 'otp_textField');
  await sleep(1200);
  await keys(sid, code);
  await sleep(4000);

  const verify = (await rows(sid)).find(byId('verify_btn'));
  if (verify) { await tapRow(sid, verify, 'verify_btn'); }
  await sleep(14000);
  await shot(sid, tag, 'after-login');

  const home = await findRow(sid, byId('bottomBar_pay_btn'), { timeoutMs: 60000 });
  if (!home) { await shot(sid, tag, 'ERR-no-bottombar'); throw new Error('bottom bar not reached — login may have failed'); }
  console.log('  logged in — bottom bar present');
  return sid;
}

module.exports = { run, rows, findRow, tapRow, keys, shot, byId, byText };

if (require.main === module) {
  const [platform = 'android', locale = 'en', phone = '1064507660'] = process.argv.slice(2);
  run(platform, locale, phone).catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
