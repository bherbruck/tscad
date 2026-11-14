/** @jsxImportSource tscad */
/**
 * `<Board>`: a simplified 3D model of a board from its data, with anchors per connector and per
 * mounting hole so mates can place it.
 */
import type { Placement } from "../../core/intrinsics";
import { placement } from "../place";
import { type BoardDef, type Connector, type Facing } from "./data";

/** A facing as an anchor axis (`"+x"` → `"x"`). */
export function facingAxis(f: Facing): "x" | "y" | "z" | "-x" | "-y" | "-z" {
  return f.replace("+", "") as "x" | "y" | "z" | "-x" | "-y" | "-z";
}

/** Unit vector of a facing. */
export function facingVector(f: Facing): [number, number, number] {
  switch (f) {
    case "-x": return [-1, 0, 0];
    case "+x": return [1, 0, 0];
    case "-y": return [0, -1, 0];
    case "+y": return [0, 1, 0];
    case "-z": return [0, 0, -1];
    case "+z": return [0, 0, 1];
  }
}

/**
 * The centre of a connector's opening face, in the board frame: the middle of the side the
 * plug comes in from.
 */
export function connectorFace(b: BoardDef, k: Connector): [number, number, number] {
  const [x0, y0, x1, y1] = k.rect;
  const zb = b.thickness + k.z, zt = zb + k.height;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (zb + zt) / 2;
  switch (k.facing) {
    case "-x": return [x0, cy, cz];
    case "+x": return [x1, cy, cz];
    case "-y": return [cx, y0, cz];
    case "+y": return [cx, y1, cz];
    case "-z": return [cx, cy, zb];
    case "+z": return [cx, cy, zt];
  }
}

/** Props of {@link Board}. */
export interface BoardProps extends Placement {
  /** The board, e.g. `boards.raspberryPi5`. */
  board: BoardDef;
  /** Assembly name (prefix of its parts: `<name>-pcb`, `<name>-parts`). Default `"board"`. */
  name?: string;
}

/**
 * A simplified 3D model of a board: the PCB with its mounting holes, plus a block for every
 * connector. It's a sub-assembly of two parts, `<name>-pcb` and `<name>-parts`.
 *
 * Anchors on `<name>-pcb`:
 * - `origin` at the PCB's lower-left corner on its underside;
 * - `hole1`…`holeN` at each mounting hole on the underside, axis +z, ready to mate onto
 *   standoffs;
 * - one per connector (its id) at the centre of the opening, axis pointing out of it.
 *
 * @example <Board board={boards.raspberryPi5} name="pi" />
 */
export function Board(p: BoardProps) {
  const b = p.board;
  const name = p.name ?? "board";
  const [W, D] = b.size;
  return (
    <assembly name={name} {...placement(p)}>
      <part name={`${name}-pcb`} color={b.color} fixed>
        <extrude height={b.thickness}>
          <roundedRect w={W} h={D} r={b.cornerRadius} center={false} />
          {b.holes.map((h, i) => (
            <circle key={i} d={h.d} at={h.at} />
          ))}
        </extrude>
        <anchor id="origin" at={[0, 0, 0]} />
        {b.holes.map((h, i) => (
          <anchor key={`h${i}`} id={`hole${i + 1}`} at={[h.at[0], h.at[1], 0]} axis="z" />
        ))}
        {b.connectors.map((k) => (
          <anchor key={k.id} id={k.id} at={connectorFace(b, k)} axis={facingAxis(k.facing)} />
        ))}
      </part>
      <part name={`${name}-parts`} color="#b8bec6">
        {b.connectors.map((k) => {
          const [x0, y0, x1, y1] = k.rect;
          return <box key={k.id} size={[x1 - x0, y1 - y0, k.height]} center={false} at={[x0, y0, b.thickness + k.z]} />;
        })}
        <anchor id="origin" at={[0, 0, 0]} />
      </part>
      <mate a={`${name}-pcb.origin`} b={`${name}-parts.origin`} type="fastened" />
    </assembly>
  );
}
