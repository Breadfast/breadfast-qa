'use strict';

/**
 * Expected model provider — Figma → Conformance "expected screens"
 * (ADR-003 port `ExpectedModelProvider`). First cut: a PURE transform from
 * already-exported figma-extract-shaped frames to the screen shape the pipeline /
 * L5 consume. Live Figma fetch stays in automation/** (FigmaExporter); this only
 * shapes node data. Mirrors qa-platform `figma-extract` intent, minimally.
 *
 * Input frame (tolerant): { screenId|name, platform?, locale?, textNodes|texts: [{ subject|name, text|characters }] }
 * Output screen:          { screenId, platform?, locale?, texts: [{ subject, text }] }
 */

function toExpectedScreen(frame) {
  frame = frame || {};
  const texts = [];
  for (const n of frame.textNodes || frame.texts || []) {
    const subject = (n && (n.subject || n.name)) || '';
    const text = n && (n.text != null ? n.text : n.characters);
    if (subject && text != null) texts.push({ subject, text: String(text) });
  }
  // `components` (the registry's expectedComponents) pass through for L2 when present.
  const components = Array.isArray(frame.components) ? frame.components : [];
  return { screenId: frame.screenId || frame.name || '', platform: frame.platform, locale: frame.locale, texts, components };
}

const figmaExpectedProvider = {
  /** @param {any[]} frames exported Figma frames → expected screens */
  load(frames) {
    return (frames || []).map(toExpectedScreen);
  },
};

module.exports = { figmaExpectedProvider, toExpectedScreen };
