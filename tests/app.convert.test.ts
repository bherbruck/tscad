import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { componentName } from "../src/cli/convert";
import { NOTES_HEAD, withNotes } from "../src/playground/scad-import";
import { decode, encode } from "../src/viewer/wire";
import { startDev, type DevServer } from "../src/cli/dev";

const CLI = join(import.meta.dir, "../src/cli/index.ts");
const run = (cwd: string, ...args: string[]) => Bun.spawnSync(["bun", CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: "1" } });

describe("tscad convert", () => {
  const dir = mkdtempSync(join(tmpdir(), "tscad-convert-"));
  writeFileSync(join(dir, "my-plate_v2.scad"), `w = 40; // [10:100]\ncube([w, 20, 5]);\nsurface(file="a.dat");\n`);
  writeFileSync(join(dir, "bad.scad"), `cube([1,2;\n`);

  test("writes a model next to the .scad, notes as file:line, and the model builds", () => {
    const r = run(dir, "convert", "my-plate_v2.scad");
    expect(r.exitCode).toBe(0);
    expect(r.stderr.toString()).toContain("my-plate_v2.scad:3: surface()");
    const tsx = readFileSync(join(dir, "my-plate_v2.tsx"), "utf8");
    expect(tsx).toContain("export default function MyPlateV2");
    expect(run(dir, "convert", "my-plate_v2.scad").exitCode).toBe(1); // exists
    expect(run(dir, "build", "my-plate_v2.tsx", "-o", "p.stl").exitCode).toBe(0);
  }, 60_000);

  test("-o - prints to stdout; syntax errors point at line:col", () => {
    const r = run(dir, "convert", "my-plate_v2.scad", "-o", "-", "--name", "Plate");
    expect(r.stdout.toString()).toContain("export default function Plate");
    const bad = run(dir, "convert", "bad.scad");
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr.toString()).toMatch(/bad\.scad:1:\d+/);
    expect(run(dir, "convert", "nope.scad").exitCode).toBe(1);
  }, 60_000);

  test("component names", () => {
    expect(componentName("my-plate_v2.scad")).toBe("MyPlateV2");
    expect(componentName("3d-knob.scad")).toBe("DKnob");
    expect(componentName("___.scad")).toBe("Model");
  });

  test("playground notes header and warnings on its lines", () => {
    const r = withNotes("export default 1\n", [{ line: 3, message: "surface() isn't supported" }], "a.scad");
    expect(r.text.startsWith(NOTES_HEAD)).toBe(true);
    expect(r.text.split("\n")[r.notes[0]!.line - 1]).toContain("a.scad:3: surface()");
    expect(r.notes[0]!.severity).toBe("warning");
  });
});

describe("binary wire codec", () => {
  test("typed arrays, Infinity and plain JSON round-trip; arrays are views (no copy)", () => {
    const msg = { type: "result", data: { mesh: { positions: new Float32Array([1, 2.5, -3]), indices: new Uint32Array([0, 1, 2]) }, thick: [Infinity, 1], s: "x" } };
    const out = decode<typeof msg>(encode(msg));
    expect([...out.data.mesh.positions]).toEqual([1, 2.5, -3]);
    expect(out.data.mesh.indices).toBeInstanceOf(Uint32Array);
    expect(out.data.thick).toEqual([Infinity, 1]);
    expect(out.data.s).toBe("x");
  });
});

describe("tscad dev: server-side evaluation", () => {
  let dev: DevServer;
  const dir = mkdtempSync(join(tmpdir(), "tscad-srv-"));
  beforeAll(async () => {
    writeFileSync(join(dir, "m.tsx"), `export default () => <part name="cube"><box size={10} /></part>\n`);
    dev = await startDev({ file: join(dir, "m.tsx"), port: 0, evaluate: "server" });
  }, 60_000);
  afterAll(async () => {
    await dev?.stop();
  });

  test("the page is told to evaluate remotely, and /__eval evaluates, picks and exports", async () => {
    expect(dev.evalMode).toBe("server");
    expect(await (await fetch(`http://localhost:${dev.port}/`)).text()).toContain('"remoteEval":"/__eval"');
    const ws = new WebSocket(`ws://localhost:${dev.port}/__eval`);
    ws.binaryType = "arraybuffer";
    const inbox: any[] = [];
    ws.onmessage = (e) => inbox.push(decode(e.data as ArrayBuffer));
    await new Promise((r) => (ws.onopen = r));
    const next = async (type: string) => {
      for (let i = 0; i < 600; i++) {
        const k = inbox.findIndex((m) => m.type === type);
        if (k >= 0) return inbox.splice(k, 1)[0];
        await Bun.sleep(50);
      }
      throw new Error(`no ${type}: ${JSON.stringify(inbox.map((m) => m.type))}`);
    };
    ws.send(encode({ type: "init", wasmUrl: "", glueUrl: "" }) as Uint8Array<ArrayBuffer>);
    await next("ready");
    ws.send(encode({ type: "load", url: "/__user/bundle.js?v=1" }) as Uint8Array<ArrayBuffer>);
    const res = await next("result");
    const part = res.data.parts[0];
    expect(part.name).toBe("cube");
    expect(part.volume).toBeCloseTo(1000, 3);
    expect(part.mesh.positions).toBeInstanceOf(Float32Array);
    ws.send(encode({ type: "pick", id: 1, kind: "face", part: "cube", index: part.mesh.faceIds[0] }) as Uint8Array<ArrayBuffer>);
    expect((await next("pick")).info.kind).toBe("plane");
    ws.send(encode({ type: "export", id: 2, format: "stl", parts: [{ name: "cube" }] }) as Uint8Array<ArrayBuffer>);
    expect((await next("export")).data.byteLength).toBe(84 + 50 * 12);
    ws.close();
  }, 60_000);
});
