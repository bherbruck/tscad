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

## 5. Sweep along a helix fails or is slow
- `sweep` (frame follow) of a circle along a helix NURBS: 10–23 s on the dev wasm, then
  "the result is not a closed solid"; `frame: "translate"` gives a near-zero volume.
- `sweep` along a polyline path with a sharp corner fails with status 1001.

## 6. Booleans are ~1 s per cut on the dev wasm
- A plate with 24 slot holes: 18–21 s cut one by one, ~7 s as one `difference(outer, union(holes))`.

## 7. Transforming a torus leaves a non-finite tolerance (confirmed on the raw ops API)
- `solidcore_ops::make_torus([0;3], 20, 3)` then `Body::transform` with a pure translation
  (row 3 = [5,0,0,1]): volume is still right, but `Body::to_record()` fails with "the body's
  tolerance is not finite and positive", so the body can't be meshed, picked or exported.
  Rotations fail the same way, and a rotated torus then fails tessellation
  ("pcurve is 3.6 mm off the edge").
- Repro: `crates/tscad-wasm/tests/fuzz_triage.rs`.
- Workaround: a `transform` directly over a `torus` (after composing nested transforms) is
  built in place as a circle revolved about the moved axis, which has no such problem and also
  fixes #8 for that case. A torus inside a moved union is still affected.

## 8. Boolean of a rotated torus with itself is wrong
- `difference(T, T)` with T = torus(20, 3) rotated 30° about X returns all of T (3553 mm³)
  instead of nothing; union and intersection give the same volume. Unrotated, it is right.
- Found by the fuzzer (docs/FUZZ.md has 31 distinct findings, minimal repros in fuzz/findings/).

## 9. More fuzzer findings (see docs/FUZZ.md)
- box − torus evaluates "ok" with a kernel volume of 0 (mesh says 1397 mm³);
- torus ∪ cylinder: mesh volume 52% below the kernel volume;
- side-by-side touching cylinders: union mesh not watertight; one extruded star polygon too;
- solids booleaned with a copy moved by 1e-5..1e-3 mm: "not a closed solid" / status 1001;
- ~10 boolean failures on revolves / rotated extrudes ("SmFace::PointClassify not supported yet",
  "proto edge is deleted", "mass::enclosure", empty unions).

## 10. union_all refuses a union that pairwise unions (in the right order) accept
- Three extruded rounded rectangles: two disjoint plates (z 0..0.8 and 2.6..5) and a third
  touching the second at z = 5. `union_all` → "the result is not a closed solid"; folding left to
  right fails too (disjoint ∪ disjoint, then the touching one). Unioning the large touching one
  first, then the rest, works. Boxes in the same layout work.
- Workaround: when `union_all` refuses, tscad unions greedily, largest body first, retrying any
  union that fails after the others (`eval::union`).

## 11. Extruding the DejaVu Sans glyph "s" at 11–13 mm fails
- "the result is not a closed solid", only at those sizes; the glyph's many short Bézier edges.
- Workaround (core): consecutive glyph Béziers are joined into one C0 B-spline (same curve,
  fewer edges).

## 12. solidcore-ops serialises every operation process-wide
- `solidcore_ops::session` holds one `static KERNEL: Mutex<Option<Kernel>>`; every op locks it,
  so two threads evaluating different bodies in one process run one after the other (measured
  in tscad's dev server: two native part evaluations on two bun threads took 3.1 s and 4.0 s
  vs 1.9 s alone). The kernel crate itself is "one Kernel per thread"; the ops layer is not.
- Workaround: parallelism across processes (or wasm instances), not threads.

## 13. An oversized fillet is accepted instead of refused
- `fillet radius 8` on all edges of a 10 mm cube returns ok with volume 962 mm³; a radius above
  half the edge length cannot be built, so a refusal (`TooLarge` / `NoRoom`) is expected.
- Found by MCP dogfooding (docs/mcp-dogfood.md).

## 14. Intersecting a nested lip with its rim: PointClassify unsupported
- Board case base ∩ its lid (the lid's locating lip nested inside the rim, faces touching) →
  "not supported yet: SmFace::PointClassify" — the same unsupported path as the fuzzer's
  PointClassify findings (docs/upstream/pointclassify-cut-rounded-prism.md). Interference
  checks of board-vs-base and board-vs-lid work.

## 15. Extrude depends on the profile's winding
- A closed profile of one cubic Bézier + two lines (an involute gear's root fillet) extruded with
  `ops::sweep::extrude` → "the result is not a closed solid"; the same loop traversed the other
  way extrudes fine (0.3044 mm³ either way once built). Found by the example param sweep: it
  sank spur-gear (7/33 combos) and the gear-pair recipe (19/33).
- Repro: `crates/tscad-wasm/tests/fuzz_triage.rs` (`gear_fillet_extrude_orientation`).
- Workaround: on failure tscad retries the extrude with the loop reversed (`eval::reversed`).

## 16. Union of a 6×3 grid of overlapping cylinders fails
- r 4.85, h 21, pitch 11.72 × 8.3 (rows overlap): "the result is not a closed solid" after ~18 s;
  5×3, 6×2 and 3×3 work. Found by the example sweep.

## Notes (tscad bugs found and fixed, not kernel bugs)
- `solidcore_ops::blend` takes the kernel's *native* edge order, not record order (its
  `SetBack` docs say so; the function's own docs read as record indices). tscad now uses
  `blend_ordered` with the record's `Order`. Before that, `fillet` rounded the wrong edges.
- `EdgeNotBlendable { edge }` reports the native position, which callers of the ordered API
  can't map back; tscad pre-filters seam and tangent (smooth) edges from broad selectors instead.
