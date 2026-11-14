import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpHandler, runMcpServer } from "../src/mcp";

const PLATE = `
import { defineParams, type ParamValues } from "tscad"
export const params = defineParams({ w: { type: "number", default: 40, min: 10, max: 100 } })
export default function Plate(p: ParamValues<typeof params>) {
  return (
    <part name="plate" material="pla">
      <extrude height={5}>
        <rect w={p.w} h={30} />
        <circle r={5} />
      </extrude>
    </part>
  )
}
`;
const BAD = `export default function Bad() {
  return (
    <part name="bad">
      <cylinder r={-2} h={5} />
    </part>
  )
}
`;

/** Run the server over in-memory streams with these messages; responses by id. */
async function session(messages: unknown[]): Promise<Map<unknown, any>> {
  const lines: string[] = [];
  async function* stdin() {
    for (const m of messages) yield new TextEncoder().encode(`${JSON.stringify(m)}\n`);
  }
  await runMcpServer({ stdin: stdin(), stdout: { write: (s: string) => lines.push(s) }, log: () => {} });
  const out = new Map<unknown, any>();
  for (const chunk of lines) for (const l of chunk.split("\n").filter(Boolean)) {
    const r = JSON.parse(l);
    out.set(r.id, r);
  }
  return out;
}

const call = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("mcp server", () => {
  test("initialize, tools/list, evaluate, export STEP, errors, docs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tscad-mcp-test-"));
    try {
      const r = await session([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        call(3, "tscad_evaluate", { source: PLATE }),
        call(4, "tscad_export", { source: PLATE, params: { w: 50 }, format: "step", path: join(dir, "plate.step") }),
        call(5, "tscad_evaluate", { source: BAD }),
        call(6, "tscad_docs", { element: ["extrude", "CounterboreHole"] }),
        call(7, "tscad_list_examples", {}),
        { jsonrpc: "2.0", id: 8, method: "nope" },
        call(9, "tscad_evaluate", {}),
        { jsonrpc: "2.0", id: 10, method: "ping" },
      ]);
      // initialize
      expect(r.get(1).result.protocolVersion).toBe("2025-06-18");
      expect(r.get(1).result.capabilities.tools).toBeDefined();
      expect(r.get(1).result.serverInfo.name).toBe("tscad");
      // tools/list
      const names = r.get(2).result.tools.map((t: any) => t.name);
      expect(names).toEqual(expect.arrayContaining(["tscad_evaluate", "tscad_render", "tscad_export", "tscad_pick_selectors", "tscad_list_examples", "tscad_read_example", "tscad_docs", "tscad_check", "tscad_plate"]));
      for (const t of r.get(2).result.tools) expect(t.inputSchema.type).toBe("object");
      // evaluate
      const ev = r.get(3).result;
      expect(ev.isError).toBe(false);
      const part = ev.structuredContent.parts[0];
      expect(part.name).toBe("plate");
      expect(part.volume_mm3).toBeCloseTo(40 * 30 * 5 - Math.PI * 25 * 5, 1);
      expect(part.mass_g).toBeCloseTo((part.volume_mm3 / 1000) * 1.24, 2);
      expect(part.size).toEqual([40, 30, 5]);
      expect(ev.content[0].text).toContain("OK: 1 part(s)");
      expect(ev.structuredContent.params.w.value).toBe(40);
      // export
      const ex = r.get(4).result;
      expect(ex.isError).toBeFalsy();
      expect(ex.structuredContent.path).toBe(join(dir, "plate.step"));
      const step = readFileSync(join(dir, "plate.step"), "utf8");
      expect(step.startsWith("ISO-10303-21;")).toBe(true);
      expect(ex.structuredContent.bytes).toBe(Buffer.byteLength(step));
      // a modelling error points at the TSX line with a code frame
      const bad = r.get(5).result;
      expect(bad.isError).toBe(true);
      expect(bad.content[0].text).toContain("model.tsx:4:");
      expect(bad.content[0].text).toContain("r must be greater than 0");
      expect(bad.content[0].text).toContain("<cylinder r={-2} h={5} />");
      // docs
      const docs = r.get(6).result.content[0].text;
      expect(docs).toContain("### <extrude>");
      expect(docs).toContain("### <CounterboreHole>");
      expect(docs).toContain("`height?: number`");
      // examples
      expect(r.get(7).result.structuredContent.examples.map((e: any) => e.name)).toContain("bracket");
      // protocol errors vs tool errors
      expect(r.get(8).error.code).toBe(-32601);
      expect(r.get(9).result.isError).toBe(true);
      expect(r.get(9).result.content[0].text).toMatch(/source.*file/);
      expect(r.get(10).result).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("pick selectors from a point; render; read an example; dxf from a drawing", async () => {
    const h = createMcpHandler();
    const box = `export default () => <part name="b"><box size={[20, 20, 10]} /></part>`;
    const pick = (await h(call(1, "tscad_pick_selectors", { source: box, point: [10, 0, 10] }))) as any;
    expect(pick.result.isError).toBeFalsy();
    const s = pick.result.structuredContent;
    expect(s.geometry).toBe("line");
    expect(s.distance).toBeLessThan(1e-6);
    expect(s.suggestions.length).toBeGreaterThan(0);
    // the most specific suggestion picks exactly this edge
    expect(s.suggestions[0].count).toBe(1);
    expect(s.suggestions.some((x: any) => x.string && x.string.includes(">Z"))).toBe(true);
    const face = (await h(call(2, "tscad_pick_selectors", { source: box, point: [0, 0, 10.5], kind: "face" }))) as any;
    expect(face.result.structuredContent.suggestions.some((x: any) => x.string === ">Z" && x.count === 1)).toBe(true);

    const img = (await h(call(3, "tscad_render", { source: box, width: 128, height: 96 }))) as any;
    const pngPart = img.result.content.find((c: any) => c.type === "image");
    expect(pngPart?.mimeType).toBe("image/png");
    expect(Buffer.from(pngPart.data, "base64").subarray(1, 4).toString()).toBe("PNG");

    const chk = (await h(call(7, "tscad_check", {
      source: `export default () => (<assembly>
        <part name="t"><union><box size={[6, 6, 20]} /><box size={[30, 6, 4]} z={20} /></union></part>
        <part name="clash" x={2}><box size={4} z={2} /></part>
      </assembly>)`,
      bed: [200, 200, 200],
    }))) as any;
    const cs = chk.result.structuredContent;
    expect(cs.ok).toBe(false);
    const t = cs.parts.find((p: any) => p.name === "t");
    expect(t.overhang.area).toBeCloseTo(144, 3);
    expect(t.overhang.faces.length).toBe(2);
    expect(t.overhang.faces[0].bbox[0][2]).toBeCloseTo(20);
    expect(t.thickness.min).toBeCloseTo(4, 3);
    expect(t.watertight).toBe(true);
    expect(cs.interference.pairs[0]).toMatchObject({ a: "t", b: "clash" });
    expect(cs.interference.pairs[0].volume).toBeCloseTo(48, 3);
    expect(chk.result.content[0].text).toContain("overhangs > 45°: 2 face(s), 144 mm²");

    const ex = (await h(call(4, "tscad_read_example", { name: "bracket" }))) as any;
    expect(ex.result.content[0].text).toContain("export default");

    const dir = mkdtempSync(join(tmpdir(), "tscad-mcp-test-"));
    try {
      const dxf = (await h(call(5, "tscad_export", { source: `export default () => <drawing name="g"><rect w={10} h={10} /><circle r={2} /></drawing>`, path: join(dir, "g.dxf") }))) as any;
      expect(dxf.result.structuredContent.format).toBe("dxf");
      const text = readFileSync(join(dir, "g.dxf"), "utf8");
      expect(text).toContain("CIRCLE");
      const svg = (await h(call(6, "tscad_export", { source: box, format: "svg", path: join(dir, "b.svg") }))) as any;
      expect(svg.result.content[0].text).toContain("section of b at z = 5");
      expect(existsSync(join(dir, "b.svg"))).toBe(true);
      // a tall thin box is laid on its side; two copies of the 200 mm plank need two 150 mm beds
      const parts = `export default () => <><part name="post"><box size={[10, 10, 60]} /></part><part name="plank"><box size={[200, 30, 5]} /></part></>`;
      const pl = (await h(call(7, "tscad_plate", { source: parts, bed: [220, 150], copies: { plank: 2 }, path: join(dir, "p.3mf") }))) as any;
      const sc = pl.result.structuredContent;
      expect(sc.items.map((i: any) => i.part).sort()).toEqual(["plank", "plank", "post"]);
      expect(sc.items.find((i: any) => i.part === "post").height).toBeCloseTo(10, 3);
      expect(sc.files.length).toBe(sc.plates);
      expect(pl.result.content[0].text).toContain("| post |");
      for (const f of sc.files) expect(readFileSync(f).subarray(0, 2).toString()).toBe("PK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
