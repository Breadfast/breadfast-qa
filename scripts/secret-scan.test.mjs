// Tests for scripts/secret-scan.mjs. Fixture "secrets" below are synthetic: built at runtime so this
// file itself never contains a credential-shaped literal.
import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, scanRepo, lineHash } from './secret-scan.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fake = (n) => 'Q7x!'.repeat(Math.ceil(n / 4)).slice(0, n);

test('catches the CardConfig shape: process.env.X_PASS || "<literal>"', () => {
  const line = `      password: process.env.BF_CARD_DB_PASS || '${fake(16)}',`;
  const f = scanText('a.js', line);
  assert.ok(f.some((x) => x.kind === 'env-fallback:BF_CARD_DB_PASS'), JSON.stringify(f));
});

test('catches a key assigned a quoted literal (the old doc accessKey shape)', () => {
  const f = scanText('a.md', `  accessKey: "${'A1b2C3d4'.repeat(3).slice(0, 20)}"`);
  assert.ok(f.some((x) => x.kind === 'assigned:accesskey'));
});

test('catches known token formats', () => {
  const f = scanText('a.js', `const t = '${'ATATT' + 'x'.repeat(40)}';`);
  assert.ok(f.some((x) => x.kind === 'atlassian-token'));
});

test('ignores env lookups, placeholders and empty fallbacks', () => {
  const lines = [
    "password: process.env.CARD_DB_PASSWORD,",
    "token: 'your-token-here',",
    "whitelistToken: k.cardServiceLoginWhitelistToken || '',",
    "'X-Atlassian-Token': 'no-check'",
    "password: required(pick('CARD_DB_PASSWORD'), 'card DB password', hint)",
  ];
  assert.deepEqual(scanText('a.js', lines.join('\n')), []);
});

test('a finding never contains the matched value', () => {
  const secret = fake(16);
  const f = scanText('a.js', `password: process.env.X_PASS || '${secret}'`);
  assert.ok(f.length);
  assert.ok(!JSON.stringify(f).includes(secret));
});

test('allowlist entries match by file + line hash only', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'secscan-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  const line = `token: '${fake(20)}'`;
  writeFileSync(path.join(root, 'f.js'), line + '\n');
  mkdirSync(path.join(root, 'scripts'));
  execFileSync('git', ['add', '.'], { cwd: root });
  assert.equal(scanRepo(root).length, 1);
  writeFileSync(path.join(root, 'scripts', 'secret-scan.allow.json'),
    JSON.stringify({ allow: [{ file: 'f.js', hash: lineHash(line), reason: 'fixture' }] }));
  assert.equal(scanRepo(root).length, 0);
});

test('THIS repo at HEAD has no unallowlisted credential literal', () => {
  const findings = scanRepo(REPO);
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line} ${f.kind}`), []);
});
