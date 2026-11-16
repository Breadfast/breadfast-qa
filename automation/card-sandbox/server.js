'use strict';

/**
 * Card Activation Sandbox — a small local web UI over automation/bcard-user/create_bcard_user.js.
 *
 * It lets you drive a BCard test user to any stage (account → pending → registered → received →
 * linked → active), on a phone you type or a freshly registered one, pick Mock vs Real MDP for the
 * card-PIN step, and see a live table of everyone this page has created (status/bcid/card id/national
 * id pulled fresh from the card DB on each load).
 *
 * Built on Node's built-in http server — no new dependencies (Express is not installed). It reuses the
 * repo's own DbHelper (card DB over SSH) for read-only status + enrichment, and spawns the existing
 * create_bcard_user.js with --json for every creation, so all the card-service logic lives in one place.
 *
 * Run:   node automation/card-sandbox/server.js        (or: npm run card-sandbox)
 * Open:  http://localhost:4100   (override with PORT=xxxx)
 *
 * Nothing here is committed per story — it is shared QA tooling. The page-created user list persists to
 * automation/card-sandbox/created.jsonl (gitignored), separate from the tool's own created-users.jsonl.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TOOL = path.join(REPO_ROOT, 'automation', 'bcard-user', 'create_bcard_user.js');
const STORE = path.join(__dirname, 'created.jsonl');
const INDEX = path.join(__dirname, 'public', 'index.html');
const PORT = Number(process.env.PORT || 4100);

const DbHelper = require(path.join(REPO_ROOT, 'automation', 'helpers', 'DbHelper'));
const credentials = require(path.join(REPO_ROOT, 'automation', 'config', 'credentials'));

const STAGES = ['account', 'pending', 'registered', 'received', 'linked', 'active'];
const CREATE_TIMEOUT_MS = 4 * 60 * 1000;   // real-MDP activation drives a PIN webview; give it room

// ── phone normalisation ──────────────────────────────────────────────────────
// The card DB stores +20XXXXXXXXXX. Accept 01XXXXXXXXX / 1XXXXXXXXX / 2011… / +2011… and return E.164.
function toE164(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('20')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10) return null;          // Egyptian mobile national part is 10 digits (1XXXXXXXXX)
  return '+20' + d;
}

// ── card DB (read-only; lazy single connection, reused) ──────────────────────
// The SSH tunnel / MySQL session drops when idle (seen overnight: "Can't add new command when connection is
// in closed state"). Forget a connection the moment it reports a drop, and let query() reconnect + retry once,
// so a long-running sandbox never keeps serving lookups from a dead connection.
let _db = null;
function db() {
  if (!_db) {
    const h = new DbHelper(credentials.cardDb.config());
    const p = h.connect().then(() => {
      const forget = () => { if (_db === p) _db = null; };
      if (h.conn) { h.conn.on('error', forget); h.conn.on('end', forget); }
      if (h.ssh) { h.ssh.on('close', forget); h.ssh.on('error', forget); }
      return h;
    }).catch((e) => { if (_db === p) _db = null; throw e; });   // retry on the next call
    _db = p;
  }
  return _db;
}
async function dropDb() {
  const p = _db; _db = null;
  if (p) { try { await (await p).close(); } catch { /* already gone */ } }
}
const CONN_LOST = /closed state|connection lost|PROTOCOL_CONNECTION_LOST|ECONNRESET|EPIPE|ETIMEDOUT|not connected|socket/i;
/** Run a read on the card DB, reconnecting once if the cached connection has died. */
async function query(sql, params) {
  try {
    return await (await db()).query(sql, params);
  } catch (e) {
    if (!CONN_LOST.test(String(e && (e.code || '') + ' ' + e.message))) throw e;
    await dropDb();
    return (await db()).query(sql, params);
  }
}

/** Current card record for a phone, straight from the DB. Read-only — never registers anything. */
async function liveUser(e164) {
  const w = (await query(
    'SELECT id, status, breadfast_id, national_id, phone_number_status, createdAt ' +
    'FROM wallet_users WHERE mobile_number = ? LIMIT 1', [e164]
  ))[0];
  if (!w) return null;
  // Newest card bound to this user (externalId = the MDP card id; cardToken = BCID).
  let card = (await query(
    'SELECT id, cardToken, packageNumber, externalId, type, createdAt ' +
    'FROM cards WHERE walletUserId = ? AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 1', [w.id]
  ))[0] || null;
  // At Received no card is bound yet: the card is the one whose package this user collected.
  // (Below Received a pickup row can be a leftover from an earlier cycle, so it is ignored.)
  const pkg = (card || w.status !== 'Received') ? null : (await query(
    'SELECT package_number FROM cards_pickup_package WHERE wallet_user_id = ? AND deletedAt IS NULL ' +
    'ORDER BY createdAt DESC LIMIT 1', [w.id]
  ))[0];
  if (pkg) {
    card = (await query(
      'SELECT id, cardToken, packageNumber, externalId, type, createdAt ' +
      'FROM cards WHERE packageNumber = ? AND deletedAt IS NULL ORDER BY createdAt DESC LIMIT 1', [pkg.package_number]
    ))[0] || { packageNumber: pkg.package_number };
  }
  return {
    walletUserId: w.id,
    status: w.status,
    breadfastId: String(w.breadfast_id || ''),
    nationalId: w.national_id || null,
    phoneVerified: w.phone_number_status === 'Verified',
    cardId: card ? card.id || null : null,
    bcid: card ? card.cardToken || null : null,
    packageNumber: card ? card.packageNumber || null : null,
    mdpCardId: card ? card.externalId || null : null,   // the MDP card id
    cardType: card ? card.type || null : null,
    accountCreatedAt: w.createdAt,
  };
}

// ── local store of page-created users ────────────────────────────────────────
function readStore() {
  let text;
  try { text = fs.readFileSync(STORE, 'utf8'); } catch { return []; }   // no file yet → empty history
  // Parse line by line and SKIP any corrupt/partial line, so one bad row never hides the whole history.
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* keep every readable record */ }
  }
  return out;
}
function appendStore(rec) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.appendFileSync(STORE, JSON.stringify(rec) + '\n');
}

// Audit every creation ATTEMPT (success or failure), so the chosen MDP mode is traceable per attempt.
// No passcode or token is ever written here — only phone, stage, mdpMode, and the outcome.
const AUDIT = path.join(__dirname, 'attempts.jsonl');
function audit(rec) {
  try { fs.mkdirSync(path.dirname(AUDIT), { recursive: true }); fs.appendFileSync(AUDIT, JSON.stringify(rec) + '\n'); }
  catch { /* auditing must never break a request */ }
}

// ── run create_bcard_user.js --json and parse its result ─────────────────────
function runTool(args) {
  return new Promise((resolve) => {
    const child = spawn('node', [TOOL, ...args, '--json'], { cwd: REPO_ROOT });
    let out = '', err = '';
    const killer = setTimeout(() => child.kill('SIGKILL'), CREATE_TIMEOUT_MS);
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('close', () => {
      clearTimeout(killer);
      // --json prints one JSON object on stdout; tolerate stray lines by taking the last {...} block.
      const m = out.match(/\{[\s\S]*\}\s*$/);
      if (!m) return resolve({ error: (err || out || 'no output').trim().split('\n').slice(-1)[0] });
      try { resolve(JSON.parse(m[0])); }
      catch { resolve({ error: 'could not parse tool output' }); }
    });
    child.on('error', (e) => { clearTimeout(killer); resolve({ error: e.message }); });
  });
}

// A failure at the mobile-login step (linked/active) means the Pay passcode was wrong → ask the operator.
const PASSCODE_FAIL = /this number is not registered|رقم تعريفي|رقم غير مسجل|wrong pass|passcode/i;

// ── HTTP helpers ─────────────────────────────────────────────────────────────
// CORS is open so the page works when opened straight from disk (file://, origin "null") against this
// local server — it binds to localhost only and touches nothing outside the test environment.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...CORS });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

// ── routes ───────────────────────────────────────────────────────────────────
async function handleStatus(res, query) {
  const e164 = toE164(query.get('phone'));
  if (!e164) return sendJson(res, 400, { error: 'invalid phone' });
  try {
    const live = await liveUser(e164);
    sendJson(res, 200, { phone: e164, exists: !!live, ...(live || {}) });
  } catch (e) { sendJson(res, 200, { phone: e164, exists: null, dbError: e.message }); }
}

async function handleUsers(res) {
  // Only users created through this page by a SUCCESSFUL run. One row per phone (latest success wins),
  // newest first. Failed / stopped runs stay in attempts.jsonl and are not listed.
  const byPhone = new Map();
  for (const r of readStore()) if (r.ok !== false) byPhone.set(r.phone, { ...byPhone.get(r.phone), ...r });
  const list = [...byPhone.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const rows = await Promise.all(list.map(async (rec) => {
    let live = null;
    try { live = await liveUser(rec.phone); } catch { /* DB may be down; show stored values */ }
    return { ...rec, live };
  }));
  sendJson(res, 200, { users: rows });
}

async function handleCreate(res, body) {
  const stage = String(body.stage || '').toLowerCase();
  if (!STAGES.includes(stage)) return sendJson(res, 400, { error: `stage must be one of ${STAGES.join(', ')}` });

  const generate = !!body.generate;
  const e164 = generate ? null : toE164(body.phone);
  if (!generate && !e164) return sendJson(res, 400, { error: 'enter a valid phone or choose Generate' });

  const mdpMode = body.mdpMode === 'real' ? 'real' : 'mock';   // only affects the Active card-PIN step
  // Safety: a Real-MDP activation is an outward operation — it runs only with explicit confirmation from
  // the UI (confirmReal:true). It can never be reached by a status check, a number generation, or a field
  // change, and it never silently falls back to mock (the pin-mode is passed explicitly, never "auto").
  if (stage === 'active' && mdpMode === 'real' && !body.confirmReal) {
    return sendJson(res, 200, { needsRealConfirm: true });
  }

  const started = new Date().toISOString();
  const args = ['--stage', stage];
  if (e164) args.push('--phone', e164);
  if (body.passcode) args.push('--passcode', String(body.passcode));
  if (stage === 'active') args.push('--pin-mode', mdpMode === 'real' ? 'webview' : 'mock');
  if (e164 && (stage === 'linked' || stage === 'active')) {
    try {
      const before = await liveUser(e164);
      if (before && before.status === 'Received' && before.bcid) args.push('--bcid', before.bcid);
    } catch { /* no DB: the tool falls back to its own log */ }
  }

  const result = await runTool(args);
  audit({ at: started, phone: e164 || '(generated)', stage, mdpMode: stage === 'active' ? mdpMode : null,
          ok: !result.error, result: result.error ? result.error.split('\n')[0] : result.cardStatus });

  if (result.error) {
    const needsPasscode = (stage === 'linked' || stage === 'active') && PASSCODE_FAIL.test(result.error);
    // Partial success: report the status the user actually reached, so a half-done advance is visible.
    let live = null;
    if (e164) { try { live = await liveUser(e164); } catch { /* db down */ } }
    const reached = live ? live.status : null;
    return sendJson(res, 200, {
      error: result.error,
      needsPasscode,
      passcodeTried: body.passcode ? String(body.passcode) : '123321 (default)',
      reached,                                   // e.g. "Received" when an Active run failed at link
      targetStage: stage,
    });
  }

  // Success — enrich from the DB and persist a full record for the table.
  let live = null;
  try { live = await liveUser(result.phone); } catch { /* keep tool values */ }
  const rec = {
    phone: result.phone,
    breadfastId: result.breadfastId || (live && live.breadfastId) || null,
    walletUserId: live ? live.walletUserId : null,
    status: result.cardStatus,
    stageRequested: stage,
    mdpMode: stage === 'active' ? mdpMode : null,         // mock/real only meaningful at Active
    pinMode: stage === 'active' ? (mdpMode === 'real' ? 'webview' : 'mock') : null,
    nationalId: result.nationalId || (live && live.nationalId) || null,
    bcid: result.bcid || (live && live.bcid) || null,
    packageNumber: result.packageNumber || (live && live.packageNumber) || null,
    cardId: live ? live.cardId : null,
    mdpCardId: live ? live.mdpCardId : null,
    cardPin: result.cardPin || null,
    passcode: result.passcode || (body.passcode ? String(body.passcode) : null),
    payOtp: result.payOtp || (result.phone ? result.phone.slice(-4) : null),
    email: result.email || null,
    createdAt: result.createdAt || new Date().toISOString(),
    ok: true,
  };
  appendStore(rec);
  sendJson(res, 200, { user: rec });
}

// ── server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return fs.createReadStream(INDEX).on('error', () => sendJson(res, 500, { error: 'index.html missing' }))
        .pipe(res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...CORS }));
    }
    if (req.method === 'GET' && url.pathname === '/api/status') return handleStatus(res, url.searchParams);
    if (req.method === 'GET' && url.pathname === '/api/users') return handleUsers(res);
    if (req.method === 'POST' && url.pathname === '/api/create') return handleCreate(res, await readBody(req));
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  const u = `http://localhost:${PORT}`;
  console.log(`Card Activation Sandbox → ${u}`);
  console.log('  drives automation/bcard-user/create_bcard_user.js · reads the live card DB');
  db().catch((e) => console.log('  card DB not reachable yet: ' + e.message));
  console.log(`  standalone page: ${INDEX}  (double-click to open; it talks to this server)`);
  if (process.env.OPEN !== '0') {                       // auto-open the browser (OPEN=0 to skip)
    const opener = { darwin: 'open', win32: 'start' };
    const cmd = opener[process.platform] || 'xdg-open';
    try { spawn(cmd, [u], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref(); } catch {}
  }
});

process.on('SIGINT', async () => { try { if (_db) await (await _db).close(); } catch {} process.exit(0); });
