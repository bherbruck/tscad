# Upstream issue drafts (solidcore)

These are drafts of solidcore issues found by tscad's IR fuzzer (`scripts/fuzz/`, [docs/FUZZ.md](../FUZZ.md)). Each one has been reduced to a minimal Rust repro that uses only the `solidcore_ops` API (plus `solidcore_record` for picking edges), at rev `e7627f7f18176460ad4fb64fd1376fd66e1fe3b3`. They are not filed yet.

The same repros, runnable: `cargo test -p tscad-wasm --test upstream_repros -- --nocapture` prints the status of each. Add `-- --ignored` to run them as asserting tests; they fail while the bug is open.

| Draft | Symptom | Smallest repro | Fuzz findings |
|---|---|---|---|
| [pointclassify-cut-rounded-prism](pointclassify-cut-rounded-prism.md) | `not supported yet: SmFace::PointClassify` | an 8×8 r1 rounded prism, minus a box (cuts the bottom), ∪ a cylinder r10 | 2rn907, 1rmnn7, 1cmf4z |
| [tangent-cylinder-subtract](tangent-cylinder-subtract.md) | `the result is not a closed solid` | cylinder r10 − cylinder r5 at x = 5 (internally tangent) | 45zuhc (220 hits) |
| [line-contact-union-then-boolean](line-contact-union-then-boolean.md) | `not a closed solid` / `mass::enclosure` | (box ∪ tangent cylinder) ∪ the same cylinder | 12i29k (142 hits), z6e8di |
| [near-coincident-curved-faces](near-coincident-curved-faces.md) | `not a closed solid`, `status 1001`, **empty union** | sphere r10 ∩ copy moved 1e-3; cylinder ∪ copy moved 1e-4 | 16ioib, 1krj4p, sqt0xg, eudjyq |
| [union-with-own-fillet](union-with-own-fillet.md) | `status 1001` / `proto edge is deleted` | a revolved sector ∪ a copy with two edges rounded | p8rb0n |
| [conic-off-frame-after-near-rigid-transform](conic-off-frame-after-near-rigid-transform.md) | record: `a conic's NURBS is off its own frame and radii` | box ∩ cylinder placed by a 6-decimal rotation, ∪ a near-identical piece | 7u3v7n |

## Not drafted

`eval-error-cone-rsb28j` is not a kernel bug. `make_cone` documents that the top radius must differ from the base radius, and refuses `r1 == r2` with `Error::Argument`. tscad should build a cylinder for that case instead; that's a tscad change in `eval.rs`.
