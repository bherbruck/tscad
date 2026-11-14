use tscad_wasm::{Document, Engine, EvalOptions, EvalResult};

fn run_with(e: &mut Engine, doc: &str) -> EvalResult {
    let d: Document = serde_json::from_str(doc).expect("doc");
    let r = e.evaluate(&d, &EvalOptions::default());
    for p in &r.parts {
        eprintln!("{} ok={} vol={:?} counts={:?} err={:?} warn={:?} ms={:.1} cached={} tris={:?}", p.name, p.ok, p.volume, p.counts, p.error, p.warnings, p.millis, p.cached, e.mesh(&p.name).map(|m| m.indices.len() / 3));
    }
    eprintln!("hits {} misses {} cache {}", r.cache_hits, r.cache_misses, r.cache_size);
    r
}
fn run(doc: &str) -> (Engine, EvalResult) {
    let mut e = Engine::new(None);
    let r = run_with(&mut e, doc);
    (e, r)
}

#[test]
fn box_minus_cylinder_step_and_cache() {
    let doc = r#"{"parts":[{"name":"plate","node":{"type":"difference","children":[
        {"type":"box","size":[40,30,10],"center":true},
        {"type":"cylinder","radius":5,"height":20,"center":true}]}}]}"#;
    let (mut e, r) = run(doc);
    assert!(r.ok);
    let v = r.parts[0].volume.unwrap();
    assert!((v - (40.0 * 30.0 * 10.0 - std::f64::consts::PI * 25.0 * 10.0)).abs() < 1e-3, "{v}");
    let step = e.step(&[]).expect("step");
    assert!(step.contains("ISO-10303-21"));
    let r2 = run_with(&mut e, doc);
    assert!(r2.parts[0].cached);
    let pick = e.pick_edge("plate", 0).expect("pick");
    eprintln!("{pick:?}");
}

#[test]
fn fillet_top_edges() {
    let (_, r) = run(r#"{"parts":[{"name":"rounded","node":{"type":"fillet","radius":2,"edges":{"type":"max","axis":"z"},"children":[
        {"type":"box","size":[20,20,10]}]}}]}"#);
    assert!(r.ok);
}

#[test]
fn fillet_all_and_chamfer() {
    let (_, r) = run(r#"{"parts":[{"name":"all","node":{"type":"fillet","radius":1,"children":[{"type":"box","size":[20,20,10]}]}},
      {"name":"ch","node":{"type":"chamfer","distance":1,"edges":{"type":"parallel","axis":"z"},"children":[{"type":"box","size":[20,20,10]}]}}]}"#);
    assert!(r.ok);
}

#[test]
fn extrude_and_revolve() {
    let (_, r) = run(r#"{"parts":[{"name":"tri","node":{"type":"extrude","direction":[0,0,1],"distance":5,"profile":[
        {"type":"line","start":[0,0,0],"end":[10,0,0]},{"type":"line","start":[10,0,0],"end":[0,10,0]},{"type":"line","start":[0,10,0],"end":[0,0,0]}]}},
      {"name":"disc","node":{"type":"extrude","direction":[0,0,1],"distance":2,"profile":[
        {"type":"arc","center":[0,0,0],"axis":[0,0,1],"reference":[1,0,0],"radius":5,"start":0,"end":6.283185307179586}]}},
      {"name":"rev","node":{"type":"revolve","origin":[0,0,0],"axis":[0,0,1],"angle":6.283185307179586,"profile":[
        {"type":"line","start":[5,0,0],"end":[8,0,0]},{"type":"line","start":[8,0,0],"end":[8,0,4]},{"type":"line","start":[8,0,4],"end":[5,0,4]},{"type":"line","start":[5,0,4],"end":[5,0,0]}]}}]}"#);
    assert!(r.ok);
}

#[test]
fn shell_and_transform() {
    let (_, r) = run(r#"{"parts":[{"name":"cup","node":{"type":"shell","thickness":-1,"faces":{"type":"max","axis":"z"},"children":[{"type":"box","size":[20,20,10]}]}},
      {"name":"moved","node":{"type":"transform","matrix":[1,0,0,5, 0,1,0,0, 0,0,1,0, 0,0,0,1],"children":[{"type":"sphere","radius":3},{"type":"torus","majorRadius":6,"minorRadius":1}]}}]}"#);
    assert!(r.ok);
}

#[test]
fn fillet_all_with_hole_skips_seams() {
    let (_, r) = run(r#"{"parts":[{"name":"a","node":{"type":"fillet","radius":1,"children":[{"type":"difference","children":[
        {"type":"box","size":[40,30,10],"center":true},{"type":"cylinder","radius":5,"height":20,"center":true}]}]}}]}"#);
    assert!(r.ok, "{:?}", r.parts[0].error);
}

#[test]
fn step_round_trip() {
    let cases = [
        ("box", r#"{"type":"box","size":[20,20,10]}"#, true),
        ("holed", r#"{"type":"difference","children":[{"type":"box","size":[40,30,10],"center":true},{"type":"cylinder","radius":5,"height":20,"center":true}]}"#, true),
        ("sphere", r#"{"type":"sphere","radius":3}"#, false),
        ("cone", r#"{"type":"cone","bottomRadius":5,"topRadius":2,"height":6}"#, false),
        ("filletVert", r#"{"type":"fillet","radius":2,"edges":{"type":"parallel","axis":"z"},"children":[{"type":"box","size":[20,20,10]}]}"#, false),
        ("filletTop", r#"{"type":"fillet","radius":2,"edges":{"type":"max","axis":"z"},"children":[{"type":"box","size":[20,20,10]}]}"#, false),
    ];
    for (name, node, must) in cases {
        let (e, r) = run(&format!(r#"{{"parts":[{{"name":"{name}","node":{node}}}]}}"#));
        assert!(r.ok);
        let step = e.step(&[]).expect("step");
        let doc = serde_json::json!({"parts":[{"name":"back","node":{"type":"step","data":step}}]}).to_string();
        let (_, r2) = run(&doc);
        let ok = r2.ok && {
            let (a, b) = (r.parts[0].volume.unwrap(), r2.parts[0].volume.unwrap());
            (a - b).abs() / a < 1e-6
        };
        println!("ROUNDTRIP {name}: {}", if ok { "ok".to_string() } else { format!("{:?}", r2.parts[0].error) });
        if !ok && name == "filletTop" {
            for l in step.lines().filter(|l| l.contains("CONICAL_SURFACE")) {
                println!("  {l}");
            }
        }
        // fillet corners: solidcore has no pcurve of a NURBS edge on a spline surface yet
        // (docs/KERNEL_ISSUES.md), so their STEP files do not read back.
        assert!(ok || !must, "{name}");
    }
}
