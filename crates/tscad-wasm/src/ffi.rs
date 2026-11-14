//! A C ABI over [`Engine`] for native hosts (bun:ffi): the same session as the wasm `Kernel`,
//! 2–3x faster than wasm for the CLI, the MCP server and tests.
//!
//! Every call takes a UTF-8 JSON request and leaves its result in the engine's buffer
//! (`tscad_result_ptr` / `tscad_result_len`), valid until the next call on that engine.
//! Results are `[u32 json_len][json][binary]`: meshes put their arrays in the binary part.
//! A Rust panic is caught and returned as `{"panic": "..."}`; the engine is replaced.

use std::panic::{catch_unwind, AssertUnwindSafe};

use serde::Deserialize;

use crate::engine::{Engine, EvalOptions, MeshData};
use crate::ir::Document;

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
enum Request {
    Version,
    Evaluate {
        document: Document,
        #[serde(default)]
        options: Option<EvalOptions>,
    },
    Mesh {
        part: String,
        #[serde(default)]
        tolerance: Option<f64>,
    },
    Step {
        #[serde(default)]
        parts: Option<Vec<String>>,
    },
    PickEdge {
        part: String,
        index: usize,
    },
    PickFace {
        part: String,
        index: usize,
    },
    PartNames,
    ClearCache,
}

/// A native session: the engine and its result buffer.
pub struct Native {
    engine: Engine,
    out: Vec<u8>,
}

fn encode(json: &serde_json::Value, bin: &[u8]) -> Vec<u8> {
    let text = serde_json::to_vec(json).unwrap_or_else(|_| b"{\"error\":\"encode\"}".to_vec());
    let mut out = Vec::with_capacity(4 + text.len() + bin.len() + 3);
    let padded = (text.len() + 3) / 4 * 4;
    out.extend_from_slice(&(padded as u32).to_le_bytes());
    out.extend_from_slice(&text);
    out.resize(4 + padded, b' ');
    out.extend_from_slice(bin);
    out
}

fn mesh_bin(m: &MeshData) -> (serde_json::Value, Vec<u8>) {
    let mut bin = Vec::new();
    let mut f32s = |v: &[f32], bin: &mut Vec<u8>| {
        let at = bin.len();
        for x in v {
            bin.extend_from_slice(&x.to_le_bytes());
        }
        serde_json::json!([at, v.len()])
    };
    let positions = f32s(&m.positions, &mut bin);
    let normals = f32s(&m.normals, &mut bin);
    let edge_points = f32s(&m.edge_points, &mut bin);
    let u32s = |v: &[u32], bin: &mut Vec<u8>| {
        let at = bin.len();
        for x in v {
            bin.extend_from_slice(&x.to_le_bytes());
        }
        serde_json::json!([at, v.len()])
    };
    let indices = u32s(&m.indices, &mut bin);
    let face_ids = u32s(&m.face_ids, &mut bin);
    let edge_counts = u32s(&m.edge_counts, &mut bin);
    let edge_ids = u32s(&m.edge_ids, &mut bin);
    (
        serde_json::json!({ "mesh": {
            "positions": positions, "normals": normals, "indices": indices, "faceIds": face_ids,
            "edgePoints": edge_points, "edgeCounts": edge_counts, "edgeIds": edge_ids,
        }}),
        bin,
    )
}

fn handle(engine: &mut Engine, req: &[u8]) -> (serde_json::Value, Vec<u8>) {
    let err = |e: String| (serde_json::json!({ "error": e }), Vec::new());
    let req: Request = match serde_json::from_slice(req) {
        Ok(r) => r,
        Err(e) => return err(format!("bad request: {e}")),
    };
    let ok = |v: serde_json::Value| (serde_json::json!({ "ok": v }), Vec::new());
    let value = |v: Result<serde_json::Value, serde_json::Error>| match v {
        Ok(v) => ok(v),
        Err(e) => err(e.to_string()),
    };
    match req {
        Request::Version => ok(serde_json::json!(env!("CARGO_PKG_VERSION"))),
        Request::Evaluate { document, options } => {
            value(serde_json::to_value(engine.evaluate(&document, &options.unwrap_or_default())))
        }
        Request::Mesh { part, tolerance } => {
            let made = match tolerance {
                Some(t) => engine.mesh_at(&part, t),
                None => engine.mesh(&part).cloned().ok_or_else(|| format!("no mesh for {part}")),
            };
            match made {
                Ok(m) => mesh_bin(&m),
                Err(e) if tolerance.is_none() => (serde_json::json!({ "ok": null, "missing": e }), Vec::new()),
                Err(e) => err(e),
            }
        }
        Request::Step { parts } => match engine.step(&parts.unwrap_or_default()) {
            Ok(s) => ok(serde_json::json!(s)),
            Err(e) => err(e),
        },
        Request::PickEdge { part, index } => match engine.pick_edge(&part, index) {
            Ok(p) => value(serde_json::to_value(p)),
            Err(e) => err(e),
        },
        Request::PickFace { part, index } => match engine.pick_face(&part, index) {
            Ok(p) => value(serde_json::to_value(p)),
            Err(e) => err(e),
        },
        Request::PartNames => ok(serde_json::json!(engine.part_names())),
        Request::ClearCache => {
            engine.clear_cache();
            ok(serde_json::Value::Null)
        }
    }
}

/// A new native session.
#[no_mangle]
pub extern "C" fn tscad_new() -> *mut Native {
    Box::into_raw(Box::new(Native { engine: Engine::new(None), out: Vec::new() }))
}

/// Free a session from [`tscad_new`].
///
/// # Safety
/// `n` must come from [`tscad_new`] and not be used again.
#[no_mangle]
pub unsafe extern "C" fn tscad_free(n: *mut Native) {
    if !n.is_null() {
        drop(Box::from_raw(n));
    }
}

/// Run the JSON request at `ptr..ptr+len`; the result is left in the session's buffer.
/// Returns the result's length.
///
/// # Safety
/// `n` from [`tscad_new`]; `ptr..ptr+len` initialised memory.
#[no_mangle]
pub unsafe extern "C" fn tscad_call(n: *mut Native, ptr: *const u8, len: usize) -> usize {
    let Some(n) = n.as_mut() else { return 0 };
    let req = std::slice::from_raw_parts(ptr, len);
    let (json, bin) = match catch_unwind(AssertUnwindSafe(|| handle(&mut n.engine, req))) {
        Ok(r) => r,
        Err(p) => {
            let msg = p
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| p.downcast_ref::<&str>().map(|s| (*s).to_string()))
                .unwrap_or_else(|| "unknown panic".into());
            // a panic may leave the session half-changed: start a fresh one
            n.engine = Engine::new(None);
            (serde_json::json!({ "panic": msg }), Vec::new())
        }
    };
    n.out = encode(&json, &bin);
    n.out.len()
}

/// The address of the last result (see [`tscad_call`]).
///
/// # Safety
/// `n` from [`tscad_new`].
#[no_mangle]
pub unsafe extern "C" fn tscad_result_ptr(n: *const Native) -> *const u8 {
    n.as_ref().map_or(std::ptr::null(), |n| n.out.as_ptr())
}
