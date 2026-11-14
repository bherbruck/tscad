/**
 * The element reference, generated from the TSDoc in `src/core/intrinsics.ts` (intrinsic
 * elements) and `src/parts/*.tsx` (the parts library), so it never drifts from the types.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Member {
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
let cache: { elements: string; byTag: Map<string, string>; parts: string; byComponent: Map<string, string> } | undefined;

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
  return `- \`${m.name}${m.optional ? "?" : ""}: ${m.type}\`${m.doc ? ` — ${m.doc.replace(/\n/g, " ")}` : ""}`;
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
    for (const f of readdirSync(here("../core/sketch/"))) if (/props\.ts$/.test(f)) files.push(here(`../core/sketch/${f}`));
  } catch {
    /* no sketch dir */
  }
  const ifaces = new Map<string, Iface>();
  for (const f of files) for (const [k, v] of parseInterfaces(readFileSync(f, "utf8")).ifaces) if (!ifaces.has(k)) ifaces.set(k, v);
  const elements = { members: propsOf("IntrinsicElements", ifaces).own };
  const byTag = new Map<string, string>();
  const sections: string[] = ["## Intrinsic elements", "", sharedSection(ifaces)];
  for (const el of elements?.members ?? []) {
    const propsName = el.type.trim();
    const p = ifaces.get(propsName);
    const { own, shared } = propsOf(propsName, ifaces);
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
    "- `mountPatterns.raspberryPi4 | raspberryPiZero | arduinoUno | nema17 | nema23`: `{ points, size, holeDiameter, outline, outlineOffset, pilot? }` (points centred)",
  );
  cache = { elements: sections.join("\n"), byTag, parts: partSections.join("\n"), byComponent };
  return cache;
}

export function elementsReference(): string {
  return (cache ?? build()).elements;
}
export function partsReference(): string {
  return (cache ?? build()).parts;
}
/** One element's or parts component's reference, or undefined. */
export function lookup(name: string): string | undefined {
  const c = cache ?? build();
  const n = name.replace(/^<|\/?>$/g, "");
  return c.byTag.get(n) ?? c.byComponent.get(n);
}
export function names(): { elements: string[]; components: string[] } {
  const c = cache ?? build();
  return { elements: [...c.byTag.keys()], components: [...c.byComponent.keys()] };
}
