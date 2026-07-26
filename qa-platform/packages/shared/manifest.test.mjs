/**
 * VT2-S1 — Evidence Manifest synthesis + resolver integration.
 *   npm run build -w @qa/shared && node --test packages/shared/manifest.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EvidenceManifest, synthesizeManifest, buildManifestFromExecution, toScreenPlatform,
  EVIDENCE_MANIFEST_FILENAME, resolvePair,
} from './dist/index.js';

test('EVIDENCE_MANIFEST_FILENAME is the conventional filename', () => {
  assert.equal(EVIDENCE_MANIFEST_FILENAME, 'evidence-manifest.json');
});

test('synthesizeManifest: valid manifest, empty screenId, defaults applied', () => {
  const m = synthesizeManifest(['/s/1_home.png', '/s/2_cart.png'], { platform: 'web' });
  const parsed = EvidenceManifest.parse(m); // must satisfy the schema
  assert.equal(parsed.manifestVersion, 1);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].screenId, '');       // unknown identity
  assert.equal(parsed.rows[0].locale, 'en-US');    // default
  assert.equal(parsed.rows[0].platform, 'web');
  assert.equal(parsed.rows[1].screenshotPath, '/s/2_cart.png');
});

test('synthesized manifest ⇒ heuristic pairing (identical to VT1-S1: no screenId)', () => {
  const m = synthesizeManifest(['/s/1_home.png', '/s/2_address_list.png'], { platform: 'web' });
  const shotRefs = m.rows.map((r) => ({ path: r.screenshotPath, screenId: r.screenId || undefined }));
  const r = resolvePair({ name: 'Address list' }, shotRefs);
  assert.equal(r.method, 'heuristic');            // no screenId ⇒ registry branch skipped
  assert.equal(r.shot.path, '/s/2_address_list.png');
});

test('real manifest with screenId ⇒ deterministic registry pairing', () => {
  const manifest = EvidenceManifest.parse({
    rows: [
      { screenId: 'home', platform: 'web', screenshotPath: '/s/a.png' },
      { screenId: 'address-list', platform: 'web', screenshotPath: '/s/b.png' },
    ],
  });
  const shotRefs = manifest.rows.map((r) => ({ path: r.screenshotPath, screenId: r.screenId || undefined }));
  const r = resolvePair({ name: 'totally unrelated name', screenId: 'address-list' }, shotRefs);
  assert.equal(r.method, 'registry');
  assert.equal(r.shot.path, '/s/b.png');
  assert.equal(r.confidence, 1);
});

// ── VT2-S2/S3 — deterministic emitter from execution results ─────────────────
test('toScreenPlatform: web/ios/android; mobile/unknown → android', () => {
  assert.equal(toScreenPlatform('web'), 'web');
  assert.equal(toScreenPlatform('iOS'), 'ios');
  assert.equal(toScreenPlatform('Android'), 'android');
  assert.equal(toScreenPlatform('mobile'), 'android');
  assert.equal(toScreenPlatform(''), 'android');
});

test('buildManifestFromExecution: web + mobile rows, testCaseId, image-only, dedupe', () => {
  const exec = { cases: [
    { title: 'TC-1 Home', combo: 'web · en-US', evidence: ['/s/1_home.png', '/s/1_home.png', '/s/rec.mp4'] },
    { title: 'TC-2 Cart', combo: 'android · ar-EG', evidence: ['/s/2_cart.jpg'] },
    { title: 'TC-3 Empty', combo: 'ios · en-US', evidence: [] },
  ] };
  const m = buildManifestFromExecution(exec);
  EvidenceManifest.parse(m); // valid
  assert.equal(m.rows.length, 2, 'recording + duplicate + empty excluded');
  assert.deepEqual(m.rows[0], { screenId: '', platform: 'web', locale: 'en-US', screenshotPath: '/s/1_home.png', testCaseId: 'TC-1 Home' });
  assert.equal(m.rows[1].platform, 'android');
  assert.equal(m.rows[1].locale, 'ar-EG');
});

test('buildManifestFromExecution: empty/undefined execution → empty manifest', () => {
  assert.deepEqual(buildManifestFromExecution(undefined).rows, []);
  assert.deepEqual(buildManifestFromExecution({ cases: [] }).rows, []);
});

test('buildManifestFromExecution: defaults apply when combo is missing', () => {
  const m = buildManifestFromExecution({ cases: [{ title: 'x', evidence: ['/s/a.png'] }] }, { defaultPlatform: 'ios', defaultLocale: 'ar-EG' });
  assert.equal(m.rows[0].platform, 'ios');
  assert.equal(m.rows[0].locale, 'ar-EG');
});

test('VT3: buildManifestFromExecution maps case.structuredDump to the first image row', () => {
  const m = buildManifestFromExecution({ cases: [
    { title: 'TC-1', combo: 'web · en-US', evidence: ['/s/1.png', '/s/2.png'], structuredDump: '/s/1.dump.json' },
    { title: 'TC-2', combo: 'web · en-US', evidence: ['/s/3.png'] },
  ] });
  assert.equal(m.rows[0].structuredDumpPath, '/s/1.dump.json'); // first row of the case
  assert.equal(m.rows[1].structuredDumpPath, undefined);        // second screenshot of same case: no dump
  assert.equal(m.rows[2].structuredDumpPath, undefined);        // case with no dump
});
