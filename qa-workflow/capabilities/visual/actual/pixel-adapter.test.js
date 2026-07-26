'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pngPixelComparator, decodePng, encodePng } = require('./pixel-adapter');

function solid(w, h, [r, g, b, a]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a; }
  return buf;
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'px-')); }

test('encode → decode round-trips pixels', () => {
  const rgba = solid(3, 2, [10, 20, 30, 255]);
  const dec = decodePng(encodePng(3, 2, rgba));
  assert.equal(dec.width, 3);
  assert.equal(dec.height, 2);
  assert.deepEqual([...dec.data], [...rgba]);
});

test('compare: identical ⇒ 0; all-different ⇒ 1.0', async () => {
  const d = tmp();
  const black = path.join(d, 'black.png');
  const black2 = path.join(d, 'black2.png');
  const white = path.join(d, 'white.png');
  fs.writeFileSync(black, encodePng(2, 2, solid(2, 2, [0, 0, 0, 255])));
  fs.writeFileSync(black2, encodePng(2, 2, solid(2, 2, [0, 0, 0, 255])));
  fs.writeFileSync(white, encodePng(2, 2, solid(2, 2, [255, 255, 255, 255])));
  assert.equal((await pngPixelComparator.compare(black, black2)).diffRatio, 0);
  assert.equal((await pngPixelComparator.compare(black, white)).diffRatio, 1);
});

test('compare: partial diff ⇒ fractional ratio', async () => {
  const d = tmp();
  const base = solid(2, 2, [0, 0, 0, 255]);
  const one = Buffer.from(base);
  one[0] = 255; one[1] = 255; one[2] = 255; // flip 1 of 4 pixels to white
  const a = path.join(d, 'a.png');
  const b = path.join(d, 'b.png');
  fs.writeFileSync(a, encodePng(2, 2, base));
  fs.writeFileSync(b, encodePng(2, 2, one));
  assert.equal((await pngPixelComparator.compare(a, b)).diffRatio, 0.25);
});

test('compare: dimension mismatch ⇒ null (dimension-gated)', async () => {
  const d = tmp();
  const a = path.join(d, 'a.png');
  const b = path.join(d, 'b.png');
  fs.writeFileSync(a, encodePng(2, 2, solid(2, 2, [0, 0, 0, 255])));
  fs.writeFileSync(b, encodePng(3, 3, solid(3, 3, [0, 0, 0, 255])));
  assert.equal(await pngPixelComparator.compare(a, b), null);
  assert.equal(await pngPixelComparator.compare(path.join(d, 'missing.png'), b), null); // unreadable → null
});
