/**
 * Step driver against an already-open ad-hoc mobile session.
 *
 * Keeps the session alive between orchestrator turns so a walk can be steered from what is actually
 * on screen rather than from a guessed script. Promoted to automation/mobile/ on 2026-08-24
 * (B10-57796) from the B10-58603 story copy — story folders are gitignored, so anything reusable
 * lives here once instead of being re-created per story.
 *
 *   node automation/mobile/drive.js --sid <id> --do <command> [--arg <v>] [--out <dir>] [--phone +20...]
 *
 * Commands:
 *   look                          screenshot + source dump + distinct labels
 *   tapText --arg <label>         tap the element whose text/content-desc/label equals or contains <label>
 *   tapXY   --arg x,y             coordinate tap (Compose surfaces with no accessible label)
 *   type    --arg <sel>::<text>   type into the element matched by <sel> (text/desc contains)
 *   keypad  --arg <digits>        tap digit keys one at a time (passcode / PIN / OTP keypads)
 *   otp     --arg <purpose>       read the OTP for the fixture phone from Google Chat and key it in
 *   swipe   --arg up|down[:frac]  vertical swipe
 *   back                          Android hardware back / iOS nav-bar back
 */
'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./session.js');
const { fetchOtp } = require('./otp_google_chat.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const sid = arg('sid');
const cmd = arg('do', 'look');
const val = arg('arg', '');
const tag = arg('tag', cmd);
const OUT = arg('out', path.join(process.cwd(), 'evidence', 'drive'));
const PHONE_E164 = arg('phone', process.env.QA_FIXTURE_PHONE || '+201188369495');

function labelsOf(xml) {
  const out = [];
  const re = /(?:content-desc|text|label|name|value)="([^"]{1,90})"/g;
  let m;
  while ((m = re.exec(xml))) {
    const v = m[1].trim();
    if (!v || /^(true|false|\d+(\.\d+)?|android\.|XCUIElementType|com\.breadfast)/.test(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Find by exact then partial match across the attributes each platform actually populates. */
async function findByLabel(label) {
  const esc = label.replace(/'/g, "\\'");
  const candidates = [
    ['-android uiautomator', `new UiSelector().text("${esc}")`],
    ['-android uiautomator', `new UiSelector().description("${esc}")`],
    // resource-id matters on this app: the landing screen's phone field is a Compose
    // `phone_input_clickable_component` with no text, desc or label at all.
    ['id', esc],
    ['-android uiautomator', `new UiSelector().resourceIdMatches(".*${esc}.*")`],
    ['-android uiautomator', `new UiSelector().textContains("${esc}")`],
    ['-android uiautomator', `new UiSelector().descriptionContains("${esc}")`],
    ['xpath', `//*[@text="${esc}" or @content-desc="${esc}" or @label="${esc}" or @name="${esc}" or @value="${esc}" or @resource-id="${esc}"]`],
    ['xpath', `//*[contains(@text,"${esc}") or contains(@content-desc,"${esc}") or contains(@label,"${esc}") or contains(@name,"${esc}") or contains(@resource-id,"${esc}")]`],
  ];
  for (const [using, value] of candidates) {
    try { const el = await S.find(sid, using, value); if (el) return el; } catch (_) { /* next strategy */ }
  }
  return null;
}

(async () => {
  if (!sid) throw new Error('--sid required');
  fs.mkdirSync(OUT, { recursive: true });
  const size = await S.windowSize(sid);

  if (cmd === 'tapText') {
    const el = await findByLabel(val);
    if (!el) throw new Error('not found: ' + val);
    await S.click(sid, el);
    console.log('tapped:', val);
    await S.sleep(3500);
  } else if (cmd === 'tapXY') {
    const [x, y] = val.split(',').map(Number);
    await S.tap(sid, x, y);
    console.log(`tapped (${x},${y})`);
    await S.sleep(3500);
  } else if (cmd === 'type') {
    const [sel, txt] = val.split('::');
    const el = await findByLabel(sel);
    if (!el) throw new Error('input not found: ' + sel);
    await S.typeText(sid, el, txt);
    console.log('typed into', sel);
    await S.sleep(2500);
  } else if (cmd === 'keypad') {
    await S.typeDigits(sid, val, (d) => findByLabel(d));
    console.log('keyed', val.length, 'digits');
    await S.sleep(4000);
  } else if (cmd === 'otp') {
    const got = await fetchOtp(PHONE_E164, { timeoutMs: 90000, notBefore: Number(arg('after', 0)) });
    if (!got) throw new Error('no OTP arrived for ' + PHONE_E164);
    console.log('OTP from Chat:', got.otp, '@', got.createTime);
    await S.typeDigits(sid, got.otp, (d) => findByLabel(d));
    console.log('keyed OTP');
    await S.sleep(5000);
  } else if (cmd === 'swipe') {
    const [dir, frac] = val.split(':');
    await S.swipe(sid, { w: size.width, h: size.height }, dir || 'up', frac ? Number(frac) : 0.6);
    console.log('swiped', dir || 'up');
    await S.sleep(2500);
  } else if (cmd === 'back') {
    await S.req('POST', `/wd/hub/session/${sid}/back`, {});
    console.log('back');
    await S.sleep(3000);
  }

  // Always finish by reporting where we are.
  const stamp = Date.now().toString().slice(-6);
  const png = path.join(OUT, `${tag}_${stamp}.png`);
  await S.screenshot(sid, png);
  const xml = await S.source(sid);
  fs.writeFileSync(path.join(OUT, `${tag}_${stamp}.xml`), xml || '');
  console.log('--- on screen ---');
  console.log(labelsOf(xml || '').slice(0, 40).join(' | '));
  console.log('shot:', path.basename(png));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
