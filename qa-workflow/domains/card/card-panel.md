# Card — card panel (web admin)

> **Domain `card`** · surface `web` · owner `card-core` · loaded only through `qa-cli.js knowledge`.
> **Provenance:** moved verbatim on 2026-11-24 from the CLAUDE.md scope block and
> `qa-workflow/skills/detect-prerequisites/SKILL.md`. `[tester: card-core]`.

## Locale scope — the card panel has no Arabic UI
- **Web + English only — 1 combo.** The card panel has no mobile client and **no Arabic UI at all**: no locale
  switch; `html[lang]` is hard `en`; forcing an `ar-EG` browser locale leaves it English/LTR
  `[confirmed: B10-56750 run; 2026-07-26]`.
- Arabic is still in scope as **content**: `*_ar` fields are required, asserted, and render RTL *inside* their inputs.
- Do **not** plan an AR/RTL UI sweep, and never report one as *passed* — report **Not Applicable** with evidence.
- The Figma frames for these screens may still draw an `عربي` toggle; that is mock chrome, not a missing feature.
