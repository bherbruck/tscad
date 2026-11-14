use tscad_wasm::{Document, Engine, EvalOptions};

fn run(node: &str) -> String {
    let d: Document = serde_json::from_str(&format!(r#"{{"parts":[{{"name":"a","node":{node}}}]}}"#)).unwrap();
    let mut e = Engine::new(None);
    let r = e.evaluate(&d, &EvalOptions::default());
    let p = &r.parts[0];
    format!("ok={} vol={:?} warn={:?} err={:?}", p.ok, p.volume, p.warnings, p.error.as_ref().map(|e| &e.message))
}

#[test]
fn triage() {
    let torus = r#"{"type":"torus","majorRadius":20,"minorRadius":3}"#;
    println!("plain torus: {}", run(torus));
    println!("translated torus: {}", run(&format!(r#"{{"type":"transform","matrix":[1,0,0,5, 0,1,0,0, 0,0,1,0, 0,0,0,1],"children":[{torus}]}}"#)));
    let (s, c) = (30f64.to_radians().sin(), 30f64.to_radians().cos());
    let rot = format!(r#"{{"type":"transform","matrix":[1,0,0,0, 0,{c},{},0, 0,{s},{c},0, 0,0,0,1],"children":[{torus}]}}"#, -s);
    println!("rotated torus: {}", run(&rot));
    println!("rotated torus minus itself: {}", run(&format!(r#"{{"type":"difference","children":[{rot},{rot}]}}"#)));
    // same through the raw ops API, to separate tscad from the kernel
    let b = solidcore_ops::make_torus([0.0; 3], 20.0, 3.0).unwrap();
    let m = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [5.0, 0.0, 0.0, 1.0]];
    b.transform(&m).unwrap();
    println!("ops translated torus volume {:?} record {:?}", b.volume(1e-6), b.to_record().map(|(r, _)| r.tolerance));
    println!("cone equal radii: {}", run(r#"{"type":"cone","bottomRadius":5,"topRadius":5,"height":4}"#));
}
