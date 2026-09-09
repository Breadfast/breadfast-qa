'use strict';
/**
 * Shared Figma browser-session module — the ONE implementation of jar load / restore / probe / save.
 *
 * Extracted 2026-09-08 from `automation/figma/capture_frames.js`, which held the only correct
 * restore in the repo. Three failures made the "Figma keeps asking me to log in" loop permanent:
 *
 *   RC1 The freshness gate never checked authentication. `figma-connect.js --status` decided FRESH
 *       from `cookies.length >= 1` + `savedAt` age — arithmetic on a date, no contact with Figma —
 *       so a jar Figma had already invalidated server-side reported FRESH with 25 days "left".
 *       Fixed by `probeSession()` below: one real authenticated request, browserless.
 *   RC2 Only this repo's capture script restored the jar the sanctioned way (`splitJar` +
 *       `addCookies`); nothing else did, and the Playwright MCP browser reads the jar not at all.
 *       Fixed by making `newAuthedContext()` the one way to build a Figma context. (Note: the
 *       `__Host-` drop this defends against does not reproduce on playwright 1.61.1 — see `splitJar`.)
 *   RC3 Nothing ever wrote the session back, so Figma's token rotation was discarded every run and
 *       the 25-day window only ever reset on a manual login. Fixed by `saveJar()`, called after
 *       every run that proved authenticated.
 *
 * Lives under `automation/` (not `qa-workflow/lib/`) per `qa-workflow/lib/README.md`: lib/ is
 * zero-dependency authoring machinery, runtime Playwright helpers belong here. Deliberately does
 * NOT require playwright itself — callers pass in a browser, so this works with both `playwright`
 * (capture_frames.js) and `@playwright/test` (figma-connect.js).
 *
 * Exports: authPath · loadJar · splitJar · newAuthedContext · probeSession · writeJar · saveJar
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_AUTH_PATH = path.join(__dirname, '..', '..', 'auth', 'figma-auth.json');

/** Resolved session-file location. `FIGMA_AUTH_PATH` overrides. */
function authPath() {
  return process.env.FIGMA_AUTH_PATH || DEFAULT_AUTH_PATH;
}

/**
 * Read + parse the saved jar.
 * @throws {Error} with `.code` = 'ENOJAR' (absent) | 'EBADJAR' (unparseable / no cookies)
 */
function loadJar(p = authPath()) {
  if (!fs.existsSync(p)) {
    const e = new Error(`Missing Figma session: ${p}\n  -> run: node qa-workflow/bin/figma-connect.js`);
    e.code = 'ENOJAR';
    throw e;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    const e = new Error(`Unparseable Figma session at ${p}: ${err.message}`);
    e.code = 'EBADJAR';
    throw e;
  }
  if (!Array.isArray(raw.cookies) || raw.cookies.length < 1) {
    const e = new Error(`Figma session at ${p} holds no cookies`);
    e.code = 'EBADJAR';
    throw e;
  }
  return raw;
}

/**
 * Split a jar into "safe for storageState" and "must be injected by url".
 *
 * The rule this defends against: the `__Host-` cookie prefix is only honoured for a cookie with NO
 * Domain attribute, and a saved jar carries one. On Figma that set (`__Host-figma.authn`, `-state`,
 * `.mac`, …) IS the auth, so a restore that loses it lands on the login wall holding a perfectly
 * valid session. Injecting those by `url` sidesteps the Domain attribute entirely.
 *
 * Provenance, stated honestly (2026-09-08): the original comment here asserted
 * "storageState alone → 0 `__Host-*`; split restore → all 9". **That measurement does not reproduce
 * on playwright 1.61.1** — re-measured against this jar, both paths restore all 9 `__Host-*`
 * (6 of them applicable to `https://www.figma.com/`), and the 15 cookies Chromium drops
 * (AWSALB*, `__cf_bm`, `_uetsid`, `_clsk`, …) are identical either way and contain no auth. It was
 * presumably real on an older Playwright, and the split path is free and strictly safer, so it is
 * kept as the sanctioned restore — but it is belt-and-braces here, NOT the thing standing between
 * you and the login wall. If a capture run hits the login page, suspect the session itself
 * (`figma-connect.js --status`) before suspecting this function.
 */
function splitJar(cookies) {
  const byUrl = [];
  const byDomain = [];
  for (const c of cookies) {
    if (c.name.startsWith('__Host-')) {
      byUrl.push({
        name: c.name, value: c.value,
        url: `https://${String(c.domain).replace(/^\.+/, '')}/`,
        httpOnly: c.httpOnly, secure: true, sameSite: c.sameSite || 'Lax',
        ...(c.expires > 0 ? { expires: c.expires } : {}),
      });
    } else { byDomain.push(c); }
  }
  return { byUrl, byDomain };
}

/**
 * Build a browser context with the Figma session restored CORRECTLY (split jar — see `splitJar`).
 * The only sanctioned way to open an authenticated Figma context, so no caller can get RC2 wrong.
 *
 * @param {import('playwright').Browser} browser
 * @param {object} [opts] Playwright `newContext` options, plus:
 *   `jar`      — an already-loaded jar object (skips the read)
 *   `authPath` — where to read the jar from (default `authPath()`)
 * @returns {Promise<import('playwright').BrowserContext>} context, with `context._figmaJar` = the jar used
 */
async function newAuthedContext(browser, opts = {}) {
  const { jar, authPath: p, ...contextOptions } = opts;
  const raw = jar || loadJar(p || authPath());
  const { byUrl, byDomain } = splitJar(raw.cookies);
  const context = await browser.newContext({
    ...contextOptions,
    storageState: { cookies: byDomain, origins: raw.origins || [] },
  });
  await context.addCookies(byUrl);
  try { context._figmaJar = raw; } catch { /* non-extensible in some builds */ }
  return context;
}

// ---------------------------------------------------------------------------
// probe — one real authenticated request, no browser
// ---------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** Cookie header for `host`, deduped by name keeping the most specific domain. */
function cookieHeader(cookies, host) {
  const best = new Map();
  for (const c of cookies) {
    const dom = String(c.domain || '').replace(/^\.+/, '');
    if (!dom || !(host === dom || host.endsWith('.' + dom))) continue;
    const prev = best.get(c.name);
    if (!prev || dom.length > String(prev.domain || '').replace(/^\.+/, '').length) best.set(c.name, c);
  }
  return [...best.values()].map((c) => `${c.name}=${c.value}`).join('; ');
}

function get(host, urlPath, cookie, timeoutMs) {
  return new Promise((resolve) => {
    const req = https.request(
      { host, path: urlPath, method: 'GET', headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'application/json,text/html' } },
      (res) => {
        let body = '';
        res.on('data', (c) => { if (body.length < 4096) body += c; });
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '', ctype: res.headers['content-type'] || '', body }));
      }
    );
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: `timeout after ${timeoutMs}ms` }); });
    req.end();
  });
}

/**
 * Ask Figma whether this jar is still a session. Browserless, so `--status` stays fast.
 *
 * `authenticated` is deliberately THREE-valued — `null` means "could not verify" (offline, timeout,
 * 429, 5xx, or the probe endpoint moved). A network failure must never be reported as an expired
 * session: that sends the operator into a pointless re-login.
 *
 * @returns {Promise<{authenticated:boolean|null, via:string, status?:number, reason:string, ms:number}>}
 */
async function probeSession(jar, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const host = 'www.figma.com';
  const cookie = cookieHeader(jar.cookies || [], host);
  const t0 = Date.now();
  const ms = () => Date.now() - t0;

  if (!cookie) return { authenticated: false, via: 'none', reason: 'jar holds no www.figma.com cookies', ms: ms() };

  // 1) Primary: an authenticated JSON endpoint. 200 = session, 401/403 = Figma rejected the jar.
  const api = await get(host, '/api/user/state', cookie, timeoutMs);
  if (!api.error) {
    if (api.status === 200 && /json/i.test(api.ctype)) {
      return { authenticated: true, via: 'GET /api/user/state', status: 200, reason: 'authenticated', ms: ms() };
    }
    if (api.status === 401 || api.status === 403) {
      let why = '';
      try { why = JSON.parse(api.body).reason || ''; } catch { /* not json */ }
      return { authenticated: false, via: 'GET /api/user/state', status: api.status, reason: `Figma rejected the session${why ? ` (${why})` : ''}`, ms: ms() };
    }
    // 404 (endpoint moved), 429, 5xx, an HTML 200 — inconclusive, fall through.
  }

  // 2) Fallback: /files 302s to /login when the account session is dead.
  const files = await get(host, '/files', cookie, timeoutMs);
  if (files.error) {
    return { authenticated: null, via: 'GET /files', reason: `could not reach Figma (${api.error || `/api/user/state → ${api.status}`}; ${files.error})`, ms: ms() };
  }
  if (files.status >= 300 && files.status < 400 && /\/login|\/signup/i.test(files.location)) {
    return { authenticated: false, via: 'GET /files', status: files.status, reason: `redirected to ${files.location}`, ms: ms() };
  }
  if (files.status === 200) {
    return { authenticated: true, via: 'GET /files', status: 200, reason: 'authenticated', ms: ms() };
  }
  return {
    authenticated: null, via: 'GET /files', status: files.status,
    reason: `inconclusive (/api/user/state → ${api.error || api.status}, /files → ${files.status})`, ms: ms(),
  };
}

// ---------------------------------------------------------------------------
// write-back — the actual cure for the recurring re-login
// ---------------------------------------------------------------------------

/** The cookie that IS the Figma account session. Its absence means "not logged in". */
function jarLooksAuthenticated(cookies) {
  if (!Array.isArray(cookies) || cookies.length < 1) return { ok: false, reason: 'no cookies' };
  const authn = cookies.find((c) => c.name === '__Host-figma.authn' && c.value);
  if (!authn) return { ok: false, reason: 'no __Host-figma.authn cookie — this jar is logged out' };
  return { ok: true, reason: 'has __Host-figma.authn' };
}

/**
 * Atomically persist a storageState as the session file — temp file + rename, and ONLY when the new
 * jar is genuinely authenticated and non-empty. This is the one file whose loss costs the operator a
 * manual re-login, so when in doubt the old jar is kept.
 *
 * @returns {{saved:boolean, reason:string, cookies:number, path:string}}
 */
function writeJar(state, p = authPath(), extra = {}) {
  const cookies = (state && state.cookies) || [];
  const guard = jarLooksAuthenticated(cookies);
  if (!guard.ok) return { saved: false, reason: `refused: ${guard.reason}`, cookies: cookies.length, path: p };

  const payload = {
    cookies,
    origins: (state && state.origins) || [],
    savedAt: new Date().toISOString(),
    ...extra,
  };
  const tmp = `${p}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, p);                       // atomic replace — a torn read is impossible
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    return { saved: false, reason: `write failed: ${e.message}`, cookies: cookies.length, path: p };
  }
  return { saved: true, reason: guard.reason, cookies: cookies.length, path: p, savedAt: payload.savedAt };
}

/**
 * Capture a live context's cookies back to the session file. Call this after ANY run that proved
 * authenticated: it banks Figma's rotated token and resets the freshness window on USE rather than
 * on last manual login. Never throws — a failed write-back must not fail the run that earned it.
 *
 * @param {object} [opts]
 *   `verify` — probe the captured jar (browserless, no navigation) and write ONLY if Figma confirms
 *              it. Use this wherever the run itself did not prove the ACCOUNT session — a
 *              link-shared file exports fine with no account session at all, and persisting that
 *              jar would overwrite a good one with a logged-out one.
 *   `timeoutMs` — probe timeout (default 6000).
 */
async function saveJar(context, p = authPath(), extra = {}, opts = {}) {
  let state;
  try {
    state = await context.storageState();
  } catch (e) {
    return { saved: false, reason: `storageState failed: ${e.message}`, cookies: 0, path: p };
  }
  if (opts.verify) {
    const guard = jarLooksAuthenticated(state.cookies || []);
    if (!guard.ok) return { saved: false, reason: `refused: ${guard.reason}`, cookies: (state.cookies || []).length, path: p };
    let probe;
    try {
      probe = await probeSession(state, { timeoutMs: opts.timeoutMs || 6000 });
    } catch (e) {
      probe = { authenticated: null, reason: `probe threw: ${e.message}`, via: 'probe' };
    }
    if (probe.authenticated !== true) {
      // Conservative on purpose: an unverifiable jar is never allowed to replace a working one.
      return { saved: false, reason: `refused: probe did not confirm the session (${probe.reason})`, cookies: (state.cookies || []).length, path: p, probe };
    }
    return { ...writeJar(state, p, extra), probe };
  }
  return writeJar(state, p, extra);
}

module.exports = {
  DEFAULT_AUTH_PATH,
  authPath,
  loadJar,
  splitJar,
  newAuthedContext,
  probeSession,
  jarLooksAuthenticated,
  writeJar,
  saveJar,
};
