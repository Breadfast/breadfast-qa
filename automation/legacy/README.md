# `automation/legacy/` — the imported Playwright suite (was `D:\Playwright\b55168_pom`)

**Imported 2026-08-10.** Everything here previously lived **only** in `D:\Playwright\b55168_pom`,
an external folder that was **not a git repository** — it had no `.git`, no remote, and was never
pushed. Anyone who cloned `breadfast-qa` got a workflow that pointed at a path which did not exist
on their machine, and the specs below existed on exactly one disk.

The repo is now self-contained: **nothing in this workflow requires a folder outside the
repository.**

## What is here

| Path | Was | Notes |
|---|---|---|
| [`tests/`](tests/) | `b55168_pom/tests/` | 13 specs, 98 tests — card-service KYC (×8), MID exclusion (×2), cashback processing, replacement-fee display, KYC visual-vs-Figma |
| [`playwright.config.js`](playwright.config.js) | `b55168_pom/playwright.config.js` | direct replacement for the pom's root config |
| [`create_perks_api.js`](create_perks_api.js) | pom root | ad-hoc API perk seeding (no test runner) |
| [`record_bug_b10_56609.js`](record_bug_b10_56609.js) | pom root | bug-repro video recording pattern |
| [`gen_browserstack_csv_b10_56336.js`](gen_browserstack_csv_b10_56336.js) | pom root | the BrowserStack CSV generator with reusable step preambles |
| [`AUTOMATION_B10-55185.md`](AUTOMATION_B10-55185.md) | pom root | cashback automation context + open items |

The shared page objects, helpers and config are **not** duplicated here — they live once at
[`automation/pages/`](../pages/), [`automation/helpers/`](../helpers/) and
[`automation/config/`](../config/), exactly as CLAUDE.md requires.

## Run it

```bash
npx playwright test --config=automation/legacy/playwright.config.js
npx playwright test --config=automation/legacy/playwright.config.js tests/kyc_file_number.spec.js
```

Dependencies (`@playwright/test`, `mysql2`, `ssh2`, `pdf-parse`) come from the **repo-root**
[`package.json`](../../package.json) — run `npm install` at the repo root once. No `NODE_PATH`,
no special `cwd`.

Secrets are still **not** in this repo: [`PropertiesReader.js`](../helpers/PropertiesReader.js)
reads the Java framework's `config_testing.properties` at runtime
(path resolved by [`automation/config/framework.js`](../config/framework.js)).

## What changed during the import

1. `require('../helpers/…')` / `require('../pages/…')` → `require('../../helpers/…')` /
   `require('../../pages/…')` — the specs moved one level deeper.
2. `const FW = process.env.BF_POM_DIR || 'D:\Playwright\b55168_pom'` →
   `process.env.BF_AUTOMATION_DIR || path.resolve(__dirname, '..', '..')`.
3. Machine-absolute evidence paths (`C:\Users\Breadfast\BreadfastQA\Workspace\stories\…`,
   `../../../BreadfastQA/…`) → repo-relative `../../../B10-<key>/evidence`.
4. The pom root scripts' `require('./helpers/…')` → `require('../helpers/…')`.

## Mirror drift that was resolved at the same time

`automation/` and the pom had drifted **in both directions** — the "mirrored copy" rule was no
longer true. Resolved per-file, newest wins, after reading every diff:

- **Taken from the pom** (newer, verified against the live DB / a 2026-07-08 UI change):
  `CollectDialogPage`, `EditCustomerPage`, `AuditLogHelper`, `DbHelper`, `KycRecordHelper`
- **Kept from the repo** (newer): `CardConfig`, `CardUserFactory`, `PropertiesReader`,
  `TestDataInventory`, `VisualComparisonHelper`
- **Imported** (existed only in the pom): `pages/ReplaceCardPage.js`, `helpers/CronHelper.js`

There is no mirror any more. [`automation/`](../) is the only copy — do not re-create one.

## Status

**Legacy.** New web automation is generated as Java/Selenium inside the Java framework
([automation-generation.md](../../docs/ai/automation/automation-generation.md)). This suite is
maintained, not extended; new Playwright only on explicit request.
