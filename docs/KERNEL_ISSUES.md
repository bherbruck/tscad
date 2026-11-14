# solidcore issues found while building tscad

Pinned mirror rev: `e7627f7f18176460ad4fb64fd1376fd66e1fe3b3` (github.com/tangency-labs/solidcore).
Each entry: what happens, a minimal tscad IR repro, and the tscad-side workaround (if any).
These have NOT been filed upstream.

## 1. STEP writer emits cylinders as zero-angle cones
- `solidcore_step::write::product::solidcore_bodies` writes fillet rounds (cylinders) as
  `CONICAL_SURFACE('',#n,2.0,0.0)`. The semi-angle 0 is refused by solidcore's own STEP reader
  ("cone with a negative radius or a semi angle outside (0, 90°)") and is likely refused by
  other CAD tools.
- Repro: `{"type":"fillet","radius":2,"edges":{"type":"max","axis":"z"},"children":[{"type":"box","size":[20,20,10]}]}` → `Kernel.step()`.
- Workaround: `engine::cones_to_cylinders` rewrites them to `CYLINDRICAL_SURFACE` after writing.

## 2. STEP read: no pcurve of a NURBS edge on a spline surface
- Reading back a filleted box (blend corner patches) fails:
  `pcurves: ... not supported yet: no exact pcurve of a NURBS on a spline surface`
  (`solidcore_ops::pcurve::pcurves_within`). SolidCraft gets these pcurves from its separate
  `smlib` crate, which is not in the solidcore mirror.
- Repro: write the model from issue 1 to STEP, then evaluate `{"type":"step","data":<text>}`.
- Workaround: none; `<import>` of such files fails with that message.

## 3. Union of overlapping spheres is slow
- Six spheres r=4 spaced 7 apart along X, unioned: ~4.5 s in wasm (O3), vs ~0.2 s for a filleted
  plate with a hole. Not wrong, just slow (sphere/sphere SSI).

## 4. Inward shell across tangent walls fails
- Shell (thickness -1, top face open, closed, or bottom open) of an extruded rounded rectangle →
  "the result is not a closed solid". The same body shelled outward (+1) works, and an inward
  shell of a cylinder works.
- Repro: `crates/tscad-wasm/tests/select_debug.rs` (`rounded_rect_top_fillet`, "shell" cases).
- Workaround: none yet; use `outward` or build the cavity with a boolean.

## Notes (tscad bugs found and fixed, not kernel bugs)
- `solidcore_ops::blend` takes the kernel's *native* edge order, not record order (its
  `SetBack` docs say so; the function's own docs read as record indices). tscad now uses
  `blend_ordered` with the record's `Order`. Before that, `fillet` rounded the wrong edges.
- `EdgeNotBlendable { edge }` reports the native position, which callers of the ordered API
  can't map back; tscad pre-filters seam and tangent (smooth) edges from broad selectors instead.
