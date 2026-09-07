'use strict';

/**
 * Live-page annotations for bug evidence — mark WHERE the issue is, on every screenshot and in the
 * video, not just describe it.
 *
 * STANDING RULE (operator, 2026-09-07): every screenshot and every recording attached to a bug must
 * carry an indicator on the thing that is wrong. It was said twice in one session, because twice the
 * evidence showed a screen without saying what in it to look at:
 *   - B10-59719's first recording "does not specify what actually happens", and its stills showed a
 *     form full of dates with nothing marking entered-vs-displayed.
 *   - B10-59832's stills carried a caption but no mark, so the reader had to find the empty section
 *     and the success toast for themselves.
 *
 * This annotates the page the browser is actually showing, so ONE call covers the still and the video
 * frame. It complements `automation/helpers/VisualComparisonHelper.js`, which draws red rect/circle/
 * arrow annotations onto design-vs-actual comparison pages from bounding boxes — that one is for
 * visual findings assembled after the fact; this one is for driving a live page.
 *
 *   const A = require('../../automation/visual/annotate');
 *   await A.caption(page, 'Step 4 - the panel reports the location as updated');
 *   await A.mark(page, '.toast-success', { label: 'success message, but nothing was saved' });
 *   await A.pointer(page, 'input[bsdatepicker]');       // real hover + a drawn cursor
 *   await A.clear(page);                                 // before the next step
 *
 * Everything drawn is an overlay identified by a `__qa_` id, so `clear()` leaves the page untouched
 * and no annotation can be mistaken for product UI. Any value that appears in a label must be read
 * out of the page by the caller — never typed into the annotation from an expectation.
 */

const RED = '#e00020';

/** A fixed strip across the top, describing the step. */
async function caption(page, text, { position = 'top' } = {}) {
  await page.evaluate(({ t, pos }) => {
    let el = document.getElementById('__qa_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__qa_caption';
      document.body.appendChild(el);
    }
    // TOP by default: a bottom strip covers whatever opens downward (a date picker, a dropdown),
    // which on B10-59719 hid the very calendar day the caption was naming.
    el.style.cssText = 'position:fixed;left:0;right:0;z-index:2147483647;background:#111;color:#fff;'
      + 'font:600 20px/1.4 system-ui,Segoe UI,sans-serif;padding:14px 20px;'
      + (pos === 'bottom' ? 'bottom:0;' : 'top:0;');
    el.textContent = t;
  }, { t: text, pos: position });
}

/**
 * Outline an element in red, optionally with a label pinned beside it.
 * `shape: 'circle'` for round targets (a selected calendar day, a radio, a toggle).
 */
async function mark(page, selector, { label = '', shape = 'rect', nth = 0, scroll = true } = {}) {
  return page.evaluate(({ sel, label: lb, shape: sh, nth: n, scroll: sc, RED: red }) => {
    const els = typeof sel === 'string' ? [...document.querySelectorAll(sel)] : [];
    const el = els[n];
    if (!el) return { marked: false, reason: 'selector matched ' + els.length + ' elements: ' + sel };
    if (sc) el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = '__qa_mark';
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;'
      + `border:4px solid ${red};box-shadow:0 0 0 3px rgba(255,255,255,.85);`
      + `left:${r.left - 5}px;top:${r.top - 5}px;width:${r.width + 10}px;height:${r.height + 10}px;`
      + (sh === 'circle' ? 'border-radius:50%;' : 'border-radius:4px;');
    document.body.appendChild(box);
    if (lb) {
      const tag = document.createElement('div');
      tag.className = '__qa_mark';
      tag.textContent = lb;
      tag.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;visibility:hidden;'
        + `background:${red};color:#fff;font:700 16px/1.3 system-ui,Segoe UI,sans-serif;`
        + 'padding:5px 10px;border-radius:4px;max-width:420px;left:0;top:0;';
      document.body.appendChild(tag);
      // Prefer the SIDE with room, then above, then below. A label pinned above by default lands on
      // whatever sits there — on the date picker it covered the weekday header row, which is the same
      // mistake as a caption strip covering the calendar it describes.
      const t = tag.getBoundingClientRect();
      const gap = 10;
      let left;
      let top;
      if (window.innerWidth - r.right > t.width + gap * 2) {
        left = r.right + gap; top = Math.max(6, r.top + r.height / 2 - t.height / 2);
      } else if (r.left > t.width + gap * 2) {
        left = r.left - t.width - gap; top = Math.max(6, r.top + r.height / 2 - t.height / 2);
      } else if (r.top > t.height + gap + 46) {
        left = Math.max(6, r.left - 5); top = r.top - t.height - gap;
      } else {
        left = Math.max(6, r.left - 5); top = Math.min(window.innerHeight - t.height - 6, r.bottom + gap);
      }
      tag.style.left = `${Math.round(left)}px`;
      tag.style.top = `${Math.round(top)}px`;
      tag.style.visibility = 'visible';
    }
    return { marked: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  }, { sel: selector, label, shape, nth, scroll, RED });
}

/**
 * Mark an AREA rather than an element — for a defect of ABSENCE, where the point is that nothing is
 * there (an empty section, a missing control). Pass the container and the label says what is missing.
 */
async function markEmpty(page, containerSelector, label) {
  return page.evaluate(({ sel, lb, RED: red }) => {
    const el = document.querySelector(sel);
    if (!el) return { marked: false, reason: 'no ' + sel };
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = '__qa_mark';
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;'
      + `border:4px dashed ${red};border-radius:4px;background:rgba(224,0,32,.06);`
      + `left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;`;
    document.body.appendChild(box);
    const tag = document.createElement('div');
    tag.className = '__qa_mark';
    tag.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;'
      + `background:${red};color:#fff;font:700 16px/1.3 system-ui,Segoe UI,sans-serif;`
      + `padding:5px 10px;border-radius:4px;left:${Math.max(6, r.left - 4)}px;top:${Math.max(50, r.top - 40)}px;`;
    tag.textContent = lb;
    document.body.appendChild(tag);
    return { marked: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  }, { sel: containerSelector, lb: label, RED });
}

/**
 * Hover an element for real AND draw a cursor at that point.
 *
 * Playwright's video renders NO mouse cursor, so a hover is invisible in a recording without this —
 * which is why B10-59719's first recording showed values changing with nothing pointing at them.
 * `page.mouse.move` is used so genuine hover styling fires, and the drawn arrow makes it visible.
 */
async function pointer(page, selector, { nth = 0, glide = true } = {}) {
  const at = await page.evaluate(({ sel, n }) => {
    const el = [...document.querySelectorAll(sel)][n];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 };
  }, { sel: selector, n: nth });
  if (!at) return null;
  if (glide) {
    await page.mouse.move(at.x - 240, at.y + 140);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(at.x - 240 + (240 * i) / 10, at.y + 140 - (140 * i) / 10);
      await page.waitForTimeout(40);
    }
  }
  await page.mouse.move(at.x, at.y);
  await page.evaluate(({ x, y }) => {
    let c = document.getElementById('__qa_pointer');
    if (!c) {
      c = document.createElement('div');
      c.id = '__qa_pointer';
      c.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;width:34px;height:34px;';
      c.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34">'
        + '<path d="M4 2 L4 20 L9 15 L12.5 22 L15.5 20.5 L12 14 L19 14 Z" fill="#fff" stroke="#111" stroke-width="1.4"/></svg>';
      document.body.appendChild(c);
    }
    c.style.left = x + 'px';
    c.style.top = y + 'px';
  }, at);
  return at;
}

/** Remove every annotation. Marks are position:fixed, so they must be redrawn after any scroll. */
async function clear(page, { keepCaption = false } = {}) {
  await page.evaluate((keep) => {
    document.querySelectorAll('.__qa_mark').forEach((e) => e.remove());
    const p = document.getElementById('__qa_pointer');
    if (p) p.remove();
    if (!keep) {
      const c = document.getElementById('__qa_caption');
      if (c) c.remove();
    }
  }, keepCaption);
}

/**
 * Temporary bottom room, so a control near the end of the page can be raised and whatever it opens
 * downward still fits on screen. Without it the closure form's date picker is always clipped: the
 * section is the last thing on the page, so the browser has nothing below to scroll into.
 */
async function addPageRoom(page, px = 560) {
  await page.evaluate((h) => {
    let sp = document.getElementById('__qa_spacer');
    if (!sp) {
      sp = document.createElement('div');
      sp.id = '__qa_spacer';
      document.body.appendChild(sp);
    }
    sp.style.cssText = `height:${h}px;width:100%;pointer-events:none;`;
  }, px);
}

async function removePageRoom(page) {
  await page.evaluate(() => {
    const sp = document.getElementById('__qa_spacer');
    if (sp) sp.remove();
  });
}

module.exports = { caption, mark, markEmpty, pointer, clear, addPageRoom, removePageRoom, RED };
