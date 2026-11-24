'use strict';

/**
 * Credential-looking patterns — the ONE definition, shared by scripts/secret-scan.mjs (the repo gate) and
 * qa-workflow/lib/knowledge/lint.js (team context / domain files written by onboarding and discovery).
 * A finding never carries the matched value: callers report kind + length only.
 */

/** Token formats that are secrets whatever variable holds them. */
const KNOWN_FORMATS = [
  ['atlassian-token', /ATATT[A-Za-z0-9_\-=]{20,}/],
  ['figma-token', /figd_[A-Za-z0-9_\-]{20,}/],
  ['slack-token', /xox[abposr]-[A-Za-z0-9-]{10,}/],
  ['google-api-key', /AIza[0-9A-Za-z_\-]{30,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-access-key', /AKIA[0-9A-Z]{16}/],
  ['github-token', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['credentialed-url', /https?:\/\/[^\s:@/'"`]+:[^\s@/'"`]{6,}@[^\s'"`]+/],
];

/** A credential-named key or variable assigned a quoted literal of 8+ chars. */
const NAMED = /(pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization)["'`]?\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i;
/** `process.env.X || '<literal>'` with a credential-ish env name — the old CardConfig shape. */
const ENV_FALLBACK = /process\.env\.([A-Z0-9_]*(?:PASS|SECRET|TOKEN|KEY)[A-Z0-9_]*)\s*\|\|\s*["'`]([^"'`\s]{6,})["'`]/;
/** Values that are obviously not secrets. */
const PLACEHOLDER = /^(your[-_]|<|\$\{|todo|xxx|changeme|change-me|placeholder|example|dummy|fake|test|redacted|\*+|no-check)|\.\.\.|^(badge|header|bearer)[-_ ]/i;

/** Findings for one line: [{ kind, length }] — never the value. */
function scanLine(line) {
  const out = [];
  for (const [kind, re] of KNOWN_FORMATS) {
    const m = line.match(re);
    if (m) out.push({ kind, length: m[0].length });
  }
  const env = line.match(ENV_FALLBACK);
  if (env && !PLACEHOLDER.test(env[2])) out.push({ kind: `env-fallback:${env[1]}`, length: env[2].length });
  const named = line.match(NAMED);
  if (named && !PLACEHOLDER.test(named[2]) && !/^process\.env/.test(named[2])) {
    out.push({ kind: `assigned:${named[1].toLowerCase()}`, length: named[2].length });
  }
  return out;
}

module.exports = { KNOWN_FORMATS, NAMED, ENV_FALLBACK, PLACEHOLDER, scanLine };
