/** @jsxImportSource tscad */
/**
 * `<BoardCase>`: an enclosure generated from a board's data: standoffs on its mounting holes,
 * openings where its connectors face the walls, a friction-fit lid with vents. It's an
 * assembly, with the board mated onto the standoffs so an interference check proves it fits.
 */
import type { Placement } from "../../core/intrinsics";
import { metricData } from "../metric";
import { placement } from "../place";
import { Standoff } from "../hardware";
import { Board, connectorFace, facingAxis } from "./board";
import { boardTop, PLUG_CLEARANCE, type BoardDef, type Connector } from "./data";

/** Props of {@link BoardCase}. */
export interface BoardCaseProps extends Placement {
  /** The board, e.g. `boards.raspberryPi5`. */
  board: BoardDef;
  /** Wall thickness, mm. Default 2. */
  wall?: number;
  /** Floor thickness, mm. Default 2. */
  floor?: number;
  /** Gap between the board (and its connectors) and the walls, mm. Default 1. */
  clearance?: number;
  /** Space above the tallest part, mm. Default 2. */
  headroom?: number;
  /** Add a lid (a plate with a locating lip). Default true. */
  lid?: boolean;
  /**
   * Which connectors get an opening: `"auto"` (default) cuts every connector that faces a
   * wall; or a list of connector ids. To expose a top-facing connector such as a GPIO header
   * through the lid, list it.
   */
  ports?: "auto" | string[];
  /** Extra gap around each opening on top of the plug clearance, mm. Default 0.3. */
  portClearance?: number;
  /** How much each opening widens towards the outside (a chamfer for the plug), mm. Default 0.8. */
  chamfer?: number;
  /** Vent slots in the lid. Default true. */
  vents?: boolean;
  /**
   * `"auto"` (default): standoffs on the mounting holes, sized for the board's screw, tall
   * enough to clear its underside; boards without holes sit on ledges along their short ends.
   * `"none"`: the board lies on the floor.
   */
  standoffs?: "auto" | "none";
  /** Lift the lid off by this much for viewing, mm. Default 0 (closed). */
  explode?: number;
  /** Name prefix of the parts. Default `"case"`. */
  name?: string;
  /** Show the board in the case. Default true. */
  showBoard?: boolean;
}

type Rect = [number, number, number, number];

/** Where things go, from the board data (all in the case frame: the board's x/y, z up from the floor's underside). */
export function boardCaseLayout(p: BoardCaseProps) {
  const b = p.board;
  const wall = p.wall ?? 2, floor = p.floor ?? 2, clearance = p.clearance ?? 1, headroom = p.headroom ?? 2;
  const support = p.standoffs ?? "auto";
  const standoff = support === "none" ? 0 : Math.max(3, b.underside + 1);
  const pcbZ = floor + standoff; // underside of the PCB
  // the cavity: the PCB plus everything sticking out of it, plus the clearance
  let [x0, y0, x1, y1] = [0, 0, b.size[0], b.size[1]];
  for (const k of b.connectors) {
    x0 = Math.min(x0, k.rect[0]); y0 = Math.min(y0, k.rect[1]);
    x1 = Math.max(x1, k.rect[2]); y1 = Math.max(y1, k.rect[3]);
  }
  const cavity: Rect = [x0 - clearance, y0 - clearance, x1 + clearance, y1 + clearance];
  // leave room for the lid's locating lip (3 mm) above the tallest part
  const innerTop = pcbZ + boardTop(b) + Math.max(headroom, 3.5);
  const ports = (p.ports ?? "auto") === "auto"
    ? b.connectors.filter((k) => k.facing !== "+z" && k.facing !== "-z")
    : b.connectors.filter((k) => (p.ports as string[]).includes(k.id));
  return { b, wall, floor, clearance, standoff, pcbZ, cavity, innerTop, ports, support };
}

/**
 * An enclosure for a board, from its data: a tub with standoffs on the board's mounting holes,
 * an opening (with plug clearance and an outward chamfer) wherever a connector faces a wall, and
 * a lid with a locating lip and vents. Everything is an assembly: `<name>-base`, `<name>-lid`,
 * and the `<Board>` mated onto the standoffs, so `tscad_check` interference shows the fit.
 *
 * Anchors on `<name>-base`: `port-<id>` at the centre of each opening on the inner wall face.
 *
 * @example <BoardCase board={boards.raspberryPi5} ports="auto" vents />
 */
export function BoardCase(p: BoardCaseProps) {
  const L = boardCaseLayout(p);
  const { b, wall, floor, cavity, innerTop, pcbZ, ports } = L;
  const name = p.name ?? "case";
  const r = 3;
  const [cx0, cy0, cx1, cy1] = cavity;
  const cw = cx1 - cx0, cd = cy1 - cy0;
  const ccx = (cx0 + cx1) / 2, ccy = (cy0 + cy1) / 2;
  const outer = (grow: number) => <roundedRect w={cw + 2 * grow} h={cd + 2 * grow} r={r + grow} x={ccx} y={ccy} />;
  const chamfer = p.chamfer ?? 0.8;
  const portGap = p.portClearance ?? 0.3;
  const screw = b.screw ? metricData(b.screw) : undefined;

  // an opening for a connector: a drafted extrude through the wall, along its facing
  const opening = (k: Connector) => {
    const [x0, y0, x1, y1] = k.rect;
    const gap = (k.clearance ?? PLUG_CLEARANCE[k.type]) + portGap;
    const zb = pcbZ + b.thickness + k.z - gap, zt = pcbZ + b.thickness + k.z + k.height + gap;
    const across = k.facing === "-x" || k.facing === "+x" ? [y0 - gap, y1 + gap] : [x0 - gap, x1 + gap];
    const w = across[1]! - across[0]!, h = zt - zb, mid = (across[0]! + across[1]!) / 2, zc = (zb + zt) / 2;
    const depth = wall + 0.2;
    const draft = -Math.atan(chamfer / depth) * (180 / Math.PI);
    // start just inside the inner wall face; tool +Z → the facing direction
    const at: [number, number, number] =
      k.facing === "-y" ? [mid, cy0 + 0.1, zc] : k.facing === "+y" ? [mid, cy1 - 0.1, zc] : k.facing === "-x" ? [cx0 + 0.1, mid, zc] : k.facing === "+x" ? [cx1 - 0.1, mid, zc] : [mid, (y0 + y1) / 2, innerTop - 0.1];
    const rotate: [number, number, number] =
      k.facing === "-y" ? [90, 0, 0] : k.facing === "+y" ? [-90, 0, 0] : k.facing === "-x" ? [90, 0, -90] : k.facing === "+x" ? [90, 0, 90] : [0, 0, 0];
    if (k.facing === "+z") {
      // through the lid: a slot over the connector
      return <box key={k.id} size={[x1 - x0 + 2 * gap, y1 - y0 + 2 * gap, wall + 2]} at={[(x0 + x1) / 2, (y0 + y1) / 2, innerTop - 1]} />;
    }
    return (
      <extrude key={k.id} height={depth + 0.2} draft={draft} rotate={rotate} at={at}>
        <rect w={w} h={h} />
      </extrude>
    );
  };
  const portAnchor = (k: Connector) => {
    const f = connectorFace(b, k);
    const z = pcbZ + f[2];
    const at: [number, number, number] =
      k.facing === "-y" ? [f[0], cy0, z] : k.facing === "+y" ? [f[0], cy1, z] : k.facing === "-x" ? [cx0, f[1], z] : k.facing === "+x" ? [cx1, f[1], z] : [f[0], f[1], innerTop];
    return <anchor key={`a-${k.id}`} id={`port-${k.id}`} at={at} axis={facingAxis(k.facing)} />;
  };
  const sideCuts = ports.filter((k) => k.facing !== "+z" && k.facing !== "-z");
  const lidCuts = ports.filter((k) => k.facing === "+z");

  // supports: standoffs on the holes, or ledges under the short ends
  const supports =
    L.support === "none"
      ? null
      : b.holes.length && screw
        ? b.holes.map((h, i) => <Standoff key={i} size={b.screw!} height={L.standoff} at={[h.at[0], h.at[1], floor]} />)
        : [
            <box key="l0" size={[3, b.size[1] * 0.6, L.standoff]} center={false} at={[0, b.size[1] * 0.2, floor]} />,
            <box key="l1" size={[3, b.size[1] * 0.6, L.standoff]} center={false} at={[b.size[0] - 3, b.size[1] * 0.2, floor]} />,
          ];
  const seat: [number, number, number] = b.holes.length ? [b.holes[0]!.at[0], b.holes[0]!.at[1], pcbZ] : [0, 0, pcbZ];

  const lid = p.lid ?? true;
  const vents = p.vents ?? true;
  const lip = 3;
  const lidClear = 0.2;
  const boardName = `${name}-board`;
  return (
    <assembly name={name} {...placement(p)}>
      <part name={`${name}-base`} material="pla" fixed>
        <difference>
          <extrude height={innerTop}>{outer(wall)}</extrude>
          <extrude height={innerTop} offset={floor}>{outer(0)}</extrude>
          {sideCuts.map(opening)}
        </difference>
        {supports}
        <anchor id="seat" at={seat} axis="z" />
        {sideCuts.map(portAnchor)}
      </part>
      {lid && (
        <part name={`${name}-lid`} material="pla" z={p.explode ?? 0}>
          <difference>
            <union>
              <extrude height={wall} offset={innerTop}>{outer(wall)}</extrude>
              <extrude height={lip} offset={innerTop - lip}>
                {outer(-lidClear)}
                {outer(-lidClear - 1.2)}
              </extrude>
            </union>
            {lidCuts.map(opening)}
            {vents && (
              <linearPattern count={Math.max(1, Math.floor((cw * 0.5) / 5))} dx={5} center x={ccx} y={ccy}>
                <box size={[2, cd * 0.45, wall + 2]} z={innerTop - 1} />
              </linearPattern>
            )}
          </difference>
          {lidCuts.map(portAnchor)}
        </part>
      )}
      {p.showBoard !== false && (
        <>
          <Board board={b} name={boardName} />
          <mate a={`${name}-base.seat`} b={b.holes.length ? `${boardName}-pcb.hole1` : `${boardName}-pcb.origin`} type="fastened" />
        </>
      )}
    </assembly>
  );
}
