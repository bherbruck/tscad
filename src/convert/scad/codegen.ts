/**
 * OpenSCAD AST → idiomatic tscad TSX.
 *
 * - Top-level literal variables with Customizer annotations become `defineParams` entries.
 * - Modules become function components; functions become TS functions. Both are hoisted to file
 *   level unless they read top-level variables, in which case they live inside the model.
 * - OpenSCAD placement conventions are kept exactly: `cube` → `<box center={false}>`, `square`
 *   → `<rect center={false}>`, cylinders based on z = 0.
 * - 2D subtrees under `linear_extrude` / `rotate_extrude` are turned inside out: every 2D leaf
 *   is extruded and 2D booleans become 3D booleans (exact, as both extrusions distribute over
 *   union, difference and intersection), so OpenSCAD's 2D booleans need no 2D kernel.
 */
import { isExpr, type Arg, type Assign, type Elem, type Expr, type Param, type Program, type Stmt } from "./parser";
import type { Comment } from "./lexer";
import { helperSource } from "./helpers";

export interface Warning {
  line: number;
  message: string;
}

type Kind = "num" | "vec" | "str" | "bool" | "undef" | "fn" | "any";
interface Var {
  js: string;
  kind: Kind;
  /** Top-level variable (params and globals). */
  global?: boolean;
}

class Env {
  private readonly vars = new Map<string, Var>();
  constructor(readonly parent: Env | null) {}
  get(name: string): Var | undefined {
    return this.vars.get(name) ?? this.parent?.get(name);
  }
  set(name: string, v: Var): void {
    this.vars.set(name, v);
  }
  child(): Env {
    return new Env(this);
  }
}

interface ModuleInfo {
  name: string;
  js: string;
  params: Param[];
  body: Stmt[];
  line: number;
  dim: Dim;
  usesChildren: boolean;
  hoisted: boolean;
}
interface FunctionInfo {
  name: string;
  js: string;
  params: Param[];
  body: Expr;
  line: number;
  hoisted: boolean;
}

type Dim = "2d" | "3d" | "any";

/** How 2D leaves become solids in the current context. */
interface Ctx {
  env: Env;
  mode: "3d" | "2d" | "raw";
  /** 2D: wrap a 2D shape (JSX child text) into the child text of a solid. */
  wrap: (shape: string) => string;
  /** 2D: the extrusion is linear and known here (transforms may be applied in 3D). */
  linear: boolean;
  module?: ModuleInfo;
}

const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval undefined NaN Infinity Math Number String Array Object JSON children p params".split(" "),
);
export function jsName(n: string): string {
  const s = n.replace(/^\$/, "_");
  return RESERVED.has(s) ? `${s}_` : s;
}
function pascal(n: string): string {
  const s = n.replace(/(^|_+)([a-z0-9])/gi, (_, __, c: string) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, "");
  return /^[A-Z]/.test(s) ? s : `M${s}`;
}
const indent = (s: string, by = "  ") => s.split("\n").map((l) => (l ? by + l : l)).join("\n");
const fmtNum = (v: number) => String(v);

const PRIMS_3D = new Set(["cube", "sphere", "cylinder", "polyhedron", "linear_extrude", "rotate_extrude", "surface", "import"]);
const PRIMS_2D = new Set(["square", "circle", "polygon", "text", "offset", "projection"]);
const PASS = new Set(["union", "difference", "intersection", "hull", "minkowski", "translate", "rotate", "scale", "mirror", "multmatrix", "color", "render", "resize", "group", "for", "intersection_for", "let", "assign"]);

export class Gen {
  readonly warnings: Warning[] = [];
  private readonly helpers = new Set<string>();
  private readonly modules = new Map<string, ModuleInfo>();
  private readonly functions = new Map<string, FunctionInfo>();
  private readonly warned = new Set<string>();
  private usesChildrenType = false;
  private tmp = 0;

  /**
   * Kinds of the arguments seen at call sites (`mod:name.param` / `fn:name.param`), from the
   * previous pass (`known`) and gathered in this one (`seen`): untyped parameters take them.
   */
  readonly seen = new Map<string, Set<Kind>>();
  constructor(
    private readonly prog: Program,
    private readonly known: Map<string, Set<Kind>> = new Map(),
  ) {}

  private record(key: string, kind: Kind): void {
    const s = this.seen.get(key) ?? new Set<Kind>();
    s.add(kind);
    this.seen.set(key, s);
  }
  /** Optional when it has a default, some call leaves it out, or nothing calls it. */
  private optional(key: string, hasDefault: boolean): boolean {
    const ks = this.known.get(key);
    return hasDefault || !ks || ks.has("undef");
  }
  private inferred(key: string, dflt: Kind | undefined): Kind {
    const ks = new Set(this.known.get(key) ?? []);
    ks.delete("undef");
    if (dflt && dflt !== "undef") ks.add(dflt);
    if (ks.size === 1) {
      const k = [...ks][0]!;
      return k === "fn" ? "any" : k;
    }
    return "any";
  }

  warn(line: number, message: string): void {
    const k = `${line}|${message}`;
    if (this.warned.has(k)) return;
    this.warned.add(k);
    this.warnings.push({ line, message });
  }
  private h(name: string): string {
    this.helpers.add(name);
    return name;
  }

  // ---------------------------------------------------------------------------------------------
  // Program

  generate(modelName: string): string {
    const body = this.prog.body;
    // definitions anywhere in the file (OpenSCAD hoists them)
    const collect = (stmts: Stmt[]) => {
      for (const s of stmts) {
        if (s.t === "module") {
          if (this.modules.has(s.name)) this.warn(s.line, `module ${s.name} is defined twice; the last definition wins`);
          this.modules.set(s.name, { name: s.name, js: pascal(s.name), params: s.params, body: s.body, line: s.line, dim: "any", usesChildren: usesChildren(s.body), hoisted: true });
          collect(s.body); // nested definitions move to file level
        } else if (s.t === "function") {
          if (this.functions.has(s.name)) this.warn(s.line, `function ${s.name} is defined twice; the last definition wins`);
          this.functions.set(s.name, { name: s.name, js: jsName(s.name), params: s.params, body: s.body, line: s.line, hoisted: true });
        }
      }
    };
    collect(body);
    for (const s of body) if (s.t === "use") this.warn(s.line, `${s.kind} <${s.path}>: not converted — convert that file too and import what you need`);
    this.classifyModules();

    // globals: params (Customizer) and derived constants
    const { params, globals } = this.globals(body);
    const top = new Env(null);
    for (const g of globals) top.set(g.name, { js: jsName(g.name), kind: g.kind ?? "any", global: true });
    this.hoisting(new Set(globals.map((g) => g.name)));

    const fileEnv = new Env(null);
    const out: string[] = [];
    out.push(`/**\n * ${modelName}: converted from OpenSCAD by \`tscad convert\`.\n * Lengths are millimetres and angles degrees, as in OpenSCAD.\n */`);
    const defs: string[] = [];
    for (const f of this.functions.values()) if (f.hoisted) defs.push(this.functionDef(f, fileEnv));
    for (const m of this.modules.values()) if (m.hoisted) defs.push(this.moduleDef(m, fileEnv));

    // the model component
    const inner: string[] = [];
    const env = top;
    if (params.length) inner.push(`const { ${params.map((p) => jsName(p.name)).join(", ")} } = p`);
    for (const g of globals) {
      if (g.param) continue;
      const e = this.expr(g.value!, env);
      env.set(g.name, { js: jsName(g.name), kind: e.kind, global: true });
      inner.push(`const ${jsName(g.name)} = ${e.code}`);
    }
    for (const f of this.functions.values()) if (!f.hoisted) inner.push(this.functionDef(f, env));
    for (const m of this.modules.values()) if (!m.hoisted) inner.push(this.moduleDef(m, env));
    const geometry = body.filter((s) => s.t === "inst" || s.t === "if" || s.t === "block");
    const kids = this.children(geometry, this.ctx3d(env));
    if (!kids.length) this.warn(1, "the file draws nothing at the top level (only definitions)");
    inner.push(`return ${this.root(kids)}`);

    const modelFn = `export default function ${pascal(modelName.replace(/[^A-Za-z0-9_]/g, "_")) || "Model"}(${params.length ? "p: ParamValues<typeof params>" : ""}) {\n${indent(inner.join("\n"))}\n}`;
    const imports = ["defineParams", ...(this.usesChildrenType || this.helpers.has("$leaf1") ? ["type Children"] : []), "type ParamValues"];
    out.push(`import { ${imports.join(", ")} } from "tscad"`);
    out.push(`export const params = defineParams({${params.length ? "\n" + indent(params.map((p) => p.code).join("\n")) + "\n" : ""}})`);
    out.push(...defs);
    out.push(modelFn);
    const helpers = helperSource(this.helpers);
    if (helpers) out.push(`// ---- OpenSCAD semantics used above\n\n${helpers}`);
    return out.join("\n\n") + "\n";
  }

  private ctx3d(env: Env, module?: ModuleInfo): Ctx {
    return { env, mode: "3d", wrap: (s) => s, linear: true, ...(module ? { module } : {}) };
  }

  /** A JSX root from child texts. */
  private root(kids: string[]): string {
    if (kids.length === 0) return "null";
    if (kids.length === 1 && kids[0]!.startsWith("<")) return kids[0]!.includes("\n") ? `(\n${indent(kids[0]!)}\n)` : kids[0]!;
    return `(\n  <>\n${indent(kids.join("\n"), "    ")}\n  </>\n)`;
  }

  // ---------------------------------------------------------------------------------------------
  // Customizer params and globals

  private globals(body: Stmt[]): { params: { name: string; code: string }[]; globals: { name: string; value?: Expr; kind?: Kind; param?: boolean }[] } {
    const comments = this.prog.comments;
    const firstDef = body.find((s) => s.t === "module" || s.t === "function")?.line ?? Infinity;
    const assigns = body.filter((s): s is Extract<Stmt, { t: "assign" }> => s.t === "assign");
    // last assignment wins (OpenSCAD), in the order of the last occurrence
    const last = new Map<string, Extract<Stmt, { t: "assign" }>>();
    for (const a of assigns) {
      if (last.has(a.name) && !a.name.startsWith("$")) this.warn(a.line, `${a.name} is assigned more than once; OpenSCAD uses the last value everywhere`);
      last.delete(a.name);
      last.set(a.name, a);
    }
    const params: { name: string; code: string }[] = [];
    const globals: { name: string; value?: Expr; kind?: Kind; param?: boolean }[] = [];
    for (const a of last.values()) {
      if (a.name.startsWith("$")) {
        if (a.name !== "$fn" && a.name !== "$fa" && a.name !== "$fs") this.warn(a.line, `special variable ${a.name} ignored`);
        continue;
      }
      const lit = literal(a.value);
      const section = sectionAt(comments, a.line);
      if (lit !== undefined && a.line < firstDef && section?.toLowerCase() !== "hidden") {
        const p = this.param(a.name, lit, a.line, comments, section);
        if (p) {
          params.push({ name: a.name, code: p });
          globals.push({ name: a.name, param: true, kind: typeof lit === "number" ? "num" : typeof lit === "string" ? "str" : "bool" });
          continue;
        }
      }
      globals.push({ name: a.name, value: a.value });
    }
    return { params, globals };
  }

  private param(name: string, v: number | string | boolean, line: number, comments: Comment[], section?: string): string | undefined {
    const trailing = comments.find((c) => c.line === line && c.trailing && !c.block);
    const above = comments.filter((c) => !c.block && !c.trailing && c.endLine === line - 1);
    const spec: string[] = [];
    const ann = trailing?.text.trim() ?? "";
    const m = /^\[(.*)\]$/.exec(ann);
    // the comment above; else a plain trailing comment
    const description = above.map((c) => c.text).join(" ").trim() || (ann && !m && !/^\d+$/.test(ann) ? ann : "");
    let type: string;
    if (typeof v === "boolean") {
      type = "boolean";
      spec.push(`type: "boolean"`, `default: ${v}`);
    } else if (m && m[1]!.includes(",")) {
      // dropdown: [a, b, c] or [1:One, 2:Two]
      const opts = m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
      const values: (string | number)[] = [], labels: [string | number, string][] = [];
      for (const o of opts) {
        const [val, lab] = o.split(":").map((s) => s.trim());
        const parsed: string | number = typeof v === "number" ? Number(val) : val!;
        values.push(parsed);
        if (lab) labels.push([parsed, lab]);
      }
      if (!values.includes(v)) values.unshift(v);
      type = "choice";
      spec.push(`type: "choice"`, `default: ${JSON.stringify(v)}`, `options: [${values.map((x) => JSON.stringify(x)).join(", ")}]`);
      if (labels.length) spec.push(`optionLabels: { ${labels.map(([k, l]) => `${JSON.stringify(String(k))}: ${JSON.stringify(l)}`).join(", ")} }`);
    } else if (typeof v === "number") {
      let min: number | undefined, max: number | undefined, step: number | undefined;
      const r = m ? m[1]!.split(":").map((s) => Number(s.trim())) : [];
      if (m && r.every((x) => Number.isFinite(x))) {
        if (r.length === 1) [min, max] = [0, r[0]];
        else if (r.length === 2) [min, max] = r;
        else if (r.length === 3) [min, step, max] = r;
      } else if (ann && m) this.warn(line, `Customizer annotation ${ann} not understood for ${name}`);
      const int = Number.isInteger(v) && min !== undefined && Number.isInteger(min) && (max === undefined || Number.isInteger(max)) && (step === undefined || Number.isInteger(step));
      type = int ? "int" : "number";
      spec.push(`type: "${type}"`, `default: ${fmtNum(v)}`);
      if (min !== undefined) spec.push(`min: ${fmtNum(Math.min(min, v))}`);
      if (max !== undefined) spec.push(`max: ${fmtNum(Math.max(max, v))}`);
      if (step !== undefined) spec.push(`step: ${fmtNum(step)}`);
    } else {
      type = "text";
      spec.push(`type: "text"`, `default: ${JSON.stringify(v)}`);
      const n = /^\d+$/.test(ann) ? Number(ann) : undefined;
      if (n) spec.push(`maxLength: ${n}`);
    }
    if (description) spec.push(`description: ${JSON.stringify(description)}`);
    if (section) spec.push(`group: ${JSON.stringify(section)}`);
    void type;
    return `${jsName(name)}: { ${spec.join(", ")} },`;
  }

  // ---------------------------------------------------------------------------------------------
  // Definitions

  private classifyModules(): void {
    for (let pass = 0; pass < 10; pass++) {
      let changed = false;
      for (const m of this.modules.values()) {
        const d = this.dimOfAll(m.body);
        if (d !== m.dim) {
          m.dim = d;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  dimOfAll(stmts: Stmt[]): Dim {
    let d: Dim = "any";
    for (const s of stmts) {
      const x = this.dimOf(s);
      if (x === "3d") return "3d";
      if (x === "2d") d = "2d";
    }
    return d;
  }

  dimOf(s: Stmt): Dim {
    if (s.t === "if") return this.dimOfAll([...s.then, ...(s.else ?? [])]);
    if (s.t === "block") return this.dimOfAll(s.body);
    if (s.t !== "inst") return "any";
    if (s.name === "linear_extrude" || s.name === "rotate_extrude" || PRIMS_3D.has(s.name)) return "3d";
    if (PRIMS_2D.has(s.name)) return "2d";
    if (s.name === "children") return "any";
    const m = this.modules.get(s.name);
    if (m) return m.dim === "any" && s.children.length ? this.dimOfAll(s.children) : m.dim;
    return this.dimOfAll(s.children);
  }

  /** Decide which definitions can live at file level (they read no top-level variables). */
  private hoisting(globals: Set<string>): void {
    const freeOfExpr = (e: Expr | Elem | undefined, bound: Set<string>, out: Set<string>): void => {
      if (!e) return;
      const walk = (x: unknown, b: Set<string>): void => {
        if (!x || typeof x !== "object") return;
        const o = x as any;
        if (o.t === "id") {
          if (!b.has(o.name)) out.add(o.name);
          return;
        }
        if (o.t === "let" || o.t === "lc-let" || o.t === "lc-for") {
          const nb = new Set(b);
          for (const a of o.assigns as Assign[]) {
            walk(a.value, nb);
            nb.add(a.name);
          }
          walk(o.body, nb);
          return;
        }
        if (o.t === "fn") {
          const nb = new Set(b);
          for (const p of o.params as Param[]) {
            walk(p.dflt, nb);
            nb.add(p.name);
          }
          walk(o.body, nb);
          return;
        }
        if (o.t === "call" && o.f?.t === "id") {
          out.add(`fn:${o.f.name}`);
          for (const a of o.args) walk(a.value, b);
          return;
        }
        for (const v of Object.values(o)) {
          if (Array.isArray(v)) v.forEach((y) => walk(y, b));
          else if (v && typeof v === "object") walk(v, b);
        }
      };
      walk(e, bound);
    };
    const freeOfStmts = (stmts: Stmt[], bound: Set<string>, out: Set<string>): void => {
      const b = new Set(bound);
      for (const s of stmts) if (s.t === "assign") b.add(s.name);
      for (const s of stmts) {
        if (s.t === "assign") freeOfExpr(s.value, b, out);
        else if (s.t === "inst") {
          if (this.modules.has(s.name)) out.add(`mod:${s.name}`);
          let nb = b;
          if (s.name === "for" || s.name === "intersection_for" || s.name === "let" || s.name === "assign") {
            nb = new Set(b);
            for (const a of s.args) {
              freeOfExpr(a.value, nb, out);
              if (a.name) nb.add(a.name);
            }
          } else for (const a of s.args) freeOfExpr(a.value, b, out);
          freeOfStmts(s.children, nb, out);
        } else if (s.t === "if") {
          freeOfExpr(s.c, b, out);
          freeOfStmts(s.then, b, out);
          freeOfStmts(s.else ?? [], b, out);
        } else if (s.t === "block") freeOfStmts(s.body, b, out);
      }
    };
    const freeSets = new Map<object, Set<string>>();
    for (const m of this.modules.values()) {
      const out = new Set<string>();
      const b = new Set(m.params.map((p) => p.name));
      for (const p of m.params) freeOfExpr(p.dflt, b, out);
      freeOfStmts(m.body, b, out);
      freeSets.set(m, out);
    }
    for (const f of this.functions.values()) {
      const out = new Set<string>();
      const b = new Set(f.params.map((p) => p.name));
      for (const p of f.params) freeOfExpr(p.dflt, b, out);
      freeOfExpr(f.body, b, out);
      freeSets.set(f, out);
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (const d of [...this.modules.values(), ...this.functions.values()]) {
        if (!d.hoisted) continue;
        for (const n of freeSets.get(d)!) {
          const reads = n.startsWith("fn:") ? this.functions.get(n.slice(3)) ?? (globals.has(n.slice(3)) ? null : undefined) : n.startsWith("mod:") ? this.modules.get(n.slice(4)) : globals.has(n) ? null : undefined;
          // a global, or a definition that isn't hoisted
          if (reads === null || (reads && !reads.hoisted)) {
            d.hoisted = false;
            changed = true;
            break;
          }
        }
      }
    }
  }

  private paramList(params: Param[], env: Env, owner?: string): { code: string; type: string; kind: Kind; optional: boolean }[] {
    return params.map((p) => {
      const d = p.dflt ? this.expr(p.dflt, env) : undefined;
      const kind = owner ? this.inferred(`${owner}.${p.name}`, d?.kind) : d?.kind ?? "any";
      env.set(p.name, { js: jsName(p.name), kind: kind === "undef" ? "any" : kind });
      const type = kind === "num" ? "number" : kind === "str" ? "string" : kind === "bool" ? "boolean" : kind === "vec" ? "any[]" : "any";
      const optional = owner ? this.optional(`${owner}.${p.name}`, !!d) : true;
      return { code: d ? `${jsName(p.name)} = ${d.code}` : jsName(p.name), type: optional && !d ? "any" : type, kind, optional };
    });
  }

  private functionDef(f: FunctionInfo, outer: Env): string {
    const env = outer.child();
    const ps = this.paramList(f.params, env, `fn:${f.name}`);
    const body = this.expr(f.body, env);
    const sig = ps.map((x, i) => {
      if (x.code.includes("=")) return x.code.replace(/^(\S+) =/, `$1: ${x.type} =`);
      if (!x.optional) return `${x.code}: ${x.type}`;
      // an optional parameter before a required one can't be `?`
      return ps.slice(i + 1).some((y) => !y.optional && !y.code.includes("=")) ? `${x.code}: any` : `${x.code}?: any`;
    });
    return `function ${f.js}(${sig.join(", ")}): any {\n  return ${body.code}\n}`;
  }

  private moduleDef(m: ModuleInfo, outer: Env): string {
    const env = outer.child();
    const ps = this.paramList(m.params, env, `mod:${m.name}`);
    const fields = ps.map((p, i) => `${jsName(m.params[i]!.name)}${p.optional ? "?" : ""}: ${p.type}`);
    const names = ps.map((p) => p.code);
    if (m.usesChildren) {
      names.push("children");
      fields.push("children?: Children");
      this.usesChildrenType = true;
    }
    let ctx: Ctx;
    if (m.dim === "2d") {
      names.push(`$leaf = ${this.h("$leaf1")}`);
      fields.push("/** Turns this module's 2D shapes into solids (extrude/revolve); set by the caller. */ $leaf?: (shape: Children) => Children");
      this.usesChildrenType = true;
      ctx = { env, mode: "2d", wrap: (s) => `{$leaf(${frag(s)})}`, linear: false, module: m };
    } else ctx = this.ctx3d(env, m);
    const { prelude, kids } = this.block(m.body, ctx);
    const doc = `/** OpenSCAD module ${m.name}(${m.params.map((p) => p.name).join(", ")}) */`;
    const sig = names.length ? `{ ${names.join(", ")} }: { ${fields.join("; ")} }` : "";
    return `${doc}\nfunction ${m.js}(${sig}) {\n${indent([...prelude, `return ${this.root(kids)}`].join("\n"))}\n}`;
  }

  // ---------------------------------------------------------------------------------------------
  // Statements → JSX children

  /** A statement list's local assignments (as consts, last wins) and its children. */
  private block(stmts: Stmt[], ctx: Ctx): { prelude: string[]; kids: string[] } {
    const env = ctx.env.child();
    const last = new Map<string, Extract<Stmt, { t: "assign" }>>();
    for (const s of stmts)
      if (s.t === "assign") {
        last.delete(s.name);
        last.set(s.name, s);
      }
    const prelude: string[] = [];
    for (const a of last.values()) {
      if (a.name.startsWith("$")) continue;
      const e = this.expr(a.value, env);
      env.set(a.name, { js: jsName(a.name), kind: e.kind });
      prelude.push(`const ${jsName(a.name)} = ${e.code}`);
    }
    for (const s of stmts) if (s.t === "module" || s.t === "function") this.warn(s.line, `nested ${s.t} ${s.name} is moved to file level`);
    const kids = this.children(stmts.filter((s) => s.t === "inst" || s.t === "if" || s.t === "block"), { ...ctx, env });
    return { prelude, kids };
  }

  /** A block as a single child text (an IIFE when it has assignments). */
  private blockChild(stmts: Stmt[], ctx: Ctx): string[] {
    const { prelude, kids } = this.block(stmts, ctx);
    if (!prelude.length) return kids;
    return [`{(() => {\n${indent([...prelude, `return ${this.root(kids)}`].join("\n"))}\n})()}`];
  }

  children(stmts: Stmt[], ctx: Ctx): string[] {
    return stmts.flatMap((s) => this.stmt(s, ctx));
  }

  /** Exactly one solid per statement (for difference/intersection operands). */
  private single(s: Stmt, ctx: Ctx): string | undefined {
    const k = this.stmt(s, ctx);
    if (k.length === 0) return undefined;
    if (k.length === 1 && k[0]!.startsWith("<") && !k[0]!.startsWith("<>")) return k[0]!;
    if (ctx.mode === "raw") return k.join("\n");
    return el("union", [], k);
  }

  stmt(s: Stmt, ctx: Ctx): string[] {
    if (s.t === "block") return this.blockChild(s.body, ctx);
    if (s.t === "if") {
      if (s.modifier === "*") return [];
      const c = this.cond(s.c, ctx.env);
      const a = this.root(this.blockChild(s.then, ctx));
      const b = s.else ? this.root(this.blockChild(s.else, ctx)) : "null";
      return [`{${c} ? ${a} : ${b}}`];
    }
    if (s.t !== "inst") return [];
    if (s.modifier === "*") return [];
    if (s.modifier === "%") {
      this.warn(s.line, `% (background) ${s.name}(): omitted`);
      return [];
    }
    if (s.modifier === "!") this.warn(s.line, `! (root) modifier ignored: everything else is still drawn`);
    // a 2D statement where a solid is expected
    if (ctx.mode === "3d" && this.dimOf(s) === "2d" && !(s.name === "linear_extrude" || s.name === "rotate_extrude")) {
      this.warn(s.line, `2D ${s.name}() at the top of a 3D context: extruded 1 mm (OpenSCAD would keep it flat)`);
      return this.stmt(s, { ...ctx, mode: "2d", wrap: (x) => el("extrude", ["height={1}"], [x]), linear: true });
    }
    return this.inst(s, ctx);
  }

  // ---------------------------------------------------------------------------------------------
  // Module instantiation

  private arg(args: Arg[], pos: number, ...names: string[]): Expr | undefined {
    for (const n of names) {
      const a = args.find((x) => x.name === n);
      if (a) return a.value;
    }
    const positional = args.filter((a) => !a.name);
    return pos >= 0 ? positional[pos]?.value : undefined;
  }
  private e(x: Expr | undefined, env: Env): string | undefined {
    return x ? this.expr(x, env).code : undefined;
  }
  /** A literal $fn below 16 means a deliberately faceted shape (hex nuts...). */
  private facets(args: Arg[]): number | undefined {
    const f = args.find((a) => a.name === "$fn")?.value;
    return f && f.t === "num" && f.v >= 3 && f.v < 16 ? f.v : undefined;
  }

  private inst(s: Extract<Stmt, { t: "inst" }>, ctx: Ctx): string[] {
    const env = ctx.env;
    const A = (pos: number, ...names: string[]) => this.arg(s.args, pos, ...names);
    const E = (x: Expr | undefined) => this.e(x, env);
    const kids = () => this.children(s.children, ctx);
    const leaf = (shape: string) => [ctx.mode === "3d" ? shape : ctx.wrap(shape)];
    switch (s.name) {
      // ---- 3D primitives
      case "cube": {
        const size = A(0, "size");
        const c = A(1, "center");
        return [el("box", [`size={${E(size) ?? "1"}}`, this.centerProp(c, env, "false")], [])];
      }
      case "sphere": {
        const r = A(0, "r");
        const d = A(-1, "d");
        if (this.facets(s.args)) this.warn(s.line, `sphere $fn=${this.facets(s.args)} is drawn as a true sphere`);
        return [el("sphere", [d && !r ? `d={${E(d)}}` : `r={${E(r) ?? "1"}}`], [])];
      }
      case "cylinder": {
        const h = E(A(0, "h", "height")) ?? "1";
        const r = A(-1, "r"), d = A(-1, "d");
        const r1 = A(1, "r1"), r2 = A(2, "r2"), d1 = A(-1, "d1"), d2 = A(-1, "d2");
        const c = A(3, "center");
        const rr = r ? E(r)! : d ? `${paren(E(d)!)} / 2` : undefined;
        const R1 = r1 ? E(r1)! : d1 ? `${paren(E(d1)!)} / 2` : rr ?? "1";
        const R2 = r2 ? E(r2)! : d2 ? `${paren(E(d2)!)} / 2` : rr ?? "1";
        const cone = r1 || r2 || d1 || d2;
        const fn = this.facets(s.args);
        const center = this.centerProp(c, env, undefined);
        if (fn) {
          this.warn(s.line, `cylinder $fn=${fn}: a ${fn}-sided prism, like OpenSCAD's`);
          if (!cone || R1 === R2) return [el("extrude", [`height={${h}}`, ...(center ? [center] : [])], [el("regularPolygon", [`sides={${fn}}`, `r={${R1}}`], [])])];
          const z0 = c ? `(${this.cond(c, env)} ? -(${h}) / 2 : 0)` : "0";
          return [el("loft", ["ruled"], [el("regularPolygon", [`sides={${fn}}`, `r={${R1}}`, `z={${z0}}`], []), el("regularPolygon", [`sides={${fn}}`, `r={${R2}}`, `z={${z0} + ${paren(h)}}`], [])])];
        }
        if (cone) return [el("cone", [`r1={${R1}}`, `r2={${R2}}`, `h={${h}}`, ...(center ? [center] : [])], [])];
        return [el("cylinder", [`r={${rr ?? "1"}}`, `h={${h}}`, ...(center ? [center] : [])], [])];
      }
      case "polyhedron":
        this.warn(s.line, "polyhedron() isn't supported (tscad builds exact B-reps, not meshes): left out");
        return [`{/* polyhedron(...) — not converted */}`];
      case "surface":
      case "import":
      case "projection":
        this.warn(s.line, `${s.name}() isn't supported: left out`);
        return [`{/* ${s.name}(...) — not converted */}`];

      // ---- booleans
      case "union":
      case "group":
      case "render":
        if (ctx.mode === "raw" || s.name !== "union") return kids();
        return [el("union", [], kids())];
      case "difference":
      case "intersection": {
        const ops = s.children.flatMap((c) => {
          const one = this.single(c, ctx);
          return one ? [one] : [];
        });
        if (ctx.mode === "raw") {
          this.warn(s.line, `2D ${s.name}() inside offset(): approximated by even-odd nesting (nested shapes become holes)`);
          return ops;
        }
        return [el(s.name, [], ops)];
      }
      case "hull":
      case "minkowski":
        this.warn(s.line, `${s.name}() isn't supported: its children are unioned instead`);
        return ctx.mode === "raw" ? kids() : [el("union", [], kids())];

      // ---- transforms
      case "translate":
      case "rotate":
      case "scale":
      case "mirror":
      case "multmatrix":
      case "resize":
      case "color":
        return this.transform(s, ctx);

      // ---- extrusions
      case "linear_extrude": {
        const h = E(A(0, "height")) ?? (this.warn(s.line, "linear_extrude without height: OpenSCAD's default 100"), "100");
        const c = A(-1, "center");
        const twist = A(-1, "twist"), sc = A(-1, "scale");
        if (twist && !(twist.t === "num" && twist.v === 0)) this.warn(s.line, "linear_extrude twist isn't supported: extruded straight");
        if (sc && !(sc.t === "num" && sc.v === 1)) this.warn(s.line, "linear_extrude scale isn't supported: extruded straight");
        const center = this.centerProp(c, env, undefined);
        return this.children(s.children, { env, mode: "2d", linear: true, wrap: (x) => el("extrude", [`height={${h}}`, ...(center ? [center] : [])], [x]), ...(ctx.module ? { module: ctx.module } : {}) });
      }
      case "rotate_extrude": {
        const a = A(-1, "angle");
        const ac = a ? E(a)! : undefined;
        const wrap = (x: string) => el("revolve", ac && ac !== "360" ? [`angle={${ac}}`] : [], [x]);
        return this.children(s.children, { env, mode: "2d", linear: false, wrap, ...(ctx.module ? { module: ctx.module } : {}) });
      }

      // ---- 2D shapes
      case "square": {
        const size = A(0, "size");
        const c = A(1, "center");
        return leaf(el("rect", [`size={${E(size) ?? "1"}}`, this.centerProp(c, env, "false")], []));
      }
      case "circle": {
        const r = A(0, "r"), d = A(-1, "d");
        const rr = r ? E(r)! : d ? `${paren(E(d)!)} / 2` : "1";
        const fn = this.facets(s.args);
        if (fn) {
          this.warn(s.line, `circle $fn=${fn}: a regular ${fn}-gon, like OpenSCAD's`);
          return leaf(el("regularPolygon", [`sides={${fn}}`, `r={${rr}}`], []));
        }
        return leaf(el("circle", [`r={${rr}}`], []));
      }
      case "polygon": {
        const pts = A(0, "points"), paths = A(1, "paths");
        if (!pts) {
          this.warn(s.line, "polygon() without points");
          return [];
        }
        if (!paths) return leaf(el("polygon", [`points={${E(pts)}}`], []));
        // several paths: one shape per path, kept together so nested paths are holes
        return leaf(`<>{${this.h("$paths")}(${E(pts)}, ${E(paths)}).map((pts, i) => <polygon key={i} points={pts} />)}</>`);
      }
      case "text": {
        const t = A(0, "text"), size = A(1, "size");
        const ha = A(-1, "halign"), va = A(-1, "valign"), sp = A(-1, "spacing");
        if (A(-1, "font")) this.warn(s.line, "text font ignored: the default font is used (pass font={bytes} to <text>)");
        this.warn(s.line, "text(): font metrics differ from OpenSCAD's; check the size");
        const props = [`size={${E(size) ?? "10"}}`];
        if (ha) props.push(ha.t === "str" ? `align="${ha.v}"` : `align={${E(ha)} as any}`);
        if (va) props.push(va.t === "str" ? `valign="${va.v === "center" ? "middle" : va.v}"` : `valign={${E(va)} as any}`);
        if (sp) props.push(`spacing={${E(sp)}}`);
        return leaf(el("text", props, [`{${E(t) ?? '""'}}`]));
      }
      case "offset": {
        const r = A(0, "r"), delta = A(-1, "delta");
        if (A(-1, "chamfer")) this.warn(s.line, "offset chamfer ignored");
        const raw: Ctx = { env, mode: "raw", wrap: (x) => x, linear: false, ...(ctx.module ? { module: ctx.module } : {}) };
        const inner = this.children(s.children, raw);
        const shape = el("offset", [`distance={${E(r ?? delta) ?? "1"}}`, ...(r ? [] : ["round={false}"])], inner);
        return leaf(shape);
      }

      // ---- control
      case "for":
      case "intersection_for": {
        const loops = s.args.filter((a) => a.name);
        if (!loops.length) {
          this.warn(s.line, `${s.name} without a loop variable`);
          return [];
        }
        const build = (i: number, env2: Env): string => {
          const a = loops[i]!;
          const it = this.iterable(a.value, env2);
          const inner = env2.child();
          inner.set(a.name!, { js: jsName(a.name!), kind: it.item });
          const body = i + 1 < loops.length ? build(i + 1, inner) : this.root(this.blockChild(s.children, { ...ctx, env: inner }));
          const fn = body.startsWith("{(() =>") ? body : body;
          return `${it.code}.map((${jsName(a.name!)}: ${it.item === "num" ? "number" : "any"}) => ${i + 1 < loops.length ? `(\n${indent(`<>{${fn}}</>`)}\n)` : fn})`;
        };
        const loop = `{${build(0, env)}}`;
        if (s.name === "intersection_for") return [el("intersection", [], [loop])];
        return [loop];
      }
      case "let":
      case "assign": {
        const inner = env.child();
        const prelude: string[] = [];
        for (const a of s.args) {
          if (!a.name) continue;
          const v = this.expr(a.value, inner);
          inner.set(a.name, { js: jsName(a.name), kind: v.kind });
          prelude.push(`const ${jsName(a.name)} = ${v.code}`);
        }
        const k = this.blockChild(s.children, { ...ctx, env: inner });
        return [`{(() => {\n${indent([...prelude, `return ${this.root(k)}`].join("\n"))}\n})()}`];
      }
      case "echo":
      case "assert":
        return [];
      case "children": {
        if (!ctx.module) {
          this.warn(s.line, "children() outside a module");
          return [];
        }
        const i = A(0, "index");
        return [i ? `{${this.h("$child")}(children, ${E(i)})}` : "{children}"];
      }
    }
    // ---- user modules
    const m = this.modules.get(s.name);
    if (!m) {
      this.warn(s.line, `unknown module ${s.name}()${PASS.has(s.name) ? "" : " (from a use/include?)"}: left out`);
      return [`{/* ${s.name}(...) — unknown module */}`];
    }
    const props: string[] = [];
    const passed = new Set<string>();
    let pos = 0;
    for (const a of s.args) {
      if (a.name?.startsWith("$")) continue;
      const pname = a.name ?? m.params[pos++]?.name;
      if (pname) passed.add(pname);
      if (!pname) {
        this.warn(s.line, `too many arguments to ${m.name}()`);
        continue;
      }
      if (!m.params.some((p) => p.name === pname)) {
        this.warn(s.line, `${m.name}() has no parameter ${pname}`);
        continue;
      }
      const v = this.expr(a.value, env);
      this.record(`mod:${m.name}.${pname}`, v.kind);
      props.push(v.code === "true" ? jsName(pname) : `${jsName(pname)}={${v.code}}`);
    }
    for (const pp of m.params) if (!pp.dflt && !passed.has(pp.name)) this.record(`mod:${m.name}.${pp.name}`, "undef");
    if (m.dim === "2d") {
      if (ctx.mode === "3d") this.warn(s.line, `2D module ${m.name}() used as a solid: extruded 1 mm`);
      else if (ctx.mode === "raw") props.push(`$leaf={(s) => s}`);
      else props.push(`$leaf={(s) => ${frag(ctx.wrap("{s}"))}}`);
    } else if (ctx.mode === "2d" && !ctx.linear && m.dim === "any") this.warn(s.line, `${m.name}() places its children with 3D transforms inside rotate_extrude: check the profile`);
    const ch = m.usesChildren ? this.children(s.children, ctx) : [];
    if (!m.usesChildren && s.children.length) this.warn(s.line, `${m.name}() doesn't use children(); its children are ignored`);
    return [el(m.js, props, ch)];
  }

  private centerProp(c: Expr | undefined, env: Env, dflt: string | undefined): string {
    if (!c) return dflt === undefined ? "" : `center={${dflt}}`;
    if (c.t === "bool") return c.v ? "center" : "center={false}";
    return `center={${this.cond(c, env)}}`;
  }

  // ---- transforms (3D, or 2D in an extrusion)
  private transform(s: Extract<Stmt, { t: "inst" }>, ctx: Ctx): string[] {
    const env = ctx.env;
    const A = (pos: number, ...names: string[]) => this.arg(s.args, pos, ...names);
    const flat3d = ctx.mode === "3d" || (ctx.mode === "2d" && ctx.linear);
    if (s.name === "color") {
      this.warn(s.line, "color() dropped: set color on the <part> instead");
      return this.children(s.children, ctx);
    }
    if (s.name === "resize") {
      this.warn(s.line, "resize() isn't supported: children kept at their size");
      return this.children(s.children, ctx);
    }
    if (flat3d) {
      // 3D transform element (exact for 2D shapes under linear_extrude too: planar transforms
      // commute with the extrusion)
      const kids = this.children(s.children, ctx);
      const v = A(0, "v", "m");
      switch (s.name) {
        case "translate":
          return [el("translate", [`by={${this.vec3(v, env, 0)}}`], kids)];
        case "mirror":
          return [el("mirror", [`axis={${this.vec3(v, env, 0)}}`], kids)];
        case "scale": {
          const x = A(0, "v");
          const e = x ? this.expr(x, env) : undefined;
          const by = !e ? "1" : e.kind === "num" && ctx.mode === "3d" ? e.code : ctx.mode === "2d" ? `${this.h("$s2")}(${e.code})` : x!.t === "vec" && x!.items.length === 3 ? e.code : `${this.h("$s3")}(${e.code})`;
          return [el("scale", [`by={${by}}`], kids)];
        }
        case "rotate": {
          const a = A(0, "a"), axis = A(1, "v");
          if (axis) return [el("rotate", [`axis={${this.vec3(axis, env, 0)}}`, `angle={${this.e(a, env) ?? "0"}}`], kids)];
          if (!a) return kids;
          const e = this.expr(a, env);
          if (e.kind === "num") return [el("rotate", [`z={${e.code}}`], kids)];
          if (a.t === "vec" && a.items.length === 3) return [el("rotate", [`by={${e.code}}`], kids)];
          return [el("rotate", [`by={${this.h("$rot")}(${e.code})}`], kids)];
        }
        case "multmatrix":
          this.warn(s.line, "multmatrix() isn't supported: children left in place");
          return kids;
      }
    }
    // 2D transforms where the extrusion is not known to be linear: sketch placement props
    const v = A(0, "v");
    let props: string[] | undefined;
    switch (s.name) {
      case "translate": {
        const e = v && this.expr(v, env);
        props = e ? [`at={${v!.t === "vec" && v!.items.length === 2 ? e.code : `${this.h("$xy")}(${e.code})`}}`] : [];
        break;
      }
      case "rotate": {
        if (A(1, "v")) this.warn(s.line, "rotate(a, v) on a 2D shape: only rotation about Z is meaningful");
        const a = A(0, "a");
        const e = a && this.expr(a, env);
        props = e ? [`rotate={${e.kind === "num" ? e.code : `${this.h("$rz")}(${e.code})`}}`] : [];
        break;
      }
      case "mirror": {
        const lit = v?.t === "vec" ? v.items.map((x) => (isExpr(x) && x.t === "num" ? x.v : NaN)) : [];
        if (lit[0] && !lit[1]) props = [`mirror="x"`];
        else if (!lit[0] && lit[1]) props = [`mirror="y"`];
        else {
          this.warn(s.line, "2D mirror() about a slanted axis isn't supported here: ignored");
          props = [];
        }
        break;
      }
      case "scale": {
        // scale() of a circle is an ellipse; otherwise unsupported for 2D outside linear extrusion
        const only = s.children.length === 1 && s.children[0]!.t === "inst" ? (s.children[0] as Extract<Stmt, { t: "inst" }>) : undefined;
        const e = v && this.expr(v, env);
        if (only?.name === "circle" && e) {
          const r = this.arg(only.args, 0, "r"), d = this.arg(only.args, -1, "d");
          const rr = r ? this.expr(r, env).code : d ? `${paren(this.expr(d, env).code)} / 2` : "1";
          const sv = `${this.h("$s3")}(${e.code})`;
          const shape = el("ellipse", [`rx={${paren(rr)} * ${sv}[0]}`, `ry={${paren(rr)} * ${sv}[1]}`], []);
          return [ctx.mode === "raw" ? shape : ctx.wrap(shape)];
        }
        this.warn(s.line, "2D scale() isn't supported inside rotate_extrude or a 2D module: ignored");
        props = [];
        break;
      }
      default:
        this.warn(s.line, `2D ${s.name}() isn't supported: ignored`);
        props = [];
    }
    if (!props.length) return this.children(s.children, ctx);
    const p = props;
    const inner: Ctx = { ...ctx, wrap: (x) => ctx.wrap(el("sketch", p, [x])) };
    if (ctx.mode === "raw") return [el("sketch", p, this.children(s.children, { ...ctx, wrap: (x) => x }))];
    return this.children(s.children, inner);
  }

  private vec3(v: Expr | undefined, env: Env, pad: number): string {
    if (!v) return "[0, 0, 0]";
    const e = this.expr(v, env);
    if (v.t === "vec" && v.items.every(isExpr) && v.items.length <= 3 && v.items.length >= 2) {
      const items = v.items.map((x) => this.expr(x as Expr, env).code);
      while (items.length < 3) items.push(String(pad));
      return `[${items.join(", ")}]`;
    }
    return `${this.h("$v3")}(${e.code})`;
  }

  // ---------------------------------------------------------------------------------------------
  // Expressions

  private cond(e: Expr, env: Env): string {
    const x = this.expr(e, env);
    return x.kind === "bool" || x.kind === "num" ? x.code : `${this.h("$t")}(${x.code})`;
  }

  private iterable(e: Expr, env: Env): { code: string; item: Kind } {
    if (e.t === "range") {
      const a = this.expr(e.start, env).code, b = this.expr(e.end, env).code;
      const st = e.step ? this.expr(e.step, env).code : undefined;
      return { code: `${this.h("$range")}(${a}, ${b}${st ? `, ${st}` : ""})`, item: "num" };
    }
    const x = this.expr(e, env);
    if (e.t === "vec") return { code: x.code, item: e.items.every((i) => isExpr(i) && i.t === "num") ? "num" : "any" };
    return { code: `${this.h("$iter")}(${x.code})`, item: "any" };
  }

  expr(e: Expr, env: Env): { code: string; kind: Kind; prec: number } {
    switch (e.t) {
      case "num":
        return { code: e.src.startsWith(".") ? `0${e.src}` : e.src.replace(/\.$/, ""), kind: "num", prec: 20 };
      case "str":
        return { code: JSON.stringify(e.v), kind: "str", prec: 20 };
      case "bool":
        return { code: String(e.v), kind: "bool", prec: 20 };
      case "undef":
        return { code: "undefined", kind: "undef", prec: 20 };
      case "id": {
        const v = env.get(e.name);
        if (v) return { code: v.js, kind: v.kind, prec: 20 };
        if (e.name === "PI") return { code: "Math.PI", kind: "num", prec: 20 };
        if (e.name === "$children") return { code: `${this.h("$count")}(children)`, kind: "num", prec: 20 };
        if (e.name === "$preview") return { code: "false", kind: "bool", prec: 20 };
        if (e.name === "$t") return { code: "0", kind: "num", prec: 20 };
        if (e.name.startsWith("$")) return { code: "undefined", kind: "undef", prec: 20 };
        const f = this.functions.get(e.name);
        if (f) return { code: f.js, kind: "fn", prec: 20 };
        this.warn(e.line, `unknown variable ${e.name} (undef)`);
        return { code: "undefined", kind: "undef", prec: 20 };
      }
      case "vec":
        return this.vector(e.items, env);
      case "range": {
        const it = this.iterable(e, env);
        return { code: it.code, kind: "vec", prec: 20 };
      }
      case "unary": {
        const x = this.expr(e.e, env);
        if (e.op === "!") return { code: x.kind === "bool" || x.kind === "num" ? `!${p(x, 15)}` : `!${this.h("$t")}(${x.code})`, kind: "bool", prec: 15 };
        if (x.kind === "num") return { code: `-${p(x, 15)}`, kind: "num", prec: 15 };
        return { code: `${this.h("$neg")}(${x.code})`, kind: x.kind === "vec" ? "vec" : "any", prec: 20 };
      }
      case "bin":
        return this.binary(e, env);
      case "tern": {
        const c = this.cond(e.c, env);
        const a = this.expr(e.a, env), b = this.expr(e.b, env);
        return { code: `${c.includes(" ") && !c.startsWith("$") ? `(${c})` : c} ? ${p(a, 3)} : ${p(b, 3)}`, kind: a.kind === b.kind ? a.kind : "any", prec: 3 };
      }
      case "index": {
        const x = this.expr(e.e, env), i = this.expr(e.i, env);
        return { code: `${p(x, 19)}[${i.code}]${x.kind === "vec" ? "!" : ""}`, kind: "any", prec: 19 };
      }
      case "member": {
        const x = this.expr(e.e, env);
        const k = { x: 0, y: 1, z: 2 }[e.name];
        return { code: k === undefined ? `${p(x, 19)}.${e.name}` : `${p(x, 19)}[${k}]`, kind: "any", prec: 19 };
      }
      case "let": {
        const inner = env.child();
        const lines: string[] = [];
        for (const a of e.assigns) {
          const v = this.expr(a.value, inner);
          inner.set(a.name, { js: jsName(a.name), kind: v.kind });
          lines.push(`const ${jsName(a.name)} = ${v.code}`);
        }
        const b = this.expr(e.body, inner);
        return { code: `(() => {\n${indent([...lines, `return ${b.code}`].join("\n"))}\n})()`, kind: b.kind, prec: 19 };
      }
      case "fn": {
        const inner = env.child();
        const ps = this.paramList(e.params, inner);
        const b = this.expr(e.body, inner);
        return { code: `((${ps.map((x) => (x.code.includes("=") ? x.code.replace(/^(\S+) =/, `$1: ${x.type} =`) : `${x.code}?: any`)).join(", ")}): any => ${p(b, 3)})`, kind: "fn", prec: 20 };
      }
      case "echo":
        return this.expr(e.body, env);
      case "call":
        return this.call(e, env);
    }
  }

  private binary(e: Extract<Expr, { t: "bin" }>, env: Env): { code: string; kind: Kind; prec: number } {
    const l = this.expr(e.l, env), r = this.expr(e.r, env);
    const num = l.kind === "num" && r.kind === "num";
    const prec: Record<string, number> = { "||": 4, "&&": 5, "==": 8, "!=": 8, "<": 9, "<=": 9, ">": 9, ">=": 9, "+": 11, "-": 11, "*": 12, "/": 12, "%": 12, "^": 13 };
    const pr = prec[e.op]!;
    const nat = (op: string, kind: Kind) => ({ code: `${p(l, pr)} ${op} ${p(r, pr + (op === "**" ? 0 : 1))}`, kind, prec: pr });
    switch (e.op) {
      case "+":
      case "-":
        if (num) return nat(e.op, "num");
        return { code: `${this.h(e.op === "+" ? "$add" : "$sub")}(${l.code}, ${r.code})`, kind: l.kind === "vec" || r.kind === "vec" ? "vec" : "any", prec: 20 };
      case "*":
        if (num) return nat("*", "num");
        return { code: `${this.h("$mul")}(${l.code}, ${r.code})`, kind: "any", prec: 20 };
      case "/":
        if (num) return nat("/", "num");
        return { code: `${this.h("$div")}(${l.code}, ${r.code})`, kind: l.kind === "vec" ? "vec" : "any", prec: 20 };
      case "%":
        return nat("%", "num");
      case "^":
        return { code: `${p(l, 14)} ** ${p(r, 13)}`, kind: "num", prec: 13 };
      case "<":
      case "<=":
      case ">":
      case ">=":
        return nat(e.op, "bool");
      case "==":
      case "!=": {
        const simple = (k: Kind) => k === "num" || k === "str" || k === "bool" || k === "undef";
        if (simple(l.kind) && simple(r.kind)) return nat(e.op === "==" ? "===" : "!==", "bool");
        const c = `${this.h("$eq")}(${l.code}, ${r.code})`;
        return { code: e.op === "==" ? c : `!${c}`, kind: "bool", prec: e.op === "==" ? 20 : 15 };
      }
      case "&&":
      case "||": {
        const t = (x: { code: string; kind: Kind; prec: number }) => (x.kind === "bool" ? p(x, pr + 1) : `${this.h("$t")}(${x.code})`);
        return { code: `${t(l)} ${e.op} ${t(r)}`, kind: "bool", prec: pr };
      }
    }
    return { code: "undefined", kind: "undef", prec: 20 };
  }

  private call(e: Extract<Expr, { t: "call" }>, env: Env): { code: string; kind: Kind; prec: number } {
    const args = e.args.map((a) => ({ ...a, x: this.expr(a.value, env) }));
    const codes = args.map((a) => a.x.code);
    const allNum = args.every((a) => a.x.kind === "num");
    if (e.f.t === "id" && !env.get(e.f.name)) {
      const name = e.f.name;
      const user = this.functions.get(name);
      if (user) {
        const ordered: string[] = [];
        let pos = 0;
        for (const a of args) {
          const i = a.name ? user.params.findIndex((p) => p.name === a.name) : pos++;
          if (i < 0) {
            this.warn(e.line, `${name}() has no parameter ${a.name}`);
            continue;
          }
          ordered[i] = a.x.code;
          this.record(`fn:${name}.${user.params[i]?.name}`, a.x.kind);
        }
        const filled = Array.from({ length: ordered.length }, (_, i) => ordered[i] ?? "undefined");
        user.params.forEach((pp, i) => {
          if (ordered[i] === undefined && !pp.dflt) this.record(`fn:${name}.${pp.name}`, "undef");
        });
        return { code: `${user.js}(${filled.join(", ")})`, kind: "any", prec: 20 };
      }
      const math: Record<string, string> = { abs: "Math.abs", sqrt: "Math.sqrt", floor: "Math.floor", ceil: "Math.ceil", exp: "Math.exp", pow: "Math.pow" };
      if (math[name]) return { code: `${math[name]}(${codes.join(", ")})`, kind: "num", prec: 20 };
      const deg = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2"];
      if (deg.includes(name)) return { code: `${this.h("$" + name)}(${codes.join(", ")})`, kind: "num", prec: 20 };
      switch (name) {
        case "min":
        case "max":
          if (allNum && args.length > 1) return { code: `Math.${name}(${codes.join(", ")})`, kind: "num", prec: 20 };
          return { code: `${this.h("$" + name)}(${codes.join(", ")})`, kind: "num", prec: 20 };
        case "round":
          return { code: `${this.h("$round")}(${codes[0]})`, kind: "num", prec: 20 };
        case "sign":
          return { code: `${this.h("$sign")}(${codes[0]})`, kind: "num", prec: 20 };
        case "ln":
          return { code: `Math.log(${codes[0]})`, kind: "num", prec: 20 };
        case "log":
          return { code: codes.length > 1 ? `Math.log(${codes[1]}) / Math.log(${codes[0]})` : `Math.log10(${codes[0]})`, kind: "num", prec: 20 };
        case "len":
          return { code: `${this.h("$len")}(${codes[0]})`, kind: "num", prec: 20 };
        case "concat":
          return { code: `${this.h("$concat")}(${codes.join(", ")})`, kind: "vec", prec: 20 };
        case "str":
          return { code: `${this.h("$str")}(${codes.join(", ")})`, kind: "str", prec: 20 };
        case "chr":
          return { code: `String.fromCodePoint(...[${codes.join(", ")}].flat())`, kind: "str", prec: 20 };
        case "ord":
          return { code: `${codes[0]}.codePointAt(0)`, kind: "num", prec: 20 };
        case "norm":
          return { code: `${this.h("$norm")}(${codes[0]})`, kind: "num", prec: 20 };
        case "cross":
          return { code: `${this.h("$cross")}(${codes.join(", ")})`, kind: "any", prec: 20 };
        case "lookup":
          return { code: `${this.h("$lookup")}(${codes.join(", ")})`, kind: "num", prec: 20 };
        case "is_num":
        case "is_list":
        case "is_string":
        case "is_bool":
        case "is_undef":
        case "is_function":
          return { code: `${this.h("$is")}("${name.slice(3)}", ${codes[0]})`, kind: "bool", prec: 20 };
        case "rands":
          this.warn(e.line, "rands(): random numbers make the model change on every run");
          return { code: `Array.from({ length: ${codes[2] ?? 1} }, () => ${codes[0]} + Math.random() * (${codes[1]} - ${codes[0]}))`, kind: "vec", prec: 20 };
        case "version":
          return { code: "[2021, 1, 0]", kind: "vec", prec: 20 };
        case "search":
        case "parent_module":
        case "textmetrics":
        case "fontmetrics":
          this.warn(e.line, `${name}() isn't supported (undef)`);
          return { code: "undefined", kind: "undef", prec: 20 };
      }
      this.warn(e.line, `unknown function ${name}() (undef)`);
      return { code: "undefined", kind: "undef", prec: 20 };
    }
    const f = this.expr(e.f, env);
    return { code: `${p(f, 19)}(${codes.join(", ")})`, kind: "any", prec: 19 };
  }

  private vector(items: Elem[], env: Env): { code: string; kind: Kind; prec: number } {
    if (items.every(isExpr)) {
      const xs = items.map((x) => this.expr(x as Expr, env).code);
      const code = `[${xs.join(", ")}]`;
      return { code, kind: "vec", prec: 20 };
    }
    // with comprehensions: each element as an array, spread together
    const parts = items.map((x) => this.elem(x, env));
    if (parts.length === 1 && !parts[0]!.plain) return { code: parts[0]!.code, kind: "vec", prec: 20 };
    return { code: `[${parts.map((x) => (x.plain ? x.code.slice(1, -1) : `...${x.code}`)).join(", ")}]`, kind: "vec", prec: 20 };
  }

  /** A list element as an array expression (`plain`: a one-element literal). */
  private elem(x: Elem, env: Env): { code: string; plain: boolean } {
    if (isExpr(x)) return { code: `[${this.expr(x, env).code}]`, plain: true };
    switch (x.t) {
      case "lc-for": {
        const go = (i: number, en: Env): string => {
          const a = x.assigns[i]!;
          const it = this.iterable(a.value, en);
          const inner = en.child();
          inner.set(a.name, { js: jsName(a.name), kind: it.item });
          const type = it.item === "num" ? "number" : "any";
          if (i + 1 < x.assigns.length) return `${it.code}.flatMap((${jsName(a.name)}: ${type}) => ${go(i + 1, inner)})`;
          if (isExpr(x.body)) return `${it.code}.map((${jsName(a.name)}: ${type}) => ${this.expr(x.body, inner).code})`;
          return `${it.code}.flatMap((${jsName(a.name)}: ${type}) => ${this.elem(x.body, inner).code})`;
        };
        return { code: go(0, env), plain: false };
      }
      case "lc-cfor": {
        this.tmp++;
        const inner = env.child();
        const lines: string[] = ["const out: any[] = []"];
        const names = x.init.map((a) => {
          const v = this.expr(a.value, inner);
          inner.set(a.name, { js: jsName(a.name), kind: v.kind });
          return `let ${jsName(a.name)}: any = ${v.code}`;
        });
        lines.push(...names);
        const cond = this.cond(x.cond, inner);
        const body = this.elem(x.body, inner).code;
        const upd = x.update.map((a) => `${jsName(a.name)} = ${this.expr(a.value, inner).code}`);
        lines.push(`while (${cond}) {\n  out.push(...${body})\n  ;[${upd.join(", ")}].forEach(() => {})\n}`);
        // sequential updates (OpenSCAD evaluates them in order)
        lines[lines.length - 1] = `while (${cond}) {\n  out.push(...${body})\n${indent(upd.join("\n"))}\n}`;
        lines.push("return out");
        return { code: `(() => {\n${indent(lines.join("\n"))}\n})()`, plain: false };
      }
      case "lc-if": {
        const c = this.cond(x.c, env);
        return { code: `(${c} ? ${this.elem(x.a, env).code} : ${x.b ? this.elem(x.b, env).code : "[]"})`, plain: false };
      }
      case "lc-let": {
        const inner = env.child();
        const lines: string[] = [];
        for (const a of x.assigns) {
          const v = this.expr(a.value, inner);
          inner.set(a.name, { js: jsName(a.name), kind: v.kind });
          lines.push(`const ${jsName(a.name)} = ${v.code}`);
        }
        return { code: `(() => {\n${indent([...lines, `return ${this.elem(x.body, inner).code}`].join("\n"))}\n})()`, plain: false };
      }
      case "lc-each":
        return { code: isExpr(x.e) ? `${this.h("$each")}(${this.expr(x.e, env).code})` : this.elem(x.e, env).code, plain: false };
    }
  }
}

// ---------------------------------------------------------------------------------------------

function p(x: { code: string; prec: number }, min: number): string {
  return x.prec < min ? `(${x.code})` : x.code;
}
function paren(code: string): string {
  return /^[\w.$[\]]+$/.test(code) ? code : `(${code})`;
}

/** Child text as a single JSX expression. */
function frag(child: string): string {
  if (child.startsWith("<") && !child.startsWith("<>")) return child;
  if (child.startsWith("{") && child.endsWith("}")) return child.slice(1, -1);
  return `<>${child}</>`;
}

/** A JSX element as text. */
export function el(tag: string, props: string[], kids: string[]): string {
  const ps = props.filter(Boolean);
  const open = `<${tag}${ps.length ? " " + ps.join(" ") : ""}`;
  if (!kids.length) return `${open} />`;
  const oneLine = kids.length === 1 && !kids[0]!.includes("\n") && open.length + kids[0]!.length < 90;
  if (oneLine) return `${open}>${kids[0]}</${tag}>`;
  return `${open}>\n${indent(kids.join("\n"))}\n</${tag}>`;
}

function literal(e: Expr): number | string | boolean | undefined {
  if (e.t === "num") return e.v;
  if (e.t === "str") return e.v;
  if (e.t === "bool") return e.v;
  if (e.t === "unary" && e.op === "-" && e.e.t === "num") return -e.e.v;
  return undefined;
}

/** The Customizer section (`/* [Name] *\/`) in force at `line`. */
function sectionAt(comments: Comment[], line: number): string | undefined {
  let s: string | undefined;
  for (const c of comments) {
    if (c.line >= line) break;
    const m = c.block ? /^\[([^\]]+)\]$/.exec(c.text.trim()) : undefined;
    if (m) s = m[1]!.trim();
  }
  return s;
}

function usesChildren(stmts: Stmt[]): boolean {
  const walk = (x: unknown): boolean => {
    if (!x || typeof x !== "object") return false;
    const o = x as any;
    if (o.t === "inst" && o.name === "children") return true;
    if (o.t === "id" && o.name === "$children") return true;
    if (o.t === "module") return false;
    return Object.values(o).some((v) => (Array.isArray(v) ? v.some(walk) : walk(v)));
  };
  return stmts.some(walk);
}
