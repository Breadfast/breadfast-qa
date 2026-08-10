/**
 * B10-58252 (DEF-2) — RETEST: "App preview device frame is not 375 x 812".
 *
 * Reuses the original execution harness (preview_modal_probe.js) for login + the long
 * progressive Create-perk form, then re-measures the device frame the way the bug's
 * Steps block prescribes: untransformed CSS layout size of the bezel, of the inner
 * screen/viewport, and the cumulative ancestor transform.
 *
 * The measurement here is deliberately CLASS-AGNOSTIC as well as class-targeted: if the
 * fix rebuilt the frame markup, `.iphone`/`.screen` may no longer exist and a
 * class-only probe would report "frameCount: 0" and read as a regression. So we also
 * dump every sizeable element in the modal and search for anything measuring 375x812.
 *
 * Usage: node retest_def2_frame.js [--keep-open]
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const H = require('./preview_modal_probe.js');

const OUT = path.resolve(__dirname, '..', 'execution-reports');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const keepOpen = process.argv.includes('--keep-open');

const EXPECTED = { w: 375, h: 812, ratio: 375 / 812 };

/** Read whatever the panel exposes as its build/version string. */
const readVersion = (page) => page.evaluate(() => {
  const hits = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (t && /v(ersion)?\s*[:\s]?\s*\d+\.\d+/i.test(t) && t.length < 80) hits.push(t);
  }
  return [...new Set(hits)];
});

/** Full geometry dump of the preview modal — class-targeted AND class-agnostic. */
const measure = (page) => page.evaluate((EXP) => {
  const dlg = document.querySelector('mat-dialog-container');
  if (!dlg) return { error: 'no mat-dialog-container' };

  const geom = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 70),
      layout: `${el.offsetWidth}x${el.offsetHeight}`,
      w: el.offsetWidth, h: el.offsetHeight,
      visual: `${Math.round(r.width)}x${Math.round(r.height)}`,
      css: `${cs.width} x ${cs.height}`,
      transform: cs.transform,
    };
  };
  // cumulative transform chain from the element up to <html>
  const chain = (el) => {
    const out = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const t = getComputedStyle(n).transform;
      if (t && t !== 'none') out.push({ on: `${n.tagName.toLowerCase()}.${(n.className || '').toString().split(' ')[0]}`, transform: t });
      n = n.parentElement;
    }
    return out;
  };

  const bezels = [...dlg.querySelectorAll('.iphone')];
  const screens = [...dlg.querySelectorAll('.screen')];
  const scrolls = [...dlg.querySelectorAll('.screen-scroll')];

  // class-agnostic sweep: every element in the modal big enough to be a phone frame
  const all = [...dlg.querySelectorAll('*')]
    .filter((el) => el.offsetWidth >= 150 && el.offsetHeight >= 150)
    .map(geom);

  const exact = all.filter((g) => g.w === EXP.w && g.h === EXP.h);
  const nearRatio = all.filter((g) => g.h > 300 && Math.abs(g.w / g.h - EXP.ratio) < 0.005);

  return {
    frameCount: bezels.length,
    bezel: bezels.map(geom),
    screen: screens.map(geom),
    transformChainOnBezel: bezels[0] ? chain(bezels[0]) : null,
    transformChainOnScreen: screens[0] ? chain(screens[0]) : null,
    scroll: scrolls.map((el) => ({
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      scrollable: el.scrollHeight > el.clientHeight + 2, overflowY: getComputedStyle(el).overflowY,
    })),
    anyElementExactly375x812: exact,
    anyElementWithIphone13MiniRatio: nearRatio,
    sizeableElements: all,
  };
}, EXPECTED);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });

  const R = { ticket: 'B10-58252', parent: 'B10-57393', retestOf: 'DEF-2',
              startedAt: new Date().toISOString(), baseline: { bezel: '375x840', screen: '347x812', scale: 0.8 }, steps: {} };
  try {
    await H.login(page);
    R.steps.panelVersionStrings = await readVersion(page);
    R.steps.formFill = await H.fillForm(page);
    await H.shot(page, 'retest_DEF2_10_form_complete.png');

    await page.locator('form button[type=submit]:has-text("Preview & save")').click();
    const dlg = page.locator('mat-dialog-container');
    await dlg.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2500);
    await H.shot(page, 'retest_DEF2_11_modal_EN.png');

    R.steps.measured = await measure(page);

    // annotated evidence: outline the frame + stamp the measured numbers on the page
    await page.evaluate(() => {
      const dlg = document.querySelector('mat-dialog-container');
      const b = dlg.querySelector('.iphone'), s = dlg.querySelector('.screen');
      const label = (el, text, color) => {
        if (!el) return;
        el.style.outline = `3px solid ${color}`;
        const t = document.createElement('div');
        t.textContent = text;
        Object.assign(t.style, { position: 'fixed', zIndex: 99999, background: color, color: '#fff',
          font: 'bold 13px monospace', padding: '2px 6px' });
        const r = el.getBoundingClientRect();
        t.style.left = `${r.left}px`; t.style.top = `${Math.max(0, r.top - 20)}px`;
        document.body.appendChild(t);
      };
      if (b) label(b, `bezel layout ${b.offsetWidth}x${b.offsetHeight}`, '#c62828');
      if (s) label(s, `viewport layout ${s.offsetWidth}x${s.offsetHeight}`, '#1565c0');
    });
    await page.waitForTimeout(400);
    await H.shot(page, 'retest_DEF2_12_frame_measured.png');

    const m = R.steps.measured;
    const bz = m.bezel[0], sc = m.screen[0];
    R.verdict = {
      bezelLayout: bz ? bz.layout : null,
      viewportLayout: sc ? sc.layout : null,
      viewportRatio: sc ? +(sc.w / sc.h).toFixed(4) : null,
      expectedRatio: +EXPECTED.ratio.toFixed(4),
      ancestorTransform: (m.transformChainOnScreen || []).map((c) => c.transform).join(' | ') || 'none',
      viewportIs375x812: !!(sc && sc.w === 375 && sc.h === 812),
      bezelIs375x812: !!(bz && bz.w === 375 && bz.h === 812),
      anyExactMatchInModal: m.anyElementExactly375x812.length,
      renderedAtTrueScale: !(m.transformChainOnScreen || []).length,
    };
    R.verdict.fixed = R.verdict.viewportIs375x812 && R.verdict.renderedAtTrueScale;
    R.consoleErrors = consoleErrors;
    R.ok = true;
  } catch (e) {
    R.ok = false;
    R.error = { message: e.message, stack: (e.stack || '').split('\n').slice(0, 6).join('\n') };
    R.consoleErrors = consoleErrors;
    await H.shot(page, 'retest_DEF2_99_failure.png').catch(() => {});
  }

  const file = path.join(OUT, 'retest_DEF2_frame.json');
  fs.writeFileSync(file, JSON.stringify(R, null, 2));
  console.log(JSON.stringify({ ok: R.ok, version: R.steps.panelVersionStrings, verdict: R.verdict, error: R.error }, null, 2));
  console.log(`\n-> ${file}`);
  if (!keepOpen) await browser.close();
})();
