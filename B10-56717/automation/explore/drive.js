'use strict';
/**
 * Small interactive driver for the exploration sessions — one process per action so each
 * step is inspectable. The customer app is **Jetpack Compose** on Android
 * (`androidx.compose.ui.platform.ComposeView`) and exposes test tags as `resource-id`,
 * NOT as the `content-desc` values the framework's older androidNative page objects use.
 * That difference is why exploration drives by resource-id / text / coordinates here.
 *
 *   node drive.js <platform> <locale> shot <label>
 *   node drive.js <platform> <locale> src  <label>          # dump page source + list ids/texts
 *   node drive.js <platform> <locale> tap  <x> <y>
 *   node drive.js <platform> <locale> tapid <resourceId>     # tap centre of element by resource-id
 *   node drive.js <platform> <locale> taptext <text>         # tap centre of element by exact text
 *   node drive.js <platform> <locale> type <text>            # type into focused field
 *   node drive.js <platform> <locale> keys <text>            # per-digit keystrokes (keypads/OTP)
 *   node drive.js <platform> <locale> swipe <x1> <y1> <x2> <y2> [durationMs]
 *   node drive.js <platform> <locale> back
 */
const fs = require('fs');
const path = require('path');
const { bsReq, sleep, screenshot, getSource, findElement, findElements, clickEl, typeText, tap } =
  require('../../../bs_helper.js');
const session = require('./session.js');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EVID = path.join(ROOT, 'evidence');

function sid(platform, locale) {
  const id = session.readId(platform, locale);
  if (!id) throw new Error(`no session for ${platform}-${locale} — run: node session.js open ${platform} ${locale}`);
  return id;
}

/**
 * Centre of an element's bounds. Handles BOTH source dialects:
 *   Android (UiAutomator2): "[x1,y1][x2,y2]"
 *   iOS (XCUITest):         "x,y,width,height"  (assembled from the x/y/width/height attrs)
 */
function centre(bounds) {
  const android = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(bounds);
  if (android) {
    const [, x1, y1, x2, y2] = android.map(Number);
    return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
  }
  const ios = /^(-?\d+),(-?\d+),(\d+),(\d+)$/.exec(String(bounds).trim());
  if (ios) {
    const [, x, y, w, h] = ios.map(Number);
    return { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
  }
  return null;
}

/** Every element carrying a resource-id / content-desc / non-empty text, with bounds. */
function inventory(xml) {
  const rows = [];
  for (const m of xml.matchAll(/<([\w.]+)\s([^>]*?)\/?>/g)) {
    const attrs = m[2];
    const get = (k) => { const r = new RegExp(k + '="([^"]*)"').exec(attrs); return r ? r[1] : ''; };
    const id = get('resource-id'), desc = get('content-desc'), text = get('text'), name = get('name'), label = get('label'), value = get('value');
    const clickable = get('clickable') === 'true';
    if (id || desc || text.trim() || name || label.trim() || value.trim()) {
      rows.push({ cls: m[1], id, desc, text, name, label, value, clickable, bounds: get('bounds') || `${get('x')},${get('y')},${get('width')},${get('height')}` });
    }
  }
  return rows;
}

async function main() {
  const [platform, locale, cmd, ...rest] = process.argv.slice(2);
  const s = sid(platform, locale);
  const tag = `${platform}-${locale}`;

  if (cmd === 'shot') {
    fs.mkdirSync(SHOTS, { recursive: true });
    const f = path.join(SHOTS, `${tag}-${rest[0] || 'shot'}.png`);
    await screenshot(s, f);
    return;
  }

  if (cmd === 'src') {
    fs.mkdirSync(EVID, { recursive: true });
    const xml = await getSource(s);
    const f = path.join(EVID, `${tag}-${rest[0] || 'src'}.xml`);
    fs.writeFileSync(f, xml);
    const rows = inventory(xml);
    console.log(`source ${xml.length} chars → ${path.relative(ROOT, f)}   (${rows.length} labelled nodes)`);
    for (const r of rows) {
      const bits = [r.id && 'id=' + r.id, r.desc && 'desc=' + r.desc, r.name && 'name=' + r.name,
                    r.label && 'label=' + r.label, r.value && 'value=' + r.value, r.text && 'text=' + r.text]
        .filter(Boolean).join('  ');
      console.log(`  ${r.clickable ? '*' : ' '} ${r.bounds.padEnd(24)} ${bits}`);
    }
    return;
  }

  if (cmd === 'tap') { await tap(s, Number(rest[0]), Number(rest[1])); console.log('tapped', rest[0], rest[1]); return; }

  if (cmd === 'tapid' || cmd === 'taptext') {
    const xml = await getSource(s);
    const rows = inventory(xml);
    const hit = cmd === 'tapid'
      ? rows.find((r) => r.id === rest[0] || r.id.endsWith(':id/' + rest[0]) || r.desc === rest[0] || r.name === rest[0])
      : rows.find((r) => r.text === rest.join(' ') || r.label === rest.join(' ') || r.value === rest.join(' '));
    if (!hit) { console.error('NOT FOUND:', rest.join(' ')); process.exit(2); }
    const c = centre(hit.bounds);
    if (!c) { console.error('no bounds for', hit.bounds); process.exit(2); }
    await tap(s, c.x, c.y);
    console.log('tapped', rest.join(' '), 'at', c.x, c.y);
    return;
  }

  if (cmd === 'type') {
    const xml = await getSource(s);
    const rows = inventory(xml);
    const field = rows.find((r) => /EditText|TextField|SecureTextField/.test(r.cls));
    if (!field) { console.error('no editable field on screen'); process.exit(2); }
    const el = await findElement(s, 'xpath', `//*[@bounds='${field.bounds}']`)
            || await findElement(s, 'xpath', '//android.widget.EditText')
            || await findElement(s, 'xpath', '//XCUIElementTypeTextField');
    if (!el) { console.error('field not addressable'); process.exit(2); }
    await typeText(s, el, rest.join(' '));
    console.log('typed', rest.join(' '));
    return;
  }

  if (cmd === 'keys') {
    const text = rest.join(' ');
    for (const ch of text) {
      await bsReq('POST', `/wd/hub/session/${s}/actions`, {
        actions: [{ type: 'key', id: 'kb', actions: [{ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch }] }],
      });
      await sleep(250);
    }
    console.log('sent keys', text);
    return;
  }

  if (cmd === 'swipe') {
    const [x1, y1, x2, y2, dur = 400] = rest.map(Number);
    await bsReq('POST', `/wd/hub/session/${s}/actions`, {
      actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: [
        { type: 'pointerMove', duration: 0, x: x1, y: y1 },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 120 },
        { type: 'pointerMove', duration: Number(dur), x: x2, y: y2 },
        { type: 'pointerUp', button: 0 },
      ] }],
    });
    console.log(`swiped ${x1},${y1} -> ${x2},${y2}`);
    return;
  }

  if (cmd === 'back') {
    if (platform === 'android') await bsReq('POST', `/wd/hub/session/${s}/back`, {});
    else await bsReq('POST', `/wd/hub/session/${s}/execute/sync`, { script: 'mobile: swipe', args: [{ direction: 'right' }] });
    console.log('back');
    return;
  }

  console.log('unknown command:', cmd);
}

module.exports = { inventory, centre };
if (require.main === module) main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
