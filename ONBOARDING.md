# QA Workflow — Onboarding

A teammate quickstart for running Breadfast QA on a story using the two chat-driven workflows in Claude Code. You do **not** run a standalone script — you run two commands **inside Claude Code**, which follows the workflow and calls a small deterministic CLI under the hood.

> **Mental model:** two workflows — **shift-left** (before dev) and **validate** (after dev) — plus **reuse-unless-changed**. The per-story folder + its `qa-state.json` are the shared memory between them. A third entrypoint, **`/qa-full`**, simply runs both back-to-back for a story with no baseline.

---

## 1. One-time setup

1. **Clone the repo** and open it in **Claude Code** (the VS Code extension). The commands `/qa-shift-left`, `/qa-validate`, and `/qa-full` live in `.claude/skills/` and are auto-discovered when the repo is open.
2. **Node.js** (v18+). The QA engine under `qa-workflow/` is **zero-dependency** — nothing to `npm install` for it.
3. **Authenticate the MCP connectors in your own Claude Code** — **Jira**, **Figma**, **Slack** (each is per-user; authorize via your claude.ai connector settings or `/mcp`). Without these the workflow can't fetch the story, export the design, or read login OTPs.
4. **Credentials** for Jira/BrowserStack writes are already loaded via `automation/config/credentials.js` — you don't re-enter them.

Sanity check (optional):
```
node --test qa-workflow/lib/freshness/freshness.test.js qa-workflow/lib/schema/validate.test.js qa-workflow/lib/qa-state.test.js qa-workflow/bin/qa-cli.test.js
```
Expect **37 tests pass**.

---

## 2. Run it on a story

**Pick your entrypoint:**

| Your situation | Command |
|---|---|
| Story groomed, not built yet | `/qa-shift-left B10-XXXXX` (Step 1 below) |
| Built, and you already ran shift-left | `/qa-validate B10-XXXXX` (Step 2 below) |
| Built, but **no shift-left baseline exists** | `/qa-full B10-XXXXX` — Step 1 + Step 2 in one run |

`/qa-full` is the original end-to-end process: it runs the same phases, stops once at the clarification
gate, then continues to the QA Summary without stopping. Its output is identical to running Step 1 then
Step 2, so nothing is lost either way (and if it's interrupted after the baseline lands, resume with
`/qa-validate`).

### Step 1 — Pre-development (before/while it's built)
```
/qa-shift-left B10-XXXXX
```
- Creates `B10-XXXXX/` + `qa-state.json`.
- **story-analysis** → `requirements-analysis/requirements.md` (Jira description, AC, comments).
- **figma-analysis** → `figma-analysis/` (this story's Figma link, EN+AR frames).
- **Clarification gate** — it STOPS and asks; answer until scope is locked.
- **impact-analysis** → `impact-analysis/impact.md`.
- **HLS (≤20)** → `hls/hls.md`, and publishes them to Jira as a **separate checklist** (never edits the original AC).

Result: the reusable baseline, recorded in `qa-state.json`.

### Step 2 — Post-development (once dev delivers)
```
/qa-validate B10-XXXXX
```
Provide the **app URL** (web) and/or **iOS + Android BrowserStack app IDs** (mobile) when asked.
- **Reconcile first** — reuses the Pre-Dev baseline; regenerates only what changed; **stops on a conflict** (you hand-edited an artifact *and* its source changed).
- Then: test-cases → BrowserStack import → automation → execution (4 combos: iOS/Android × en/US + ar/EG) → **visual testing** (annotated Design-Bug evidence) → defect reporting → **QA Summary** (Pass / Pass-with-risks / Fail).

### Re-running later
Re-running `/qa-validate` **does not redo analysis** unless the Jira story or Figma design actually changed — that is the reuse contract at work.

---

## 3. Useful inspection commands
```
node qa-workflow/bin/qa-cli.js show "B10-XXXXX"        # view the qa-state ledger
node qa-workflow/bin/qa-cli.js reconcile "B10-XXXXX"   # preview the reuse/regenerate plan
```

---

## 4. What to read (in order)
1. `CLAUDE.md` — operating manual + routing table.
2. `docs/ai/QA_PROCESS.md` — the authoritative six-phase methodology.
3. `docs/ai/architecture/adr-001-qa-workflow-independent-plugin-aligned.md` + `qa-artifact-contract.md` — how the two workflows and artifact reuse work.
4. `qa-workflow/README.md` — the directory map. Each `qa-workflow/skills/<name>/SKILL.md` states its inputs/outputs and links to its methodology doc.

---

## 5. How reuse & regeneration works (the short version)
An artifact is **regenerated** only when:
- the Jira story / AC / comments changed (material change for clarifications),
- the Figma design changed,
- it's missing/incomplete,
- an upstream artifact it depends on was regenerated,
- its skill version was bumped, or a consumed business domain changed.

Otherwise it's **reused**. Hand-edited artifacts win (never silently overwritten); a hand-edit **plus** a source change surfaces a **conflict** for you to resolve.

---

## 6. Troubleshooting
| Symptom | Fix |
|---|---|
| `/qa-shift-left` not found | Open the **repo root** in Claude Code so `.claude/skills/` is picked up. |
| "can't fetch story / design / OTP" | Authenticate the **Jira / Figma / Slack** MCP connectors for your user (`/mcp` or claude.ai settings). |
| Reconcile reports a **conflict** | You edited an artifact and its source also changed — choose: regenerate (lose edits), keep edits (accept staleness), or merge. |
| Wrong Figma frames | Ensure the ticket's Figma URL is correct; the file key is **per-story** (never reused). |

---

## 7. Good to know
- **`/qa-validate` end-to-end is still being shaken out** — `/qa-shift-left` has been dry-run; the first full validate run (execution + visual + defects on live systems) is the natural next validation.
- Skills are **thin wrappers**: the deep phase logic is Claude Code following `docs/ai/**`, which stays the source of truth — keep those docs current.
- The whole `qa-workflow/` tree is built to migrate into the **Breadfast Workflow Plugin** later with minimal refactoring; nothing here depends on that plugin today.
