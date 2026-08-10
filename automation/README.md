# Shared Automation (BreadfastQA)

**Shared, reusable web-automation code — kept here ONCE, never duplicated per story.**
This is now the **only** copy and it is directly runnable. There is **no mirror**: the external
`D:\Playwright\b55168_pom` was imported into [`legacy/`](legacy/) on 2026-08-10 (it was never a git
repository, so it was never pushed and broke for anyone who cloned this repo). Do not re-create one.

```
automation/
├── pages/      BasePage.js · LoginPage.js · PerksPage.js · PerkDetailsPage.js · AppPreviewModal.js
│               EditCustomerPage.js · CollectDialogPage.js · ReplaceCardPage.js
│               BulkAdjustmentPage.js · SingleAdjustmentPage.js
├── helpers/    ConfigReader.js · PropertiesReader.js · ApiHelper.js · DbHelper.js · CronHelper.js
│               AuditLogHelper.js · KycRecordHelper.js · CardUserFactory.js · CardConfig.js
│               EncryptionHelper.js · FigmaExporter.js · VisualComparisonHelper.js
│               KycPdfContentValidator.js · TestDataInventory.js
├── config/environments/   cardServiceConfigs_testing.js
└── legacy/     the imported Playwright suite (13 specs / 98 tests) + its playwright.config.js
                and the standalone runners — see legacy/README.md
```

## Rules
- **Do NOT duplicate these classes into per-story folders.** A story's `automation/` holds only story-specific files (its `tests/` specs, generators, framework-reference.md, README) and reuses the page objects/helpers from here.
- **Reuse before you build** — extend these shared page objects/helpers; never create a parallel implementation.
- Primary framework reference + patterns: [framework-reference.md](../B10-56336/automation/framework-reference.md) and [docs/ai/automation/playwright-framework.md](../docs/ai/automation/playwright-framework.md).
- Source of truth for mobile/Selenium + config = `D:\projects` (Java, path configurable); web/backend JS = **this folder**, runnable in place.

New shared page objects/helpers (reusable across stories) are added here; story-only specs stay under `<repo root>\<TICKET>\automation\tests\`.

## Run

```bash
npm install                                                        # once, at the repo root
npx playwright test --config=automation/legacy/playwright.config.js   # the legacy suite
npx playwright test --config=B10-<key>/automation/playwright.config.js # a story suite
```
