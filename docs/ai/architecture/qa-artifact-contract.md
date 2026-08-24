# QA Artifact Contract — Reuse, Freshness & Regeneration

> The contract between **Workflow 1 (Pre-Development)** and **Workflow 2 (Post-Development)**.
> **Workflow 3 (`qa-full`)** runs both in one pass and is bound by this contract unchanged: it stamps each
> artifact with its **producing skill's** generator, so its output is indistinguishable from a W1+W2 pair
> and reconciles identically on any later run. (It replaces W2's *Reconcile* with a continuity assertion —
> same `reconcile` call, expected to return all-`reuse`.)
> Machine schema: [`qa-state.schema.json`](qa-state.schema.json). Decision context: [`adr-001-qa-workflow-independent-plugin-aligned.md`](adr-001-qa-workflow-independent-plugin-aligned.md).
> Model: treat QA artifacts like a **build system** — Workflow 1 produces artifacts + records the *fingerprint of the inputs they were derived from*; Workflow 2 recomputes fingerprints, invalidates only what changed, and regenerates the minimal set plus anything downstream.

---

## 1. Reusable artifacts (Workflow 1 outputs = the baseline)

All under the per-story folder `D:\breadfast-qa\<TICKET>\`.

| Artifact key | Path | Produced by (skill) | Direct source | Depends on (upstream artifacts) |
|---|---|---|---|---|
| `requirements` | `requirements-analysis/requirements.md` | `story-analysis` | Jira (desc+AC+comments) | — |
| `figma-analysis` | `figma-analysis/analysis.md` (+ `frames/*.png`, `extract/*.json`) | `figma-analysis` | Figma (frames) | — |
| `clarifications` | `clarification/clarifications.md` | `clarification` (grill-me) | Jira (AC+comments) | requirements, figma-analysis |
| `impact` | `impact-analysis/impact.md` | `impact-analysis` | — | requirements, figma-analysis |
| `exploratory-notes` **(conditional)** | `evidence/exploratory-notes.md` | `exploratory-testing` (Mode A) | the running app | requirements, figma-analysis, impact |
| `hls` | `hls/hls.md` (+ Jira checklist publish record) | `test-design` (Phase A) | — | requirements, figma-analysis, impact, clarifications |
| `testcases` | `testcases/testcases.csv` (+ `coverage-notes.md`) | `test-design` (Phase B) | — | hls, requirements, impact |
| `testcase-review` | `testcases/review.md` | `testcase-review` | — | testcases |
| `browserstack-import` | `browserstack/import-report.md` | `browserstack-mgmt` (Mode A) | — | testcase-review |

> **The baseline grew 5 → 8 on 2026-08-09.** Defining coverage is a **pre-development** act: everything a
> complete suite needs (AC map, design, impact, clarifications, and the optional exploratory analysis)
> exists before implementation. So `testcases`, its **review gate**, and the **import** are Workflow 1
> outputs, and Workflow 2 **reconciles** them (§5) rather than regenerating a suite.
> **Shift left = establish the coverage baseline · Validate = reconcile and maintain it.**

**Conditional (optional) baseline members** — reconciled only once a record exists, so a story that
legitimately never needed them never reports a permanently-stale key
(`BASELINE_OPTIONAL` in [`dag.js`](../../../qa-workflow/lib/freshness/dag.js)):
`exploratory-notes` (W1 Mode A / W2 Mode B) and `testcase-reconciliation` (W2 only).

Workflow 2 outputs **may** also be tracked (optional, same record shape): `testcase-reconciliation`, `automation`, `execution`, `visual-findings`, `defects`, `qa-summary`. These are not part of the reuse baseline but benefit from the same checksum/staleness bookkeeping.

## 2. Dependency DAG

```
        sources.jira ───────► requirements ──────────────┐
                     └──────► clarifications ◄──┐         ├──► impact ──┐
                                                │         │             ├──► hls ──► testcases
        sources.figma ─────► figma-analysis ────┴─────────┘─────────────┘      ┌──────────┘
                                                                               │
        (exploratory-notes ····context····► testcases)                         ▼
                                                              testcase-review ──► browserstack-import
                                                                     └──────────► automation ◄─ testcases
```
- `requirements ← jira`
- `figma-analysis ← figma`
- `clarifications ← jira (AC/comments)`  *(requirements + figma-analysis are **context**, not cascade edges — they inform clarification but do not invalidate it; its only staleness trigger is a **material** jira change, so regenerating requirements does not needlessly re-open the interactive gate)*
- `impact ← requirements, figma-analysis`
- `exploratory-notes ← requirements, figma-analysis, impact`  *(optional)*
- `hls ← requirements, figma-analysis, impact, clarifications`
- `testcases ← hls, requirements, impact`  *(**context:** clarifications, exploratory-notes — an exploratory charter that is re-run must not tear up an approved, imported suite; it informs case design, it does not define it)*
- `testcase-review ← testcases`
- `browserstack-import ← testcase-review`  *(**not** `testcases` — nothing reaches the test-management system ahead of the review gate)*

Cascade: a change to `jira` regenerates `requirements` → `impact` → `hls` → `testcases` → `testcase-review` → `browserstack-import` (and `clarifications` via the materiality gate, §5). A change to `figma` regenerates `figma-analysis` → `impact`, `hls`, the suite below it, and the visual baseline. **A changed AC now reaches the imported suite** instead of stopping at the HLS.

**Workflow-2 outputs extend the same DAG** (when tracked): `testcase-reconciliation ← testcases`; `automation ← testcases`; `visual-findings ← figma-analysis`; `defects ← execution, visual-findings`; `qa-summary ← execution, visual-findings, defects`. So a regenerated baseline artifact cascades into WF2 outputs exactly as within the baseline.

### 2.1 The two gates on the coverage path (mechanical, `qa-cli.js`)

| Gate | Mechanism | Escape hatch |
|---|---|---|
| **Review** — un-reviewed cases must not be imported | `PHASE_DEPS['browserstack-import'] = 'testcase-review'`: recording the import dies unless the review artifact is `complete` | `defer <dir> testcase-review --by … --reason …` |
| **Approval** — reviewing is not approving | `APPROVAL_DEPS`: recording the import dies unless `approvals.testcases` exists. `approve <dir> testcases --by "<operator>"` also **snapshots** the approved CSV + checksum | same deferral |
| **Traceability** — validation may change the suite, never silently | `complete-check` fails when an approved artifact's checksum drifted and no `testcase-reconciliation` is recorded | record the reconciliation (that *is* the fix) |

The reviewing agent must not run `approve` on its own authority. The gate exists because an imported
suite is read by the squad, by `@TmsLink` and by every later run as the agreed definition of coverage.

**Domain recording:** when an artifact declares `domains: [...]`, each listed domain's fingerprint MUST be present in the top-level `domains` map — that is what rule (e) compares against. An artifact may only consume domains that are recorded.

## 3. The validity ledger — `<TICKET>/qa-state.json`

One state file per story records **current known source fingerprints** and **one record per artifact** (path, status, generator@version, the fingerprints it was `derivedFrom`, checksum, consumed domains). Full field reference: §6. Machine schema: [`qa-state.schema.json`](qa-state.schema.json).

## 4. Fingerprints (how inputs are identified)

| Source | Cheap freshness signal | Content fingerprint |
|---|---|---|
| **Jira** | issue `updated` timestamp | `sha256(normalize(summary + description + AC field + comments[]))` — `fieldsHashed` records exactly which fields were included |
| **Figma** | `GET /v1/files/<key>?depth=1` → `lastModified` + `version` (one cheap call, no frame export) | `framesHash` = `sha256` over exported frame PNGs (computed only when frames are (re)exported) |
| **Domain** | domain skill `version:` | `sha256` of the domain skill content |
| **Generator** | skill `version:` in `qa-workflow/skills/<name>/SKILL.md` | — (compared by `<skill>@<major.minor>`) |
| **Artifact** | — | `checksum` = `sha256` of the artifact file (detects on-disk drift/tamper) |

**Both are read live by [`lib/freshness/generators.js`](../../../qa-workflow/lib/freshness/generators.js)**
(`loadGenerators` maps each skill's `produces.artifacts` → `<name>@<version>`; `loadDomains` fingerprints
`qa-workflow/domains/<id>/SKILL.md`). `record --domains <ids>` writes the consumed domains into the
top-level `domains` map, which is what rule (e) compares against. *(Wired 2026-08-09. Until then
`opts.generators` was never populated and `reconcile` was called with a hardcoded `domains: {}`, so
rules (d) and (e) — two of the five — were implemented, unit-tested and **inert**: a skill `version:`
bump and a business-rule change each invalidated nothing.)*

> **The domain fingerprint is of the domain SKILL, not the `docs/ai/business/**` files it wraps** — so
> editing a business doc invalidates nothing until the domain's `version:` is bumped. **That bump is the
> lock.** `qa-cli.js status` reports when the wrapped sources moved and the version did not, so the
> discipline is visible rather than assumed.

Normalization for Jira hashing: trim, collapse whitespace, strip volatile markup, sort comments by id — so cosmetic re-renders don't produce false changes.

**The figma fingerprint** (used in `derivedFrom.figma` and staleness rule b) = `framesHash` when available, else `sha256(version + sorted(nodeIds))`. Prefer `framesHash`: Figma `version` increments on *any* edit to the file, so a version-only comparison regenerates `figma-analysis` even when the specific compared frames are unchanged (false positive). `lastModified`/`version` are the **cheap first-pass** signal (one `depth=1` call); when they differ, re-export the frames and compare `framesHash` to **confirm** the compared frames actually changed before regenerating. If per-node `lastModified` is available, prefer node-level comparison to scope invalidation to the affected frames only.

## 5. Freshness algorithm — `Reconcile(storyDir)`

Workflow 2's first step. Reuses everything valid; regenerates only the stale set. The default reconciled
set is the **eight-key baseline** plus any conditional artifact this story produced.

```
1. Load qa-state.json (or treat all artifacts as missing if absent).
2. Fetch current source signals:
   - jira: updated + hash   (Atlassian MCP)
   - figma: lastModified + version   (Figma REST, depth=1)
   - domains: version per consumed domain
3. Detect HUMAN EDITS first (checksum drift, without a source change):
   - If the file's current checksum != stored checksum AND no source in its derivedFrom changed,
     the artifact was hand-edited after generation. Treat the human edit as AUTHORITATIVE:
     set status = "modified", RE-BASELINE the stored checksum, and REUSE the file (never overwrite).
4. Mark an artifact STALE if ANY:
   (a) missing OR status in {missing, partial, stale} OR file absent on disk
       (status "complete" and "modified" are reusable)
   (b) a source in its derivedFrom changed              → (Jira changed / Figma changed)
   (c) an upstream artifact it depends on is stale       → (transitive cascade)
   (d) generator version > stored generator version      → (methodology refined; = the `lock` seam)
   (e) a consumed domain's fingerprint changed           → (business rules changed)
5. Handle CONFLICTS (human edit + source change on the same artifact):
   - If a "modified" artifact is ALSO marked stale by (b)/(c)/(d)/(e), do NOT silently regenerate.
     Surface a conflict: report expected regeneration vs the human edit and let the operator choose
     (regenerate and lose edits · keep edits and accept staleness · merge). Default = keep edits, warn.
6. Order the remaining stale set topologically (DAG §2), excluding conflicts pending a decision.
7. Regenerate each stale artifact by invoking its skill (as a subagent, returning the artifact by path).
8. Validate qa-state.json against qa-state.schema.json, then persist with refreshed fingerprints,
   generator versions, checksums, and updatedAt.
9. Reuse every non-stale artifact (including "complete" and "modified") as-is.
```

> **Clarifications materiality gate (step 4 exception):** a Jira change flags `requirements`/`hls` stale mechanically, but **`clarifications`** is marked *candidate-stale* only — a lightweight diff-classification (§5.2) then decides regenerate (material: new/changed requirements) vs carry-forward (cosmetic). This keeps the interactive grill-me gate from firing on typo-level edits.

### 5.1 Mapping to the requested regeneration rules
| Requested rule | Mechanism |
|---|---|
| Jira story changed | rule (b) on `sources.jira` → regen `requirements` (+cascade) |
| Acceptance Criteria changed | AC is inside the Jira hash → rule (b) |
| Comments introduce new requirements | comments in the Jira hash → rule (b) **+ materiality gate (§5.2)** |
| Figma design changed | figma fingerprint differs → rule (b) on `sources.figma` → regen `figma-analysis` (+cascade) |
| Artifact missing/incomplete | rule (a) |
| Artifact hand-edited (no source change) | step 3 → status `modified`, **reused** (human edit wins) |
| Hand-edit **and** source change | step 5 → **conflict**, operator decides (default: keep edits, warn) |
| *(bonus)* methodology refined | rule (d) via skill `version:` bump — live since 2026-08-09; `--ignore-lock` carries it forward deliberately |
| *(bonus)* business rules changed | rule (e) via domain `version:` — live since 2026-08-09, and only for artifacts recorded with `--domains` |
| **Implementation differs from the approved suite** | *not* a freshness rule — the sources did not change. Handled by `test-design` **Phase C** (reconciliation): add/update/remove/split/merge/obsolete, each with an **authority** (AC, design, or a recorded clarification) and evidence, logged in `testcases/reconciliation.md`, then re-reviewed, re-approved and synced. "The app does X" is a defect candidate, never an authority to rewrite an expected result. |
| Otherwise | reuse |

### 5.1a Coverage changes are never carried forward as settled

`coverageChanges` (qa-state, [schema](qa-state.schema.json) `$defs.coverageChangeRecord`) records a
decision that **reduces or changes planned validation**. The authoritative rule — what counts, why it
needs ratification, and the B10-57764 failure it comes from — is
[`QA_PROCESS.md`](../QA_PROCESS.md) *Coverage-changing decisions*; this section states only how it
interacts with freshness.

- A `proposed` decision **stays `proposed`** across reconciliation. Carrying `clarifications` forward
  (§5.2) carries the *artifact*, never the ratification.
- An `approved` decision is **re-opened** (set back to `proposed`) when the AC it `affects` changes
  materially — the justification was for the old requirement.
- `complete-check` **fails** on any `proposed` decision; `approve <dir> testcases` **exits non-zero**
  while one is open. Traceability is therefore end-to-end and mechanical:
  **requirement → clarification → coverage change → ratification → test-case coverage.**

### 5.2 Materiality gate (clarifications only)
A Jira change flags `requirements`/`hls` stale mechanically, but **`clarifications`** should re-open (re-run grill-me) only when AC/comments introduce **new/changed requirements**, not on typo-level edits. So: the engine marks `clarifications` *candidate-stale* on any Jira change; a lightweight diff-classification decides **regenerate** (material change) vs **carry forward** (cosmetic). This keeps the interactive clarification gate from firing needlessly.

## 6. `qa-state.json` field reference

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | int | contract version (currently `1`) |
| `ticket` | string | Jira key, e.g. `B10-56729` |
| `updatedAt` | ISO datetime | last reconcile/update |
| `generatedBy` | string | `<workflow>@<version>` that last wrote the file |
| `sources.jira.updated` | ISO datetime | Jira issue `updated` at last reconcile |
| `sources.jira.hash` | sha256 | fingerprint of hashed Jira fields |
| `sources.jira.fieldsHashed` | string[] | which fields fed the hash (e.g. `["summary","description","ac","comments"]`) |
| `sources.figma.fileKey` | string | per-story Figma file key |
| `sources.figma.nodeIds` | string[] | frame node ids compared |
| `sources.figma.lastModified` | ISO datetime | Figma `lastModified` |
| `sources.figma.version` | string | Figma `version` id |
| `sources.figma.framesHash` | sha256 \| null | fingerprint of exported frame PNGs (null if not yet exported) |
| `domains` | map<domainId, {version, checksum}> | consumed-domain fingerprints (optional) |
| `artifacts.<key>.path` | string | artifact path, relative to story dir |
| `artifacts.<key>.status` | enum | `complete` \| `modified` (hand-edited, reused) \| `partial` \| `missing` \| `stale` |
| `artifacts.<key>.generatedAt` | ISO datetime | when produced |
| `artifacts.<key>.generator` | string | `<skill>@<version>` that produced it |
| `artifacts.<key>.derivedFrom` | map<name, sha256> | fingerprints of sources/upstream-artifacts at generation time |
| `artifacts.<key>.checksum` | sha256 | fingerprint of the artifact file content |
| `artifacts.<key>.domains` | string[] | domains consumed (optional) |
| `artifacts.<key>.notes` | string | optional |
| `deferrals.<key>` | `{approvedBy, reason, at}` | operator-approved phase **deferral** — the only way past `PHASE_DEPS`, `APPROVAL_DEPS` and `complete-check` |
| `approvals.<key>` | `{approvedBy, at, artifact, snapshot, checksum, note?, history[]}` | operator approval + the immutable snapshot of what was approved. Required on `testcases` before `browserstack-import` may be recorded. Re-approval pushes the previous record onto `history`, so the original approver is never erased |
| `skips.<key>` | `{decidedBy, reason, at}` | a **conditional** phase (an optional DAG member) deliberately not run. Distinct from a deferral: a deferral postpones something owed, a skip states it was not needed — both carry a name, so "decided against" never looks like "never considered" |

## 7. Migration checklist (independent → plugin)

```
1. git mv qa-workflow/workflows/*      → breadfast-workflow/workflows/
2. git mv qa-workflow/skills/*         → breadfast-workflow/<task-skills>/  (+ re-validate vs real lib/schema)
3. git mv qa-workflow/domains/*        → breadfast-workflow/domains/         (merge)
4. merge  qa-workflow/registry/domains.yaml → plugin registry
5. move   qa-workflow/lib/freshness    → plugin drift internals
   move   qa-workflow/lib/schema       → plugin lib/schema  (qa-state.schema.json included)
6. delete .claude/ QA entrypoints; plugin SKILL.md router takes over
7. delete hand-authored CLAUDE.md QA sections; host-emitter generates them
8. realign templates/ to plugin templates (frontmatter tweaks only)
```

### 7.1 Cross-boundary coupling seams — harden AT migration, not before (tracked 2026-07-26)

`qa-workflow/` reaches outside its own folder at runtime in three places that resolve fine in the
current repo layout but **break on a naive `git mv`** to `breadfast-workflow/`. These are **deliberately
NOT hardened today** — per ADR-001 §1 the plugin's packaging model is inferred from a *diagram*, not its
files, so hardening now would aim at a guessed target and risk rework (violating ADR-001's "depend on
nothing the plugin hasn't shipped"). Nothing here is broken in the current layout. **Trigger to act:**
when the plugin ships its real `templates/`, `lib/schema`, and packaging model (ADR-001 §1 "re-verify
when the plugin is available").

| # | Coupling | Where | Fix at migration |
|---|---|---|---|
| R1 | Hard relative `require('../../automation/helpers/FigmaExporter')` — won't resolve once the tree relocates | [`qa-workflow/bin/qa-cli.js`](../../../qa-workflow/bin/qa-cli.js) | Inject/configure the path (env or resolver) **or** vendor `FigmaExporter` into the plugin so it's self-contained. |
| R2 | No `package.json` in `qa-workflow/` — relies on ambient Node + *external* `node_modules` | `qa-workflow/` | Add a package manifest declaring deps (`@playwright/test`, `FigmaExporter`'s deps) so the plugin package stands alone. |
| R3 | ~~Absolute machine path `D:\Playwright\b55168_pom` for `@playwright/test`~~ — **RESOLVED 2026-08-10** | [`qa-workflow/bin/figma-connect.js`](../../../qa-workflow/bin/figma-connect.js) | Done: `@playwright/test` resolves from the repo-root `package.json`; the machine path is gone from code, messages and docs. The external folder was never a git repo, so it could never have been pushed — see [`automation/legacy/README.md`](../../../automation/legacy/README.md). |

**Already seamed (no action needed):** the `docs/ai/screens` registry dir → `QA_SCREEN_REGISTRY_DIR`;
the Figma session file → `FIGMA_AUTH_PATH`. The plugin only needs to set these env vars. Also note:
`qa-workflow/` has **zero runtime coupling to the deferred `qa-platform/`** (severed 2026-07-26) — only
historical code comments remain.

Untouched by migration: methodology in `docs/ai/**`, runtime helpers in `automation/**` *(they stay put — but qa-workflow's reference to them needs the R1/R3 seams in §7.1)*, the DAG (§2), the freshness algorithm (§5), the subagent execution model.

---
*Contract spec for QA artifact reuse. Authoritative methodology: [`../QA_PROCESS.md`](../QA_PROCESS.md).*
