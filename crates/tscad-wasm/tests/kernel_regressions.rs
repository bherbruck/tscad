//! The fuzzer's still-failing kernel findings (fuzz/regressions.json): each is evaluated and its
//! status printed (`cargo test --test kernel_regressions -- --nocapture`). Known kernel bugs do
//! not fail the test; a panic does. When one starts passing, re-run the fuzzer's
//! `--replay-findings` to mark it fixed.
use tscad_wasm::{Document, Engine, EvalOptions};

#[test]
fn kernel_regressions() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fuzz/regressions.json");
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let all: serde_json::Value = serde_json::from_str(&text).expect("regressions.json");
    let list = all["regressions"].as_array().cloned().unwrap_or_default();
    let mut passing = 0;
    for r in &list {
        let doc: Document = match serde_json::from_value(r["ir"].clone()) {
            Ok(d) => d,
            Err(e) => {
                println!("SKIP {} (IR no longer parses: {e})", r["id"]);
                continue;
            }
        };
        let mut e = Engine::new(None);
        let res = e.evaluate(&doc, &EvalOptions::default());
        let clean = res.ok && res.parts.iter().all(|p| p.warnings.is_empty() && (p.empty || p.volume.is_some_and(|v| v > 0.0)));
        if clean {
            passing += 1;
        }
        let why = res
            .parts
            .iter()
            .find_map(|p| p.error.as_ref().map(|e| e.message.clone()).or_else(|| p.warnings.first().cloned()))
            .unwrap_or_default();
        println!("{} {:<45} {}", if clean { "PASS" } else { "FAIL" }, r["id"].as_str().unwrap_or("?"), why);
    }
    println!("{passing}/{} evaluate cleanly (volume oracles are checked by the fuzzer's replay)", list.len());
}

#[test]
fn sweep_regressions() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fuzz/sweep-regressions.json");
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let all: serde_json::Value = serde_json::from_str(&text).expect("json");
    let list = all["regressions"].as_array().cloned().unwrap_or_default();
    for r in &list {
        let Ok(doc) = serde_json::from_value::<Document>(r["ir"].clone()) else { continue };
        let mut e = Engine::new(None);
        let res = e.evaluate(&doc, &EvalOptions::default());
        let why = res.parts.iter().find_map(|p| p.error.as_ref().map(|e| e.message.clone())).unwrap_or_default();
        println!("{} {:<30} vol={:?} {}", if res.ok { "PASS" } else { "FAIL" }, r["id"].as_str().unwrap_or("?"), res.parts.first().and_then(|p| p.volume), why);
    }
}
