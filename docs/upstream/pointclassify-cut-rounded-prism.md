# Boolean fails with "not supported yet: SmFace::PointClassify" when a cut rounded prism meets a cylinder

**solidcore rev:** `e7627f7f18176460ad4fb64fd1376fd66e1fe3b3` (crates `solidcore-ops`)
**Found by:** tscad's IR fuzzer. Fuzz findings: `eval-error-union-2rn907`, `eval-error-difference-1rmnn7` and `eval-error-intersection-1cmf4z`, all with the same message. **Repro:** `crates/tscad-wasm/tests/upstream_repros.rs` → `pointclassify`.

## Repro

```rust
use solidcore_ops as ops;
use solidcore_ops::sweep::{Curve, DraftCorner};
use solidcore_ops::BooleanOp;
use std::f64::consts::{FRAC_PI_2, PI};

/// 8 × 8 rectangle with 1 mm corner radii, centred, z = 0, CCW
fn rounded_rect(w: f64, h: f64, r: f64) -> Vec<Curve> {
    let (x, y) = (w / 2.0, h / 2.0);
    let line = |a: [f64; 3], b: [f64; 3]| Curve::Line { start: a, end: b };
    let arc = |cx: f64, cy: f64, a: f64| Curve::Arc { center: [cx, cy, 0.0], axis: [0.0, 0.0, 1.0], reference: [1.0, 0.0, 0.0], radius: r, start: a, end: a + FRAC_PI_2 };
    vec![
        line([-x + r, -y, 0.0], [x - r, -y, 0.0]), arc(x - r, -y + r, -FRAC_PI_2),
        line([x, -y + r, 0.0], [x, y - r, 0.0]), arc(x - r, y - r, 0.0),
        line([x - r, y, 0.0], [-x + r, y, 0.0]), arc(-x + r, y - r, FRAC_PI_2),
        line([-x, y - r, 0.0], [-x, -y + r, 0.0]), arc(-x + r, -y + r, PI),
    ]
}

#[test]
fn pointclassify_cut_rounded_prism() {
    // a rounded-rectangle prism, z 0..20
    let prism = ops::sweep::extrude(&rounded_rect(8.0, 8.0, 1.0), [0.0, 0.0, 1.0], 20.0, 0.0, DraftCorner::default(), true).unwrap();
    // cut its bottom off with a box (z -5..5): the prism now starts at z = 5
    let cut = ops::boolean::boolean(prism, ops::make_box([-10.0, -10.0, -5.0], [20.0, 20.0, 10.0]).unwrap(), BooleanOp::Subtract).unwrap().unwrap();
    // union with a cylinder that contains the cut face (z 0..10)
    let cyl = ops::make_cylinder([0.0; 3], 10.0, 10.0).unwrap();
    let u = ops::boolean::boolean(cut, cyl, BooleanOp::Union).expect("union").expect("not empty");
    let expect = PI * 100.0 * 10.0 + (64.0 - (4.0 - PI)) * 10.0; // 3773.009
    assert!((u.volume(1e-6).unwrap() - expect).abs() < 1e-3);
}
```

## Expected
The union evaluates to a cylinder plus the 10 mm of prism above it, with volume 3773.009 mm³.

## Actual
`boolean(…, Union)` returns `Err`: **not supported yet: SmFace::PointClassify**.

## Notes
- **It passes when the prism has no boolean-made face.** Extruding the same prism 15 mm and translating it to z = 5 instead of cutting it gives the right volume (control test `pointclassify_control`). So the trigger is the planar face that the subtraction created.
- **Swapping either operand for a box makes it pass.** A box body cut the same way, unioned with the cylinder, works. A cylinder body works too. The cut prism unioned with a *box* also works. It fails when the cut rounded prism (planes plus quarter-cylinder corner faces) meets a curved tool.
- **The size of the tool doesn't matter.** Cutting with a box or a cylinder both fail. So does a union cylinder of r10 or r20, and corner radii of 0.99 or 1.
- The other two findings with this message, `eval-error-difference-1rmnn7` (a box minus a rotated stadium prism minus a cone) and `eval-error-intersection-1cmf4z` (a cylinder ∩ a revolve ∪ a stadium prism), also involve a rounded-rectangle prism. They are probably the same missing `PointClassify` case.
