/**
 * JSON Repair Layer tests (Phase 1 #1) — zero-dependency, run with:
 *   npm run build -w @qa/engine && node --test packages/engine/json.test.mjs
 * Imports the COMPILED module so it exercises exactly what ships.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonTolerant } from './dist/json.js';

const ok = (input) => {
  const r = parseJsonTolerant(input);
  assert.ok(r !== undefined, `expected parseable, got undefined for: ${JSON.stringify(input)?.slice(0, 80)}`);
  return r;
};

test('fast path: already-valid JSON parses without repair', () => {
  const r = ok('{"a":1,"b":"x"}');
  assert.equal(r.repaired, false);
  assert.equal(r.stage, 'direct');
  assert.deepEqual(r.value, { a: 1, b: 'x' });
});

test('strips ```json code fences', () => {
  const r = ok('```json\n{"a":1}\n```');
  assert.equal(r.value.a, 1);
});

test('strips bare ``` fences', () => {
  const r = ok('```\n{"a":1}\n```');
  assert.equal(r.value.a, 1);
});

test('ignores prose before and after the object', () => {
  const r = ok('Here is your result:\n{"a":1}\nHope that helps!');
  assert.equal(r.value.a, 1);
  assert.equal(r.repaired, true);
});

test('removes trailing commas (object and array)', () => {
  const r = ok('{"a":1,"list":[1,2,3,],}');
  assert.deepEqual(r.value, { a: 1, list: [1, 2, 3] });
});

test('strips // line comments and /* block */ comments', () => {
  const r = ok('{\n  "a": 1, // inline\n  /* block */ "b": 2\n}');
  assert.deepEqual(r.value, { a: 1, b: 2 });
});

test('normalizes smart/typographic quotes', () => {
  // curly double quotes around key and value
  const r = ok('{“a”:“hello”}');
  assert.equal(r.value.a, 'hello');
});

test('escapes raw newlines inside a string value', () => {
  const r = ok('{"note":"line one\nline two"}');
  assert.equal(r.value.note, 'line one\nline two');
});

test('escapes raw tab inside a string value', () => {
  const r = ok('{"note":"a\tb"}');
  assert.equal(r.value.note, 'a\tb');
});

test('does NOT corrupt braces that live inside string values', () => {
  const r = ok('{"code":"if (x) { return {a:1}; }","n":2}');
  assert.equal(r.value.code, 'if (x) { return {a:1}; }');
  assert.equal(r.value.n, 2);
});

test('handles a realistic messy LLM reply (fence + prose + trailing comma + newline)', () => {
  const messy =
    'Sure — here is the analysis:\n```json\n' +
    '{\n  "businessObjective": "Let users\nredeem perks",\n  "risks": ["a","b",],\n}\n' +
    '```\nLet me know if you want changes.';
  const r = ok(messy);
  assert.equal(r.value.businessObjective, 'Let users\nredeem perks');
  assert.deepEqual(r.value.risks, ['a', 'b']);
  assert.equal(r.repaired, true);
});

test('returns undefined for genuinely unparseable garbage', () => {
  assert.equal(parseJsonTolerant('this is not json at all'), undefined);
  assert.equal(parseJsonTolerant(''), undefined);
  assert.equal(parseJsonTolerant(null), undefined);
  assert.equal(parseJsonTolerant(undefined), undefined);
});

test('parses top-level arrays too', () => {
  const r = ok('```json\n[{"a":1},{"a":2},]\n```');
  assert.equal(r.value.length, 2);
});
