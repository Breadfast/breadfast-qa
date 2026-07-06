# Bug Reporting Standards

> How defects are classified, filed (Jira), and templated. Used by every story.

---

## 1. Classify BEFORE reporting

Checklist:
- [ ] Observed in test/staging — could it be **seeded test data**, not a production bug?
- [ ] Does it deviate from the **design spec (Figma)** or **PRD acceptance criteria**?
- [ ] Is it a **BrowserStack environment limitation** (network tunnel, WebView load failure)?
- [ ] Reproduced **at least twice** in the same session?
- [ ] Do I have a **screenshot/video**?

**Do NOT report:**
- Placeholder test data as a content bug.
- BrowserStack `NSURLErrorDomain -1005` / `net::ERR_CONNECTION_RESET` WebView errors.
- iOS Settings access failures (BrowserStack restriction).
- Platform-specific UI differences that match the platform's own design guidelines.
- Android back-gesture behaving differently from iOS — expected.

### 1.1 Defect Grounding Gate (precision — prevents false positives)

A finding becomes a **filed Defect only if it passes ALL of the checks below**. Otherwise it is a **report-only observation** (put it in notes / the report), never a Jira bug. Added after the B10-56337 certification run filed 4 false positives out of 7 (B10-57364/65/66/68) — each failed one of these:

1. **Source cited.** Name the exact thing it violates — a specific **AC**, a **Figma** element, or an **established business rule**. If you can't name it, it is not a defect — never invent an "ideal" expectation the spec never states (an extra dialog, a disabled state, a copy tweak). **But check the AC first: if the AC _does_ state it (e.g. "the Confirm button must be disabled until Package Number is entered" — a real B10-56337 AC), a deviation IS a valid defect.**
2. **Not test data.** Seeded/garbage values in the testing env — dropdown entries like `test`, `dsa`, `{{7*7}}`, `@SUM(...)`, duplicate demo branches — are not product defects. → *B10-57364*
3. **Reproducible.** Re-run the exact steps ≥ once more. A single non-repeating observation is unconfirmed/flaky, not a defect. → *B10-57366*
4. **Not a tooling artifact.** `pdf-parse` reverses/re-orders Arabic (RTL) numerals and shaping. A digit-order/RTL difference seen **only in extracted text** is not a defect unless confirmed by eyeballing the rendered PDF/screenshot. *(Note: a genuine RTL render defect confirmed visually IS valid — cf. B10-57367.)*
5. **No cross-language / derived-field false mismatches.** Don't assert an English UI label must equal an Arabic stored value (a correct branch **code** = valid mapping, regardless of the Arabic name → *B10-57365*). Don't flag derived fields as inconsistent with a display label (Gender is derived from the **Egyptian NID 13th digit**: odd = male, even = female → *B10-57368*).
6. **One defect = one problem.** Never bundle two distinct issues (or a strong issue + a weak one) into one bug — split them. → *B10-57363* bundled a valid AC-based disabled-button defect with a flaky "no-op" observation. (Reinforces the one-defect-per-bug standard.)

Enforced in the QA Platform execution node (`apps/worker/src/nodes.ts`) as a mandatory pre-filing gate in the execution prompt.

---

## 2. Severity

| Severity | Definition | Examples |
|----------|-----------|----------|
| **Critical** | Blocks core flow completely | Login fails, card application crashes, passcode unenterable |
| **High** | Breaks a key feature, workaround exists | Wrong error message, wrong step indicator, broken RTL layout |
| **Medium** | Functional issue, low impact | Wrong button style, minor text overlap, non-blocking validation gap |
| **Low** | Cosmetic | Spacing, minor color mismatch, animation timing |

## 3. Priority

| Priority | Definition |
|----------|-----------|
| **P1** | Must fix before release |
| **P2** | Must fix this sprint |
| **P3** | Next sprint |
| **P4** | Backlog |

---

## 4. Jira Bug Template

**Golden rules (every bug):**
- **One defect per bug.** Never bundle multiple issues ("Issue A / Issue B", "Step B") — split into separate bugs.
- **Title describes the ACTUAL wrong result**, format `[Screen]: <actual wrong behavior>` — readable on its own. E.g. *"Single Adjustment: no-card validation shows 'Select a card' instead of the required 'Please select a card to apply this adjustment.'"* (not a vague "validation issue").
- **Specific Actual & Expected**, quoting the exact on-screen strings.

When filing in Jira (via the Atlassian MCP), include:

```markdown
## Bug Title
[Screen]: [actual wrong result]

## Environment
- App: com.breadfast.testing [version]
- Platform: iOS / Android
- Device: iPhone 14 / iOS 18.0  —OR—  Samsung Galaxy S23 / Android 13
- Locale: Arabic (ar/EG) / English (en/US)
- BrowserStack Session: [session ID]
- Date: YYYY-MM-DD

## Severity / Priority
Severity: [Critical/High/Medium/Low]   Priority: [P1/P2/P3/P4]

## Steps to Reproduce
1. Launch app in [language] locale
2. Navigate to [screen]
3. [action] …
5. Observe [element/behavior]

## Expected Behavior
[What PRD/Figma says]

## Actual Behavior
[What happens — quote labels verbatim]

## Evidence
- Screenshot: [filename / attachment]
- Video: [BrowserStack session link]

## Root Cause Hint
[Optional dev-friendly hint]

## Regression Risk
[Low / Medium / High]
```

For mobile bugs, always note the affected platform(s) and language(s) explicitly. For platform-specific failures, label as e.g. "FAIL (Android only)".

### 4.1 Filing mechanics — Jira project B10 (Breadfast 1.0)
- A "Bug" in B10 is issue type **`Bug` (id 10084), a sub-task** — file it with **`parent` = the story key** (not a standalone issue).
- **Required fields:** Components, **Platform** `customfield_10467` (e.g. `BE` / `FE` / `FE/BE`), **Squad name** `customfield_10183` (array, e.g. `[{value:"Card Core"}]`), Priority.
- The template fields are **rich text (ADF)** custom fields — pass ADF docs, not markdown strings:
  - **Steps** `customfield_10042` (Environment + Build number + Precondition + numbered Steps)
  - **Actual Result** `customfield_10043`
  - **Expected Result** `customfield_10044`  · (Environment `customfield_10348` if used separately)
- **Attachments (screenshots/videos):** the Atlassian MCP has **no attachment tool**. Attach via the Jira REST API with an API token (Basic `email:token`): `POST https://breadfast.atlassian.net/rest/api/3/issue/{key}/attachments`, header `X-Atlassian-Token: no-check`, multipart `file`. (Token + creds: see memory.) Convert `.webm` test videos to `.mp4` before attaching.
- Tooling chain: Atlassian MCP `claude_ai_Atlassian_Rovo` for create/edit/comment; Figma frames via the REST exporter (the MCP get_screenshot rate-limits on a View seat); BrowserStack TM import via the UI (REST API is SSO-gated).

---

## 5. Test-Data Reclassification

When a reported defect turns out to be seeded test data:

```markdown
## Reclassification Notice
Original: Bug — [title]    New: Pass — Test Data

Reason: The values "[…]" on [screen] are seeded test data in the [test/staging]
environment, not production content. In a production-configured environment with real
[merchant/partner/content] data these would be replaced. Layout, functionality, and
structural elements passed inspection.

Production Verification Required: re-test against production or with real seeded data.
```

---

## 6. Environment Limitation (not an app bug)

```markdown
## Environment Limitation — Not An App Bug
Limitation: [name]   Observed In: BrowserStack App Automate   Error: [exact text/code]
Description: [what happens and why it's BrowserStack-specific]
Reproduction on Real Device: Does NOT reproduce on physical device / local simulator.
Impact: [test cases that cannot be completed]
Recommendation: [test on physical device / upgrade plan / etc.]
Classification: Environment limitation — no defect raised against the app.
```
