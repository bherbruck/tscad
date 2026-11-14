//! Kernel profile of every IR document in bench/ir/ (made by `bun bench/dump-ir.ts`): each is
//! evaluated (and meshed) in a fresh engine inside `solidcore_ops::session::profiled`, and the
//! kernel's scopes are totalled per workload into bench/profile/<name>.json plus
//! bench/profile/summary.json (read by `bun bench/report.ts` for docs/PERF.md).
//!
//! cargo test --release -p tscad-wasm --features profile,solidcore-ops/profile \
//!     --test perf_profile -- --nocapture --test-threads 1
//!
//! (`solidcore-ops/profile` turns on `session::profiled`; `profile` alone turns on the kernel's
//! scopes.) `TSCAD_PROFILE_ONLY=name,name` limits the workloads.
#![cfg(feature = "profile")]

use std::collections::BTreeMap;
use std::time::Instant;

use serde_json::{json, Value};
use tscad_wasm::{Document, Engine, EvalOptions};

#[derive(Default, Clone)]
struct Tot {
    count: u64,
    total_ns: u64,
    self_ns: u64,
    counters: [u64; 9],
}

#[test]
fn perf_profile() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    let dir = format!("{root}/bench/ir");
    let out = format!("{root}/bench/profile");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        println!("no {dir}: run `bun bench/dump-ir.ts` first");
        return;
    };
    std::fs::create_dir_all(&out).unwrap();
    let only: Option<Vec<String>> = std::env::var("TSCAD_PROFILE_ONLY").ok().map(|s| s.split(',').map(str::to_string).collect());
    let mut paths: Vec<_> = entries.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
    paths.sort();
    let counter_names = solidcore::profile::Counter::ALL.map(|c| format!("{c:?}"));
    let mut summary = Vec::new();
    for path in paths {
        let name = path.file_stem().unwrap().to_string_lossy().to_string();
        if only.as_ref().is_some_and(|o| !o.contains(&name)) {
            continue;
        }
        let doc: Document = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let mut engine = Engine::new(None);
        let t0 = Instant::now();
        let (res, calls) = solidcore_ops::session::profiled(|| engine.evaluate(&doc, &EvalOptions::default()));
        let wall_ms = t0.elapsed().as_secs_f64() * 1e3;

        // kernel scopes by name, over every ops call
        let mut scopes: BTreeMap<&'static str, Tot> = BTreeMap::new();
        // ops calls by name: how many, and their time (the call's own root scope)
        let mut ops: BTreeMap<&'static str, Tot> = BTreeMap::new();
        for c in &calls {
            let o = ops.entry(c.call).or_default();
            o.count += 1;
            o.total_ns += c.profile.scopes.first().and_then(|s| s.dur_ns).unwrap_or(0);
            for s in &c.profile.summary {
                if s.name == c.call {
                    continue; // the call's own root scope: counted in `ops`
                }
                let t = scopes.entry(s.name).or_default();
                t.count += s.count;
                t.total_ns += s.total_ns.unwrap_or(0);
                t.self_ns += s.self_ns.unwrap_or(0);
                for (a, b) in t.counters.iter_mut().zip(&s.self_counters) {
                    *a += b;
                }
            }
        }
        let kernel_ns: u64 = ops.values().map(|o| o.total_ns).sum();
        let mut by_self: Vec<_> = scopes.iter().collect();
        by_self.sort_by(|a, b| b.1.self_ns.cmp(&a.1.self_ns));
        let mut ops_sorted: Vec<_> = ops.iter().collect();
        ops_sorted.sort_by(|a, b| b.1.total_ns.cmp(&a.1.total_ns));
        let phases: Vec<Value> = res
            .parts
            .iter()
            .map(|p| json!({"part": p.name, "ok": p.ok, "build": p.phases.build, "measure": p.phases.measure, "record": p.phases.record, "mesh": p.phases.mesh, "error": p.error.as_ref().map(|e| e.message.clone())}))
            .collect();
        let scope_json = |(n, t): (&&str, &Tot)| {
            let counters: BTreeMap<&str, u64> = counter_names.iter().map(String::as_str).zip(t.counters).filter(|(_, v)| *v > 0).collect();
            json!({"name": n, "count": t.count, "total_ms": t.total_ns as f64 / 1e6, "self_ms": t.self_ns as f64 / 1e6, "counters": counters})
        };
        let report = json!({
            "workload": name,
            "ok": res.ok,
            "wall_ms": wall_ms,
            "kernel_ms": kernel_ns as f64 / 1e6,
            "ops_calls": calls.len(),
            "phases": phases,
            "ops": ops_sorted.iter().map(|(n, t)| json!({"call": n, "count": t.count, "total_ms": t.total_ns as f64 / 1e6})).collect::<Vec<_>>(),
            "scopes": by_self.iter().take(60).map(|&(n, t)| scope_json((n, t))).collect::<Vec<_>>(),
        });
        std::fs::write(format!("{out}/{name}.json"), serde_json::to_string_pretty(&report).unwrap()).unwrap();
        println!("\n== {name}: {wall_ms:.0} ms wall, {:.0} ms in {} ops calls, ok={}", kernel_ns as f64 / 1e6, calls.len(), res.ok);
        for (n, t) in ops_sorted.iter().take(5) {
            println!("   op {n:<34} ×{:<5} {:>9.1} ms", t.count, t.total_ns as f64 / 1e6);
        }
        for (n, t) in by_self.iter().take(10) {
            println!("   {n:<60} ×{:<7} self {:>8.1} ms  total {:>8.1} ms", t.count, t.self_ns as f64 / 1e6, t.total_ns as f64 / 1e6);
        }
        summary.push(report);
    }
    std::fs::write(format!("{out}/summary.json"), serde_json::to_string_pretty(&summary).unwrap()).unwrap();
}
