/**
 * Deterministic style normalization (BACKLOG-002 VT3-S3, ADR-002 Rev.2 §2).
 *
 * Cross-source style comparison (Figma tokens vs browser/native computed values)
 * needs normalization before any tolerance check (VT4-L6). Pure + browser-safe;
 * no comparison logic here — just canonical forms + a perceptual color distance.
 */

export interface Rgb {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', gray: '#808080', grey: '#808080', transparent: 'rgba(0,0,0,0)',
};

/** Parse #hex (3/4/6/8), rgb()/rgba(), or a small set of named colors → Rgb, else null. */
export function parseColor(input?: string | null): Rgb | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a };
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (m) {
    const r = Number(m[1]); const g = Number(m[2]); const b = Number(m[3]);
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
    return { r, g, b, a };
  }
  return null;
}

// sRGB → linear → XYZ (D65) → Lab, then CIE76 ΔE. Enough to gate "same-ish color".
function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function rgbToLab({ r, g, b }: Rgb): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  // XYZ (sRGB D65)
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Perceptual color distance (CIE76 ΔE). 0 = identical; ~2.3 = just-noticeable. */
export function colorDeltaE(a?: string | null, b?: string | null): number | null {
  const ca = parseColor(a); const cb = parseColor(b);
  if (!ca || !cb) return null;
  const [l1, a1, b1] = rgbToLab(ca);
  const [l2, a2, b2] = rgbToLab(cb);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/** Normalize a CSS length to px. Supports px, rem/em (×rootPx), pt (×4/3). null if unparseable. */
export function normalizeLength(input?: string | null, rootPx = 16): number | null {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  const m = s.match(/^(-?[\d.]+)(px|rem|em|pt)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isNaN(n)) return null;
  switch (m[2]) {
    case 'rem': case 'em': return n * rootPx;
    case 'pt': return (n * 4) / 3;
    default: return n; // px or unitless
  }
}

/** Canonical font-family: first family, unquoted, lowercased, single-spaced. */
export function normalizeFontFamily(input?: string | null): string {
  if (!input) return '';
  return input.split(',')[0].replace(/["']/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}
