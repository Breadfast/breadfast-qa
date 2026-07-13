# Instructions: Exporting Figma Frames as Individual Images (ZIP)

## Purpose
Export multiple frames/screens from a Figma file as **separate image files**
(never as one merged/collage image), packaged into a single .zip — useful
for design handoff, visual regression testing, or asset generation.

## Prerequisites
- A Figma file URL (view or edit access both work for exporting).
- Know roughly how many frames/screens you expect to export, so you can
  verify the output count matches.

## Exact Step-by-Step Process (tested and confirmed working)

1. **Open the Figma file** at the provided URL.

2. **Collapse all layers** first:
   - In the Layers panel header, click the "Collapse layers" icon (the
     small icon at the top-right of the "Layers" label).
   - This resets the tree so nothing is expanded, preventing nested
     children from accidentally being swept into a range-selection later.

3. **Expand only ONE level** of the target frame/section:
   - Click the small arrow/chevron directly next to the target frame
     (e.g. "Phase 1") to expand just its direct children.
   - Do NOT click into any of those children's own arrows — leave them
     collapsed. This keeps the visible list to true siblings only.

4. **Select the first child**:
   - Click the very first item in the expanded list (e.g. "Category
     added").

5. **Scroll all the way down** inside the Layers panel (not the canvas)
   until you reach the **last** direct child of the target frame:
   - Keep scrolling until you see the sibling layers that come AFTER the
     target frame (e.g. a bold "Header" or "Phase 2" sitting at a
     shallower indent level). The last child you want is the item
     directly above that shift in indentation.
   - Do not stop scrolling early — stopping before reaching the true end
     is the #1 cause of an incomplete selection (e.g. getting only ~11
     items instead of the full 75).

6. **Shift+click the last child** identified in step 5.
   - Check the right-hand Properties panel — it should now say
     "N Selected" where N matches your expected total layer count.
   - If the number is lower than expected, you stopped scrolling too
     early; repeat steps 4–6.

7. **Check for duplicate layer names** before exporting:
   - Layers with identical names (e.g. two layers both named "Header" or
     "Adding a category") will overwrite each other inside the zip,
     silently reducing your final file count below what you selected.
   - This is expected and generally harmless if the duplicates are truly
     redundant; if you need every one preserved, export duplicates in
     separate batches and rename the downloaded files manually, or ask
     an editor to rename the layers uniquely first.

8. **Configure export settings** (right panel → Export section):
   - Click **+** to add export settings if none exist yet.
   - Scale: **2x** (recommended default — crisp detail, good for visual
     testing/pixel-diffing). Use 1x if you need exact-resolution matching
     against a live rendered app instead.
   - Format: **PNG** (lossless — preferred for UI screens).

9. **Click "Export N layers"** and wait — for ~75 layers at 2x this can
   take 15–25 seconds. A black "Exporting..." tooltip will show while
   processing; wait for it to disappear.

10. **Verify the result**: open the downloaded zip and count the files.
    Expect the count to be at or slightly below your selected count (the
    gap = duplicate-named layers that overwrote each other). If the count
    is drastically lower (e.g. 10-15% of expected), redo steps 2–6 more
    carefully — you likely mis-scrolled the range selection.

## Common pitfalls
- Selecting a **parent container** (e.g. a row/group that holds several
  screens side by side) exports that container as ONE flattened image
  containing all the screens inside it — this looks like a "collage" and
  is usually not what's wanted. Always select the individual screen
  frames themselves, not their parent wrapper.
- Range-selecting (Shift+click) without scrolling the Layers panel all
  the way to the true last sibling first is the most common mistake and
  produces a much smaller selection than intended.
- Range-selecting in an **expanded** (multi-level) layers tree can
  accidentally include nested child layers between your two click
  points, inflating your selection beyond just the sibling frames you
  intended. Always collapse first, then expand only one level.