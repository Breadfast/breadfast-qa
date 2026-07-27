/**
 * B10-57393 — App preview modal: execution harness (evidence + AC assertions).
 *
 * WHY this exists: the Create-perk form is long and progressive, and the admin session
 * expires mid-run. Driving it by hand once per AC is not repeatable, so this script
 * takes the story from login → fully-filled form → open "App preview" modal, then runs
 * every AC probe against the live DOM and writes screenshots + a JSON verdict.
 *
 * This is EXECUTION tooling for the story folder (evidence generation), NOT the
 * deliverable automation — the canonical automation is Java/Selenium inside the Java
 * framework (docs/ai/automation/automation-generation.md).
 *
 * Selector provenance: captured live 2026-07-27 against card-panel-testing.
 *   merchant picker  → input[data-placeholder="Select one or more branches"]  (READ-ONLY,
 *                      opens a nested 2-level mat-menu; "Select All" must be clicked via
 *                      its <label>) — reused from automation/pages/PerksPage.js
 *   device frame     → phone-frame > .iphone (outer bezel) > .screen > .screen-scroll
 *   sections         → .screen-scroll .card > .card-head
 *   language radios  → mat-dialog-container mat-radio-button ("English" | "Arabic")
 *
 * Usage: node preview_modal_probe.js [--keep-open] [--save] [--cancel]
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://card-panel-testing.breadfast.tech';
const USER = 'agent';
const PASS = 'Admin@123456789';
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const OUT = path.resolve(__dirname, '..', 'execution-reports');
const PHOTOS = path.resolve(__dirname, '..', '..', 'automation', 'perks photos');
const COVER = path.join(PHOTOS, 'exact_1080x1080.jpg'); // 1080×1080 ≤500KB
const LOGO = path.join(PHOTOS, 'exact_240x180.jpg');    //  240×180  ≤80KB

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

// Realistic perk content (operator decision 2026-07-27: create normal, viewable perks —
// not story-tagged names). Unique suffix only on the title to keep runs distinguishable
// without making the perk look like test debris.
const stamp = String(Date.now()).slice(-4);
const DATA = {
  titleEn: `15% Cashback`,
  titleAr: `١٥٪ كاش باك`,
  subEn: 'Coffee & Bakery',
  subAr: 'قهوة ومخبوزات',
  descEn: 'Get 15% cashback on all Breadfast Coffee orders, capped at EGP 100.',
  descAr: 'استرجع ١٥٪ من قيمة مشترياتك من بريدفاست كوفي بحد أقصى ١٠٠ جنيه.',
  usageEn: 'Valid once per day at any Breadfast Coffee branch. Cashback is capped at EGP 100 per month.',
  usageAr: 'صالح مرة واحدة يومياً في أي فرع من بريدفاست كوفي. الحد الأقصى للكاش باك ١٠٠ جنيه شهرياً.',
  branchesEn: '- Promenade Mall\n- Rehab\n- Madinaty\n- Mivida',
  branchesAr: '- بروميناد مول\n- الرحاب\n- مدينتي\n- ميفيدا',
  cbEn: 'Cashback may take up to 14 days to reflect.',
  cbAr: 'قد يستغرق الكاش باك ١٤ يوماً حتى يظهر.',
  durEn: 'This offer expires on Dec 31st, 2026.',
  durAr: 'ينتهي هذا العرض في ٣١/١٢/٢٠٢٦',
  merchant: 'Breadfast Coffee',
  section: 'Breadfast - بريدفاست',
  pct: '15', limit: '100', consumption: '100', stamp,
};

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), scale: 'device' });

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (page.url().includes('/login') || (await page.locator('button:has-text("Login")').count())) {
    await page.getByRole('textbox', { name: /username/i }).fill(USER);
    await page.getByRole('textbox', { name: /password/i }).fill(PASS);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL('**/#/dashboard', { timeout: 25000 });
    await page.waitForTimeout(2000);
  }
  // Navigate via the SPA nav — a bare page.goto() to a different hash does NOT
  // re-bootstrap this Angular hash-router app (observed: blank page, 2026-07-27).
  await page.locator('a:has-text("Card Perks")').first().click();
  await page.waitForURL('**/#/perks', { timeout: 20000 });
  await page.locator('button:has-text("Add perk")').first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(1500);
}

/** Capture the perks/categories that already exist — the AC4 isolation control set. */
async function existingPerks(page) {
  return page.evaluate(() => {
    const headerCells = [...document.querySelectorAll('table tr')][0];
    const headers = headerCells ? [...headerCells.querySelectorAll('th,td')].map(c => c.innerText.trim()) : [];
    const rows = [...document.querySelectorAll('table tr')].slice(1);
    const cells = rows.map(r => [...r.querySelectorAll('td')].map(c => c.innerText.trim()));
    const col = (name) => headers.findIndex(h => new RegExp(name, 'i').test(h));
    const ci = col('category'), ti = col('title');
    return {
      headers,
      rowCount: rows.length,
      categories: ci >= 0 ? [...new Set(cells.map(c => c[ci]).filter(Boolean))] : [],
      titles: ti >= 0 ? cells.map(c => c[ti]).filter(Boolean).slice(0, 25) : [],
      rows: cells.slice(0, 20),
    };
  });
}

/**
 * The nested merchant mat-menu leaves a `cdk-overlay-backdrop` behind after a single
 * Escape, which then swallows pointer events for every later click (observed live
 * 2026-07-27: section_id was visible+enabled but unclickable for 30s). Press Escape
 * until the backdrop count reaches zero.
 */
async function dismissOverlays(page, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const n = await page.locator('.cdk-overlay-backdrop').count();
    if (n === 0) return true;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
  // last resort: click a neutral spot in the page header
  await page.locator('h1:has-text("Create perk")').click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  return (await page.locator('.cdk-overlay-backdrop').count()) === 0;
}

async function uploadSlot(page, file) {
  const dialog = page.locator('mat-dialog-container');
  await page.locator('button:has-text("Add image")').first().click();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(500);
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(1800);
  const txt = ((await dialog.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  if (/invalid/i.test(txt)) throw new Error(`image rejected: ${txt.slice(0, 140)}`);
  const save = dialog.locator('button').filter({ hasText: /^\s*(save|ok|confirm|upload|done)\s*$/i }).first();
  if (await save.isVisible({ timeout: 1200 }).catch(() => false)) { await save.click(); await page.waitForTimeout(900); }
  if (await dialog.isVisible({ timeout: 800 }).catch(() => false)) {
    const c = dialog.locator('mat-icon:has-text("close")');
    if (await c.isVisible({ timeout: 800 }).catch(() => false)) await c.click(); else await page.keyboard.press('Escape');
  }
  await dialog.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function fillForm(page) {
  await page.locator("button:has-text('Add perk')").first().click();
  await page.waitForURL('**/#/perks/create', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Perk type → Merchant cashback (richest type: usage + branches + cashback + expiry)
  await page.locator('mat-select[formcontrolname="type"]').click();
  await page.locator('mat-option', { hasText: 'Merchant cashback' }).first().click();
  await page.waitForTimeout(1200);

  // Merchant: read-only trigger → nested menu → "Select All" branches via its label
  await page.locator('input[data-placeholder="Select one or more branches"]').click();
  await page.locator('.cdk-overlay-pane [role="menuitem"]').filter({ hasText: DATA.merchant }).first().click();
  await page.waitForTimeout(600);
  await page.locator('.cdk-overlay-pane [role="menuitem"]').filter({ hasText: /^\s*select all/i })
    .locator('label').first().click();
  await page.waitForTimeout(400);
  await dismissOverlays(page);

  // Section (Mobile display) — "Breadfast" already holds other perks → makes AC4 meaningful
  await page.locator('mat-select[formcontrolname="section_id"]').click();
  await page.locator('mat-option', { hasText: DATA.section }).first().click();
  await page.waitForTimeout(800);

  // Titles + subheaders (app-bf-input wrappers, addressed by controlname)
  const bf = (n) => page.locator(`app-bf-input[controlname="${n}"] input`);
  await bf('title_en').fill(DATA.titleEn);
  await bf('title_ar').fill(DATA.titleAr);
  await bf('subheader_en').fill(DATA.subEn);
  await bf('subheader_ar').fill(DATA.subAr);

  // Value → Percentage, then the value/limit fields appear
  await page.locator('mat-radio-button', { hasText: 'Percentage' }).locator('label').click();
  await page.waitForTimeout(700);
  await page.locator('input[formcontrolname="cashback_value"]').fill(DATA.pct);
  await page.locator('input[formcontrolname="cash_back_limit"]').fill(DATA.limit);

  // Free-text sections (EN + AR)
  const ta = (n) => page.locator(`textarea[formcontrolname="${n}"]`);
  await ta('description_en').fill(DATA.descEn);
  await ta('description_ar').fill(DATA.descAr);
  await ta('usage_description_en').fill(DATA.usageEn);
  await ta('usage_description_ar').fill(DATA.usageAr);
  await ta('branches_description_en').fill(DATA.branchesEn);
  await ta('branches_description_ar').fill(DATA.branchesAr);
  await ta('cashback_processing_description_en').fill(DATA.cbEn);
  await ta('cashback_processing_description_ar').fill(DATA.cbAr);
  await ta('short_duration_description_en').fill(DATA.durEn);
  await ta('short_duration_description_ar').fill(DATA.durAr);

  // Cashback limit: limit + interval are required TOGETHER (live validation message)
  await page.locator('input[formcontrolname="consumption_limit"]').fill(DATA.consumption);
  await page.locator('mat-select[formcontrolname="consumption_interval"]').click();
  await page.locator('mat-option', { hasText: 'monthly' }).first().click();
  await page.waitForTimeout(500);

  // Funding type
  await page.locator('mat-select[formcontrolname="funding_types"]').click();
  await page.locator('mat-option', { hasText: 'Merchant funded' }).first().click();
  await page.waitForTimeout(500);

  // Images: 0=Cover EN, 1=Cover AR (1080×1080), 2=Logo EN, 3=Logo AR (240×180).
  // Slots collapse as they fill, so always target the FIRST remaining button.
  await uploadSlot(page, COVER);
  await uploadSlot(page, COVER);
  await uploadSlot(page, LOGO);
  await uploadSlot(page, LOGO);

  // End date: readonly picker → nav 5 months (Jul→Dec 2026) → day 31
  const end = page.locator('input.dp-picker-input').nth(1);
  await end.click();
  await page.waitForTimeout(500);
  const pop = page.locator('.dp-popup:visible').first();
  for (let i = 0; i < 5; i++) { await pop.locator('.dp-calendar-nav-right').click(); await page.waitForTimeout(220); }
  await pop.locator('button.dp-calendar-day').filter({ hasText: /^31$/ }).first().click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  return page.evaluate(() => ({
    errors: [...new Set([...document.querySelectorAll('mat-error')].map(e => e.innerText.trim()).filter(Boolean))],
    previews: document.querySelectorAll('main img[alt="Image Preview"]').length,
    addImageLeft: [...document.querySelectorAll('button')].filter(b => /add image/i.test(b.innerText)).length,
  }));
}

/** Measure the device frame: AC1 wants 375×812. Report layout box AND visual box. */
const measureFrames = (page) => page.evaluate(() => {
  const dlg = document.querySelector('mat-dialog-container');
  const g = (el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return { layout: `${el.offsetWidth}x${el.offsetHeight}`, visual: `${Math.round(r.width)}x${Math.round(r.height)}`,
             css: `${cs.width} x ${cs.height}`, transform: cs.transform };
  };
  const scaleOf = (el) => { let n = el, out = 'none';
    while (n && n !== document.documentElement) { const t = getComputedStyle(n).transform; if (t && t !== 'none') out = t; n = n.parentElement; } return out; };
  const bezels = [...dlg.querySelectorAll('.iphone')];
  const screens = [...dlg.querySelectorAll('.screen')];
  const scrolls = [...dlg.querySelectorAll('.screen-scroll')];
  return {
    frameCount: bezels.length,
    bezel: bezels.map(g),
    screen: screens.map(g),
    ancestorScale: bezels[0] ? scaleOf(bezels[0]) : null,
    scroll: scrolls.map(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
                                 scrollable: el.scrollHeight > el.clientHeight + 2, overflowY: getComputedStyle(el).overflowY })),
  };
});

/** AC3: are the detail sections collapsible? Tap each header and look for ANY change. */
async function probeSections(page) {
  const detail = page.locator('mat-dialog-container .screen-scroll').nth(1);
  const names = await detail.evaluate(el => [...el.querySelectorAll('.card .card-head')].map(h => (h.innerText || '').replace(/\s+/g, ' ').trim()));
  const results = [];
  for (const raw of names) {
    const label = raw.split(' ').slice(1).join(' ') || raw; // strip the leading mat-icon ligature
    const card = detail.locator('.card', { hasText: label }).first();
    const before = await card.evaluate(el => ({ h: Math.round(el.getBoundingClientRect().height), t: (el.innerText || '').trim().length,
                                                aria: el.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') ?? null }));
    const head = card.locator('.card-head');
    const affordance = await head.evaluate(el => ({ cursor: getComputedStyle(el).cursor, hasChevron: /expand|chevron|keyboard_arrow/i.test(el.innerText || ''),
                                                    role: el.getAttribute('role'), tabindex: el.getAttribute('tabindex') }));
    await head.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
    const after = await card.evaluate(el => ({ h: Math.round(el.getBoundingClientRect().height), t: (el.innerText || '').trim().length,
                                               aria: el.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') ?? null }));
    results.push({ section: label, affordance, before, after,
                   respondedToTap: before.h !== after.h || before.t !== after.t || before.aria !== after.aria });
  }
  return results;
}

/** AC4: the tile view must show ONLY this perk's category + its single tile. */
const probeTile = (page) => page.evaluate((titleEn) => {
  const dlg = document.querySelector('mat-dialog-container');
  const tile = [...dlg.querySelectorAll('.screen-scroll')][0];
  const text = (tile.innerText || '').replace(/\s+/g, ' ').trim();
  return { text: text.slice(0, 400), mentionsOwnTitle: text.includes(titleEn),
           categoryHeadings: [...tile.querySelectorAll('h1,h2,h3,h4,h5,.section-title,.cat-title')].map(h => h.innerText.trim()).filter(Boolean) };
}, DATA.titleEn);

/** AC5: switch the Preview-language radio and read back content + direction. */
async function probeLanguage(page, lang) {
  const dlg = page.locator('mat-dialog-container');
  await dlg.locator('mat-radio-button', { hasText: new RegExp(`^\\s*${lang}\\s*$`, 'i') }).locator('label').first().click();
  await page.waitForTimeout(1200);
  return dlg.evaluate(el => {
    const frames = [...el.querySelectorAll('.screen-scroll')];
    const dirOf = (n) => n ? getComputedStyle(n).direction : null;
    const alignOf = (n) => n ? getComputedStyle(n).textAlign : null;
    const cards = [...el.querySelectorAll('.screen-scroll .card')];
    return {
      chromeText: (el.querySelector('h1,h2,.dialog-title,mat-dialog-title')?.innerText || '').trim(),
      modalHasArabicChrome: /[؀-ۿ]/.test([...el.querySelectorAll('mat-radio-button, button, h1, h2')].map(x => x.innerText).join(' ')),
      frameDirections: frames.map(f => ({ direction: dirOf(f), textAlign: alignOf(f) })),
      cardDirections: cards.map(c => ({ label: (c.querySelector('.card-head')?.innerText || '').replace(/\s+/g, ' ').trim(),
                                        direction: dirOf(c), textAlign: alignOf(c.querySelector('p,span,div') || c) })),
      previewText: frames.map(f => (f.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 320)),
      hasArabicContent: /[؀-ۿ]/.test(frames.map(f => f.innerText).join(' ')),
      hasLatinContent: /[A-Za-z]{4,}/.test(frames.map(f => f.innerText).join(' ')),
    };
  });
}

module.exports = {
  BASE, USER, PASS, SHOTS, OUT, COVER, LOGO, DATA,
  shot, login, existingPerks, dismissOverlays, uploadSlot, fillForm,
  measureFrames, probeSections, probeTile, probeLanguage,
};

if (require.main !== module) return;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });

  const R = { ticket: 'B10-57393', startedAt: new Date().toISOString(), data: DATA, steps: {} };
  try {
    await login(page);
    R.steps.preExistingPerks = await existingPerks(page);

    R.steps.formFill = await fillForm(page);
    await shot(page, '10_form_complete.png');

    // ── AC1: open the modal ────────────────────────────────────────────────
    await page.locator('form button[type=submit]:has-text("Preview & save")').click();
    const dlg = page.locator('mat-dialog-container');
    await dlg.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2000);
    await shot(page, '11_modal_EN_default.png');

    R.steps.modalOpened = true;
    R.steps.ac1_frames = await measureFrames(page);
    R.steps.ac7_defaultLanguage = await dlg.evaluate(el =>
      [...el.querySelectorAll('mat-radio-button')].map(r => ({ label: r.innerText.trim(), checked: !!r.querySelector('input')?.checked })));
    R.steps.ac4_tile = await probeTile(page);

    // ── AC2: scroll inside the detail device frame ─────────────────────────
    const detail = dlg.locator('.screen-scroll').nth(1);
    const before = await detail.evaluate(el => ({ top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }));
    await detail.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(800);
    const after = await detail.evaluate(el => ({ top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }));
    R.steps.ac2_scroll = { before, after, didScroll: after.top > before.top, maxScroll: before.sh - before.ch };
    await shot(page, '12_modal_EN_scrolled.png');
    await detail.evaluate(el => { el.scrollTop = 0; });
    await page.waitForTimeout(400);

    // ── AC3: collapsible sections ──────────────────────────────────────────
    R.steps.ac3_sections = await probeSections(page);
    await shot(page, '13_modal_EN_after_section_taps.png');

    // ── AC5: Arabic / RTL ──────────────────────────────────────────────────
    R.steps.ac5_arabic = await probeLanguage(page, 'Arabic');
    await shot(page, '14_modal_AR.png');
    const arDetail = dlg.locator('.screen-scroll').nth(1);
    await arDetail.evaluate(el => { el.scrollTop = el.scrollHeight; }).catch(() => {});
    await page.waitForTimeout(700);
    await shot(page, '15_modal_AR_scrolled.png');
    await arDetail.evaluate(el => { el.scrollTop = 0; }).catch(() => {});
    R.steps.ac5_backToEnglish = await probeLanguage(page, 'English');
    await shot(page, '16_modal_back_to_EN.png');

    // ── AC6: Cancel or Save ────────────────────────────────────────────────
    if (has('--save')) {
      await dlg.locator('button', { hasText: /^\s*Save\s*$/ }).first().click();
      await page.waitForTimeout(4000);
      await shot(page, '17_after_save.png');
      R.steps.ac6_save = {
        modalStillOpen: await dlg.isVisible().catch(() => false),
        url: page.url(),
        toast: await page.evaluate(() => [...document.querySelectorAll('.toast, .mat-snack-bar-container, simple-snack-bar')].map(t => t.innerText.trim())),
      };
      await page.locator('a:has-text("Card Perks")').first().click().catch(() => {});
      await page.waitForTimeout(3000);
      R.steps.ac6_perksAfterSave = await existingPerks(page);
      await shot(page, '18_perks_list_after_save.png');
    } else if (has('--cancel')) {
      const formBefore = await page.evaluate(() => document.querySelector('app-bf-input[controlname="title_en"] input')?.value);
      await dlg.locator('button', { hasText: /^\s*Cancel\s*$/ }).first().click();
      await page.waitForTimeout(2000);
      R.steps.ac6_cancel = {
        modalClosed: !(await dlg.isVisible().catch(() => false)),
        titleStillFilled: await page.evaluate(() => document.querySelector('app-bf-input[controlname="title_en"] input')?.value),
        titleBefore: formBefore,
        stuckBackdrop: await page.evaluate(() => document.querySelectorAll('.cdk-overlay-backdrop').length),
        bodyScrollLocked: await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'),
        url: page.url(),
      };
      await shot(page, '19_after_cancel.png');
    }

    R.consoleErrors = consoleErrors;
    R.finishedAt = new Date().toISOString();
    R.ok = true;
  } catch (e) {
    R.ok = false;
    R.error = { message: e.message, stack: (e.stack || '').split('\n').slice(0, 6).join('\n') };
    R.consoleErrors = consoleErrors;
    await shot(page, '99_failure_state.png').catch(() => {});
  }

  const tag = has('--save') ? 'save' : has('--cancel') ? 'cancel' : 'probe';
  const file = path.join(OUT, `preview_probe_${tag}.json`);
  fs.writeFileSync(file, JSON.stringify(R, null, 2));
  console.log(JSON.stringify(R, null, 2));
  console.log(`\n→ ${file}`);
  if (!has('--keep-open')) await browser.close();
})();
