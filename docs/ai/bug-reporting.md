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

A finding becomes a **filed Defect only if it passes ALL of the checks below**. Otherwise it is a **report-only observation** (put it in notes / the report), never a Jira bug. Added after the B10-56337 certification run filed 4 false positives out of 7 (B10-57364/65/66/68) — each failed one of these; checks **7–8** were added after B10-56750 (2026-07-26) produced two more, both from over-trusting the Figma frame:

> **Apply this gate to your OWN findings, not just to inherited ones.** On B10-56750 the gate existed and
> was quoted in the report, yet a finding that plainly failed check 2 was still filed (B10-58196) — because
> the gate was never run against my own list before filing. Run it as an explicit pass over every candidate
> defect immediately before creating tickets.

1. **Source cited.** Name the exact thing it violates — a specific **AC**, a **Figma** element, or an **established business rule**. If you can't name it, it is not a defect — never invent an "ideal" expectation the spec never states (an extra dialog, a disabled state, a copy tweak). **But check the AC first: if the AC _does_ state it (e.g. "the Confirm button must be disabled until Package Number is entered" — a real B10-56337 AC), a deviation IS a valid defect.**
2. **Not test data.** Seeded/garbage values in the testing env — dropdown entries like `test`, `dsa`, `{{7*7}}`, `@SUM(...)`, duplicate demo branches — are not product defects. → *B10-57364*
3. **Reproducible.** Re-run the exact steps ≥ once more. A single non-repeating observation is unconfirmed/flaky, not a defect. → *B10-57366*
4. **Not a tooling artifact.** `pdf-parse` reverses/re-orders Arabic (RTL) numerals and shaping. A digit-order/RTL difference seen **only in extracted text** is not a defect unless confirmed by eyeballing the rendered PDF/screenshot. *(Note: a genuine RTL render defect confirmed visually IS valid — cf. B10-57367.)*
5. **No cross-language / derived-field false mismatches.** Don't assert an English UI label must equal an Arabic stored value (a correct branch **code** = valid mapping, regardless of the Arabic name → *B10-57365*). Don't flag derived fields as inconsistent with a display label (Gender is derived from the **Egyptian NID 13th digit**: odd = male, even = female → *B10-57368*).
6. **One defect = one problem.** Never bundle two distinct issues (or a strong issue + a weak one) into one bug — split them. → *B10-57363* bundled a valid AC-based disabled-button defect with a flaky "no-op" observation. (Reinforces the one-defect-per-bug standard.)
7. **Is the design actually the AUTHORITY for this thing?** A Figma frame is authoritative for *layout,
   copy, states and affordances*. It is **not** authoritative for **user-created content** or for
   **page chrome it merely happens to draw**. Ask "who owns this value?" before filing. Added after
   **B10-56750** produced two findings from exactly this error — both raised against the design and both
   wrong:
   - **Filed and retracted (B10-58196):** the design's Section dropdown draws `Food & Beverage` /
     `Fitness`. Those are **user-created sections**, not a seeded set — an absent one is not a fault, it
     can just be added. Diffing the live list against the frame's list produced a defect out of ordinary
     content. *(Also fails check 2 above.)*
   - **Nearly filed (F-09):** the same frames show an `عربي` locale toggle in the header. The card panel
     has **no Arabic UI at all** and none is in scope, so the toggle is mock chrome — not a missing
     feature. Withdrawn before filing.

   **Test:** if the "expected" value is something a user or admin creates, configures, or seeds at will,
   the design cannot make its absence a defect. If the element is outside the story's ACs and is only
   present as surrounding page furniture, confirm it is in scope before treating it as a requirement.
8. **Verify the observation is real before it is a finding — transient and lazily-rendered state lies.**
   A toast that auto-dismisses, an in-flight spinner lasting ~400 ms, a `placeholder` attribute that is
   `null` until the field is focused, a screenshot taken while scrolled away from the element: each of
   these will "prove" something is missing when it is present. **B10-56750** produced a false
   "no success toast" finding (viewport scrolled + toast expired) and a false "Arabic placeholder is
   missing" finding (Material floating label removes the attribute while unfocused). Poll for transient
   state, focus before reading focus-dependent attributes, and re-check a negative before reporting it.
   See [automation/playwright-framework.md](automation/playwright-framework.md) *Authoring traps*.

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

## 4. Jira Bug Structure — B10 (Breadfast 1.0)

> **This is the ONLY bug shape for B10. It is not a template to adapt — every field below has a place and
> the bug is wrong if any of them is missing.** Verified against the reference set
> **B10-58191 … B10-58197** (B10-56750, filed 2026-07-27) and re-verified 2026-07-28.
>
> **Revision 2026-07-28 (operator decision):** the **`description` field is NO LONGER USED — leave it
> empty.** Everything a bug needs lives in the title plus the three template fields. This *supersedes* the
> earlier narrative markdown template, which used to put a prose report in `description`; that block has
> been removed from this document so it cannot be copied again. Rationale: the report was being written
> twice, and a description-shaped bug hides the fields the squad actually reads.
>
> **Why this section is so blunt:** on **B10-56652 (2026-07-28) five bugs were filed with the whole report
> crammed into `description`, no template fields, no Severity/Environment, and zero attachments** — all five
> were rejected. The filer had cited this document without reading it. **Use the script in §4.3; do not
> hand-assemble a bug.**

### 4.1 The five parts of a B10 bug

**1 · Issue type + parent.** `Bug` is **issue type `10084`, a SUB-TASK** → always pass
`parent` = the story key. Never a standalone issue.

**2 · Title** — `[System Testing][<combo>] <specific statement of the actual wrong behaviour>`
- `[System Testing]` is the phase. `[<combo>]` is the platform/locale: `web`, `ios-en`, `ios-ar`,
  `android-en`, `android-ar`.
- The title must **describe the defect well enough to be understood on its own**, naming the screen/element
  and the wrong result. Quote the on-screen string where it helps.
- ✅ `[System Testing][web] "Add section" modal has no X close icon to dismiss it`
- ✅ `[System Testing][web] Section list is not ordered alphabetically after Breadfast`
- ❌ `[System Testing][web] Modal issue` · ❌ `[Android][Pay home] …` (wrong prefix shape)
- **Never put AC numbers in the title or in ANY field** — ACs get renumbered and reworded.

**3 · The three template fields** — plain-text `textarea` custom fields. **Pass STRINGS, not ADF.**
Preserve layout with `\n`. *(Shape corrected by the operator 2026-07-28 — this supersedes the earlier,
noisier Environment block.)*

| Field | Id | Contents |
|---|---|---|
| **Steps** | `customfield_10042` | `Environment:` block (**mobile only**) → optional `Language :` → optional `Precondition:` → `Steps:` **numbered**, one action per line, ending with the observation step |
| **Actual Result** | `customfield_10043` | What happened, with the concrete observed values / exact strings. **Short and factual.** |
| **Expected Result** | `customfield_10044` | What should happen + the authority — `Ref: design node <id>`, the AC's wording (not its number), or the named business rule |

**The Environment block — versions and build numbers, nothing else:**

```
Environment:
IOS : Version: 2026.31.0
Build Number: 11084

Android : Version: 2026.31.0
Build Number: 1057
```

- **WEB bugs carry NO Environment block at all.** Omit it entirely.
- **No** `Device:`, `Locale:`, `Account:`, BrowserStack session id or `bs://` app id. Those belong in the
  story's execution report, not in the bug.
- **`Language : Arabic`** goes after the Environment block **only when the bug is locale-specific**. Never on
  an English-only bug.
- **`Precondition:` — OMIT IT unless it is genuinely mandatory to reproduce.** Most bugs do not need one; a
  precondition that merely restates "be logged in" is noise.

**Actual / Expected must read as a senior QA engineer wrote them — not as generated prose.**
State the fact, give the number or the exact string, cite the authority, stop. Specifically avoid: describing
your own methodology (*“measured from the live accessibility tree, so these are exact frames rather than
estimates”*), hedging (*“plausibly”*, *“arguably”*, *“this may well be”*), essay connectives (*“furthermore”*,
*“moreover”*, *“in other words”*), and *“Note for triage:”* paragraphs. If a caveat genuinely matters, it is
**one short line**. The filer in §4.3 flags all of these.

Good:
```
Actual    Only 24 pt of the third perk card is visible — 15% of the card.
          Card width 163 pt, gutter 12 pt. On a 390 pt screen the third card starts at x=366.
Expected  Around 14 pt of the next card is visible (~8%) — a subtle peek, not a partially-shown card.
          Ref: design node 9163-7909.
```

**4 · Fields — every one of these, every time.** (`Testing Phase`, `Platform`, `Squad name` and
`Components` are **required by the schema**; the rest are required by this standard.)

| Field | Id | Allowed values / rule |
|---|---|---|
| Severity | `customfield_10076` | `Blocker` \| `Critical` \| `Major` \| `Minor` \| `Enhancement` |
| Priority | `priority` | `Highest` \| `High` \| `Medium` \| `Low` — map: Blocker/Critical→`Highest`/`High`, Major→`High`, Minor→`Medium`, cosmetic→`Low`. **No "P2"-style values.** |
| **Testing Phase** | `customfield_10078` | `System Testing` \| `Regression Testing` \| `Sanity Testing` \| `PM Review` |
| **Bug type** | `customfield_10079` | `Functional` \| `UI/UX` \| `Change Request ` \| `Performance` |
| Environment | `customfield_10348` | `KSA` \| `Egypt` \| `Both (KSA, Egypt)` |
| Platform | `customfield_10467` | `iOS` \| `Android` \| `Huawei` \| `Android/Huawei` \| `Both (iOS/Android)` \| `BE` \| `FE` \| `FE/BE` \| `None` |
| Squad name | `customfield_10183` | array, e.g. `[{value:"Card Core"}]` / `[{value:"Card Ops Squad"}]` |
| Components | `components` | the surface, e.g. `Bcard Dashboard` (card panel UI), `Bcard Cst app` (customer app), `Bcard BE` (backend). **Do not use a BE component for a UI defect.** |
| Labels | `labels` | `["ai-created","qa-found"]` + any specific tag |
| **Description** | `description` | **LEAVE EMPTY.** (Operator decision 2026-07-28.) |

**5 · Attachments — MANDATORY on every bug, before the bug is announced anywhere.**

| # | File | Naming |
|---|---|---|
| 1 | the **actual** screenshot showing the wrong result | `actual-<slug>.png` |
| 2 | the **design / expected** frame it is compared against (when a design exists) | `design-<slug>.png` |
| 3 | a **short screen recording** of the failing flow | `F-0N-<slug>.mp4` |

Reference set for shape: `actual-add-section-modal-no-X.png`, `design-add-section-modal-with-X.png`,
`F-01-no-x-close-icon.mp4`. **Never** `image1.png` / `video.webm`.

- **The Atlassian MCP cannot attach files.** Use the REST API:
  `POST https://breadfast.atlassian.net/rest/api/3/issue/{key}/attachments`,
  Basic `email:token`, header **`X-Atlassian-Token: no-check`**, multipart field name **`file`**.
- **Set the real `Content-Type` per part** (`image/png`, `video/mp4`). An untyped part uploads as
  `application/octet-stream` and Jira shows an opaque download instead of an **inline, playable preview**.
- Convert `.webm` → `.mp4` before attaching.
- Prefer a **recording** over a lone screenshot when the defect is a multi-step flow or a state/DB
  transition a single frame cannot convey. For BrowserStack runs the session video is a legitimate source.

### 4.2 Golden rules

- **One defect = one bug.** Never bundle ("Issue A / Issue B") — split.
- **Specific Actual & Expected**, quoting exact on-screen strings.
- **Severity/Priority live in the FIELDS only** — never restate them in any text field.
- For mobile bugs the affected **platform(s) and locale(s)** must be explicit (the `[<combo>]` title prefix
  plus the Platform field). Platform-specific failures read e.g. "Android only".
- **Use REST v2** (`/rest/api/2/issue`) for create/update — v3 demands ADF for `description`, v2 accepts
  plain strings and the textarea fields behave identically. (The MCP `createJiraIssue` also works for
  create, but it cannot attach — so the script below is preferred end to end.)

### 4.3 File it with the script, not by hand

[`automation/file_jira_bug.js`](../../automation/file_jira_bug.js) encodes everything above: it validates
the option values and the required set **before** calling Jira, creates the sub-task with all fields,
uploads each attachment with the correct MIME type, then **re-reads the created issue and prints what
actually landed** (fields + attachment list) so a silent omission cannot pass.

```
node automation/file_jira_bug.js --spec <bug.json>        # file it
node automation/file_jira_bug.js --spec <bug.json> --dry  # validate + preview, no write
node automation/file_jira_bug.js --verify B10-58191       # audit an existing bug against this standard
```

**Always `--dry` first, and always read the verify output before telling anyone the bug is filed.**

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
