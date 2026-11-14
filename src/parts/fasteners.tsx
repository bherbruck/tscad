/** @jsxImportSource tscad */
/**
 * Standard fasteners and mechanical parts as **solids**, with ISO dimensions from tables
 * (`fastener-data.ts`): `<Bolt>`, `<Nut>`, `<Washer>`, `<SetScrew>`, `<DowelPin>`, `<Bearing>`,
 * `<ShaftCollar>`. Threads are not modelled (nominal diameter); sockets, chamfers and the
 * nyloc insert dome are.
 *
 * Every component names its sub-solids (a bolt's `head`, `shank` and `socket`; a nut's `body`
 * and `bore`) so they can be referenced, and places `<anchor>`s on its useful frames for
 * `<mate>`. A `<Bolt cutter>` is the bolt's own clearance cutter (hole plus head pocket) for a
 * `<difference>`, in the same place as the bolt.
 *
 * @example
 * <difference>
 *   <box size={[30, 30, 6]} />
 *   <Bolt thread="M3" length={10} cutter z={6} />
 * </difference>
 * <Bolt thread="M3" length={10} z={6} />
 */
import type { Placement } from "../core/intrinsics";
import {
  bearings, boltHeads, flatWashers, nylocHeight, setScrewSockets, shaftCollars, springWashers,
  type BearingDesignation, type BoltHead, type CollarBore,
} from "./fastener-data";
import { metricData, type HoleFit, type MetricSize } from "./metric";
import { placement, positive } from "./place";

/** A sliver that keeps unioned or cut pieces from sharing a face exactly. */
const LIFT = 0.01;
const TAN30 = Math.tan(Math.PI / 6);

type Pt = [number, number];

/** A closed (radius, height) profile turned about Z. */
function Turned({ pts }: { pts: Pt[] }) {
  return (
    <revolve>
      <polygon points={pts} />
    </revolve>
  );
}

/**
 * The `anchors` prop shared by every component: `true` places the component's anchors with
 * their plain ids (`head`, `face`...), a string prefixes them (`"left-"` gives `left-head`), so
 * several fasteners in one part keep their anchor ids unique. Default `false`: no anchors.
 */
export interface AnchorsProp {
  anchors?: boolean | string;
}

function Anchors({ opt, list }: { opt: boolean | string | undefined; list: [string, [number, number, number]][] }) {
  if (!opt) return null;
  const prefix = typeof opt === "string" ? opt : "";
  return (
    <>
      {list.map(([id, at]) => (
        <anchor id={`${prefix}${id}`} at={at} axis="z" />
      ))}
    </>
  );
}

/** The clearance hole diameter for `thread` at `fit` (ISO 273: close, normal, loose). */
export function clearance(thread: MetricSize, fit: HoleFit = "normal"): number {
  return metricData(thread).clearance[fit];
}

/** A hex prism of across-flats `af`, z 0..h, with 30° chamfers on the ends listed. */
function ChamferedHex({ af, h, top = true, bottom = true }: { af: number; h: number; top?: boolean; bottom?: boolean }) {
  const R = af / Math.sqrt(3); // circumradius
  const r0 = af * 0.475; // the chamfer starts just inside the flats
  const r1 = R * 1.05; // ...and clears the corners
  const c = (r1 - r0) * TAN30;
  const pts: Pt[] = [[0, 0], bottom ? [r0, 0] : [r1, 0]];
  if (bottom) pts.push([r1, c]);
  pts.push(top ? [r1, h - c] : [r1, h]);
  if (top) pts.push([r0, h]);
  pts.push([0, h]);
  return (
    <intersection>
      <extrude height={h}>
        <regularPolygon sides={6} flats={af} />
      </extrude>
      <Turned pts={pts} />
    </intersection>
  );
}

/** A hex socket recess of across-flats `s` and depth `t`, from z = top down. */
function Socket({ s, t, top }: { s: number; t: number; top: number }) {
  return (
    <group name="socket">
      <extrude height={t + LIFT} z={top - t}>
        <regularPolygon sides={6} flats={s} />
      </extrude>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Bolt

/** Props of {@link Bolt}. */
export interface BoltProps extends Placement, AnchorsProp {
  /** ISO metric thread, `"M2"` to `"M12"`. */
  thread: MetricSize;
  /**
   * Nominal length, mm, as catalogues sell it: under the head for socket, hex, button and pan
   * heads; overall (head included) for flat, countersunk heads.
   */
  length: number;
  /** Head style. Default `"socket"` (ISO 4762 cap screw). */
  head?: BoltHead;
  /**
   * Make the bolt's clearance cutter instead of the bolt: a clearance hole down the shank and a
   * pocket for the head (a countersink for flat heads), for a `<difference>`. `true` is the
   * `"normal"` fit; or give `"close"` / `"loose"`.
   */
  cutter?: boolean | HoleFit;
  /**
   * With `cutter`: make the cutter a ghost, a tool-only solid that is left out of the output
   * unless a `<difference>` or a ref op (`<subtract tool=".b > .clearance">`) uses it. Default
   * true.
   */
  ghost?: boolean;
  /** Extra clearance around the head in the cutter's pocket, mm (diameter). Default 1. */
  headClearance?: number;
  /** Instance name for refs (`<Bolt name="b" />` → `.b > .shank`); tscad records it. */
  name?: string;
}

/**
 * A metric bolt (cap screw). Frame: the head's bearing face at z = 0, the shank down −Z, the
 * head up +Z; for a flat (countersunk) head z = 0 is the flush top face and the head's cone
 * goes down. Sub-solids: `head`, `shank`, `socket` (the recess, cut from the head). Anchors:
 * `head` (z = 0, axis +Z) and `tip` (the shank's end).
 */
export function Bolt(props: BoltProps) {
  const m = metricData(props.thread);
  const style = props.head ?? "socket";
  const hd = boltHeads[style][props.thread];
  const L = props.length;
  positive("Bolt", "length", L);
  const d = m.d;
  const r = d / 2;
  const flat = style === "flat";
  if (flat && L <= hd.k) throw new RangeError(`<Bolt head="flat"> length (${L}) must exceed the head height (${hd.k})`);
  const anchors = <Anchors opt={props.anchors} list={[["head", [0, 0, 0]], ["tip", [0, 0, -L]]]} />;

  if (props.cutter) {
    const fit: HoleFit = props.cutter === true ? "normal" : props.cutter;
    const hc = props.headClearance ?? 1;
    const holeR = m.clearance[fit] / 2;
    const headR = (style === "hex" ? hd.dk / Math.sqrt(3) : hd.dk / 2) + hc / 2;
    // a hole down the shank (and a little past the tip), and a pocket for the head
    const pts: Pt[] = flat
      ? [[0, -L - 0.5], [holeR, -L - 0.5], [holeR, -(headR - holeR)], [headR, 0], [headR, LIFT], [0, LIFT]]
      : [[0, -L - 0.5], [holeR, -L - 0.5], [holeR, 0], [headR, 0], [headR, hd.k + LIFT], [0, hd.k + LIFT]];
    return (
      <group {...placement(props)} ghost={props.ghost ?? true}>
        <group name="clearance">
          <Turned pts={pts} />
        </group>
        {anchors}
      </group>
    );
  }

  // the shank, with a 45° lead chamfer at the tip; it reaches into the head so the union fuses
  const c = Math.min(m.pitch, r / 2);
  const top = flat ? -hd.k + LIFT * 10 : LIFT * 10;
  const shankPts: Pt[] = [[0, -L], [r - c, -L], [r, -L + c], [r, top], [0, top]];

  let headSolid;
  if (style === "hex") {
    headSolid = <ChamferedHex af={hd.dk} h={hd.k} bottom={false} />;
  } else if (style === "flat") {
    // a 90° cone from the flush face down to the shank
    headSolid = <Turned pts={[[0, -hd.k], [r, -hd.k], [hd.dk / 2, 0], [0, 0]]} />;
  } else if (style === "button") {
    // a domed head: a spherical cap approximated by a quarter-ellipse fan of chords
    const R = hd.dk / 2, k = hd.k, n = 8;
    const pts: Pt[] = [[0, 0], [R, 0]];
    for (let i = 1; i < n; i++) {
      const a = (i / n) * (Math.PI / 2);
      pts.push([R * Math.cos(a), k * Math.sin(a)]);
    }
    pts.push([0, k]);
    headSolid = <Turned pts={pts} />;
  } else {
    // socket (ISO 4762: small top chamfer) and pan (rounded top edge)
    const R = hd.dk / 2, k = hd.k;
    const e = style === "pan" ? k * 0.35 : Math.min(0.1 * k, 0.5);
    headSolid = <Turned pts={[[0, 0], [R, 0], [R, k - e], [R - e, k], [0, k]]} />;
  }
  const socketTop = flat ? 0 : hd.k;
  return (
    <group {...placement(props)}>
      <group name="head">
        {hd.s > 0 ? (
          <difference>
            {headSolid}
            <Socket s={hd.s} t={hd.t} top={socketTop} />
          </difference>
        ) : (
          headSolid
        )}
      </group>
      <group name="shank">
        <Turned pts={shankPts} />
      </group>
      {anchors}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Nut

/** Props of {@link Nut}. */
export interface NutProps extends Placement, AnchorsProp {
  /** ISO metric thread. */
  thread: MetricSize;
  /** `"hex"` (ISO 4032, default) or `"nyloc"` (ISO 10511, with the nylon insert's dome). */
  type?: "hex" | "nyloc";
  /** Instance name for refs (`<Bolt name="b" />` → `.b > .shank`); tscad records it. */
  name?: string;
}

/**
 * A hex nut. Frame: its bearing face on z = 0, axis +Z. Sub-solids: `body` and `bore`.
 * Anchors: `face` (z = 0) and `top`.
 */
export function Nut(props: NutProps) {
  const m = metricData(props.thread);
  const af = m.nut.af;
  const nyloc = props.type === "nyloc";
  const h = nyloc ? nylocHeight[props.thread] : m.nut.height;
  const hexH = nyloc ? Math.min(m.nut.height, h * 0.75) : h;
  const domeR = af * 0.45;
  return (
    <group {...placement(props)}>
      <difference>
        <group name="body">
          <ChamferedHex af={af} h={hexH} top={!nyloc} />
          {nyloc && <Turned pts={[[0, hexH - LIFT * 10], [domeR, hexH - LIFT * 10], [domeR, h - 0.15 * (h - hexH)], [domeR * 0.85, h], [0, h]]} />}
        </group>
        <group name="bore">
          <cylinder d={m.d} h={h + 2} z={-1} />
        </group>
      </difference>
      <Anchors opt={props.anchors} list={[["face", [0, 0, 0]], ["top", [0, 0, h]]]} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Washer

/** Props of {@link Washer}. */
export interface WasherProps extends Placement, AnchorsProp {
  /** The bolt's ISO metric thread. */
  thread: MetricSize;
  /** `"flat"` (ISO 7089, default) or `"spring"` (DIN 127 B split lock washer, modelled flat with its split). */
  type?: "flat" | "spring";
  /** Instance name for refs; tscad records it. */
  name?: string;
}

/** A washer lying on z = 0. Sub-solids: `body`. Anchors: `bottom`, `top`. */
export function Washer(props: WasherProps) {
  const w = (props.type === "spring" ? springWashers : flatWashers)[props.thread];
  const ring = <Turned pts={[[w.d1 / 2, 0], [w.d2 / 2, 0], [w.d2 / 2, w.h], [w.d1 / 2, w.h]]} />;
  const gap = Math.max(0.3, 0.12 * (w.d2 - w.d1));
  return (
    <group {...placement(props)}>
      <group name="body">
        {props.type === "spring" ? (
          <difference>
            {ring}
            <box size={[w.d2, gap, w.h + 2]} x={w.d2 / 2} z={-1} center={[true, true, false]} />
          </difference>
        ) : (
          ring
        )}
      </group>
      <Anchors opt={props.anchors} list={[["bottom", [0, 0, 0]], ["top", [0, 0, w.h]]]} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Set screw, dowel pin

/** Props of {@link SetScrew}. */
export interface SetScrewProps extends Placement, AnchorsProp {
  thread: MetricSize;
  /** Length, mm. */
  length: number;
  /** Instance name for refs; tscad records it. */
  name?: string;
}

/**
 * A hex socket set screw with a flat point (ISO 4026), z 0..length, socket at the top.
 * Sub-solids: `body`, `socket`. Anchors: `point` (z = 0) and `top`.
 */
export function SetScrew(props: SetScrewProps) {
  const m = metricData(props.thread);
  const L = props.length;
  positive("SetScrew", "length", L);
  const sk = setScrewSockets[props.thread];
  if (sk.t >= L) throw new RangeError(`<SetScrew> length (${L}) must exceed the socket depth (${sk.t})`);
  const r = m.d / 2;
  const c = Math.min(m.pitch * 0.6, L / 4);
  return (
    <group {...placement(props)}>
      <difference>
        <group name="body">
          <Turned pts={[[0, 0], [r - c, 0], [r, c], [r, L - c], [r - c, L], [0, L]]} />
        </group>
        <Socket s={sk.s} t={sk.t} top={L} />
      </difference>
      <Anchors opt={props.anchors} list={[["point", [0, 0, 0]], ["top", [0, 0, L]]]} />
    </group>
  );
}

/** Props of {@link DowelPin}. */
export interface DowelPinProps extends Placement, AnchorsProp {
  /** Diameter, mm (ISO 8734: 1 to 20). */
  d: number;
  /** Length, mm. */
  length: number;
  /** Instance name for refs; tscad records it. */
  name?: string;
}

/** A hardened dowel pin (ISO 8734), z 0..length, with chamfered ends. Anchors: `bottom`, `top`. */
export function DowelPin(props: DowelPinProps) {
  positive("DowelPin", "d", props.d);
  positive("DowelPin", "length", props.length);
  const r = props.d / 2, L = props.length;
  const c = Math.min(0.1 * props.d + 0.1, L / 4);
  return (
    <group {...placement(props)}>
      <group name="body">
        <Turned pts={[[0, 0], [r - c, 0], [r, c], [r, L - c], [r - c, L], [0, L]]} />
      </group>
      <Anchors opt={props.anchors} list={[["bottom", [0, 0, 0]], ["top", [0, 0, L]]]} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Bearing, shaft collar

/** Props of {@link Bearing}. */
export interface BearingProps extends Placement, AnchorsProp {
  /** Designation, e.g. `"608"` (8 × 22 × 7), `"625"`, `"6001"`, `"MR105"`. */
  designation: BearingDesignation;
  /** Instance name for refs; tscad records it. */
  name?: string;
}

/**
 * A shielded deep-groove ball bearing (ISO 15 dimensions), axis Z, z 0..B. Sub-solids: `outer`
 * (ring), `inner` (ring), `shield` (recessed 0.2 mm each side). Anchors: `face` (z = 0),
 * `back` (z = B), both on the axis.
 */
export function Bearing(props: BearingProps) {
  const b = bearings[props.designation];
  if (!b) throw new RangeError(`<Bearing> unknown designation ${JSON.stringify(props.designation)} (known: ${Object.keys(bearings).join(", ")})`);
  const { d, D, B } = b;
  const ring = (D - d) * 0.22; // each ring's radial wall
  const c = Math.min(0.3, ring / 4, B / 8); // edge chamfers
  const recess = Math.min(0.2, B / 10);
  const ri = d / 2, ro = D / 2;
  const innerOut = ri + ring, outerIn = ro - ring;
  return (
    <group {...placement(props)}>
      <group name="outer">
        <Turned pts={[[outerIn, 0], [ro - c, 0], [ro, c], [ro, B - c], [ro - c, B], [outerIn, B]]} />
      </group>
      <group name="inner">
        <Turned pts={[[ri + c, 0], [innerOut, 0], [innerOut, B], [ri + c, B], [ri, B - c], [ri, c]]} />
      </group>
      <group name="shield">
        <Turned pts={[[innerOut - 0.05, recess], [outerIn + 0.05, recess], [outerIn + 0.05, B - recess], [innerOut - 0.05, B - recess]]} />
      </group>
      <Anchors opt={props.anchors} list={[["face", [0, 0, 0]], ["back", [0, 0, B]]]} />
    </group>
  );
}

/** Props of {@link ShaftCollar}. */
export interface ShaftCollarProps extends Placement, AnchorsProp {
  /** Shaft diameter, mm: 3, 4, 5, 6, 8, 10 or 12. */
  bore: CollarBore;
  /** Instance name for refs; tscad records it. */
  name?: string;
}

/**
 * A set-screw shaft collar, axis Z, z 0..width, with a tapped radial hole along +X at mid
 * width. Sub-solids: `body`, `bore`, `screwHole`. Anchors: `face` (z = 0), `back`.
 */
export function ShaftCollar(props: ShaftCollarProps) {
  const c = shaftCollars[props.bore];
  if (!c) throw new RangeError(`<ShaftCollar> no collar for a ${props.bore} mm bore (known: ${Object.keys(shaftCollars).join(", ")})`);
  const tap = metricData(c.screw).tapDrill;
  const e = Math.min(0.5, c.w / 10);
  return (
    <group {...placement(props)}>
      <difference>
        <group name="body">
          <Turned pts={[[0, 0], [c.D / 2 - e, 0], [c.D / 2, e], [c.D / 2, c.w - e], [c.D / 2 - e, c.w], [0, c.w]]} />
        </group>
        <group name="bore">
          <cylinder d={props.bore} h={c.w + 2} z={-1} />
        </group>
        <group name="screwHole">
          <cylinder d={tap} h={c.D} rotateY={90} z={c.w / 2} />
        </group>
      </difference>
      <Anchors opt={props.anchors} list={[["face", [0, 0, 0]], ["back", [0, 0, c.w]]]} />
    </group>
  );
}
