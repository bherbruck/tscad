# Union of a solid with a filleted copy of itself fails (status 1001; "proto edge is deleted" when placed)

**solidcore rev:** `e7627f7f18176460ad4fb64fd1376fd66e1fe3b3`
**Found by:** tscad's IR fuzzer: `eval-error-union-p8rb0n`. **Repro:** `upstream_repros.rs` → `own_fillet` and `own_fillet_placed`.

## Repro

```rust
use solidcore_ops as ops;
use solidcore_ops::sweep::Curve;
use solidcore_ops::{Blend, BlendOptions, BooleanOp::Union, Corners};
use solidcore_record::brep as rec;

fn sector() -> ops::Body {
    // the quad (r, z) = (3,0) (5,0) (13,28) (3,28) turned 2.8 rad about Z
    let p = [[3.0, 0.0], [5.0, 0.0], [13.0, 28.0], [3.0, 28.0]];
    let profile: Vec<Curve> = (0..4).map(|i| Curve::Line { start: [p[i][0], 0.0, p[i][1]], end: [p[(i + 1) % 4][0], 0.0, p[(i + 1) % 4][1]] }).collect();
    ops::sweep::revolve(&profile, [0.0; 3], [0.0, 0.0, 1.0], 2.8, true).unwrap()
}

#[test]
fn union_with_own_fillet() {
    let a = sector();
    let b = sector();
    // round the two radial edges of the start cap (the straight edges along X), r = 2.6
    let (record, order) = b.to_record().unwrap();
    let edges: Vec<usize> = record.edges.iter().enumerate().filter_map(|(i, e)| match &e.curve {
        rec::Curve::Line { start, end } if (end[1] - start[1]).abs() < 1e-9 && (end[2] - start[2]).abs() < 1e-9 => Some(i),
        _ => None,
    }).collect();
    ops::blend_ordered(&b, &order, Blend::Round, &edges, &[2.6], &[], Corners::Filled, BlendOptions::default()).unwrap();
    let v = a.volume(1e-6).unwrap();
    // b lies inside a, so a ∪ b = a
    let u = ops::boolean::boolean(a, b, Union).expect("union").expect("not empty"); // Err: solidcore failed (status 1001)
    assert!((u.volume(1e-6).unwrap() - v).abs() < 1e-3);
}
```

The placed variant applies the fillet to a copy first rotated by the row-vector matrix `[[0,-1,0,0],[1,0,0,0],[0,0,1,0],[-13.5,11.863,2.677,1]]`, rounding the edges along Y. It then moves both solids by `[[1,0,0,0],[0,0,-1,0],[0,1,0,0],[-1,-7,9,1]]`. This variant fails with **topology::proto_topology::p3: proto edge is deleted** instead. See `own_fillet_placed` for the exact code.

## Expected
`a ∪ b = a`: the same volume as the sector.

## Actual
`Err`: **solidcore failed (status 1001)**. The placed variant gives **proto edge is deleted**.

## Notes
- The fillet itself succeeds, and the filleted copy alone is a valid solid.
- **The other booleans also go wrong.** `fillet(b) − a` comes back empty, which is correct. But `fillet(b) ∩ a` fails with "the result is not a closed solid".
- **A half turn (π) passes:** the same sector revolved π instead of 2.8 rad, and a rectangular tube profile, both union correctly with their filleted copies.
- Most faces of the two operands coincide exactly, so this is probably related to [near-coincident-curved-faces](near-coincident-curved-faces.md). The difference is that here the faces are *exactly* coincident, apart from the fillet's tangent joins.
