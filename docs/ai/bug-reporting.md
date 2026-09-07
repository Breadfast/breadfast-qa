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

**Rejecting a candidate closes the CLAIM, not the REQUIREMENT.** These eight checks test whether *this
finding, as stated* is filable. A candidate can fail check 3 or 4 because the measurement, the fixture,
the capture or the route was wrong — none of which says the underlying requirement is met. So a rejection
records **what was disproved, what remains unresolved, and who owns the surviving question**; it never
records "the requirement is satisfied", and it never counts as verification.
Record shape: [`visual-testing/CLAUDE_CODE_OPERATOR.md`](visual-testing/CLAUDE_CODE_OPERATOR.md) §7.3 ·
rule: [`QA_PROCESS.md`](QA_PROCESS.md) §5.7. *(Added after B10-57764 V-01: a false colour claim was
correctly rejected, its true substance was never re-tested, and the rejection read as settled for four
days until the operator found the defect by hand — B10-59276.)*

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

### 4.0a Voice — MANDATORY. Every bug reads as the operator wrote it (standing rule, 2026-09-07)

**Before creating OR updating any bug, invoke the `/humanizer:humanizer` skill over the Title, Steps,
Actual and Expected, and write them in the operator's own style.** This is not a preference about tone:
these bugs reach developers as **his** reports, and a ticket that reads machine-written is read
differently from one that reads like the QA lead wrote it, whatever evidence is attached. Applies to
every bug, functional and visual, on every story, with no exception.

Added after B10-59822 and B10-59823 were filed in plainly machine-written prose (rgb values, an
ink-ratio derivation, "the component library's default styling") and had to be rewritten. B10-59719,
B10-59720 and B10-59826 were rewritten in the same pass.

#### The format, learned from bugs he reported himself
Source: B10-50328, B10-48678, B10-48218, B10-46923, B10-46653, B10-46368.

- **Title** — the wrong behaviour, stated plainly. No AC numbers, no internal vocabulary, no severity
  words. *"Passcode is not displayed when opening saved cards screen then go back to home screen."*
- **Steps** — a `Builds :` / `Environment :` block for **mobile only** (version + build number), then
  `Steps :`, then `1-`, `2-`, `3-` with **no space after the dash**. First step capitalised
  (`1-Open the card panel and login with an ops user`), the rest lowercase imperatives (`navigate to`,
  `click on "Edit"`), UI labels in double quotes, and the **last step is the observation**:
  `check the behavior` / `check the display of X` / `check the time format`.
- **Actual** — short and direct, usually a restatement of the title. No measurements, no derivations,
  no methodology, no "note for triage". Aim for **under ~50 words**; the filer warns past 90 and it
  should rarely come close.
- **Expected** — one line, always using **should**. *"Passcode screen should be displayed normally."*
- He writes a space before some punctuation (`Steps :`, `X , Y`). Keep it; it is his rhythm.
- **Never imitate his typos.** Match brevity, structure and word choice only.

#### Worked example (B10-59823, before and after)

| | |
|---|---|
| **Filed as** | *"Frequency renders at font-weight 400 and 14px — identical to the Starts at and Ends at labels beneath it… at equal weight the two strings give an ink ratio of 1.07 and the same median stem width…"* |
| **Rewritten** | Actual: `"Frequency" label is displayed as a normal text , same as "Starts at" and "Ends at" labels below it` · Expected: `"Frequency" label should be displayed in bold as in the design` |

#### The measurements still matter — they just do not go in the ticket
Hex and rgb values, computed styles, ratios, stem widths and probe output belong in
`visual-findings.md` and `defects.md`, beside the grounding gate that used them. The **ticket** carries
the observable fact plus the attachments. `file_jira_bug.js` warns when `actual`/`expected` contains an
`rgb()`, a hex colour, a `font-weight`, an ink ratio or a median stem, for exactly this reason.

#### Correcting a bug that is already filed
Use the update path — **never refile**, which loses the key, the comments and the attachments:

```
node automation/file_jira_bug.js --spec <bug.json> --update <ISSUE-KEY> [--attach]
```

It validates the spec exactly as a create does, rewrites summary + the three template fields, adds any
listed attachment that is not already there, and re-reads the issue to show what landed.

### 4.0b Evidence — MANDATORY. Every screenshot and every recording carries an INDICATOR

**Mark where the issue is. On every still, and in the video.** Operator instruction 2026-09-07, said
after two rounds of evidence that showed a screen without saying what in it to look at:

- B10-59719's first recording *"does not specify what actually happens"*, and its stills showed a form
  full of dates with nothing distinguishing the value entered from the value displayed. One of them,
  named *"window grows on every save"*, was the locations **list** with a success toast and contained
  no closure at all.
- B10-59832's stills carried a caption but no mark, so the reader had to locate the success message and
  the empty section unaided.

Use [`automation/visual/annotate.js`](../../automation/visual/annotate.js), which annotates the **live
page**, so one call covers the screenshot and the video frame:

| Call | Use |
|---|---|
| `mark(page, sel, {label})` | red box on the wrong element, label placed on whichever side has room |
| `markEmpty(page, sel, label)` | a defect of **absence** — dashed box on the container, label saying what is missing |
| `pointer(page, sel)` | a real `mouse.move` **and** a drawn cursor: Playwright's video renders no cursor, so a hover is otherwise invisible |
| `caption(page, text)` | the step, as a strip at the **top** (a bottom strip covers anything that opens downward) |
| `addPageRoom(page)` | temporary bottom room so a control at the end of the page can be raised and its picker still fits |

For a **before/after** defect, one labelled image beats two crops:
[`automation/visual/compose_side_by_side.js`](../../automation/visual/compose_side_by_side.js).

**Rules that made the difference in practice:**
1. **A drift or a change needs a before/after pair on the same element.** One frame of a form shows a
   date; nothing in it says whether that date is the one that was saved.
2. **Check the mark landed.** `mark` reports rather than throws. Collect the results and **fail the
   capture run** when one is missing — on B10-59832 the success-message selector matched nothing
   (`[class*=alert]` against an Angular Material `mat-snack-bar-container`) and the still was attached
   with no indicator on the only thing it was about.
3. **Never let an annotation cover the evidence.** A caption at the bottom hid the calendar day it
   named; a label pinned above hid the weekday header. Place to the side by default.
4. **Values in a label are read out of the page**, never typed in from an expectation, and every
   overlay carries a `__qa_` id so it cannot be mistaken for product UI.
5. **Jira does not replace an attachment.** A re-uploaded same name sits beside the old one — delete
   the superseded files, or the ticket carries both evidence sets, including the one you retracted.

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
| **Steps** | `customfield_10042` | `Environment:` block (**mobile only**) → optional `Language :` → optional `Precondition:` → `Steps :` then `1-`, `2-`, `3-` (**no space after the dash**), one action per line, ending with the observation step (`check the behavior` / `check the display of X`) |
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
