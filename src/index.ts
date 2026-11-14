/**
 * tscad: CAD as TSX. Parametric solid models as JSX components, compiled to an IR and
 * evaluated by the solidcore B-rep kernel.
 *
 * @example
 * import { defineParams, edges, type ParamValues } from "tscad"
 * export const params = defineParams({ width: { type: "number", default: 40, min: 10, max: 100 } })
 * export default function Plate({ width }: ParamValues<typeof params>) {
 *   return (
 *     <part name="plate" material="pla">
 *       <fillet radius={2} edges={edges.vertical()}>
 *         <extrude height={5}>
 *           <rect w={width} h={30} />
 *           <circle r={5} />
 *         </extrude>
 *       </fillet>
 *     </part>
 *   )
 * }
 */

// elements & components
export {
  createContext, createElement, Fragment, isElement, setSourceCapture, useContext,
  type Child, type Children, type Component, type Context, type Element, type FC, type Key, type TscadElement,
} from "./core/element";
export { TscadError, formatLoc, type SourceLoc } from "./core/errors";

// compile
export { compile, renderModule, type CompileOptions, type CompileResult, type Drawing, type DrawingNote, type Loop2, type PartInfo, type RenderResult, type Seg2, type TscadModule } from "./core/compile";

// params
export {
  coerceParam, defineParams, paramDefaults, paramLabel, resolveParams,
  type BooleanParam, type ChoiceParam, type ColorParam, type IntParam, type NumberParam, type ParamIssue, type ParamSchema,
  type ParamSpec, type ParamValue, type ParamValues, type TextParam,
} from "./core/params";

// selectors
export { edges, faces, parseSelector, Sel, SelectorSyntaxError, toSelector, type SelectorLike, type SelectorString } from "./core/select";

// paths & units & materials
export { arc3, bezier3, helix, line3, path3, polyline3, type Arc3Options, type HelixOptions, type Path3 } from "./core/paths";
export { cm, deg, ft, inch, linspace, meters, mm, rad, range, thou, turn } from "./core/units";
export { massOf, materials, type Material, type MaterialName } from "./core/materials";

// constraint sketches
export type { SketchDimensionInfo, SketchEntityInfo, SketchInfo, SolvedSketch } from "./core/sketch/constrained";
export type * from "./core/sketch/constrained-props";
export { sketchPath, SketchPath } from "./core/sketch/builder";
export {
  applyChange, applyChanges, dragSolve, editProp, insertChild, paramFor,
  type DragChange, type DragRequest, type DragSolveResult, type EditResult, type ParamDrive, type TextEdit,
} from "./core/sketch/drag";
export {
  sketchRef, sketchRefs, isSketchRef,
  type ArcHandle, type CircleHandle, type CurveHandle, type LineHandle, type PointHandle, type RefKind, type RoundHandle, type SketchRef, type SplineHandle,
} from "./core/sketch/refs";

// assemblies: anchors & mates
export {
  anchorRef, assemblyRefs, isAnchorRef,
  type AnchorProps, type AnchorRef, type AssemblyInfo, type Direction, type GearProps, type MateProps, type MateType, type PartRef,
} from "./core/assembly";

// element prop types
export type * from "./core/intrinsics";

// IR
export type { Axis, Curve, Document, Node, Part, Selector } from "./ir";

// text
export { getDefaultFont, layoutText, loadFont, type FontSource, type TextLayout, type TextResult } from "./core/text/font";
