# Subtracting an internally tangent cylinder gives "the result is not a closed solid"

**solidcore rev:** `e7627f7f18176460ad4fb64fd1376fd66e1fe3b3`
**Found by:** tscad's IR fuzzer: `eval-error-difference-45zuhc`, 220 hits, the most frequent bug of the first campaign. **Repro:** `upstream_repros.rs` → `internal_tangent`.

## Repro

```rust
use solidcore_ops as ops;
use solidcore_ops::BooleanOp;
use std::f64::consts::PI;

#[test]
fn internally_tangent_cylinder_subtract() {
    let a = ops::make_cylinder([0.0; 3], 10.0, 10.0).unwrap();
    // r5 at x = 5: touches the inside of a's wall along the line x = 10, y = 0
    let b = ops::make_cylinder([5.0, 0.0, -5.0], 5.0, 20.0).unwrap();
    let d = ops::boolean::boolean(a, b, BooleanOp::Subtract).expect("subtract").expect("not empty");
    assert!((d.volume(1e-6).unwrap() - PI * 75.0 * 10.0).abs() < 1e-3); // 2356.194
}
```

## Expected
A cylinder with a crescent-shaped slot open to its wall along one line, with volume π·(100 − 25)·10 = 2356.194 mm³.

## Actual
`Err`: **the result is not a closed solid**.

## Notes
- **Moving the tool off tangency makes it pass:** with the tool at x = 4.9, the volume is 2356.194 (control `internal_tangent_control`).
- **The other booleans of the same pair are correct:** union gives 3926.991 and intersection gives 785.398.
- **External tangency is fine:** a cylinder r5 at x = 15, outside and touching, can be subtracted or unioned.
- **It doesn't depend on height or sizes.** It fails for a tool shorter than, equal to or taller than the target. It also fails with r13 and r4.5 at an axis distance of 8.5, and when the target is an extruded circle mirrored by a rotation.
