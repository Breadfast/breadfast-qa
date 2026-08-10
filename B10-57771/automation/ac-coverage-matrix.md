# AC Coverage Matrix — B10-57771

| AC | Requirement (verbatim from Jira) | Covered by | Verdict |
|---|---|---|---|
| **AC1** | The "..." actions menu shows View, Duplicate, Delete in that order. | TC-54743 (order) · TC-54744 (all states) · TC-54745 + TC-54746 (siblings unchanged) · visual comparison vs Figma `6007:15345` | **PASS** |
| **AC2** | Selecting "Duplicate" opens and pre-fills the Add Perk form with the source perk's field values (title, merchant, type, images, value, etc.). | TC-54747 (full form, not one-click) · TC-54748 (text EN+AR) · TC-54749 (type/section/merchant/funding) · TC-54750 (4 images) · TC-54751 (dates) · TC-54752 (coupon cleared) · TC-54753/54/55 (per type) · TC-54760 (API field parity) | **PASS** |
| **AC3** | The duplicated perk is created as a new, independent record (new ID) once saved; it does not overwrite or link to the original. | TC-54756 (new id) · TC-54757 (source untouched) · TC-54758 (own image assets) · TC-54759 (survives source deletion) · TC-54760 (id/coupon/media not shared) | **PASS** |
| **AC4** | The duplicated perk defaults to unfeatured status, regardless of the source perk's Featured state. | — no test case, deliberately | **NOT VERIFIABLE** |

## AC4 — why it is Not Verifiable rather than Pass or Fail

**What the code does.** `initDuplicateForm()` in the deployed bundle
(`28-es2018.6c1d5725b98bf99c2aeb.js`) contains:
```js
"featured" in perk && (perk.featured = false);
perk.perk_attributes && "featured" in perk.perk_attributes && (perk.perk_attributes.featured = false);
```
Both are **guarded by an `in` check**, so they only fire if a `featured` key exists on the record.

**What the data has.** It does not. Verified on 2026-08-09:
- `POST /api/v1/web/card/perks/list` and `/perks/get` → **zero** occurrences of `featured` in any perk
  record (15 perks, all types).
- The perks-list columns are Perk ID · Category · Type · Title · Description · Status · Actions —
  **no Featured column**.
- Neither the blank Add-Perk form nor the pre-filled Duplicate form renders any Featured control.

**What the design has.** The Figma frame for this very screen **does** draw a per-row **Featured
checkbox column** (first row checked). So Featured is a designed concept that has not been built on
this surface.

**Conclusion.** The reset is implemented defensively and correctly, but there is no Featured
attribute for it to reset and no way to observe the outcome. Asserting a pass would be asserting an
oracle that does not exist; asserting a fail would blame this story for a field it never owned.
→ Reported as **Not Verifiable**, escalated to product as a requirements question:
*is Featured a later-phase field, or has it been dropped?*

## Coverage beyond the ACs (regression + risk)
| Area | Case |
|---|---|
| Add Perk from scratch unaffected by the shared component's duplicate mode | TC-54764 |
| Perks list integrity after insertion | TC-54765 |
| Validation parity with normal Add Perk | TC-54761 |
| No draft/orphan on abandon | TC-54762 · TC-54763 |
| Delete's pre-existing Planned-only gating | TC-54745 |
