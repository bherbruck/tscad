/**
 * `tscad/check`: design checks — printability (overhangs, wall thickness, bed fit), part
 * interference, watertightness. Browser-safe: meshes in, plain data out (typed arrays for
 * viewer heatmaps).
 */
export { checkPrintability, type OverhangFace, type PrintabilityOptions, type PrintabilityResult } from "./printability";
export { checkInterference, type InterferenceOptions, type InterferencePair, type InterferenceResult } from "./interference";
export { checkWatertight, type WatertightResult } from "./watertight";
export { buildBvh, raycast, type Bvh, type Hit } from "./bvh";
export type { CheckMesh } from "./mesh";
