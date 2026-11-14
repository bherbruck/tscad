import { beforeAll, describe, expect, test } from "bun:test";
import { compile, getDefaultFont, layoutText, type Children, type Node } from "tscad";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";
import { regions } from "../src/core/sketch/place";
import { polyline, signedArea, type Loop2 } from "../src/core/sketch/seg";
import type { TextLayout } from "../src/core/text/font";

const ir = (el: Children): Node => compile(el).document.parts![0]!.node;
const L: TextLayout = { size: 10, align: "left", valign: "baseline", spacing: 1, lineHeight: 1.2, kerning: true, ligatures: true };

/** Area enclosed by text loops (even-odd), from sampled outlines. */
function area(loops: Loop2[]): number {
  return regions(loops, (l) => l).reduce((a, r) => a + Math.abs(signedArea(polyline(r.outer))) - r.holes.reduce((h, x) => h + Math.abs(signedArea(polyline(x))), 0), 0);
}

describe("<text> IR", () => {
  test("'o' is an outline with a hole; curves are quadratic NURBS", () => {
    const n = ir(<extrude height={1}><text>o</text></extrude>) as any;
    expect(n.type).toBe("difference");
    expect(n.children.length).toBe(2);
    const kinds = new Set(n.children[0].profile.map((c: any) => c.type));
    expect(kinds.has("nurbs")).toBe(true);
    expect(n.children[0].profile.find((c: any) => c.type === "nurbs").degree).toBe(2);
  });
  test("'i' is two disjoint outlines (unioned); 'A' has a counter", () => {
    expect((ir(<extrude height={1}><text>i</text></extrude>) as any).type).toBe("union");
    expect((ir(<extrude height={1}><text>A</text></extrude>) as any).type).toBe("difference");
  });
  test("children: strings and numbers join; elements are rejected", () => {
    const a = compile(<extrude height={1}><text>v{2}</text></extrude>).document;
    const b = compile(<extrude height={1}><text>{"v2"}</text></extrude>).document;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // @ts-expect-error elements aren't text
    expect(() => compile(<extrude height={1}><text><box size={1} /></text></extrude>)).toThrow(/only strings and numbers/);
  });
  test("missing glyphs warn; empty text warns", () => {
    const r = compile(<extrude height={1}><text>a漢</text></extrude>);
    expect(r.warnings.some((w) => w.includes("no glyph for \"漢\""))).toBe(true);
    const empty = compile(<union><box size={1} /><extrude height={1}><text>{" "}</text></extrude></union>);
    expect(empty.warnings.some((w) => w.includes("draw nothing"))).toBe(true);
    expect(empty.document.parts![0]!.node).toMatchObject({ type: "transform" }); // just the box
  });
  test("bad props", () => {
    // @ts-expect-error not an alignment
    expect(() => compile(<extrude height={1}><text align="middle">a</text></extrude>)).toThrow(/align must be/);
    expect(() => compile(<extrude height={1}><text font={new Uint8Array([1, 2, 3])}>a</text></extrude>)).toThrow(/can't read the font/);
  });
});

describe("layout", () => {
  const font = getDefaultFont();
  const bounds = (s: string, o: Partial<typeof L> = {}) => layoutText(s, font, { ...L, ...o }).bounds;
  test("align", () => {
    const [x0, , x1] = bounds("Hello", { align: "center" });
    expect(x0).toBeCloseTo(-x1, 9);
    expect(bounds("Hello", { align: "right" })[2]).toBeCloseTo(0, 9);
    expect(bounds("Hello")[0]).toBe(0);
  });
  test("valign", () => {
    const top = layoutText("H", font, { ...L, valign: "top" });
    expect(top.bounds[3]).toBeCloseTo(0, 9);
    const mid = layoutText("H", font, { ...L, valign: "middle" });
    const ys = mid.loops.flatMap((l) => polyline(l).map((p) => p[1]));
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0, 6); // H spans baseline..cap height
  });
  test("lines and spacing", () => {
    const one = layoutText("H", font, L), two = layoutText("H\nH", font, L);
    const ys = (r: typeof one) => r.loops.flatMap((l) => polyline(l).map((p) => p[1]));
    expect(Math.min(...ys(two))).toBeCloseTo(Math.min(...ys(one)) - 12, 6);
    expect(bounds("HH", { spacing: 1.5 })[2]).toBeCloseTo(bounds("HH")[2] * 1.5, 6);
  });
  test("kerning tightens AV", () => {
    expect(bounds("AV")[2]).toBeLessThan(bounds("AV", { kerning: false })[2]);
  });
  test("size scales outlines", () => {
    const a = area(layoutText("e", font, L).loops), b = area(layoutText("e", font, { ...L, size: 20 }).loops);
    expect(b / a).toBeCloseTo(4, 6);
  });
  test("a user font (Uint8Array) works", async () => {
    const bytes = new Uint8Array(await Bun.file(new URL("../assets/fonts/DejaVuSans-subset.ttf", import.meta.url)).arrayBuffer());
    const n = ir(<extrude height={1}><text font={bytes}>o</text></extrude>);
    expect(JSON.stringify(n)).toBe(JSON.stringify(ir(<extrude height={1}><text>o</text></extrude>)));
  });
});

describe("<text> in the kernel", () => {
  let k: KernelHost;
  beforeAll(async () => {
    k = await loadKernel();
  }, 30_000);
  test("embossed and engraved text volumes", async () => {
    const font = getDefaultFont();
    const label = layoutText("tscad", font, { ...L, size: 8, align: "center", valign: "middle" });
    const textArea = area(label.loops);
    const { document } = compile(
      <assembly>
        <part name="emboss">
          <extrude height={1}><text size={8} align="center" valign="middle">tscad</text></extrude>
        </part>
        <part name="engrave">
          <difference>
            <box size={[50, 20, 3]} />
            <extrude height={1} offset={2.5}><text size={8} align="center" valign="middle">tscad</text></extrude>
          </difference>
        </part>
      </assembly>,
    );
    const r = await k.evaluate(document, { noMesh: true });
    expect(r.ok).toBe(true);
    const [emboss, engrave] = r.parts;
    expect(emboss!.volume!).toBeCloseTo(textArea, 1);
    expect(engrave!.volume!).toBeCloseTo(3000 - emboss!.volume! * 0.5, 3);
  }, 60_000);
});
