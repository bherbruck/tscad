/**
 * Exporters: STL, 3MF, GLB and OBJ from kernel meshes, STEP straight from the kernel.
 * Pure TypeScript (plus fflate for the 3MF zip), so it runs in bun and the browser alike.
 */
import type { KernelHost } from "../kernel";
import { toGLB } from "./glb";
import type { ExportPart } from "./mesh";
import { toOBJ } from "./obj";
import { toSTL } from "./stl";
import { to3MF } from "./threemf";

export { toSTL, to3MF, toGLB, toOBJ };
export type { ExportPart };

export type ExportFormat = "stl" | "3mf" | "glb" | "obj" | "step";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["stl", "3mf", "glb", "obj", "step"];

/** MIME type of each format. */
export const MIME_TYPES: Record<ExportFormat, string> = {
  stl: "model/stl",
  "3mf": "model/3mf",
  glb: "model/gltf-binary",
  obj: "model/obj",
  step: "model/step",
};

/** Default chord tolerance (mm) of export meshes. */
export const DEFAULT_EXPORT_TOLERANCE = 0.01;

/**
 * Export evaluated parts of `kernel` (call `kernel.evaluate` first). Mesh formats re-mesh each part
 * at `tolerance` mm (default 0.01); STEP is the kernel's exact B-rep (AP242 text).
 * Returns bytes for stl/3mf/glb and a string for obj/step.
 */
export async function exportModel(
  kernel: KernelHost,
  parts: { name: string; color?: string }[],
  format: ExportFormat,
  opts: { tolerance?: number; binary?: boolean } = {},
): Promise<Uint8Array | string> {
  if (format === "step") return kernel.step(parts.map((p) => p.name));
  const tolerance = opts.tolerance ?? DEFAULT_EXPORT_TOLERANCE;
  const meshed: ExportPart[] = [];
  for (const p of parts) meshed.push({ name: p.name, color: p.color, mesh: await kernel.meshAt(p.name, tolerance) });
  switch (format) {
    case "stl":
      return toSTL(meshed, { binary: opts.binary });
    case "3mf":
      return to3MF(meshed);
    case "glb":
      return toGLB(meshed);
    case "obj":
      return toOBJ(meshed);
    default:
      throw new Error(`unknown export format: ${format satisfies never}`);
  }
}
