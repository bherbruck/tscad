//! The kernel session as plain Rust: evaluate documents with a subtree cache, keep each part's
//! body, and answer questions about it (meshes, picks, STEP). `lib.rs` wraps it for JS.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use solidcore_ops::Body;
use solidcore_record::brep::{self as rec, Brep as Record};
use tsify::Tsify;

use crate::eval::{self, Cache, EvalError};
use crate::ir::{Axis, Document, Selector};

/// Options for [`Engine::evaluate`].
#[derive(Debug, Clone, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct EvalOptions {
    /// Chord tolerance of the display mesh, mm. Absent: from each part's size.
    #[serde(default)]
    pub tolerance: Option<f64>,
    /// Skip meshing (for exports that only need STEP).
    #[serde(default)]
    pub no_mesh: bool,
}

/// One part's mesh: flat typed arrays.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct MeshData {
    /// xyz per vertex.
    pub positions: Vec<f32>,
    /// xyz per vertex.
    pub normals: Vec<f32>,
    /// Triangle vertex indices, counter-clockwise from outside.
    pub indices: Vec<u32>,
    /// The B-rep face of each triangle (record index).
    pub face_ids: Vec<u32>,
    /// Points of every drawn edge polyline end to end, xyz.
    pub edge_points: Vec<f32>,
    /// Point count of each drawn edge polyline.
    pub edge_counts: Vec<u32>,
    /// The B-rep edge (record index) of each drawn polyline.
    pub edge_ids: Vec<u32>,
}

/// What evaluating one part gave.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PartResult {
    pub name: String,
    pub ok: bool,
    /// The tree evaluated to nothing (an empty boolean).
    pub empty: bool,
    pub error: Option<EvalError>,
    pub volume: Option<f64>,
    pub area: Option<f64>,
    /// `[min, max]`.
    pub bbox: Option<[[f64; 3]; 2]>,
    /// faces, edges, vertices
    pub counts: Option<[usize; 3]>,
    pub warnings: Vec<String>,
    pub millis: f64,
    /// Whether the part's whole tree came from the cache.
    pub cached: bool,
}

/// What [`Engine::evaluate`] gave.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct EvalResult {
    pub ok: bool,
    pub parts: Vec<PartResult>,
    pub cache_hits: usize,
    pub cache_misses: usize,
    pub cache_size: usize,
    pub millis: f64,
}

/// A picked edge or face: what it is, and selectors that would name it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PickInfo {
    pub index: usize,
    /// `line`, `circle`, `plane`, `curve`, `surface`...
    pub kind: String,
    /// Sample points.
    pub points: Vec<[f64; 3]>,
    /// A line's direction or a plane's normal.
    pub direction: Option<[f64; 3]>,
    pub radius: Option<f64>,
    /// How many edges/faces each suggested selector matches, most specific first.
    pub suggestions: Vec<Suggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub selector: Selector,
    /// How many items it selects in this body.
    pub count: usize,
}

struct PartState {
    body: Body,
    record: Option<Record>,
    mesh: Option<MeshData>,
}

/// A kernel session.
#[derive(Default)]
pub struct Engine {
    cache: Cache,
    parts: BTreeMap<String, PartState>,
    clock: Option<fn() -> f64>,
}

fn now_native() -> f64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        0.0
    }
}

impl Engine {
    pub fn new(clock: Option<fn() -> f64>) -> Engine {
        Engine { clock, ..Default::default() }
    }

    fn now(&self) -> f64 {
        self.clock.map_or_else(now_native, |c| c())
    }

    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }

    pub fn part_names(&self) -> Vec<String> {
        self.parts.keys().cloned().collect()
    }

    /// Evaluate every part of `doc`, replacing the parts kept from the last evaluation.
    pub fn evaluate(&mut self, doc: &Document, opts: &EvalOptions) -> EvalResult {
        let t0 = self.now();
        let mut result = EvalResult { ok: true, ..Default::default() };
        self.parts.clear();
        for (i, part) in doc.parts.iter().enumerate() {
            let t = self.now();
            let misses = self.cache.misses;
            let name = if part.name.is_empty() { format!("part{i}") } else { part.name.clone() };
            let mut out = PartResult { name: name.clone(), ..Default::default() };
            match eval::eval(&part.node, &format!("parts/{i}"), &mut self.cache) {
                Err(e) => {
                    out.error = Some(e);
                    result.ok = false;
                }
                Ok(None) => {
                    out.ok = true;
                    out.empty = true;
                }
                Ok(Some(body)) => {
                    out.ok = true;
                    out.counts = body.counts().ok();
                    out.volume = body.volume(1e-6).ok();
                    out.area = body.area(1e-6).ok();
                    let record = match body.to_record() {
                        Ok((r, _)) => Some(r),
                        Err(e) => {
                            out.warnings.push(format!("record: {e}"));
                            None
                        }
                    };
                    let mut mesh = None;
                    if let Some(r) = &record {
                        let (lo, hi) = eval::bounds(r);
                        out.bbox = Some([lo, hi]);
                        if !opts.no_mesh {
                            match mesh_of(r, opts.tolerance, &mut out.warnings) {
                                Ok(m) => mesh = Some(m),
                                Err(e) => out.warnings.push(e),
                            }
                        }
                    }
                    self.parts.insert(name, PartState { body, record, mesh });
                }
            }
            out.cached = self.cache.misses == misses;
            out.millis = self.now() - t;
            result.parts.push(out);
        }
        result.cache_hits = self.cache.hits;
        result.cache_misses = self.cache.misses;
        self.cache.sweep();
        result.cache_size = self.cache.len();
        result.millis = self.now() - t0;
        result
    }

    /// The display mesh of a part from the last evaluation.
    pub fn mesh(&self, part: &str) -> Option<&MeshData> {
        self.parts.get(part).and_then(|p| p.mesh.as_ref())
    }

    /// The mesh of a part at another tolerance (for export).
    pub fn mesh_at(&self, part: &str, tolerance: f64) -> Result<MeshData, String> {
        let p = self.parts.get(part).ok_or_else(|| format!("no part named {part}"))?;
        let r = p.record.as_ref().ok_or("the part has no record")?;
        mesh_of(r, Some(tolerance), &mut Vec::new())
    }

    /// STEP AP242 text for the named parts (all when empty).
    pub fn step(&self, names: &[String]) -> Result<String, String> {
        let bodies: Vec<(&str, &Body)> = self
            .parts
            .iter()
            .filter(|(n, _)| names.is_empty() || names.contains(n))
            .map(|(n, p)| (n.as_str(), &p.body))
            .collect();
        if bodies.is_empty() {
            return Err("nothing to export".into());
        }
        let header = solidcore_step::write::product::Header {
            file_name: "tscad".into(),
            description: "made with tscad".into(),
            preprocessor_version: format!("tscad {}", env!("CARGO_PKG_VERSION")),
            ..Default::default()
        };
        solidcore_step::write::product::solidcore_bodies(&bodies, &header).map_err(|e| format!("step: {e}"))
    }

    /// What edge `index` of `part` is, and selectors that name it.
    pub fn pick_edge(&self, part: &str, index: usize) -> Result<PickInfo, String> {
        let r = self.record(part)?;
        let e = r.edges.get(index).ok_or("no such edge")?;
        let it = eval::edge_item(r, e);
        let kind = match &e.curve {
            rec::Curve::Line { .. } => "line",
            rec::Curve::Circle { .. } => "circle",
            rec::Curve::Ellipse { .. } => "ellipse",
            _ => "curve",
        };
        let mut cands = Vec::new();
        for a in [Axis::X, Axis::Y, Axis::Z] {
            cands.push(Selector::Parallel { axis: a });
            cands.push(Selector::Perpendicular { axis: a });
            cands.push(Selector::Max { axis: a });
            cands.push(Selector::Min { axis: a });
        }
        if let Some((_, rad)) = it.circle {
            cands.push(Selector::Radius { radius: rad });
        }
        let suggestions = suggest(r, &it, index, false, cands);
        Ok(PickInfo {
            index,
            kind: kind.into(),
            points: it.points,
            direction: it.dir,
            radius: it.circle.map(|c| c.1),
            suggestions,
        })
    }

    /// What face `index` of `part` is, and selectors that name it.
    pub fn pick_face(&self, part: &str, index: usize) -> Result<PickInfo, String> {
        let r = self.record(part)?;
        let f = r.faces.get(index).ok_or("no such face")?;
        let it = eval::face_item(r, f);
        let kind = match &f.surface {
            rec::Surface::Plane { .. } | rec::Surface::PlaneThrough { .. } => "plane",
            _ => "surface",
        };
        let mut cands = Vec::new();
        for a in [Axis::X, Axis::Y, Axis::Z] {
            cands.push(Selector::Max { axis: a });
            cands.push(Selector::Min { axis: a });
            cands.push(Selector::Parallel { axis: a });
            cands.push(Selector::Perpendicular { axis: a });
        }
        let suggestions = suggest(r, &it, index, true, cands);
        Ok(PickInfo { index, kind: kind.into(), points: it.points, direction: it.dir, radius: None, suggestions })
    }

    fn record(&self, part: &str) -> Result<&Record, String> {
        self.parts.get(part).and_then(|p| p.record.as_ref()).ok_or_else(|| format!("no part named {part}"))
    }
}

/// The candidates that select the item, by how few others they also select; then by index.
fn suggest(r: &Record, it: &eval::Item, index: usize, face: bool, cands: Vec<Selector>) -> Vec<Suggestion> {
    let (lo, hi) = eval::bounds(r);
    let count = |s: &Selector| {
        if face {
            eval::select_faces(r, s).len()
        } else {
            eval::select_edges(r, s).len()
        }
    };
    let mut hits: Vec<Suggestion> = cands
        .into_iter()
        .filter(|s| eval::matches(it, s, lo, hi, index, face))
        .map(|s| {
            let count = count(&s);
            Suggestion { selector: s, count }
        })
        .collect();
    // pairs of matching selectors, when they narrow things down
    let singles = hits.clone();
    for (i, a) in singles.iter().enumerate() {
        for b in singles.iter().skip(i + 1) {
            let s = Selector::And { of: vec![a.selector.clone(), b.selector.clone()] };
            let c = count(&s);
            if c < a.count.min(b.count) {
                hits.push(Suggestion { selector: s, count: c });
            }
        }
    }
    hits.sort_by_key(|s| s.count);
    hits.dedup_by_key(|s| serde_json::to_string(&s.selector).unwrap_or_default());
    hits.truncate(6);
    hits.push(Suggestion { selector: Selector::Index { indices: vec![index] }, count: 1 });
    hits
}

fn mesh_of(record: &Record, tolerance: Option<f64>, warnings: &mut Vec<String>) -> Result<MeshData, String> {
    let (lo, hi) = eval::bounds(record);
    let size = (0..3).map(|i| hi[i] - lo[i]).fold(0.0_f64, f64::max).max(1e-6);
    let t = match tolerance {
        Some(c) if c > 0.0 => solidcore_tess::MeshTolerance::display(c),
        _ => solidcore_tess::MeshTolerance::display_of(size),
    };
    let (plan, stats) = solidcore_tess::plan(record, &t, size).map_err(|e| format!("tessellate: {e}"))?;
    for f in &stats.unmeshed {
        warnings.push(format!("face {} left out of the mesh: {}", f.face, f.reason));
    }
    let (m, refused) = plan.evaluate();
    for f in &refused {
        warnings.push(format!("face refused by the mesher: {f:?}"));
    }
    let mut out = MeshData {
        positions: m.positions.iter().flat_map(|p| [p.x as f32, p.y as f32, p.z as f32]).collect(),
        normals: m.normals.iter().flat_map(|p| [p.x as f32, p.y as f32, p.z as f32]).collect(),
        indices: m.triangles.iter().flat_map(|t| *t).collect(),
        face_ids: m.tri_face.clone(),
        ..Default::default()
    };
    for (i, e) in m.edges.iter().enumerate() {
        if m.seams.get(i).copied().unwrap_or(false) || m.smooth_edges.get(i).copied().unwrap_or(false) {
            continue;
        }
        out.edge_points.extend(e.iter().flat_map(|p| [p.x as f32, p.y as f32, p.z as f32]));
        out.edge_counts.push(e.len() as u32);
        out.edge_ids.push(i as u32);
    }
    Ok(out)
}
