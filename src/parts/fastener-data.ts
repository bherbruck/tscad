/**
 * Dimension tables for standard fasteners and mechanical parts, mm. Values are the nominal or
 * maximum figures of the cited standards, rounded as catalogues print them; they model parts
 * for fit and clearance, not for inspection.
 *
 * Sources: socket head cap screws ISO 4762 (socket s, depth t); hex head screws ISO 4017 (s, k);
 * button head ISO 7380-1 (dk, k, s); countersunk ISO 10642 / ISO 14581 (s); pan head ISO 7045
 * (dk, k); prevailing-torque (nyloc) nuts ISO 10511 (h); plain washers ISO 7089 (d1, d2, h);
 * spring washers DIN 127 B (d1, d2, s); set screws ISO 4026 (s, t); deep-groove ball bearings
 * ISO 15 (d × D × B); dowel pins ISO 8734; shaft collars: common catalogue sizes.
 * Where a standard has no M2/M2.5 row (ISO 7380, ISO 7045 M12), the value follows the series
 * and is marked "series" below.
 */
import type { MetricSize } from "./metric";

/** Head styles of {@link Bolt}. */
export type BoltHead = "socket" | "hex" | "button" | "flat" | "pan";

export interface HeadData {
  /** Head diameter (round heads) or across flats (hex), mm. */
  dk: number;
  /** Head height, mm (countersunk: the cone's height). */
  k: number;
  /** Hex socket across flats, mm (0 = no socket: hex and pan heads). */
  s: number;
  /** Socket depth, mm. */
  t: number;
}

const H = (dk: number, k: number, s: number, t: number): HeadData => ({ dk, k, s, t });

/** Head dimensions by style and size. */
export const boltHeads: Readonly<Record<BoltHead, Readonly<Record<MetricSize, HeadData>>>> = {
  // ISO 4762: dk, k, s, t
  socket: {
    M2: H(3.8, 2, 1.5, 1), "M2.5": H(4.5, 2.5, 2, 1.1), M3: H(5.5, 3, 2.5, 1.3), M4: H(7, 4, 3, 2),
    M5: H(8.5, 5, 4, 2.5), M6: H(10, 6, 5, 3), M8: H(13, 8, 6, 4), M10: H(16, 10, 8, 5), M12: H(18, 12, 10, 6),
  },
  // ISO 4017: s (across flats) as dk, k; no socket
  hex: {
    M2: H(4, 1.4, 0, 0), "M2.5": H(5, 1.7, 0, 0), M3: H(5.5, 2, 0, 0), M4: H(7, 2.8, 0, 0),
    M5: H(8, 3.5, 0, 0), M6: H(10, 4, 0, 0), M8: H(13, 5.3, 0, 0), M10: H(16, 6.4, 0, 0), M12: H(18, 7.5, 0, 0),
  },
  // ISO 7380-1: dk, k, s, t (M2, M2.5: series)
  button: {
    M2: H(3.5, 1.3, 1.3, 0.7), "M2.5": H(4.7, 1.5, 1.5, 0.8), M3: H(5.7, 1.65, 2, 1.04), M4: H(7.6, 2.2, 2.5, 1.3),
    M5: H(9.5, 2.75, 3, 1.56), M6: H(10.5, 3.3, 4, 2.08), M8: H(14, 4.4, 5, 2.6), M10: H(17.5, 5.5, 6, 3.12), M12: H(21, 6.6, 8, 4.16),
  },
  // ISO 10642 / 14581, 90°: dk (theoretical), k = (dk − d) / 2, s, t
  flat: {
    M2: H(3.8, 0.9, 1.3, 0.8), "M2.5": H(4.7, 1.1, 1.5, 0.9), M3: H(6.72, 1.86, 2, 1.1), M4: H(8.96, 2.48, 2.5, 1.5),
    M5: H(11.2, 3.1, 3, 1.9), M6: H(13.44, 3.72, 4, 2.2), M8: H(17.92, 4.96, 5, 3), M10: H(22.4, 6.2, 6, 3.6), M12: H(26.88, 7.44, 8, 4.3),
  },
  // ISO 7045: dk, k; cross recess modelled as a plain slot-free head (M12: series)
  pan: {
    M2: H(4, 1.6, 0, 0), "M2.5": H(5, 1.75, 0, 0), M3: H(5.6, 2.1, 0, 0), M4: H(8, 2.4, 0, 0),
    M5: H(9.5, 3, 0, 0), M6: H(12, 3.6, 0, 0), M8: H(16, 4.8, 0, 0), M10: H(20, 6, 0, 0), M12: H(24, 7.2, 0, 0),
  },
};

/** Prevailing-torque (nyloc) nut overall height, ISO 10511 (M2, M2.5: DIN 985). */
export const nylocHeight: Readonly<Record<MetricSize, number>> = {
  M2: 2.8, "M2.5": 3.1, M3: 4, M4: 5, M5: 5, M6: 6, M8: 8, M10: 10, M12: 12,
};

export interface WasherData {
  /** Inner diameter. */
  d1: number;
  /** Outer diameter. */
  d2: number;
  /** Thickness. */
  h: number;
}
const W = (d1: number, d2: number, h: number): WasherData => ({ d1, d2, h });

/** Plain washers, ISO 7089. */
export const flatWashers: Readonly<Record<MetricSize, WasherData>> = {
  M2: W(2.2, 5, 0.3), "M2.5": W(2.7, 6, 0.5), M3: W(3.2, 7, 0.5), M4: W(4.3, 9, 0.8), M5: W(5.3, 10, 1),
  M6: W(6.4, 12, 1.6), M8: W(8.4, 16, 1.6), M10: W(10.5, 20, 2), M12: W(13, 24, 2.5),
};

/** Spring (split lock) washers, DIN 127 B: d1, d2, section thickness s as h. */
export const springWashers: Readonly<Record<MetricSize, WasherData>> = {
  M2: W(2.1, 4.4, 0.5), "M2.5": W(2.6, 5.1, 0.6), M3: W(3.1, 6.2, 0.8), M4: W(4.1, 7.6, 0.9), M5: W(5.1, 9.2, 1.2),
  M6: W(6.1, 11.8, 1.6), M8: W(8.2, 14.8, 2), M10: W(10.2, 18.1, 2.2), M12: W(12.2, 21.1, 2.5),
};

/** Set screw hex socket, ISO 4026: across flats s and socket depth t. */
export const setScrewSockets: Readonly<Record<MetricSize, { s: number; t: number }>> = {
  M2: { s: 0.9, t: 0.8 }, "M2.5": { s: 1.3, t: 1.2 }, M3: { s: 1.5, t: 1.2 }, M4: { s: 2, t: 1.5 }, M5: { s: 2.5, t: 2 },
  M6: { s: 3, t: 2 }, M8: { s: 4, t: 3 }, M10: { s: 5, t: 4 }, M12: { s: 6, t: 4.8 },
};

/** A deep-groove ball bearing: bore d, outside diameter D, width B. */
export interface BearingData {
  d: number;
  D: number;
  B: number;
}

/** Deep-groove ball bearings by designation (ISO 15). */
export const bearings = {
  MR63: { d: 3, D: 6, B: 2.5 },
  MR85: { d: 5, D: 8, B: 2.5 },
  MR105: { d: 5, D: 10, B: 4 },
  "623": { d: 3, D: 10, B: 4 },
  "624": { d: 4, D: 13, B: 5 },
  "625": { d: 5, D: 16, B: 5 },
  "626": { d: 6, D: 19, B: 6 },
  "627": { d: 7, D: 22, B: 7 },
  "608": { d: 8, D: 22, B: 7 },
  "609": { d: 9, D: 24, B: 7 },
  "688": { d: 8, D: 16, B: 5 },
  "6000": { d: 10, D: 26, B: 8 },
  "6001": { d: 12, D: 28, B: 8 },
  "6002": { d: 15, D: 32, B: 9 },
  "6200": { d: 10, D: 30, B: 9 },
  "6201": { d: 12, D: 32, B: 10 },
  "6202": { d: 15, D: 35, B: 11 },
  "6203": { d: 17, D: 40, B: 12 },
  "6204": { d: 20, D: 47, B: 14 },
} as const satisfies Record<string, BearingData>;
export type BearingDesignation = keyof typeof bearings;

/** Shaft collars by bore: outside diameter, width and the set screw's size. */
export const shaftCollars = {
  3: { D: 8, w: 5, screw: "M2.5" },
  4: { D: 10, w: 6, screw: "M3" },
  5: { D: 10, w: 7, screw: "M3" },
  6: { D: 12, w: 8, screw: "M3" },
  8: { D: 16, w: 8, screw: "M4" },
  10: { D: 20, w: 10, screw: "M5" },
  12: { D: 25, w: 12, screw: "M6" },
} as const satisfies Record<number, { D: number; w: number; screw: MetricSize }>;
export type CollarBore = keyof typeof shaftCollars;
