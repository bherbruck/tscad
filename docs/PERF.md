# Kernel performance

Measured with tscad's bench (`bench/`). These are timings of real models and synthetic workloads on solidcore at rev `e7627f7f…`, natively (bun:ffi) and as wasm, plus a native kernel profile (solidcore's `profile` feature) per workload.

```sh
bun bench/dump-ir.ts                 # examples + variants + synthetic workloads → bench/ir/*.json
bun bench/run.ts --repeat 3          # cold/warm timings, native and wasm → bench/results.json (appended)
cargo test --release -p tscad-wasm --features profile,solidcore-ops/profile \
    --test perf_profile -- --nocapture --test-threads 1   # → bench/profile/*.json
bun bench/report.ts                  # → this file (tables above the analysis)
```

**Cold** means a fresh kernel session evaluates the document: build, measure (volume and area), record, and display mesh. **Warm** means the same document evaluated again, with every subtree from tscad's cache. The figures are the best of N runs.

## Kernel profile: where the time goes

These totals cover all 24 profiled workloads, 56.4 s of kernel time (native, release). *Self* is time in the scope itself, excluding its child scopes. Time inside ops calls that falls outside every kernel scope is in neither table.

| Kernel scope | Calls | Self | Share of kernel time | Total (incl. children) |
|---|---|---|---|---|
| `mass::enclosure::volume_sign` | 503 | 34.37 s | 60.9% | 34.37 s |
| `blend::executive::refuse_irregular_balls` | 14 | 8.26 s | 14.6% | 8.26 s |
| `validation::coincidence::edge_face` | 7830 | 1.81 s | 3.2% | 1.81 s |
| `blend::executive::refuse_blends_cutting_the_part` | 13 | 1.58 s | 2.8% | 1.58 s |
| `boolean::intersect_insert_relate` | 239 | 1.14 s | 2.0% | 1.14 s |
| `sweep::linear` | 109 | 0.54 s | 1.0% | 0.54 s |
| `boolean::manifold_boolean` | 236 | 0.43 s | 0.8% | 1.58 s |
| `offset::shell` | 3 | 0.23 s | 0.4% | 0.40 s |
| `blend::session::insert_intersection_topology` | 13 | 0.10 s | 0.2% | 0.10 s |
| `blend::session::merge` | 13 | 0.09 s | 0.2% | 0.20 s |
| `validation::coincidence` | 503 | 0.05 s | 0.1% | 1.89 s |
| `sweep::rotational` | 6 | 0.03 s | 0.1% | 0.03 s |
| `blend::executive::stitch` | 13 | 0.02 s | 0.0% | 0.02 s |
| `blend::executive::classify_rails` | 13 | 0.01 s | 0.0% | 0.01 s |
| `validation::coincidence::vertex_face` | 7830 | 0.01 s | 0.0% | 0.01 s |

### By ops call

The same kernel time, split by the `solidcore_ops` call that spent it (the kernel scopes above happen inside these):

| Ops call | Calls | Time | Share |
|---|---|---|---|
| `union_all` | 58 | 16.96 s | 30.1% |
| `blend` | 14 | 13.69 s | 24.3% |
| `sweep` | 1 | 8.72 s | 15.5% |
| `SmApiBoolean` | 31 | 8.15 s | 14.5% |
| `extrude` | 109 | 3.10 s | 5.5% |
| `SmApiShellBrepFull` | 3 | 1.99 s | 3.5% |
| `brep_volume` | 38 | 1.42 s | 2.5% |
| `revolve` | 6 | 1.09 s | 1.9% |
| `area` | 38 | 0.70 s | 1.2% |
| `bounds` | 38 | 0.24 s | 0.4% |
| `SmApiBrepCopy` | 676 | 0.19 s | 0.3% |
| `create_cylinder` | 33 | 0.05 s | 0.1% |

### Per workload

| Workload | Wall | In ops calls | Top ops calls (count, time) | Top kernel scopes by self time |
|---|---|---|---|---|
| spur-gear+toothChamfer ⚠️ (too large: the largest Distance that fits is 0.15635114390885801) | 8975 ms | 8972 ms | blend ×1 8435 ms; extrude ×1 521 ms; face_surface::of ×864 6 ms | `blend::executive::refuse_irregular_balls` ×1 8137 ms; `mass::enclosure::volume_sign` ×2 207 ms; `sweep::linear` ×1 170 ms |
| synthetic-helix-sweep ⚠️ (the result is not a closed solid) | 8717 ms | 8717 ms | sweep ×1 8717 ms | `mass::enclosure::volume_sign` ×1 8462 ms; `validation::coincidence::edge_face` ×3 0 ms; `validation::coincidence` ×1 0 ms |
| parts-showcase | 4254 ms | 4247 ms | union_all ×15 3473 ms; SmApiBoolean ×5 565 ms; extrude ×7 66 ms | `mass::enclosure::volume_sign` ×71 3355 ms; `validation::coincidence::edge_face` ×997 122 ms; `boolean::intersect_insert_relate` ×28 61 ms |
| spur-gear | 4037 ms | 4025 ms | union_all ×3 1255 ms; blend ×1 1127 ms; SmApiBoolean ×1 921 ms | `mass::enclosure::volume_sign` ×18 1975 ms; `validation::coincidence::edge_face` ×1136 393 ms; `sweep::linear` ×1 153 ms |
| enclosure | 3966 ms | 3958 ms | union_all ×4 1759 ms; SmApiBoolean ×3 1170 ms; blend ×2 549 ms | `mass::enclosure::volume_sign` ×47 2670 ms; `blend::executive::refuse_blends_cutting_the_part` ×2 323 ms; `validation::coincidence::edge_face` ×645 210 ms |
| synthetic-plate24 | 3360 ms | 3352 ms | union_all ×1 1502 ms; SmApiBoolean ×1 927 ms; extrude ×25 778 ms | `mass::enclosure::volume_sign` ×52 2493 ms; `boolean::intersect_insert_relate` ×24 216 ms; `validation::coincidence::edge_face` ×558 101 ms |
| bolt-and-nut | 2679 ms | 2646 ms | union_all ×3 1538 ms; revolve ×1 541 ms; SmApiBoolean ×3 391 ms | `mass::enclosure::volume_sign` ×21 2089 ms; `validation::coincidence::edge_face` ×231 62 ms; `boolean::intersect_insert_relate` ×8 43 ms |
| component-library | 2468 ms | 2464 ms | union_all ×2 1217 ms; SmApiBoolean ×1 735 ms; blend ×1 281 ms | `mass::enclosure::volume_sign` ×18 1847 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 164 ms; `validation::coincidence::edge_face` ×253 79 ms |
| synthetic-sphere-chain | 2315 ms | 2306 ms | union_all ×1 1862 ms; brep_volume ×1 284 ms; area ×1 151 ms | `mass::enclosure::volume_sign` ×7 1728 ms; `boolean::intersect_insert_relate` ×5 23 ms; `boolean::manifold_boolean` ×5 9 ms |
| vase | 2215 ms | 2207 ms | SmApiShellBrepFull ×1 1926 ms; brep_volume ×1 115 ms; revolve ×1 93 ms | `mass::enclosure::volume_sign` ×4 1451 ms; `offset::shell` ×1 223 ms; `boolean::intersect_insert_relate` ×12 117 ms |
| sketch-link-arm | 1890 ms | 1879 ms | blend ×1 1325 ms; union_all ×1 179 ms; SmApiBoolean ×1 154 ms | `mass::enclosure::volume_sign` ×12 981 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 590 ms; `validation::coincidence::edge_face` ×104 35 ms |
| coaster | 1862 ms | 1852 ms | SmApiBoolean ×1 817 ms; union_all ×1 566 ms; extrude ×37 218 ms | `mass::enclosure::volume_sign` ×80 824 ms; `validation::coincidence::edge_face` ×1458 204 ms; `boolean::intersect_insert_relate` ×37 193 ms |
| hinge | 1376 ms | 1368 ms | union_all ×6 819 ms; SmApiBoolean ×2 448 ms; brep_volume ×3 48 ms | `mass::enclosure::volume_sign` ×27 961 ms; `validation::coincidence::edge_face` ×215 79 ms; `boolean::intersect_insert_relate` ×13 31 ms |
| snap-box | 1341 ms | 1336 ms | SmApiBoolean ×5 571 ms; union_all ×2 421 ms; extrude ×8 278 ms | `mass::enclosure::volume_sign` ×25 800 ms; `validation::coincidence::edge_face` ×356 139 ms; `boolean::intersect_insert_relate` ×8 72 ms |
| synthetic-fillet-all | 1213 ms | 1208 ms | blend ×1 869 ms; union_all ×1 149 ms; SmApiBoolean ×1 87 ms | `mass::enclosure::volume_sign` ×8 735 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 187 ms; `validation::coincidence::edge_face` ×77 23 ms |
| cable-clip | 1193 ms | 1190 ms | blend ×1 521 ms; union_all ×4 454 ms; SmApiBoolean ×1 156 ms | `mass::enclosure::volume_sign` ×18 725 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 156 ms; `validation::coincidence::edge_face` ×143 45 ms |
| bracket | 1095 ms | 1092 ms | union_all ×4 649 ms; SmApiBoolean ×1 261 ms; blend ×2 86 ms | `mass::enclosure::volume_sign` ×23 829 ms; `validation::coincidence::edge_face` ×223 29 ms; `boolean::intersect_insert_relate` ×8 20 ms |
| synthetic-curved-booleans | 928 ms | 915 ms | union_all ×2 406 ms; SmApiBoolean ×1 344 ms; brep_volume ×1 109 ms | `mass::enclosure::volume_sign` ×8 627 ms; `boolean::intersect_insert_relate` ×3 41 ms; `boolean::manifold_boolean` ×3 12 ms |
| wall-hook | 737 ms | 734 ms | union_all ×3 388 ms; SmApiBoolean ×1 179 ms; blend ×1 99 ms | `mass::enclosure::volume_sign` ×14 556 ms; `validation::coincidence::edge_face` ×102 25 ms; `boolean::intersect_insert_relate` ×4 12 ms |
| laser-box | 650 ms | 643 ms | SmApiBoolean ×2 263 ms; extrude ×9 234 ms; brep_volume ×7 55 ms | `mass::enclosure::volume_sign` ×20 283 ms; `validation::coincidence::edge_face` ×698 37 ms; `sweep::linear` ×9 33 ms |
| assembly-arm | 523 ms | 496 ms | union_all ×3 287 ms; blend ×1 127 ms; brep_volume ×4 41 ms | `mass::enclosure::volume_sign` ×14 309 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 22 ms; `validation::coincidence::edge_face` ×79 10 ms |
| sketch-pulley | 399 ms | 387 ms | revolve ×1 303 ms; brep_volume ×1 52 ms; area ×1 18 ms | `mass::enclosure::volume_sign` ×1 273 ms; `validation::coincidence::edge_face` ×16 9 ms; `sweep::rotational` ×1 6 ms |
| phone-stand | 348 ms | 346 ms | SmApiBoolean ×1 163 ms; blend ×1 141 ms; brep_volume ×1 15 ms | `mass::enclosure::volume_sign` ×6 164 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 27 ms; `validation::coincidence::edge_face` ×125 22 ms |
| assembly-hinge-box | 66 ms | 65 ms | SmApiShellBrepFull ×2 60 ms; brep_volume ×2 2 ms; create_box ×2 1 ms | `mass::enclosure::volume_sign` ×6 25 ms; `offset::shell` ×2 10 ms; `boolean::intersect_insert_relate` ×28 6 ms |

<!-- analysis: hand-written, kept by bench/report.ts -->
