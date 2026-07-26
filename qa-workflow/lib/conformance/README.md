# lib/conformance/ — the Conformance Engine contract

The capability-neutral substrate every QA capability plugs into (ADR-003).
Zero-dependency (Node built-ins), pure. The platform primitive is a **Conformance
Engine**: compare an `Actual` against an `Expected` via a **Resolver** (identity
pairing) + an ordered **Validator** pipeline + an **AI residual gate**, emitting
**Findings** scored into **Health**.

**Visual Testing is instance #1** (see [`../../capabilities/visual/`](../../capabilities/visual/));
accessibility / api / performance / localization / requirement are the same engine
with different `(Expected, Actual, Validators)` triples.

| Module | Purpose |
|---|---|
| `finding.js` | capability-neutral `Finding` model · `validateFinding` · `computeHealth` · `detectPatterns` (hoisted/generalized from `qa-platform` `visual.ts` — same severity math) |
| `capability.js` | `ConformanceCapability` descriptor · `validateCapability` · `defineCapability` (validate-then-freeze) · `deterministicStages`/`residualStages` · runtime port typedefs (`Validator`, `ExpectedModelProvider`, `ActualCaptureProvider`, `Resolver`) |
| `resolver.js` | generic identity-first pairing (L1) — registry match → heuristic (floor) → **abstain** (coverage gap; never force-pair); generalizes `visual-resolver` |
| `pipeline.js` | the deterministic-first runner — run deterministic stages (collect-all) → AI residual only when the AI-skip predicate fails; unwired stages ⇒ `pending`, never crash |
| `run.js` | story-level driver — resolve (L1) → `runPipeline` per pair → aggregate; emits non-penalizing coverage-gap notices + a `residual` worklist |
| `residual.js` | L8 orchestration — `runResidual` / `evaluateStory` process ONLY the residual worklist via an **injected `judge`** (AI transport); the deterministic core imports nothing from here |
| `index.js` | barrel |

**Not yet wired** (by design — additive freeze point per ADR-003 §3.7): the concrete
`Validator.run` implementations (the L1–L7 pyramid) and the pipeline runner land in a
later slice, when the engine is relocated out of `qa-platform`. This module is the
contract they will satisfy.

## Tests
```
node --test qa-workflow/lib/conformance/finding.test.js \
            qa-workflow/lib/conformance/capability.test.js \
            qa-workflow/lib/conformance/resolver.test.js \
            qa-workflow/lib/conformance/pipeline.test.js \
            qa-workflow/lib/conformance/run.test.js \
            qa-workflow/lib/conformance/residual.test.js
```
(30 tests; built-in `node:test`, no framework.)

## Contract
[docs/ai/architecture/adr-003-visual-conformance-engine-plugin-aligned.md](../../../docs/ai/architecture/adr-003-visual-conformance-engine-plugin-aligned.md)
