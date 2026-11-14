#!/usr/bin/env bun
// Builds the kernel as a native library for bun:ffi into native/<platform>-<arch>/.
// loadKernel() then uses it in bun (2–3x faster than wasm); TSCAD_NATIVE=0 turns it off.
// Usage: bun scripts/build-native.ts
import { $ } from "bun";

const root = new URL("..", import.meta.url).pathname;
await $`cargo build -p tscad-wasm --profile native`.cwd(root);
const ext = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so";
const prefix = process.platform === "win32" ? "" : "lib";
const from = `${root}target/native/${prefix}tscad_wasm.${ext}`;
const dir = `${root}native/${process.platform}-${process.arch}`;
await $`mkdir -p ${dir}`;
const to = `${dir}/${prefix}tscad.${ext}`;
await $`cp ${from} ${to}.tmp && mv ${to}.tmp ${to}`;
if (process.platform === "linux") await $`strip ${to}`.nothrow();
console.log(`${to}: ${(Bun.file(to).size / 1e6).toFixed(1)} MB`);
