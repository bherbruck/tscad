/**
 * Build-time: read `src/core/intrinsics.ts` and list every intrinsic element with its props
 * (type text + JSDoc), for the playground's autocompletion. A light parser for that one file's
 * style (interfaces with `/** doc *\/` members), not a TypeScript checker.
 */

export interface PropInfo {
  name: string;
  type: string;
  doc: string;
  optional: boolean;
}

export interface TagInfo {
  tag: string;
  doc: string;
  props: PropInfo[];
}

interface Iface {
  extends: string[];
  members: PropInfo[];
}

function cleanDoc(raw: string): string {
  return raw
    .replace(/^\/\*\*|\*\/$/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** Members of an interface body: `/** doc *\/ name?: type;` (types may span lines). */
function members(body: string): PropInfo[] {
  const out: PropInfo[] = [];
  const re = /(\/\*\*[\s\S]*?\*\/\s*)?^\s{2}(\w+)(\?)?:\s*([\s\S]*?);\s*$/gm;
  for (const m of body.matchAll(re)) {
    out.push({ name: m[2]!, optional: !!m[3], type: m[4]!.replace(/\s+/g, " ").trim(), doc: m[1] ? cleanDoc(m[1].trim()) : "" });
  }
  return out;
}

export function extractIntrinsics(source: string): TagInfo[] {
  const ifaces = new Map<string, Iface>();
  const re = /export interface (\w+)(?:<[^>]*>)?(?:\s+extends\s+([^{]+))?\s*\{(?:\}|([\s\S]*?)^\})/gm;
  for (const m of source.matchAll(re)) {
    ifaces.set(m[1]!, {
      extends: (m[2] ?? "").split(",").map((s) => s.trim().replace(/<.*$/, "")).filter(Boolean),
      members: members(m[3] ?? ""),
    });
  }
  const resolve = (name: string, seen = new Set<string>()): PropInfo[] => {
    const i = ifaces.get(name);
    if (!i || seen.has(name)) return [];
    seen.add(name);
    const own = i.members;
    const inherited = i.extends.flatMap((e) => resolve(e, seen));
    const names = new Set(own.map((p) => p.name));
    return [...own, ...inherited.filter((p) => !names.has(p.name) && (names.add(p.name), true))];
  };
  const elements = ifaces.get("IntrinsicElements");
  if (!elements) return [];
  return elements.members.map((m) => ({
    tag: m.name,
    doc: m.doc,
    props: resolve(m.type).filter((p) => p.name !== "key"),
  }));
}

export interface NamedDoc {
  name: string;
  doc: string;
  detail?: string;
}

/** Methods of the selector builder class `Sel` (`edges.top()`...). */
export function extractSelectorMethods(source: string): NamedDoc[] {
  const out: NamedDoc[] = [];
  for (const m of source.matchAll(/\/\*\*\s*([^@][\s\S]*?)\*\/\s*\n\s*(\w+)\(([^)]*)\):\s*Sel\b/g)) out.push({ name: m[2]!, doc: cleanDoc(`/**${m[1]}*/`), detail: `(${m[3]})` });
  return out;
}

/** Value exports of a barrel file (`export { a, b, type C } from ...`). */
export function extractExports(source: string): NamedDoc[] {
  const out: NamedDoc[] = [];
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of m[1]!.split(",")) {
      const name = raw.trim();
      if (!name || name.startsWith("type ")) continue;
      out.push({ name: name.replace(/^.*\bas\s+/, ""), doc: "" });
    }
  }
  return out;
}

/** Material preset keys and names (`pla: { name: "PLA", ...}`). */
export function extractMaterials(source: string): NamedDoc[] {
  return [...source.matchAll(/^\s{2}(\w+):\s*\{\s*name:\s*"([^"]+)",\s*density:\s*([\d.]+)/gm)].map((m) => ({ name: m[1]!, doc: m[2]!, detail: `${m[3]} g/cm³` }));
}
