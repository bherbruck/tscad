/** Sketch drag-to-edit through the viewer protocol and the dev server's /__edit. */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDev, type DevServer } from "../src/cli/dev";
import { decode, encode } from "../src/viewer/wire";

const RECT = `import "tscad"

export default function Rect() {
  return (
    <part name="p">
      <extrude height={5}>
        <sketch>
          <point id="o" x={0} y={0} fixed />
          <line from="o" to="a" horizontal length={40} />
          <line from="a" to="b" vertical length={20} />
          <line from="b" to="c" horizontal />
          <line from="c" to="o" vertical />
        </sketch>
      </extrude>
    </part>
  )
}
`;

let dev: DevServer;
afterAll(async () => {
  await dev?.stop();
});

describe("sketch drag → source edit", () => {
  test("a blocked drag says why; with changeDimensions the new length is written to the file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tscad-drag-"));
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "tscad" } }));
    const file = join(dir, "rect.tsx");
    writeFileSync(file, RECT);
    dev = await startDev({ file, port: 0, evaluate: "server" });
    const ws = new WebSocket(`ws://localhost:${dev.port}/__eval`);
    ws.binaryType = "arraybuffer";
    const inbox: any[] = [];
    ws.onmessage = (e) => inbox.push(decode(e.data as ArrayBuffer));
    await new Promise((r) => (ws.onopen = r));
    const next = async (type: string) => {
      for (let i = 0; i < 600; i++) {
        const k = inbox.findIndex((m) => m.type === type);
        if (k >= 0) return inbox.splice(k, 1)[0];
        await Bun.sleep(25);
      }
      throw new Error(`no ${type}`);
    };
    const send = (m: unknown) => ws.send(encode(m) as Uint8Array<ArrayBuffer>);
    send({ type: "init", wasmUrl: "", glueUrl: "" });
    await next("ready");
    send({ type: "load", url: "/__user/bundle.js?v=1" });
    const res = await next("result");
    expect(res.data.sketches[0].points.map((p: any) => p.id)).toContain("b");

    send({ type: "sketch-drag", id: 1, sketch: 0, point: "b", target: [40, 30], changeDimensions: false });
    const blocked = (await next("sketch-drag")).result;
    expect(blocked.reached).toBe(false);
    expect(blocked.blockedBy.length).toBeGreaterThan(0);
    expect(blocked.blockedBy[0].loc.file).toBe("rect.tsx");

    send({ type: "sketch-drag", id: 2, sketch: 0, point: "b", target: [40, 30], changeDimensions: true });
    const d = (await next("sketch-drag")).result;
    expect(d.reached).toBe(true);
    const change = d.changes.find((c: any) => c.kind === "prop" && c.prop === "length");
    expect(change).toMatchObject({ tag: "line", value: 30, loc: { file: "rect.tsx", line: 10 } });

    const r = (await (await fetch(`http://localhost:${dev.port}/__edit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes: d.changes }) })).json()) as { applied: number };
    expect(r.applied).toBeGreaterThan(0);
    expect(readFileSync(file, "utf8")).toContain(`<line from="a" to="b" vertical length={30} />`);
    ws.close();
  }, 60_000);
});
