/**
 * SVG path-data subset → loops: M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z, absolute and relative.
 * Cubic and quadratic Béziers become NURBS (weights 1); circular arcs become exact arcs and
 * elliptical arcs exact rational quadratic NURBS pieces. Coordinates are taken as given
 * (y up — tscad does not flip SVG's y-down convention).
 */
import type { Vec2 } from "../math";
import { arc, end, line, start, type Loop2, type Nurbs2, type Seg2 } from "./seg";

export class PathSyntaxError extends Error {}

/** One parsed subpath: its segments and whether it was closed with Z (or ends at its start). */
export interface SubPath {
  segs: Seg2[];
  closed: boolean;
}

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

export function parsePath(d: string): SubPath[] {
  const tokens: (string | number)[] = [];
  const stripped = d.replace(/,/g, " ");
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(stripped))) {
    const gap = stripped.slice(lastIndex, m.index);
    if (gap.trim() !== "") throw new PathSyntaxError(`unexpected ${JSON.stringify(gap.trim())} in path data`);
    lastIndex = TOKEN.lastIndex;
    tokens.push(m[1] ?? Number(m[2]));
  }
  if (stripped.slice(lastIndex).trim() !== "") throw new PathSyntaxError(`unexpected ${JSON.stringify(stripped.slice(lastIndex).trim())} in path data`);

  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let p: Vec2 = [0, 0];
  let startPt: Vec2 = [0, 0];
  let lastCtrl: Vec2 | null = null;
  let lastCmd = "";
  let i = 0;
  let cmd = "";
  const num = (): number => {
    const t = tokens[i++];
    if (typeof t !== "number") throw new PathSyntaxError(`path command ${cmd} expects a number${t === undefined ? "" : `, got ${t}`}`);
    return t;
  };
  const push = (s: Seg2) => {
    if (!cur) {
      cur = { segs: [], closed: false };
      subs.push(cur);
      startPt = p;
    }
    cur.segs.push(s);
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === "string") {
      cmd = t;
      i++;
    } else if (!cmd) throw new PathSyntaxError("path data must start with M");
    else if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
    else if (cmd === "Z" || cmd === "z") throw new PathSyntaxError("number after Z");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const pt = (): Vec2 => {
      const x = num(), y = num();
      return rel ? [p[0] + x, p[1] + y] : [x, y];
    };
    let ctrl: Vec2 | null = null;
    switch (C) {
      case "M": {
        p = pt();
        cur = null;
        startPt = p;
        // a following implicit pair is a lineto
        cmd = rel ? "l" : "L";
        break;
      }
      case "L": {
        const q = pt();
        if (!same(p, q)) push(line(p, q));
        p = q;
        break;
      }
      case "H": {
        const x = num();
        const q: Vec2 = [rel ? p[0] + x : x, p[1]];
        if (!same(p, q)) push(line(p, q));
        p = q;
        break;
      }
      case "V": {
        const y = num();
        const q: Vec2 = [p[0], rel ? p[1] + y : y];
        if (!same(p, q)) push(line(p, q));
        p = q;
        break;
      }
      case "C":
      case "S": {
        let c1: Vec2;
        if (C === "C") c1 = pt();
        else c1 = lastCtrl && "CS".includes(lastCmd) ? [2 * p[0] - lastCtrl[0], 2 * p[1] - lastCtrl[1]] : p;
        const c2 = pt();
        const q = pt();
        push(bezier([p, c1, c2, q]));
        ctrl = c2;
        p = q;
        break;
      }
      case "Q":
      case "T": {
        let c1: Vec2;
        if (C === "Q") c1 = pt();
        else c1 = lastCtrl && "QT".includes(lastCmd) ? [2 * p[0] - lastCtrl[0], 2 * p[1] - lastCtrl[1]] : p;
        const q = pt();
        push(bezier([p, c1, q]));
        ctrl = c1;
        p = q;
        break;
      }
      case "A": {
        const rx = num(), ry = num(), phi = num(), large = num(), sweep = num();
        const q = pt();
        for (const s of svgArc(p, q, rx, ry, phi, large !== 0, sweep !== 0)) push(s);
        p = q;
        break;
      }
      case "Z": {
        if (cur) {
          const c: SubPath = cur;
          if (!same(p, startPt)) c.segs.push(line(p, startPt));
          else if (c.segs.length) snapEnd(c.segs, startPt);
          c.closed = true;
        }
        p = startPt;
        cur = null;
        break;
      }
    }
    lastCtrl = ctrl;
    lastCmd = C;
  }
  for (const s of subs) {
    if (!s.closed && s.segs.length) {
      if (same(end(s.segs[s.segs.length - 1]!), start(s.segs[0]!))) s.closed = true;
    }
  }
  return subs.filter((s) => s.segs.length > 0);
}

function same(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

function snapEnd(segs: Seg2[], to: Vec2) {
  const s = segs[segs.length - 1]!;
  if (s.kind === "line") s.b = to;
  else if (s.kind === "nurbs") s.pts[s.pts.length - 1] = [to[0], to[1], s.pts[s.pts.length - 1]![2]];
}

/** A Bézier (degree = points - 1) as a NURBS with weights 1. */
export function bezier(points: Vec2[]): Nurbs2 {
  const n = points.length - 1;
  return {
    kind: "nurbs",
    degree: n,
    pts: points.map(([x, y]) => [x, y, 1]),
    knots: [...Array(n + 1).fill(0), ...Array(n + 1).fill(1)],
  };
}

/** SVG endpoint arc → arcs (circular) or rational quadratic NURBS pieces (elliptical). */
export function svgArc(p: Vec2, q: Vec2, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean): Seg2[] {
  if (same(p, q)) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [line(p, q)];
  const phi = (phiDeg * Math.PI) / 180;
  const cphi = Math.cos(phi), sphi = Math.sin(phi);
  const dx = (p[0] - q[0]) / 2, dy = (p[1] - q[1]) / 2;
  const x1 = cphi * dx + sphi * dy, y1 = -sphi * dx + cphi * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry, cy1 = (-k * ry * x1) / rx;
  const cx = cphi * cx1 - sphi * cy1 + (p[0] + q[0]) / 2;
  const cy = sphi * cx1 + cphi * cy1 + (p[1] + q[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;

  if (Math.abs(rx - ry) < 1e-9 * Math.max(rx, ry)) {
    // circular: an exact arc (the ellipse rotation doesn't matter for a circle)
    const a0 = t1 + phi;
    const a = arc([cx, cy], rx, a0, a0 + dt);
    return [a];
  }
  // elliptical: split into ≤ 90° rational quadratic pieces
  const pieces = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / pieces;
  const E = (t: number): Vec2 => [cx + rx * Math.cos(t) * cphi - ry * Math.sin(t) * sphi, cy + rx * Math.cos(t) * sphi + ry * Math.sin(t) * cphi];
  const segs: Seg2[] = [];
  for (let i = 0; i < pieces; i++) {
    const a = t1 + step * i, b = a + step, mid = (a + b) / 2;
    const w = Math.cos(step / 2);
    // middle control point: the ellipse point at mid "pushed out" by 1/w
    const cm = 1 / w;
    const P1: Vec2 = [cx + (rx * Math.cos(mid) * cphi - ry * Math.sin(mid) * sphi) * cm, cy + (rx * Math.cos(mid) * sphi + ry * Math.sin(mid) * cphi) * cm];
    const P0 = i === 0 ? p : E(a);
    const P2 = i === pieces - 1 ? q : E(b);
    segs.push({ kind: "nurbs", degree: 2, pts: [[P0[0], P0[1], 1], [P1[0], P1[1], w], [P2[0], P2[1], 1]], knots: [0, 0, 0, 1, 1, 1] });
  }
  return segs;
}

export type { Loop2 };
