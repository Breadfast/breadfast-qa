# Release Validation — Quality Gates, Reports & Sign-off

> The exit criteria for a story and the HTML report standard.

---

## 1. Quality Gates (a story is not complete until ALL pass)

✓ Acceptance Criteria covered — **each AC verified on its real surface; persistence/traceability ACs (recorded/logged/traceable/persisted) confirmed on the destination (audit log/report/DB), NOT inferred from a 200 response.** Any AC not actually verified is marked ⚠️/⛔, never ✅. (See [testing-process.md](testing-process.md) §1.)
✓ HLS created (and added to Jira as a separate checklist section)
✓ Test cases created (project/BrowserStack standards)
✓ BrowserStack CSV import ready (destination confirmed with user) **and import verified (folder count matches)**
✓ Exploratory testing completed
✓ Regression areas identified ([regression-strategy.md](regression-strategy.md))
✓ Automation completed (or explicitly deferred with reason) — **1:1 mirror of the BrowserStack cases; per-test-case status reported** ([testing-process.md](testing-process.md) §3.8)
✓ Defects reported in Jira — **one defect per bug; evidence (screenshot/video) attached** ([bug-reporting.md](bug-reporting.md))
✓ HTML report generated
✓ Documentation updated (reusable knowledge only; governance below)

---

## 2. HTML Report Standard

Generated via the in-repo [`gen_report.js`](../../gen_report.js) (repo root) → `<storyDir>/execution-reports/test_report_[STORY_ID].html`. Embed all screenshots as base64 (no external file deps). Expected file size 30–50 MB (4 screenshot sets + Figma refs) — normal.

Per story / test-case layout:
1. **Actual screenshots** — 4 columns: iOS EN | iOS AR | Android EN | Android AR.
2. **Figma reference** — 2 columns: EN frame | AR frame.
3. **Figma comparison table** — Content EN ✅/❌, Content AR ✅/❌, Style iOS ✅/⚠️/❌, Style Android ✅/⚠️/❌.
4. **Mismatch callout** (red-bordered) when any mismatch: screen → element → Figma value vs app value.
5. **Test-case table** — pass/fail/blocked per AC item per platform × language.

Badges:
- `✅ MATCHES FIGMA` — `#d4edda / #155724 / #c3e6cb`
- `❌ FIGMA MISMATCH` — `#f8d7da / #721c24 / #f5c6cb`
- `⚠️ STYLE NOTE` — `#fff3cd / #856404 / #ffeeba`
- `📋 NO FIGMA REF` — `#e2e3e5 / #383d41 / #d6d8db`

Story status badges: `PASS` (green) · `PASS ⚠️ STYLE NOTE` · `FIGMA MISMATCH` (red, bug) · `NO FIGMA REF` (amber) · `FAIL` (red) · `BLOCKED` (grey). Platform-specific failures labeled e.g. "FAIL (Android only)".

Summary stats must be accurate: Total Stories / Passed / Bugs Found / Figma Mismatches / Partial or Blocked.

Do NOT create a new story section in `gen_report.js` for a story already present — update the existing section.

### 2.1 Per-test-case evidence — MANDATORY for every executed case (passed AND failed)
The final HTML report must make **every executed test case fully traceable through evidence** — not just failures. For **each** test case include:
- **Test Case ID** (matching the BrowserStack case).
- **Pass / Fail** status (also Blocked where applicable).
- **Screenshot(s)** of the actual result (and key intermediate steps for multi-step cases). For web/automation, attach the Playwright per-test screenshots/trace.
- **Expected Result** (from the case).
- **Actual Result** (what was observed, incl. API status/response where the assertion is on the network — e.g. `update 200`, `print_kyc 400 "..."`).
- **Figma / Design reference** (the relevant frame screenshot or `NO FIGMA REF`).
- **Design-vs-Implementation comparison** (MATCHES / MISMATCH / STYLE NOTE + detail).

This applies to web, API, and mobile stories. Passed cases require the same evidence as failed ones — a green result with no screenshot/expected/actual is **not** acceptable. Enable Playwright `screenshot: 'on'` (+ trace) so evidence is captured for passing tests too, and surface the per-case evidence in `test_report_[STORY_ID].html`.

---

## 3. Regression Report Template

```markdown
# Regression Test Report — [Date]
Build: com.breadfast.testing [version]
Platforms: iOS 18 (iPhone 14) + Android 13 (Samsung S23)   Languages: EN + AR
Tester: ahmed.essameldien@breadfast.com

## Summary
| Category | iOS EN | iOS AR | Android EN | Android AR |
|----------|--------|--------|------------|------------|
| Test Cases Run / Passed / Failed / Blocked | | | | |

## Results by Story
| Story | Title | iOS EN | iOS AR | Android EN | Android AR |

## Bugs Found  (note affected platform(s))
## Environment Limitations  (per platform, NOT app bugs)
## Signoff checklist (4 flows complete · parity check · screenshots · report)
```

---

## 4. QA Sign-off Template

```markdown
# QA Signoff — [STORY_ID] [Feature]
Date / Build / Tester

## Stories Tested
| Story | Title | iOS EN | iOS AR | Android EN | Android AR |

## Coverage
- iOS EN / iOS AR / Android EN / Android AR: Complete / Partial / Not Started
- Figma EN / Figma AR comparison: Complete / Partial / Not Started

## Figma Comparison Results
| Story | Screen | Figma EN | Figma AR | Content Match | Style Notes |

## Open Items (per platform)
## Decision: APPROVED / NOT APPROVED  + justification
```

---

## 5. Documentation Governance (applies whenever updating docs/ai/** or memory)

Before any documentation update:
1. Check whether the information already exists.
2. Detect duplicates.
3. Detect contradictions.
4. Present conflicts.
5. Ask for confirmation.
6. Then update — and explain WHY the update is recommended.

Never silently overwrite project knowledge. Never silently modify CLAUDE.md. Store only **reusable** project knowledge (new business rule, workflow, user role, app state, automation pattern, BrowserStack convention, testing standard, regression rule) — not story-specific noise.

Knowledge routing:
- Reusable testing/process knowledge → `docs/ai/**`.
- Framework intelligence (page objects, helpers, fixtures, API clients) → `docs/ai/automation/**`.
- Module behavior → `docs/ai/modules/**`.
- Business rules → `docs/ai/business/**`.
- Session continuity / credentials / point-in-time state → Claude memory (`~/.claude/projects/d--breadfast-qa/memory/` — per-user, outside the repo; the slug follows the repo path, so each engineer gets their own automatically).

---

## 6. Artifact & Project Organization Standard (mandatory for every story)
All generated artifacts — reports, screenshots, test cases, automation outputs, Figma captures, execution evidence — **must be stored under the BreadfastQA project**, in a dedicated per-story folder. Never leave reports/assets/dependencies in temp or unrelated project folders; if something is created elsewhere during execution (e.g. automation in `D:\Playwright\b55168_pom`), **move or replicate a snapshot into the story folder** (runnable framework code stays in the framework; the per-story folder keeps a traceability copy).

**Create this structure at the START of the QA process if it doesn't already exist:**
```
D:\BreadfastQA\<JIRA_TICKET_ID>\
├── requirements-analysis/   AC, comments, subtasks, clarifications & rulings
├── figma-analysis/          design frames + design-vs-implementation comparison
├── hls/                     High-Level Scenarios (mirror of the Jira checklist)
├── browserstack/            CSV import evidence (project/folder, screenshots)
├── testcases/               testcases.csv (BrowserStack-compatible) + coverage-notes.md (AC→case map)
│                            + review.md (the review-gate record) + testcases.approved.csv (the
│                            operator-approved snapshot, written by `qa-cli.js approve`)
│                            + reconciliation.md (post-development deltas, when the suite changed)
├── automation/              STORY-SPECIFIC ONLY — framework-reference.md (reuse map) + README (run commands + traceability table) + generators. Generated Java code lives INSIDE the Java framework (automation-generation.md §8); legacy Playwright stories additionally keep tests/ (specs + playwright.config.js).
├── execution-reports/       test_report_<STORY_ID>.html
├── screenshots/             live UI screenshots
├── defects/                 defects.md (findings + Jira links)
└── evidence/                playwright-report (per-test screenshots/traces) + evidence.md
```

Rules:
- Every Jira story gets its own folder; all of its outputs go under it.
- **Future updates, retesting, automation changes, and bug investigations reuse the SAME story folder** (do not create a second folder for the same ticket).
- **Generated automation lives inside the Java framework** (default `D:\projects`, path configurable — [automation-generation.md](automation/automation-generation.md)): story test class `B10_<id>_<Feature>Tests`, new page objects/helpers, story suite XML. The story folder never holds Java copies — its `automation/` carries the traceability README + framework-reference.md + generators, and the run command (`mvn test -DsuiteXmlFile=b10-<id>-tests.xml`).
- **Legacy Playwright stories:** shared JS code (page objects, helpers, config) is NOT duplicated per story — it lives once at `D:\BreadfastQA\automation\` (`pages/ helpers/ config/`), reused across stories; a story's `automation/` keeps only story-specific files (`playwright.config.js`, its `tests/` specs) and reuses the shared classes (specs `require('../../../automation/pages/…')`).
- **Runnable Playwright workspace (legacy):** the **repo itself** is the workspace — repo-root [`package.json`](../../package.json) + `node_modules` supply `@playwright/test`, `mysql2`, `ssh2`, `pdf-parse`. Playwright takes its config from `--config`, so run either the imported legacy suite (`npx playwright test --config=automation/legacy/playwright.config.js`) or a story suite (`npx playwright test --config=B10-<key>/automation/playwright.config.js`). **Nothing outside the repo is needed** — the former external framework `D:\Playwright\b55168_pom` was imported into [`automation/legacy/`](../../automation/legacy/) on 2026-08-10 because it was never a git repository and so was never pushed to anyone.
- Reports must contain links/references to the stored evidence (§2.1).
- Keep a root `README.md` in the story folder indexing the subfolders, the result, and Jira/artifact links.
- First implemented for B10-56336.
