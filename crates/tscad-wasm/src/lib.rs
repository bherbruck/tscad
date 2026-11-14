//! tscad's kernel module: the tscad IR evaluated with solidcore, for JS through wasm-bindgen.
//!
//! [`engine::Engine`] is the session in plain Rust (tested natively); [`Kernel`] is its JS
//! handle. The IR types ([`ir`]) and results are generated into TypeScript by tsify, so the
//! TS side never restates them.

pub mod engine;
pub mod eval;
pub mod ir;

use wasm_bindgen::prelude::*;

pub use engine::{Engine, EvalOptions, EvalResult, MeshData, PickInfo};
pub use ir::Document;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
    #[wasm_bindgen(js_namespace = globalThis, js_name = __tscadPanic)]
    fn report_panic(message: &str);
}

fn from_js<T: serde::de::DeserializeOwned>(v: JsValue, what: &str) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(v).map_err(|e| JsError::new(&format!("bad {what}: {e}")))
}

fn to_js<T: serde::Serialize>(v: &T) -> Result<JsValue, JsError> {
    v.serialize(&serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(false))
        .map_err(|e| JsError::new(&format!("result: {e}")))
}

fn clock() -> f64 {
    performance_now()
}

#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(|info| {
        let message = info.to_string();
        console_error_panic_hook::hook(info);
        report_panic(&message);
    }));
}

/// The crate version.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// A part's display mesh as typed arrays.
#[wasm_bindgen]
pub struct Mesh(MeshData);

#[wasm_bindgen]
impl Mesh {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f32> {
        self.0.positions.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> Vec<f32> {
        self.0.normals.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> {
        self.0.indices.clone()
    }
    #[wasm_bindgen(getter, js_name = faceIds)]
    pub fn face_ids(&self) -> Vec<u32> {
        self.0.face_ids.clone()
    }
    #[wasm_bindgen(getter, js_name = edgePoints)]
    pub fn edge_points(&self) -> Vec<f32> {
        self.0.edge_points.clone()
    }
    #[wasm_bindgen(getter, js_name = edgeCounts)]
    pub fn edge_counts(&self) -> Vec<u32> {
        self.0.edge_counts.clone()
    }
    #[wasm_bindgen(getter, js_name = edgeIds)]
    pub fn edge_ids(&self) -> Vec<u32> {
        self.0.edge_ids.clone()
    }
}

/// A solidcore session: evaluates documents (re-using unchanged subtrees from the last
/// evaluation), and keeps each part's body for meshes, picks and STEP.
#[wasm_bindgen]
pub struct Kernel(Engine);

#[wasm_bindgen]
impl Kernel {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Kernel {
        Kernel(Engine::new(Some(clock)))
    }

    /// Evaluate every part of `document`.
    #[wasm_bindgen(unchecked_return_type = "EvalResult")]
    pub fn evaluate(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Document")] document: JsValue,
        #[wasm_bindgen(unchecked_param_type = "EvalOptions | undefined")] options: JsValue,
    ) -> Result<JsValue, JsError> {
        let document: Document = from_js(document, "document")?;
        let options: EvalOptions =
            if options.is_undefined() || options.is_null() { EvalOptions::default() } else { from_js(options, "options")? };
        to_js(&self.0.evaluate(&document, &options))
    }

    /// Names of the parts kept from the last evaluation.
    #[wasm_bindgen(js_name = partNames)]
    pub fn part_names(&self) -> Vec<String> {
        self.0.part_names()
    }

    /// The display mesh of `part` from the last evaluation.
    pub fn mesh(&self, part: &str) -> Option<Mesh> {
        self.0.mesh(part).cloned().map(Mesh)
    }

    /// The mesh of `part` at chord `tolerance` (mm), for export.
    #[wasm_bindgen(js_name = meshAt)]
    pub fn mesh_at(&self, part: &str, tolerance: f64) -> Result<Mesh, JsError> {
        self.0.mesh_at(part, tolerance).map(Mesh).map_err(|e| JsError::new(&e))
    }

    /// STEP AP242 text for the named parts (all when none named).
    pub fn step(&self, parts: Option<Vec<String>>) -> Result<String, JsError> {
        self.0.step(&parts.unwrap_or_default()).map_err(|e| JsError::new(&e))
    }

    /// Edge `index` of `part`: what it is and selectors that name it.
    #[wasm_bindgen(js_name = pickEdge)]
    #[wasm_bindgen(unchecked_return_type = "PickInfo")]
    pub fn pick_edge(&self, part: &str, index: usize) -> Result<JsValue, JsError> {
        to_js(&self.0.pick_edge(part, index).map_err(|e| JsError::new(&e))?)
    }

    /// Face `index` of `part`: what it is and selectors that name it.
    #[wasm_bindgen(js_name = pickFace)]
    #[wasm_bindgen(unchecked_return_type = "PickInfo")]
    pub fn pick_face(&self, part: &str, index: usize) -> Result<JsValue, JsError> {
        to_js(&self.0.pick_face(part, index).map_err(|e| JsError::new(&e))?)
    }

    /// Forget every cached subtree.
    #[wasm_bindgen(js_name = clearCache)]
    pub fn clear_cache(&mut self) {
        self.0.clear_cache();
    }
}
