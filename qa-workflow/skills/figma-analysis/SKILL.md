---
name: figma-analysis
type: task
version: 1.0
description: Figma Analysis (QA_PROCESS Phase 2). Export this story's Figma frames (EN+AR, scale=2) and produce a design-analysis artifact + the expected-side baseline. Runs as a subagent in qa-shift-left.
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
- **This story's Figma URL** (from the ticket; per-story file key). Never reuse another story's key.
- Export via `FigmaExporter.fileKeyFromUrl(url)` → `exportNodes`/`exportPage` at **scale=2**, EN **and** AR frames.

## Steps (per methodology)
1. Resolve `fileKey` + node ids from the ticket's Figma URL; capture Figma `version`/`lastModified`.
2. Export frames → `figma-analysis/frames/*.png`; optionally structured extract → `figma-analysis/extract/*.json`.
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
