/**
 * Mouse schemes for the viewport camera. The default is the CAD one: right-drag orbits,
 * middle-drag pans, the wheel zooms toward the cursor, and the left button is left free for
 * picking, sketch points, joint gizmos and measuring. "classic" is the three.js default
 * (left orbits, right pans). Touch: one finger orbits, two fingers pinch-zoom and pan.
 */
import { MOUSE, TOUCH } from "three";

/** A camera mouse scheme. */
export type MouseScheme = "cad" | "classic";

/** The schemes, for the settings control. */
export const MOUSE_SCHEMES: { id: MouseScheme; label: string; hint: string }[] = [
  { id: "cad", label: "CAD", hint: "Right-drag orbits, middle-drag pans, left button selects" },
  { id: "classic", label: "Classic", hint: "Left-drag orbits, right-drag pans" },
];

/** OrbitControls button mapping (`null`: the button doesn't move the camera). */
export interface ButtonMap {
  LEFT: MOUSE | null;
  MIDDLE: MOUSE | null;
  RIGHT: MOUSE | null;
}

/** The OrbitControls `mouseButtons` for a scheme. */
export function mouseButtonsFor(scheme: MouseScheme): ButtonMap {
  return scheme === "classic" ? { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN } : { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
}

/** The OrbitControls `touches` (the same for both schemes). */
export const TOUCH_MAP = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN } as const;

/** The help line for a scheme. */
export function mouseHelp(scheme: MouseScheme): string {
  return scheme === "classic" ? "Drag to orbit · right-drag to pan · scroll to zoom" : "Right-drag to orbit · middle-drag to pan · scroll to zoom";
}

const KEY = "tscad.mouse";

/** The remembered scheme (default "cad"); storage may be unavailable. */
export function loadMouseScheme(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): MouseScheme {
  try {
    return storage?.getItem(KEY) === "classic" ? "classic" : "cad";
  } catch {
    return "cad";
  }
}

/** Remember the scheme. */
export function saveMouseScheme(scheme: MouseScheme, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, scheme);
  } catch {
    /* private mode */
  }
}
