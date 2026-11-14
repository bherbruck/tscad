//! Upstream-ready reproductions of solidcore bugs found by tscad's fuzzer (docs/FUZZ.md),
//! written against `solidcore_ops` (and `solidcore_record` for edge picking) only, with no tscad
//! code, so they can be pasted into solidcore's own tests. One section per issue draft in
//! `docs/upstream/<slug>.md`.
//!
//! `cargo test -p tscad-wasm --test upstream_repros -- --nocapture` prints a status table and
//! never fails; `-- --ignored` runs each repro as an asserting test (they fail while the bug is
//! there).
//!
//! Conventions: `Body::transform` takes a row-vector matrix (`p' = p A + t`, translation in the
//! last row); `ops::blend_ordered` takes edge indices into the record order returned with
//! `to_record` (plain `ops::blend` takes the kernel's native order).

use solidcore_ops as ops;
use solidcore_ops::sweep::{Curve, DraftCorner};
use solidcore_ops::{Blend, BlendOptions, Body, BooleanOp, Corners};
use solidcore_record::brep as rec;
use std::f64::consts::{FRAC_PI_2, PI, TAU};

type Out = Result<String, String>;

// ---------------------------------------------------------------------------------------------
// helpers (ops only)

fn moved(b: Body, x: f64, y: f64, z: f64) -> Body {
    b.transform(&[[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [x, y, z, 1.0]]).unwrap();
    b
}

/// Apply a column-vector matrix written row by row (`p' = M p`, translation in the last
/// column); the transpose is what `Body::transform` takes.
fn mapped(b: Body, m: [f64; 12]) -> Body {
    let k = [[m[0], m[4], m[8], 0.0], [m[1], m[5], m[9], 0.0], [m[2], m[6], m[10], 0.0], [m[3], m[7], m[11], 1.0]];
    b.transform(&k).unwrap();
    b
}

/// `a · b` of two column-vector 3×4 matrices (apply b, then a).
fn compose(a: [f64; 12], b: [f64; 12]) -> [f64; 12] {
    let g = |m: &[f64; 12], r: usize, c: usize| if c < 4 { m[r * 4 + c] } else { 0.0 };
    let mut o = [0.0; 12];
    for r in 0..3 {
        for c in 0..4 {
            o[r * 4 + c] = (0..3).map(|k| g(&a, r, k) * g(&b, k, c)).sum::<f64>() + if c == 3 { a[r * 4 + 3] } else { 0.0 };
        }
    }
    o
}

fn line(a: [f64; 3], b: [f64; 3]) -> Curve {
    Curve::Line { start: a, end: b }
}

/// A `w` × `h` rectangle centred on the origin in z = 0, corners rounded by `r` (CCW).
fn rounded_rect(w: f64, h: f64, r: f64) -> Vec<Curve> {
    let (x, y) = (w / 2.0, h / 2.0);
    let arc = |cx: f64, cy: f64, a: f64| Curve::Arc {
        center: [cx, cy, 0.0],
        axis: [0.0, 0.0, 1.0],
        reference: [1.0, 0.0, 0.0],
        radius: r,
        start: a,
        end: a + FRAC_PI_2,
    };
    vec![
        line([-x + r, -y, 0.0], [x - r, -y, 0.0]),
        arc(x - r, -y + r, -FRAC_PI_2),
        line([x, -y + r, 0.0], [x, y - r, 0.0]),
        arc(x - r, y - r, 0.0),
        line([x - r, y, 0.0], [-x + r, y, 0.0]),
        arc(-x + r, y - r, FRAC_PI_2),
        line([-x, y - r, 0.0], [-x, -y + r, 0.0]),
        arc(-x + r, -y + r, PI),
    ]
}

/// A closed polygon in the XZ plane (x = radius, z = height) revolved `angle` about +Z.
fn revolved(pts: &[[f64; 2]], angle: f64) -> ops::Result<Body> {
    let n = pts.len();
    let profile: Vec<Curve> = (0..n).map(|i| line([pts[i][0], 0.0, pts[i][1]], [pts[(i + 1) % n][0], 0.0, pts[(i + 1) % n][1]])).collect();
    ops::sweep::revolve(&profile, [0.0; 3], [0.0, 0.0, 1.0], angle, true)
}

fn union(a: Body, b: Body) -> ops::Result<Option<Body>> {
    ops::boolean::boolean(a, b, BooleanOp::Union)
}
fn subtract(a: Body, b: Body) -> ops::Result<Option<Body>> {
    ops::boolean::boolean(a, b, BooleanOp::Subtract)
}
fn intersect(a: Body, b: Body) -> ops::Result<Option<Body>> {
    ops::boolean::boolean(a, b, BooleanOp::Intersect)
}

fn vol(b: &Body) -> f64 {
    b.volume(1e-6).unwrap_or(f64::NAN)
}

/// A boolean that must give a body of volume `expect` (relative 1e-4).
fn expect_volume(what: &str, r: ops::Result<Option<Body>>, expect: f64) -> Out {
    match r {
        Ok(Some(b)) => {
            let v = vol(&b);
            if (v - expect).abs() <= 1e-4 * expect.abs().max(1.0) {
                Ok(format!("{what}: volume {v:.3} as expected"))
            } else {
                Err(format!("{what}: volume {v:.3}, expected {expect:.3}"))
            }
        }
        Ok(None) => Err(format!("{what}: empty result, expected volume {expect:.3}")),
        Err(e) => Err(format!("{what}: {e}")),
    }
}

/// Indices (into the record order) of the straight edges along `dir`.
fn lines_along(record: &rec::Brep, dir: [f64; 3]) -> Vec<usize> {
    record
        .edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| match &e.curve {
            rec::Curve::Line { start, end } => {
                let d = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
                let l = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
                let c = (d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]).abs() / l;
                (c > 1.0 - 1e-9).then_some(i)
            }
            _ => None,
        })
        .collect()
}

/// Round (in place) the straight edges of `b` along `dir`.
fn round_lines_along(b: &Body, dir: [f64; 3], radius: f64) -> ops::Result<()> {
    let (record, order) = b.to_record()?;
    let edges = lines_along(&record, dir);
    ops::blend_ordered(b, &order, Blend::Round, &edges, &[radius], &[], Corners::Filled, BlendOptions::default()).map(|_| ())
}

// ---------------------------------------------------------------------------------------------
// 1. pointclassify-cut-rounded-prism

/// A rounded-rectangle prism whose bottom was cut off by a boolean, unioned with a cylinder that
/// contains the cut face: `SmFace::PointClassify` is "not supported yet".
fn pointclassify() -> Out {
    let prism = ops::sweep::extrude(&rounded_rect(8.0, 8.0, 1.0), [0.0, 0.0, 1.0], 20.0, 0.0, DraftCorner::default(), true).map_err(|e| e.to_string())?;
    let cut = subtract(prism, ops::make_box([-10.0, -10.0, -5.0], [20.0, 20.0, 10.0]).unwrap()).map_err(|e| e.to_string())?.ok_or("cut empty")?;
    let cyl = ops::make_cylinder([0.0; 3], 10.0, 10.0).unwrap();
    // the cylinder (z 0..10) plus the prism above it (z 10..20)
    let area = 64.0 - (4.0 - PI);
    expect_volume("prism − box, ∪ cylinder", union(cut, cyl), PI * 100.0 * 10.0 + area * 10.0)
}

/// Control: the same prism built at z = 5 directly (no cut face from a boolean) is fine.
fn pointclassify_control() -> Out {
    let prism = ops::sweep::extrude(&rounded_rect(8.0, 8.0, 1.0), [0.0, 0.0, 1.0], 15.0, 0.0, DraftCorner::default(), true).map_err(|e| e.to_string())?;
    let prism = moved(prism, 0.0, 0.0, 5.0);
    let area = 64.0 - (4.0 - PI);
    expect_volume("control: uncut prism ∪ cylinder", union(prism, ops::make_cylinder([0.0; 3], 10.0, 10.0).unwrap()), PI * 1000.0 + area * 10.0)
}

// ---------------------------------------------------------------------------------------------
// 2. tangent-cylinder-subtract

/// Subtracting a cylinder that touches the inside of another cylinder's wall along a line.
fn internal_tangent() -> Out {
    let a = ops::make_cylinder([0.0; 3], 10.0, 10.0).unwrap();
    let b = ops::make_cylinder([5.0, 0.0, -5.0], 5.0, 20.0).unwrap();
    expect_volume("cylinder r10 − internally tangent cylinder r5", subtract(a, b), PI * (100.0 - 25.0) * 10.0)
}

fn internal_tangent_control() -> Out {
    let a = ops::make_cylinder([0.0; 3], 10.0, 10.0).unwrap();
    let b = ops::make_cylinder([4.9, 0.0, -5.0], 5.0, 20.0).unwrap();
    expect_volume("control: offset 4.9 (not tangent)", subtract(a, b), PI * (100.0 - 25.0) * 10.0)
}

// ---------------------------------------------------------------------------------------------
// 3. line-contact-union-then-boolean

/// A box and a cylinder touching along a line union fine; unioning the result with the same
/// cylinder again (a no-op) fails.
fn line_contact_reunion() -> Out {
    let cyl = || ops::make_cylinder([15.0, 5.0, 2.0], 5.0, 5.0).unwrap();
    let bc = union(ops::make_box([0.0; 3], [10.0; 3]).unwrap(), cyl()).map_err(|e| e.to_string())?.ok_or("empty")?;
    let v = vol(&bc);
    expect_volume("(box ∪ tangent cylinder) ∪ same cylinder", union(bc, cyl()), v)
}

/// A third solid unioned onto a box ∪ tangent-cylinder body: mass::enclosure.
fn line_contact_enclosure() -> Out {
    let left = || ops::make_cylinder([-4.0, 0.0, -4.0], 3.0, 8.0).unwrap();
    let boxy = || ops::make_box([-5.0; 3], [10.0; 3]).unwrap();
    let tangent = || ops::make_cylinder([10.0, 0.0, -2.0], 5.0, 4.0).unwrap();
    // the same three solids unioned in another order give the expected volume
    let other = union(union(left(), boxy()).map_err(|e| e.to_string())?.ok_or("empty")?, tangent()).map_err(|e| e.to_string())?.ok_or("empty")?;
    let expect = vol(&other);
    let bt = union(boxy(), tangent()).map_err(|e| e.to_string())?.ok_or("empty")?;
    expect_volume("cylinder ∪ (box ∪ tangent cylinder)", union(left(), bt), expect)
}

// ---------------------------------------------------------------------------------------------
// 4. near-coincident-curved-faces

fn near_spheres() -> Out {
    let a = ops::make_sphere([0.0; 3], 10.0).unwrap();
    let b = ops::make_sphere([0.0, 1e-3, 0.0], 10.0).unwrap();
    // lens of two unit-offset spheres: V = π (4r + d)(2r − d)² / 12
    let (r, d) = (10.0_f64, 1e-3_f64);
    expect_volume("sphere ∩ sphere moved 1e-3", intersect(a, b), PI * (4.0 * r + d) * (2.0 * r - d).powi(2) / 12.0)
}

fn near_cylinders() -> Out {
    let a = ops::make_cylinder([0.0; 3], 10.0, 10.0).unwrap();
    let b = ops::make_cylinder([0.0, 1e-4, 0.0], 10.0, 10.0).unwrap();
    // the union exceeds one cylinder by the crescent 2·r·d·h (first order)
    expect_volume("cylinder ∪ cylinder moved 1e-4 sideways", union(a, b), PI * 1000.0 + 2.0 * 10.0 * 1e-4 * 10.0)
}

fn near_revolve_empty_union() -> Out {
    let pts = [[2.0, 0.0], [4.224, 0.0], [5.0, 2.666667], [16.542, 5.333333], [9.0, 8.0], [2.0, 8.0]];
    let m = [0.0, 0.0, 1.0, 8.0, 0.0, 1.0, 0.0, 8.5, -1.0, 0.0, 0.0, -0.5]; // a rotation about Y, then a move
    let a = mapped(revolved(&pts, TAU).map_err(|e| e.to_string())?, m);
    let b = moved(mapped(revolved(&pts, TAU).map_err(|e| e.to_string())?, m), 0.0, 1e-5, 0.0);
    let v = vol(&a);
    match union(a, b) {
        Ok(None) => Err("revolved solid ∪ copy moved 1e-5: union of two solids is EMPTY".into()),
        r => expect_volume("revolved solid ∪ copy moved 1e-5", r, v),
    }
}

// ---------------------------------------------------------------------------------------------
// 5. union-with-own-fillet

const SECTOR: [[f64; 2]; 4] = [[3.0, 0.0], [5.0, 0.0], [13.0, 28.0], [3.0, 28.0]];

/// A revolved sector unioned with a copy of itself whose start-cap radial edges are rounded.
/// The union is the sector itself (the rounded copy lies inside it).
fn own_fillet() -> Out {
    let a = revolved(&SECTOR, 2.8).map_err(|e| e.to_string())?;
    let b = revolved(&SECTOR, 2.8).map_err(|e| e.to_string())?;
    round_lines_along(&b, [1.0, 0.0, 0.0], 2.6).map_err(|e| format!("fillet: {e}"))?;
    let v = vol(&a);
    expect_volume("sector ∪ sector with rounded start-cap edges", union(a, b), v)
}

/// The same, placed by rigid transforms (as the fuzzer found it): proto edge is deleted.
fn own_fillet_placed() -> Out {
    let pts = [[3.0, 0.0], [5.0, 0.0], [13.0, 28.375], [3.0, 28.375]];
    let m1 = [1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, -7.0, 0.0, -1.0, 0.0, 9.0];
    let m2 = [0.0, 1.0, 0.0, -13.5, -1.0, 0.0, 0.0, 11.863, 0.0, 0.0, 1.0, 2.677];
    let a = mapped(revolved(&pts, 2.816).map_err(|e| e.to_string())?, compose(m1, m2));
    let b = mapped(revolved(&pts, 2.816).map_err(|e| e.to_string())?, m2);
    round_lines_along(&b, [0.0, 1.0, 0.0], 2.6).map_err(|e| format!("fillet: {e}"))?;
    let b = mapped(b, m1);
    let v = vol(&a);
    expect_volume("placed sector ∪ placed rounded copy", union(a, b), v)
}

// ---------------------------------------------------------------------------------------------
// 6. conic-off-frame-after-near-rigid-transform

/// A cylinder placed by a rotation written to 6 decimals (orthonormal to ~1e-6), cut by two
/// slightly different boxes; the union of the two pieces evaluates, but its record cannot be
/// built: "a conic's NURBS is off its own frame and radii".
fn conic_off_frame() -> Out {
    let place = compose(
        [1.0, 0.0, 0.0, 38.150408, 0.0, 1.0, 0.0, 12.866874, 0.0, 0.0, 1.0, 5.099944],
        [0.848916, -0.379173, -0.368197, -14.764, 0.524678, 0.688512, 0.500663, 0.0, 0.06367, -0.618206, 0.783433, -4.0],
    );
    let cyl = || mapped(ops::make_cylinder([0.0; 3], 10.0, 24.5).unwrap(), place);
    let p1 = intersect(ops::make_box([0.0; 3], [37.8, 38.0, 21.4]).unwrap(), cyl()).map_err(|e| e.to_string())?.ok_or("empty")?;
    let p2 = intersect(ops::make_box([0.0; 3], [38.0, 38.0, 21.0]).unwrap(), cyl()).map_err(|e| e.to_string())?.ok_or("empty")?;
    let u = union(p1, p2).map_err(|e| format!("union: {e}"))?.ok_or("empty")?;
    match u.to_record() {
        Ok(_) => Ok(format!("record built (volume {:.3})", vol(&u))),
        Err(e) => Err(format!("union evaluates (volume {:.3}) but to_record fails: {e}", vol(&u))),
    }
}

// ---------------------------------------------------------------------------------------------

const ALL: &[(&str, fn() -> Out)] = &[
    ("pointclassify-cut-rounded-prism", pointclassify),
    ("pointclassify-cut-rounded-prism (control)", pointclassify_control),
    ("tangent-cylinder-subtract", internal_tangent),
    ("tangent-cylinder-subtract (control)", internal_tangent_control),
    ("line-contact-union: re-union", line_contact_reunion),
    ("line-contact-union: third solid", line_contact_enclosure),
    ("near-coincident: spheres 1e-3", near_spheres),
    ("near-coincident: cylinders 1e-4", near_cylinders),
    ("near-coincident: empty union", near_revolve_empty_union),
    ("union-with-own-fillet", own_fillet),
    ("union-with-own-fillet (placed)", own_fillet_placed),
    ("conic-off-frame-after-near-rigid-transform", conic_off_frame),
];

#[test]
fn upstream_repros() {
    for (name, f) in ALL {
        let r = std::panic::catch_unwind(f).unwrap_or_else(|_| Err("PANIC".into()));
        match r {
            Ok(m) => println!("PASS {name:<46} {m}"),
            Err(m) => println!("BUG  {name:<46} {m}"),
        }
    }
}

macro_rules! asserting {
    ($($t:ident => $f:ident),* $(,)?) => {$(
        #[test]
        #[ignore = "reproduces an open solidcore bug"]
        fn $t() {
            if let Err(m) = $f() {
                panic!("{m}");
            }
        }
    )*};
}
asserting!(
    bug_pointclassify => pointclassify,
    bug_internal_tangent => internal_tangent,
    bug_line_contact_reunion => line_contact_reunion,
    bug_line_contact_enclosure => line_contact_enclosure,
    bug_near_spheres => near_spheres,
    bug_near_cylinders => near_cylinders,
    bug_near_revolve_empty_union => near_revolve_empty_union,
    bug_own_fillet => own_fillet,
    bug_own_fillet_placed => own_fillet_placed,
    bug_conic_off_frame => conic_off_frame,
);
