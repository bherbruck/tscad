/**
 * Board definitions: PCB outline, mounting holes and connectors, in the board's own frame.
 *
 * **Frame:** x along the board's length and y along its width, both from the PCB's lower-left
 * corner. z = 0 is the underside of the PCB, so the top surface is at z = `thickness`.
 *
 * **Sources.** Each board says which numbers come from the maker's official mechanical
 * drawing and which are approximations (measured from photos or typical part sizes):
 * - **`official`:** taken from the published drawing.
 * - **`approx`:** good to roughly ±0.5 mm. Fine for clearance cut-outs, but check against
 *   your own board before making a tight fit.
 */
import type { MetricSize } from "../metric";

/** Which way a connector's opening faces (where its cable plugs in from). */
export type Facing = "-x" | "+x" | "-y" | "+y" | "+z" | "-z";

export type ConnectorType =
  | "usb-c" | "micro-usb" | "usb-a" | "usb-a-stack" | "usb-b" | "micro-hdmi" | "mini-hdmi" | "ethernet"
  | "audio" | "barrel" | "header" | "microsd" | "fpc" | "button" | "led";

export interface Connector {
  /** Unique id, used for anchors and `ports={[...]}`. */
  id: string;
  type: ConnectorType;
  /** Plan footprint `[x0, y0, x1, y1]` in the board frame (it may overhang the PCB edge). */
  rect: [number, number, number, number];
  /** Bottom of the body relative to the PCB's top surface (negative: under the board). */
  z: number;
  /** Body height, mm. */
  height: number;
  /** The side a plug comes in from. */
  facing: Facing;
  /** Extra opening around the body for the plug's overmould, mm. Default: by type. */
  clearance?: number;
  /** Where the numbers come from. */
  source: "official" | "approx";
}

export interface BoardDef {
  name: string;
  /** PCB size `[x, y]`, mm. */
  size: [number, number];
  /** PCB corner radius, mm. */
  cornerRadius: number;
  /** PCB thickness, mm. */
  thickness: number;
  /** Mounting holes: centre `[x, y]` and diameter. */
  holes: { at: [number, number]; d: number }[];
  /** The screws the holes take. */
  screw?: MetricSize;
  connectors: Connector[];
  /** Tallest part under the board (pins, solder, microSD), mm below the underside. */
  underside: number;
  /** PCB colour. */
  color: string;
  /** What's official and what's approximate. */
  sources: string;
}

/** Plug overmoulds are bigger than the sockets: extra opening per side, by connector type. */
export const PLUG_CLEARANCE: Record<ConnectorType, number> = {
  "usb-c": 1.5, "micro-usb": 1.5, "usb-a": 0.8, "usb-a-stack": 0.8, "usb-b": 0.8, "micro-hdmi": 1.8, "mini-hdmi": 1.8,
  ethernet: 0.8, audio: 1.5, barrel: 1.5, header: 0.8, microsd: 1, fpc: 1, button: 0.6, led: 0.5,
};

/** A connector centred at `(cx, cy)` with plan size `w × d` (x × y). */
function c(id: string, type: ConnectorType, cx: number, cy: number, w: number, d: number, z: number, height: number, facing: Facing, source: "official" | "approx"): Connector {
  return { id, type, rect: [cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2], z, height, facing, source };
}

const piHoles = (y2: number) => [
  { at: [3.5, 3.5] as [number, number], d: 2.7 },
  { at: [61.5, 3.5] as [number, number], d: 2.7 },
  { at: [61.5, y2] as [number, number], d: 2.7 },
  { at: [3.5, y2] as [number, number], d: 2.7 },
];

/** Raspberry Pi 4 Model B. */
const raspberryPi4: BoardDef = {
  name: "Raspberry Pi 4 Model B",
  size: [85, 56],
  cornerRadius: 3,
  thickness: 1.4,
  holes: piHoles(52.5),
  screw: "M2.5",
  underside: 2,
  color: "#1f7a3f",
  sources:
    "Official (Raspberry Pi 4 mechanical drawing): the 85 × 56 mm outline, the R3 corners, the holes, the x positions of USB-C (11.2), micro-HDMI (26.0, 39.5) and audio (53.5), and the y positions of the USB 3 (9.0), USB 2 (27.0) and Ethernet (45.75) jacks. Approximate: body sizes and heights, overhangs, PCB thickness (1.4), GPIO and microSD positions.",
  connectors: [
    c("usbc", "usb-c", 11.2, 2.5, 9, 7.4, 0, 3.2, "-y", "official"),
    c("hdmi0", "micro-hdmi", 26, 2.25, 7.5, 7.5, 0, 3.5, "-y", "official"),
    c("hdmi1", "micro-hdmi", 39.5, 2.25, 7.5, 7.5, 0, 3.5, "-y", "official"),
    c("audio", "audio", 53.5, 3.5, 7, 12, 0, 6, "-y", "official"),
    c("usb3", "usb-a-stack", 78.35, 9, 17.5, 13.2, 0, 16, "+x", "official"),
    c("usb2", "usb-a-stack", 78.35, 27, 17.5, 13.2, 0, 16, "+x", "official"),
    c("ethernet", "ethernet", 76.35, 45.75, 21.5, 16, 0, 13.6, "+x", "official"),
    c("gpio", "header", 32.5, 52.5, 51, 5.1, 0, 8.6, "+z", "approx"),
    c("microsd", "microsd", 5.5, 28, 15, 11.5, -1.4 - 1.5, 1.5, "-x", "approx"),
  ],
};

/** Raspberry Pi 5. */
const raspberryPi5: BoardDef = {
  name: "Raspberry Pi 5",
  size: [85, 56],
  cornerRadius: 3,
  thickness: 1.4,
  holes: piHoles(52.5),
  screw: "M2.5",
  underside: 2,
  color: "#1f7a3f",
  sources:
    "Official (Raspberry Pi 5 mechanical drawing): the 85 × 56 mm outline, the holes, and the x positions of USB-C (11.2) and micro-HDMI (25.8, 39.2). Approximate: the right-edge jack positions (Ethernet ≈ 10.2, USB ≈ 29.1 and 47.0: the Pi 5 swapped Ethernet and USB relative to the Pi 4), body sizes and heights, overhangs, PCB thickness, GPIO, power button and microSD.",
  connectors: [
    c("usbc", "usb-c", 11.2, 2.5, 9, 7.4, 0, 3.2, "-y", "official"),
    c("hdmi0", "micro-hdmi", 25.8, 2.25, 7.5, 7.5, 0, 3.5, "-y", "official"),
    c("hdmi1", "micro-hdmi", 39.2, 2.25, 7.5, 7.5, 0, 3.5, "-y", "official"),
    c("ethernet", "ethernet", 76.35, 10.2, 21.5, 16, 0, 13.6, "+x", "approx"),
    c("usb3", "usb-a-stack", 78.35, 29.1, 17.5, 13.2, 0, 16, "+x", "approx"),
    c("usb2", "usb-a-stack", 78.35, 47, 17.5, 13.2, 0, 16, "+x", "approx"),
    c("gpio", "header", 32.5, 52.5, 51, 5.1, 0, 8.6, "+z", "approx"),
    c("power", "button", 1.5, 47, 4, 3, 0, 2.5, "-x", "approx"),
    c("microsd", "microsd", 5.5, 28, 15, 11.5, -1.4 - 1.5, 1.5, "-x", "approx"),
  ],
};

/** Raspberry Pi Zero 2 W. */
const raspberryPiZero2W: BoardDef = {
  name: "Raspberry Pi Zero 2 W",
  size: [65, 30],
  cornerRadius: 3,
  thickness: 1.0,
  holes: [
    { at: [3.5, 3.5], d: 2.75 },
    { at: [61.5, 3.5], d: 2.75 },
    { at: [61.5, 26.5], d: 2.75 },
    { at: [3.5, 26.5], d: 2.75 },
  ],
  screw: "M2.5",
  underside: 1.5,
  color: "#1f7a3f",
  sources:
    "Official (Raspberry Pi Zero 2 W mechanical drawing): the 65 × 30 mm outline, the holes, and the x positions of mini-HDMI (12.4), USB (41.4) and power (54.0). Approximate: body sizes, heights and overhangs, the camera FPC, the microSD, and the (unpopulated) GPIO header.",
  connectors: [
    c("hdmi", "mini-hdmi", 12.4, 3.4, 11.2, 7.6, 0, 3.3, "-y", "official"),
    c("usb", "micro-usb", 41.4, 2.3, 8, 5.6, 0, 2.6, "-y", "official"),
    c("power", "micro-usb", 54, 2.3, 8, 5.6, 0, 2.6, "-y", "official"),
    c("camera", "fpc", 63, 15, 4, 17, 0, 1.3, "+x", "approx"),
    c("microsd", "microsd", 6, 16.9, 13, 11.5, -1 - 1.4, 1.4, "-x", "approx"),
  ],
};

/** Arduino Uno R3. */
const arduinoUno: BoardDef = {
  name: "Arduino Uno R3",
  size: [68.58, 53.34],
  cornerRadius: 0.5,
  thickness: 1.6,
  holes: [
    { at: [13.97, 2.54], d: 3.2 },
    { at: [15.24, 50.8], d: 3.2 },
    { at: [66.04, 7.62], d: 3.2 },
    { at: [66.04, 35.56], d: 3.2 },
  ],
  screw: "M3",
  underside: 2.5,
  color: "#0f6fa8",
  sources:
    "Official (Arduino Uno R3 drawing): the 68.58 × 53.34 mm outline and the holes. Approximate: the USB-B (y 32.4–44.4, protruding 6.35) and barrel-jack (y 3.3–12.2) positions and sizes, header positions and heights.",
  connectors: [
    { id: "usb", type: "usb-b", rect: [-6.35, 32.4, 9.9, 44.4], z: 0, height: 10.9, facing: "-x", source: "approx" },
    { id: "power", type: "barrel", rect: [-1.8, 3.3, 12.4, 12.2], z: 0, height: 11, facing: "-x", source: "approx" },
    c("digital", "header", 46.3, 50.8, 42, 2.54, 0, 8.5, "+z", "approx"),
    c("analog", "header", 52.6, 2.54, 34, 2.54, 0, 8.5, "+z", "approx"),
  ],
};

/** Espressif ESP32-DevKitC V4 (no mounting holes). */
const esp32DevKitC: BoardDef = {
  name: "ESP32-DevKitC V4",
  size: [54.4, 27.9],
  cornerRadius: 0.5,
  thickness: 1.6,
  holes: [],
  underside: 8.5, // the pin headers point down
  color: "#1a1a1a",
  sources:
    "Approximate throughout (Espressif publishes a 2.54 mm pin pitch and the 54.4 × 27.9 mm outline but no full mechanical drawing): micro-USB centred on the short edge, the pin rows 1.27 mm in from the long edges, pointing down 8.5 mm. No mounting holes: cases support it on ledges.",
  connectors: [
    c("usb", "micro-usb", 2.3, 13.95, 5.6, 8, 0, 2.6, "-x", "approx"),
    c("boot", "button", 7, 4, 3.5, 3.5, 0, 1.8, "+z", "approx"),
    c("en", "button", 7, 23.9, 3.5, 3.5, 0, 1.8, "+z", "approx"),
    c("pinsA", "header", 27.2, 1.27, 48.3, 2.54, -1.6 - 8.5, 8.5, "-z", "approx"),
    c("pinsB", "header", 27.2, 26.63, 48.3, 2.54, -1.6 - 8.5, 8.5, "-z", "approx"),
  ],
};

/** Raspberry Pi Pico. */
const pico: BoardDef = {
  name: "Raspberry Pi Pico",
  size: [51, 21],
  cornerRadius: 1,
  thickness: 1.0,
  holes: [
    { at: [2, 4.8], d: 2.1 },
    { at: [2, 16.2], d: 2.1 },
    { at: [49, 4.8], d: 2.1 },
    { at: [49, 16.2], d: 2.1 },
  ],
  screw: "M2",
  underside: 0.5,
  color: "#1f7a3f",
  sources:
    "Official (Raspberry Pi Pico datasheet): the 51 × 21 × 1 mm board and the holes (2 mm from the short edges, 11.4 mm apart, Ø2.1). Approximate: the micro-USB body (centred on the short edge, overhanging 1.3 mm) and the BOOTSEL button.",
  connectors: [
    c("usb", "micro-usb", 1.5, 10.5, 5.6, 8, 0, 2.6, "-x", "approx"),
    c("bootsel", "button", 12, 15, 3.5, 4.5, 0, 1.6, "+z", "approx"),
  ],
};

/** Board definitions for `<Board>` and `<BoardCase>`. */
export const boards = { raspberryPi5, raspberryPi4, raspberryPiZero2W, arduinoUno, esp32DevKitC, pico } as const satisfies Record<string, BoardDef>;
export type BoardName = keyof typeof boards;

/** The top of the tallest part above the board, from the PCB underside. */
export function boardTop(b: BoardDef): number {
  return b.thickness + Math.max(0, ...b.connectors.filter((c) => c.z >= 0).map((c) => c.z + c.height));
}
