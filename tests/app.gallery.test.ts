import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeModel, discoverModels, isModelSource, renderAll, thumbnailKey, ThumbnailCache } from "../src/cli/gallery";
import { startDev, type DevServer } from "../src/cli/dev";

function project(): string {
  const d = mkdtempSync(join(tmpdir(), "tscad-gal-"));
  writeFileSync(join(d, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "tscad" } }));
  mkdirSync(join(d, "sub"));
  mkdirSync(join(d, "node_modules/x"), { recursive: true });
  mkdirSync(join(d, ".hidden"));
  writeFileSync(join(d, "size.ts"), `export const SIZE = 10\n`);
  writeFileSync(join(d, "cube.tsx"), `/** Tiny cube: the smallest model. */\nimport { defineParams } from "tscad"\nimport { SIZE } from "./size"\nexport default () => <part name="cube"><box size={SIZE} /></part>\n`);
  writeFileSync(join(d, "sub/ring.tsx"), `export default () => <part name="ring"><torus R={10} r={2} /></part>\n`);
  writeFileSync(join(d, "broken.tsx"), `import "tscad"\nexport default () => <part name="bad"><fillet radius={50}><box size={10} /></fillet></part>\n`);
  writeFileSync(join(d, "lib.tsx"), `import { edges } from "tscad"\nexport const Lib = () => <box size={1} />\n`);
  writeFileSync(join(d, "cube.test.tsx"), readFileSync(join(d, "cube.tsx")));
  writeFileSync(join(d, "cube.spec.tsx"), readFileSync(join(d, "cube.tsx")));
  writeFileSync(join(d, "node_modules/x/m.tsx"), readFileSync(join(d, "cube.tsx")));
  writeFileSync(join(d, ".hidden/m.tsx"), readFileSync(join(d, "cube.tsx")));
  writeFileSync(join(d, "react.tsx"), `import React from "react"\nexport default () => <div />\n`);
  return d;
}

describe("discovery", () => {
  test("models: default export + tscad (import or elements); not tests, specs, libraries, node_modules or dot dirs", () => {
    const d = project();
    expect(discoverModels(d).map((m) => m.rel)).toEqual(["broken.tsx", "cube.tsx", "sub/ring.tsx"]);
    expect(isModelSource("a.tsx", `export default () => <div/>`)).toBe(false);
    expect(isModelSource("a.ts", `import "tscad"\nexport default 1`)).toBe(false);
  });

  test("titles from the doc comment, else the file name", () => {
    expect(describeModel("cube", `/** Tiny cube: the smallest model. */`)).toEqual({ title: "Tiny cube", description: "the smallest model." });
    expect(describeModel("my-ring", `export default 1`).title).toBe("My ring");
  });
});

describe("thumbnail cache", () => {
  test("the key follows the model and what it imports, nothing else", async () => {
    const d = project();
    const f = join(d, "cube.tsx");
    const k1 = await thumbnailKey(f);
    expect(await thumbnailKey(f)).toBe(k1);
    writeFileSync(join(d, "sub/ring.tsx"), `export default () => <part name="ring"><torus R={12} r={2} /></part>\n`); // unrelated
    expect(await thumbnailKey(f)).toBe(k1);
    writeFileSync(join(d, "size.ts"), `export const SIZE = 12\n`); // imported
    expect(await thumbnailKey(f)).not.toBe(k1);
    expect(await thumbnailKey(f, { w: 1 })).not.toBe(await thumbnailKey(f, { w: 2 }));
  });

  test("text-imported assets (an SVG logo) are part of the key", async () => {
    const d = project();
    mkdirSync(join(d, "assets"));
    writeFileSync(join(d, "assets/logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>`);
    const f = join(d, "logo.tsx");
    writeFileSync(f, `import "tscad"\nimport logo from "./assets/logo.svg" with { type: "text" }\nexport default () => <part name="p"><box size={logo.length / 10} /></part>\n`);
    const k1 = await thumbnailKey(f);
    writeFileSync(join(d, "assets/logo.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>`);
    expect(await thumbnailKey(f)).not.toBe(k1);
  });

  test("renders once, then serves the cache until an import changes", async () => {
    const d = project();
    const cache = new ThumbnailCache(d, { width: 160, height: 120 });
    const f = join(d, "cube.tsx");
    expect((await cache.cached(f)).info).toBeUndefined();
    const info = await cache.get(f);
    expect(info.ok).toBe(true);
    expect(info.parts).toBe(1);
    expect(info.volume).toBeCloseTo(1000, 3);
    expect(readFileSync(join(cache.dir, info.png!)).subarray(1, 4).toString()).toBe("PNG");
    expect((await cache.cached(f)).info?.png).toBe(info.png);
    writeFileSync(join(d, "size.ts"), `export const SIZE = 11\n`);
    expect((await cache.cached(f)).info).toBeUndefined();
    const again = await cache.get(f);
    expect(again.volume).toBeCloseTo(1331, 3);
  }, 60_000);
});

describe("tscad render <dir>", () => {
  test("every model to <out>/<path>.png; failures reported, not fatal; reruns hit the cache", async () => {
    const d = project();
    const out = join(d, "shots");
    const r = await renderAll({ dir: d, out, width: 160, height: 120 });
    expect(r.map((x) => [x.file.slice(d.length + 1), x.info.ok])).toEqual([
      ["broken.tsx", false],
      ["cube.tsx", true],
      ["sub/ring.tsx", true],
    ]);
    expect(r[0]!.info.error).toContain("fillet");
    expect(existsSync(join(out, "cube.png"))).toBe(true);
    expect(existsSync(join(out, "sub/ring.png"))).toBe(true);
    const t = performance.now();
    await renderAll({ dir: d, out, width: 160, height: 120 });
    expect(performance.now() - t).toBeLessThan(2000);
  }, 90_000);
});

describe("tscad dev <dir>: gallery", () => {
  let dev: DevServer;
  afterAll(async () => {
    await dev?.stop();
  });

  test("lists the models, renders thumbnails in the background, opens one in the viewer", async () => {
    const d = project();
    dev = await startDev({ file: d, gallery: true, port: 0 });
    const base = `http://localhost:${dev.port}`;
    expect(await (await fetch(`${base}/`)).text()).toContain("viewer/gallery.js");
    let list = (await (await fetch(`${base}/__gallery`)).json()) as { items: { rel: string; title: string; thumb: any }[] };
    expect(list.items.map((i) => i.rel)).toEqual(["broken.tsx", "cube.tsx", "sub/ring.tsx"]);
    expect(list.items[1]!.title).toBe("Tiny cube");
    for (let i = 0; i < 100 && list.items.some((x) => !x.thumb); i++) {
      await Bun.sleep(200);
      list = (await (await fetch(`${base}/__gallery`)).json()) as typeof list;
    }
    const cube = list.items[1]!.thumb;
    expect(cube.ok).toBe(true);
    expect((await fetch(`${base}/__thumb/${cube.png}`)).headers.get("content-type")).toBe("image/png");
    expect(list.items[0]!.thumb.ok).toBe(false);
    const page = await (await fetch(`${base}/view/sub/ring.tsx`)).text();
    expect(page).toContain('"gallery":"/"');
    const st = (await (await fetch(`${base}/__status`)).json()) as { file: string };
    expect(st.file).toBe(join(d, "sub/ring.tsx"));
    expect((await fetch(`${base}/view/../outside.tsx`)).status).toBe(404);
  }, 90_000);
});
