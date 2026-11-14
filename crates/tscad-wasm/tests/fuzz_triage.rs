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

#[test]
fn revolved_torus_transform() {
    let tau = std::f64::consts::TAU;
    let rev = format!(r#"{{"type":"revolve","origin":[0,0,0],"axis":[0,0,1],"angle":{tau},"profile":[{{"type":"arc","center":[20,0,0],"axis":[0,-1,0],"reference":[1,0,0],"radius":3,"start":0,"end":{tau}}}]}}"#);
    println!("revolved torus: {}", run(&rev));
    let (s, c) = (30f64.to_radians().sin(), 30f64.to_radians().cos());
    let rot = format!(r#"{{"type":"transform","matrix":[1,0,0,5, 0,{c},{},0, 0,{s},{c},0, 0,0,0,1],"children":[{rev}]}}"#, -s);
    println!("rotated revolved torus: {}", run(&rot));
    println!("rotated revolved torus minus itself: {}", run(&format!(r#"{{"type":"difference","children":[{rot},{rot}]}}"#)));
    let cyl = r#"{"type":"cylinder","radius":3,"height":10}"#;
    println!("rotated cylinder: {}", run(&format!(r#"{{"type":"transform","matrix":[1,0,0,5, 0,{c},{},0, 0,{s},{c},0, 0,0,0,1],"children":[{cyl}]}}"#, -s)));
    let sph = r#"{"type":"sphere","radius":3}"#;
    println!("translated sphere: {}", run(&format!(r#"{{"type":"transform","matrix":[1,0,0,5, 0,1,0,0, 0,0,1,0, 0,0,0,1],"children":[{sph}]}}"#)));
}

#[test]
fn revolve_about_tilted_axis() {
    let tau = std::f64::consts::TAU;
    let (s, c) = (30f64.to_radians().sin(), 30f64.to_radians().cos());
    // axis z rotated 30 deg about x: (0, -s, c); profile plane contains axis and x
    let ax = [0.0, -s, c];
    let rev = format!(r#"{{"type":"revolve","origin":[5,0,0],"axis":[0,{},{}],"angle":{tau},"profile":[{{"type":"arc","center":[25,0,0],"axis":[0,{},{}],"reference":[1,0,0],"radius":3,"start":0,"end":{tau}}}]}}"#,
        ax[1], ax[2], -c, -s);
    println!("tilted revolve: {}", run(&rev));
    println!("tilted revolve minus itself: {}", run(&format!(r#"{{"type":"difference","children":[{rev},{rev}]}}"#)));
    println!("box minus tilted torus: {}", run(&format!(r#"{{"type":"difference","children":[{{"type":"box","size":[60,60,10],"center":true}},{rev}]}}"#)));
}

#[test]
fn moved_torus_workaround() {
    let torus = r#"{"type":"torus","majorRadius":20,"minorRadius":3}"#;
    let (s, c) = (30f64.to_radians().sin(), 30f64.to_radians().cos());
    let rot = format!(r#"{{"type":"transform","matrix":[1,0,0,5, 0,{c},{},0, 0,{s},{c},0, 0,0,0,1],"children":[{torus}]}}"#, -s);
    let nested = format!(r#"{{"type":"transform","matrix":[1,0,0,0, 0,1,0,7, 0,0,1,0, 0,0,0,1],"children":[{rot}]}}"#);
    for (name, n) in [("rotated", rot.clone()), ("nested", nested.clone())] {
        let out = run(&n);
        println!("{name}: {out}");
        assert!(out.contains("warn=[]") && out.contains("ok=true"), "{out}");
    }
    let out = run(&format!(r#"{{"type":"difference","children":[{rot},{rot}]}}"#));
    assert!(out.contains("vol=None"), "{out}");
}

#[test]
fn rounded_rotation_torus() {
    let torus = r#"{"type":"torus","majorRadius":20,"minorRadius":3}"#;
    // 30 degrees about Z, rounded to 6 decimals
    let rot = format!(r#"{{"type":"transform","matrix":[0.866025,-0.5,0,4, 0.5,0.866025,0,-2, 0,0,1,1, 0,0,0,1],"children":[{torus}]}}"#);
    let out = run(&rot);
    assert!(out.contains("warn=[]") && out.contains("ok=true"), "{out}");
    let out = run(&format!(r#"{{"type":"difference","children":[{rot},{rot}]}}"#));
    assert!(out.contains("vol=None"), "{out}");
}

#[test]
fn cone_special_cases() {
    let pi = std::f64::consts::PI;
    let v = |n: &str| run(n);
    let eq = v(r#"{"type":"cone","bottomRadius":3,"topRadius":3,"height":15}"#);
    assert!(eq.contains(&format!("{:.4}", pi * 9.0 * 15.0)[..8]), "{eq}");
    let down = v(r#"{"type":"cone","bottomRadius":0,"topRadius":5,"height":10}"#);
    assert!(down.contains("ok=true") && down.contains("warn=[]"), "{down}");
}

#[test]
fn gear_fillet_extrude_orientation() {
    let fwd = r#"{"type":"extrude","profile":[{"type":"nurbs","degree":3,"points":[[1.89754,0.38838,0,1],[1.66027,0.34585,0,1],[1.33161,0.35727,0,1],[1.29836,0.45265,0,1]],"knots":[0,0,0,0,1,1,1,1]},{"type":"line","start":[1.29836,0.45265,0],"end":[0,0,0]},{"type":"line","start":[0,0,0],"end":[1.89754,0.38838,0]}],"direction":[0,0,1],"distance":2}"#;
    let rev = r#"{"type":"extrude","profile":[{"type":"line","start":[1.89754,0.38838,0],"end":[0,0,0]},{"type":"line","start":[0,0,0],"end":[1.29836,0.45265,0]},{"type":"nurbs","degree":3,"points":[[1.29836,0.45265,0,1],[1.33161,0.35727,0,1],[1.66027,0.34585,0,1],[1.89754,0.38838,0,1]],"knots":[0,0,0,0,1,1,1,1]}],"direction":[0,0,1],"distance":2}"#;
    println!("forward: {}", run(fwd));
    println!("reversed: {}", run(rev));
}

#[test]
fn reversed_arc_loop_extrudes_same() {
    use tscad_wasm::ir::Curve;
    let pi = std::f64::consts::PI;
    let d = vec![
        Curve::Arc { center: [0.0; 3], axis: [0.0, 0.0, 1.0], reference: [1.0, 0.0, 0.0], radius: 5.0, start: 0.0, end: pi },
        Curve::Line { start: [-5.0, 0.0, 0.0], end: [5.0, 0.0, 0.0] },
    ];
    let back = tscad_wasm::eval::reversed(&d);
    // the reversed arc starts where the original ended
    if let Curve::Arc { start, end, axis, .. } = &back[1] {
        assert_eq!((*start, *end, axis[2]), (-pi, 0.0, -1.0));
    } else {
        panic!("arc expected last");
    }
    let node = |p: &Vec<Curve>| format!(r#"{{"type":"extrude","direction":[0,0,1],"distance":3,"profile":{}}}"#, serde_json::to_string(p).unwrap());
    let (a, b) = (run(&node(&d)), run(&node(&back)));
    println!("{a}\n{b}");
    let vol = |s: &str| s.split("vol=Some(").nth(1).and_then(|r| r.split(')').next()).and_then(|v| v.parse::<f64>().ok()).unwrap();
    assert!((vol(&a) - pi * 25.0 / 2.0 * 3.0).abs() < 1e-6 && (vol(&a) - vol(&b)).abs() < 1e-6);
}
