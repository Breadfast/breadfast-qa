'use strict';

/**
 * Visual Testing — Conformance capability instance #1 (ADR-003 §3.7).
 *
 * This is the DESCRIPTOR: it declares visual testing against the generic
 * ConformanceCapability contract and proves the generalization holds (the same
 * contract that will host accessibility / api / performance / localization).
 * The concrete Validator `run` implementations are the L1–L7 pyramid layers +
 * the AI residual; they are wired in a later slice (relocated from qa-platform
 * `packages/shared/src/pyramid.ts` per ADR-003 §3.5). Declaring the stages now,
 * ahead of wiring, is intentional and additive — it changes no running path.
 *
 * Methodology kept verbatim: ADR-002 Rev.2 (../../../qa-platform/docs/design/…)
 * and QA_PROCESS.md Phase 5 (../../../docs/ai/QA_PROCESS.md).
 */

const { defineCapability } = require('../../lib/conformance');
const { compareComponents } = require('./layers/components');
const { compareVisibility } = require('./layers/visibility');
const { compareLayout } = require('./layers/layout');
const { compareText } = require('./layers/text');
const { compareStyles } = require('./layers/styles');
const { comparePixel } = require('./layers/pixel');

module.exports = defineCapability({
  id: 'visual',
  title: 'Visual Testing (design-conformance)',
  expected: { provider: 'figma', kind: 'design-frame' },
  actual: { capture: 'screenshot+structured-dump', kind: 'rendered-screen' },
  resolver: 'screen-id',
  // Ordered cheapest/most-structural first; a component flagged missing at L2 is
  // not re-flagged downstream. L7 pixel is advisory in design-conformance mode.
  stages: [
    { id: 'l1', layer: 'identity', title: 'Screen identity / pairing', deterministic: true },
    { id: 'l2', layer: 'component-tree', title: 'Component tree (missing/extra/order/hierarchy/dup)', deterministic: true, run: compareComponents },
    { id: 'l3', layer: 'visibility', title: 'Visibility (displayed, non-zero, on-screen)', deterministic: true, run: compareVisibility },
    { id: 'l4', layer: 'layout', title: 'Layout / geometry within tolerance', deterministic: true, run: compareLayout },
    { id: 'l5', layer: 'text', title: 'Text / copy exact (Unicode-normalized)', deterministic: true, run: compareText },
    { id: 'l6', layer: 'styles', title: 'Styles / tokens (color ΔE, font, spacing)', deterministic: true, run: compareStyles },
    { id: 'l7', layer: 'pixel', title: 'Pixel (advisory; region locator for AI)', deterministic: true, run: comparePixel },
    { id: 'l8', layer: 'ai-residual', title: 'AI residual — classify / confirm / explain (never re-detect)', deterministic: false },
  ],
  findingExtension: ['component', 'token'],
  renderer: 'expected-actual-side-by-side',
});
