/**
 * 2D import: `<dxf data>` and `<svg data>` shapes. Both return closed loops (mm, y up) plus
 * warnings; an optional `center` moves the result's bounding box centre to the origin.
 */
import type { Loop2 } from "../seg";
import { transformLoop } from "../seg";
import { bbox, ImportError, type ImportResult } from "./common";
import { importDxf as dxf, type DxfOptions } from "./dxf";
import { importSvg as svg, type SvgOptions } from "./svg";

export { ImportError, type ImportResult } from "./common";
export type { DxfOptions } from "./dxf";
export type { SvgOptions } from "./svg";

function centred(r: ImportResult, center: unknown): ImportResult {
  if (!center || !r.loops.length) return r;
  const [x0, y0, x1, y1] = bbox(r.loops);
  const dx = -(x0 + x1) / 2, dy = -(y0 + y1) / 2;
  return { loops: r.loops.map((l: Loop2) => transformLoop(l, [1, 0, 0, 1, dx, dy])), warnings: r.warnings };
}

/** `<dxf>` props → loops. */
export function importDxf(props: Record<string, any>): ImportResult {
  if (typeof props.data !== "string") throw new ImportError("needs data: the DXF file's text (import it with { type: \"text\" })");
  const o: DxfOptions = {};
  if (props.layer !== undefined) o.layer = props.layer;
  if (props.units !== undefined) {
    if (!["mm", "cm", "m", "in", "ft"].includes(props.units)) throw new ImportError(`units must be "mm", "cm", "m", "in" or "ft" (got ${JSON.stringify(props.units)})`);
    o.units = props.units;
  }
  if (props.scale !== undefined) o.scale = Number(props.scale);
  if (props.tolerance !== undefined) o.tolerance = Number(props.tolerance);
  return centred(dxf(props.data, o), props.center);
}

/** `<svg>` props → loops. */
export function importSvg(props: Record<string, any>): ImportResult {
  if (typeof props.data !== "string") throw new ImportError("needs data: the SVG file's text (import it with { type: \"text\" })");
  const o: SvgOptions = {};
  if (props.select !== undefined) o.select = String(props.select);
  if (props.scale !== undefined) o.scale = Number(props.scale);
  if (props.flipY !== undefined) o.flipY = props.flipY !== false;
  return centred(svg(props.data, o), props.center);
}

export { dxf as parseDxf, svg as parseSvg };
