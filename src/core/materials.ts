/** A material preset: density and a display colour. */
export interface Material {
  /** Display name. */
  name: string;
  /** Density, g/cm³. */
  density: number;
  /** Default display colour. */
  color: string;
}

/** Material presets for `<part material="...">`. Densities in g/cm³. */
export const materials = {
  pla: { name: "PLA", density: 1.24, color: "#f2f2f2" },
  petg: { name: "PETG", density: 1.27, color: "#4aa3df" },
  abs: { name: "ABS", density: 1.04, color: "#e8e4d8" },
  asa: { name: "ASA", density: 1.07, color: "#dcdcdc" },
  tpu: { name: "TPU", density: 1.21, color: "#333333" },
  nylon: { name: "Nylon (PA12)", density: 1.01, color: "#ece8dc" },
  resin: { name: "Resin", density: 1.18, color: "#9aa4ae" },
  aluminum: { name: "Aluminium 6061", density: 2.7, color: "#c0c6cc" },
  steel: { name: "Steel", density: 7.85, color: "#8a9097" },
  stainless: { name: "Stainless 304", density: 8.0, color: "#a8adb3" },
  brass: { name: "Brass", density: 8.5, color: "#c9a644" },
  copper: { name: "Copper", density: 8.96, color: "#c46f3e" },
  titanium: { name: "Titanium", density: 4.43, color: "#8c8c94" },
  wood: { name: "Wood (pine)", density: 0.5, color: "#c49a6c" },
  acrylic: { name: "Acrylic", density: 1.18, color: "#cfe8ff" },
} as const satisfies Record<string, Material>;

export type MaterialName = keyof typeof materials;

/** Mass in grams of `volume` mm³ at `density` g/cm³. */
export function massOf(volumeMm3: number, density: number): number {
  return (volumeMm3 / 1000) * density;
}
