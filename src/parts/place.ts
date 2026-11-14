import type { Placement } from "../core/intrinsics";

const KEYS = ["x", "y", "z", "at", "rotate", "rotateX", "rotateY", "rotateZ", "scale", "mirror"] as const;

/** The placement props of `props` (to spread onto a wrapping `<group>`). */
export function placement(props: Placement): Placement {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) if (props[k] !== undefined) out[k] = props[k];
  return out as Placement;
}

export function positive(component: string, name: string, v: number | undefined): void {
  if (v !== undefined && !(typeof v === "number" && v > 0 && Number.isFinite(v))) {
    throw new RangeError(`<${component}> ${name} must be a number greater than 0 (got ${String(v)})`);
  }
}
