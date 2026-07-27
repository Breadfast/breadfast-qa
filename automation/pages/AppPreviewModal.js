'use strict';

const BasePage = require('./BasePage');

/**
 * AppPreviewModal — the "App preview" modal opened by "Preview & save" on #/perks/create.
 * B10-57393. Selectors captured LIVE 2026-07-27 against card-panel-testing (panel 2.4.5).
 *
 * The modal renders two iPhone mockups of the perk being created, an English/Arabic
 * "Preview language" radio group, and Save / Cancel in the footer:
 *
 *   mat-dialog-container
 *     phone-frame > div.iphone (bezel) > div.screen > div.screen-scroll   [0] Card perks tile view
 *     phone-frame > div.iphone         > div.screen > div.screen-scroll   [1] perk detail screen
 *     each detail section = div.card whose header is div.card-head (mat-icon + label span)
 *
 * MEASUREMENT TRAP: an ancestor `div.frames` applies `transform: scale(0.8)`, so
 * boundingBox() / getBoundingClientRect() return the SCALED box while offsetWidth /
 * offsetHeight return the true CSS layout box. The AC's 375x812 assertion must read the
 * LAYOUT box — see layoutSize() vs renderedSize().
 */
class AppPreviewModal extends BasePage {
  constructor(page) {
    super(page);
    this.page = page;

    this.modal = page.locator('mat-dialog-container');
    this.title = this.modal.locator('h2, h3, [class*="title"]').first();
    // The close control is the only icon-bearing button in the modal header.
    this.closeIcon = this.modal.locator('button:has(mat-icon), button:has(svg)').first();
    this.languageRadios = this.modal.locator('mat-radio-button');
    this.bezels = this.modal.locator('div.iphone');
    this.screens = this.modal.locator('div.screen:not(.screen-scroll)');
    this.scrollScreens = this.modal.locator('div.screen-scroll');
    this.saveButton = this.modal.locator('button', { hasText: /^\s*Save\s*$/ }).first();
    this.cancelButton = this.modal.locator('button', { hasText: /^\s*Cancel\s*$/ }).first();
    this.perkCreatedToast = page.locator(
      'snack-bar-container, simple-snack-bar, .mat-snack-bar-container'
    ).filter({ hasText: /card perk created successfully/i });
    this.overlayBackdrops = page.locator('.cdk-overlay-backdrop');
  }

  /** Frame 0 = Card perks tile view. */
  tileScreen() { return this.scrollScreens.nth(0); }

  /** Frame 1 = perk detail screen. */
  detailScreen() { return this.scrollScreens.nth(1); }

  // ── presence / chrome ─────────────────────────────────────────────────────

  async waitUntilVisible(timeout = 20_000) {
    await this.modal.waitFor({ state: 'visible', timeout });
    await this.page.waitForTimeout(1_500);   // let the mockups paint
  }

  async isVisible() {
    return this.modal.isVisible().catch(() => false);
  }

  async waitUntilClosed(timeout = 15_000) {
    await this.modal.waitFor({ state: 'hidden', timeout }).catch(() => {});
    return !(await this.isVisible());
  }

  async getTitleText() {
    return (await this.title.innerText().catch(() => '')).trim();
  }

  async countDeviceFrames() {
    return this.bezels.count();
  }

  // ── AC1: device-frame dimensions ─────────────────────────────────────────

  /** True CSS layout box (offsetWidth x offsetHeight) — unaffected by the 0.8 ancestor scale. */
  async layoutSize(locator) {
    return locator.evaluate((el) => `${el.offsetWidth}x${el.offsetHeight}`);
  }

  /** What the admin actually sees, i.e. after the ancestor transform. */
  async renderedSize(locator) {
    return locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)}`;
    });
  }

  /** Any transform on the element or one of its ancestors, e.g. "matrix(0.8, 0, 0, 0.8, 0, 0)". */
  async ancestorTransform(locator) {
    return locator.evaluate((el) => {
      let found = 'none';
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const t = getComputedStyle(n).transform;
        if (t && t !== 'none') found = t;
      }
      return found;
    });
  }

  /** Everything AC1 needs in one read, for a self-explanatory assertion message. */
  async measureFrame(index = 0) {
    const bezel = this.bezels.nth(index);
    const screen = this.screens.nth(index);
    return {
      bezelLayout: await this.layoutSize(bezel),
      screenLayout: await this.layoutSize(screen),
      bezelRendered: await this.renderedSize(bezel),
      transform: await this.ancestorTransform(bezel),
    };
  }

  // ── AC2: scrolling inside the device frame ───────────────────────────────

  async detailScrollMetrics() {
    return this.detailScreen().evaluate((el) => ({
      scrollTop: Math.round(el.scrollTop),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollable: el.scrollHeight > el.clientHeight + 2,
      atBottom: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 3,
    }));
  }

  async scrollDetailToBottom() {
    await this.detailScreen().evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await this.page.waitForTimeout(700);
  }

  async scrollDetailToTop() {
    await this.detailScreen().evaluate((el) => { el.scrollTop = 0; });
    await this.page.waitForTimeout(400);
  }

  // ── AC3: detail sections ────────────────────────────────────────────────

  /**
   * Section labels in render order.
   *
   * A header is not just its label: it always carries a leading mat-icon, and the Coupon code
   * header also carries the copy-to-clipboard chip, so its innerText reads
   * "local_offer Coupon code content_copy BFCOFFEE20". Dropping only the first token (the old
   * behaviour) left the code in the name and made hasSection('Coupon code') false while the
   * section was plainly rendered (live 2026-07-27, B10-57393 — a false test failure).
   *
   * So: strip icon and button descendants in the page, then strip a leading icon ligature token
   * for icons that render as text (`storefront`, `info_outline`, …). Real labels start with an
   * uppercase letter or Arabic script, so the lowercase-token rule cannot eat one.
   */
  async getSectionNames() {
    const heads = await this.detailScreen().locator('.card .card-head').evaluateAll((els) =>
      els.map((head) => {
        const clone = head.cloneNode(true);
        clone.querySelectorAll('mat-icon, svg, img, button').forEach((n) => n.remove());
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
      })
    );
    return heads.map((t) => t.replace(/^[a-z][a-z_]*\s+/, '').trim());
  }

  async hasSection(name) {
    return (await this.getSectionNames()).some((n) => n.toLowerCase() === name.toLowerCase());
  }

  sectionCard(name) {
    return this.detailScreen().locator('.card').filter({ hasText: name }).first();
  }

  async getSectionText(name) {
    const card = this.sectionCard(name);
    if (!(await card.count())) return '';
    return (await card.innerText()).replace(/\s+/g, ' ').trim();
  }

  /**
   * Does the header advertise itself as collapsible? AC3 needs a tap-to-toggle affordance;
   * a static card exposes cursor:auto, no chevron, no role/tabindex and no aria-expanded.
   */
  async sectionOffersCollapseAffordance(name) {
    const card = this.sectionCard(name);
    if (!(await card.count())) return false;
    return card.locator('.card-head').evaluate((head) => {
      const pointer = getComputedStyle(head).cursor === 'pointer';
      const chevron = /expand|chevron|keyboard_arrow|arrow_drop/i.test(head.innerText || '');
      const aria = head.hasAttribute('aria-expanded') || !!head.querySelector('[aria-expanded]');
      const role = head.getAttribute('role') === 'button' || head.hasAttribute('tabindex');
      return pointer || chevron || aria || role;
    });
  }

  /** Tap a section header and report whether the section actually toggled. */
  async tapSectionAndDetectToggle(name) {
    const card = this.sectionCard(name);
    const read = () => card.evaluate((el) => {
      const expanded = el.querySelector('[aria-expanded]');
      return [
        Math.round(el.getBoundingClientRect().height),
        (el.innerText || '').trim().length,
        expanded ? expanded.getAttribute('aria-expanded') : 'none',
      ].join('|');
    });
    const before = await read();
    await card.locator('.card-head').click();
    await this.page.waitForTimeout(900);
    const after = await read();
    return { changed: before !== after, before, after };
  }

  // ── AC4: tile-view isolation ────────────────────────────────────────────

  async getTileText() {
    return (await this.tileScreen().innerText()).replace(/\s+/g, ' ').trim();
  }

  /** Category headings in the tile view — AC4 expects exactly one, the perk's own. */
  async getTileCategoryNames() {
    const names = await this.tileScreen().locator('h1, h2, h3, h4, h5').allInnerTexts();
    return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  }

  // ── AC5: preview language / RTL ─────────────────────────────────────────

  async selectPreviewLanguage(language) {
    // Material hides the real input, so the label is the clickable surface.
    await this.languageRadios
      .filter({ hasText: new RegExp(`^\\s*${language}\\s*$`, 'i') })
      .locator('label').first().click();
    await this.page.waitForTimeout(1_200);
  }

  async isPreviewLanguageSelected(language) {
    const radio = this.languageRadios.filter({ hasText: new RegExp(`^\\s*${language}\\s*$`, 'i') }).first();
    if (!(await radio.count())) return false;
    return radio.locator('input').isChecked();
  }

  async getPreviewLanguageOptions() {
    return (await this.languageRadios.allInnerTexts()).map((t) => t.trim());
  }

  /** "rtl" | "ltr" for the requested frame. */
  async frameDirection(index) {
    return this.scrollScreens.nth(index).evaluate((el) => getComputedStyle(el).direction);
  }

  async bothFramesDirection() {
    return { tile: await this.frameDirection(0), detail: await this.frameDirection(1) };
  }

  async getPreviewText() {
    const tile = await this.tileScreen().innerText();
    const detail = await this.detailScreen().innerText();
    return `${tile} ${detail}`.replace(/\s+/g, ' ').trim();
  }

  async previewHasArabicScript() {
    return /[؀-ۿ]/.test(await this.getPreviewText());
  }

  /** The modal chrome must stay English even while the preview renders Arabic. */
  async chromeHasArabicScript() {
    const parts = [
      await this.getTitleText(),
      ...(await this.getPreviewLanguageOptions()),
      await this.saveButton.innerText().catch(() => ''),
      await this.cancelButton.innerText().catch(() => ''),
    ];
    return /[؀-ۿ]/.test(parts.join(' '));
  }

  // ── images ──────────────────────────────────────────────────────────────

  async imageStats() {
    return this.modal.evaluate((root) => {
      const imgs = [...root.querySelectorAll('img')];
      let worstAspectDeviation = 0;
      for (const img of imgs) {
        if (!img.naturalWidth || !img.naturalHeight || !img.clientWidth || !img.clientHeight) continue;
        if (getComputedStyle(img).objectFit === 'cover') continue;   // cover crops legitimately
        const natural = img.naturalWidth / img.naturalHeight;
        const rendered = img.clientWidth / img.clientHeight;
        worstAspectDeviation = Math.max(worstAspectDeviation, Math.abs(rendered - natural) / natural);
      }
      return {
        count: imgs.length,
        allLoaded: imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0),
        worstAspectDeviation,
      };
    });
  }

  // ── "See more" truncation expander ──────────────────────────────────────

  /**
   * The expander is a real <button>, so target the button rather than the text node: a text=
   * match can resolve to a wrapper whose centre lies outside the device frame, and the
   * { force: true } click that followed then landed on whatever was on top — the section never
   * expanded and the test failed on a working feature (live 2026-07-27, B10-57393; the probe
   * run, which clicked without force, expanded it correctly: scrollHeight 905 → 1085).
   */
  seeMoreLink() {
    const detail = this.detailScreen();
    // Two locators combined with .or(), NOT one comma-separated string: a `text=` engine selector
    // cannot appear inside a CSS selector list — Playwright rejects the whole thing with
    // `Unexpected token "=" while parsing css selector`.
    return detail.locator('button', { hasText: /see more|اعرض المزيد/i })
      .or(detail.getByText(/see more|اعرض المزيد/i))
      .first();
  }

  async clickSeeMoreAndDetectExpansion() {
    const link = this.seeMoreLink();
    if (!(await link.count())) return { present: false, expanded: false };
    const before = await this.detailScrollMetrics();
    const textBefore = (await this.detailScreen().innerText()).length;
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await link.click({ timeout: 8_000 }).catch(() => link.evaluate((el) => el.click()));
    await this.page.waitForTimeout(900);
    const after = await this.detailScrollMetrics();
    const textAfter = (await this.detailScreen().innerText()).length;
    return {
      present: true,
      expanded: after.scrollHeight > before.scrollHeight || textAfter > textBefore,
      before, after,
    };
  }

  // ── AC6: Save / Cancel / close ──────────────────────────────────────────

  async clickSave() {
    await this.saveButton.click();
    await this.page.waitForTimeout(2_500);
  }

  async clickCancel() {
    await this.cancelButton.click();
    await this.page.waitForTimeout(1_200);
  }

  async closeViaX() {
    await this.closeIcon.click();
    await this.page.waitForTimeout(1_200);
  }

  async waitForPerkCreatedToast(timeout = 15_000) {
    return this.perkCreatedToast.first().waitFor({ state: 'visible', timeout })
      .then(() => true).catch(() => false);
  }

  /** After any close route the page must be usable again: no backdrop, no scroll lock. */
  async pageRestoredCleanly() {
    const backdrops = await this.overlayBackdrops.count();
    const visibleBackdrops = backdrops === 0 ? 0
      : await this.overlayBackdrops.evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);
    const scrollLocked = await this.page.evaluate(
      () => getComputedStyle(document.body).overflow === 'hidden'
    );
    return { clean: visibleBackdrops === 0 && !scrollLocked, visibleBackdrops, scrollLocked };
  }

  async isSaveSpinnerShowing() {
    return this.saveButton
      .locator('mat-spinner, mat-progress-spinner, [class*="spin"]')
      .count().then((n) => n > 0).catch(() => false);
  }

  /**
   * Poll every `stepMs` for `totalMs` and report whether ANY error surface ever appeared and
   * how long the Save button stayed busy. A single sample can't prove "no toast was shown" —
   * an auto-dismissing toast would be missed (bug-reporting.md gate check 8).
   */
  async watchSaveOutcome({ totalMs = 12_000, stepMs = 500 } = {}) {
    const samples = [];
    let firstError = null;
    for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
      const snap = await this.page.evaluate(() => {
        const surfaces = [...document.querySelectorAll(
          '.toast, .mat-snack-bar-container, snack-bar-container, simple-snack-bar, .error, mat-error, [class*="alert"]'
        )].map((n) => (n.innerText || '').trim()).filter(Boolean);
        const dialog = document.querySelector('mat-dialog-container');
        const saveBtn = dialog && [...dialog.querySelectorAll('button')]
          .find((b) => /save/i.test(b.innerText) || b.querySelector('mat-spinner, mat-progress-spinner'));
        return {
          errors: surfaces,
          spinner: !!saveBtn && !!saveBtn.querySelector('mat-spinner, mat-progress-spinner, [class*="spin"]'),
          modalOpen: !!dialog,
        };
      });
      samples.push({ atMs: elapsed, ...snap });
      if (snap.errors.length && !firstError) firstError = { atMs: elapsed, errors: snap.errors };
      await this.page.waitForTimeout(stepMs);
    }
    return {
      samples: samples.length,
      firstError,                                       // null = never surfaced
      spinnerSamples: samples.filter((s) => s.spinner).length,
      spinnerAtEnd: samples[samples.length - 1].spinner,
      modalOpenAtEnd: samples[samples.length - 1].modalOpen,
    };
  }
}

module.exports = AppPreviewModal;
