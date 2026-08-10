# Page Object Catalog

> Every page class in [`automation/pages/`](../../../automation/pages/). Reuse these before writing new UI automation. All extend `BasePage` and take a Playwright `Page` in the constructor.

---

## BasePage — [pages/BasePage.js](../../../automation/pages/BasePage.js)

Base class for all page objects. Holds the `page` reference and a `DEFAULT_TIMEOUT = 60000`.

**Constructor:** `new BasePage(page)` — stores `this.page`, `this.DEFAULT_TIMEOUT`.

| Method | Signature | Does | Returns |
|--------|-----------|------|---------|
| `waitForVisible` | `async waitForVisible(locator)` | Waits for `locator` to be visible (timeout = `DEFAULT_TIMEOUT`). | `Promise<void>` |
| `isElementDisplayed` | `async isElementDisplayed(locator)` | Tries `waitFor visible` (5s); swallows timeout. | `Promise<boolean>` |
| `goToUrl` | `async goToUrl(url)` | `page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })`. | `Promise<void>` |

---

## LoginPage — [pages/LoginPage.js](../../../automation/pages/LoginPage.js)

Card Admin Panel login form. Locators: `usernameField` (`input[placeholder="Username Name"]`), `passwordField` (`input[type="password"]`), `submitButton` (`button[type="submit"]`).

**Constructor:** `new LoginPage(page)`.

| Method | Signature | Does | Returns |
|--------|-----------|------|---------|
| `fillLoginFormAndSubmit` | `async fillLoginFormAndSubmit(username, password)` | Navigates to `/#/pages/login`, fills credentials, submits, waits for `**/#/dashboard`, then 1s settle. | `Promise<void>` |

```js
const loginPage = new LoginPage(page);
await loginPage.fillLoginFormAndSubmit(config.getAdminUserName(), config.getAdminPassword());
```

---

## PerksPage — [pages/PerksPage.js](../../../automation/pages/PerksPage.js)

Card Admin Panel perks list (`#/perks`) and create form (`#/perks/create`). Selectors verified against the live form 2026-06-09 (see the file header for the full field map and the test-environment merchant MID counts: `elaraby`→190, `Breadfast Coffee`→16, `Breadfast App`→15, `breadfast market`→4).

**Constructor:** `new PerksPage(page)` — declares all locators as fields (e.g. `addPerkButton`, `perkTypeCombobox`, `titleEnInput`, `descEnTextarea`, `percentageRadio`, `fixedAmountRadio`, `cashbackValueInput`, `minTransactionInput`, `addImageButtons`, `excludedMerchantsCombobox`, `maxCapacityLabel`, `previewAndSaveButton`).

### Navigation & type selection

| Method | Signature | Does | Returns |
|--------|-----------|------|---------|
| `goToPerksPage` | `async goToPerksPage()` | Navigates to `/#/perks`, waits for "Add Perk". | `Promise<void>` |
| `clickAddPerk` | `async clickAddPerk()` | Clicks "Add Perk", waits for `/#/perks/create` + "Create Perks" heading. | `Promise<void>` |
| `selectGeneralSpendCashbackType` | `async selectGeneralSpendCashbackType()` | Opens the type combobox and picks "General spend cashback". | `Promise<void>` |
| `selectPerkTypeByName` | `async selectPerkTypeByName(label)` | Opens the type dropdown and picks the option by visible label. | `Promise<void>` |
| `startMerchantCashbackPerk` | `async startMerchantCashbackPerk()` | `clickAddPerk()` then selects "Merchant cashback". | `Promise<void>` |

### Form fill (General Spend Cashback)

| Method | Signature | Does | Returns |
|--------|-----------|------|---------|
| `uploadImage` | `async uploadImage(slotIndex, imagePath)` | Opens the Add-Image dialog for `slotIndex` (0=Cover EN,1=Cover AR,2=Logo EN,3=Logo AR), sets the file on the hidden `input[type=file]`, confirms/closes the dialog. | `Promise<void>` |
| `fillMandatoryFields` | `async fillMandatoryFields({ titleEn, titleAr, descEn, descAr, cashback, minTx, cashbackType })` | Fills titles, uploads all 4 images (each via `nth(0)` of remaining buttons), clicks the radio (`'percentage'`\|`'fixed'`), fills cashback value + min tx, fills descriptions. All params optional (defaulted). | `Promise<void>` |

```js
const perks = new PerksPage(page);
await perks.goToPerksPage();
await perks.clickAddPerk();
await perks.selectGeneralSpendCashbackType();
await perks.fillMandatoryFields({ titleEn: 'B10-55168 TC_UI_013 Zero Merchants' });
await perks.submitPerkExpectSuccess();
```

### Excluded-merchants multi-select

| Method | Signature | Does | Returns |
|--------|-----------|------|---------|
| `openExcludedMerchantsDropdown` | `async openExcludedMerchantsDropdown()` | Toggle-safe open of the mat-select (reads `aria-expanded`, waits out overlay backdrop). | `Promise<Locator>` (the options locator) |
| `selectMerchantsByName` | `async selectMerchantsByName(names)` | Toggles each named merchant ON by partial text. | `Promise<void>` |
| `deselectMerchantsByName` | `async deselectMerchantsByName(names)` | Deselects each, **verifying** `aria-selected` flips to `false` (retries 3×); throws if it can't. | `Promise<void>` |
| `selectMerchants` | `async selectMerchants(count)` | Selects first `count` options. | `Promise<number>` (actual selected) |
| `selectAllMerchants` | `async selectAllMerchants()` | Selects every option. | `Promise<number>` (total) |
| `getSelectedMerchantsCount` | `async getSelectedMerchantsCount()` | Counts options with `aria-selected="true"`. | `Promise<number>` |
| `hasMaxCapacityLabel` | `async hasMaxCapacityLabel()` | True if "(200 merchants max.)" hint is visible. | `Promise<boolean>` |

### Submission

| Method | Signature | Does | Returns |
|--------|-----------|------|---------|
| `submitPerkExpectSuccess` | `async submitPerkExpectSuccess()` | Clicks "Preview & Save", confirms "Quick Preview" dialog's Save, waits for redirect to `/#/perks`; on failure throws with the on-screen error text. | `Promise<void>` |
| `submitPerkExpectFailure` | `async submitPerkExpectFailure()` | Submits, confirms preview Save, captures error toast, dismisses the dialog so the form stays editable. | `Promise<{ stayedOnCreate: boolean, errorText: string }>` |

### Merchant-cashback (ported from Java; partial)

| Method | Signature | Does | Returns |
|--------|-----------|------|---------|
| `fillMerchantPerk` | `async fillMerchantPerk({ nameEn, nameAr, branches })` | Fills Merchant Name EN/AR, adds branch rows via "Add more", fills each branch name + MID. **Cashback value / limit fields are NOT yet wired** (see note in code + open dep #8). | `Promise<void>` |

### ⚠️ Stubs that THROW (not implemented — open dep #8/#10)

These exist as placeholders and **throw immediately** until their selectors are recorded from the live panel. Do not call them in passing tests.

| Method | Status |
|--------|--------|
| `fillCouponPerk(...)` | **Throws** — coupon-perk form selectors not confirmed. |
| `fillCategoryPerk(...)` | **Throws** — category/MCC picker selectors not confirmed. |
| `setLimits({ daily, weekly, monthly, annual, maxCashback })` | **Throws** — daily/weekly/monthly/annual/max-cap field selectors not confirmed. |

See [AUTOMATION_B10-55185.md](../../../automation/legacy/AUTOMATION_B10-55185.md) open items #8 and #10.
