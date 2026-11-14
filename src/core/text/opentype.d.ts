// Minimal types for the parts of opentype.js (MIT) that tscad uses.
declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "Q" | "C" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }
  export interface Glyph {
    index: number;
    name?: string;
    unicode?: number;
    advanceWidth?: number;
    path: { commands: PathCommand[] };
  }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: Record<string, Record<string, string> | undefined>;
    tables: Record<string, any>;
    position: {
      getKerningTables(script: string, language?: string): unknown;
      getKerningValue(tables: unknown, left: number, right: number): number;
    };
    stringToGlyphs(s: string, options?: { features?: { script: string; tags: string[] }[] }): Glyph[];
    charToGlyph(c: string): Glyph;
    getKerningValue(left: Glyph | number, right: Glyph | number): number;
  }
  export function parse(buffer: ArrayBuffer, options?: { lowMemory?: boolean }): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
