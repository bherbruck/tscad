/** The VS Code extension's parts that don't need VS Code (editors/vscode/src/{model,server}.ts). */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultExportLine, groupDiagnostics, importsTscad, isModel, revealSpan, squiggleSpan } from "../editors/vscode/src/model";
import { discoveryPath, resolveCommand, ServerManager, type RunningServer } from "../editors/vscode/src/server";
import { previewHtml } from "../editors/vscode/src/extension-html";

const ROOT = join(import.meta.dir, "..");
const MODEL = `import { defineParams, edges } from "tscad"

export const params = defineParams({ size: { type: "number", default: 20, min: 5, max: 60 } })

export default function Cube(p: { size: number }) {
  return (
    <part name="cube">
      <fillet radius={p.size} edges={edges.top()}>
        <box size={p.size} />
      </fillet>
    </part>
  )
}
`;

describe("model helpers", () => {
  test("which files are models, and where the CodeLens goes", () => {
    expect(importsTscad(MODEL)).toBe(true);
    expect(isModel(MODEL)).toBe(true);
    expect(defaultExportLine(MODEL)).toBe(4);
    expect(isModel(`import React from "react"\nexport default function A() { return <div/> }`)).toBe(false);
    expect(isModel(`import { edges } from "tscad"\nexport const Lib = () => <box size={1} />`)).toBe(false);
    expect(importsTscad(`import { Hole } from "tscad/parts"`)).toBe(true);
  });

  test("squiggles cover the element's tag; reveals select a prop or the whole tag", () => {
    // line 8, column 7 is `<fillet`
    expect(squiggleSpan(MODEL, 8, 7)).toEqual({ startLine: 7, startCol: 6, endLine: 7, endCol: 13 });
    const s = revealSpan(MODEL, 8, 7, ["radius", "r"]);
    expect(MODEL.split("\n")[7]!.slice(s.startCol, s.endCol)).toBe("radius={p.size}");
    const whole = revealSpan(MODEL, 8, 7);
    expect(MODEL.split("\n")[7]!.slice(whole.startCol, whole.endCol)).toBe("<fillet radius={p.size} edges={edges.top()}>");
  });

  test("diagnostics are grouped per file with spans, unreadable files skipped", () => {
    const g = groupDiagnostics(
      [
        { file: "/m.tsx", line: 8, column: 7, severity: "error", message: "fillet failed", source: "kernel" },
        { file: "/m.tsx", line: 1, column: 1, severity: "warning", message: "w", source: "warning" },
        { file: "/gone.tsx", line: 1, column: 1, severity: "error", message: "x", source: "render" },
      ],
      (f) => (f === "/m.tsx" ? MODEL : undefined),
    );
    expect([...g.keys()]).toEqual(["/m.tsx"]);
    expect(g.get("/m.tsx")![0]).toMatchObject({ startLine: 7, startCol: 6, endCol: 13, severity: "error" });
  });

  test("the webview frames the viewer and only relays its origin", () => {
    const html = previewHtml("http://localhost:4123");
    expect(html).toContain('src="http://localhost:4123/?embed=1"');
    expect(html).toContain("frame-src http://localhost:4123");
    expect(html).toContain('e.origin === "http://localhost:4123"');
  });

  test("the CLI command: setting, the tscad repo itself, else bunx", () => {
    expect(resolveCommand(ROOT, "")).toEqual(["bun", join(ROOT, "src/cli/index.ts")]);
    expect(resolveCommand(ROOT, "bunx tscad@1")).toEqual(["bunx", "tscad@1"]);
    expect(resolveCommand(mkdtempSync(join(tmpdir(), "tscad-x-")))).toEqual(["bunx", "tscad"]);
  });
});

describe("server manager (real tscad dev servers)", () => {
  const ws = mkdtempSync(join(tmpdir(), "tscad-ws-"));
  writeFileSync(join(ws, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "tscad" } }));
  writeFileSync(join(ws, "a.tsx"), MODEL);
  writeFileSync(join(ws, "b.tsx"), MODEL.replace("p.size} edges", "1} edges"));
  const mgr = new ServerManager({ command: () => ["bun", join(ROOT, "src/cli/index.ts")], timeout: 60_000 });
  let s: RunningServer;

  afterAll(async () => {
    await mgr.dispose();
  });

  test("starts one server per folder, reuses it, and follows the active file", async () => {
    s = await mgr.get(ws, join(ws, "a.tsx"));
    expect(s.owned).toBe(true);
    expect(s.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(existsSync(discoveryPath(ws))).toBe(true);
    expect(JSON.parse(readFileSync(discoveryPath(ws), "utf8")).pid).toBe(s.pid);
    const again = await mgr.get(ws, join(ws, "b.tsx"));
    expect(again).toBe(s);
    const st = (await (await fetch(`${s.url}/__status`)).json()) as { file: string; root: string };
    expect(st.file).toBe(join(ws, "b.tsx"));
    expect(st.root).toBe(ws);
  }, 90_000);

  test("diagnostics: a failing fillet is reported at its TSX line (long poll)", async () => {
    await mgr.setFile(s, join(ws, "a.tsx"));
    let body: { items: any[]; version: number } = { items: [], version: -1 };
    for (let i = 0; i < 6; i++) {
      body = (await (await fetch(`${s.url}/__diagnostics?since=${body.version}`)).json()) as typeof body;
      if (body.items.some((d) => d.source === "kernel" && d.file === join(ws, "a.tsx"))) break;
    }
    const d = body.items.find((x) => x.source === "kernel")!;
    expect(d.severity).toBe("error");
    expect(d.message).toContain("fillet");
    expect(d.line).toBe(8);
  }, 90_000);

  test("export through the server writes a file next to the model", async () => {
    await mgr.setFile(s, join(ws, "b.tsx"));
    const r = await fetch(`${s.url}/__export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "stl", file: join(ws, "b.tsx") }) });
    const body = (await r.json()) as { path: string; bytes: number };
    expect(r.status).toBe(200);
    expect(body.path).toBe(join(ws, "b.stl"));
    expect(body.bytes).toBeGreaterThan(84);
  }, 90_000);

  test("another manager adopts the running server instead of starting one; dispose kills only owned ones", async () => {
    const other = new ServerManager({ command: () => ["false"] });
    const found = await other.get(ws, join(ws, "a.tsx"));
    expect(found.owned).toBe(false);
    expect(found.pid).toBe(s.pid);
    await other.dispose();
    expect(() => process.kill(s.pid, 0)).not.toThrow();
    await mgr.dispose();
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(s.pid, 0);
        await Bun.sleep(100);
      } catch {
        break;
      }
    }
    expect(() => process.kill(s.pid, 0)).toThrow();
    expect(existsSync(discoveryPath(ws))).toBe(false);
  }, 30_000);
});
