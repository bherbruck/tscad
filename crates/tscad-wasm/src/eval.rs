//! IR nodes to solidcore bodies.

use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use solidcore_ops as ops;
use solidcore_ops::{Blend, BooleanOp, Body, Corners};
use solidcore_record::brep::{self as rec, Brep as Record};

use crate::ir::{Axis, Curve, Node, Selector, SplitKeep, SweepFrame};

/// An evaluation failure: what failed, at which node path.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, tsify::Tsify)]
pub struct EvalError {
    pub path: String,
    pub op: String,
    pub message: String,
}

pub type R<T> = std::result::Result<T, EvalError>;

fn fail(path: &str, op: &str, message: impl Into<String>) -> EvalError {
    EvalError { path: path.to_string(), op: op.to_string(), message: message.into() }
}

fn kernel<T>(path: &str, op: &str, r: ops::Result<T>) -> R<T> {
    r.map_err(|e| fail(path, op, format!("{e}")))
}

/// What a node evaluates to: a body, or nothing (an empty boolean result).
pub type Solid = Option<Body>;

/// Bodies of subtrees already evaluated, keyed by the subtree's canonical JSON hash: a
/// hot reload re-evaluates only the subtrees whose props changed.
#[derive(Default)]
pub struct Cache {
    map: HashMap<u64, Option<Body>>,
    used: HashSet<u64>,
    pub hits: usize,
    pub misses: usize,
}

impl Cache {
    /// Forget every entry the last evaluation did not use.
    pub fn sweep(&mut self) {
        let used = std::mem::take(&mut self.used);
        self.map.retain(|k, _| used.contains(k));
        self.hits = 0;
        self.misses = 0;
    }
    pub fn clear(&mut self) {
        self.map.clear();
        self.used.clear();
    }
    pub fn len(&self) -> usize {
        self.map.len()
    }
}

fn key(node: &Node) -> u64 {
    let mut h = std::hash::DefaultHasher::new();
    serde_json::to_string(node).unwrap_or_default().hash(&mut h);
    h.finish()
}

fn copied(b: &Option<Body>, path: &str) -> R<Solid> {
    match b {
        None => Ok(None),
        Some(b) => kernel(path, "copy", b.copy()).map(Some),
    }
}

/// `node` as a body, from the cache when an equal subtree was evaluated before.
pub fn eval(node: &Node, path: &str, cache: &mut Cache) -> R<Solid> {
    let k = key(node);
    cache.used.insert(k);
    if let Some(b) = cache.map.get(&k) {
        cache.hits += 1;
        return copied(b, path);
    }
    cache.misses += 1;
    let made = eval_uncached(node, path, cache)?;
    let kept = copied(&made, path)?;
    cache.map.insert(k, kept);
    Ok(made)
}

fn eval_uncached(node: &Node, path: &str, cache: &mut Cache) -> R<Solid> {
    match node {
        Node::Box { size, center } => {
            let origin = if *center { size.map(|s| -s / 2.0) } else { [0.0; 3] };
            kernel(path, "box", ops::make_box(origin, *size)).map(Some)
        }
        Node::Cylinder { radius, height, center } => {
            let z = if *center { -height / 2.0 } else { 0.0 };
            kernel(path, "cylinder", ops::make_cylinder([0.0, 0.0, z], *radius, *height)).map(Some)
        }
        Node::Sphere { radius } => kernel(path, "sphere", ops::make_sphere([0.0; 3], *radius)).map(Some),
        Node::Cone { bottom_radius, top_radius, height, center } => {
            let z = if *center { -height / 2.0 } else { 0.0 };
            kernel(path, "cone", ops::make_cone([0.0, 0.0, z], *bottom_radius, *top_radius, *height)).map(Some)
        }
        Node::Torus { major_radius, minor_radius } => {
            kernel(path, "torus", ops::make_torus([0.0; 3], *major_radius, *minor_radius)).map(Some)
        }
        Node::Union { children } => union(children, path, cache),
        Node::Difference { children } => {
            let Some((first, rest)) = children.split_first() else { return Ok(None) };
            let Some(mut acc) = eval(first, &format!("{path}/0"), cache)? else { return Ok(None) };
            let mut tools = Vec::new();
            for (i, c) in rest.iter().enumerate() {
                if let Some(b) = eval(c, &format!("{path}/{}", i + 1), cache)? {
                    tools.push(b);
                }
            }
            // Many tools: union them once and cut once (one boolean against the target instead
            // of one per tool, ~3x faster for hole patterns); the tools are kept to cut one by
            // one should their union be refused.
            if tools.len() > 1 {
                let copies: Option<Vec<Body>> = tools.iter().map(|t| t.copy().ok()).collect();
                if let Some(copies) = copies {
                    if let Ok(tool) = ops::boolean::union_all(copies) {
                        let target = kernel(path, "difference", acc.copy())?;
                        match ops::boolean::boolean(target, tool, BooleanOp::Subtract) {
                            Ok(r) => return Ok(r),
                            Err(_) => {}
                        }
                    }
                }
            }
            for t in tools {
                match kernel(path, "difference", ops::boolean::boolean(acc, t, BooleanOp::Subtract))? {
                    Some(r) => acc = r,
                    None => return Ok(None),
                }
            }
            Ok(Some(acc))
        }
        Node::Intersection { children } => {
            let mut acc: Option<Body> = None;
            for (i, c) in children.iter().enumerate() {
                let Some(b) = eval(c, &format!("{path}/{i}"), cache)? else { return Ok(None) };
                acc = match acc {
                    None => Some(b),
                    Some(a) => match kernel(path, "intersection", ops::boolean::boolean(a, b, BooleanOp::Intersect))? {
                        None => return Ok(None),
                        some => some,
                    },
                };
            }
            Ok(acc)
        }
        Node::Transform { matrix, children } => {
            // Compose a chain of single-child transforms into one matrix.
            let mut m = *matrix;
            let mut kids = children;
            while let [Node::Transform { matrix: inner, children: next }] = kids.as_slice() {
                m = matmul(&m, inner);
                kids = next;
            }
            // solidcore leaves a moved torus with a non-finite tolerance (docs/KERNEL_ISSUES.md
            // #7): build it in place instead, as a circle revolved about the moved axis.
            if let [Node::Torus { major_radius, minor_radius }] = kids.as_slice() {
                if let Some(t) = torus_in_place(&m, *major_radius, *minor_radius) {
                    return eval_uncached(&t, path, cache);
                }
            }
            let Some(b) = union(kids, path, cache)? else { return Ok(None) };
            // The IR is column-vector (p' = M p, translation in the last column); the kernel
            // is row-vector (p' = p A + t, translation in row 3): its matrix is the transpose.
            let mut k = [[0.0; 4]; 4];
            for (i, row) in k.iter_mut().enumerate() {
                for (j, x) in row.iter_mut().enumerate() {
                    *x = m[j * 4 + i];
                }
            }
            kernel(path, "transform", b.transform(&k))?;
            Ok(Some(b))
        }
        Node::Extrude { profile, direction, distance, draft } => {
            let curves = curves(profile);
            kernel(
                path,
                "extrude",
                ops::sweep::extrude(&curves, *direction, *distance, *draft, ops::sweep::DraftCorner::default(), true),
            )
            .map(Some)
        }
        Node::Revolve { profile, origin, axis, angle } => {
            let curves = curves(profile);
            kernel(path, "revolve", ops::sweep::revolve(&curves, *origin, *axis, *angle, true)).map(Some)
        }
        Node::Loft { sections, ruled } => {
            let s: Vec<Vec<ops::sweep::Curve>> = sections.iter().map(|c| curves(c)).collect();
            let degree = if *ruled { 1 } else { s.len().saturating_sub(1).clamp(1, 3) as u32 };
            kernel(path, "loft", ops::sweep::loft(&s, degree, true)).map(Some)
        }
        Node::Sweep { profile, path: route, frame } => {
            let frame = match frame {
                SweepFrame::Follow => ops::sweep::SweepFrame::Follow,
                SweepFrame::Translate => ops::sweep::SweepFrame::Translate,
            };
            kernel(path, "sweep", ops::sweep::sweep_placed(&curves(profile), &curves(route), frame, true))
                .map(|(b, _, _)| Some(b))
        }
        Node::Step { data, solid } => {
            let ex = solidcore_record::step::p21::parse(data).map_err(|e| fail(path, "step", format!("parse: {e:?}")))?;
            let read = solidcore_step::topology::read_solids_with(&ex, &KernelTrims);
            if read.solids.is_empty() {
                let why = read.failures.first().map(|f| format!("{f:?}")).unwrap_or_else(|| "no solids in the file".into());
                return Err(fail(path, "step", why));
            }
            let mut bodies = Vec::new();
            for (i, s) in read.solids.iter().enumerate() {
                if solid.is_some_and(|k| k != i) {
                    continue;
                }
                let (b, _) = kernel(path, "step", Body::from_record(&s.brep, false))?;
                bodies.push(b);
            }
            match bodies.len() {
                0 => Err(fail(path, "step", format!("the file has {} solids", read.solids.len()))),
                1 => Ok(bodies.pop()),
                _ => kernel(path, "step", ops::boolean::union_all(bodies)).map(Some),
            }
        }
        Node::Fillet { radius, edges, children } => blend(children, path, cache, "fillet", Blend::Round, *radius, edges),
        Node::Chamfer { distance, edges, children } => {
            blend(children, path, cache, "chamfer", Blend::Chamfer, *distance, edges)
        }
        Node::Draft { angle, faces, origin, normal, pull, children } => {
            let Some(b) = union(children, path, cache)? else { return Ok(None) };
            let (record, order) = kernel(path, "draft", b.to_record())?;
            let picked = select_faces(&record, faces);
            if picked.is_empty() {
                return Err(fail(path, "draft", "the face selector matched no faces"));
            }
            kernel(
                path,
                "draft",
                ops::offset::draft(
                    &b,
                    &order,
                    &picked,
                    origin.unwrap_or([0.0; 3]),
                    normal.unwrap_or([0.0, 0.0, 1.0]),
                    pull.unwrap_or([0.0, 0.0, 1.0]),
                    *angle,
                ),
            )?;
            Ok(Some(b))
        }
        Node::OffsetFaces { distance, faces, children } => {
            let Some(b) = union(children, path, cache)? else { return Ok(None) };
            let (record, order) = kernel(path, "offsetFaces", b.to_record())?;
            let picked = select_faces(&record, faces);
            if picked.is_empty() {
                return Err(fail(path, "offsetFaces", "the face selector matched no faces"));
            }
            kernel(path, "offsetFaces", ops::offset::offset_faces(&b, &order, &picked, *distance))?;
            Ok(Some(b))
        }
        Node::Split { origin, normal, keep, children } => {
            let Some(b) = union(children, path, cache)? else { return Ok(None) };
            let (lo, hi) = kernel(path, "split", b.bounds())?;
            let n = norm(*normal);
            // a plane patch covering the body: two axes square to the normal, the body's
            // diagonal on each side
            let helper = if n[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
            let u = norm(cross(n, helper));
            let v = cross(n, u);
            let reach = 2.0 * dot(sub(hi, lo), sub(hi, lo)).sqrt() + 1.0;
            let centre = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0];
            let d = dot(sub(centre, *origin), n);
            let o = [centre[0] - d * n[0], centre[1] - d * n[1], centre[2] - d * n[2]];
            let tool = ops::split::Tool {
                surface: rec::Surface::Plane { origin: o, u_axis: u, v_axis: v },
                domain: [[-reach, reach], [-reach, reach]],
            };
            let side = |body: &Body| -> R<f64> {
                let (a, z) = kernel(path, "split", body.bounds())?;
                let c = [(a[0] + z[0]) / 2.0, (a[1] + z[1]) / 2.0, (a[2] + z[2]) / 2.0];
                Ok(dot(sub(c, *origin), n))
            };
            let want_above = matches!(keep, SplitKeep::Above);
            match kernel(path, "split", ops::split::split_body(&b, &tool))? {
                Some((p, q)) => {
                    let p_above = side(&p)? > side(&q)?;
                    Ok(Some(if p_above == want_above { p } else { q }))
                }
                // the plane misses the body: all of it, or none of it
                None => Ok(if (side(&b)? > 0.0) == want_above { Some(b) } else { None }),
            }
        }
        Node::Shell { thickness, faces, children } => {
            let Some(b) = union(children, path, cache)? else { return Ok(None) };
            let (record, order) = kernel(path, "shell", b.to_record())?;
            let open = select_faces(&record, faces);
            kernel(path, "shell", ops::offset::shell(&b, &order, &open, *thickness))?;
            Ok(Some(b))
        }
    }
}

fn union(children: &[Node], path: &str, cache: &mut Cache) -> R<Solid> {
    let mut bodies = Vec::new();
    for (i, c) in children.iter().enumerate() {
        if let Some(b) = eval(c, &format!("{path}/{i}"), cache)? {
            bodies.push(b);
        }
    }
    match bodies.len() {
        0 => Ok(None),
        1 => Ok(bodies.pop()),
        _ => kernel(path, "union", ops::boolean::union_all(bodies)).map(Some),
    }
}

fn blend(children: &[Node], path: &str, cache: &mut Cache, op: &str, kind: Blend, size: f64, edges: &Selector) -> R<Solid> {
    let Some(b) = union(children, path, cache)? else { return Ok(None) };
    let (record, order) = kernel(path, op, b.to_record())?;
    let mut picked = select_edges(&record, edges);
    if picked.is_empty() {
        return Err(fail(path, op, "the edge selector matched no edges"));
    }
    // A broad selector (all, max z...) takes in smooth joins the kernel has no blend for (a
    // tangent edge, a seam): those are dropped and the rest blended. Edges named by index are
    // the user's own choice and are not dropped.
    let explicit = matches!(edges, Selector::Index { .. });
    loop {
        match ops::blend_ordered(&b, &order, kind, &picked, &[size], &[], Corners::Filled, ops::BlendOptions::default()) {
            Ok(_) => break,
            Err(ops::Error::EdgeNotBlendable { edge, .. }) if !explicit && picked.len() > 1 => {
                let before = picked.len();
                picked.retain(|e| *e != edge);
                if picked.len() == before {
                    return Err(fail(path, op, format!("edge {edge} has no blend")));
                }
            }
            Err(e) => return Err(fail(path, op, format!("{e}"))),
        }
    }
    Ok(Some(b))
}

fn curves(c: &[Curve]) -> Vec<ops::sweep::Curve> {
    c.iter()
        .map(|c| match c {
            Curve::Line { start, end } => ops::sweep::Curve::Line { start: *start, end: *end },
            Curve::Arc { center, axis, reference, radius, start, end } => ops::sweep::Curve::Arc {
                center: *center,
                axis: *axis,
                reference: *reference,
                radius: *radius,
                start: *start,
                end: *end,
            },
            Curve::Nurbs { degree, points, knots } => {
                ops::sweep::Curve::Nurbs { degree: *degree, points: points.clone(), knots: knots.clone() }
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Selection

const TOL: f64 = 1e-6;

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn norm(a: [f64; 3]) -> [f64; 3] {
    let l = dot(a, a).sqrt();
    if l > 0.0 { [a[0] / l, a[1] / l, a[2] / l] } else { a }
}
fn unit(axis: Axis) -> [f64; 3] {
    let mut u = [0.0; 3];
    u[axis.index()] = 1.0;
    u
}

/// The geometric facts a selector asks of an edge or face.
pub(crate) struct Item {
    pub points: Vec<[f64; 3]>,
    /// Edge: direction of a line. Face: a plane's normal.
    pub dir: Option<[f64; 3]>,
    /// Edge: a circle's axis and radius.
    pub circle: Option<([f64; 3], f64)>,
}

fn circle_points(frame: &rec::Frame, r: f64) -> Vec<[f64; 3]> {
    let o = frame.origin;
    let (x, y) = (frame.x_axis, frame.y_axis);
    (0..8)
        .map(|i| {
            let t = std::f64::consts::PI * f64::from(i) / 4.0;
            let (s, c) = t.sin_cos();
            [o[0] + r * (c * x[0] + s * y[0]), o[1] + r * (c * x[1] + s * y[1]), o[2] + r * (c * x[2] + s * y[2])]
        })
        .collect()
}

pub(crate) fn edge_item(record: &Record, e: &rec::Edge) -> Item {
    let mut points: Vec<[f64; 3]> =
        e.vertices.iter().filter_map(|v| record.vertices.get(*v as usize)).map(|v| v.point).collect();
    let mut dir = None;
    let mut circle = None;
    match &e.curve {
        rec::Curve::Line { start, end } => dir = Some(norm(sub(*end, *start))),
        rec::Curve::Circle { frame, radius } => {
            circle = Some((norm(cross(frame.x_axis, frame.y_axis)), *radius));
            // a closed circle's only vertex says nothing of where it runs: sample it whole
            if e.vertices[0] == e.vertices[1] {
                points = circle_points(frame, *radius);
            }
        }
        _ => {}
    }
    Item { points, dir, circle }
}

pub(crate) fn face_item(record: &Record, f: &rec::Face) -> Item {
    let mut points = Vec::new();
    for l in &f.loops {
        if let rec::Loop::Edges { edges } = l {
            for oe in edges {
                if let Some(e) = record.edges.get(oe.edge as usize) {
                    points.extend(edge_item(record, e).points);
                }
            }
        }
    }
    let dir = match &f.surface {
        rec::Surface::Plane { u_axis, v_axis, .. } => Some(norm(cross(*u_axis, *v_axis))),
        _ => None,
    };
    Item { points, dir, circle: None }
}

pub(crate) fn bounds(record: &Record) -> ([f64; 3], [f64; 3]) {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    let mut add = |p: [f64; 3]| {
        for i in 0..3 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    };
    for e in &record.edges {
        for p in edge_item(record, e).points {
            add(p);
        }
    }
    (lo, hi)
}

pub(crate) fn matches(it: &Item, s: &Selector, lo: [f64; 3], hi: [f64; 3], index: usize, is_face: bool) -> bool {
    let scale = (0..3).map(|i| hi[i] - lo[i]).fold(1.0_f64, f64::max);
    let tol = TOL * scale;
    match s {
        Selector::All => true,
        Selector::None => false,
        Selector::Parallel { axis } => {
            it.dir.is_some_and(|d| (dot(d, unit(*axis)).abs() - 1.0).abs() < TOL)
        }
        Selector::Perpendicular { axis } => {
            if is_face {
                it.dir.is_some_and(|d| dot(d, unit(*axis)).abs() < TOL)
            } else {
                it.circle.is_some_and(|(n, _)| (dot(n, unit(*axis)).abs() - 1.0).abs() < TOL)
            }
        }
        Selector::Max { axis } => {
            let i = axis.index();
            !it.points.is_empty() && it.points.iter().all(|p| (p[i] - hi[i]).abs() < tol)
        }
        Selector::Min { axis } => {
            let i = axis.index();
            !it.points.is_empty() && it.points.iter().all(|p| (p[i] - lo[i]).abs() < tol)
        }
        Selector::Radius { radius } => it.circle.is_some_and(|(_, r)| (r - radius).abs() <= TOL * radius.abs().max(1.0)),
        Selector::Within { min, max } => {
            !it.points.is_empty()
                && it.points.iter().all(|p| (0..3).all(|i| p[i] >= min[i] - tol && p[i] <= max[i] + tol))
        }
        Selector::And { of } => of.iter().all(|s| matches(it, s, lo, hi, index, is_face)),
        Selector::Or { of } => of.iter().any(|s| matches(it, s, lo, hi, index, is_face)),
        Selector::Not { of } => !matches(it, of, lo, hi, index, is_face),
        Selector::Index { indices } => indices.contains(&index),
    }
}

/// A seam: an edge where a periodic face meets itself (a cylinder's side line).
pub fn is_seam(e: &rec::Edge) -> bool {
    e.uses.len() == 2 && e.uses[0].face == e.uses[1].face
}

/// The unit normal of face `f`'s surface at the point nearest `p`.
fn normal_at(record: &Record, f: u32, p: [f64; 3]) -> Option<[f64; 3]> {
    let s = ops::face_surface::FaceSurface::of(record, f as usize).ok()?;
    let [[u0, u1], [v0, v1]] = s.domain();
    let c = s.closest_point(p, [(u0 + u1) / 2.0, (v0 + v1) / 2.0]).ok()?;
    s.normal(c.uv).ok().map(norm)
}

/// A smooth edge: its two faces meet tangentially along it (a joint between a line wall and an
/// arc wall of an extruded rounded rectangle). Nothing to round there.
pub fn is_smooth(record: &Record, e: &rec::Edge) -> bool {
    let [a, b] = match e.uses.as_slice() {
        [a, b] => [a.face, b.face],
        _ => return false,
    };
    let p = match &e.curve {
        rec::Curve::Line { start, end } => [(start[0] + end[0]) / 2.0, (start[1] + end[1]) / 2.0, (start[2] + end[2]) / 2.0],
        _ => match record.vertices.get(e.vertices[0] as usize) {
            Some(v) => v.point,
            None => return false,
        },
    };
    match (normal_at(record, a, p), normal_at(record, b, p)) {
        (Some(n1), Some(n2)) => dot(n1, n2).abs() > 1.0 - 1e-6,
        _ => false,
    }
}

pub fn select_edges(record: &Record, s: &Selector) -> Vec<usize> {
    let (lo, hi) = bounds(record);
    let explicit = matches!(s, Selector::Index { .. });
    record
        .edges
        .iter()
        .enumerate()
        .filter(|(_, e)| explicit || !(is_seam(e) || is_smooth(record, e)))
        .filter(|(i, e)| matches(&edge_item(record, e), s, lo, hi, *i, false))
        .map(|(i, _)| i)
        .collect()
}

pub fn select_faces(record: &Record, s: &Selector) -> Vec<usize> {
    let (lo, hi) = bounds(record);
    record
        .faces
        .iter()
        .enumerate()
        .filter(|(i, f)| matches(&face_item(record, f), s, lo, hi, *i, true))
        .map(|(i, _)| i)
        .collect()
}

/// Pcurves for STEP faces whose edge uses have no closed form, fitted by solidcore
/// (`solidcore_ops::pcurve::pcurves_within`) on the face's own parameterisation.
struct KernelTrims;

impl ops::pcurve::Trims for KernelTrims {
    fn trims(&self, face: &ops::pcurve::TrimFace<'_>) -> std::result::Result<Vec<Vec<rec::Curve2>>, String> {
        let surface = face.nurbs.unwrap_or(face.surface);
        let loops: Vec<Vec<ops::pcurve::EdgeUse<'_>>> = face
            .loops
            .iter()
            .map(|l| {
                l.iter()
                    .map(|u| {
                        let e = face.edges.get(u.edge as usize).ok_or("a use past the face's edges")?;
                        Ok(ops::pcurve::EdgeUse {
                            edge: u.edge,
                            curve: e.nurbs.unwrap_or(e.curve),
                            interval: e.interval,
                            forward: u.forward,
                            tolerance: e.tolerance,
                            given: u.pcurve.as_ref(),
                        })
                    })
                    .collect::<std::result::Result<Vec<_>, &str>>()
            })
            .collect::<std::result::Result<_, _>>()?;
        ops::pcurve::pcurves_within(surface, &loops, face.tolerance, Some(face.domain)).map_err(|e| format!("pcurves: {e}"))
    }
}

fn matmul(a: &[f64; 16], b: &[f64; 16]) -> [f64; 16] {
    let mut out = [0.0; 16];
    for i in 0..4 {
        for j in 0..4 {
            out[i * 4 + j] = (0..4).map(|k| a[i * 4 + k] * b[k * 4 + j]).sum();
        }
    }
    out
}

/// The torus about +Z with radii `r_major`, `r_minor` moved by `m`, as a revolve node, when `m`
/// is a similarity (rotation, mirror, uniform scale, translation).
fn torus_in_place(m: &[f64; 16], r_major: f64, r_minor: f64) -> Option<Node> {
    let lin = |v: [f64; 3]| -> [f64; 3] {
        [
            m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
            m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
            m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
        ]
    };
    let at = |p: [f64; 3]| -> [f64; 3] {
        let l = lin(p);
        [l[0] + m[3], l[1] + m[7], l[2] + m[11]]
    };
    let (x, y, z) = (lin([1.0, 0.0, 0.0]), lin([0.0, 1.0, 0.0]), lin([0.0, 0.0, 1.0]));
    let k = dot(x, x).sqrt();
    let similar = k > 1e-12
        && [dot(y, y).sqrt(), dot(z, z).sqrt()].iter().all(|l| (l - k).abs() <= 1e-9 * k)
        && [dot(x, y), dot(y, z), dot(x, z)].iter().all(|d| d.abs() <= 1e-9 * k * k)
        && m[12] == 0.0 && m[13] == 0.0 && m[14] == 0.0 && m[15] == 1.0;
    if !similar {
        return None;
    }
    let tau = std::f64::consts::TAU;
    Some(Node::Revolve {
        profile: vec![Curve::Arc {
            center: at([r_major, 0.0, 0.0]),
            axis: norm(lin([0.0, -1.0, 0.0])),
            reference: norm(x),
            radius: r_minor * k,
            start: 0.0,
            end: tau,
        }],
        origin: at([0.0; 3]),
        axis: norm(z),
        angle: tau,
    })
}
