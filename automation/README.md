# Shared Automation (BreadfastQA)

**Shared, reusable web-automation code — kept here ONCE, never duplicated per story.**
Mirrors the framework layout (`pages/ helpers/ config/`). The **canonical runnable copy** is the framework `D:\Playwright\b55168_pom`; this BreadfastQA copy is the shared, project-side reference reused across all stories.

```
automation/
├── pages/      BasePage.js · LoginPage.js · EditCustomerPage.js · CollectDialogPage.js
├── helpers/    ConfigReader.js · PropertiesReader.js
└── config/environments/   cardServiceConfigs_testing.js
```

## Rules
- **Do NOT duplicate these classes into per-story folders.** A story's `automation/` holds only story-specific files (its `tests/` specs, generators, framework-reference.md, README) and reuses the page objects/helpers from here.
- **Reuse before you build** — extend these shared page objects/helpers; never create a parallel implementation.
- Primary framework reference + patterns: [framework-reference.md](../B10-56336/automation/framework-reference.md) and [docs/ai/automation/playwright-framework.md](../docs/ai/automation/playwright-framework.md).
- Source of truth for mobile/Selenium + config = `D:\projects` (Java); web/backend JS = `D:\Playwright\b55168_pom` (runnable).

New shared page objects/helpers (reusable across stories) are added here; story-only specs stay under `D:\BreadfastQA\<TICKET>\automation\tests\`.
