# Visual Testing — Claude Code Operator Playbook (Phase 5)

> **Audience:** Claude Code acting as the **executor** of the QA lifecycle.
> **Role you adopt:** a **Senior Manual Testing Engineer** whose task is the **visual testing of a story** — comparing the application's rendered screens (web/mobile) against the story's Figma designs, within the story scope, and **raising a Design Bug for every confirmed visual deviation**.
> **Authority:** this playbook **operationalizes** [`QA_PROCESS.md`](../QA_PROCESS.md) **Phase 5** for the Claude-Code-as-operator path. It does **not** override it — on any methodology conflict, `QA_PROCESS.md` wins. The platform's deterministic pyramid engine is documented separately in [`OPERATIONS_MANUAL.md`](OPERATIONS_MANUAL.md) (legacy execution engine); this playbook is how the **AI operator** performs the same phase directly.

---

## 1. When this playbook applies

Use it whenever Claude Code performs Phase 5 visual testing **itself** (holistic comparison by reasoning over the design frame and the screenshot), rather than delegating to the platform pyramid engine. This is the **primary** path going forward (per `CLAUDE.md`: Claude Code is the primary execution environment; the QA Platform is legacy).

The deliverable is **not** a score. It is: **confirmed visual deviations → grouped → each raised as a Design Bug with annotated evidence**, feeding the full story testing process.

---

## 2. Inputs (all three are required before comparing)

| Input | Source | Purpose |
|---|---|---|
| **Story scope** | Jira — description, **AC, and comments** | Defines what is in-scope and what "expected" means. Comments can override AC. |
| **Figma design (Expected)** | Figma REST API — **per-story file key** from the Jira ticket's Figma URL (`/design/<fileKey>/…?node-id=<id>`), via `FigmaExporter.fileKeyFromUrl(storyUrl)` → `exportNodes` at `scale=2` | The Expected side. Real pixels, on disk. |
| **Application screens (Actual)** | Playwright (web) / BrowserStack + Appium (mobile) screenshots | The Actual side. |

> **Never reuse another story's Figma file key.** The file key is per-story; only the API token is shared. Always take the Figma link from **this** story's ticket.

Default scope: **iOS + Android, Arabic (ar/EG) + English (en/US)** — EN and AR are **different frames**, compared independently.

---

## 3. Operator workflow

```
0. Assemble inputs (scope + Figma frames + actual screenshots)
1. Identify the screen  → assign screenId
2. Pair Expected ↔ Actual  (re-baseline to the correct/newest Figma version)
3. Reconstruct multi-image Actual into one continuous page
4. Compare systematically across the validation dimensions (§5)
5. Classify each observed difference:  DEFECT  vs  DYNAMIC DATA / STATE DIFFERENCE (§6)
6. Record each confirmed defect with the finding schema (§7)
7. Group recurring defects by shared component/token (§8)
8. Generate annotated evidence — crop + red highlight + side-by-side (§9)
9. Raise a Design Bug per confirmed deviation (grouped where they share a root cause) (§10)
```

### 3.1 Identify & pair
- Assign a stable, semantic `screenId` (lowercase-kebab), consistent with the Screen Registry (`docs/ai/screens/`) when one exists.
- Pair the **correct Figma frame** for the screen's platform × locale with the **correct screenshot**. If no confident pair exists, record a **coverage gap** (not a defect) and move on.

### 3.2 Re-baseline to the correct Figma version — **mandatory**
Designs evolve. Before comparing, confirm you are pairing against the Figma version that matches the story scope (newest frame referenced by the ticket). A comparison against a stale design produces **false** missing/extra-component findings. If two design versions disagree, the one referenced by the current story scope wins; note the version you used.

### 3.3 Reconstruct multi-image Actual
A screen taller than the viewport is often captured as several screenshots. **Stitch them into one continuous page** before comparing, so section order, presence, and layout are judged against the whole screen — not per-fragment.

---

## 4. Deterministic-first spirit (for the AI operator)

The canon is *deterministic-first, AI only on the residual*. As the AI operator you are performing the comparison by judgement, but keep the same discipline:
- Decide differences by **exact, checkable observations** first (is the component present? does the copy match character-for-character? is the color the named token?), and only fall back to holistic judgement where exactness is impossible.
- Every finding must be **objective and reproducible from the two images** — never a UX opinion, never a redesign suggestion.
- The same two images must always yield the same findings.

### 4.1 Responsibility boundary — visual testing is business-agnostic
Visual testing is **design-conformance only**: the Figma baseline is the source of truth, and business
rules do **not** enter the comparison. A phase that compares against a baseline depends on the baseline,
not on the rules that produced it. Business knowledge flows *upstream* into the baseline:
- **Requirements / Figma Analysis / Test Design** decide *what* is correct and *which* Figma frame is
  expected for a given state (e.g. conditional sections per perk type).
- **Execution + screen identity** tag each screenshot with its `screenId` + state, so it pairs to the
  right expected frame.
- Visual testing then compares the **paired** Expected↔Actual using only the comparison rules
  (dynamic-content exclusions §6, tolerances).

If a needed expected state is missing, or the Figma copy itself is wrong, that is a **baseline gap** to
fix in Figma Analysis (or a **coverage gap** to report) — never a reason to inject domain knowledge into
the comparison. Consequence: the visual-testing skill declares **no** business `domains`.

---

## 5. Validation dimensions (systematic comparison)

Compare Expected vs Actual across **all** of these; each maps to a finding **Category**:

Layout · Component hierarchy · Visibility · Alignment · Spacing · Typography · Colors · Icons · Images · Borders · Corner radius · Buttons · Input fields · Copy/Text · Localization · States · Navigation elements · Missing components · Unexpected components.

Section presence and order (component tree) are checked before pixel-level detail — a missing section is reported once, not re-reported as many downstream layout/copy findings.

---

## 6. Dynamic Data / State — the exclusion rules (**core rule**)

The application contains dynamic data. You **MUST** distinguish real UI defects from data/state differences. The following are **NOT defects** — classify them as **`DYNAMIC DATA DIFFERENCE`** or **`STATE DIFFERENCE`** and **exclude them from the bug set**:

| Excluded (not a defect) | Class |
|---|---|
| Input values, user-entered text, selected dropdown values | STATE / DYNAMIC DATA |
| Empty vs populated fields; placeholder vs entered text | STATE |
| Uploaded images, avatars | STATE |
| Merchant names, IDs, coupon codes, account numbers, generated IDs | DYNAMIC DATA |
| Dates, counts, badge numbers | DYNAMIC DATA |
| User names, session info | DYNAMIC DATA |
| Version numbers, environment-specific values | DYNAMIC DATA |
| Focused-field / hover / open-dropdown capture states | STATE |
| Validation-driven control states (e.g. button enabled vs disabled by form completeness) | STATE (flag for verification, do not score) |
| Scrollbars, viewport artifacts | STATE |
| OS/browser artifacts ("Activate Windows" watermark, taskbar, third-party trust badges) | ENVIRONMENT ARTIFACT |

> **The one override:** a dynamic/state difference **becomes a defect** only when it **causes a layout or rendering issue** (e.g. a long dynamic string overflows its container, a populated value clips, an empty state breaks the layout). Then report the *layout/rendering* problem, not the data value.

**Do not annotate or raise bugs for excluded items.** List them in an "Excluded — Dynamic/State" section of the visual report so reviewers see they were considered and consciously set aside.

---

## 7. Finding record (per confirmed defect)

Aligned to `QA_PROCESS.md` §5.5. Every confirmed deviation records:

| Field | Notes |
|---|---|
| **Component** | The affected UI element (prefer the app test-id when known). |
| **Category** | One of the §5 dimensions. |
| **Severity** | `critical` / `major` / `minor` / `info` — by rule (§7.1). |
| **Expected** | What the Figma design specifies. |
| **Actual** | What the app renders. |
| **Root Cause** | Where identifiable, the **design token** (color/typography/spacing/radius) — not just the component it surfaced on. |
| **Recommendation** | Root-cause-level fix. |
| **Sources** | AC and/or design frame the finding is grounded in. |

### 7.1 Severity rules
- **Critical** — screen unusable / a required component or flow element absent such that the screen cannot fulfil its purpose; a localization entry point missing in a product that mandates that locale.
- **Major** — missing/duplicate required component; present-but-not-visible; copy **word/meaning/number/localized-string** mismatch; layout/style deviation ≥ 3× tolerance.
- **Minor** — layout/style deviation < 3× tolerance; ordering/hierarchy nits; **copy casing/spacing sub-class (below)**.
- **Info** — advisory only (e.g. whole-image pixel advisory); never a blocker.

### 7.2 Copy severity sub-class (L5) — *documented rule*
A **pure casing / whitespace / punctuation-spacing** difference is **minor**:
- `Card Perks` vs `Card perks`
- `ID*` vs `ID *` (asterisk spacing)
- `Insert Arabic Text Here` vs `Insert Arabic text here`

A difference that changes a **word, meaning, number, or localized string** is **major**. Missing/empty required copy remains **major**. (This sub-class is mirrored in `QA_PROCESS.md` Phase 5 L5.)

---

## 8. Grouping recurring defects
When the same root cause surfaces on multiple components (a shared string, a shared token, a repeated component), **group them into one finding / one bug** so the fix happens once. Example: an identical mis-cased helper label appearing on every bilingual section is **one** copy bug, not N.

---

## 9. Evidence generation (annotated, attachable)

Every **confirmed** finding gets visual evidence suitable for direct attachment to its Design Bug. **Only confirmed defects are annotated — never dynamic/state items.**

Format, per finding:
```
Expected (Figma)                 Actual (Annotated)
[Expected crop]      ⇄          [Actual crop with red highlight]
```
- **Expected crop** — the affected component from the Figma frame.
- **Actual crop** — the same component from the app, **annotated with a red rectangle / circle / arrow** on the exact issue.
- Optionally highlight the corresponding Expected area too.
- Beneath the pair: **Expected** and **Actual** captions.

Tooling: `automation/helpers/VisualComparisonHelper.js` produces the side-by-side and now supports **red annotation overlays** driven by a finding's bounding box (`compareScreenWithFindings` / `writeAnnotatedEvidence`). It stays dependency-free (self-contained HTML + SVG overlay); a PNG for Jira can be rasterized from the HTML via the existing Playwright `page`. See that file's header and §10.

---

## 10. Raise the Design Bug

For each confirmed deviation (grouped where they share a root cause), file a **Design Bug** in Jira following [`../bug-reporting.md`](../bug-reporting.md):
- Title, severity, and the finding record (§7) as the description.
- Attach the annotated side-by-side evidence (§9).
- Link the bug to the story.

The set of Design Bugs **is** the Phase 5 deliverable for the operator path — it feeds the full story testing process.

---

## 11. Deliberately out of scope (deferred)

- **No "Visual Health 0–100" score** and **no story-level numeric rollup** are produced by this playbook — deferred by decision. Phase 5's reporting stays qualitative (per-screen pass/deviation + findings), and any story-level quality rollup remains a Phase 6 concern in `QA_PROCESS.md` if/when re-enabled.

---

## 12. Cross-references
- Canonical methodology & exit gate: [`../QA_PROCESS.md`](../QA_PROCESS.md) Phase 5.
- Platform pyramid engine operation (legacy): [`OPERATIONS_MANUAL.md`](OPERATIONS_MANUAL.md).
- Figma fetch + visual-comparison method & fallbacks: [`../testing-process.md`](../testing-process.md) §4.
- Bug severity/priority + Jira template: [`../bug-reporting.md`](../bug-reporting.md).
- Screen Registry authoring: [`../screens/`](../screens/).
- Evidence helper: `automation/helpers/VisualComparisonHelper.js` · Figma export: `automation/helpers/FigmaExporter.js`.

---
*Claude-Code operator playbook for Phase 5 Visual Testing. Complements — does not override — `QA_PROCESS.md`.*
