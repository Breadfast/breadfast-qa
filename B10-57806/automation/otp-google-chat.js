/** Google Chat OTP fetcher — Node port of GoogleChatApiClient.findMessageForOTP (D:\projects). */
const https = require('https');

/**
 * Credentials are NEVER stored in this repo. They are read, in order, from:
 *   1. environment variables (GOOGLE_CHAT_SPACE_ID / _CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN)
 *   2. the Java framework's own properties file, which lives outside this repo and is the existing
 *      source of truth for them (resources/environments/config_testing.properties)
 * Override the framework location with QA_FRAMEWORK_PATH.
 */
const fs = require('fs');
const path = require('path');

function fromFrameworkProperties() {
  const root = process.env.QA_FRAMEWORK_PATH || 'D:/projects';
  const file = path.join(root, 'resources', 'environments', 'config_testing.properties');
  try {
    const text = fs.readFileSync(file, 'utf8');
    const read = (key) => {
      const m = text.match(new RegExp('^' + key + '=(.*)$', 'm'));
      return m ? m[1].trim() : undefined;
    };
    return {
      spaceId: read('googleChatSpaceId'),
      clientId: read('googleChatClientId'),
      clientSecret: read('googleChatClientSecret'),
      refreshToken: read('googleChatRefreshToken'),
    };
  } catch (_) {
    return {};
  }
}

const fileCfg = fromFrameworkProperties();
const CFG = {
  spaceId: process.env.GOOGLE_CHAT_SPACE_ID || fileCfg.spaceId,
  clientId: process.env.GOOGLE_CHAT_CLIENT_ID || fileCfg.clientId,
  clientSecret: process.env.GOOGLE_CHAT_CLIENT_SECRET || fileCfg.clientSecret,
  refreshToken: process.env.GOOGLE_CHAT_REFRESH_TOKEN || fileCfg.refreshToken,
};

for (const [key, value] of Object.entries(CFG)) {
  if (!value) {
    throw new Error(
      `Google Chat OTP: missing "${key}". Set GOOGLE_CHAT_${key.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()} `
      + 'or make the Java framework readable (QA_FRAMEWORK_PATH -> resources/environments/config_testing.properties).');
  }
}

function req(opts, body) {
  return new Promise((res, rej) => {
    const r = https.request(opts, (x) => { let b = ''; x.on('data', d => b += d); x.on('end', () => res({ status: x.statusCode, body: b })); });
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}

async function accessToken() {
  const form = new URLSearchParams({
    client_id: CFG.clientId, client_secret: CFG.clientSecret,
    refresh_token: CFG.refreshToken, grant_type: 'refresh_token',
  }).toString();
  const r = await req({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) },
  }, form);
  if (r.status !== 200) throw new Error('oauth ' + r.status + ' ' + r.body.slice(0, 200));
  return JSON.parse(r.body).access_token;
}

async function messages(tok, pageSize = 25) {
  const r = await req({
    hostname: 'chat.googleapis.com',
    path: `/v1/spaces/${CFG.spaceId}/messages?orderBy=${encodeURIComponent('createTime desc')}&pageSize=${pageSize}`,
    method: 'GET', headers: { Authorization: 'Bearer ' + tok },
  });
  if (r.status !== 200) throw new Error('chat ' + r.status + ' ' + r.body.slice(0, 200));
  return JSON.parse(r.body).messages || [];
}

/** Java parity: filter on `OTP For <phone>`, then substring after "is"+3 up to the newline. */
function extractOtp(text) {
  const i = text.indexOf('is');
  if (i < 0) return null;
  const start = i + 3;
  const end = text.indexOf('\n', start);
  return (end < 0 ? text.slice(start) : text.slice(start, end)).trim();
}

async function fetchOtp(phone, { timeoutMs = 60000, notBefore = 0 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tok = await accessToken();
    const msgs = await messages(tok);
    const hits = msgs.filter(m => (m.text || '').includes('OTP For ' + phone));
    const fresh = notBefore ? hits.filter(m => new Date(m.createTime).getTime() >= notBefore) : hits;
    if (fresh.length) {
      const otp = extractOtp(fresh[0].text);
      if (otp) return { otp, createTime: fresh[0].createTime, text: fresh[0].text };
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  return null;
}

module.exports = { fetchOtp, accessToken, messages, extractOtp };

if (require.main === module) {
  (async () => {
    const tok = await accessToken();
    console.log('OAuth token acquired:', !!tok);
    const msgs = await messages(tok, 10);
    console.log('messages in space:', msgs.length);
    msgs.slice(0, 6).forEach(m => {
      const t = (m.text || '').replace(/\n/g, ' | ').slice(0, 90);
      console.log('  ' + m.createTime + '  ' + t);
    });
  })().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
}
