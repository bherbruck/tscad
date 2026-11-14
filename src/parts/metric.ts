/**
 * ISO metric fastener data (coarse thread), mm.
 *
 * Sources: clearance holes ISO 273 (fine / medium / coarse series → `close` / `normal` /
 * `loose`); tap drills = nominal − pitch (ISO 2306 practice); socket head cap screws ISO 4762
 * (head diameter dk max, head height k); counterbores DIN 974-1 row for ISO 4762; countersunk
 * socket screws ISO 10642 (M3+, theoretical dk max) and ISO 14581 (M2, M2.5), 90°; hex nuts
 * ISO 4032 (across flats s, height m max); heat-set inserts: common (Ruthex-style) pocket
 * diameter × length.
 */

/** Supported ISO metric sizes. */
export type MetricSize = "M2" | "M2.5" | "M3" | "M4" | "M5" | "M6" | "M8" | "M10" | "M12";
/** Clearance-hole fit: ISO 273 fine (`close`), medium (`normal`), coarse (`loose`). */
export type HoleFit = "close" | "normal" | "loose";

export interface MetricData {
  /** Nominal diameter, mm. */
  d: number;
  /** Coarse thread pitch, mm. */
  pitch: number;
  /** Clearance hole diameters (ISO 273). */
  clearance: Record<HoleFit, number>;
  /** Tap drill diameter for the coarse thread. */
  tapDrill: number;
  /** Socket head cap screw (ISO 4762). */
  socketHead: { diameter: number; height: number };
  /** Counterbore for a socket head cap screw (DIN 974-1): diameter and depth (k + clearance). */
  counterbore: { diameter: number; depth: number };
  /** Countersunk screw head (ISO 10642 / 14581): head diameter and countersink angle. */
  countersunk: { diameter: number; angle: 90 };
  /** Hex nut (ISO 4032): across flats and height. */
  nut: { af: number; height: number };
  /** Heat-set insert pocket: diameter and length (undefined where uncommon). */
  insert?: { diameter: number; length: number };
}

const row = (
  d: number, pitch: number, close: number, normal: number, loose: number, tapDrill: number,
  dk: number, k: number, cbD: number, cbDepth: number, csk: number, af: number, m: number,
  insert?: [number, number],
): MetricData => ({
  d,
  pitch,
  clearance: { close, normal, loose },
  tapDrill,
  socketHead: { diameter: dk, height: k },
  counterbore: { diameter: cbD, depth: cbDepth },
  countersunk: { diameter: csk, angle: 90 },
  nut: { af, height: m },
  ...(insert ? { insert: { diameter: insert[0], length: insert[1] } } : {}),
});

/**
 * ISO metric data by size.
 * @example metric.M3.clearance.normal // 3.4
 * @example metric.M4.tapDrill // 3.3
 */
export const metric: Readonly<Record<MetricSize, MetricData>> = {
  //            d    pitch close normal loose tap   dk   k    cbD  cbDep csk    af   m      insert
  M2: row(2, 0.4, 2.2, 2.4, 2.6, 1.6, 3.8, 2, 4.3, 2.4, 3.8, 4, 1.6, [3.2, 4]),
  "M2.5": row(2.5, 0.45, 2.7, 2.9, 3.1, 2.05, 4.5, 2.5, 5, 2.9, 4.7, 5, 2, [3.6, 5.7]),
  M3: row(3, 0.5, 3.2, 3.4, 3.6, 2.5, 5.5, 3, 6.5, 3.4, 6.72, 5.5, 2.4, [4, 5.7]),
  M4: row(4, 0.7, 4.3, 4.5, 4.8, 3.3, 7, 4, 8, 4.4, 8.96, 7, 3.2, [5.6, 8.1]),
  M5: row(5, 0.8, 5.3, 5.5, 5.8, 4.2, 8.5, 5, 10, 5.4, 11.2, 8, 4.7, [6.4, 9.5]),
  M6: row(6, 1, 6.4, 6.6, 7, 5, 10, 6, 11, 6.4, 13.44, 10, 5.2, [8, 12.7]),
  M8: row(8, 1.25, 8.4, 9, 10, 6.8, 13, 8, 15, 8.6, 17.92, 13, 6.8, [10, 12.7]),
  M10: row(10, 1.5, 10.5, 11, 12, 8.5, 16, 10, 18, 10.6, 22.4, 16, 8.4),
  M12: row(12, 1.75, 13, 13.5, 14.5, 10.2, 18, 12, 20, 12.6, 26.88, 18, 10.8),
};

/** All supported sizes, smallest first. */
export const metricSizes = Object.keys(metric) as MetricSize[];

/** Look up a size, with a helpful error for unknown ones. */
export function metricData(size: MetricSize | (string & {})): MetricData {
  const m = (metric as Record<string, MetricData>)[size];
  if (!m) throw new RangeError(`unknown metric size ${JSON.stringify(size)} (supported: ${metricSizes.join(", ")})`);
  return m;
}
