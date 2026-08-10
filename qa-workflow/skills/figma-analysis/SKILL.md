---
name: figma-analysis
description: Figma Analysis (QA_PROCESS Phase 2). Export this story's Figma frames (EN+AR, scale=2) and produce a design-analysis artifact + the expected-side baseline. Runs as a subagent in qa-shift-left.
metadata:
  type: task
  version: 1.0
  phase: Phase 2 — Figma Analysis
  workflow: [qa-shift-left]
  runsAs: subagent
  consumes:
    sources: [figma]
    artifacts: []
    domains: []
  produces:
    artifacts: [figma-analysis]
  methodology: docs/ai/testing-process.md
---

# figma-analysis (task skill)

> Thin wrapper. The **how** is in [`docs/ai/testing-process.md`](../../../docs/ai/testing-process.md) §4
> (Figma fetch + comparison), [`docs/ai/figma-exporter-instructions.md`](../../../docs/ai/figma-exporter-instructions.md),
> and `CLAUDE.md` §2 STEP 2. Do not re-inline methodology.

## Purpose
Turn the design into the **expected side** — export frames and produce a structured design analysis.

## Inputs
- **This story's Figma URL** (from the ticket; per-story file key). Never reuse another story's key. If the user supplies a corrected/updated Figma URL, **that overrides the ticket's link(s)** — record the supersession.
- Derive the per-story key with `FigmaExporter.fileKeyFromUrl(url)`. Capture EN **and** AR frames at **2×**
  via the **Capture channels** order below — browser session **PRIMARY**, `exportNodes`/`exportPage`
  (REST, `scale=2`) only as the **fallback** when quota allows.

## Capture channels — order, and the Figma **session gate** (NEVER mark "blocked")
Frame capture must always succeed or **stop-and-ask** — it is never reported as a dead "blocked" phase. Try channels in this order:
1. **Authenticated Playwright browser session (PRIMARY)** — the reliable channel on this account: immune to **both** the Starter-plan REST quota and the MCP seat-cap. **Self-contained in this repo — NO qa-platform dependency:** reconnect script `qa-workflow/bin/figma-connect.js`, saved session `auth/figma-auth.json` (repo root, gitignored).
   - **Session gate (run FIRST):** `node qa-workflow/bin/figma-connect.js --status` — reads `auth/figma-auth.json` (override `FIGMA_AUTH_PATH`), checks `cookies.length > 0` and `savedAt` within **25 days**, prints one JSON line, exits **0 = FRESH**, **3 = MISSING/EXPIRED/INVALID**.
     - **Not FRESH → notify the user and OPEN A BROWSER to reconnect** (never mark blocked): run `node qa-workflow/bin/figma-connect.js` from the repo root (`@playwright/test` resolves from the repo's own `node_modules`) — a headed Chromium opens on Figma login; the user signs in with Google; the script auto-detects success and writes the full `storageState` to `auth/figma-auth.json`. Resume capture once it exits 0.
     - **Fallback if no headed browser can launch** (script exits 2 / no display): reconnect **in-session via the Playwright MCP** — `browser_navigate` to `https://www.figma.com/login`, ask the user to sign in, poll until the URL leaves the login flow, then read `page.context().storageState()` (via `browser_run_code_unsafe`), return it, and `Write` it to `auth/figma-auth.json` in the same `{cookies, origins, savedAt, figmaUrl}` shape the script uses.
   - **Restore before navigating:** inject the saved `figma.com` cookies into the browser context **before** any navigation — `await page.context().addCookies(<cookies>)` (via `browser_run_code_unsafe`; note that context has **no `require`** — pass cookies as a literal or load code from a file under the repo root). Then `browser_navigate` to the node deep-link; a loaded canvas shows the page title with an em-dash "–" (a `/login` redirect ⇒ session expired ⇒ go back to the gate).
   - **EXPORT-GRADE capture — `Ctrl+Shift+C` Copy as PNG (THE DEFAULT):** deep-link to the **frame node** (reliable selection) → wait for canvas (title contains "–") → `grantPermissions(['clipboard-read','clipboard-write'])` → **`Ctrl+Shift+C` (Copy as PNG)** → in `page.evaluate` read `navigator.clipboard.read()` for `image/png`, then trigger a blob-URL `<a download>` (the MCP saves the PNG). Renders the node at **2× natively, no editor chrome**. Beats plain viewport screenshots (chrome-laden, screen-resolution → **not** valid for pixel diffing) and the `Ctrl+Shift+E` export dialog (whose buttons aren't cleanly exposed to DOM automation). The shortcut must target the **canvas** (don't click the right panel first, or it copies text). Image-heavy frame? wait ~10 s after load so lazy images fill, else mockups export **black**.
   - **Bulk variant — `Ctrl+Shift+E` ZIP:** for large multi-frame sections, select-all → `Ctrl+Shift+E` (PNG 2×) → download ZIP → extract.
   - Viewport screenshots (`Shift+2` + `Ctrl+scroll` + screenshot) are **analysis-only context** — never a pixel-diff baseline.
2. **REST exporter (FALLBACK)** (`FigmaExporter`, `scale=2`, one batched call) — best fidelity and scriptable **when quota is available** (paid seat / service PAT / after a reset). `429`s on the Starter-plan PAT (monthly content quota) — do not rely on it as the default.
3. **Figma MCP (LAST RESORT)** (`get_screenshot`) — convenient but subject to the per-seat tool-call cap (a View seat hits it fast); use only if the above are unavailable.

## Frame-set COMPLETENESS — enumerate the cluster, never trust a search hit-count (added 2026-07-26)

**Failure this prevents (B10-56750):** capture was driven by *layer-name search*. Two searchable names resolved to nodes,
2 frames were captured, and the remaining states were written off as "not re-capturable (MCP capped / REST 429)" and
deferred to Workflow 2. The design cluster actually held **5** sibling frames. The user had to point this out. Worse: the
2-frame evidence set produced a **false finding** ("no modal, no Cancel — contradicts AC-05/06/07/10") that all 5 frames
immediately disproved. **Incomplete capture is not just missing coverage — it manufactures wrong conclusions.**

Rules, in order:
1. **Enumerate the containing cluster before capturing anything.** A story's states live as **sibling frames** in one
   canvas cluster (usually under a dark band heading, e.g. *"Adding a section (Mobile display)"*). Find the cluster,
   then capture **every** sibling — do not capture "the nodes I happened to find".
2. **A search result set ≠ the frame set.** Layer search returns text/label hits, is virtualized, and silently
   under-reports. Use it to *locate* the cluster, never to *bound* it.
3. **How to enumerate reliably** (this is what worked): select any known frame → `Shift+2` (zoom to fit) → step out
   ~4 zoom levels until the whole sibling row is visible (~3–6 %) → screenshot → read off each frame's x-position →
   click each position in turn. Keyboard `Tab`-cycling siblings does **not** work (selection/URL doesn't advance).
4. **Capture the OUTER frame, not the inner content frame.** Clicking a frame selects the **top-most child** under the
   cursor (e.g. an inner `Frame 39900` content container at `Top 156px`), which crops away page chrome — and with it the
   **header, nav, and success toast**. After clicking, walk up with **`Shift+Enter`** until the properties panel shows
   the real frame width (e.g. `1440px`), *then* `Ctrl+Shift+C`. Capture inner crops too if useful, but the outer frame
   is the baseline.
5. **State the expected state-count and reconcile.** Before capturing, list the states the ACs imply (default, filled,
   loading, error, success, empty …). If captured frames < expected states, that is an **open item to resolve now**, not
   a `partial` to defer. `partial` is only legitimate when the state is **absent from the design**, and then say so
   explicitly ("no frame exists for AC-02") rather than "not captured".
6. **Verify the story's node id still resolves.** A `node not found` from a Jira Design link means the file was
   restructured — re-locate the cluster and **report the dead link** as a finding.

> **Do not mark `figma-analysis` `complete` until every sibling frame in the cluster is captured** with its live node id
> recorded in `frames/export/MANIFEST.json` (name → node → state → ACs) and folded into `framesHash`.

> **Rule of record (per user, 2026-07-22; qa-platform-severed 2026-07-26):** when Figma capture is impeded, do **not** emit a "blocked" artifact. Reuse the saved browser session (`auth/figma-auth.json`); if it is missing/expired, **notify the user and open the reconnect browser** (`qa-workflow/bin/figma-connect.js`, MCP fallback), save the cookies, and continue. The saved session is one person's login, shared across all stories on this machine.

## Steps (per methodology)
1. Resolve `fileKey` + node ids from the ticket's Figma URL; capture Figma `version`/`lastModified`.
2. **Capture frames — browser-session Copy-as-PNG (PRIMARY):** session-gate first, then **enumerate the cluster per the
   Frame-set COMPLETENESS rules above** (all sibling frames, outer frame via `Shift+Enter`), then per the Capture-channels
   steps — `Ctrl+Shift+C` → save the `image/png` blob to `figma-analysis/frames/export/*_2x.png` (use the `Ctrl+Shift+E`
   ZIP bulk variant for large sections). **Do NOT defer this — capture the frames here**, and do not stop at the frames
   a name-search happened to surface.
   *Fallback, only when the REST quota is available (paid seat / service PAT / after a reset):* one command `node qa-workflow/bin/qa-cli.js figma-export --url <thisStoryFigmaUrl> --story <storyDir>` (REST, scale=2 → writes `figma-analysis/frames/*.png`; derives fileKey+node from the URL — a FRAME exports as-is, a SECTION explodes into child frames; degrades gracefully if the `/v1/files` inspect 429s and prints the session-fallback guidance on a REST 429).
   Either way, fingerprint `sources.figma` (fileKey/nodeIds/**framesHash**) into `qa-state.json`. Optionally structured extract → `figma-analysis/extract/*.json`.
3. Analyze screens/flow/states/validations/error+empty states/copy/localization; compare vs description/AC/comments; surface gaps.
4. Write **`figma-analysis/analysis.md`**.

## Output & recording
- Writes: `<storyDir>/figma-analysis/analysis.md` (+ `frames/`, `extract/`).
- Return: `{ artifactPath, fileKey, nodeIds, version, framesHash?, summary }`.
- The workflow fingerprints Figma and records:
  ```
  node qa-workflow/bin/qa-cli.js fingerprint-figma "<storyDir>" --file <fileKey> --nodes <ids> --version <v> [--frames <sha256>] [--last <iso>]
  node qa-workflow/bin/qa-cli.js record "<storyDir>" figma-analysis \
       --path figma-analysis/analysis.md --generator figma-analysis@1.0 --derive-sources figma
  ```
> Prefer computing `--frames <sha256>` from the exported PNGs so re-runs only invalidate when the compared frames actually change (contract §4).
