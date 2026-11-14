/**
 * Value formatting and loose value parsing shared by the CLI and the viewer (no DOM, no
 * three.js), so a number, a time or a size reads the same in the terminal and in the browser.
 */

/** A number for display: grouped, at most `digits` decimals (fewer for big values), "-" when missing or not finite. */
export function fmtNum(v: number | undefined, digits = 2): string {
  if (v === undefined || !isFinite(v)) return "-";
  const a = Math.abs(v);
  const d = a >= 1000 ? 0 : a >= 100 ? 1 : digits;
  return v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

/** A duration: `4.2 ms`, `120 ms`, `1.35 s`. */
export function fmtMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** A byte count: `512 B`, `3.4 kB`, `1.2 MB`. */
export function fmtBytes(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`;
}

/** A volume in mm³ (cm³ from 100 000 mm³); "-" when missing. */
export function fmtVol(mm3: number | undefined): string {
  if (mm3 === undefined) return "-";
  return mm3 >= 1e5 ? `${fmtNum(mm3 / 1000)} cm³` : `${fmtNum(mm3)} mm³`;
}

/** An area in mm² (cm² from 10 000 mm²). */
export function fmtArea(mm2: number): string {
  return mm2 >= 1e4 ? `${fmtNum(mm2 / 100)} cm²` : `${fmtNum(mm2)} mm²`;
}

/** A mass in grams (kg from 1000 g). */
export function fmtMass(g: number): string {
  return g >= 1000 ? `${fmtNum(g / 1000)} kg` : `${fmtNum(g)} g`;
}

/**
 * A param value typed from its text when no schema says otherwise (`--param k=v`, a URL hash):
 * `true`/`false`, a number, or the string with one pair of surrounding quotes removed.
 */
export function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !isNaN(Number(raw))) return Number(raw);
  return raw.replace(/^(["'])(.*)\1$/, "$2");
}

/** "2 loops · 3 lines · 3 notes": what a drawing holds (empty kinds left out). */
export function drawingMeta(d: { loops: number; paths?: number; notes?: unknown[] }): string {
  const n = (count: number, one: string, many: string) => (count ? `${count} ${count === 1 ? one : many}` : "");
  return ["drawing", n(d.loops, "loop", "loops"), n(d.paths ?? 0, "line", "lines"), n(d.notes?.length ?? 0, "note", "notes")].filter(Boolean).join(" · ");
}
