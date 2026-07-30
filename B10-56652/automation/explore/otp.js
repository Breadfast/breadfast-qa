'use strict';
/**
 * Google Chat OTP reader — the login-OTP channel the Java framework uses
 * (`helpers/apiClients/GoogleChatApiClient.java` → `findMessageForOTP`).
 * Config values come from the framework's own `resources/environments/config_testing.properties`
 * (googleChatSpaceId / ClientId / ClientSecret / RefreshToken) so this stays a thin,
 * environment-agnostic mirror of the canonical implementation — no new credential source.
 *
 * Message format in the space:  "OTP For +201064507660 is 1234\nENV: testing"
 */
const fs = require('fs');
const path = require('path');

const PROPS = 'D:/projects/resources/environments/config_testing.properties';

function props() {
  const out = {};
  for (const line of fs.readFileSync(PROPS, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_.]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function accessToken() {
  const p = props();
  const body = new URLSearchParams({
    client_id: p.googleChatClientId,
    client_secret: p.googleChatClientSecret,
    refresh_token: p.googleChatRefreshToken,
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!r.ok) throw new Error('Google token endpoint returned ' + r.status);
  return (await r.json()).access_token;
}

/** Raw messages, newest first. */
async function messages(pageSize = 25) {
  const p = props();
  const token = await accessToken();
  const url = `https://chat.googleapis.com/v1/spaces/${p.googleChatSpaceId}/messages`
            + `?orderBy=${encodeURIComponent('createTime desc')}&pageSize=${pageSize}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Google Chat API returned ' + r.status);
  return (await r.json()).messages || [];
}

function extractOtp(text) {
  const m = /is\s+(\d{4,6})/.exec(text || '');
  return m ? m[1] : null;
}

/**
 * Newest OTP for a phone number. `after` (ISO string) makes it wait for an OTP
 * created strictly later than a recorded marker — the reliable way to avoid
 * re-reading the previous login's code (same guard as OtpFactory's originalOtp loop).
 */
async function waitForOtp(phoneE164, { after = null, timeoutMs = 120000, pollMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const needle = 'OTP For ' + phoneE164;
  let lastSeen = null;
  while (Date.now() < deadline) {
    const all = await messages(25);
    const hits = all.filter((m) => (m.text || '').includes(needle));
    for (const h of hits) {
      if (after && new Date(h.createTime) <= new Date(after)) continue;
      const otp = extractOtp(h.text);
      if (otp) return { otp, createTime: h.createTime };
    }
    lastSeen = hits[0] ? hits[0].createTime : lastSeen;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`No OTP for ${phoneE164} within ${timeoutMs}ms (newest matching message: ${lastSeen || 'none'})`);
}

/** ISO marker to pass as `after` before triggering a new OTP send. */
async function marker(phoneE164) {
  const all = await messages(25);
  const hit = all.find((m) => (m.text || '').includes('OTP For ' + phoneE164));
  return hit ? hit.createTime : new Date(0).toISOString();
}

module.exports = { messages, waitForOtp, marker, extractOtp };

if (require.main === module) {
  const phone = process.argv[2] || '+201064507660';
  (async () => {
    const all = await messages(10);
    console.log('space messages:', all.length);
    all.slice(0, 6).forEach((m) => console.log(' ', m.createTime, '|', (m.text || '').replace(/\n/g, ' / ')));
    const hit = all.find((m) => (m.text || '').includes('OTP For ' + phone));
    console.log('newest for', phone, '->', hit ? extractOtp(hit.text) + ' @ ' + hit.createTime : 'none');
  })().catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
