/**
 * DXF → closed 2D loops (mm). LINE, ARC, CIRCLE, LWPOLYLINE / POLYLINE with bulges (exact arcs),
 * SPLINE (NURBS, rational included), ELLIPSE (exact rational NURBS), INSERT of BLOCKs (nested,
 * with base point, scale, rotation and arrays), $INSUNITS → mm. Loose entities are chained into
 * closed loops by their end points.
 */
import type { Vec2 } from "../../math";
import { arc, line, TAU, type Affine2, type Loop2, type Nurbs2, type Seg2 } from "../seg";
import { bbox, chainLoops, ImportError, mulAffine, transformSegAffine, weld, type ImportResult } from "./common";

export interface DxfOptions {
  /** Only entities on these layers (case-insensitive). */
  layer?: string | readonly string[];
  /** Override the file's units: "mm", "cm", "m", "in", "ft". */
  units?: "mm" | "cm" | "m" | "in" | "ft";
  /** Extra scale factor. */
  scale?: number;
  /** End-point snapping tolerance for chaining, mm. Default 1e-5 × the drawing size, at least 0.001 mm. */
  tolerance?: number;
}

const UNIT_MM: Record<number, number> = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };
const NAMED_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 } as const;

type Pair = [number, string];
interface Entity {
  type: string;
  codes: Pair[];
  /** POLYLINE vertices (each a VERTEX entity). */
  vertices?: Entity[];
}

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isFinite(code)) throw new ImportError(`DXF: bad group code ${JSON.stringify(lines[i])} at line ${i + 1}`);
    out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
}

const num = (e: Entity, code: number, dflt = 0): number => {
  const p = e.codes.find((c) => c[0] === code);
  return p ? Number(p[1]) : dflt;
};
const all = (e: Entity, code: number): number[] => e.codes.filter((c) => c[0] === code).map((c) => Number(c[1]));
const str = (e: Entity, code: number): string | undefined => e.codes.find((c) => c[0] === code)?.[1];

/** Split a section's pairs into entities (POLYLINE gathers its VERTEXes). */
function entities(ps: Pair[]): Entity[] {
  const out: Entity[] = [];
  let cur: Entity | undefined;
  let poly: Entity | undefined;
  for (const [code, v] of ps) {
    if (code === 0) {
      if (v === "VERTEX" && poly) {
        cur = { type: v, codes: [] };
        poly.vertices!.push(cur);
        continue;
      }
      if (v === "SEQEND" && poly) {
        poly = undefined;
        cur = undefined;
        continue;
      }
      cur = { type: v, codes: [] };
      if (v === "POLYLINE") {
        cur.vertices = [];
        poly = cur;
      }
      out.push(cur);
    } else cur?.codes.push([code, v]);
  }
  return out;
}

/** The arc from p to q with DXF bulge b (= tan(sweep / 4), positive = CCW). */
function bulgeSeg(p: Vec2, q: Vec2, b: number): Seg2 {
  if (Math.abs(b) < 1e-12) return line(p, q);
  const sweep = 4 * Math.atan(b);
  const cx = q[0] - p[0], cy = q[1] - p[1], c = Math.hypot(cx, cy);
  const r = c / (2 * Math.sin(Math.abs(sweep) / 2));
  const d = (c / 2) / Math.tan(sweep / 2); // signed distance from the chord midpoint to the centre (left +)
  const centre: Vec2 = [(p[0] + q[0]) / 2 - (cy / c) * d, (p[1] + q[1]) / 2 + (cx / c) * d];
  const a0 = Math.atan2(p[1] - centre[1], p[0] - centre[0]);
  return arc(centre, r, a0, a0 + sweep);
}

/** An ellipse (centre, major axis vector, ratio, parameter range) as exact rational quadratic NURBS. */
function ellipseNurbs(c: Vec2, major: Vec2, ratio: number, t0: number, t1: number): Nurbs2 {
  if (t1 <= t0) t1 += TAU;
  const minor: Vec2 = [-major[1] * ratio, major[0] * ratio];
  const n = Math.max(1, Math.ceil((t1 - t0) / (Math.PI / 2) - 1e-9));
  const step = (t1 - t0) / n, w = Math.cos(step / 2);
  const P = (t: number, k = 1): Vec2 => [c[0] + (major[0] * Math.cos(t) + minor[0] * Math.sin(t)) * k, c[1] + (major[1] * Math.cos(t) + minor[1] * Math.sin(t)) * k];
  const pts: [number, number, number][] = [];
  const knots = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = t0 + step * i, b = a + step, m = (a + b) / 2;
    if (i === 0) pts.push([...P(a), 1]);
    // the middle control point: the ellipse point at m pushed out by 1 / w
    pts.push([...P(m, 1 / w), w]);
    pts.push([...P(b), 1]);
    if (i < n - 1) knots.push((i + 1) / n, (i + 1) / n);
  }
  knots.push(1, 1, 1);
  return { kind: "nurbs", degree: 2, pts, knots };
}

export function importDxf(text: string, o: DxfOptions = {}): ImportResult {
  if (typeof text !== "string" || !/\bSECTION\b/.test(text)) throw new ImportError("data doesn't look like a DXF file (no SECTION)");
  const ps = pairs(text);
  const warnings: string[] = [];
  // sections
  const sections = new Map<string, Pair[]>();
  for (let i = 0; i < ps.length; i++) {
    if (ps[i]![0] === 0 && ps[i]![1] === "SECTION" && ps[i + 1]?.[0] === 2) {
      const name = ps[i + 1]![1];
      let j = i + 2;
      while (j < ps.length && !(ps[j]![0] === 0 && ps[j]![1] === "ENDSEC")) j++;
      sections.set(name, ps.slice(i + 2, j));
      i = j;
    }
  }
  // units
  let unit = 1;
  const header = sections.get("HEADER") ?? [];
  const ui = header.findIndex((p) => p[0] === 9 && p[1] === "$INSUNITS");
  if (ui >= 0) {
    const code = Number(header[ui + 1]?.[1]);
    if (UNIT_MM[code] === undefined) warnings.push(`$INSUNITS ${code} not recognised: taken as mm`);
    unit = UNIT_MM[code] ?? 1;
  }
  if (o.units) unit = NAMED_MM[o.units];
  const scale = unit * (o.scale ?? 1);

  // blocks
  const blocks = new Map<string, { base: Vec2; ents: Entity[] }>();
  {
    const bs = entities(sections.get("BLOCKS") ?? []);
    let cur: { name: string; base: Vec2; ents: Entity[] } | undefined;
    for (const e of bs) {
      if (e.type === "BLOCK") cur = { name: str(e, 2) ?? "", base: [num(e, 10), num(e, 20)], ents: [] };
      else if (e.type === "ENDBLK") {
        if (cur) blocks.set(cur.name, { base: cur.base, ents: cur.ents });
        cur = undefined;
      } else cur?.ents.push(e);
    }
  }
  const layers = o.layer === undefined ? undefined : new Set((typeof o.layer === "string" ? [o.layer] : o.layer).map((l) => l.toUpperCase()));

  const loose: { seg: Seg2; label: string }[] = [];
  const closed: Loop2[] = [];
  const skipped = new Map<string, number>();
  const label = (e: Entity) => `${e.type}${str(e, 5) ? ` #${str(e, 5)}` : ""}`;

  const emit = (e: Entity, m: Affine2, depth: number, inheritedLayer?: string) => {
    const lay = str(e, 8) ?? "0";
    const effLayer = lay === "0" && inheritedLayer ? inheritedLayer : lay;
    if (layers && e.type !== "INSERT" && !layers.has(effLayer.toUpperCase())) return;
    // OCS: an extrusion of (0, 0, −1) mirrors X (common for arcs drawn upside down)
    const flipped = num(e, 230, 1) < 0;
    const mm: Affine2 = flipped ? mulAffine(m, [-1, 0, 0, 1, 0, 0]) : m;
    const T = (s: Seg2) => transformSegAffine(s, mm);
    switch (e.type) {
      case "LINE": {
        const a: Vec2 = [num(e, 10), num(e, 20)], b: Vec2 = [num(e, 11), num(e, 21)];
        if (a[0] !== b[0] || a[1] !== b[1]) loose.push({ seg: T(line(a, b)), label: label(e) });
        return;
      }
      case "ARC": {
        const c: Vec2 = [num(e, 10), num(e, 20)], r = num(e, 40);
        let a0 = (num(e, 50) * Math.PI) / 180, a1 = (num(e, 51) * Math.PI) / 180;
        while (a1 <= a0) a1 += TAU;
        loose.push({ seg: T(arc(c, r, a0, a1)), label: label(e) });
        return;
      }
      case "CIRCLE":
        closed.push([T(arc([num(e, 10), num(e, 20)], num(e, 40), 0, TAU))]);
        return;
      case "LWPOLYLINE":
      case "POLYLINE": {
        let verts: { p: Vec2; b: number }[];
        if (e.type === "LWPOLYLINE") {
          // vertices: each 10/20 pair, an optional 42 bulge after it
          verts = [];
          for (const [code, v] of e.codes) {
            if (code === 10) verts.push({ p: [Number(v), 0], b: 0 });
            else if (code === 20 && verts.length) verts[verts.length - 1]!.p[1] = Number(v);
            else if (code === 42 && verts.length) verts[verts.length - 1]!.b = Number(v);
          }
        } else verts = (e.vertices ?? []).filter((v) => !(num(v, 70) & 16)).map((v) => ({ p: [num(v, 10), num(v, 20)] as Vec2, b: num(v, 42) }));
        const isClosed = (num(e, 70) & 1) === 1;
        const segs: Seg2[] = [];
        for (let i = 0; i < verts.length - (isClosed ? 0 : 1); i++) {
          const a = verts[i]!, b = verts[(i + 1) % verts.length]!;
          if (a.p[0] === b.p[0] && a.p[1] === b.p[1]) continue;
          segs.push(T(bulgeSeg(a.p, b.p, a.b)));
        }
        if (!segs.length) return;
        if (isClosed) closed.push(weld(segs));
        else segs.forEach((s) => loose.push({ seg: s, label: label(e) }));
        return;
      }
      case "SPLINE": {
        const degree = num(e, 71, 3);
        const knots = all(e, 40);
        const weights = all(e, 41);
        const xs = all(e, 10), ys = all(e, 20);
        if (!xs.length) {
          warnings.push(`${label(e)}: a fit-point spline (no control points) isn't supported; left out`);
          return;
        }
        const pts = xs.map((x, i) => [x, ys[i] ?? 0, weights[i] ?? 1] as [number, number, number]);
        if (knots.length !== pts.length + degree + 1) {
          warnings.push(`${label(e)}: knot count doesn't match (${knots.length} for ${pts.length} points of degree ${degree}); left out`);
          return;
        }
        const s = T({ kind: "nurbs", degree, pts, knots });
        const flags = num(e, 70);
        const p0 = pts[0]!, pn = pts[pts.length - 1]!;
        if (flags & 1 || (p0[0] === pn[0] && p0[1] === pn[1])) closed.push([s]);
        else loose.push({ seg: s, label: label(e) });
        return;
      }
      case "ELLIPSE": {
        const c: Vec2 = [num(e, 10), num(e, 20)], major: Vec2 = [num(e, 11), num(e, 21)];
        const t0 = num(e, 41, 0), t1 = num(e, 42, TAU);
        const full = Math.abs(t1 - t0 - TAU) < 1e-9 || Math.abs(t1 - t0) < 1e-12;
        const s = T(ellipseNurbs(c, major, num(e, 40, 1), t0, full ? t0 + TAU : t1));
        if (full) closed.push([s]);
        else loose.push({ seg: s, label: label(e) });
        return;
      }
      case "INSERT": {
        if (depth > 16) {
          warnings.push(`${label(e)}: blocks nested too deep; left out`);
          return;
        }
        const name = str(e, 2) ?? "";
        const b = blocks.get(name);
        if (!b) {
          warnings.push(`${label(e)}: no block "${name}"; left out`);
          return;
        }
        const ins: Vec2 = [num(e, 10), num(e, 20)];
        const sx = num(e, 41, 1), sy = num(e, 42, 1), rot = (num(e, 50) * Math.PI) / 180;
        const cols = Math.max(1, num(e, 70, 1)), rows = Math.max(1, num(e, 71, 1));
        const dc = num(e, 44), dr = num(e, 45);
        const cs = Math.cos(rot), sn = Math.sin(rot);
        for (let i = 0; i < cols; i++)
          for (let j = 0; j < rows; j++) {
            // insertion: (scale about the block base) → rotate → move to the insertion point (+ array offset, rotated)
            const off: Vec2 = [i * dc, j * dr];
            const t: Vec2 = [ins[0] + cs * off[0] - sn * off[1], ins[1] + sn * off[0] + cs * off[1]];
            const local: Affine2 = [cs * sx, -sn * sy, sn * sx, cs * sy, t[0] - (cs * sx * b.base[0] - sn * sy * b.base[1]), t[1] - (sn * sx * b.base[0] + cs * sy * b.base[1])];
            for (const be of b.ents) emit(be, mulAffine(m, local), depth + 1, effLayer);
          }
        return;
      }
      case "POINT":
      case "TEXT":
      case "MTEXT":
      case "DIMENSION":
      case "HATCH":
      case "SOLID":
      case "ATTDEF":
      case "ATTRIB":
      case "VIEWPORT":
        skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1);
        return;
      default:
        skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1);
    }
  };
  const S: Affine2 = [scale, 0, 0, scale, 0, 0];
  for (const e of entities(sections.get("ENTITIES") ?? [])) emit(e, S, 0);
  for (const [t, n] of skipped) warnings.push(`${n} ${t} entit${n === 1 ? "y" : "ies"} ignored (not geometry for a profile)`);

  const all0 = [...closed, ...loose.map((l) => [l.seg])];
  if (!all0.length) {
    warnings.push("the DXF has no usable geometry" + (layers ? ` on layer ${[...layers].join(", ")}` : ""));
    return { loops: [], warnings };
  }
  const [x0, y0, x1, y1] = bbox(all0);
  const tol = o.tolerance ?? Math.max(1e-3, 1e-5 * Math.hypot(x1 - x0, y1 - y0));
  const loops = [...closed, ...chainLoops(loose, tol, warnings)];
  return { loops, warnings };
}
