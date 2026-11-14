/**
 * `tscad/drawing`: 2D output for laser cutters, CNC routers and plotters.
 *
 * - Exact: `toDXF` / `toSVG` from `<drawing>` results (`compile(...).drawings`) or any loops.
 * - From solids: `section` / `sectionToSVG` / `sectionToDXF` slice a mesh with a plane.
 *
 * Browser-safe (no Node APIs).
 *
 * @example
 * const { drawings } = compile(<drawing name="gasket"><rect w={50} h={30} /><circle r={8} /></drawing>)
 * await Bun.write("gasket.dxf", toDXF(drawings))
 */
export { toDXF, type DxfOptions } from "./dxf";
export { svgPathData, toSVG, type SvgOptions } from "./svg";
export { planeFrame, section, sectionToDXF, sectionToSVG, type SectionPlane, type SectionResult } from "./section";
export { polylineLoops, type DrawingInput, type Layer } from "./common";
export type { Drawing, DrawingNote, Loop2, Seg2 } from "../core/compile";
