/**
 * Ad-hoc BrowserStack App Automate session driver (W3C), for exploratory passes and manual execution.
 *
 * Promoted to automation/mobile/ on 2026-08-24 (B10-58603). This replaces the root `bs_helper.js` for
 * new work: that file hardcodes the BrowserStack access key in a TRACKED file, which breaks the
 * standing "no secret in the repo" rule. Credentials here come from the Java framework's own
 * `resources/environments/browserStackConfigs.properties`, which lives outside this repo and is
 * already the source of truth, or from env (BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY).
 *
 * This is the ad-hoc layer only. Automated suites run through the Java framework (Appium + TestNG).
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const HUB = 'hub-cloud.browserstack.com';

function frameworkCreds() {
  const root = process.env.QA_FRAMEWORK_PATH || 'D:/projects';
  const file = path.join(root, 'resources', 'environments', 'browserStackConfigs.properties');
  try {
    const text = fs.readFileSync(file, 'utf8');
    const read = (k) => { const m = text.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : undefined; };
    return { user: read('userName'), key: read('accessKey') };
  } catch (_) { return {}; }
}
const fw = frameworkCreds();
const USER = process.env.BROWSERSTACK_USERNAME || fw.user;
const KEY = process.env.BROWSERSTACK_ACCESS_KEY || fw.key;
if (!USER || !KEY) {
  throw new Error('Missing BrowserStack credentials. Set BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY, '
    + 'or make the Java framework readable (QA_FRAMEWORK_PATH -> resources/environments/browserStackConfigs.properties).');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname: HUB, port: 443, path: p, method,
      auth: `${USER}:${KEY}`,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(d); } });
    });
    r.on('error', reject);
    r.setTimeout(180000, () => r.destroy(new Error(`timeout: ${method} ${p}`)));
    if (payload) r.write(payload);
    r.end();
  });
}

/**
 * Start a session. `locale` is 'en' or 'ar' — the Arabic caps go TOP-LEVEL
 * (`appium:language`/`appium:locale`), never inside bstack:options, which silently ignores them.
 */
async function start({ platform, app, locale = 'en', build, name, device, osVersion }) {
  const isAndroid = platform === 'android';
  const caps = {
    platformName: isAndroid ? 'android' : 'ios',
    'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
    'appium:app': app,
    'appium:deviceName': device || (isAndroid ? 'Samsung Galaxy S23' : 'iPhone 14'),
    'appium:platformVersion': osVersion || (isAndroid ? '13.0' : '18'),
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 600,
    'bstack:options': {
      projectName: 'Breadfast QA', buildName: build || 'adhoc', sessionName: name || 'session',
      debug: true, networkLogs: false, deviceLogs: true, idleTimeout: 300,
    },
  };
  if (locale === 'ar') { caps['appium:language'] = 'ar'; caps['appium:locale'] = 'EG'; }
  // iOS launches into the App Tracking Transparency system alert ("Ask App Not to Track" / "Allow"),
  // which blocks every subsequent lookup — the first iOS pass on B10-58603 died with "no phone field"
  // while the ATT dialog was on screen. Let XCUITest dismiss system alerts for us.
  if (!isAndroid) { caps['appium:autoAcceptAlerts'] = true; }
  // Android Compose reports its nodes as invisible unless this is on; set it at session creation so
  // the very first dump is usable rather than looking locator-less.
  if (isAndroid) caps['appium:settings[allowInvisibleElements]'] = true;

  const res = await req('POST', '/wd/hub/session', { capabilities: { alwaysMatch: caps, firstMatch: [{}] } });
  const sid = (res.value && res.value.sessionId) || res.sessionId;
  if (!sid) throw new Error('session did not start: ' + JSON.stringify(res).slice(0, 600));
  return sid;
}

const stop = (sid) => req('DELETE', `/wd/hub/session/${sid}`);
const source = async (sid) => (await req('GET', `/wd/hub/session/${sid}/source`)).value;

async function screenshot(sid, file) {
  const r = await req('GET', `/wd/hub/session/${sid}/screenshot`);
  if (!r.value) throw new Error('no screenshot: ' + JSON.stringify(r).slice(0, 300));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.value, 'base64'));
  return file;
}

const find = async (sid, using, value) => {
  const r = await req('POST', `/wd/hub/session/${sid}/element`, { using, value });
  return r.value && (r.value.ELEMENT || r.value['element-6066-11e4-a52e-4f735466cecf']) || null;
};
const findAll = async (sid, using, value) => {
  const r = await req('POST', `/wd/hub/session/${sid}/elements`, { using, value });
  return (r.value || []).map((e) => e.ELEMENT || e['element-6066-11e4-a52e-4f735466cecf']);
};
const click = (sid, el) => req('POST', `/wd/hub/session/${sid}/element/${el}/click`, {});
const typeText = (sid, el, text) => req('POST', `/wd/hub/session/${sid}/element/${el}/value`, { text: String(text) });
const attr = async (sid, el, a) => (await req('GET', `/wd/hub/session/${sid}/element/${el}/attribute/${a}`)).value;
const rect = async (sid, el) => (await req('GET', `/wd/hub/session/${sid}/element/${el}/rect`)).value;
const text = async (sid, el) => (await req('GET', `/wd/hub/session/${sid}/element/${el}/text`)).value;

/** W3C coordinate tap — the only reliable route for Compose surfaces with no accessible label. */
async function tap(sid, x, y) {
  return req('POST', `/wd/hub/session/${sid}/actions`, {
    actions: [{
      type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 120 },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });
}

/** Vertical swipe, fractions of the screen. dir: 'up' scrolls content up (reveals lower content). */
async function swipe(sid, { w, h }, dir = 'up', frac = 0.6) {
  const x = Math.round(w / 2);
  const from = dir === 'up' ? Math.round(h * 0.75) : Math.round(h * 0.30);
  const to = dir === 'up' ? Math.round(h * (0.75 - frac)) : Math.round(h * (0.30 + frac));
  return req('POST', `/wd/hub/session/${sid}/actions`, {
    actions: [{
      type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y: from },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 200 },
        { type: 'pointerMove', duration: 600, x, y: to },
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });
}

const windowSize = async (sid) => (await req('GET', `/wd/hub/session/${sid}/window/rect`)).value;

/**
 * Type into a field and VERIFY it landed, trying each mechanism in turn.
 *
 * Text entry on this app needs a different mechanism per surface, and every one of them fails
 * *silently* — the call returns 200 and the field stays empty:
 *   - Android login fields are Compose: `element/value` is a no-op, Android keycodes work.
 *   - iOS `phoneNumberScreen_txtField` ignored `element/value` with `{text}`; the field read back
 *     empty and `submitBtn` stayed disabled (measured on B10-58603).
 * So try, read back, and escalate — never assume. Returns the value actually in the field.
 */
async function enterText(sid, el, value, { android = false } = {}) {
  // Read the field back defensively. On iOS the content lives in the `value` ATTRIBUTE, not in `text`,
  // and a failed `element/text` returns an error OBJECT rather than throwing — stringifying that gave
  // "[object Object]" and made a successful entry look like a failure (measured on B10-58603 ios/ar).
  const str = (v) => (typeof v === 'string' ? v : '');
  const read = async () => {
    for (const get of [() => attr(sid, el, 'value'), () => text(sid, el)]) {
      try { const v = str(await get()); if (v) return v; } catch (_) { /* try the next */ }
    }
    return '';
  };
  const digitsOf = (s) => String(s).replace(/\D/g, '');
  const want = digitsOf(value);

  try { await click(sid, el); } catch (_) { /* already focused */ }
  await sleep(700);

  // 1) W3C elementSendKeys
  try { await typeText(sid, el, value); } catch (_) { /* fall through */ }
  await sleep(900);
  if (digitsOf(await read()) === want) return read();

  // 2) JSONWP-style value array, which some Appium drivers honour when {text} is ignored
  try { await req('POST', `/wd/hub/session/${sid}/element/${el}/value`, { value: String(value).split('') }); } catch (_) { /* fall through */ }
  await sleep(900);
  if (digitsOf(await read()) === want) return read();

  // 3) one character at a time — slowest, but the only thing some segmented fields accept
  try {
    await req('POST', `/wd/hub/session/${sid}/element/${el}/clear`, {});
    for (const ch of String(value)) { await typeText(sid, el, ch); await sleep(220); }
  } catch (_) { /* fall through */ }
  await sleep(800);
  if (digitsOf(await read()) === want) return read();

  // 4) Android only: real key events
  if (android && /^\d+$/.test(String(value))) {
    try { await pressDigits(sid, value, 240); } catch (_) { /* fall through */ }
    await sleep(800);
    if (digitsOf(await read()) === want) return read();
  }

  // 5) W3C key actions against the focused element — real typing, and the only rung that has worked
  //    on some iOS text fields where `element/value` is accepted and then ignored.
  try {
    await req('POST', `/wd/hub/session/${sid}/actions`, {
      actions: [{
        type: 'key',
        id: 'keyboard1',
        actions: String(value).split('').flatMap((ch) => ([{ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch }])),
      }],
    });
  } catch (_) { /* nothing left to try */ }
  await sleep(900);
  return read();
}

/**
 * Fill a SEGMENTED field (4-box OTP, 6-box passcode) — keycodes only, no escalation.
 *
 * Deliberately not `enterText`: a segmented field auto-submits the moment it is full, so the
 * escalation ladder is actively harmful there. Measured on B10-58603 — running `element/value` first
 * put a partial value in, the box auto-submitted an incomplete code, and by the time keycodes ran the
 * gate had already rejected and re-rendered. Both Android combos stalled on the Pay-access gate that
 * `pressDigits` alone had passed cleanly minutes earlier.
 */
async function fillSegmented(sid, el, digits, { android = true } = {}) {
  if (el) { try { await click(sid, el); } catch (_) { /* already focused */ } await sleep(700); }
  if (android) return pressDigits(sid, digits, 420);
  return typeText(sid, el, digits);
}

/**
 * Send digits as real Android key events (keycodes 7..16 == '0'..'9').
 *
 * Needed for segmented inputs: the app's 4-box OTP field and the Pay passcode field advance per
 * keystroke, so setting the whole string in one `element/value` call lands at most the first digit
 * and then auto-submits an incomplete code — which looks exactly like a rejected OTP. Measured on
 * B10-58603, 2026-08-24: a bulk `value` of a valid OTP bounced the app back to phone entry.
 */
async function pressDigits(sid, digits, gapMs = 350) {
  for (const d of String(digits)) {
    const code = 7 + Number(d);
    if (!/[0-9]/.test(d)) throw new Error('not a digit: ' + d);
    await req('POST', `/wd/hub/session/${sid}/appium/device/press_keycode`, { keycode: code });
    await sleep(gapMs);
  }
}

/** Type digits one key at a time — the pattern OTP/passcode keypads need. */
async function typeDigits(sid, digits, findKey) {
  for (const d of String(digits)) {
    const el = await findKey(d);
    if (!el) throw new Error('keypad key not found: ' + d);
    await click(sid, el);
    await sleep(250);
  }
}

module.exports = { req, start, stop, source, screenshot, find, findAll, click, typeText, enterText, attr, rect, text, tap, swipe, windowSize, typeDigits, pressDigits, fillSegmented, sleep, USER };
