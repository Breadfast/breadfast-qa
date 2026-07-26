/**
 * VT0-S3 — Screen Registry types + loader + Evidence Manifest.
 *   npm run build -w @qa/shared && node --test packages/shared/screen-registry.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  Screen, ScreenRegistry, ValidationProfile, EvidenceManifest, EvidenceManifestRow,
  SCREEN_PLATFORMS, VALIDATION_MODES, deriveSupportedTestCases,
} from './dist/index.js';
import { loadScreenRegistry } from './dist/screen-registry-loader.js';

test('constants exported', () => {
  assert.deepEqual([...SCREEN_PLATFORMS], ['web', 'ios', 'android']);
  assert.ok(VALIDATION_MODES.includes('design-conformance'));
});

test('Screen: minimal parse applies defaults; no supportedTestCases field', () => {
  const s = Screen.parse({ id: 'address-list' });
  assert.equal(s.version, 1);
  assert.deepEqual(s.variants, []);
  assert.deepEqual(s.expectedComponents, []);
  assert.ok(!('supportedTestCases' in s), 'supportedTestCases must be derived, not stored');
});

test('Screen: variant-aware — figmaNodeId lives on the variant', () => {
  const s = Screen.parse({
    id: 'address-list', displayName: 'Address list', profileId: 'default',
    variants: [
      { platform: 'ios', locale: 'ar-EG', figmaNodeId: '1:2', figmaFrameName: 'Address / AR' },
      { platform: 'android', locale: 'en-US', figmaNodeId: '1:3' },
    ],
  });
  assert.equal(s.variants.length, 2);
  assert.equal(s.variants[0].figmaNodeId, '1:2');
  assert.equal(s.variants[0].platform, 'ios');
  assert.throws(() => Screen.parse({ id: 'x', variants: [{ platform: 'desktop', locale: 'en' }] }), 'invalid platform rejected');
});

test('ValidationProfile: defaults to design-conformance with all layers', () => {
  const p = ValidationProfile.parse({ id: 'default' });
  assert.equal(p.mode, 'design-conformance');
  assert.equal(p.enabledLayers.length, 8);
  assert.equal(p.tolerances.px, 2);
});

test('deriveSupportedTestCases: reverse-index, unique + sorted, ignores empties', () => {
  const idx = deriveSupportedTestCases([
    { testCaseId: 'TC-2', screenId: 'home' },
    { testCaseId: 'TC-1', screenId: 'home' },
    { testCaseId: 'TC-1', screenId: 'home' }, // dup
    { testCaseId: 'TC-9', screenId: 'cart' },
    { testCaseId: '', screenId: 'home' },      // ignored
    { testCaseId: 'TC-3', screenId: '' },      // ignored
  ]);
  assert.deepEqual(idx.home, ['TC-1', 'TC-2']);
  assert.deepEqual(idx.cart, ['TC-9']);
});

test('EvidenceManifest: round-trips (parse ∘ serialize is stable)', () => {
  const row = EvidenceManifestRow.parse({ screenId: 'home', platform: 'web', screenshotPath: '/s/1.png' });
  assert.equal(row.locale, 'en-US'); // default
  const m = EvidenceManifest.parse({ rows: [row] });
  const again = EvidenceManifest.parse(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(again, m);
  assert.equal(again.manifestVersion, 1);
});

// ── Loader (fs) ────────────────────────────────────────────────────────────
test('loader: empty when directory is absent', () => {
  const reg = loadScreenRegistry(path.join(tmpdir(), 'qa-screens-does-not-exist-xyz'));
  assert.deepEqual(reg, ScreenRegistry.parse({}));
});

test('loader: reads a single-screen file, an array file, and a chunk file; skips _* and non-json', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-screens-'));
  try {
    writeFileSync(path.join(dir, 'a-single.json'), JSON.stringify({ id: 'home', variants: [{ platform: 'web', locale: 'en-US', figmaNodeId: '1:1' }] }));
    writeFileSync(path.join(dir, 'b-array.json'), JSON.stringify([{ id: 'cart' }, { id: 'checkout' }]));
    writeFileSync(path.join(dir, 'c-chunk.json'), JSON.stringify({ profiles: [{ id: 'default' }], screens: [{ id: 'profile' }] }));
    writeFileSync(path.join(dir, '_notes.json'), JSON.stringify({ id: 'IGNORED' }));
    writeFileSync(path.join(dir, 'readme.md'), 'not json');
    const reg = loadScreenRegistry(dir);
    const ids = reg.screens.map((s) => s.id).sort();
    assert.deepEqual(ids, ['cart', 'checkout', 'home', 'profile']);
    assert.equal(reg.profiles.length, 1);
    assert.equal(reg.profiles[0].id, 'default');
    assert.equal(reg.screens.find((s) => s.id === 'home').variants[0].figmaNodeId, '1:1');
    assert.ok(!ids.includes('IGNORED'), '_*.json skipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loader: throws a file-scoped error on invalid JSON', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'qa-screens-'));
  try {
    writeFileSync(path.join(dir, 'bad.json'), '{ not valid');
    assert.throws(() => loadScreenRegistry(dir), /bad\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── VT4-S7 — registry validation (duplicate detection) ───────────────────────
test('validateScreenRegistry: duplicate screenId + profile id are errors', async () => {
  const { validateScreenRegistry } = await import('./dist/index.js');
  const reg = ScreenRegistry.parse({
    profiles: [{ id: 'default' }, { id: 'default' }],
    screens: [{ id: 'home', variants: [{ platform: 'web', locale: 'en-US', figmaNodeId: '1:1' }] },
              { id: 'home', variants: [{ platform: 'web', locale: 'en-US', figmaNodeId: '1:2' }] },
              { id: 'cart', profileId: 'ghost', variants: [{ platform: 'web', locale: 'en-US', figmaNodeId: '1:3' }] }],
  });
  const errs = validateScreenRegistry(reg).filter((i) => i.level === 'error').map((i) => i.message);
  assert.ok(errs.some((m) => /Duplicate screenId "home"/.test(m)));
  assert.ok(errs.some((m) => /Duplicate ValidationProfile id "default"/.test(m)));
  assert.ok(errs.some((m) => /unknown profileId "ghost"/.test(m)));
});

test('validateScreenRegistry: clean registry ⇒ no errors; missing figmaNodeId ⇒ warning', async () => {
  const { validateScreenRegistry } = await import('./dist/index.js');
  const reg = ScreenRegistry.parse({ profiles: [{ id: 'default' }], screens: [
    { id: 'home', profileId: 'default', variants: [{ platform: 'web', locale: 'en-US' }] } ] });
  const issues = validateScreenRegistry(reg);
  assert.equal(issues.filter((i) => i.level === 'error').length, 0);
  assert.ok(issues.some((i) => i.level === 'warning' && /no figmaNodeId/.test(i.message)));
});
