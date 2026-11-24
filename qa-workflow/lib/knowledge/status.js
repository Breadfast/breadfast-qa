'use strict';

/**
 * knowledge-status — is a team's context still true?
 *   (a) age: verifiedAt older than maxAgeDays → stale
 *   (b) drift: each [confirmed: repo:<id>@<sha>:<path>] whose path changed between <sha> and the granted
 *       repo's HEAD (read-only `git diff --quiet`). A repo that is not granted/located is "unchecked".
 *   (c) counts of unknown / outdated facts
 * Never edits anything and never fetches: it reads the local clone as it is.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CITE = /\[confirmed:\s*repo:([a-z0-9][a-z0-9._-]*)@([0-9a-f]{7,40}):([^\s:;\]]+)(?::\d+)?\s*;/g;

function daysBetween(a, b) { return Math.floor((b - a) / 86400000); }

/**
 * @param {string} teamDir
 * @param {object} opts { repos: { <id>: { path, granted } }, maxAgeDays = 90, now = Date.now() }
 */
function knowledgeStatus(teamDir, opts = {}) {
  const file = path.join(teamDir, 'context.md');
  if (!fs.existsSync(file)) return { exists: false, stale: true, reasons: ['no context.md — run team onboarding'] };
  const text = fs.readFileSync(file, 'utf8');
  const maxAgeDays = opts.maxAgeDays == null ? 90 : opts.maxAgeDays;
  const now = opts.now || Date.now();
  const reasons = [];

  const v = text.match(/verifiedAt:\s*(\d{4}-\d{2}-\d{2})/);
  const ageDays = v ? daysBetween(Date.parse(v[1] + 'T00:00:00Z'), now) : null;
  if (ageDays == null) reasons.push('no verifiedAt date');
  else if (ageDays > maxAgeDays) reasons.push(`verified ${ageDays} days ago (threshold ${maxAgeDays})`);

  const citations = [];
  for (const m of text.matchAll(CITE)) {
    const [, id, sha, rel] = m;
    const grant = (opts.repos || {})[id];
    let state = 'unchecked';
    if (grant && grant.granted && grant.path && fs.existsSync(grant.path)) {
      try {
        execFileSync('git', ['-C', grant.path, 'diff', '--quiet', sha, 'HEAD', '--', rel], { stdio: 'ignore' });
        state = 'unchanged';
      } catch (e) {
        state = e.status === 1 ? 'changed' : 'unresolvable'; // 1 = differences; other = unknown sha/path
      }
    }
    citations.push({ repo: id, sha, path: rel, state });
  }
  const changed = citations.filter((c) => c.state === 'changed');
  if (changed.length) reasons.push(`${changed.length} confirmed fact(s) cite code that changed since it was read`);

  const count = (re) => (text.match(re) || []).length;
  return {
    exists: true,
    verifiedAt: v ? v[1] : null,
    ageDays,
    maxAgeDays,
    citations,
    unknown: count(/\[unknown\]/g),
    outdated: count(/\[outdated:/g),
    stale: reasons.length > 0,
    reasons,
  };
}

module.exports = { knowledgeStatus };
