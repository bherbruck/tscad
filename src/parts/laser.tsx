/** @jsxImportSource tscad */
/**
 * Laser-cut generators: a finger-jointed box (flat panels for cutting, or folded into 3D to
 * check the fit) and a living-hinge cut pattern.
 */
import type { Placement2D } from "../core/intrinsics";
import { positive } from "./place";

type Pt = [number, number];
type Rect = [number, number, number, number]; // x0, y0, x1, y1

// ---------------------------------------------------------------------------------------------
// Rectilinear outlines from cells

/**
 * The boundary loops of the region `[0, w] × [0, h]` minus `cut` rectangles (notches and slots):
 * rectilinear polygons, outer boundary CCW, holes CW.
 * @internal
 */
export function cutOutline(w: number, h: number, cut: Rect[]): Pt[][] {
  const xs = [...new Set([0, w, ...cut.flatMap((r) => [r[0], r[2]]).filter((x) => x > 0 && x < w)])].sort((a, b) => a - b);
  const ys = [...new Set([0, h, ...cut.flatMap((r) => [r[1], r[3]]).filter((y) => y > 0 && y < h)])].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  const filled = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const cx = (xs[i]! + xs[i + 1]!) / 2, cy = (ys[j]! + ys[j + 1]!) / 2;
    return !cut.some((r) => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]);
  };
  // directed boundary edges between grid vertices (material on the left)
  const out = new Map<string, [number, number][]>();
  const add = (a: [number, number], b: [number, number]) => {
    const k = `${a[0]},${a[1]}`;
    (out.get(k) ?? out.set(k, []).get(k)!).push(b);
  };
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      if (!filled(i, j)) continue;
      if (!filled(i, j - 1)) add([i, j], [i + 1, j]);
      if (!filled(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
      if (!filled(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
      if (!filled(i - 1, j)) add([i, j + 1], [i, j]);
    }
  const loops: Pt[][] = [];
  for (;;) {
    const startKey = [...out.keys()].find((k) => out.get(k)!.length);
    if (!startKey) break;
    const [si, sj] = startKey.split(",").map(Number) as [number, number];
    const verts: [number, number][] = [[si, sj]];
    let cur: [number, number] = [si, sj];
    let dir: [number, number] | undefined;
    for (;;) {
      const k = `${cur[0]},${cur[1]}`;
      const opts = out.get(k)!;
      // where two boundaries touch at a vertex, take the rightmost turn (keeps loops simple)
      let pick = 0;
      if (opts.length > 1 && dir) {
        const score = (b: [number, number]) => {
          const dx = b[0] - cur[0], dy = b[1] - cur[1];
          return dir![0] * dy - dir![1] * dx; // cross > 0 = left turn
        };
        pick = opts.reduce((best, b, idx) => (score(b) < score(opts[best]!) ? idx : best), 0);
      }
      const next = opts.splice(pick, 1)[0]!;
      dir = [next[0] - cur[0], next[1] - cur[1]];
      cur = next;
      if (cur[0] === si && cur[1] === sj) break;
      verts.push(cur);
    }
    // drop collinear vertices
    const pts = verts.map(([i, j]) => [xs[i]!, ys[j]!] as Pt);
    const simple = pts.filter((p, idx) => {
      const a = pts[(idx + pts.length - 1) % pts.length]!, c = pts[(idx + 1) % pts.length]!;
      return (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]) !== 0;
    });
    loops.push(simple);
  }
  return loops;
}

// ---------------------------------------------------------------------------------------------
// Finger-jointed box

/** Segment boundaries of an edge of length `L`: an odd count (≥ 3) of about `finger` each. */
function segments(L: number, finger: number): number[] {
  let n = Math.max(3, Math.round(L / finger));
  if (n % 2 === 0) n += n * finger > L ? -1 : 1;
  n = Math.max(3, n);
  return Array.from({ length: n + 1 }, (_, i) => (L * i) / n);
}

type PanelName = "bottom" | "lid" | "front" | "back" | "left" | "right" | `divider${number}`;
/** Higher priority keeps the end fingers (and so the corners). */
const PRIORITY: Record<string, number> = { bottom: 0, lid: 1, front: 2, back: 2, left: 3, right: 3 };

export interface BoxPanel {
  name: PanelName;
  /** Panel size in its own 2D frame (u, v), mm. */
  w: number;
  h: number;
  /** Outline loops in the panel frame (outer CCW, slots CW), before kerf. */
  loops: Pt[][];
  /** 3D placement: rotate (deg, XYZ) then translate, mapping (u, v, thickness) to the box. */
  rotate: [number, number, number];
  at: [number, number, number];
}

interface Joint {
  /** Which side of the panel: v = 0 ("s"), u = w ("e"), v = h ("n"), u = 0 ("w"). */
  side: "s" | "e" | "n" | "w";
  other: string;
}

/**
 * The panels of a finger-jointed box with outer size `W × D × H` and sheet thickness `t`.
 * Edges shared by two panels are split into an odd number of fingers; the higher-priority
 * panel (bottom > lid > front/back > left/right) keeps the even ones, the other the odd ones,
 * so every corner cube belongs to exactly one panel and the joints don't overlap.
 */
export function fingerBoxPanels(o: { W: number; D: number; H: number; t: number; finger: number; lid: boolean; dividers: number }): BoxPanel[] {
  const { W, D, H, t, finger, lid } = o;
  const defs: { name: PanelName; w: number; h: number; joints: Joint[]; rotate: [number, number, number]; at: [number, number, number] }[] = [
    { name: "bottom", w: W, h: D, joints: [{ side: "s", other: "front" }, { side: "e", other: "right" }, { side: "n", other: "back" }, { side: "w", other: "left" }], rotate: [0, 0, 0], at: [0, 0, 0] },
    { name: "front", w: W, h: H, joints: [{ side: "s", other: "bottom" }, { side: "e", other: "right" }, { side: "w", other: "left" }, ...(lid ? [{ side: "n" as const, other: "lid" }] : [])], rotate: [90, 0, 0], at: [0, t, 0] },
    { name: "back", w: W, h: H, joints: [{ side: "s", other: "bottom" }, { side: "e", other: "right" }, { side: "w", other: "left" }, ...(lid ? [{ side: "n" as const, other: "lid" }] : [])], rotate: [90, 0, 0], at: [0, D, 0] },
    { name: "left", w: D, h: H, joints: [{ side: "s", other: "bottom" }, { side: "w", other: "front" }, { side: "e", other: "back" }, ...(lid ? [{ side: "n" as const, other: "lid" }] : [])], rotate: [90, 0, 90], at: [0, 0, 0] },
    { name: "right", w: D, h: H, joints: [{ side: "s", other: "bottom" }, { side: "w", other: "front" }, { side: "e", other: "back" }, ...(lid ? [{ side: "n" as const, other: "lid" }] : [])], rotate: [90, 0, 90], at: [W - t, 0, 0] },
  ];
  if (lid) defs.push({ name: "lid", w: W, h: D, joints: [{ side: "s", other: "front" }, { side: "e", other: "right" }, { side: "n", other: "back" }, { side: "w", other: "left" }], rotate: [0, 0, 0], at: [0, 0, H - t] });

  const cuts = new Map<string, Rect[]>(defs.map((d) => [d.name, []]));
  for (const d of defs) {
    const mine = PRIORITY[d.name]!;
    for (const j of d.joints) {
      const keepsEven = mine < PRIORITY[j.other]!;
      const L = j.side === "s" || j.side === "n" ? d.w : d.h;
      const seg = segments(L, finger);
      for (let k = 0; k + 1 < seg.length; k++) {
        const kept = keepsEven ? k % 2 === 0 : k % 2 === 1;
        if (kept) continue;
        const a = seg[k]!, b = seg[k + 1]!;
        const r: Rect =
          j.side === "s" ? [a, 0, b, t] : j.side === "n" ? [a, d.h - t, b, d.h] : j.side === "w" ? [0, a, t, b] : [d.w - t, a, d.w, b];
        cuts.get(d.name)!.push(r);
      }
    }
  }

  // dividers: panels across the width (parallel to left/right) with tabs into slots in the
  // bottom, front and back
  const extra: BoxPanel[] = [];
  const n = Math.max(0, Math.floor(o.dividers));
  const top = lid ? H - t : H;
  for (let i = 1; i <= n; i++) {
    const x0 = t + ((W - 2 * t) * i) / (n + 1) - t / 2;
    const name = `divider${i}` as PanelName;
    const dcut: Rect[] = [];
    // along the bottom (u = y over [t, D − t]) and the front/back (v = z over [t, top])
    const bottomSeg = segments(D - 2 * t, finger).map((s) => s + t);
    const sideSeg = segments(top - t, finger).map((s) => s + t);
    // the divider's margins (u ∈ [0, t] ∪ [D − t, D], v ∈ [0, t]) are cut except the tabs
    dcut.push([0, 0, t, t], [D - t, 0, D, t]);
    for (let k = 0; k + 1 < bottomSeg.length; k++) {
      const a = bottomSeg[k]!, b = bottomSeg[k + 1]!;
      if (k % 2 === 1) cuts.get("bottom")!.push([x0, a, x0 + t, b]); // slot for the tab
      else dcut.push([a, 0, b, t]);
    }
    for (let k = 0; k + 1 < sideSeg.length; k++) {
      const a = sideSeg[k]!, b = sideSeg[k + 1]!;
      if (k % 2 === 1) {
        cuts.get("front")!.push([x0, a, x0 + t, b]);
        cuts.get("back")!.push([x0, a, x0 + t, b]);
      } else dcut.push([0, a, t, b], [D - t, a, D, b]);
    }
    extra.push({ name, w: D, h: top, loops: cutOutline(D, top, dcut), rotate: [90, 0, 90], at: [x0, 0, 0] });
  }
  return [...defs.map((d) => ({ name: d.name, w: d.w, h: d.h, loops: cutOutline(d.w, d.h, cuts.get(d.name)!), rotate: d.rotate, at: d.at })), ...extra];
}

export interface FingerJointBoxProps {
  /** Outer width (X), mm. */
  width: number;
  /** Outer depth (Y), mm. */
  depth: number;
  /** Outer height (Z), mm. */
  height: number;
  /** Sheet thickness, mm (e.g. 3 for 3 mm plywood). */
  thickness: number;
  /** Target finger width, mm (each edge gets an odd number of about this size). Default 3 × thickness. */
  fingerWidth?: number;
  /**
   * Laser kerf, mm: every outline is offset outward by kerf / 2 (slots shrink by the same) so
   * the parts come out at size and the joints are snug. Default 0.
   */
  kerf?: number;
  /** Add a finger-jointed lid. Default false (open top). */
  lid?: boolean;
  /** Dividers across the width, slotted into the bottom, front and back. Default 0. */
  dividers?: number;
  /**
   * `false` (default): flat panels laid out for cutting (one `<drawing>` per panel, with
   * `thickness`, so the viewer shows the sheet). `true`: the panels folded into the assembled
   * box as `<part>`s (check the fit with interference), plus the same flat drawings for export.
   */
  assembled?: boolean;
  /** Engrave each panel's name on it (layer `"engrave"`). Default true. */
  labels?: boolean;
  /** Gap between panels in the flat layout, mm. Default 5. */
  spacing?: number;
  /** Prefix for drawing/part names. Default `"box"`. */
  name?: string;
  /** Material preset for the parts. Default `"wood"`. */
  material?: string;
}

/**
 * A finger-jointed box for laser cutting: bottom, four walls, optional lid and dividers, with
 * fingers that mate. Flat, it emits one `<drawing>` per panel (layer `"cut"`) plus engraved
 * labels (layer `"engrave"`) — `tscad build box.tsx -o box.dxf` gives the cutting file.
 * Assembled, it folds the panels into the box so you can see it and check it.
 *
 * @example <FingerJointBox width={120} depth={80} height={60} thickness={3} kerf={0.15} lid />
 */
export function FingerJointBox(p: FingerJointBoxProps) {
  for (const k of ["width", "depth", "height", "thickness"] as const) positive("FingerJointBox", k, p[k]);
  const t = p.thickness;
  const finger = p.fingerWidth ?? 3 * t;
  positive("FingerJointBox", "fingerWidth", finger);
  if (Math.min(p.width, p.depth, p.height) < 4 * t) throw new RangeError(`<FingerJointBox> every side must be at least 4 × thickness (${4 * t} mm)`);
  const kerf = p.kerf ?? 0;
  if (kerf < 0 || kerf >= t) throw new RangeError(`<FingerJointBox> kerf must be in [0, thickness)`);
  const panels = fingerBoxPanels({ W: p.width, D: p.depth, H: p.height, t, finger, lid: !!p.lid, dividers: p.dividers ?? 0 });
  const prefix = p.name ?? "box";
  const gap = p.spacing ?? 5;
  const material = p.material ?? "wood";

  // flat layout: shelf-pack in rows of about (width + depth) wide
  const rowWidth = Math.max(p.width + p.depth + gap, ...panels.map((q) => q.w));
  const placed: { panel: BoxPanel; x: number; y: number }[] = [];
  let x = 0, y = 0, rowH = 0;
  for (const q of panels) {
    if (x > 0 && x + q.w > rowWidth) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    placed.push({ panel: q, x, y });
    x += q.w + gap;
    rowH = Math.max(rowH, q.h);
  }

  const shapes = (q: BoxPanel) => q.loops.map((l, i) => <polygon key={i} points={l} />);
  const flat = placed.map(({ panel: q, x, y }) => {
    const label = Math.max(3, Math.min(10, Math.min(q.w, q.h) * 0.18));
    return [
      <drawing key={q.name} name={`${prefix}-${q.name}`} layer="cut" x={x} y={y} {...(p.assembled ? {} : { thickness: t, material })}>
        {kerf > 0 ? <offset distance={kerf / 2} round={false}>{shapes(q)}</offset> : shapes(q)}
      </drawing>,
      p.labels !== false ? (
        <drawing key={`${q.name}-label`} name={`${prefix}-${q.name}-label`} layer="engrave" x={x} y={y}>
          <text size={label} align="center" valign="middle" x={q.w / 2} y={q.h / 2}>{q.name}</text>
        </drawing>
      ) : null,
    ];
  });
  if (!p.assembled) return <>{flat}</>;
  return (
    <>
      <assembly name={prefix}>
        {panels.map((q) => (
          <part key={q.name} name={`${prefix}-${q.name}`} material={material} rotate={q.rotate} at={q.at}>
            <extrude height={t}>{shapes(q)}</extrude>
          </part>
        ))}
      </assembly>
      {flat}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Living hinge

export interface LivingHingeProps extends Placement2D {
  /** Width of the hinge area (across the bend lines), mm. */
  width: number;
  /** Height of the hinge area (along the cut lines), mm. */
  height: number;
  /** Distance between cut lines, mm. Default 2. */
  spacing?: number;
  /** Uncut bridge between cuts in a line, mm. Default 3. */
  bridge?: number;
  /** Length of each cut, mm. Default about a third of `height`. */
  cutLength?: number;
  /** Width of each cut slot, mm (≈ the kerf). Default 0.3. */
  slotWidth?: number;
}

/**
 * A straight-line living-hinge pattern: staggered columns of thin slots that let sheet material
 * bend. Put it inside a `<drawing>` (or `<extrude>`) over a solid shape; the slots become holes.
 * Centred on its position; the cut lines run along Y.
 *
 * @example <drawing name="cover"><rect w={100} h={60} /><LivingHinge width={30} height={56} /></drawing>
 */
export function LivingHinge(p: LivingHingeProps) {
  positive("LivingHinge", "width", p.width);
  positive("LivingHinge", "height", p.height);
  const spacing = p.spacing ?? 2, bridge = p.bridge ?? 3, slot = p.slotWidth ?? 0.3;
  positive("LivingHinge", "spacing", spacing);
  positive("LivingHinge", "slotWidth", slot);
  if (slot >= spacing) throw new RangeError("<LivingHinge> slotWidth must be smaller than spacing");
  const cut = p.cutLength ?? Math.max(bridge * 2, (p.height - 2 * bridge) / 3);
  const pitch = cut + bridge;
  const cols = Math.max(1, Math.floor(p.width / spacing));
  const x0 = -((cols - 1) * spacing) / 2;
  const lo = -p.height / 2 + bridge, hi = p.height / 2 - bridge; // cuts stay inside the area
  const rects: { x: number; y: number; h: number }[] = [];
  for (let c = 0; c < cols; c++) {
    const shift = c % 2 === 0 ? 0 : pitch / 2;
    for (let s = lo - pitch + shift; s < hi; s += pitch) {
      const a = Math.max(lo, s), b = Math.min(hi, s + cut);
      if (b - a > slot * 2) rects.push({ x: x0 + c * spacing, y: (a + b) / 2, h: b - a });
    }
  }
  const { width: _w, height: _h, spacing: _s, bridge: _b, cutLength: _c, slotWidth: _sw, x = 0, y = 0, rotate, mirror } = p;
  return (
    <sketch x={x} y={y} {...(rotate !== undefined ? { rotate } : {})} {...(mirror ? { mirror } : {})}>
      {rects.map((r, i) => (
        <rect key={i} w={slot} h={r.h} x={r.x} y={r.y} />
      ))}
    </sketch>
  );
}
