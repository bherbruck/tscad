import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDev, type DevServer } from "../src/cli/dev";

let dir = "";
let dev: DevServer;
const messages: any[] = [];
let ws: WebSocket;

const model = (size: number) => `import { box } from "./parts"
export default function M() { return <part name="m">{box(${size})}</part> }
`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tscad-dev-"));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "tscad" } }));
  writeFileSync(join(dir, "parts.tsx"), `export const box = (s: number) => <box size={s} />\n`);
  writeFileSync(join(dir, "model.tsx"), model(10));
  dev = await startDev({ file: join(dir, "model.tsx"), port: 0 });
  ws = new WebSocket(`ws://localhost:${dev.port}/__ws`);
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
  await new Promise((r) => (ws.onopen = r));
}, 60_000);

afterAll(async () => {
  ws?.close();
  await dev?.stop();
});

const get = (path: string) => fetch(`http://localhost:${dev.port}${path}`);

async function waitFor<T>(f: () => T | undefined, ms = 5000): Promise<T> {
  const t = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error("timed out");
    await Bun.sleep(25);
  }
}

describe("tscad dev server", () => {
  test("serves the viewer page with its config", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("window.__TSCAD__");
    expect(html).toContain("/__tscad/viewer/main.js");
  });

  test("serves the app, worker and runtime bundles", async () => {
    for (const p of ["/__tscad/viewer/main.js", "/__tscad/viewer/worker.js", "/__tscad/index.js", "/__tscad/jsx-runtime.js", "/__tscad/viewer/styles.css"]) {
      const r = await get(p);
      expect(r.status).toBe(200);
      expect((await r.text()).length).toBeGreaterThan(100);
    }
    expect((await get("/__tscad/nope.js")).status).toBe(404);
  });

  test("serves the wasm with the right type", async () => {
    const r = await get("/wasm/tscad_wasm_bg.wasm");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/wasm");
    const head = new Uint8Array(await r.arrayBuffer()).subarray(0, 4);
    expect([...head]).toEqual([0, 0x61, 0x73, 0x6d]);
    expect((await get("/wasm/tscad_wasm.js")).status).toBe(200);
    expect((await get("/wasm/..%2Fpackage.json")).status).toBe(404);
  });

  test("the user bundle imports tscad from the served runtime and has a source map", async () => {
    const js = await (await get("/__user/bundle.js")).text();
    expect(js).toContain('from "/__tscad/jsx-runtime.js"');
    expect(js).not.toContain("node_modules");
    const map = await (await get("/__user/bundle.js.map")).json();
    expect(map.sources).toContain("model.tsx");
    expect(map.sources).toContain("parts.tsx");
    expect(map.sourcesContent.length).toBe(map.sources.length);
  });

  test("the socket sends the current bundle on connect", async () => {
    const m = await waitFor(() => messages.find((m) => m.type === "bundle"));
    expect(m.url).toMatch(/^\/__user\/bundle\.js\?v=\d+$/);
  });

  test("editing an imported file rebuilds and notifies", async () => {
    const before = messages.filter((m) => m.type === "bundle").length;
    writeFileSync(join(dir, "parts.tsx"), `export const box = (s: number) => <box size={s * 2} />\n`);
    await waitFor(() => messages.filter((m) => m.type === "bundle").length > before || undefined);
    expect(await (await get("/__user/bundle.js")).text()).toContain("s * 2");
  });

  test("a syntax error is pushed as bundle-error with a code frame, then recovers", async () => {
    writeFileSync(join(dir, "model.tsx"), `export default function M() { return <part name="m"><box size={1} </part> }\n`);
    const err = await waitFor(() => [...messages].reverse().find((m) => m.type === "bundle-error"));
    expect(err.errors[0].file).toBe("model.tsx");
    expect(err.errors[0].line).toBe(1);
    expect(err.errors[0].lines?.length).toBeGreaterThan(0);
    const n = messages.length;
    writeFileSync(join(dir, "model.tsx"), model(12));
    await waitFor(() => messages.slice(n).find((m) => m.type === "bundle"));
  });
});
