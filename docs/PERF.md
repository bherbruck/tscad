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

## Timings: 2026-11-14 13:16 UTC, linux-x64 AMD Ryzen 7 7840HS w/ Radeon 780M Graphics, tscad 0.1.0, best of 2

| Workload | Native cold | Native warm | Wasm cold | Wasm warm | Wasm ÷ native | Native build / measure / record / mesh |
|---|---|---|---|---|---|---|
| spur-gear+toothChamfer | 36.91 s | 1.05 s | 53.61 s | 1.45 s | 1.5× | 35.88 s / 932 ms / 12 ms / 80 ms |
| synthetic-helix-sweep ⚠️ | 8.41 s | 8.44 s | 16.67 s | 17.03 s | 2.0× | 8.41 s / 0 ms / 0 ms / 0 ms |
| enclosure | 7.72 s | 305 ms | 14.58 s | 438 ms | 1.9× | 7.42 s / 198 ms / 5 ms / 90 ms |
| sketch-vase | 7.54 s | 476 ms | 11.31 s | 514 ms | 1.5× | 7.06 s / 439 ms / 1 ms / 44 ms |
| parts-showcase | 6.93 s | 240 ms | 16.38 s | 223 ms | 2.4× | 6.71 s / 140 ms / 4 ms / 81 ms |
| sketch-flange | 6.02 s | 250 ms | 10.43 s | 384 ms | 1.7× | 5.71 s / 227 ms / 3 ms / 79 ms |
| pi5-case-auto | 4.55 s | 236 ms | 9.97 s | 373 ms | 2.2× | 4.35 s / 137 ms / 6 ms / 55 ms |
| spur-gear | 4.13 s | 230 ms | 7.10 s | 345 ms | 1.7× | 3.90 s / 174 ms / 4 ms / 43 ms |
| sketch-link-arm | 3.73 s | 157 ms | 5.73 s | 242 ms | 1.5× | 3.55 s / 112 ms / 2 ms / 67 ms |
| synthetic-plate24 | 3.40 s | 145 ms | 6.50 s | 213 ms | 1.9× | 3.26 s / 103 ms / 2 ms / 36 ms |
| component-library | 3.17 s | 115 ms | 8.04 s | 259 ms | 2.5× | 3.06 s / 82 ms / 1 ms / 26 ms |
| hinge | 2.73 s | 209 ms | 5.23 s | 271 ms | 1.9× | 2.53 s / 131 ms / 4 ms / 66 ms |
| bolt-and-nut | 2.64 s | 157 ms | 5.26 s | 261 ms | 2.0× | 2.48 s / 116 ms / 2 ms / 40 ms |
| sketch-coat-hook | 2.46 s | 80 ms | 4.81 s | 112 ms | 2.0× | 2.38 s / 56 ms / 1 ms / 19 ms |
| synthetic-sphere-chain | 2.31 s | 443 ms | 4.63 s | 638 ms | 2.0× | 1.86 s / 426 ms / 1 ms / 15 ms |
| vase | 2.23 s | 195 ms | 4.00 s | 302 ms | 1.8× | 2.03 s / 183 ms / 0 ms / 16 ms |
| snap-box | 2.21 s | 116 ms | 3.58 s | 160 ms | 1.6× | 2.10 s / 84 ms / 2 ms / 29 ms |
| coaster | 1.86 s | 81 ms | 5.70 s | 219 ms | 3.1× | 1.78 s / 55 ms / 4 ms / 14 ms |
| engraved-logo | 1.61 s | 70 ms | 3.22 s | 120 ms | 2.0× | 1.55 s / 36 ms / 1 ms / 17 ms |
| laser-box | 1.32 s | 211 ms | 1.90 s | 300 ms | 1.4× | 1.13 s / 147 ms / 13 ms / 28 ms |
| synthetic-fillet-all | 1.27 s | 104 ms | 2.31 s | 157 ms | 1.8× | 1.17 s / 83 ms / 1 ms / 18 ms |
| cable-clip | 1.20 s | 48 ms | 2.21 s | 74 ms | 1.8× | 1.15 s / 34 ms / 1 ms / 12 ms |
| bracket | 1.14 s | 62 ms | 2.17 s | 87 ms | 1.9× | 1.07 s / 51 ms / 1 ms / 11 ms |
| synthetic-curved-booleans | 936 ms | 175 ms | 1.78 s | 241 ms | 1.9× | 765 ms / 149 ms / 1 ms / 21 ms |
| wall-hook | 785 ms | 32 ms | 1.51 s | 46 ms | 1.9× | 751 ms / 25 ms / 1 ms / 7 ms |
| phone-stand | 726 ms | 62 ms | 1.29 s | 91 ms | 1.8× | 662 ms / 39 ms / 2 ms / 22 ms |
| assembly-arm | 551 ms | 103 ms | 1.01 s | 133 ms | 1.8× | 449 ms / 62 ms / 1 ms / 38 ms |
| sketch-pulley | 409 ms | 123 ms | 968 ms | 152 ms | 2.4× | 310 ms / 54 ms / 1 ms / 45 ms |
| assembly-hinge-box | 69 ms | 4 ms | 124 ms | 6 ms | 1.8× | 65 ms / 3 ms / 0 ms / 0 ms |

### Trend (native cold, ms)

| Workload | 11-14 13:04 | 11-14 13:16 |
|---|---|---|
| assembly-arm | 520 | 551 |
| assembly-hinge-box | 67 | 69 |
| bolt-and-nut | 2581 | 2635 |
| bracket | 1101 | 1136 |
| cable-clip | 1208 | 1199 |
| coaster | 1877 | 1858 |
| component-library | 2714 | 3172 |
| enclosure | 4153 | 7718 |
| engraved-logo | – | 1607 |
| hinge | 1357 | 2729 |
| laser-box | 644 | 1316 |
| parts-showcase | 4144 | 6931 |
| phone-stand | 353 | 726 |
| pi5-case-auto | – | 4549 |
| sketch-coat-hook | – | 2456 |
| sketch-flange | – | 6018 |
| sketch-link-arm | 1848 | 3733 |
| sketch-pulley | 266 | 409 |
| sketch-vase | – | 7543 |
| snap-box | 1114 | 2212 |
| spur-gear | 4081 | 4126 |
| spur-gear+toothChamfer | 8896 | 36910 |
| synthetic-curved-booleans | 926 | 936 |
| synthetic-fillet-all | 1209 | 1267 |
| synthetic-helix-sweep | 8300 | 8411 |
| synthetic-plate24 | 3472 | 3398 |
| synthetic-sphere-chain | 2459 | 2306 |
| vase | 2152 | 2228 |
| wall-hook | 727 | 785 |

## Kernel profile: where the time goes

These totals cover all 29 profiled workloads, 91.0 s of kernel time (native, release). *Self* is time in the scope itself, excluding its child scopes. Time inside ops calls that falls outside every kernel scope is in neither table.

| Kernel scope | Calls | Self | Share of kernel time | Total (incl. children) |
|---|---|---|---|---|
| `mass::enclosure::volume_sign` | 654 | 54.46 s | 59.8% | 54.46 s |
| `blend::executive::refuse_blends_cutting_the_part` | 17 | 8.78 s | 9.6% | 8.78 s |
| `validation::coincidence::edge_face` | 12406 | 4.84 s | 5.3% | 4.84 s |
| `boolean::intersect_insert_relate` | 325 | 2.25 s | 2.5% | 2.25 s |
| `blend::session::insert_intersection_topology` | 17 | 1.72 s | 1.9% | 1.72 s |
| `offset::shell` | 4 | 1.67 s | 1.8% | 2.63 s |
| `blend::session::merge` | 17 | 1.07 s | 1.2% | 2.80 s |
| `blend::executive::refuse_irregular_balls` | 17 | 0.75 s | 0.8% | 0.75 s |
| `sweep::linear` | 136 | 0.58 s | 0.6% | 0.58 s |
| `boolean::manifold_boolean` | 321 | 0.56 s | 0.6% | 2.81 s |
| `blend::executive::classify_rails` | 17 | 0.47 s | 0.5% | 0.47 s |
| `blend::executive::stitch` | 17 | 0.15 s | 0.2% | 0.15 s |
| `blend::solver::trace` | 292 | 0.15 s | 0.2% | 0.15 s |
| `validation::coincidence` | 654 | 0.11 s | 0.1% | 4.99 s |
| `blend::executive::shrink_faces` | 17 | 0.08 s | 0.1% | 0.08 s |

### By ops call

The same kernel time, split by the `solidcore_ops` call that spent it (the kernel scopes above happen inside these):

| Ops call | Calls | Time | Share |
|---|---|---|---|
| `blend` | 17 | 26.35 s | 29.0% |
| `union_all` | 74 | 25.33 s | 27.8% |
| `SmApiBoolean` | 41 | 15.43 s | 17.0% |
| `sweep` | 2 | 8.64 s | 9.5% |
| `SmApiShellBrepFull` | 4 | 6.17 s | 6.8% |
| `extrude` | 140 | 3.76 s | 4.1% |
| `brep_volume` | 47 | 2.25 s | 2.5% |
| `area` | 47 | 1.16 s | 1.3% |
| `revolve` | 6 | 0.99 s | 1.1% |
| `bounds` | 47 | 0.33 s | 0.4% |
| `SmApiBrepCopy` | 893 | 0.30 s | 0.3% |
| `brep::to_record` | 68 | 0.09 s | 0.1% |

### Per workload

| Workload | Wall | In ops calls | Top ops calls (count, time) | Top kernel scopes by self time |
|---|---|---|---|---|
| spur-gear+toothChamfer | 32265 ms | 32228 ms | blend ×2 19262 ms; union_all ×3 5772 ms; SmApiBoolean ×1 5624 ms | `mass::enclosure::volume_sign` ×20 13711 ms; `blend::executive::refuse_blends_cutting_the_part` ×2 6591 ms; `validation::coincidence::edge_face` ×3444 2849 ms |
| synthetic-helix-sweep ⚠️ (the result is not a closed solid) | 8545 ms | 8545 ms | sweep ×1 8545 ms | `mass::enclosure::volume_sign` ×1 8287 ms; `validation::coincidence::edge_face` ×3 0 ms; `validation::coincidence` ×1 0 ms |
| sketch-vase | 4552 ms | 4545 ms | SmApiShellBrepFull ×1 4227 ms; brep_volume ×1 152 ms; area ×1 97 ms | `mass::enclosure::volume_sign` ×4 1895 ms; `offset::shell` ×1 1429 ms; `boolean::intersect_insert_relate` ×22 773 ms |
| spur-gear | 4155 ms | 4140 ms | union_all ×3 1290 ms; blend ×1 1165 ms; SmApiBoolean ×1 942 ms | `mass::enclosure::volume_sign` ×18 2006 ms; `validation::coincidence::edge_face` ×1136 415 ms; `sweep::linear` ×1 162 ms |
| parts-showcase | 4118 ms | 4111 ms | union_all ×15 3373 ms; SmApiBoolean ×5 545 ms; extrude ×7 59 ms | `mass::enclosure::volume_sign` ×71 3262 ms; `validation::coincidence::edge_face` ×997 118 ms; `boolean::intersect_insert_relate` ×28 58 ms |
| enclosure | 3932 ms | 3922 ms | union_all ×4 1747 ms; SmApiBoolean ×3 1151 ms; blend ×2 539 ms | `mass::enclosure::volume_sign` ×47 2652 ms; `blend::executive::refuse_blends_cutting_the_part` ×2 317 ms; `validation::coincidence::edge_face` ×645 209 ms |
| synthetic-plate24 | 3364 ms | 3357 ms | union_all ×1 1500 ms; SmApiBoolean ×1 930 ms; extrude ×25 780 ms | `mass::enclosure::volume_sign` ×52 2484 ms; `boolean::intersect_insert_relate` ×24 214 ms; `validation::coincidence::edge_face` ×558 106 ms |
| sketch-flange | 3003 ms | 2997 ms | blend ×1 1700 ms; union_all ×1 540 ms; SmApiBoolean ×1 323 ms | `mass::enclosure::volume_sign` ×24 1981 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 559 ms; `blend::executive::refuse_irregular_balls` ×1 33 ms |
| pi5-case-auto | 2664 ms | 2655 ms | union_all ×7 1425 ms; SmApiBoolean ×5 735 ms; extrude ×16 353 ms | `mass::enclosure::volume_sign` ×74 1821 ms; `validation::coincidence::edge_face` ×975 166 ms; `boolean::intersect_insert_relate` ×38 79 ms |
| bolt-and-nut | 2596 ms | 2564 ms | union_all ×3 1497 ms; revolve ×1 530 ms; SmApiBoolean ×3 389 ms | `mass::enclosure::volume_sign` ×21 2057 ms; `validation::coincidence::edge_face` ×231 57 ms; `boolean::intersect_insert_relate` ×8 44 ms |
| component-library | 2498 ms | 2492 ms | union_all ×2 1259 ms; SmApiBoolean ×1 722 ms; blend ×1 287 ms | `mass::enclosure::volume_sign` ×18 1860 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 171 ms; `validation::coincidence::edge_face` ×253 82 ms |
| synthetic-sphere-chain | 2289 ms | 2280 ms | union_all ×1 1844 ms; brep_volume ×1 280 ms; area ×1 147 ms | `mass::enclosure::volume_sign` ×7 1712 ms; `boolean::intersect_insert_relate` ×5 20 ms; `boolean::manifold_boolean` ×5 7 ms |
| vase | 2171 ms | 2162 ms | SmApiShellBrepFull ×1 1882 ms; brep_volume ×1 114 ms; revolve ×1 91 ms | `mass::enclosure::volume_sign` ×4 1404 ms; `offset::shell` ×1 228 ms; `boolean::intersect_insert_relate` ×12 118 ms |
| sketch-link-arm | 1823 ms | 1818 ms | blend ×1 1283 ms; union_all ×1 183 ms; SmApiBoolean ×1 151 ms | `mass::enclosure::volume_sign` ×12 938 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 590 ms; `validation::coincidence::edge_face` ×104 34 ms |
| coaster | 1814 ms | 1805 ms | SmApiBoolean ×1 794 ms; union_all ×1 558 ms; extrude ×37 214 ms | `mass::enclosure::volume_sign` ×80 812 ms; `validation::coincidence::edge_face` ×1458 196 ms; `boolean::intersect_insert_relate` ×37 192 ms |
| hinge | 1339 ms | 1331 ms | union_all ×6 795 ms; SmApiBoolean ×2 439 ms; brep_volume ×3 47 ms | `mass::enclosure::volume_sign` ×27 932 ms; `validation::coincidence::edge_face` ×215 80 ms; `boolean::intersect_insert_relate` ×13 30 ms |
| synthetic-fillet-all | 1237 ms | 1233 ms | blend ×1 891 ms; union_all ×1 150 ms; SmApiBoolean ×1 89 ms | `mass::enclosure::volume_sign` ×8 738 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 203 ms; `validation::coincidence::edge_face` ×77 23 ms |
| sketch-coat-hook | 1187 ms | 1183 ms | union_all ×4 744 ms; SmApiBoolean ×1 280 ms; sweep ×1 94 ms | `mass::enclosure::volume_sign` ×16 962 ms; `validation::coincidence::edge_face` ×114 31 ms; `boolean::intersect_insert_relate` ×5 19 ms |
| cable-clip | 1179 ms | 1177 ms | blend ×1 513 ms; union_all ×4 455 ms; SmApiBoolean ×1 152 ms | `mass::enclosure::volume_sign` ×18 719 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 156 ms; `validation::coincidence::edge_face` ×143 44 ms |
| snap-box | 1110 ms | 1106 ms | SmApiBoolean ×5 514 ms; union_all ×2 321 ms; extrude ×8 212 ms | `mass::enclosure::volume_sign` ×25 660 ms; `validation::coincidence::edge_face` ×356 113 ms; `boolean::intersect_insert_relate` ×8 67 ms |
| bracket | 1079 ms | 1076 ms | union_all ×4 633 ms; SmApiBoolean ×1 259 ms; blend ×2 86 ms | `mass::enclosure::volume_sign` ×23 815 ms; `validation::coincidence::edge_face` ×223 28 ms; `boolean::intersect_insert_relate` ×8 20 ms |
| synthetic-curved-booleans | 940 ms | 926 ms | union_all ×2 412 ms; SmApiBoolean ×1 348 ms; brep_volume ×1 107 ms | `mass::enclosure::volume_sign` ×8 632 ms; `boolean::intersect_insert_relate` ×3 43 ms; `boolean::manifold_boolean` ×3 13 ms |
| engraved-logo | 817 ms | 809 ms | SmApiBoolean ×2 438 ms; blend ×1 130 ms; union_all ×1 119 ms | `mass::enclosure::volume_sign` ×15 592 ms; `validation::coincidence::edge_face` ×111 52 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 25 ms |
| wall-hook | 740 ms | 737 ms | union_all ×3 399 ms; SmApiBoolean ×1 181 ms; blend ×1 95 ms | `mass::enclosure::volume_sign` ×14 564 ms; `validation::coincidence::edge_face` ×102 24 ms; `boolean::intersect_insert_relate` ×4 12 ms |
| laser-box | 642 ms | 634 ms | SmApiBoolean ×2 259 ms; extrude ×9 228 ms; brep_volume ×7 56 ms | `mass::enclosure::volume_sign` ×20 278 ms; `validation::coincidence::edge_face` ×698 37 ms; `sweep::linear` ×9 32 ms |
| assembly-arm | 522 ms | 495 ms | union_all ×3 283 ms; blend ×1 127 ms; brep_volume ×4 42 ms | `mass::enclosure::volume_sign` ×14 307 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 22 ms; `validation::coincidence::edge_face` ×79 10 ms |
| phone-stand | 353 ms | 351 ms | SmApiBoolean ×1 166 ms; blend ×1 142 ms; brep_volume ×1 15 ms | `mass::enclosure::volume_sign` ×6 167 ms; `blend::executive::refuse_blends_cutting_the_part` ×1 27 ms; `validation::coincidence::edge_face` ×125 23 ms |
| sketch-pulley | 269 ms | 266 ms | revolve ×1 218 ms; brep_volume ×1 30 ms; area ×1 11 ms | `mass::enclosure::volume_sign` ×1 186 ms; `validation::coincidence::edge_face` ×16 9 ms; `sweep::rotational` ×1 6 ms |
| assembly-hinge-box | 67 ms | 66 ms | SmApiShellBrepFull ×2 61 ms; brep_volume ×2 2 ms; create_box ×2 1 ms | `mass::enclosure::volume_sign` ×6 26 ms; `offset::shell` ×2 10 ms; `boolean::intersect_insert_relate` ×28 6 ms |

<!-- analysis: hand-written, kept by bench/report.ts -->

## Hotspots, in priority order (for the solidcore maintainer)

### 1. `mass::enclosure::volume_sign`: 60% of all kernel time
- **Evidence.** It is the top self-time scope in every one of the 29 workloads, between 39% and 97% of each one's kernel time: 54.5 s of 91 s in 654 calls, about 83 ms a call.
  - On plain boolean models it is 74% to 81%: bracket 76%, bolt-and-nut 80%, parts-showcase 79%, the 24-hole plate 74%.
  - The six-sphere union (75%) and the helix sweep (97%, 8.3 s in a single call) are dominated by it.
- **Where it comes from.** `topology::brep::valid_and_outward_failure` runs the certified, interval-arithmetic volume enclosure (`enclosure::volume_sign_within`, up to `CELL_BUDGET` cells) to prove the body's volume positive. The outward check in `solidcore_ops::body` (`is_valid_and_outward`, body.rs:97) calls it after every boolean, sweep and extrude result. Every intermediate solid of a CSG tree pays it once.
- **Suggestions**, from cheapest to most work:
  - **(a) Float signed volume first.** Run the ordinary signed volume (the divergence theorem over the faces at a coarse tolerance) and fall back to the certified enclosure only when it is within a margin of 0. Nearly every result is either clearly positive (a solid) or clearly negative (inside out).
  - **(b) Skip the check when the sign is known.** A boolean of two outward solids, a sweep of a CCW profile and an extrude with a positive distance already know their orientation.
  - **(c) Cache the sign by body identity.** Copies (`SmApiBrepCopy`, 893 calls) keep the same sign.
- **Payoff.** (a) alone could cut cold builds by about 2–3× across the board: the bracket would go from 1.1 s to about 0.3 s, the enclosure from 7.7 s to about 2.7 s.

### 2. `blend::executive::refuse_blends_cutting_the_part`: 9.6%
- **Evidence.** 8.8 s in 17 blend calls, about 0.5 s a call. It is 6.6 s of the 36.9 s tooth-chamfer gear (one chamfer over about 700 edges), 0.59 s of the link arm and 0.56 s of the flange.
- **Suggestion.** It scales with the number of blended edges times the part's faces. A bounding-box or face-adjacency prefilter before the exact test should take most of it.

### 3. `validation::coincidence::edge_face`: 5.3%
- **Evidence.** 12,406 calls, 4.8 s; 2.8 s of it in the tooth-chamfer gear, where the gear's hundreds of faces meet a few hundred more.
- **Suggestion.** It looks like an all-pairs edge against face test. A spatial index (box tree) over faces would turn it from O(E·F) into roughly O(E log F).

### 4. Boolean intersection proper: under 5%
- `boolean::intersect_insert_relate`: 2.25 s in 325 calls.
- `boolean::manifold_boolean`: 2.8 s total in 321 calls.

Surface intersection and the boolean itself are *not* the bottleneck today; validation around them is.

### 5. Shell (`offset::shell`) and the helix sweep
- **Shell:** 1.7 s self in 4 calls (the sketch vase); `SmApiShellBrepFull` takes 6.2 s.
- **Helix sweep:** 8.4 s natively and 16.7 s as wasm, and it still fails with "not a closed solid". 97% of that time is `volume_sign` on the swept body. It's worth checking whether the failure *is* the enclosure ending `Undecided` within its cell budget. If so, the solid is probably fine and only the proof gives up.

## Native vs wasm, and the cache
- **Native vs wasm.** The same engine natively (bun:ffi) is 1.4× to 3.1× faster than wasm, 1.9× typical. The ratio is about the same for every workload, so the profile above, measured natively, applies to the browser too.
- **The cache.** tscad's subtree cache makes a warm re-evaluation 15× to 50× faster than cold, for example enclosure 7.7 s cold and 0.3 s warm. What a warm run still pays is mostly the volume and area measurement and the display mesh, not the build.
- **Measurement and meshing.** The `measure` phase (volume and area at 1e-6 relative accuracy) is 2% to 20% of a cold build and up to 90% of a warm one, for example 0.43 s of the 0.44 s warm sphere chain. Meshing (`solidcore-tess`) is never more than 3% of a cold build.
