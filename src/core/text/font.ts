/**
 * Text → 2D loops: font loading (opentype.js), layout (kerning, ligatures, alignment, lines),
 * and glyph outlines → sketch segments (TrueType quadratics / CFF cubics as NURBS).
 */
import { parse as parseFont, type Font, type Glyph, type PathCommand } from "opentype.js";
import type { Vec2 } from "../math";
import { line, type Loop2, type Seg2 } from "../sketch/seg";
import { DEFAULT_FONT_BASE64 } from "./default-font";

/** A font for `<text font={...}>`: the bytes of a TTF/OTF/WOFF file, or a parsed font. */
export type FontSource = ArrayBuffer | Uint8Array | Font;

let defaultFont: Font | undefined;
const parsed = new WeakMap<object, Font>();

/** The built-in font (DejaVu Sans, Latin + Greek + common symbols). */
export function getDefaultFont(): Font {
  if (!defaultFont) {
    const bin = atob(DEFAULT_FONT_BASE64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    defaultFont = parseFont(bytes.buffer);
  }
  return defaultFont;
}

/** Parse (and cache) a font from its bytes. */
export function loadFont(src: FontSource | undefined): Font {
  if (src === undefined) return getDefaultFont();
  if (isFont(src)) return src;
  const key = src instanceof Uint8Array ? src.buffer : src;
  let f = parsed.get(key);
  if (!f) {
    const buf = src instanceof Uint8Array ? (src.buffer as ArrayBuffer).slice(src.byteOffset, src.byteOffset + src.byteLength) : src;
    f = parseFont(buf);
    parsed.set(key, f);
  }
  return f;
}

function isFont(x: unknown): x is Font {
  return typeof x === "object" && x !== null && typeof (x as Font).stringToGlyphs === "function";
}

/** Layout options for {@link layoutText} (the `<text>` props, resolved). */
export interface TextLayout {
  /** Em size, mm (the font size; capitals are ~0.73 × this in the default font). */
  size: number;
  align: "left" | "center" | "right";
  valign: "baseline" | "top" | "middle" | "bottom";
  /** Advance multiplier (1 = the font's spacing). */
  spacing: number;
  /** Line pitch as a multiple of `size`. */
  lineHeight: number;
  kerning: boolean;
  ligatures: boolean;
}

/** Glyph outline in font units: contours of segments (cached per font + glyph). */
const outlines = new WeakMap<Font, Map<number, Loop2[]>>();

function glyphContours(font: Font, g: Glyph): Loop2[] {
  let m = outlines.get(font);
  if (!m) outlines.set(font, (m = new Map()));
  let c = m.get(g.index);
  if (!c) m.set(g.index, (c = contours(g.path.commands)));
  return c;
}

/** Path commands → closed contours (degenerate pieces dropped). */
export function contours(cmds: PathCommand[]): Loop2[] {
  const out: Loop2[] = [];
  let cur: Seg2[] = [];
  let start: Vec2 = [0, 0];
  let p: Vec2 = [0, 0];
  const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const close = () => {
    if (!cur.length) return;
    if (!same(p, start)) cur.push(line(p, start));
    if (cur.length >= 2 || (cur.length === 1 && cur[0]!.kind !== "line")) out.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    switch (c.type) {
      case "M":
        close();
        p = start = [c.x!, c.y!];
        break;
      case "L": {
        const q: Vec2 = [c.x!, c.y!];
        if (!same(p, q)) cur.push(line(p, q));
        p = q;
        break;
      }
      case "Q": {
        const k: Vec2 = [c.x1!, c.y1!], q: Vec2 = [c.x!, c.y!];
        if (same(p, q)) break;
        if (same(k, p) || same(k, q) || collinear(p, k, q)) cur.push(line(p, q));
        else cur.push({ kind: "nurbs", degree: 2, pts: [[p[0], p[1], 1], [k[0], k[1], 1], [q[0], q[1], 1]], knots: [0, 0, 0, 1, 1, 1] });
        p = q;
        break;
      }
      case "C": {
        const k1: Vec2 = [c.x1!, c.y1!], k2: Vec2 = [c.x2!, c.y2!], q: Vec2 = [c.x!, c.y!];
        if (same(p, q) && same(k1, p) && same(k2, q)) break;
        if (collinear(p, k1, q) && collinear(p, k2, q)) cur.push(line(p, q));
        else cur.push({ kind: "nurbs", degree: 3, pts: [[p[0], p[1], 1], [k1[0], k1[1], 1], [k2[0], k2[1], 1], [q[0], q[1], 1]], knots: [0, 0, 0, 0, 1, 1, 1, 1] });
        p = q;
        break;
      }
      case "Z":
        close();
        p = start;
        break;
    }
  }
  close();
  return out;
}

function collinear(a: Vec2, k: Vec2, b: Vec2): boolean {
  const cross = (k[0] - a[0]) * (b[1] - a[1]) - (k[1] - a[1]) * (b[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // control point within the segment's span and (almost) on it
  if (Math.abs(cross) > 1e-9 * Math.max(1, len * len)) return false;
  const t = ((k[0] - a[0]) * (b[0] - a[0]) + (k[1] - a[1]) * (b[1] - a[1])) / (len * len || 1);
  return t >= -1e-9 && t <= 1 + 1e-9;
}

function scaleLoop(loop: Loop2, s: number, dx: number, dy: number): Loop2 {
  const P = (p: Vec2): Vec2 => [p[0] * s + dx, p[1] * s + dy];
  return loop.map((g): Seg2 => {
    switch (g.kind) {
      case "line":
        return line(P(g.a), P(g.b));
      case "arc":
        return { ...g, c: P(g.c), r: g.r * s };
      case "nurbs":
        return { ...g, pts: g.pts.map(([x, y, w]) => [x * s + dx, y * s + dy, w] as [number, number, number]) };
    }
  });
}

/** Laid-out text: outline loops in mm plus what couldn't be drawn. */
export interface TextResult {
  loops: Loop2[];
  /** Characters the font has no glyph for. */
  missing: string[];
  /** Laid-out extent, mm: [minX, minY, maxX, maxY] of the advance boxes. */
  bounds: [number, number, number, number];
}

/** Lay out `text` (newlines break lines) and return its outline loops in mm. */
export function layoutText(text: string, font: Font, o: TextLayout): TextResult {
  const s = o.size / font.unitsPerEm;
  const features = o.ligatures ? [{ script: "latn", tags: ["liga", "rlig"] }] : [];
  let kern: unknown;
  if (o.kerning) {
    try {
      kern = font.position.getKerningTables("latn") ?? font.position.getKerningTables("DFLT");
    } catch {
      kern = undefined;
    }
  }
  const kernValue = (a: Glyph, b: Glyph): number => {
    if (!o.kerning) return 0;
    try {
      return kern ? font.position.getKerningValue(kern, a.index, b.index) : font.getKerningValue(a, b);
    } catch {
      return 0;
    }
  };
  const lines = text.split(/\r?\n/);
  const missing = new Set<string>();
  const laid = lines.map((ln) => {
    const glyphs = ln.length ? font.stringToGlyphs(ln, { features }) : [];
    const placed: { g: Glyph; x: number }[] = [];
    let x = 0;
    for (const ch of ln) if (ch.trim() && font.charToGlyph(ch).index === 0) missing.add(ch);
    glyphs.forEach((g, i) => {
      if (g.index !== 0) placed.push({ g, x });
      x += (g.advanceWidth ?? 0) * o.spacing;
      const next = glyphs[i + 1];
      if (next) x += kernValue(g, next);
    });
    return { placed, width: x };
  });
  const capHeight = capHeightOf(font);
  const pitch = (o.lineHeight * o.size) / s; // in font units
  const n = lines.length;
  // y of the first baseline (font units), so the block lands per valign
  let y0 = 0;
  if (o.valign === "top") y0 = -font.ascender;
  else if (o.valign === "bottom") y0 = (n - 1) * pitch - font.descender;
  else if (o.valign === "middle") y0 = ((n - 1) * pitch - capHeight) / 2;
  const loops: Loop2[] = [];
  let minX = Infinity, maxX = -Infinity;
  laid.forEach(({ placed, width }, li) => {
    const off = o.align === "center" ? -width / 2 : o.align === "right" ? -width : 0;
    minX = Math.min(minX, off);
    maxX = Math.max(maxX, off + width);
    const y = y0 - li * pitch;
    for (const { g, x } of placed) for (const c of glyphContours(font, g)) loops.push(scaleLoop(c, s, (x + off) * s, y * s));
  });
  const top = (y0 + font.ascender) * s, bottom = (y0 - (n - 1) * pitch + font.descender) * s;
  return { loops, missing: [...missing], bounds: [minX * s, bottom, maxX * s, top] };
}

/** Cap height in font units: OS/2 sCapHeight, else the height of "H", else 0.7 em. */
function capHeightOf(font: Font): number {
  const os2 = font.tables.os2?.sCapHeight;
  if (os2) return os2;
  const H = font.charToGlyph("H");
  const ys = H.index ? H.path.commands.flatMap((c) => (c.y !== undefined ? [c.y] : [])) : [];
  return ys.length ? Math.max(...ys) : font.unitsPerEm * 0.7;
}
