//! Phase timings of example IR dumps (set TSCAD_IR_DIR to a folder of ir-*.json); skipped otherwise.
use tscad_wasm::{Document, Engine, EvalOptions};

#[test]
fn profile_examples() {
    let Ok(dir) = std::env::var("TSCAD_IR_DIR") else { return };
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if !path.file_name().unwrap().to_string_lossy().starts_with("ir-") {
            continue;
        }
        let d: Document = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let mut e = Engine::new(None);
        let r = e.evaluate(&d, &EvalOptions::default());
        println!("{} total {:.0} ms", path.display(), r.millis);
        for p in &r.parts {
            println!("  {:<12} ok={} build {:.0} measure {:.0} record {:.0} mesh {:.0}", p.name, p.ok, p.phases.build, p.phases.measure, p.phases.record, p.phases.mesh);
        }
    }
}
