import { describe, expect, test } from "bun:test";
import { involuteGear } from "../examples/spur-gear";

/** Densely sample the M/L/C/A path data the gear example emits (arcs are taken as their endpoints). */
function sample(d: string): [number, number][] {
  const tok = d.match(/[MLCAZ]|-?[\d.]+(?:e-?\d+)?/g)!;
  const pts: [number, number][] = [];
  let cur: [number, number] = [0, 0];
  for (let i = 0; i < tok.length; ) {
    const c = tok[i++]!;
    const num = () => Number(tok[i++]);
    if (c === "M" || c === "L") pts.push((cur = [num(), num()]));
    else if (c === "A") {
      i += 5;
      pts.push((cur = [num(), num()]));
    } else if (c === "C") {
      const p1 = [num(), num()], p2 = [num(), num()], p3: [number, number] = [num(), num()];
      for (let s = 1; s <= 200; s++) {
        const u = s / 200, b = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3];
        pts.push([0, 1].map((j) => b[0]! * cur[j]! + b[1]! * p1[j]! + b[2]! * p2[j]! + b[3]! * p3[j]!) as [number, number]);
      }
      cur = p3;
    }
  }
  return pts;
}

/** Chordal width of tooth 0 (centred on +X) at radius `R`, from the sampled outline. */
function widthAt(pts: [number, number][], teeth: number, R: number): number {
  const lim = Math.PI / teeth; // tooth 0 owns angles in ±π/z
  const ang = pts.filter((p) => Math.abs(Math.atan2(p[1], p[0])) < lim && Math.abs(Math.hypot(p[0], p[1]) - R) < 0.02).map((p) => Math.atan2(p[1], p[0]));
  if (ang.length < 2) return NaN;
  return (Math.max(...ang) - Math.min(...ang)) * R;
}

describe("involute gear profile", () => {
  for (const [teeth, module, pa] of [[24, 2, 20], [12, 2, 20], [40, 1, 20], [17, 3, 14.5]] as const) {
    test(`z=${teeth} m=${module} α=${pa}°: πm/2 at the pitch circle, tapering to the tip`, () => {
      const pts = sample(involuteGear(teeth, module, pa));
      const r = (module * teeth) / 2, ra = r + module, rf = r - 1.25 * module;
      // arc thickness at the pitch circle ≈ π·m/2 (chordal width is a hair less)
      const s = widthAt(pts, teeth, r);
      expect(Math.abs(s - (Math.PI * module) / 2) / ((Math.PI * module) / 2)).toBeLessThan(0.02);
      // thickness decreases monotonically outward: over the whole tooth when there is no
      // undercut (z ≥ 2 / sin²α), otherwise from the base circle up
      const rb = r * Math.cos((pa * Math.PI) / 180)
      const undercut = teeth < 2 / Math.sin((pa * Math.PI) / 180) ** 2;
      const lo = undercut ? Math.max(rb + 0.05 * module, rf + 0.1 * module) : rf + 0.1 * module;
      const radii = Array.from({ length: 12 }, (_, i) => lo + ((ra - 0.1 * module - lo) * i) / 11);
      const w = radii.map((R) => widthAt(pts, teeth, R));
      for (let i = 1; i < w.length; i++) expect(w[i]!).toBeLessThan(w[i - 1]! + 1e-3);
      expect(w[w.length - 1]!).toBeGreaterThan(0.2 * module); // not pointed
      // every outline point lies between the root and tip circles
      for (const p of pts) {
        const R = Math.hypot(p[0], p[1]);
        expect(R).toBeGreaterThan(rf - 0.01 * module);
        expect(R).toBeLessThan(ra + 1e-3);
      }
    });
  }
});
