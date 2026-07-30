'use strict';

/**
 * B10-56750 — Section dropdown (BrowserStack TC1–TC13, TC24, TC25)
 *
 * TEST NAMES ARE THE BROWSERSTACK TEST-CASE NAMES, written out verbatim.
 * Each `test()` title is the exact name of its BrowserStack case, so the test run
 * maps results by name with no hand-maintained lookup, and BrowserStack can mark
 * the case automated. Structure follows from that — one test per case — so TC9 and
 * TC10 are separate tests and TC13 covers all four perk types inside one test.
 *
 * If a name is ever edited on one side only, `push_browserstack_results.js` fails
 * loudly ("every case must either match an automated test by name or be declared
 * in MANUAL") rather than reporting a result against the wrong case.
 *
 * Generated against **HLS v2** (2026-07-26). Assertions target the SPEC (AC + the
 * design-wins rulings in clarifications B1–B8); a failure is a reportable defect.
 * Known defects are asserted `soft` and tagged [DEFECT-EXPECTED <id>].
 *
 * The Create Perk form is PROGRESSIVE: only "Perk type" renders until a type is
 * chosen, so every test selects a perk type before the Section field exists.
 */

const { test, expect } = require('@playwright/test');
const LoginPage = require('../../../automation/pages/LoginPage');
const PerksPage = require('../../../automation/pages/PerksPage');
const config = require('../../../automation/helpers/ConfigReader');
const PERK_TYPES = ['Discount/coupon', 'Category cashback', 'Merchant cashback', 'General spend cashback'];

// Per-perk-type case names, in full and in PERK_TYPES order.
const AC01_NAMES = [
  'Verify the Section field is displayed in Create Perk → Basic details for the "Discount/coupon" perk type',
  'Verify the Section field is displayed in Create Perk → Basic details for the "Category cashback" perk type',
  'Verify the Section field is displayed in Create Perk → Basic details for the "Merchant cashback" perk type',
  'Verify the Section field is displayed in Create Perk → Basic details for the "General spend cashback" perk type',
];
const AC02_NAMES = [
  'Verify Section is required and blocks "Preview & save" when empty for the "Discount/coupon" perk type',
  'Verify Section is required and blocks "Preview & save" when empty for the "Category cashback" perk type',
  'Verify Section is required and blocks "Preview & save" when empty for the "Merchant cashback" perk type',
  'Verify Section is required and blocks "Preview & save" when empty for the "General spend cashback" perk type',
];

async function openCreateFormWithType(page, type) {
  const login = new LoginPage(page);
  const perks = new PerksPage(page);
  await login.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
  await perks.goToPerksPage();
  await perks.clickAddPerk();
  await perks.selectPerkTypeByName(type);
  return perks;
}

test.describe('B10-56750 · Section dropdown', () => {
  // ── TC1–TC4 · AC-01 — field present on each perk type, correct label ──
  PERK_TYPES.forEach((type, i) => {
    test(AC01_NAMES[i], async ({ page }) => {
      const perks = await openCreateFormWithType(page, type);

      await expect(perks.sectionDropdown, `Section dropdown must exist on "${type}"`).toHaveCount(1);
      await expect(perks.sectionDropdown).toBeVisible();

      const labelBlock = page.locator('div,label').filter({ hasText: /Section \(Mobile display\)/ }).last();
      await expect(labelBlock, 'label must read "Section (Mobile display)"').toBeVisible();
      const labelText = ((await labelBlock.innerText()) || '').trim();
      expect(labelText, 'label carries a required marker (*)').toMatch(/Section \(Mobile display\)\s*\*/);
    });
  });

  // ── TC5–TC8 · AC-02 — required: blocks Preview & save ──
  PERK_TYPES.forEach((type, i) => {
    test(AC02_NAMES[i], async ({ page }) => {
      const perks = await openCreateFormWithType(page, type);

      const initial = ((await perks.sectionDropdown.textContent().catch(() => '')) || '').trim();
      expect(initial, 'Section must start empty on a fresh form').toBe('');

      await page.locator('button:has-text("Preview & save")').first().click();
      await page.waitForTimeout(1800);

      expect(page.url(), 'submission must be blocked (stay on the create form)').toContain('/perks/create');
      await expect(perks.sectionDropdown, 'Section control must be flagged invalid').toHaveAttribute('aria-invalid', 'true');

      const err = await page.evaluate(() => {
        const sel = document.querySelector('mat-select[formcontrolname="section_id"]');
        let n = sel && (sel.closest('app-bf-select') || sel.closest('.form-group') || sel.parentElement);
        for (let i = 0; i < 5 && n; i += 1) {
          const e = n.querySelector('.text-danger, mat-error, .invalid-feedback');
          if (e) return (e.textContent || '').trim();
          n = n.parentElement;
        }
        return '';
      });
      expect(err, 'a validation error must be shown against the Section field').toMatch(/required/i);
    });
  });

  // ── TC9 · AC-03 — bilingual "EN - AR" labels ──
  test('Verify the Section dropdown lists existing Sections as bilingual "EN - AR" labels', async ({ page }) => {
    const perks = await openCreateFormWithType(page, 'Discount/coupon');
    const real = (await perks.getSectionOptions()).filter((o) => !/add section/i.test(o));

    expect(real.length, 'at least one Section must be listed').toBeGreaterThan(0);
    const bilingual = real.filter((o) => / - /.test(o) && /[؀-ۿ]/.test(o));
    expect(bilingual.length, `seeded sections must render as "EN - AR" (got ${JSON.stringify(real.slice(0, 5))})`).toBeGreaterThan(0);
    expect(real.some((o) => /^Breadfast\s+-\s+بريدفاست$/.test(o)), 'seeded "Breadfast - بريدفاست" must be listed').toBe(true);
  });

  // ── TC10 · AC-03 — names only, NO numeric IDs ──
  test('Verify the Section dropdown shows names only and never exposes numeric Section IDs', async ({ page }) => {
    const perks = await openCreateFormWithType(page, 'Discount/coupon');
    const options = await perks.getSectionOptions();
    const real = options.filter((o) => !/add section/i.test(o));

    // B7: Section shows names only. Category (a separate control) is the one that
    // carries "ID <n>"; an ID here would mean the two controls got crossed.
    expect(real.filter((o) => /\bID\s*\d+/i.test(o)), 'Section options must never render numeric IDs').toEqual([]);
    expect(options.some((o) => /add category/i.test(o)), 'Category copy must not leak into the Section list').toBe(false);
  });

  // NOTE: TC11 ("the design-specified seeded Sections … are available") has NO
  // automated test on purpose. Its expectation was RETRACTED — Sections are
  // user-created content with no fixed expected set, so an absent section is not a
  // defect (bug B10-58196 was filed against it and withdrawn). The case stays in
  // BrowserStack as not-automated rather than being asserted here.

  // ── TC12 · AC-03/AC-14 — the general-spend Section is "General Purchases" ──
  test('Verify the general-spend Section is named "General Purchases" and no bare "General" Section exists', async ({ page }) => {
    const perks = await openCreateFormWithType(page, 'General spend cashback');
    const options = (await perks.getSectionOptions()).filter((o) => !/add section/i.test(o));

    // Clarification B5 (QA-lead override): "General Purchases" is CORRECT and the
    // design showing "General - عام" is stale. A rendered bare "General" = defect.
    expect(options.some((o) => /^General Purchases\s+-\s+/.test(o)), '"General Purchases" must be listed').toBe(true);
    expect(options.some((o) => /^General\s+-\s+/.test(o)), 'a bare "General" section must NOT exist (design is stale)').toBe(false);

    // The Arabic name was unprovided by the PO at HLS time; the build supplies it.
    const gp = options.find((o) => /^General Purchases/.test(o));
    expect(gp, 'record the live AR name for "General Purchases"').toBe('General Purchases - المشتريات العامة');
  });

  // ── TC13 · AC-04 — "+ Add section" pinned last on ALL FOUR perk types ──
  test('Verify "+ Add section" is pinned at the bottom of the Section dropdown for all four perk types', async ({ page }) => {
    for (const type of PERK_TYPES) {
      const perks = await openCreateFormWithType(page, type);
      const options = await perks.getSectionOptions();

      const idx = options.findIndex((o) => /add section/i.test(o));
      expect(idx, `"+ Add section" must be present on "${type}"`).toBeGreaterThan(-1);
      expect(idx, `"+ Add section" must be the LAST option on "${type}"`).toBe(options.length - 1);
      expect(options[idx].trim(), `exact copy on "${type}"`).toBe('+ Add section');
      expect(options.some((o) => /add category/i.test(o)), `Category copy must not leak on "${type}"`).toBe(false);
    }
  });

  // ── TC24 · AC-13 — ordering at the data/API level ──
  test('Verify Section ordering at the data/API level — Breadfast first, remaining Sections alphabetical [PARTIAL]', async ({ page }) => {
    const login = new LoginPage(page);
    const perks = new PerksPage(page);

    let listBody = null;
    page.on('response', async (r) => {
      if (/\/card\/perks\/section\/list/i.test(r.url()) && r.request().method() === 'POST') {
        try { listBody = await r.json(); } catch { /* non-JSON */ }
      }
    });

    await login.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
    await perks.goToPerksPage();
    await perks.clickAddPerk();
    await perks.selectPerkTypeByName('Discount/coupon');
    await page.waitForTimeout(1500);

    expect(listBody, 'the section/list response must be captured').not.toBeNull();
    const rows = listBody.data || listBody.result || listBody.sections || listBody;
    expect(Array.isArray(rows), 'section/list must return an array').toBe(true);

    const names = rows.map((s) => s.name_en || s.nameEn || '');
    expect(names.length, 'sections must be returned').toBeGreaterThan(1);

    // AC-13 first half — Breadfast always first.
    expect(names[0], 'Breadfast must be returned first').toMatch(/^Breadfast$/i);

    // AC-13 second half — the remainder alphabetical. Live returns creation/id
    // order instead: finding F-02 / bug B10-58192. Soft so the evidence is
    // captured without masking the first-half assertion.
    const rest = names.slice(1);
    const sorted = [...rest].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    expect.soft(rest, `remaining sections must be alphabetical — actual ${JSON.stringify(rest)}`).toEqual(sorted);
  });

  // ── TC25 · AC-14 — the data backfill, checked at the API ──
  test('Verify the data backfill: existing Breadfast perks assigned to the Breadfast Section and "General cashback 1%" to "General Purchases"', async ({ page }) => {
    const login = new LoginPage(page);
    const perks = new PerksPage(page);

    // Capture the perks-list request so we can replay it page by page with the
    // page's own session. It paginates with { skip: <1-based page>, filter: {} } —
    // adding page/per_page/limit keys makes it return an EMPTY array, which is an
    // easy way to conclude "there are no perks" incorrectly.
    let listUrl = null; let listHeaders = null;
    page.on('request', (r) => {
      if (/\/card\/perks\/list/i.test(r.url()) && r.method() === 'POST') {
        listUrl = r.url(); listHeaders = r.headers();
      }
    });

    await login.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
    await perks.goToPerksPage();
    await perks.waitForTableSettled().catch(() => {});
    await page.waitForTimeout(2500);
    expect(listUrl, 'the perks list request must be captured').not.toBeNull();

    const all = [];
    for (let p = 1; p <= 40; p += 1) {
      const res = await page.evaluate(async ({ url, headers, skip }) => {
        const h = { 'Content-Type': 'application/json' };
        for (const k of ['authorization', 'x-access-token', 'token', 'lang', 'language']) if (headers[k]) h[k] = headers[k];
        const r = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify({ skip, filter: {} }), credentials: 'include' });
        return { status: r.status, json: await r.json().catch(() => null) };
      }, { url: listUrl, headers: listHeaders, skip: p });
      const arr = res.json && (res.json.data || res.json.result || res.json.perks || (Array.isArray(res.json) ? res.json : []));
      if (!Array.isArray(arr) || !arr.length) break;
      const before = all.length;
      arr.forEach((x) => { if (!all.some((y) => y.id === x.id)) all.push(x); });
      if (all.length === before) break;
    }

    expect(all.length, 'the environment must contain perks to verify the backfill against').toBeGreaterThan(0);

    const assigned = all.filter((x) => x.section_id != null);
    const unassigned = all.filter((x) => x.section_id == null);

    // Existing Breadfast perks must sit under the Breadfast Section.
    const breadfast = assigned.filter((x) => /^breadfast$/i.test((x.section && x.section.name_en) || ''));
    expect(breadfast.length, 'existing perks must be assigned to the Breadfast Section').toBeGreaterThan(0);

    // "General cashback 1%" (live title "1% Cashback Everywhere") → General Purchases.
    const onePct = all.find((x) => /1\s*%\s*cashback|general cashback\s*1/i.test(String(x.title_en || '')));
    expect(onePct, 'the 1% general-cashback perk must exist').toBeTruthy();
    expect(
      (onePct.section && onePct.section.name_en) || null,
      'the 1% general-cashback perk must be assigned to "General Purchases"'
    ).toBe('General Purchases');

    // Perks with section_id = null are a CONFIRMED test-environment artefact (their
    // sections were deleted in the database), not a backfill gap — confirmed by the
    // QA lead. Recorded as an annotation, NOT asserted: a soft assertion here still
    // fails the test, which would report AC-14 as failed when it actually passes.
    if (unassigned.length) {
      test.info().annotations.push({
        type: 'test-env artefact (not a defect)',
        description: `${unassigned.length} perk(s) have section_id=null because their sections were `
          + `deleted in the database: ${unassigned.map((x) => x.id).join(', ')}`,
      });
    }
  });
});
