# QA Artifact Contract — Reuse, Freshness & Regeneration

> The contract between **Workflow 1 (Pre-Development)** and **Workflow 2 (Post-Development)**.
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
| `hls` | `hls/hls.md` (+ Jira checklist publish record) | `test-design` (HLS phase) | — | requirements, figma-analysis, impact, clarifications |

Workflow 2 outputs **may** also be tracked (optional, same record shape): `testcases`, `browserstack-import`, `automation`, `execution`, `visual-findings`, `defects`, `qa-summary`. These are not part of the reuse baseline but benefit from the same checksum/staleness bookkeeping.

## 2. Dependency DAG

```
        sources.jira ───────► requirements ──────────────┐
                     └──────► clarifications ◄──┐         ├──► impact ──┐
                                                │         │             ├──► hls
        sources.figma ─────► figma-analysis ────┴─────────┘─────────────┘
```
- `requirements ← jira`
- `figma-analysis ← figma`
- `clarifications ← jira (AC/comments)`  *(with requirements + figma-analysis as context)*
- `impact ← requirements, figma-analysis`
- `hls ← requirements, figma-analysis, impact, clarifications`

Cascade: a change to `jira` regenerates `requirements` → `impact` → `hls` (and `clarifications` via the materiality gate, §5). A change to `figma` regenerates `figma-analysis` → `impact`, `hls`, and the visual baseline.

**Workflow-2 outputs extend the same DAG** (when tracked): `testcases ← hls, requirements`; `automation ← testcases`; `browserstack-import ← testcases`; `visual-findings ← figma-analysis`; `defects ← execution, visual-findings`; `qa-summary ← execution, visual-findings, defects`. So a regenerated baseline artifact cascades into WF2 outputs exactly as within the baseline.

**Domain recording:** when an artifact declares `domains: [...]`, each listed domain's fingerprint MUST be present in the top-level `domains` map — that is what rule (e) compares against. An artifact may only consume domains that are recorded.

## 3. The validity ledger — `<TICKET>/qa-state.json`

One state file per story records **current known source fingerprints** and **one record per artifact** (path, status, generator@version, the fingerprints it was `derivedFrom`, checksum, consumed domains). Full field reference: §6. Machine schema: [`qa-state.schema.json`](qa-state.schema.json).

## 4. Fingerprints (how inputs are identified)

| Source | Cheap freshness signal | Content fingerprint |
|---|---|---|
| **Jira** | issue `updated` timestamp | `sha256(normalize(summary + description + AC field + comments[]))` — `fieldsHashed` records exactly which fields were included |
| **Figma** | `GET /v1/files/<key>?depth=1` → `lastModified` + `version` (one cheap call, no frame export) | `framesHash` = `sha256` over exported frame PNGs (computed only when frames are (re)exported) |
| **Domain** | domain skill `version:` | `sha256` of the domain skill content |
| **Artifact** | — | `checksum` = `sha256` of the artifact file (detects on-disk drift/tamper) |

Normalization for Jira hashing: trim, collapse whitespace, strip volatile markup, sort comments by id — so cosmetic re-renders don't produce false changes.

**The figma fingerprint** (used in `derivedFrom.figma` and staleness rule b) = `framesHash` when available, else `sha256(version + sorted(nodeIds))`. Prefer `framesHash`: Figma `version` increments on *any* edit to the file, so a version-only comparison regenerates `figma-analysis` even when the specific compared frames are unchanged (false positive). `lastModified`/`version` are the **cheap first-pass** signal (one `depth=1` call); when they differ, re-export the frames and compare `framesHash` to **confirm** the compared frames actually changed before regenerating. If per-node `lastModified` is available, prefer node-level comparison to scope invalidation to the affected frames only.

## 5. Freshness algorithm — `Reconcile(storyDir)`

Workflow 2's first step. Reuses everything valid; regenerates only the stale set.

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
| *(bonus)* methodology refined | rule (d) via skill `version:` bump |
| *(bonus)* business rules changed | rule (e) via domain `version:` |
| Otherwise | reuse |

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
Untouched by migration: methodology in `docs/ai/**`, runtime helpers in `automation/**`, the DAG (§2), the freshness algorithm (§5), the subagent execution model.

---
*Contract spec for QA artifact reuse. Authoritative methodology: [`../QA_PROCESS.md`](../QA_PROCESS.md).*
