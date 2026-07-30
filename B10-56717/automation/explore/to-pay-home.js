'use strict';
/**
 * End-to-end drive from a fresh session to the **Pay home** screen, on either platform and locale,
 * capturing evidence at every step. This is the reusable path every B10-56717 scenario starts from.
 *
 *   node to-pay-home.js <ios|android> <en|ar> [localPhone]
 *
 * Route (verified live 2026-07-28 on both platforms):
 *   onboarding → phone → login OTP (Google Chat) → [iOS: location permission] → Home
 *   → Pay tab → 6-digit passcode → Pay-access OTP (= last 4 digits of the number)
 *   → "Save card for a faster checkout" interstitial → "Not now" → Pay home
 *
 * Platform notes that drive the implementation:
 *   • **iOS** exposes a full accessibility tree — every control has a `name`, and the perk cards carry
 *     stable ids (`perk-card-CC_8`) with `label = "<title>, <subheader>"`. Everything is addressable.
 *   • **Android** is Jetpack Compose with `resource-id` test tags for login/onboarding, but the entire
 *     **Pay** content area is a single unlabelled `android.view.View` — the passcode keypad and the whole
 *     Pay home included. Those steps must be driven by coordinates (see keypad.js).
 */
const fs = require('fs');
const path = require('path');
const { sleep, screenshot, getSource, tap, bsReq } = require('../../../bs_helper.js');
const session = require('./session.js');
const { inventory, centre } = require('./drive.js');
const keypad = require('./keypad.js');
const otp = require('./otp.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');
const PASSCODE = '123321';

// Android Pay-flow coordinates (Samsung Galaxy S23, 1080x2340) — unlabelled Compose surface.
const AND = {
  closeCardIntro: [65, 146],
  notNow: [539, 2063],
  payOtpDigitsViaKeyboard: true,
};

const log = (m) => console.log(m);

async function rows(sid) { return inventory(await getSource(sid)); }
const byId = (id) => (r) => r.id === id || r.id.endsWith(':id/' + id) || r.desc === id || r.name === id;
const byLabel = (t) => (r) => r.text === t || r.label === t || r.value === t || r.name === t;

async function waitFor(sid, pred, { timeoutMs = 45000, pollMs = 2000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const hit = (await rows(sid)).find(pred);
    if (hit) return hit;
    await sleep(pollMs);
  }
  return null;
}

async function tapRow(sid, row, what) {
  const c = centre(row.bounds);
  if (!c) throw new Error('no bounds for ' + what);
  await tap(sid, c.x, c.y);
  log(`  tap ${what} @ ${c.x},${c.y}`);
}

async function typeInto(sid, row, text) {
  // Compose/XCUI text fields are addressable by bounds; fall back to raw keystrokes.
  await tapRow(sid, row, 'text field');
  await sleep(1200);
  for (const ch of text) {
    await bsReq('POST', `/wd/hub/session/${sid}/actions`, {
      actions: [{ type: 'key', id: 'kb', actions: [{ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch }] }],
    });
    await sleep(200);
  }
  log(`  typed ${text}`);
}

async function shot(sid, tag, label) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${tag}-${label}.png`);
  await screenshot(sid, f);
  return f;
}

async function dump(sid, tag, label) {
  fs.mkdirSync(EVID, { recursive: true });
  const xml = await getSource(sid);
  fs.writeFileSync(path.join(EVID, `${tag}-${label}.xml`), xml);
  return xml;
}

async function run(platform, locale, phone) {
  const ios = platform === 'ios';
  const tag = `${platform}-${locale}`;
  const e164 = '+20' + phone;
  const { sid, created } = await session.ensure(platform, locale);
  log(`[${tag}] session ${sid} (${created ? 'new' : 'reused'}) — ${e164}`);
  await sleep(created ? 18000 : 1000);
  await shot(sid, tag, '01-launch');

  // ---- onboarding → phone entry ----
  const entry = await waitFor(sid, (r) => byId('phone_input_clickable_component')(r) || byId('phone_txtField_container')(r)
    || byId('phoneNumberScreen_txtField')(r), { timeoutMs: 90000 });
  if (!entry) { await dump(sid, tag, 'ERR-onboarding'); throw new Error('onboarding/phone entry not found'); }
  if (byId('phone_input_clickable_component')(entry)) { await tapRow(sid, entry, 'onboarding phone row'); await sleep(4500); }

  const field = await waitFor(sid, ios ? byId('phoneNumberScreen_txtField') : byId('phone_txtField_container'));
  if (!field) { await dump(sid, tag, 'ERR-phone-field'); throw new Error('phone field not found'); }
  const marker = new Date(Date.now() - 45000).toISOString();
  await typeInto(sid, field, phone);
  await sleep(1500);
  await shot(sid, tag, '02-phone-entered');

  const next = await waitFor(sid, ios ? byId('submitBtn') : byId('next_btn'));
  if (!next) { await dump(sid, tag, 'ERR-next'); throw new Error('next/submit not found'); }
  await tapRow(sid, next, 'next');
  await sleep(7000);

  // ---- login OTP from Google Chat ----
  const { otp: code } = await otp.waitForOtp(e164, { after: marker, timeoutMs: 180000 });
  log(`  login OTP ${code}`);
  const otpField = await waitFor(sid, ios ? byId('otpTextField') : byId('otp_textField'));
  if (!otpField) { await dump(sid, tag, 'ERR-otp-field'); throw new Error('OTP field not found'); }
  await typeInto(sid, otpField, code);
  await sleep(3500);
  const verify = (await rows(sid)).find(ios ? byId('otpScreen_submitBtn') : byId('verify_btn'));
  if (verify) await tapRow(sid, verify, 'verify');
  await sleep(12000);

  // ---- iOS location permission (Android uses autoGrantPermissions) ----
  if (ios) {
    const perm = (await rows(sid)).find((r) => /Allow While Using App|السماح/i.test(r.label || r.name || ''));
    if (perm) { await tapRow(sid, perm, 'allow location'); await sleep(6000); }
  }
  await shot(sid, tag, '03-after-login');

  // ---- Pay tab ----
  const payTab = await waitFor(sid, ios ? (r) => /^(Pay|باي)$/.test(r.label || r.name || '') : byId('bottomBar_pay_btn'),
    { timeoutMs: 90000 });
  if (!payTab) { await dump(sid, tag, 'ERR-tabbar'); throw new Error('Pay tab not found — login may have failed'); }
  await tapRow(sid, payTab, 'Pay tab');
  await sleep(9000);
  await shot(sid, tag, '04-pay-gate');

  // Some accounts get the "Introducing Breadfast Card" promo before the passcode gate.
  const promo = (await rows(sid)).find((r) => /Introducing|Get started|ابدأ/i.test(r.label || r.name || r.text || ''));
  if (promo && !ios) { await tap(sid, AND.closeCardIntro[0], AND.closeCardIntro[1]); await sleep(5000); }

  // ---- passcode (6 digits) ----
  await keypad.enter(sid, platform, PASSCODE);
  log('  passcode entered');
  await sleep(9000);
  await shot(sid, tag, '05-after-passcode');
  await dump(sid, tag, '05-after-passcode');

  // ---- Pay-access OTP = last 4 digits of the account's number ----
  const payOtp = e164.slice(-4);
  const otpRow = (await rows(sid)).find(ios ? byId('otpTextField') : byId('otp_textField'));
  if (otpRow) {
    await typeInto(sid, otpRow, payOtp);
  } else {
    // Android renders this screen unlabelled; the soft numeric keyboard is already focused.
    for (const ch of payOtp) {
      await bsReq('POST', `/wd/hub/session/${sid}/actions`, {
        actions: [{ type: 'key', id: 'kb', actions: [{ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch }] }],
      });
      await sleep(300);
    }
  }
  log(`  Pay OTP ${payOtp} entered`);
  await sleep(9000);
  await shot(sid, tag, '06-after-pay-otp');
  await dump(sid, tag, '06-after-pay-otp');

  // ---- "Save card for a faster checkout" interstitial ----
  const notNow = (await rows(sid)).find((r) => /^(Not now|ليس الآن|لاحقا|لاحقاً)$/.test((r.label || r.name || r.text || '').trim()));
  if (notNow) { await tapRow(sid, notNow, 'Not now'); }
  else if (!ios) { await tap(sid, AND.notNow[0], AND.notNow[1]); log('  tapped Not now by coordinate (unlabelled)'); }
  await sleep(9000);

  // ---- Pay home ----
  await shot(sid, tag, '07-pay-home');
  const xml = await dump(sid, tag, '07-pay-home');
  const all = inventory(xml);
  const cards = all.filter((r) => /^perk-card-/.test(r.name || r.id || r.desc || ''));
  log(`[${tag}] PAY HOME reached. labelled nodes=${all.length}, perk cards exposed=${cards.length}`);
  cards.forEach((c, i) => log(`   ${i + 1}. ${c.name || c.id} → "${c.label}"`));
  if (!cards.length) log(`   (no perk-card nodes exposed — expected on Android, where the Pay surface is unlabelled)`);
  return { sid, cards: cards.map((c) => ({ id: (c.name || c.id), label: c.label, bounds: c.bounds })) };
}

module.exports = { run, PASSCODE };

if (require.main === module) {
  const [platform = 'android', locale = 'en', phone = '1064507660'] = process.argv.slice(2);
  run(platform, locale, phone)
    .then((r) => {
      fs.writeFileSync(path.join(EVID, `${platform}-${locale}-pay-home-cards.json`), JSON.stringify(r.cards, null, 2));
      console.log('OK');
    })
    .catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
