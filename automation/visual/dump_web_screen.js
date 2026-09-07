'use strict';

/**
 * Web structured-dump producer for the deterministic visual pipeline.
 *
 * WHY THIS EXISTS
 * ---------------
 * QA_PROCESS.md Phase 5.2 requires a structured dump of the *actual* rendered UI, and 5.3's L4/L6
 * layers compare bounds and styles. `qa-workflow/capabilities/visual/actual/parse.js` can parse a
 * Playwright a11y snapshot and an Appium page source — but neither carries **computed styles**, and
 * there was no web DOM producer at all. So on web, L4 and L6 had no actual side and stayed dormant,
 * which is one of the reasons a font-weight deviation (B10-59823) could pass a visual review.
 *
 * This emits the StructuredDump shape the parser accepts as a passthrough:
 *   { source, screenId, platform, locale, elements: [ { id, parentId, role, name, text, testId,
 *                                                       bounds:{x,y,width,height}, styles:{…} } ] }
 *
 * `testId` is synthesized as `<role>:<slug of the accessible name or text>` because most Breadfast
 * admin surfaces carry no `data-testid`. That is a deterministic CONVENTION, not a guess: a Screen
 * Registry entry names its components with the same convention and the identity match becomes exact
 * instead of role-only. (`elementMatches` short-circuits on `role` when a component declares one, so
 * without a stable id a component declaring `role:'text'` matches the FIRST text node on the screen.)
 *
 * The style list is FIXED, so what gets measured is not left to whoever runs the phase:
 *   font-family · font-size · font-weight · font-style · color · background-color
 *   · border-radius · border-color · text-transform · width · height
 *
 * Usage (as a library, from a story harness that has already driven the UI into the state):
 *   const { dumpStructured } = require('../../automation/visual/dump_web_screen');
 *   const dump = await dumpStructured(page, { screenId: 'location-edit.onetime', root: '.temp-closure-section' });
 */

const STYLE_KEYS = [
  'font-family', 'font-size', 'font-weight', 'font-style',
  'color', 'background-color', 'border-radius', 'border-color',
  'text-transform', 'width', 'height',
];

/**
 * Roles are derived from the tag/type rather than from ARIA alone: the panel is plain Bootstrap with
 * almost no ARIA, so an a11y snapshot collapses most of it to generic nodes.
 */
const COLLECT = (opts) => {
  const { root, styleKeys, maxElements } = opts;
  const host = root ? document.querySelector(root) : document.body;
  if (!host) return { error: 'root selector matched nothing: ' + root };

  const slug = (s) => String(s || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  const roleOf = (el) => {
    const aria = el.getAttribute('role');
    if (aria) return aria;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return t === 'checkbox' ? 'checkbox' : t === 'radio' ? 'radio' : 'textbox';
    }
    const map = {
      button: 'button', a: 'link', select: 'combobox', label: 'label', table: 'table',
      h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
      p: 'text', span: 'text', div: 'group', th: 'columnheader', td: 'cell', li: 'listitem',
    };
    return map[tag] || tag;
  };

  /** The name a reader would use: an input's own value/placeholder, otherwise its own text. */
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (el.tagName === 'INPUT') {
      if (el.type === 'checkbox' || el.type === 'radio') {
        const lbl = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]'));
        return lbl ? lbl.textContent.trim() : '';
      }
      return (el.value || el.placeholder || '').trim();
    }
    if (el.tagName === 'SELECT') {
      const o = el.options[el.selectedIndex];
      return o ? o.text.trim() : '';
    }
    // own text only — not descendants', or every container inherits the whole screen's copy
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    return own.trim();
  };

  /**
   * The identity half of an element, which must NOT change when its value does.
   *
   * `nameOf` returns a control's current value, so deriving the id from it would make
   * `combobox:13-00` become `combobox:15-00` the moment someone picks a different time — the expected
   * model would stop matching for the very reason it exists to detect. So identity comes from a
   * stable attribute, falling back to the label of the row the control sits in.
   */
  const stableLabelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    for (const attr of ['name', 'id', 'formcontrolname', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v) return v;
    }
    const tag = el.tagName;
    if (tag === 'SELECT' || tag === 'INPUT') {
      if (el.id) {
        const lbl = document.querySelector('label[for="' + el.id + '"]');
        if (lbl) return lbl.textContent.trim();
      }
      // the row this control belongs to: its own label/text, e.g. "Sunday" for a day row
      let node = el.parentElement;
      for (let up = 0; up < 4 && node; up++) {
        const lbl = node.querySelector('label');
        if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
        node = node.parentElement;
      }
    }
    const own = nameOf(el);
    if (own) return own;
    // Unnamed chrome that only earns its entry by painting a region still needs a DURABLE id: an
    // ordinal like `anon-2` shifts the moment anything before it is collected or dropped. The first
    // class token is stable and self-describing (`bs-datepicker-head`).
    const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean);
    return cls.length ? cls[0] : '';
  };

  const transparent = (c) => !c || c === 'transparent' || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(c);

  const out = [];
  const idCounts = Object.create(null);
  const uniqueTestId = (role, label, ordinal) => {
    const base = role + ':' + (slug(label) || 'anon-' + ordinal);
    idCounts[base] = (idCounts[base] || 0) + 1;
    // Repeated components (a label that appears once per closure entry, the two selects in a day row)
    // need an ordinal, or every expected component matches the first occurrence only.
    return idCounts[base] === 1 ? base : base + '-' + idCounts[base];
  };

  const walk = (el, parentId, depth, parentBg) => {
    if (out.length >= maxElements || depth > 24) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    const role = roleOf(el);
    const name = nameOf(el);
    const styles = {};
    for (const k of styleKeys) styles[k] = cs.getPropertyValue(k).trim();
    const id = 'e' + out.length;
    // An element earns an entry when it has an identity of its own, OR when it PAINTS a region its
    // parent does not. Without the second half, the styling of unnamed chrome is invisible to L6: the
    // date picker's coloured header bar is a bare div, so a name-only rule dropped it from the dump
    // and its colour could not be compared at all (B10-59822).
    const bg = styles['background-color'];
    const paints = !transparent(bg) && bg !== parentBg && r.width > 8 && r.height > 8;
    const interesting = name || paints
      || ['checkbox', 'radio', 'combobox', 'button', 'link', 'textbox', 'table'].includes(role);
    if (interesting) {
      out.push({
        id,
        parentId: parentId || undefined,
        role,
        name: name || undefined,
        text: name || undefined,
        testId: uniqueTestId(role, stableLabelOf(el), out.length),
        bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        styles,
        disabled: el.disabled === true ? true : undefined,
      });
    }
    for (const child of el.children) walk(child, interesting ? id : parentId, depth + 1, bg);
  };
  walk(host, null, 0, getComputedStyle(host).getPropertyValue('background-color').trim());
  return { elements: out };
};

/**
 * Capture one screen. `extraRoots` lets a caller include a control rendered OUTSIDE the section —
 * the date picker is appended to <body>, so a section-scoped dump would silently omit it, which is
 * precisely how B10-59822 went unexamined.
 */
async function dumpStructured(page, { screenId, root = 'body', extraRoots = [], platform = 'web', locale = 'en-US', maxElements = 400 } = {}) {
  const parts = [];
  for (const sel of [root, ...extraRoots]) {
    const res = await page.evaluate(COLLECT, { root: sel, styleKeys: STYLE_KEYS, maxElements });
    if (res.error) { parts.push({ error: res.error, selector: sel }); continue; }
    parts.push({ selector: sel, elements: res.elements });
  }
  const elements = [];
  for (const p of parts) if (p.elements) elements.push(...p.elements);
  // ids must stay unique once several roots are merged
  elements.forEach((el, i) => { el.id = 'e' + i; });
  return {
    source: 'dom',
    screenId,
    platform,
    locale,
    capturedAt: new Date().toISOString(),
    roots: parts.map((p) => ({ selector: p.selector, count: p.elements ? p.elements.length : 0, error: p.error })),
    elements,
  };
}

module.exports = { dumpStructured, STYLE_KEYS };
