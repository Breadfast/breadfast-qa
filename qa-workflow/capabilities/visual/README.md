# capabilities/visual/ — Visual Testing (Conformance instance #1)

Visual testing declared against the generic Conformance Engine contract
([`../../lib/conformance/`](../../lib/conformance/), ADR-003).

| File | Purpose |
|---|---|
| `capability.js` | the `ConformanceCapability` descriptor: `expected = figma design-frame`, `actual = screenshot + structured dump`, `resolver = screen-id`, stages `L1–L7` (deterministic) + `L8` (AI residual), `findingExtension = [component, token]` |
| `layers/components.js` | **L2 · Component Tree** `Validator` — identity-matched (test-id → role → name) missing (major) / duplicate (major) / ordering (minor) / hierarchy (minor); dormant without expected components |
| `layers/visibility.js` | **L3 · Visibility** `Validator` — required component present but zero-area bounds ⇒ major |
| `layers/layout.js` | **L4 · Layout** `Validator` — bounds vs expected beyond tolerance; magnitude-based severity |
| `layers/text.js` | **L5 · Text/Copy** `Validator` — exact copy compare (NFC + whitespace normalize) with the copy severity sub-class (casing/whitespace/punctuation → minor; word/meaning/number/localized → major; missing/empty → major) |
| `layers/styles.js` | **L6 · Styles/Tokens** `Validator` — color ΔE · font-family · length, normalized + tolerant; emits the design token as root cause |
| `layers/normalize.js` | style normalizers (color ΔE, CSS length → px, font-family canonicalization) for L6 |
| `layers/pixel.js` | **L7 · Pixel** `Validator` — advisory only; emits an info note when a precomputed whole-image diff exceeds threshold (diff supplied by an injected adapter; dormant otherwise) |
| `expected/figma.js` | `ExpectedModelProvider` — Figma frames → expected screens (`texts` for L5, `components` for L2–L6) |
| `actual/dump.js` | `ActualCaptureProvider` — `capture` (parsed dumps) · `captureRaw` (RAW a11y / Appium-XML) → actual screens |
| `actual/parse.js` | raw structured-dump parsers (Playwright a11y · Appium XML · dump-JSON), ported from qa-platform `dump-parse` |
| `actual/pixel-adapter.js` | real `PixelComparator` (L7 feeder) — dependency-free PNG decode via Node `zlib` (spec filters 0–4); dimension-gated diff → `{ diffRatio }` |
| `registry.js` | Screen Registry loader/validator + `ValidationProfile`/tolerance resolution over `docs/ai/screens/*.json` (skips `_` files) |
| `expected/figma-extract.js` | Figma REST node tree → StructuredDump + conservative `ExpectedComponent[]` (ported from qa-platform `figma-extract`) |
| `expected/build.js` | `expectedScreensFromRegistry` — ties registry + figma-extract → expected screens (curated components + profile tolerances/enabledLayers) |

Registry data: [`../../../docs/ai/screens/perks.perk-details.json`](../../../docs/ai/screens/perks.perk-details.json) (first real entry; figma keys are placeholders).

**Status:** **deterministic pipeline COMPLETE — L1–L7 wired and validated end-to-end**
([`phase2-e2e.test.js`](phase2-e2e.test.js)). Registry-driven: per-screen
`ValidationProfile` supplies tolerances + enabledLayers. L7 pixel is advisory (dormant
without an injected diff). The **L8 AI residual is a transport-injected runner**
([`../../lib/conformance/residual.js`](../../lib/conformance/residual.js) — `evaluateStory`);
the deterministic core has zero AI knowledge. The deterministic pass reports a
`residual` worklist (unstructured / no-expected-model) + `coverageGaps` — the exact set
handed to the LLM.
The remaining deterministic layers are the pyramid functions in
`qa-platform/packages/shared/src/pyramid.ts`; ADR-003 §3.5 relocates them here behind
their stage declarations, one at a time (additive — each wiring changes no
already-working path). The deterministic pipeline is callable end-to-end via the
`visual-compare` CLI bridge ([`../../bin/qa-cli.js`](../../bin/qa-cli.js)).

## Tests
```
shopt -s globstar   # bash
node --test qa-workflow/capabilities/visual/**/*.test.js
```
(~46 tests across `layers/` (L2–L7 + normalize + full-pipeline), `registry`, `expected/`
(figma-extract + build), `actual/` (parse + pixel-adapter), `providers`, and
`phase2-e2e`. The visual descriptor is validated in
[`../../lib/conformance/capability.test.js`](../../lib/conformance/capability.test.js);
the `visual-compare` bridge in [`../../bin/qa-cli.visual.test.js`](../../bin/qa-cli.visual.test.js);
the L8 residual runner in [`../../lib/conformance/residual.test.js`](../../lib/conformance/residual.test.js).)

Methodology (kept verbatim): [ADR-002 Rev.2](../../../qa-platform/docs/design/adr-002-visual-testing-redesign-rev2.md)
· [QA_PROCESS.md Phase 5](../../../docs/ai/QA_PROCESS.md).
