# Booleans of nearly coincident curved solids fail: "not a closed solid", status 1001, or an EMPTY union

**solidcore rev:** `e7627f7f18176460ad4fb64fd1376fd66e1fe3b3`
**Found by:** tscad's IR fuzzer:
- `eval-error-intersection-16ioib`: spheres
- `eval-error-union-1krj4p` and `eval-error-intersection-sqt0xg`: status 1001
- `eval-error-union-eudjyq`: an empty union

**Repro:** `upstream_repros.rs` → `near_spheres`, `near_cylinders` and `near_revolve_empty_union`.

## Repro

```rust
use solidcore_ops as ops;
use solidcore_ops::BooleanOp::{Intersect, Union};
use solidcore_ops::sweep::Curve;
use std::f64::consts::{PI, TAU};

#[test]
fn spheres_1e3_apart() {
    let a = ops::make_sphere([0.0; 3], 10.0).unwrap();
    let b = ops::make_sphere([0.0, 1e-3, 0.0], 10.0).unwrap();
    let i = ops::boolean::boolean(a, b, Intersect).expect("intersect").expect("not empty"); // Err: not a closed solid
    let (r, d) = (10.0_f64, 1e-3_f64);
    assert!((i.volume(1e-6).unwrap() - PI * (4.0 * r + d) * (2.0 * r - d).powi(2) / 12.0).abs() < 1e-3);
}

#[test]
fn cylinders_1e4_apart() {
    let a = ops::make_cylinder([0.0; 3], 10.0, 10.0).unwrap();
    let b = ops::make_cylinder([0.0, 1e-4, 0.0], 10.0, 10.0).unwrap();
    ops::boolean::boolean(a, b, Union).expect("union"); // Err: solidcore failed (status 1001)
}

#[test]
fn revolved_copy_1e5_apart_union_is_empty() {
    let pts = [[2.0, 0.0], [4.224, 0.0], [5.0, 2.666667], [16.542, 5.333333], [9.0, 8.0], [2.0, 8.0]];
    let solid = || {
        let n = pts.len();
        let profile: Vec<Curve> = (0..n).map(|i| Curve::Line { start: [pts[i][0], 0.0, pts[i][1]], end: [pts[(i + 1) % n][0], 0.0, pts[(i + 1) % n][1]] }).collect();
        let b = ops::sweep::revolve(&profile, [0.0; 3], [0.0, 0.0, 1.0], TAU, true).unwrap();
        // rotate -90° about Y and move (row-vector matrix)
        b.transform(&[[0.0, 0.0, -1.0, 0.0], [0.0, 1.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], [8.0, 8.5, -0.5, 1.0]]).unwrap();
        b
    };
    let a = solid();
    let b = solid();
    b.transform(&[[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 1e-5, 0.0, 1.0]]).unwrap();
    let u = ops::boolean::boolean(a, b, Union).expect("union");
    assert!(u.is_some(), "the union of two solids came back EMPTY"); // fails: union_all reports Error::Empty / boolean returns None
}
```

## Expected
Either a correct result, or a clean, documented refusal for offsets below the kernel's resolution. A union of two non-empty solids can never be empty.

## Actual
For the same pair of solids, the error changes with the offset:

| Operands | Offset | Result |
|---|---|---|
| sphere r10 ∩ / ∪ / − moved copy | 0.1, 0.01 | correct |
| | 1e-3, 1e-4 | **not a closed solid** (all three operations) |
| | 1e-5 | ∩ and ∪: not a closed solid; − returns empty |
| | 1e-6 | correct, taken as coincident |
| cylinder r10 h10 ∪ copy moved sideways | 1e-2, 1e-3 | correct |
| | 1e-4 | **status 1001** |
| | 1e-5 | **not a closed solid**, for ∪ and ∩ |
| cylinder moved along its axis | 1e-2 … 1e-5 | correct |
| revolved solid ∪ moved copy, unrotated | 1e-3 … 1e-6 | not a closed solid or status 1001, alternating |
| the same, rotated −90° about Y | 1e-5 | **union is EMPTY** |

## Notes
- **Only curved faces that nearly coincide trigger it.** Planar faces offset by the same amounts are fine, and so is a cylinder moved along its own axis, where only the planar caps are offset.
- The revolved-profile case fails even at 1e-6, below the 1e-5 to 1e-3 range of the spheres. Its cone and cylinder faces lie close together over a large area.
- **The empty union is the most serious symptom:** it is a wrong answer rather than a refusal. In tscad it surfaces as "the result is empty" from `union_all`.
- `eval-error-union-1krj4p` is the same failure on a rotated, extruded circle: subtract a copy moved 1e-3 along z, then union a copy moved 1e-3 along y.
