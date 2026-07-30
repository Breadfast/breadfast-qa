'use strict';
/**
 * BrowserStack App Automate session bootstrap for B10-56717 exploration.
 *
 * Adapted from B10-56652's equivalent (same app, same account, same device matrix). Sessions are
 * LONG-LIVED and reused across steps: the id is persisted per (platform, locale) under
 * evidence/sessions/, so each exploration step is a small inspectable script rather than one
 * monolith (execution-engine.md session lifecycle).
 *
 *   node session.js open  android en   → creates + prints the session id
 *   node session.js open  ios     ar
 *   node session.js id    android en
 *   node session.js close android en
 *
 * Arabic is set with TOP-LEVEL `appium:language` / `appium:locale` — never inside `bstack:options`
 * (CLAUDE.md §7).
 */
const fs = require('fs');
const path = require('path');
const { bsReq } = require('../../../bs_helper.js');

const STORY = 'B10-56717';
const SESSION_DIR = path.resolve(__dirname, '..', '..', 'evidence', 'sessions');

// Supplied by the operator 2026-07-29; byte-identical to the ids verified live on B10-56652.
const APPS = {
  ios: 'bs://30248a9811450c98323ef9860d13a287231109ac',
  android: 'bs://12bf2be529be6c73bc0dff9d208d139a3aaacebf',
};

const DEVICE = {
  ios: { deviceName: 'iPhone 14', platformVersion: '18', automationName: 'XCUITest', appiumVersion: '2.15.0' },
  android: { deviceName: 'Samsung Galaxy S23', platformVersion: '13.0', automationName: 'UiAutomator2', appiumVersion: '2.18.0' },
};

const LOCALE = {
  en: { language: 'en', locale: 'US' },
  ar: { language: 'ar', locale: 'EG' },
};

function file(platform, locale) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  return path.join(SESSION_DIR, `${platform}-${locale}.txt`);
}

function readId(platform, locale) {
  const f = file(platform, locale);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
}

async function alive(sid) {
  if (!sid) return false;
  const r = await bsReq('GET', `/wd/hub/session/${sid}/screenshot`);
  return !!(r && r.value && typeof r.value === 'string' && r.value.length > 100);
}

async function open(platform, locale) {
  const d = DEVICE[platform];
  const l = LOCALE[locale];
  const caps = {
    capabilities: {
      alwaysMatch: {
        platformName: platform === 'ios' ? 'ios' : 'android',
        'appium:automationName': d.automationName,
        'appium:app': APPS[platform],
        'appium:deviceName': d.deviceName,
        'appium:platformVersion': d.platformVersion,
        'appium:newCommandTimeout': 600,
        'appium:language': l.language,
        'appium:locale': l.locale,
        ...(platform === 'android' ? { 'appium:autoGrantPermissions': true } : { 'appium:autoAcceptAlerts': true }),
        'bstack:options': {
          projectName: STORY,
          buildName: `${STORY} — Perks List Screen Redesign`,
          sessionName: `${platform}-${locale} exploration`,
          appiumVersion: d.appiumVersion,
          deviceOrientation: 'portrait',
          // Required so `netlogs.js` can pull the customer-token perks payload (impact.md R-1).
          networkLogs: true,
          debug: true,
        },
      },
      firstMatch: [{}],
    },
  };
  const r = await bsReq('POST', '/wd/hub/session', caps);
  const sid = r && r.value && r.value.sessionId;
  if (!sid) throw new Error('session create failed: ' + JSON.stringify(r).slice(0, 600));
  fs.writeFileSync(file(platform, locale), sid);

  // The Breadfast Pay surface is Jetpack Compose and reports its nodes to UiAutomator2 as INVISIBLE.
  // Without these two settings the whole Pay content area collapses to one childless android.view.View
  // (35 nodes -> 140 with them; every perk card included). Measured on B10-56652, 2026-07-29.
  if (platform === 'android') {
    await bsReq('POST', `/wd/hub/session/${sid}/appium/settings`, {
      settings: { allowInvisibleElements: true, ignoreUnimportantViews: false },
    });
  }
  return sid;
}

async function ensure(platform, locale) {
  const existing = readId(platform, locale);
  if (await alive(existing)) return { sid: existing, created: false };
  const sid = await open(platform, locale);
  return { sid, created: true };
}

async function close(platform, locale) {
  const sid = readId(platform, locale);
  if (!sid) return null;
  await bsReq('DELETE', `/wd/hub/session/${sid}`);
  fs.rmSync(file(platform, locale), { force: true });
  return sid;
}

module.exports = { ensure, open, close, readId, alive, APPS, DEVICE, LOCALE, STORY };

if (require.main === module) {
  const [cmd, platform = 'android', locale = 'en'] = process.argv.slice(2);
  (async () => {
    if (cmd === 'open') {
      const { sid, created } = await ensure(platform, locale);
      console.log((created ? 'CREATED ' : 'REUSED  ') + platform + '-' + locale + ' ' + sid);
    } else if (cmd === 'id') {
      const sid = readId(platform, locale);
      console.log(sid + ' alive=' + (await alive(sid)));
    } else if (cmd === 'close') {
      console.log('closed ' + (await close(platform, locale)));
    } else {
      console.log('usage: node session.js <open|id|close> <ios|android> <en|ar>');
    }
  })().catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
