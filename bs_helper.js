'use strict';
const https = require('https');
const fs    = require('fs');

/**
 * BrowserStack App Automate credentials — read from the environment or the gitignored
 * local credentials file. NEVER hardcode them here: this file is committed and shared.
 *
 *   export BROWSERSTACK_USERNAME="…"  BROWSERSTACK_ACCESS_KEY="…"
 *   # or set browserstackUsername / browserstackAccessKey in
 *   #   automation/config/credentials.local.js  (copy from credentials.local.example.js)
 */
let _local = {};
try { _local = require('./automation/config/credentials.local'); } catch (_) { /* env-only */ }

const BS_USER = process.env.BROWSERSTACK_USERNAME   || _local.browserstackUsername;
const BS_KEY   = process.env.BROWSERSTACK_ACCESS_KEY || _local.browserstackAccessKey;
const HUB     = process.env.BROWSERSTACK_HUB || 'hub-cloud.browserstack.com';

function requireCreds() {
  if (!BS_USER || !BS_KEY) {
    throw new Error(
      'bs_helper: missing BrowserStack App Automate credentials.\n' +
      '  -> Set env BROWSERSTACK_USERNAME + BROWSERSTACK_ACCESS_KEY (BrowserStack > Account > Settings),\n' +
      '     or browserstackUsername / browserstackAccessKey in automation/config/credentials.local.js.\n' +
      '     See SETUP.md §4.'
    );
  }
}

function bsReq(method, path, body) {
  requireCreds();   // synchronous, so a misconfigured machine fails immediately and clearly
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: HUB, port: 443, path, method,
      auth: `${BS_USER}:${BS_KEY}`,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(new Error('bsReq timeout after 90s: ' + method + ' ' + path)); });
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function screenshot(sid, filename) {
  const r = await bsReq('GET', `/wd/hub/session/${sid}/screenshot`);
  const b64 = r.value;
  fs.writeFileSync(filename, Buffer.from(b64, 'base64'));
  console.log('Screenshot saved:', filename);
  return b64;
}

async function getSource(sid) {
  const r = await bsReq('GET', `/wd/hub/session/${sid}/source`);
  return r.value || '';
}

async function findElement(sid, strategy, value) {
  const r = await bsReq('POST', `/wd/hub/session/${sid}/element`, { using: strategy, value });
  return r.value ? (r.value.ELEMENT || r.value['element-6066-11e4-a52e-4f735466cecf']) : null;
}

async function findElements(sid, strategy, value) {
  const r = await bsReq('POST', `/wd/hub/session/${sid}/elements`, { using: strategy, value });
  return (r.value || []).map(e => e.ELEMENT || e['element-6066-11e4-a52e-4f735466cecf']);
}

async function clickEl(sid, elId) {
  return bsReq('POST', `/wd/hub/session/${sid}/element/${elId}/click`, {});
}

async function typeText(sid, elId, text) {
  return bsReq('POST', `/wd/hub/session/${sid}/element/${elId}/value`, { text, value: text.split('') });
}

async function tap(sid, x, y) {
  return bsReq('POST', `/wd/hub/session/${sid}/actions`, {
    actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
      actions: [{ type: 'pointerMove', duration: 0, x, y }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 }, { type: 'pointerUp', button: 0 }]
    }]
  });
}

async function getAttr(sid, elId, attr) {
  const r = await bsReq('GET', `/wd/hub/session/${sid}/element/${elId}/attribute/${attr}`);
  return r.value;
}

module.exports = { bsReq, sleep, screenshot, getSource, findElement, findElements, clickEl, typeText, tap, getAttr };
