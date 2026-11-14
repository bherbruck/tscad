/**
 * SVG → closed 2D loops (mm, y up). `<path>` (every command; circular arcs stay exact arcs),
 * `<rect>` (rounded with rx/ry), `<circle>`, `<ellipse>`, `<polygon>`, closed `<polyline>`,
 * groups with `transform`s, `viewBox` → mm. Each element's `fill-rule` decides which of its
 * nested loops are holes; separate elements that overlap are unioned (as SVG paints them).
 * Fill and stroke colours are ignored: every closed shape counts (laser files are often
 * stroke-only).
 */
import type { Vec2 } from "../../math";
import { booleanLoops } from "../boolean";
import { parsePath, PathSyntaxError } from "../path";
import { inside, line, polyline, reverseLoop, signedArea, type Affine2, type Loop2, type Seg2 } from "../seg";
import { circleLoop, ellipseLoop, polygonLoop, roundedRectLoop } from "../shapes";
import { bbox, cleanTiny, ImportError, mulAffine, transformSegAffine, weld, type ImportResult } from "./common";

export interface SvgOptions {
  /** Only elements with this id (`"logo"` or `"#logo"`) or class (`".cut"`), and their children. */
  select?: string;
  /** Extra scale factor. */
  scale?: number;
  /** Flip y (SVG's y points down). Default true, so the drawing reads the right way up. */
  flipY?: boolean;
}

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

/** A small, forgiving XML parser (enough for SVG). */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\?[\s\S]*?\?>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) {
      // closing tag: pop to the matching element
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === m[1]) {
          stack.length = i;
          break;
        }
      }
    } else if (m[2]) {
      const attrs: Record<string, string> = {};
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[3] ?? ""))) attrs[a[1]!] = decode(a[2] ?? a[3] ?? "");
      const node: XmlNode = { tag: m[2].replace(/^svg:/, ""), attrs, children: [] };
      stack[stack.length - 1]!.children.push(node);
      if (!m[4]) stack.push(node);
    }
  }
  return root;
}
function decode(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
}

const MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, "": 25.4 / 96 };

/** A length attribute in mm (`"40mm"`, `"2in"`, `"300"` px). */
function lengthMM(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(v);
  if (!m) return undefined;
  return Number(m[1]) * MM[(m[2] ?? "").toLowerCase()]!;
}

const nums = (s: string | undefined) => (s ?? "").split(/[\s,]+|(?=-)(?<![eE])/).filter(Boolean).map(Number);

/** SVG transform list → affine in our [a, b, c, d, e, f] (x' = a x + b y + e). */
function parseTransform(t: string | undefined): Affine2 {
  let m: Affine2 = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(t))) {
    const v = nums(x[2]);
    let n: Affine2;
    switch (x[1]) {
      case "matrix": // SVG: a b c d e f with x' = a x + c y + e
        n = [v[0] ?? 1, v[2] ?? 0, v[1] ?? 0, v[3] ?? 1, v[4] ?? 0, v[5] ?? 0];
        break;
      case "translate":
        n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case "scale":
        n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const a = ((v[0] ?? 0) * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
        const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
        n = [cs, -sn, sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy];
        break;
      }
      case "skewX":
        n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    }
    m = mulAffine(m, n);
  }
  return m;
}

/** A presentation attribute, from `style` or the attribute itself. */
function prop(n: XmlNode, name: string): string | undefined {
  const st = n.attrs.style;
  if (st) {
    const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(st);
    if (m) return m[1]!.trim();
  }
  return n.attrs[name];
}

/** Keep the loops that bound the filled region under the nonzero rule. */
function nonzeroBoundaries(loops: Loop2[]): Loop2[] {
  if (loops.length < 2) return loops;
  const polys = loops.map((l) => polyline(l));
  const sign = polys.map((p) => Math.sign(signedArea(p)));
  const probe = polys.map((p) => interior(p));
  return loops.filter((_, i) => {
    // winding just inside loop i (its own contribution included) and just outside it
    let w = 0;
    polys.forEach((q, j) => {
      if (j === i || inside(probe[i]!, q)) w += sign[j]!;
    });
    return (w !== 0) !== (w - sign[i]! !== 0);
  });
}
function interior(poly: Vec2[]): Vec2 {
  // a point just inside the first edge, on its left for CCW (flip for CW)
  const a = poly[0]!, b = poly[1] ?? a;
  const s = Math.sign(signedArea(poly)) || 1;
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]) || 1;
  const eps = 1e-6 * Math.max(1, L);
  return [(a[0] + b[0]) / 2 - (s * d[1] * eps) / L, (a[1] + b[1]) / 2 + (s * d[0] * eps) / L];
}

export function importSvg(text: string, o: SvgOptions = {}): ImportResult {
  if (typeof text !== "string" || !/<svg[\s>]/i.test(text)) throw new ImportError("data doesn't look like an SVG file (no <svg>)");
  const root = parseXml(text).children.find((c) => c.tag === "svg");
  if (!root) throw new ImportError("no <svg> element");
  const warnings: string[] = [];
  // viewBox → mm: the viewport size in mm over the viewBox size; without width/height, 1 user unit = 1 px
  const vb = nums(root.attrs.viewBox);
  const wmm = lengthMM(root.attrs.width), hmm = lengthMM(root.attrs.height);
  let unit = 25.4 / 96;
  if (vb.length === 4 && vb[2]! > 0) {
    if (wmm !== undefined) unit = wmm / vb[2]!;
    else if (hmm !== undefined && vb[3]! > 0) unit = hmm / vb[3]!;
  } else if (wmm !== undefined) unit = 25.4 / 96; // no viewBox: user units are px
  unit *= o.scale ?? 1;
  const flip = o.flipY !== false;
  const base: Affine2 = [unit, 0, 0, flip ? -unit : unit, 0, 0];

  const sel = o.select?.trim();
  const matches = (n: XmlNode) => {
    if (!sel) return true;
    if (sel.startsWith(".")) return (n.attrs.class ?? "").split(/\s+/).includes(sel.slice(1));
    return n.attrs.id === sel.replace(/^#/, "");
  };
  const regions: Loop2[][] = [];
  const skipped = new Map<string, number>();
  const walk = (n: XmlNode, m: Affine2, rule: string, selected: boolean) => {
    const mm = mulAffine(m, parseTransform(n.attrs.transform));
    const r = prop(n, "fill-rule") ?? rule;
    const on = selected || matches(n);
    if (["defs", "clipPath", "mask", "symbol", "marker", "pattern", "style", "title", "desc", "metadata", "text"].includes(n.tag)) {
      if (n.tag === "text" && on) skipped.set("text", (skipped.get("text") ?? 0) + 1);
      return;
    }
    if (n.tag === "g" || n.tag === "svg" || n.tag === "a") {
      for (const c of n.children) walk(c, mm, r, on);
      return;
    }
    if (!on) return;
    let loops: Loop2[] = [];
    const A = (k: string) => Number(n.attrs[k] ?? 0);
    switch (n.tag) {
      case "path": {
        let subs;
        try {
          subs = parsePath(n.attrs.d ?? "");
        } catch (e) {
          if (e instanceof PathSyntaxError) {
            warnings.push(`<path${n.attrs.id ? ` id="${n.attrs.id}"` : ""}>: ${e.message}; left out`);
            return;
          }
          throw e;
        }
        // y-down SVG data: parse as given, flip with the transform
        loops = subs.filter((s) => s.segs.length).map((s) => {
          const l = weld(s.segs);
          const [x0, y0, x1, y1] = bbox([l]);
          return cleanTiny(l, 1e-4 * Math.max(1e-9, Math.hypot(x1 - x0, y1 - y0)));
        });
        break;
      }
      case "rect": {
        const w = A("width"), h = A("height");
        if (!(w > 0 && h > 0)) return;
        let rx = n.attrs.rx !== undefined ? A("rx") : A("ry"), ry = n.attrs.ry !== undefined ? A("ry") : rx;
        rx = Math.min(rx, w / 2);
        ry = Math.min(ry, h / 2);
        const off: Affine2 = [1, 0, 0, 1, A("x") + w / 2, A("y") + h / 2];
        let l: Loop2;
        if (rx > 0 && Math.abs(rx - ry) < 1e-12) l = roundedRectLoop(w, h, rx);
        else if (rx > 0) {
          // elliptical corners: a rounded square scaled
          l = roundedRectLoop(w, h * (rx / ry), rx).map((s) => transformSegAffine(s, [1, 0, 0, ry / rx, 0, 0]));
        } else l = polygonLoop([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]);
        loops = [l.map((s) => transformSegAffine(s, off))];
        break;
      }
      case "circle":
        if (!(A("r") > 0)) return;
        loops = [circleLoop(A("r"), [A("cx"), A("cy")])];
        break;
      case "ellipse": {
        const rx = A("rx"), ry = A("ry");
        if (!(rx > 0 && ry > 0)) return;
        loops = [(rx === ry ? circleLoop(rx) : ellipseLoop(rx, ry)).map((s) => transformSegAffine(s, [1, 0, 0, 1, A("cx"), A("cy")]))];
        break;
      }
      case "polygon":
      case "polyline": {
        const v = nums(n.attrs.points);
        const pts: Vec2[] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i]!, v[i + 1]!]);
        if (pts.length < 3) return;
        if (n.tag === "polyline") {
          const f = pts[0]!, l = pts[pts.length - 1]!;
          if (Math.hypot(f[0] - l[0], f[1] - l[1]) > 1e-9) warnings.push(`<polyline${n.attrs.id ? ` id="${n.attrs.id}"` : ""}> isn't closed: closed with a straight line`);
        }
        loops = [polygonLoop(pts)];
        break;
      }
      case "line":
        skipped.set("line", (skipped.get("line") ?? 0) + 1);
        return;
      case "use":
      case "image":
        skipped.set(n.tag, (skipped.get(n.tag) ?? 0) + 1);
        return;
      default:
        return;
    }
    const placed = loops.map((l) => l.map((s: Seg2) => transformSegAffine(s, mulAffine(base, mm))));
    // the element's own fill rule decides its holes
    const region = r === "evenodd" ? placed : nonzeroBoundaries(placed);
    if (region.length) regions.push(region);
  };
  walk(root, [1, 0, 0, 1, 0, 0], "nonzero", false);
  for (const [t, k] of skipped) warnings.push(`${k} <${t}> element${k === 1 ? "" : "s"} ignored (${t === "line" ? "an open line encloses nothing" : t === "text" ? "convert text to paths" : "not supported"})`);
  if (sel && !regions.length) warnings.push(`select="${sel}" matched no shapes`);
  if (!regions.length) return { loops: [], warnings };

  // separate elements overlap → their union (as painted); disjoint ones are kept as they are
  const boxes = regions.map((rg) => bbox(rg));
  const overlap = boxes.some((a, i) => boxes.some((b, j) => j > i && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]));
  if (!overlap || regions.length === 1) return { loops: regions.flat(), warnings };
  try {
    return { loops: booleanLoops("union", regions.map((rg) => orientEvenOdd(rg))), warnings };
  } catch (e) {
    warnings.push(`couldn't union the overlapping shapes (${(e as Error).message}); nested shapes may read as holes`);
    return { loops: regions.flat(), warnings };
  }
}

/** Loops as an operand: kept as is (the boolean reads nesting as holes). */
function orientEvenOdd(loops: Loop2[]): Loop2[] {
  return loops.map((l) => (signedArea(polyline(l)) < 0 ? reverseLoop(l) : l));
}

export { line };
