/**
 * The element reference, generated from the TSDoc in `src/core/intrinsics.ts` (intrinsic
 * elements) and `src/parts/*.tsx` (the parts library), so it never drifts from the types.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mountPatterns } from "../parts/patterns";
import { boards } from "../parts/boards/data";

/** One documented prop. */
export interface Member {
  name: string;
  optional: boolean;
  type: string;
  doc: string;
}
interface Iface {
  name: string;
  doc: string;
  extends: string[];
  members: Member[];
}

/** Collapse a `/** ... *\/` block to one paragraph-ish string (keeps @example lines). */
function cleanDoc(raw: string): string {
  return raw
    .replace(/^\/\*\*|\*\/$/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trimEnd())
    .join("\n")
    .trim()
    .replace(/\n(?!@)(?!\s*-)/g, " ")
    .replace(/ {2,}/g, " ");
}

/** Parse `export interface` blocks and top-level docs of a TS source. */
export function parseInterfaces(src: string): { ifaces: Map<string, Iface>; fnDocs: Map<string, string> } {
  const ifaces = new Map<string, Iface>();
  const fnDocs = new Map<string, string>();
  const re = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?export (?:declare )?(interface|function) (\w+)(?:<[^>]*>)?(?: extends ([^{]+))?\s*[({]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const doc = m[1] ? cleanDoc(m[1].trim()) : "";
    if (m[2] === "function") {
      fnDocs.set(m[3]!, doc);
      continue;
    }
    // body: brace-balanced from the match end
    let depth = 1, i = re.lastIndex;
    while (i < src.length && depth > 0) {
      const ch = src[i++];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    const body = src.slice(re.lastIndex, i - 1);
    const members: Member[] = [];
    const mre = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?^ {2}(\w+)(\?)?: ([^\n]+?);?$/gm;
    let mm: RegExpExecArray | null;
    while ((mm = mre.exec(body))) members.push({ name: mm[2]!, optional: !!mm[3], type: mm[4]!.replace(/;$/, ""), doc: mm[1] ? cleanDoc(mm[1].trim()) : "" });
    ifaces.set(m[3]!, { name: m[3]!, doc, extends: (m[4] ?? "").split(",").map((s) => s.trim().replace(/<.*$/, "")).filter(Boolean), members });
  }
  return { ifaces, fnDocs };
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

type PatternData = { points: readonly (readonly [number, number])[]; size: string; outline?: readonly [number, number]; outlineOffset?: readonly [number, number]; pilot?: number };
function mountPatternsData(): Record<string, PatternData> {
  return mountPatterns as unknown as Record<string, PatternData>;
}
function span(points: readonly (readonly [number, number])[]): string {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return `${+w.toFixed(2)} × ${+h.toFixed(2)}`;
}

/** Plain-language meaning of type names that appear in prop tables. */
export const TYPE_NOTES: Record<string, string> = {
  Vec3: "`[x, y, z]`",
  Vec2: "`[x, y]`",
  Axis: '`"x" | "y" | "z"`',
  CenterSpec: "`true` (centre every axis), `false` (corner at the origin) or `[bx, by, bz]` per axis",
  PlaneSpec: '`"XY"` (normal +Z), `"XZ"` (normal +Y), `"YZ"` (normal +X), or `{ origin?: [x, y, z], normal: [x, y, z] | "x" | "y" | "z" }`',
  SelectorLike: 'a string such as `">Z"`, `"|Z or <Z"`, or a builder such as `edges.top()`, `faces.parallel("z")`',
  MetricSize: '`"M2" | "M2.5" | "M3" | "M4" | "M5" | "M6" | "M8" | "M10" | "M12"`',
  MaterialName: '`"pla" | "petg" | "abs" | "asa" | "tpu" | "nylon" | "resin" | "aluminum" | "steel" | "stainless" | "brass" | "copper" | "titanium" | "wood" | "acrylic"`',
  HoleFit: '`"close" | "normal" | "loose"` (ISO 273)',
  MountPattern: "an entry of `mountPatterns` (see Data below)",
  Path3: "`helix({...})`, `polyline3([...])`, `arc3({...})` or `bezier3([...])`",
};
/** One documented element or component, for the docs site. */
export interface Entry {
  name: string;
  /** The one-line doc from `IntrinsicElements` (or the component's doc). */
  summary: string;
  /** The props interface's doc. */
  doc: string;
  props: Member[];
  /** Shared prop groups it also takes (placement...). */
  shared: string[];
}

let cache:
  | { elements: string; byTag: Map<string, string>; parts: string; byComponent: Map<string, string>; entries: Entry[]; components: Entry[]; shared: Iface[] }
  | undefined;

/** Interfaces whose props are summarised rather than listed on every element. */
const SHARED: Record<string, string> = {
  Placement: "placement props (x y z at rotate rotateX/Y/Z scale mirror)",
  Placement2D: "2D placement props (x y at rotate mirror, z in a loft)",
  SolidChildren: "solid children",
  SketchChildren: "2D shape children",
};

function propsOf(name: string, ifaces: Map<string, Iface>, seen = new Set<string>()): { own: Member[]; shared: string[] } {
  const i = ifaces.get(name);
  if (!i || seen.has(name)) return { own: [], shared: [] };
  seen.add(name);
  const own = [...i.members];
  const shared: string[] = [];
  for (const e of i.extends) {
    if (SHARED[e]) shared.push(SHARED[e]!);
    else {
      const r = propsOf(e, ifaces, seen);
      own.unshift(...r.own.filter((m) => !own.some((o) => o.name === m.name)));
      shared.push(...r.shared);
    }
  }
  return { own, shared };
}

function memberLine(m: Member): string {
  if (m.name === "key" || m.name === "children") return "";
  const notes = Object.entries(TYPE_NOTES).filter(([t]) => new RegExp(`\\b${t}\\b`).test(m.type)).map(([t, n]) => `${t} = ${n}`);
  return `- \`${m.name}${m.optional ? "?" : ""}: ${m.type}\`${m.doc ? `: ${m.doc.replace(/\n/g, " ")}` : ""}${notes.length ? ` (${notes.join("; ")})` : ""}`;
}

function sharedSection(ifaces: Map<string, Iface>): string {
  const out: string[] = [];
  for (const n of ["Placement", "Placement2D"]) {
    const i = ifaces.get(n);
    if (!i) continue;
    out.push(`### ${n}${i.doc ? `\n${i.doc}` : ""}`, ...i.members.map(memberLine).filter(Boolean), "");
  }
  return out.join("\n");
}

function build() {
  // intrinsics.ts plus any props files it extends from (e.g. constraint sketches)
  const files = [here("../core/intrinsics.ts")];
  try {
    for (const dir of ["sketch", "assembly"])
      for (const f of readdirSync(here(`../core/${dir}/`))) if (/props\.ts$/.test(f)) files.push(here(`../core/${dir}/${f}`));
  } catch {
    /* no sketch dir */
  }
  const ifaces = new Map<string, Iface>();
  for (const f of files) for (const [k, v] of parseInterfaces(readFileSync(f, "utf8")).ifaces) if (!ifaces.has(k)) ifaces.set(k, v);
  const elements = { members: propsOf("IntrinsicElements", ifaces).own };
  const byTag = new Map<string, string>();
  const sections: string[] = ["## Intrinsic elements", "", sharedSection(ifaces)];
  const entries: Entry[] = [];
  const components: Entry[] = [];
  for (const el of elements?.members ?? []) {
    const propsName = el.type.trim();
    const p = ifaces.get(propsName);
    const { own, shared } = propsOf(propsName, ifaces);
    entries.push({ name: el.name, summary: el.doc, doc: p?.doc && p.doc !== el.doc ? p.doc : "", props: own.filter((m) => m.name !== "key" && m.name !== "children"), shared: [...new Set(shared)] });
    const lines = [`### <${el.name}>`, el.doc, p?.doc && p.doc !== el.doc ? p.doc : "", ...own.map(memberLine).filter(Boolean)];
    if (shared.length) lines.push(`- plus ${[...new Set(shared)].join(", ")}`);
    const text = lines.filter(Boolean).join("\n");
    byTag.set(el.name, text);
    sections.push(text, "");
  }
  // parts library
  const partsDir = here("../parts/");
  const partSections: string[] = ["## Parts library (`import { ... } from \"tscad/parts\"`)", ""];
  const byComponent = new Map<string, string>();
  for (const f of readdirSync(partsDir).filter((f) => f.endsWith(".tsx")).sort()) {
    const { ifaces: pi, fnDocs } = parseInterfaces(readFileSync(partsDir + f, "utf8"));
    for (const [fn, doc] of fnDocs) {
      if (!/^[A-Z]/.test(fn)) continue;
      const { own, shared } = propsOf(`${fn}Props`, pi);
      const placed = shared.length > 0 || !!pi.get(`${fn}Props`)?.extends.includes("Placement");
      components.push({ name: fn, summary: doc, doc: "", props: own.filter((m) => m.name !== "key" && m.name !== "children"), shared: placed ? ["placement props (x y z at rotate rotateX/Y/Z scale mirror)"] : [] });
      const lines = [`### <${fn}>`, doc, ...own.map(memberLine).filter(Boolean)];
      if (shared.length || pi.get(`${fn}Props`)?.extends.includes("Placement")) lines.push("- plus placement props");
      const text = lines.filter(Boolean).join("\n");
      byComponent.set(fn, text);
      partSections.push(text, "");
    }
  }
  partSections.push(
    "### Data",
    "- `metric.M3.clearance.normal` (3.4), `.tapDrill`, `.socketHead {diameter,height}`, `.counterbore`, `.countersunk`, `.nut {af,height}`, `.insert`; sizes M2 M2.5 M3 M4 M5 M6 M8 M10 M12",
    "- `mountPatterns.<name>`: `{ points, size, holeDiameter, outline, outlineOffset, pilot? }`. `points` are centred on the hole pattern; the board/face outline's lower-left corner is at `outlineOffset` from that centre, so the board centre is `outlineOffset + outline / 2`.",
    "",
    "| pattern | holes (span) | screw | outline | outline offset | pilot |",
    "|---|---|---|---|---|---|",
    ...Object.entries(mountPatternsData()).map(([k, v]) => `| \`${k}\` | ${span(v.points)} | ${v.size} | ${v.outline ? `${v.outline[0]} × ${v.outline[1]}` : "-"} | ${v.outlineOffset ? `[${v.outlineOffset.join(", ")}]` : "-"} | ${v.pilot ?? "-"} |`),
    "",
    "- `boards.<name>` (for `<Board>` / `<BoardCase>`): PCB size, thickness, holes and every connector (`id`, `type`, plan `rect`, `z`, `height`, `facing`). Frame: x/y from the PCB's lower-left corner, z = 0 at its underside.",
    "",
    "| board | PCB | holes | connectors (ids) |",
    "|---|---|---|---|",
    ...Object.entries(boards).map(([k, b]) => `| \`${k}\` | ${b.size[0]} × ${b.size[1]} × ${b.thickness} | ${b.holes.length ? `${b.holes.length} × ${b.screw}` : "none"} | ${b.connectors.map((c) => `${c.id} (${c.type}, ${c.facing})`).join(", ")} |`),
  );
  cache = {
    elements: sections.join("\n"),
    byTag,
    parts: partSections.join("\n"),
    byComponent,
    entries,
    components,
    shared: ["Placement", "Placement2D"].map((n) => ifaces.get(n)).filter((x): x is Iface => !!x),
  };
  return cache;
}

export function elementsMarkdown(): string {
  return (cache ?? build()).elements;
}
export function partsMarkdown(): string {
  return (cache ?? build()).parts;
}
/** One element's or parts component's reference, or undefined. */
export function lookupReference(name: string): string | undefined {
  const c = cache ?? build();
  const n = name.replace(/^<|\/?>$/g, "");
  return c.byTag.get(n) ?? c.byComponent.get(n);
}
export function referenceNames(): { elements: string[]; components: string[] } {
  const c = cache ?? build();
  return { elements: [...c.byTag.keys()], components: [...c.byComponent.keys()] };
}

/** Structured reference (docs site). */
export function referenceEntries(): { elements: Entry[]; components: Entry[]; shared: { name: string; doc: string; props: Member[] }[] } {
  const c = cache ?? build();
  return { elements: c.entries, components: c.components, shared: c.shared.map((i) => ({ name: i.name, doc: i.doc, props: i.members.filter((m) => m.name !== "key") })) };
}
