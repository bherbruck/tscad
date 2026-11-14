# After a nearly rigid transform, a union evaluates but its record fails: "a conic's NURBS is off its own frame and radii"

**solidcore rev:** `e7627f7f18176460ad4fb64fd1376fd66e1fe3b3`
**Found by:** tscad's IR fuzzer: `warning-union-7u3v7n`. **Repro:** `upstream_repros.rs` → `conic_off_frame`.

## Repro

```rust
use solidcore_ops as ops;
use solidcore_ops::BooleanOp::{Intersect, Union};

#[test]
fn conic_off_frame() {
    // a rotation written to 6 decimals (orthonormal only to ~1e-6), then a move; row-vector form
    let m = [
        [0.848916, 0.524678, 0.06367, 0.0],
        [-0.379173, 0.688512, -0.618206, 0.0],
        [-0.368197, 0.500663, 0.783433, 0.0],
        [23.386408, 12.866874, 1.099944, 1.0],
    ];
    let cyl = || { let c = ops::make_cylinder([0.0; 3], 10.0, 24.5).unwrap(); c.transform(&m).unwrap(); c };
    let p1 = ops::boolean::boolean(ops::make_box([0.0; 3], [37.8, 38.0, 21.4]).unwrap(), cyl(), Intersect).unwrap().unwrap();
    let p2 = ops::boolean::boolean(ops::make_box([0.0; 3], [38.0, 38.0, 21.0]).unwrap(), cyl(), Intersect).unwrap().unwrap();
    let u = ops::boolean::boolean(p1, p2, Union).unwrap().unwrap(); // ok, volume 7031.645
    u.to_record().expect("record"); // Err: curve::from_parameters::record_of: a conic's NURBS is off its own frame and radii
}
```

## Expected
The record is built: it exists to be meshed, exported and inspected.

## Actual
The union succeeds with volume 7031.645, but `to_record()` fails with **a conic's NURBS is off its own frame and radii**.

## Notes
- **An exact rotation passes.** With `cos`/`sin` computed in full precision, the same construction builds its record.
- **Each piece alone is fine**, and so is the union of a piece with itself. It takes the two slightly different boxes (37.8 × 21.4 vs 38 × 21), whose faces nearly coincide, to fail.
- The matrix passes `Transform::is_regular`, so `Body::transform` accepts it. The circles it produces are very slightly elliptic. One option is to snap nearly orthonormal matrices before applying them; tscad now does this for tori. The other is to tolerate conics whose NURBS is off by about 1e-6.
