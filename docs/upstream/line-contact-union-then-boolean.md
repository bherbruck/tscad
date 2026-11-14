# After a union of solids that touch along a line, the next boolean fails ("not a closed solid", "mass::enclosure")

**solidcore rev:** `e7627f7f18176460ad4fb64fd1376fd66e1fe3b3`
**Found by:** tscad's IR fuzzer: `eval-error-union-12i29k` (142 hits) and `eval-error-union-z6e8di`. **Repro:** `upstream_repros.rs` → `line_contact_reunion` and `line_contact_enclosure`.

## Repro

```rust
use solidcore_ops as ops;
use solidcore_ops::BooleanOp::Union;

#[test]
fn line_contact_reunion() {
    let cyl = || ops::make_cylinder([15.0, 5.0, 2.0], 5.0, 5.0).unwrap(); // touches the box's x = 10 face along a line
    let bc = ops::boolean::boolean(ops::make_box([0.0; 3], [10.0; 3]).unwrap(), cyl(), Union).unwrap().unwrap(); // ok: 1392.699
    let v = bc.volume(1e-6).unwrap();
    // unioning the same cylinder again changes nothing...
    let again = ops::boolean::boolean(bc, cyl(), Union).expect("re-union").expect("not empty");
    assert!((again.volume(1e-6).unwrap() - v).abs() < 1e-3);
}

#[test]
fn line_contact_third_solid() {
    let left = || ops::make_cylinder([-4.0, 0.0, -4.0], 3.0, 8.0).unwrap();
    let boxy = || ops::make_box([-5.0; 3], [10.0; 3]).unwrap();
    let tangent = || ops::make_cylinder([10.0, 0.0, -2.0], 5.0, 4.0).unwrap(); // touches the box's x = 5 face
    // (left ∪ box) ∪ tangent works and gives the reference volume
    let reference = ops::boolean::boolean(ops::boolean::boolean(left(), boxy(), Union).unwrap().unwrap(), tangent(), Union).unwrap().unwrap();
    // left ∪ (box ∪ tangent) fails
    let bt = ops::boolean::boolean(boxy(), tangent(), Union).unwrap().unwrap();
    let u = ops::boolean::boolean(left(), bt, Union).expect("union").expect("not empty");
    assert!((u.volume(1e-6).unwrap() - reference.volume(1e-6).unwrap()).abs() < 1e-3);
}
```

## Expected
Unioning the same cylinder again leaves the volume unchanged at 1392.699 mm³. A union is associative, so the second test should give the same volume in either grouping.

## Actual
- Re-union: `Err`: **the result is not a closed solid**.
- Third solid: `Err`: **mass::enclosure: a face whose sides are not one material region and one void**.

## Notes
- **The first union is fine and its body behaves normally** for ordinary operations: unioning a box inside it, a cylinder crossing it, a disjoint box, subtracting a box, or intersecting with a box all work. The failures come when the new operand meets the region of the line contact.
- **Spanning the box's full height avoids it.** If the cylinder runs the box's whole height (z 0..10) or rises above its top (z 2..14), the re-union works. It fails when the contact line ends on the box's face: cylinder z 2..7, or z −2..12.
- The fuzzer's original `12i29k` is a rounded-rectangle prism with a tangent extruded circle, unioned with that circle again. `z6e8di` is a box 37.922 × 30 × 32.97 plus a cylinder r9.5 at x = 41.461 (tangent), then unioned with a cylinder r12. Both reduce to the repros above.
