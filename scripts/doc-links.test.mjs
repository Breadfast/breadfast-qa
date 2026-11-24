// Every relative markdown link in a tracked doc resolves. Added with the 2026-11-24 knowledge move, which
// relocated business/module docs into qa-workflow/domains/ — a broken link there silently drops knowledge.
// Story folders (gitignored) and imported reference material are not checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = [/^docs\/ai\/reference\//, /^docs\/ai\/architecture\/legacy-qa-platform\//, /^docs\/comparison\//];

function mdFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').filter((f) => f && !SKIP.some((r) => r.test(f)) && existsSync(path.join(REPO, f)));
}

export function brokenLinks(file, text) {
  const out = [];
  const noCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of noCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#|<)/.test(target)) continue;
    const clean = decodeURIComponent(target.split('#')[0]);
    if (!clean) continue;
    if (!existsSync(path.resolve(path.dirname(path.join(REPO, file)), clean))) out.push(`${file} → ${target}`);
  }
  return out;
}

test('every relative markdown link in tracked docs resolves', () => {
  const broken = mdFiles().flatMap((f) => brokenLinks(f, readFileSync(path.join(REPO, f), 'utf8')));
  assert.deepEqual(broken, []);
});
