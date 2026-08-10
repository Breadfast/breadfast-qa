---
name: automation-gen
description: Automation Generation (QA_PROCESS Phase 4). Generate automation for the approved test cases INSIDE the Breadfast Java framework — Java+Selenium for web, Java+Appium for mobile (Playwright only on explicit user request). Runs as a subagent.
metadata:
  type: task
  version: 2.1
  phase: Automation Generation
  workflow: [qa-implementation-validation]
  runsAs: subagent
  consumes:
    sources: []
    artifacts: [testcases]
    domains: []
  produces:
    artifacts: [automation]
  methodology: docs/ai/automation/automation-generation.md
---

# automation-gen (task skill)

> Thin wrapper. The **how** is in
> [`docs/ai/automation/automation-generation.md`](../../../docs/ai/automation/automation-generation.md)
> (canonical Java-framework contract) with
> [`java-framework.md`](../../../docs/ai/automation/java-framework.md),
> [`mobile-native-framework.md`](../../../docs/ai/automation/mobile-native-framework.md) (all new mobile),
> [`coding-standards.md`](../../../docs/ai/automation/coding-standards.md) and
> [`reusable-components.md`](../../../docs/ai/automation/reusable-components.md) (reuse-before-build).
> **v2.0 (2026-07-27):** implementation re-based from Playwright onto the Java framework —
> phase contract (consumes/produces) unchanged; upstream/downstream phases untouched.
> **v2.1 (2026-07-29):** two gates added **around** implementation — a **written plan before any code**
> (step 2.5) and a **framework-conformance review after it** (step 6,
> [framework-conformance](../framework-conformance/SKILL.md)). Rationale: on B10-57393 the suite
> compiled green, checkstyle passed and the tests ran, yet private test-class helpers, a fluent builder
> and a new model type under `modals/` all had to be rejected by hand — **no build gate can catch
> those.** Phase contract (consumes/produces `automation`) unchanged; no new artifact key.

## Technology routing
**Web → Java + Selenium. Mobile → Java + Appium (as-is, no migration).** Generated code lives
**inside the framework** (discovered per the contract §2 — `QA_FRAMEWORK_PATH` →
`automation/config/framework.js`, default `D:\projects`; if unresolved **ask, never block**).
Playwright is generated **only when the user explicitly requests it**.

## Non-negotiables (contract §9 — read it before generating)
Verify every locator against the **running** app, never infer one; prefer the app's own contract
(`formcontrolname`, component tags, route `href`) over text or position, and check each locator's
match count. Branch names are hook-enforced (`<year>/sprintQ<n>.<n>/<name>`), the framework tree is
**shared** so commit only your own files by path, and tests must be environment-agnostic,
re-runnable and flake-free. Two inherited `BaseWebPage` helpers are unusable against Angular
(`selectTheDropDownList`, `enterStringIntoTextField` on a pre-filled field) — see §9.4.

**The three things a green run does not prove** (rules + worked examples: contract §9.13–9.15):
1. **Readability.** The QA team maintains this code. A test body is a business flow — page-object calls
   and `Assert.*`. Route/URL strings, `substring` slicing, collection algebra, nested `if`s and nested
   loops belong behind a well-named page-object method. Name shared page-object methods for the
   **control and the operation**, never for the story that prompted them.
2. **Falsifiability.** For every assertion, answer *what change in the product turns this red?* A
   before/after read that is paged, capped or truncated cannot change; a negative assertion on a
   subject that may not exist always passes; a non-empty check passes on the wrong value. Every noun in
   the BrowserStack case title needs an assertion — the title is the contract.
3. **Fixture choice.** Discover the record by the property the assertion reads, using the module's
   existing finder idiom; never pin a state-gated test to a hardcoded id, because a record whose state
   is derived from time changes state on its own and inverts the test silently.

## Steps
1. **Resolve + learn the framework** (contract §2–3): catalogs first, framework docs, the target
   module's real code. The framework is the source of truth for style and structure.
2. **Map each approved case** to existing page objects/helpers/API clients (reuse-before-build);
   identify the minimal set of genuinely new classes.
2.5 **PLAN GATE — write it down before writing any code.** Answer the seven-question reuse ladder
   (contract §4) **in writing** into the story's `automation/framework-reference.md`: cases → assets
   **reused**, assets **extended**, assets **proposed new** (each with the search that proved nothing
   existing fits), files affected, framework patterns to follow. This file is produced today *after*
   the code — produce the plan half **first**, then fill in the outcome. **Surface every proposed new
   asset, and any framework change (a new `BaseTest` ThreadLocal, a checkstyle suppression, a new
   config key), for approval before authoring it** — that is cheaper than the B10-57393 rejection
   cycle, which discarded a fluent builder and a `modals/` model type after ~890 lines were written.
   The ladder is applied **per method as well as per class**: for every method you plan to add to an
   *existing* page object, record the grep proving that class has no method on the same control
   (§9.13 — this is where duplication actually enters, and the class-level check does not see it).
   State the **fixture strategy** here too: which record each case runs against, discovered by which
   property, and — for any id you plan to hardcode — what makes that record curated (§9.15).
3. **Author the story test class** `B10_<id>_<Feature>Tests extends BaseTest` in the matching module
   package — one `@Test` per automatable BrowserStack case, `@TmsLink("TC-xxxx")` binding,
   `description` = exact BrowserStack title verbatim; new page objects/screens per module contracts
   (mobile: BaseTest wiring per mobile-native-framework.md); story suite XML `b10-<id>-tests.xml`.
4. **Automate all generated cases**; declare non-automatable ones with a reason in the story
   `automation/README.md` traceability table; write `framework-reference.md` (reuse map).
5. **Validate:** `mvn -q test-compile` green (compile + checkstyle), then RUN the suite
   (`mvn test -Dtest=B10_<id>_<Feature>Tests` — `-DsuiteXmlFile` is ignored by this pom) and triage
   every failure into test bug / real product defect / vacuous pass. Open the auto-captured
   `resources/screenshots/` image first. Cross-check that each open Jira bug subtask on the story
   maps to a test. Never recompile while a run is in flight.
   ⚠️ **An all-green run is not evidence the tests work.** Before calling step 5 done, walk the
   assertions and name what would turn each one red (§9.14) — a suite has shipped fully green with
   tests that could not fail and assertions satisfied by an empty read.
6. **CONFORMANCE GATE — run [`framework-conformance`](../framework-conformance/SKILL.md) (subagent,
   now v1.1) before recording.** It reviews only the code this story authored against the framework's
   *real* conventions — the checks `mvn test-compile` and checkstyle cannot make (no private methods or
   data literals in the test class, no new type under `modals/`, no fluent builder, POM-owned fixture
   data, whole-token class matching, Material `contains()` labels, no `SoftAssert`, vacuous-pass guard,
   shared-tree hygiene) **plus, since v1.1, the three a green run hides**: per-method reuse and
   story-free naming (§B), every-assertion-can-go-red and title-to-assertion coverage (§E), fixture
   discovery over pinned ids (§F), and first-reading comprehension (§I). It writes
   `automation/conformance-review.md`, carries the same grounding
   discipline as the Defect Grounding Gate (rule + sibling precedent read this pass + `file:line`, or
   it is not reportable), and **produces no new artifact**. Fix every blocking violation, re-run
   `mvn -q test-compile`, then record.
   ⚠️ Do **not** import generic conformance rules — verify each against this framework first. A blanket
   `Thread.sleep` ban contradicts its **347** existing uses (API retry backoff), and "aggregate with
   soft assertions" contradicts its **0** `SoftAssert` usages. The local split is in the gate's §D/§E.

## Recording
```
node qa-workflow/bin/qa-cli.js record "<storyDir>" automation \
     --path automation/README.md --generator automation-gen@2.1 --derive-artifacts testcases
```
> **Lock-seam note:** the `2.0` → `2.1` bump is a generator-version change, so
> [qa-artifact-contract](../../../docs/ai/architecture/qa-artifact-contract.md) §5 step 4(d) marks
> already-recorded `automation` artifacts **stale** on the next reconcile. That is intended and
> honest — B10-56750 and B10-57393 never passed a conformance gate. Both were hand-corrected after
> generation, so they will surface as **conflicts** (step 5) and default to *keep edits, warn*: review
> them against the gate rather than regenerating.
Returns `{ testsAdded, reusedAssets, newClasses, gaps }` (compact).
