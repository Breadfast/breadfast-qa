'use strict';

/**
 * Real PixelComparator adapter (L7 feeder) — decodes PNGs with Node's built-in
 * `zlib` (NO npm deps: pixelmatch/pngjs aren't resolvable from qa-workflow, and
 * the core must stay dependency-free). Node-only (fs/zlib/Buffer) — it's an
 * ADAPTER, not core. Supports 8-bit RGB/RGBA, non-interlaced PNGs with all five
 * spec filters (None/Sub/Up/Average/Paeth) — the format Playwright/BrowserStack
 * screenshots use. Dimension-gated: mismatched sizes ⇒ null (design@2x vs a device
 * screenshot rarely share dimensions), so L7 stays advisory.
 *
 * Produces the `{ diffRatio, diffPixels }` an injected `PixelComparator` supplies to
 * L7 (`capabilities/visual/layers/pixel.js`) via `actual.pixelDiff`.
 */

const fs = require('fs');
const zlib = require('zlib');

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[rowStart - stride + x] : 0;
      const c = y > 0 && x >= bpp ? out[rowStart - stride + x - bpp] : 0;
      let val;
      switch (filter) {
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: val = rawByte; // 0 = None
      }
      out[rowStart + x] = val & 0xff;
    }
  }
  return out;
}

function toRGBA(unfiltered, width, height, channels) {
  if (channels === 4) return unfiltered;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < unfiltered.length; i += 3, j += 4) {
    out[j] = unfiltered[i];
    out[j + 1] = unfiltered[i + 1];
    out[j + 2] = unfiltered[i + 2];
    out[j + 3] = 255;
  }
  return out;
}

/** Decode an 8-bit RGB/RGBA non-interlaced PNG → { width, height, data:RGBA }, else null. */
function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const dataStart = pos + 8;
    if (dataStart + len > buf.length) break;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
      interlace = buf[dataStart + 12];
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + len + 4; // data + crc
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) return null;
  const channels = colorType === 6 ? 4 : 3;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  return { width, height, data: toRGBA(unfilter(raw, width, height, channels), width, height, channels) };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encode an 8-bit RGBA image (filter None) → PNG Buffer. Useful for baselines/tests. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    rows[y * (stride + 1)] = 0; // filter None
    rgba.copy(rows, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** Count pixels whose max channel delta exceeds `threshold`; return diff ratio. */
function diffRGBA(a, b, threshold) {
  const total = a.length / 4;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    if (Math.max(dr, dg, db) > threshold) diff++;
  }
  return { diffPixels: diff, diffRatio: total ? diff / total : 0 };
}

/** The PixelComparator port implementation. Returns null when it cannot compare. */
const pngPixelComparator = {
  async compare(expectedPath, actualPath, opts = {}) {
    let eb;
    let ab;
    try { eb = fs.readFileSync(expectedPath); ab = fs.readFileSync(actualPath); } catch { return null; }
    const e = decodePng(eb);
    const a = decodePng(ab);
    if (!e || !a) return null;
    if (e.width !== a.width || e.height !== a.height) return null; // dimension-gated
    return diffRGBA(e.data, a.data, opts.channelThreshold != null ? opts.channelThreshold : 30);
  },
};

module.exports = { pngPixelComparator, decodePng, encodePng, diffRGBA };
