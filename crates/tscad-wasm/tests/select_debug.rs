//! Fillet volumes against closed forms: the edges selected are the edges rounded.
use tscad_wasm::{Document, Engine, EvalOptions};

fn vol(node: &str) -> Result<f64, String> {
    let d: Document = serde_json::from_str(&format!(r#"{{"parts":[{{"name":"a","node":{node}}}]}}"#)).unwrap();
    let mut e = Engine::new(None);
    let r = e.evaluate(&d, &EvalOptions::default());
    let p = &r.parts[0];
    p.volume.ok_or_else(|| format!("{:?}", p.error))
}

#[test]
fn vertical_fillet_volume() {
    let v = vol(r#"{"type":"fillet","radius":2,"edges":{"type":"parallel","axis":"z"},"children":[{"type":"box","size":[20,20,10]}]}"#).unwrap();
    let expect = 4000.0 - 4.0 * (4.0 - std::f64::consts::PI) * 10.0;
    assert!((v - expect).abs() < 1e-3, "{v} vs {expect}");
}

#[test]
fn rounded_rect_top_fillet() {
    // a rounded rectangle 30 x 20, corner radius 4, extruded 5; fillet its top loop (tangent chain)
    let (w, h, r) = (15.0_f64, 10.0_f64, 4.0_f64);
    let pi = std::f64::consts::PI;
    let arc = |cx: f64, cy: f64, a0: f64| format!(r#"{{"type":"arc","center":[{cx},{cy},0],"axis":[0,0,1],"reference":[1,0,0],"radius":{r},"start":{a0},"end":{}}}"#, a0 + pi / 2.0);
    let line = |a: [f64; 2], b: [f64; 2]| format!(r#"{{"type":"line","start":[{},{},0],"end":[{},{},0]}}"#, a[0], a[1], b[0], b[1]);
    let prof = [
        line([-w + r, -h], [w - r, -h]), arc(w - r, -h + r, -pi / 2.0),
        line([w, -h + r], [w, h - r]), arc(w - r, h - r, 0.0),
        line([w - r, h], [-w + r, h]), arc(-w + r, h - r, pi / 2.0),
        line([-w, h - r], [-w, -h + r]), arc(-w + r, -h + r, pi),
    ].join(",");
    let ext = format!(r#"{{"type":"extrude","direction":[0,0,1],"distance":5,"profile":[{prof}]}}"#);
    let base = vol(&ext).unwrap();
    println!("base {base}");
    for (name, node) in [
        ("fillet top", format!(r#"{{"type":"fillet","radius":1,"edges":{{"type":"max","axis":"z"}},"children":[{ext}]}}"#)),
        ("chamfer top", format!(r#"{{"type":"chamfer","distance":1,"edges":{{"type":"max","axis":"z"}},"children":[{ext}]}}"#)),
        ("shell", format!(r#"{{"type":"shell","thickness":-1,"faces":{{"type":"max","axis":"z"}},"children":[{ext}]}}"#)),
        ("shell out", format!(r#"{{"type":"shell","thickness":1,"faces":{{"type":"max","axis":"z"}},"children":[{ext}]}}"#)),
        ("shell closed", format!(r#"{{"type":"shell","thickness":-1,"faces":{{"type":"none"}},"children":[{ext}]}}"#)),
        ("shell bottom", format!(r#"{{"type":"shell","thickness":-1,"faces":{{"type":"min","axis":"z"}},"children":[{ext}]}}"#)),
        ("shell cyl", r#"{"type":"shell","thickness":-1,"faces":{"type":"max","axis":"z"},"children":[{"type":"cylinder","radius":10,"height":5}]}"#.to_string()),
        ("fillet all", format!(r#"{{"type":"fillet","radius":1,"children":[{ext}]}}"#)),
    ] {
        println!("{name}: {:?}", vol(&node));
    }
}

#[test]
fn export_agent_fillet_cases() {
    let pi = std::f64::consts::PI;
    let v = vol(r#"{"type":"fillet","radius":4,"edges":{"type":"parallel","axis":"z"},"children":[{"type":"box","size":[80,30,12]}]}"#).unwrap();
    let e = 80.0 * 30.0 * 12.0 - 4.0 * (16.0 - 4.0 * pi) * 12.0;
    assert!((v - e).abs() < 1e-3, "{v} {e}");
    let v = vol(r#"{"type":"fillet","radius":10,"edges":{"type":"parallel","axis":"z"},"children":[{"type":"box","size":[80,30,40]}]}"#).unwrap();
    let e = 80.0 * 30.0 * 40.0 - 4.0 * (100.0 - 25.0 * pi) * 40.0;
    assert!((v - e).abs() < 1e-3, "{v} {e}");
    for r in [2.0, 3.1] {
        let v = vol(&format!(r#"{{"type":"fillet","radius":{r},"edges":{{"type":"parallel","axis":"z"}},"children":[{{"type":"box","size":[100,80,3]}}]}}"#)).unwrap();
        let e = 100.0 * 80.0 * 3.0 - 4.0 * (r * r - r * r * pi / 4.0) * 3.0;
        assert!((v - e).abs() < 1e-3, "{v} {e}");
    }
}

#[test]
fn pick_tangent_edge_is_smooth() {
    let d: Document = serde_json::from_str(r#"{"parts":[{"name":"a","node":{"type":"fillet","radius":1,"edges":{"type":"max","axis":"z"},"children":[{"type":"difference","children":[
        {"type":"box","size":[40,30,5],"center":true},{"type":"cylinder","radius":2.1,"height":20,"center":true}]}]}}]}"#).unwrap();
    let mut e = Engine::new(None);
    assert!(e.evaluate(&d, &EvalOptions::default()).ok);
    let mut smooth = 0;
    for i in 0..e.mesh("a").unwrap().edge_ids.len() + 40 {
        let Ok(p) = e.pick_edge("a", i) else { break };
        assert!(p.suggestions.iter().all(|s| s.count > 0), "edge {i}: {:?}", p.suggestions);
        smooth += usize::from(p.smooth);
    }
    assert!(smooth > 0);
}

#[test]
fn sphere_bbox_is_exact() {
    let d: Document = serde_json::from_str(r#"{"parts":[{"name":"s","node":{"type":"sphere","radius":2}}]}"#).unwrap();
    let mut e = Engine::new(None);
    let r = e.evaluate(&d, &EvalOptions::default());
    let [lo, hi] = r.parts[0].bbox.unwrap();
    for i in 0..3 {
        assert!((lo[i] + 2.0).abs() < 1e-6 && (hi[i] - 2.0).abs() < 1e-6, "{lo:?} {hi:?}");
    }
}
