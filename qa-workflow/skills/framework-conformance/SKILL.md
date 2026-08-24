---
name: framework-conformance
description: Framework-conformance gate for generated automation (QA_PROCESS Phase 4, post-generation). Reviews the code THIS story authored inside the Breadfast Java framework against the framework's real conventions — the checks compile + checkstyle cannot make. Runs as a subagent, after automation-gen writes code and before the `automation` artifact is recorded.
metadata:
  type: task
  version: 1.2
  phase: Automation Generation (gate)
  workflow: [qa-implementation-validation, qa-full]
  runsAs: subagent
  consumes:
    sources: []
    artifacts: [automation]
    domains: []
  produces:
    artifacts: []
  methodology: docs/ai/automation/automation-generation.md
---

# framework-conformance (gate skill)

> **Why this exists.** On **B10-57393** the generated suite compiled clean, checkstyle passed and the
> tests ran — and the operator still had to reject three things: private helper methods in the test
> class, a `PerkFormData` fluent builder (the only one in the whole 663-file framework), and a new
> model type under `modals/`. **No build gate can catch any of those.** `mvn test-compile` proves the
> code is valid Java; it says nothing about whether it looks like code the framework's engineers
> wrote. That is this gate's only job. (Recorded in memory `java-framework-style`.)
>
> **v1.1 (2026-08-09) — why the gate itself needed widening.** A story ran this gate, was reported
> CONFORMING, and its suite passed end to end. A second review still found tests that were
> *structurally incapable of failing*, assertions satisfied by an empty read, a page-object method
> duplicating an existing one, a case whose BrowserStack title promised a check it never made, and a
> method family named after the story rather than the control. **Compiling, conforming and passing are
> three different things from being a test.** The additions are §B (per-method reuse, no story
> vocabulary), §E (every assertion can go red, title-to-assertion coverage, no route strings in tests),
> §F (fixture discovery over pinned ids) and §I (first-reading comprehension, formatting matches the
> file). Contract unchanged — still no artifact, still `automation/conformance-review.md`. The worked
> examples behind each rule live in
> [automation-generation.md](../../../docs/ai/automation/automation-generation.md) §9.13–9.15; this file
> stays rules-only.

**Produces no new artifact.** It writes `automation/conformance-review.md` into the story folder and
its blocking violations must be fixed **before** `automation` is recorded. The `automation` artifact
key, its contract and every upstream/downstream phase are unchanged.

## Scope

- **In scope:** only the classes, page objects, helpers, suite XML and config keys **this story
  authored or modified**. Establish that set from `git status` + `git diff --name-only` in the
  framework and from the story's `automation/framework-reference.md`.
- **Out of scope:** pre-existing framework code. If sibling code contradicts a rule below, that is a
  **catalog-drift note** for [java-framework.md](../../../docs/ai/automation/java-framework.md) — never
  a violation, and never something this gate "fixes". The framework tree is shared and carries other
  engineers' in-flight work ([automation-generation.md](../../../docs/ai/automation/automation-generation.md) §9.1).
- Commits nothing. Stages nothing.

## Grounding discipline — MANDATORY

This gate can manufacture false findings the same way defect filing can, so it carries the same
discipline as the Defect Grounding Gate ([bug-reporting.md](../../../docs/ai/bug-reporting.md) §1.1).
**A violation is not reportable until all three are written down:**

1. **The rule** — the exact standard breached, with its source (`automation-generation.md` §9.x /
   `coding-standards.md` §… / memory `java-framework-style` item n).
2. **The precedent** — the **nearest HUMAN-AUTHORED framework file, opened and read in this pass**,
   that establishes the convention, cited as `path:line`, **with the authorship check recorded**
   (`git log --format='%an' -- <path> | sort -u`). Recalling a convention is not establishing it, and
   a *generated* sibling is not a precedent — on B10-58603 this gate passed a class by comparing it
   against three generated siblings in its own package (contract §4.2). A claim of the form *"the
   framework never does X"* requires the **grep that proves it**, with the command recorded verbatim.
3. **The offence** — the generated `file:line`.

Per item record exactly one verdict: **PASS** · **VIOLATION (blocking)** · **ADVISORY** (style
nit, non-blocking) · **N/A** (with the reason). An item you did not actually check is `N/A — not
checked`, never `PASS`. Do not invent checks outside this list; do not review dimensions the story's
ACs never raised.

---

## Checklist

### A. Test class shape
- [ ] **No private methods of any kind in the test class.** Every test repeats the full page-object
      sequence inline with `//comment` phase banners (`//Navigation to …`, `//Login with admin
      credentials`, `//Validate …`). A test body is page-object calls plus `Assert.*` — nothing else.
      Precedent: `B10_56750_AddSectionToPerksTests`. (memory `java-framework-style` item 1)
- [ ] **No data constants and no input literals in the test class.** Values entered into the product
      come from the page object and are read back with `getEntered*()`. Expected-value strings inside
      an `Assert` are fine — those *are* the spec. (§9.9)
- [ ] Class-level annotation shape matches siblings (94 of 204 framework test classes carry a bare
      class-level `@Test`; both existing story classes do). Verify against the sibling, don't assume.
- [ ] `extends BaseTest`; page objects reached through `BaseTest` ThreadLocals — the test **never**
      constructs a page object.
- [ ] Package matches the surface under test (`cardService/adminPanel`, `mainAdminPortal/…`,
      `customerApp/androidNative/…`).
- [ ] Class name is `B10_<id>_<Feature>Tests`.

### B. New assets — necessity and placement
- [ ] Every new class is justified in `framework-reference.md` against the reuse ladder
      ([automation-generation.md](../../../docs/ai/automation/automation-generation.md) §4), with the
      search that proved no existing asset fits.
- [ ] **No new type under `modals/` that is not a page object.** Models belong in `models/`.
      (memory `java-framework-style` item 3)
- [ ] **No fluent builders.** Proof grep: `grep -rlnE "public [A-Z][A-Za-z]* with[A-Z]" src/main/java/`
      — if it returns only the story's own file, that is the tell.
- [ ] New page object extends the module's base (`BaseWebPage` / `BaseAndroidScreen` / iOS
      equivalent) with `PageFactory`, and is wired into `BaseTest` as a ThreadLocal inside the correct
      enablement block (mobile: per [mobile-native-framework.md](../../../docs/ai/automation/mobile-native-framework.md)).
- [ ] Composite flows live in the page object as plain methods taking `String` args — not in the test.
      (memory `java-framework-style` item 2)
- [ ] **Per-METHOD reuse check, not just per-class.** For every method added to an **existing** page
      object, the grep proving that class has no method already touching the same control is recorded in
      `framework-reference.md`. The class-level check above cannot see this — it passes whenever no new
      *class* was created, which is exactly when a duplicate reader gets added beside an existing one.
      (§9.13)
- [ ] **No story vocabulary in a shared page object.** Method, constant and locator-field names describe
      the control and the operation, never the scenario that prompted them. Tell: a name a *later* test
      would have to read against its own meaning. (§9.13)
- [ ] **No new method that merely wraps an already-implemented flow.** The framework's standard entry
      sequence is composed **inline in the test** from the existing helpers/screens
      (`registerUsingApi` → `countriesSelectionScreen.selectCountryAndProceed` →
      `testsExecutionHelper.handleMarketingABTestingForLandingPageIfPresent` →
      `landingScreen.pressAuthBtn` → `testsExecutionHelper.login` → assert home `isPageDisplayed()`),
      then continues with screen-specific steps. A wrapper duplicates shared logic, drifts from it, and
      hides the steps a reader expects to see. New helpers are for **genuinely new capability**, not for
      re-packaging existing steps — search for the existing one first (`login`, `register`,
      `scrollUntilACertainElementIsFound`, `swipeElementInDirection`, …). Prefer an existing active test
      account over creating a user when the scenario needs pre-existing state.
      (operator correction on B10-56652, memory `reuse-existing-flows` — an
      `openPayHomeForActiveCardHolder(...)` execution helper was rejected)

### C. Locators
- [ ] Every locator was **verified against the running app**, not inferred (§9.3).
- [ ] Preference order honoured: app contract (`formcontrolname`, component tag, route `href`) →
      app-authored semantic class → DOM-associated label → text scoped to a component with
      `translate()`. **Never** Angular build attributes (`_ngcontent-*`), bare `//table`, Bootstrap
      layout classes, or a positional index as the only discriminator.
- [ ] **Match count checked** for each locator; a >1 match is either fixed or the index is pinned with
      a stated reason.
- [ ] Class matched as a **whole token** — `contains(concat(' ', @class, ' '), ' close-icon ')`, not
      `contains(@class,'close')`. A loose `contains()` produced a **false PASS** on B10-56750 (§9.3).
- [ ] Angular Material labels use `contains(normalize-space(.), 'Label')` — **not** `=`. Material
      prefixes labels with U+00A0, which `normalize-space()` does not strip (§9.10).

### D. Synchronization — apply the *local* rule
> ⚠️ A blanket "never use `Thread.sleep`" ban would make generated code **diverge** from this
> framework: it contains **347** `Thread.sleep` calls, including API-client retry backoff
> (`helpers/apiClients/webApiClients/PaymentPanelApiClient.java:97`,
> `InventoryApiClient.java:1147`). Conformance means matching the neighbours, not importing a
> generic rule. The correct split:

- [ ] **UI synchronization** uses the framework's existing explicit-wait wrappers (`BaseWebPage`'s
      FluentWait). No `Thread.sleep` as a UI wait.
- [ ] **API retry/backoff** may use `Thread.sleep` **if** it mirrors the existing client idiom
      (named `RETRY_DELAY_MS`-style constant, inside a bounded retry loop).
- [ ] **No new waiting abstraction** introduced.
- [ ] Two inherited `BaseWebPage` helpers are unusable against Angular and must not be called:
      `selectTheDropDownList` (waits on the `<select>` value attribute, which Angular writes as
      `"1: 1"`) and `enterStringIntoTextField` on a **pre-filled** field (its `clear()` guard reads
      `getText()`, always `""` for an `<input>`, so it appends). (§9.4)
- [ ] `…IfDisplayed()` is used only on genuinely **optional** controls. On a required field it is a
      silent failure — wait, click, then confirm the selection registered (`mat-radio-checked`). (§9.10)

### E. Assertions
- [ ] TestNG `Assert` with a diagnostic message on every assertion.
- [ ] **No `SoftAssert`** — proof grep `grep -rn "SoftAssert" src --include="*.java"` returns **0** in
      this framework. Deviations are collected and asserted once with all of them in the message;
      `[DEFECT-EXPECTED]` assertions are ordered **last** in the test. (§9.8)
- [ ] **Vacuous-pass guard:** a collection's completeness is asserted **before** its order or
      contents. A loop over a short list that never executes is a pass that proves nothing. (§9.8)
- [ ] **Every assertion can go red — answer it in writing, per test.** For each `Assert` in the story
      class, state *what change in the product would fail this*. No answer ⇒ it is not a test.
      Three shapes to hunt specifically (§9.14):
      - **before/after on a value that cannot change** — a paged, capped, filtered or truncated read
        returns the same number either way. When the question is "does it exist / how many are there",
        ask the **system** (an API count); keep the screen for "is it rendered correctly".
      - **a negative assertion on a subject that may not exist** — `assertNotEquals(x, source)` and
        `assertFalse(list.contains(x))` are both satisfied by an empty read. Assert the subject was
        found first.
      - **a `!isEmpty()` standing in for a value comparison** — a smoke check wearing the title of a
        correctness one; it passes on the *wrong* value.
- [ ] **Title-to-assertion coverage: every noun in the BrowserStack case title has an assertion.**
      Walk the title word by word against the test body; a value the title says is *copied from* a
      source has that source's stored value as its oracle, not a non-empty check. (§9.14)
- [ ] Assertions read back through POM getters rather than restating input literals, so input and
      expectation cannot drift. (§9.9)
- [ ] **No route/URL strings, `substring`/date slicing, collection algebra or index arithmetic in the
      test class** — those are page-object concerns, exposed to the test as a named predicate or
      reader. Read the module's existing page object for the idiom it already uses. (§9.13)

### F. Data, config, re-runnability
- [ ] No hardcoded environment values, URLs, credentials or absolute paths. Config lives in
      `resources/environments/*.properties` → `Configs`, and paths use **forward slashes**
      (`java.util.Properties` treats `\` as an escape). (§9.6)
- [ ] Uniqueness comes from `testExecutionHelper.get().generateRandom7DigitNumber()` — not
      `System.currentTimeMillis()`.
- [ ] Uniqueness is applied to **every** locale field, not only English — a duplicate rule that
      matches on either name makes the suite pass once and fail forever. (§9.6) — **and to every
      business key on a record the environment cannot delete**, not only the name: several tests
      writing one shared literal spread it across records nothing can clean up. (§9.15)
- [ ] **Fixture selection: discovered by the property the assertion depends on, not pinned by id.**
      Use the module's existing finder idiom in its API client, and require *every* property the
      assertion reads. A hardcoded id is acceptable **only** when the record's *content* is the point,
      and then `framework-reference.md` states what makes it curated. **Never** pin a state-gated test
      to an id — a record whose state is derived from time changes state on its own and silently
      inverts the test. (§9.15, memory `shape-finder-must-require-assertion-property`)
- [ ] Fixture data is data the product could really receive: real-reading copy, internally consistent
      with the numbers the form enters, exact character count preserved for max-length cases. (§9.9)
- [ ] Binary fixtures are emitted by a checked-in generator script and resolved through a model
      (`models.PerkArtwork` precedent) — never hand-placed files or raw path strings. (§9.9)
- [ ] The suite is re-runnable and environment-agnostic; one-way doors (Sections and merchants cannot
      be deleted) are guarded by an existence check and **declared** in the story README. (§9.6, §9.11)

### G. Build and shared-tree hygiene
- [ ] `mvn -q test-compile` from the framework root is green (compile + checkstyle at `validate`).
- [ ] `checkstyle-suppressions.xml` `TypeName` suppression is scoped to `B10_\d+_\w+Tests\.java$`, not
      broadened.
- [ ] `git status` shows **only** files this story authored. No file that was already untracked or
      modified on arrival is staged — that is someone's in-flight work. (§9.1)
- [ ] Branch matches the hook-enforced `<year>/sprintQ<n>.<n>/<name>`.

### H. Traceability
- [ ] One automatable BrowserStack case → exactly one `@Test` method; `@TmsLink("TC-xxxx")` present;
      `description` is the BrowserStack title **verbatim**; method name is camelCase of that title. (§6)
- [ ] `groups` carries the story key plus the impact-analysis scope (`regression`/`smoke`); `@Tags`
      match the module convention.
- [ ] The `automation/README.md` traceability table is complete — non-automatable cases **declared
      with a reason**, never dropped.
- [ ] Every open Jira **bug subtask** on the story maps to a test, or is explicitly declared
      visual-only / not-automated. Cross-check against Jira, not against your own notes. (§9.8)

### J. Structural alignment against the human-authored references (v1.2)
- [ ] The 2–3 golden references named in `framework-reference.md` are **human-authored**, with the
      `git log` authorship check recorded (contract §4.2).
- [ ] The **measured comparison** from contract §7.1 is in the review: lines · public methods ·
      `@FindBy` count · `String …Selector` count · Javadoc lines, new class beside each reference.
      Being an outlier on any row is a blocking violation, not a note.
- [ ] **Locator-to-logic ratio** matches: locator-heavy, logic-light. More Javadoc lines than
      `@FindBy` fields ⇒ not conforming.
- [ ] **No reimplemented framework behaviour in a page object** — no `PointerInput`/`Sequence` scroll
      loops, swipe logic, scroll budgets or `MAX_*_SCROLLS`; scroll-to-element goes through
      `scrollUntilACertainElementIsFound(...)` with `getScrollableContentContainer()` + a
      selector-string accessor (mobile-native-framework.md §3; per-platform argument order respected).
- [ ] **No geometry** — no rect maths, viewport-bounds checks or centre/tolerance comparisons. If a
      requirement appears to need it, it is a visual check and does not belong in a page object.
- [ ] **No `getExpected*()` accessors.** Expected values are literals in the test.
- [ ] **No generic string-dispatch** over a fixed control set; one explicit `press<Control>Btn()` each.
- [ ] **No story narrative in production code** — no story history, investigation notes, evidence
      paths or decision logs in a page object's comments.
- [ ] For a mobile screen: `mobile-native-framework.md` §2/§3/§4 were read **this pass**, and the
      class follows them (individual `@FindBy` per fixed control with bilingual `or`; `String
      …Selector` only for templated lookups; `press*`/`is*Displayed()` naming; no fluent chaining).

### I. The last two questions
- [ ] **Read the nearest HUMAN-AUTHORED sibling class end-to-end and answer in writing:** would a
      framework engineer reading this diff be able to tell it was machine-generated? Name whatever
      gives it away. (A generated sibling cannot answer this question — §4.2 / grounding rule 2.)
- [ ] **Would a QA engineer who has never seen this story understand every method on first reading?**
      Name each one that fails, and move the mechanics behind a well-named page-object method. Nested
      `if`s, nested loops, streams, index arithmetic and duplicate fallback paths in a test body are
      the usual offenders. Genuine complexity is allowed — but it lives on the page object, **once**,
      with a comment saying what forced it. (§9.13)
- [ ] **Formatting matches the file being edited**, not a style brought in with the generator: its
      import block (no fully-qualified inline types when the file imports at the top), blank-line
      rhythm, comment density and separator comments. **Do not invent a banner or separator style**, and
      do not call one conventional without the grep that proves it — a convention found only in
      previously generated code is self-referential, not the framework's. (§9.13)

---

## Output — `<storyDir>/automation/conformance-review.md`

```markdown
# <TICKET> — Framework conformance review (framework-conformance@1.2)
Reviewed: <files this story authored, with LOC>   Framework branch: <branch>   Commit/worktree: <sha or "uncommitted">

## Verdict: CONFORMING | VIOLATIONS FOUND (n blocking, m advisory)

## Blocking violations
| # | Rule (source) | Precedent read (path:line) | Offence (file:line) | Fix applied |
|---|---|---|---|---|

## Advisory
| # | Note | file:line |

## Checklist results
A…I, one line per item: PASS / VIOLATION / ADVISORY / N/A (+ reason)

## Proof greps run
`<command>` → `<result>`

## Catalog drift found (not violations)
<sibling code contradicting a documented rule → proposed catalog update>
```

**Then:** fix every blocking violation, re-run `mvn -q test-compile`, and only then let
`automation-gen` record the artifact. If a blocking violation cannot be fixed without a framework
change, **propose it and get approval** — never restructure the framework unilaterally
([coding-standards.md](../../../docs/ai/automation/coding-standards.md) Framework Architecture Standard).

Anything learned here that generalises is promoted to
[automation-generation.md](../../../docs/ai/automation/automation-generation.md) §9 or the matching
catalog under the documentation-governance protocol (`CLAUDE.md` §6) — story-specific state goes to memory.
