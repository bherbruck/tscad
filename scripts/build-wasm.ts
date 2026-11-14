#!/usr/bin/env bun
// Builds crates/tscad-wasm to wasm32 and runs the pinned wasm-bindgen CLI into wasm/.
// Usage: bun scripts/build-wasm.ts [--dev]
import { $ } from "bun";

const WASM_BINDGEN = "0.2.130"; // must equal the wasm-bindgen crate pin in crates/tscad-wasm/Cargo.toml
const dev = process.argv.includes("--dev");
const root = new URL("..", import.meta.url).pathname;
const out = `${root}wasm`;

const have = await $`wasm-bindgen --version`.nothrow().quiet().text();
if (!have.includes(WASM_BINDGEN)) {
  console.log(`installing wasm-bindgen-cli ${WASM_BINDGEN}...`);
  await $`cargo install wasm-bindgen-cli --version ${WASM_BINDGEN} --locked`;
}

const profile = dev ? "wasm-dev" : "release";
await $`cargo build -p tscad-wasm --target wasm32-unknown-unknown --profile ${profile}`.cwd(root);
const dir = dev ? "wasm-dev" : "release";
const wasm = `${root}target/wasm32-unknown-unknown/${dir}/tscad_wasm.wasm`;
await $`rm -rf ${out} && mkdir -p ${out}`;
await $`wasm-bindgen ${wasm} --out-dir ${out} --target web --typescript --out-name tscad_wasm`;

const opt = await $`which wasm-opt`.nothrow().quiet();
if (!dev && opt.exitCode === 0) {
  await $`wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals ${out}/tscad_wasm_bg.wasm -o ${out}/tscad_wasm_bg.wasm`.nothrow();
}
const size = Bun.file(`${out}/tscad_wasm_bg.wasm`).size;
console.log(`wasm/tscad_wasm_bg.wasm: ${(size / 1e6).toFixed(2)} MB`);
