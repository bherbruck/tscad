/**
 * OpenSCAD parser → AST. Covers the language as used in practice: assignments, expressions
 * (vectors, ranges, ternaries, let, list comprehensions, function literals), functions,
 * modules with defaults, module instantiation with modifiers, if/else, include/use.
 */
import { ScadSyntaxError, tokenize, type Comment, type Token } from "./lexer";

export type Expr =
  | { t: "num"; v: number; src: string }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "undef" }
  | { t: "id"; name: string; line: number }
  | { t: "vec"; items: Elem[] }
  | { t: "range"; start: Expr; step?: Expr; end: Expr }
  | { t: "unary"; op: string; e: Expr }
  | { t: "bin"; op: string; l: Expr; r: Expr }
  | { t: "tern"; c: Expr; a: Expr; b: Expr }
  | { t: "call"; f: Expr; args: Arg[]; line: number }
  | { t: "index"; e: Expr; i: Expr }
  | { t: "member"; e: Expr; name: string }
  | { t: "let"; assigns: Assign[]; body: Expr }
  | { t: "fn"; params: Param[]; body: Expr }
  | { t: "echo"; args: Arg[]; body: Expr };

/** A list element: an expression or a comprehension. */
export type Elem =
  | Expr
  | { t: "lc-for"; assigns: Assign[]; body: Elem }
  | { t: "lc-cfor"; init: Assign[]; cond: Expr; update: Assign[]; body: Elem }
  | { t: "lc-if"; c: Expr; a: Elem; b?: Elem }
  | { t: "lc-let"; assigns: Assign[]; body: Elem }
  | { t: "lc-each"; e: Elem };

export interface Arg {
  name?: string;
  value: Expr;
}
export interface Param {
  name: string;
  dflt?: Expr;
}
export interface Assign {
  name: string;
  value: Expr;
}

export type Stmt =
  | { t: "assign"; name: string; value: Expr; line: number }
  | { t: "module"; name: string; params: Param[]; body: Stmt[]; line: number }
  | { t: "function"; name: string; params: Param[]; body: Expr; line: number }
  | { t: "inst"; name: string; args: Arg[]; children: Stmt[]; modifier?: string; line: number }
  | { t: "if"; c: Expr; then: Stmt[]; else?: Stmt[]; modifier?: string; line: number }
  | { t: "block"; body: Stmt[]; line: number }
  | { t: "use"; kind: "include" | "use"; path: string; line: number };

export interface Program {
  body: Stmt[];
  comments: Comment[];
}

export function parse(src: string): Program {
  // include/use <file> are line-level directives with an unquoted path
  const uses: Stmt[] = [];
  const cleaned = src.replace(/^[ \t]*(include|use)[ \t]*<([^>\n]*)>[ \t]*;?/gm, (m, kind: string, path: string, offset: number) => {
    const line = src.slice(0, offset).split("\n").length;
    uses.push({ t: "use", kind: kind as "include" | "use", path: path.trim(), line });
    return " ".repeat(m.length);
  });
  const { tokens, comments } = tokenize(cleaned);
  const p = new Parser(tokens);
  const body = p.statements(true);
  return { body: [...uses, ...body].sort((a, b) => a.line - b.line), comments };
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private get tok(): Token {
    return this.toks[this.i]!;
  }
  private peek(k = 1): Token {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)]!;
  }
  private is(text: string): boolean {
    const t = this.tok;
    return (t.kind === "op" || t.kind === "id") && t.text === text;
  }
  private eat(text: string): boolean {
    if (this.is(text)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(text: string): Token {
    if (!this.is(text)) this.error(`expected "${text}"${this.tok.kind === "eof" ? " before the end" : `, got "${this.tok.text}"`}`);
    return this.toks[this.i++]!;
  }
  private error(msg: string, t: Token = this.tok): never {
    throw new ScadSyntaxError(msg, t.line, t.col);
  }
  private ident(): string {
    if (this.tok.kind !== "id") this.error(`expected a name, got "${this.tok.text || "end of file"}"`);
    return this.toks[this.i++]!.text;
  }

  // ---- statements

  statements(top = false): Stmt[] {
    const out: Stmt[] = [];
    while (this.tok.kind !== "eof" && !(this.is("}") && !top)) {
      if (this.is("}")) this.error('unexpected "}"');
      const s = this.statement();
      if (s) out.push(s);
    }
    return out;
  }

  /** A statement's body: `;`, a block, or one statement. */
  private child(): Stmt[] {
    if (this.eat(";")) return [];
    if (this.eat("{")) {
      const b = this.statements();
      this.expect("}");
      return b;
    }
    const s = this.statement();
    return s ? [s] : [];
  }

  private statement(): Stmt | null {
    const t = this.tok;
    if (this.eat(";")) return null;
    if (this.is("{")) {
      this.i++;
      const body = this.statements();
      this.expect("}");
      return { t: "block", body, line: t.line };
    }
    if (this.is("module") && this.peek().kind === "id") {
      this.i++;
      const name = this.ident();
      this.expect("(");
      const params = this.params();
      const body = this.child();
      return { t: "module", name, params, body, line: t.line };
    }
    if (this.is("function") && this.peek().kind === "id") {
      this.i++;
      const name = this.ident();
      this.expect("(");
      const params = this.params();
      this.expect("=");
      const body = this.expr();
      this.expect(";");
      return { t: "function", name, params, body, line: t.line };
    }
    if (t.kind === "id" && this.peek().text === "=" && this.peek().kind === "op") {
      this.i += 2;
      const value = this.expr();
      this.expect(";");
      return { t: "assign", name: t.text, value, line: t.line };
    }
    return this.instantiation();
  }

  private instantiation(): Stmt {
    const t = this.tok;
    let modifier: string | undefined;
    while (this.tok.kind === "op" && ["!", "#", "%", "*"].includes(this.tok.text)) modifier = this.toks[this.i++]!.text;
    if (this.is("if")) {
      this.i++;
      this.expect("(");
      const c = this.expr();
      this.expect(")");
      const then = this.child();
      const els = this.eat("else") ? this.child() : undefined;
      return { t: "if", c, then, ...(els ? { else: els } : {}), ...(modifier ? { modifier } : {}), line: t.line };
    }
    const name = this.ident();
    this.expect("(");
    const args = this.args();
    const children = this.child();
    return { t: "inst", name, args, children, ...(modifier ? { modifier } : {}), line: t.line };
  }

  private params(): Param[] {
    const out: Param[] = [];
    while (!this.eat(")")) {
      const name = this.ident();
      const dflt = this.eat("=") ? this.expr() : undefined;
      out.push({ name, ...(dflt ? { dflt } : {}) });
      if (!this.is(")")) this.expect(",");
    }
    return out;
  }

  /** Call arguments after "(" (consumes ")"). */
  private args(): Arg[] {
    const out: Arg[] = [];
    while (!this.eat(")")) {
      if (this.tok.kind === "id" && this.peek().text === "=" && this.peek().kind === "op") {
        const name = this.ident();
        this.i++;
        out.push({ name, value: this.expr() });
      } else out.push({ value: this.expr() });
      if (!this.is(")")) this.expect(",");
    }
    return out;
  }

  private assigns(): Assign[] {
    // after "(" ; consumes ")"
    const out: Assign[] = [];
    while (!this.eat(")")) {
      const name = this.ident();
      this.expect("=");
      out.push({ name, value: this.expr() });
      if (!this.is(")")) this.expect(",");
    }
    return out;
  }

  // ---- expressions (precedence: ternary < || < && < ==,!= < <,> < +,- < *,/,% < ^ < unary < postfix)

  expr(): Expr {
    if (this.is("let") && this.peek().text === "(") {
      this.i += 2;
      const assigns = this.assigns();
      return { t: "let", assigns, body: this.expr() };
    }
    if (this.is("function") && this.peek().text === "(") {
      this.i += 2;
      const params = this.params();
      return { t: "fn", params, body: this.expr() };
    }
    if ((this.is("assert") || this.is("echo")) && this.peek().text === "(") {
      this.i += 2;
      const args = this.args();
      // `assert(...) expr` / `echo(...) expr`: the expression is the value
      if (this.is(")") || this.is(";") || this.is(",") || this.is("]")) return { t: "undef" };
      return { t: "echo", args, body: this.expr() };
    }
    const c = this.binary(0);
    if (this.eat("?")) {
      const a = this.expr();
      this.expect(":");
      const b = this.expr();
      return { t: "tern", c, a, b };
    }
    return c;
  }

  private static LEVELS = [["||"], ["&&"], ["==", "!="], ["<", "<=", ">", ">="], ["+", "-"], ["*", "/", "%"], ["^"]];

  private binary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.unary();
    let l = this.binary(level + 1);
    for (;;) {
      const t = this.tok;
      if (t.kind !== "op" || !Parser.LEVELS[level]!.includes(t.text)) return l;
      this.i++;
      // ^ is right-associative
      const r = t.text === "^" ? this.binary(level) : this.binary(level + 1);
      l = { t: "bin", op: t.text, l, r };
    }
  }

  private unary(): Expr {
    const t = this.tok;
    if (t.kind === "op" && (t.text === "-" || t.text === "+" || t.text === "!")) {
      this.i++;
      const e = this.unary();
      return t.text === "+" ? e : { t: "unary", op: t.text, e };
    }
    return this.postfix(this.primary());
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      const t = this.tok;
      if (this.eat("(")) e = { t: "call", f: e, args: this.args(), line: t.line };
      else if (this.eat("[")) {
        const i = this.expr();
        this.expect("]");
        e = { t: "index", e, i };
      } else if (this.is(".") && this.peek().kind === "id") {
        this.i++;
        e = { t: "member", e, name: this.ident() };
      } else return e;
    }
  }

  private primary(): Expr {
    const t = this.tok;
    if (t.kind === "num") {
      this.i++;
      return { t: "num", v: t.value!, src: t.text };
    }
    if (t.kind === "str") {
      this.i++;
      return { t: "str", v: t.text };
    }
    if (t.kind === "id") {
      this.i++;
      if (t.text === "true" || t.text === "false") return { t: "bool", v: t.text === "true" };
      if (t.text === "undef") return { t: "undef" };
      return { t: "id", name: t.text, line: t.line };
    }
    if (this.eat("(")) {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (this.eat("[")) return this.list(t);
    return this.error(`unexpected "${t.text || "end of file"}" in an expression`);
  }

  /** After "[": a vector, a range or a list comprehension. */
  private list(open: Token): Expr {
    if (this.eat("]")) return { t: "vec", items: [] };
    const first = this.elem();
    if (this.is(":") && isExpr(first)) {
      this.i++;
      const second = this.expr();
      if (this.eat(":")) {
        const end = this.expr();
        this.expect("]");
        return { t: "range", start: first, step: second, end };
      }
      this.expect("]");
      return { t: "range", start: first, end: second };
    }
    const items: Elem[] = [first];
    while (this.eat(",")) {
      if (this.is("]")) break;
      items.push(this.elem());
    }
    if (!this.eat("]")) this.error(`expected "]" to close the list opened on line ${open.line}`);
    return { t: "vec", items };
  }

  private elem(): Elem {
    if (this.is("for") && this.peek().text === "(") {
      this.i += 2;
      // C-style: for (i = 0; i < n; i = i + 1)
      const init: Assign[] = [];
      while (!this.is(";") && !this.is(")")) {
        const name = this.ident();
        this.expect("=");
        init.push({ name, value: this.expr() });
        if (this.is(",")) this.i++;
      }
      if (this.eat(";")) {
        const cond = this.expr();
        this.expect(";");
        const update: Assign[] = [];
        while (!this.eat(")")) {
          const name = this.ident();
          this.expect("=");
          update.push({ name, value: this.expr() });
          if (!this.is(")")) this.expect(",");
        }
        return { t: "lc-cfor", init, cond, update, body: this.elem() };
      }
      this.expect(")");
      return { t: "lc-for", assigns: init, body: this.elem() };
    }
    if (this.is("if") && this.peek().text === "(") {
      this.i += 2;
      const c = this.expr();
      this.expect(")");
      const a = this.elem();
      const b = this.eat("else") ? this.elem() : undefined;
      return { t: "lc-if", c, a, ...(b ? { b } : {}) };
    }
    if (this.is("let") && this.peek().text === "(") {
      // `let` in a list: a comprehension when its body is one
      const save = this.i;
      this.i += 2;
      const assigns = this.assigns();
      if (this.is("for") || this.is("if") || this.is("each") || this.is("let")) return { t: "lc-let", assigns, body: this.elem() };
      this.i = save;
    }
    if (this.is("each")) {
      this.i++;
      return { t: "lc-each", e: this.elem() };
    }
    if (this.eat("(")) {
      // parenthesised comprehension element
      if (this.is("for") || this.is("if") || this.is("each")) {
        const e = this.elem();
        this.expect(")");
        return e;
      }
      this.i--;
    }
    return this.expr();
  }
}

export function isExpr(e: Elem): e is Expr {
  return !e.t.startsWith("lc-");
}
