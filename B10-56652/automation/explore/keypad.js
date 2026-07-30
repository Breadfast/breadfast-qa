'use strict';
/**
 * Numeric-keypad driver for the Pay passcode / Pay-access-OTP screens.
 *
 * Two platform realities, discovered live 2026-07-28:
 *
 *  • **iOS** labels every key in the accessibility tree, so keys are resolved from the LIVE tree.
 *    This matters because in **Arabic the keypad is MIRRORED** (١ sits in the right-hand column,
 *    ٣ in the left) **and the digits render as Arabic-Indic numerals** (`۱۲۳٤٥٦۷۸۹۰`). Hard-coded
 *    LTR coordinates silently enter the WRONG passcode in ar/EG — which is exactly how the first
 *    iOS Arabic run failed. Resolving from the tree is therefore both locale-proof and self-documenting.
 *
 *  • **Android** exposes NO labels anywhere on the Pay surface (the whole content area is a single
 *    unlabelled `android.view.View`), so it must be driven by coordinates — and the Arabic layout is
 *    mirrored there too, so the column order is flipped for ar.
 */
const { tap, sleep, getSource } = require('../../../bs_helper.js');
const session = require('./session.js');
const { inventory, centre } = require('./drive.js');

// Digit glyph variants a key label may use: ASCII, Arabic-Indic, Extended (Persian) Arabic-Indic.
const GLYPHS = {
  0: ['0', '٠', '۰'], 1: ['1', '١', '۱'], 2: ['2', '٢', '۲'], 3: ['3', '٣', '۳'], 4: ['4', '٤', '۴'],
  5: ['5', '٥', '۵'], 6: ['6', '٦', '۶'], 7: ['7', '٧', '۷'], 8: ['8', '٨', '۸'], 9: ['9', '٩', '۹'],
};

// Samsung Galaxy S23, 1080×2340 — "Unlock Breadfast Pay" 6-dot passcode keypad, LTR (en).
const ANDROID_LTR = {
  1: [240, 1224], 2: [539, 1224], 3: [839, 1224],
  4: [240, 1487], 5: [539, 1487], 6: [839, 1487],
  7: [240, 1751], 8: [539, 1751], 9: [839, 1751],
  0: [539, 2015], backspace: [839, 2015],
};

// Arabic mirrors the columns: 1 moves to the right-hand column, 3 to the left.
const ANDROID_RTL = {
  1: [839, 1224], 2: [539, 1224], 3: [240, 1224],
  4: [839, 1487], 5: [539, 1487], 6: [240, 1487],
  7: [839, 1751], 8: [539, 1751], 9: [240, 1751],
  0: [539, 2015], backspace: [240, 2015],
};

/** Resolve digit → tap point from the live accessibility tree (iOS). Returns null if unlabelled. */
async function resolveFromTree(sid) {
  const rows = inventory(await getSource(sid));
  const map = {};
  for (const d of Object.keys(GLYPHS)) {
    const hit = rows.find((r) => {
      const t = String(r.name || r.label || r.text || '').trim();
      return GLYPHS[d].includes(t);
    });
    if (hit) {
      const c = centre(hit.bounds);
      if (c) map[d] = [c.x, c.y];
    }
  }
  return Object.keys(map).length >= 10 ? map : null;
}

function coordMap(platform, locale) {
  if (platform === 'ios') return null; // iOS always resolves from the tree
  return locale === 'ar' ? ANDROID_RTL : ANDROID_LTR;
}

/**
 * Enter digits on the keypad.
 * @param {string} sid      BrowserStack session id
 * @param {string} platform 'ios' | 'android'
 * @param {string} digits   e.g. '123321'
 * @param {{locale?:string, pauseMs?:number}} opts
 */
async function enter(sid, platform, digits, { locale = 'en', pauseMs = 450 } = {}) {
  let map = platform === 'ios' ? await resolveFromTree(sid) : coordMap(platform, locale);
  if (!map) {
    // iOS tree not (yet) labelled — fall back to the measured LTR/RTL iOS geometry.
    const cols = locale === 'ar' ? [295, 195, 95] : [95, 195, 295];
    map = {
      1: [cols[0], 500], 2: [cols[1], 500], 3: [cols[2], 500],
      4: [cols[0], 588], 5: [cols[1], 588], 6: [cols[2], 588],
      7: [cols[0], 676], 8: [cols[1], 676], 9: [cols[2], 676],
      0: [195, 764], backspace: [cols[2], 764],
    };
  }
  for (const d of String(digits)) {
    const p = map[d];
    if (!p) throw new Error(`no keypad key resolved for digit ${d} (${platform}/${locale})`);
    await tap(sid, p[0], p[1]);
    await sleep(pauseMs);
  }
  return map;
}

module.exports = { enter, resolveFromTree, ANDROID_LTR, ANDROID_RTL, GLYPHS };

if (require.main === module) {
  const [platform = 'android', locale = 'en', digits = '123321'] = process.argv.slice(2);
  const sid = session.readId(platform, locale);
  if (!sid) { console.error('no session for ' + platform + '-' + locale); process.exit(1); }
  enter(sid, platform, digits, { locale })
    .then((m) => console.log(`entered ${String(digits).length} digits on ${platform}/${locale}; key map: ` +
      Object.keys(m).filter((k) => k !== 'backspace').sort().map((k) => `${k}@${m[k]}`).join(' ')))
    .catch((e) => { console.error('ERR', e.message); process.exit(1); });
}
