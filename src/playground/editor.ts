/** The playground's code editor: CodeMirror 6 with TSX, tscad-aware completion and error squiggles. */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript, localCompletionSource } from "@codemirror/lang-javascript";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { NamedDoc, TagInfo } from "./extract";

export interface CompletionData {
  tags: TagInfo[];
  selectors: NamedDoc[];
  exports: NamedDoc[];
  materials: NamedDoc[];
}

export interface EditorProblem {
  line: number;
  column?: number;
  message: string;
  severity?: "error" | "warning";
}

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: "var(--tk-k)" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "var(--tk-s)" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "var(--tk-n)" },
  { tag: [t.tagName, t.typeName, t.className, t.namespace], color: "var(--tk-t)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--tk-a)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--tk-f)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--tk-c)", fontStyle: "italic" },
  { tag: [t.angleBracket, t.bracket, t.punctuation, t.separator], color: "var(--text-3)" },
  { tag: t.definition(t.variableName), color: "var(--text)" },
  { tag: t.invalid, color: "var(--err)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--accent)", padding: "10px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-3)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 14px", minWidth: "40px" },
  ".cm-activeLine": { backgroundColor: "var(--hover)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--amber) 16%, transparent)" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--text-3)", padding: "0 4px" },
  ".cm-tooltip": { backgroundColor: "var(--panel-solid)", border: "1px solid var(--line-2)", borderRadius: "10px", boxShadow: "0 12px 40px rgba(0,0,0,.35)", overflow: "hidden" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--mono)", fontSize: "12.5px", maxHeight: "18em" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 10px !important" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
  ".cm-completionDetail": { color: "var(--text-3)", fontStyle: "normal", marginLeft: "1em" },
  ".cm-completionInfo": { padding: "8px 12px", maxWidth: "340px", fontFamily: "var(--font)", fontSize: "12px", lineHeight: "1.5", color: "var(--text-2)" },
  ".cm-completionIcon": { opacity: "0.7" },
  ".cm-diagnostic": { fontFamily: "var(--mono)", fontSize: "12px", padding: "6px 10px" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--err)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--err)", textUnderlineOffset: "3px", textDecorationSkipInk: "none" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--warn)", textUnderlineOffset: "3px" },
  ".cm-lint-marker": { width: "0.9em", height: "0.9em" },
  ".cm-panels": { backgroundColor: "var(--panel-solid)", color: "var(--text)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--amber) 30%, transparent)" },
});

const PARAM_TYPES = ["number", "int", "boolean", "choice", "text", "color"];

function md(doc: string): () => Node {
  return () => {
    const el = document.createElement("div");
    el.innerHTML = doc.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    return el;
  };
}

/** tscad-aware completions: element tags, their props, selector methods, imports, materials, param types. */
export function tscadCompletions(data: CompletionData) {
  const tagMap = new Map(data.tags.map((t) => [t.tag, t]));
  const tagOptions: Completion[] = data.tags.map((t) => ({ label: t.tag, type: "type", detail: "element", info: t.doc ? md(t.doc) : undefined, boost: 2 }));
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 3000), ctx.pos);
    const line = ctx.state.doc.lineAt(ctx.pos);
    const lineBefore = line.text.slice(0, ctx.pos - line.from);

    // <tag|
    let m = before.match(/<([a-zA-Z]*)$/);
    if (m) return { from: ctx.pos - m[1]!.length, options: tagOptions, validFor: /^\w*$/ };

    // edges.top().|  faces.|
    m = lineBefore.match(/\b(edges|faces)((?:\.\w+\([^()]*\))*)\.(\w*)$/);
    if (m) {
      return {
        from: ctx.pos - m[3]!.length,
        options: data.selectors.map((s) => ({ label: s.name, type: "method", detail: s.detail, info: md(s.doc), apply: s.detail === "()" ? `${s.name}()` : undefined })),
        validFor: /^\w*$/,
      };
    }

    // material="|
    m = lineBefore.match(/\bmaterial=\{?["']([\w-]*)$/);
    if (m) return { from: ctx.pos - m[1]!.length, options: data.materials.map((x) => ({ label: x.name, type: "constant", detail: `${x.doc} · ${x.detail}` })), validFor: /^[\w-]*$/ };

    // type: "|  (inside defineParams)
    m = lineBefore.match(/\btype:\s*["'](\w*)$/);
    if (m && /defineParams\s*\(/.test(before)) return { from: ctx.pos - m[1]!.length, options: PARAM_TYPES.map((x) => ({ label: x, type: "enum" })), validFor: /^\w*$/ };

    // import { | } from "tscad"
    m = lineBefore.match(/^\s*import\s*(?:type\s*)?\{[^}]*?(\w*)$/);
    if (m && /from\s*["']tscad["']/.test(line.text + ctx.state.doc.sliceString(ctx.pos, Math.min(ctx.state.doc.length, ctx.pos + 200)))) {
      return { from: ctx.pos - m[1]!.length, options: data.exports.map((x) => ({ label: x.name, type: "function", detail: "tscad" })), validFor: /^\w*$/ };
    }

    // <box |  — props of the open tag (not inside a {...} or "..." value)
    const open = before.match(/<([a-z]\w*)((?:\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}))?)*)\s+([\w-]*)$/);
    if (open) {
      const info = tagMap.get(open[1]!);
      if (info) {
        const used = new Set([...open[2]!.matchAll(/\s([\w-]+)(?==|\s|$)/g)].map((x) => x[1]));
        const typed = open[3]!;
        return {
          from: ctx.pos - typed.length,
          options: info.props
            .filter((p) => !used.has(p.name))
            .map((p, i) => ({
              label: p.name,
              type: "property",
              detail: p.type.length > 34 ? `${p.type.slice(0, 32)}…` : p.type,
              info: md(`${p.doc}${p.doc ? "\n\n" : ""}\`${p.name}${p.optional ? "?" : ""}: ${p.type}\``),
              boost: p.optional ? -i / 100 : 1,
              apply: /^["']|string\b/.test(p.type) && !/number|boolean|Vec/.test(p.type) ? `${p.name}=""` : `${p.name}={}`,
            })),
          validFor: /^[\w-]*$/,
        };
      }
    }
    return null;
  };
}

export interface Editor {
  view: EditorView;
  getValue(): string;
  setValue(text: string): void;
  setProblems(problems: EditorProblem[]): void;
}

export function createEditor(parent: HTMLElement, opts: { doc: string; completions?: CompletionData; onChange: (text: string) => void; onRun: () => void }): Editor {
  const runKey = { key: "Mod-s", preventDefault: true, run: () => (opts.onRun(), true) };
  const runKey2 = { key: "Mod-Enter", preventDefault: true, run: () => (opts.onRun(), true) };
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter({ markerDOM: (open) => Object.assign(document.createElement("span"), { textContent: open ? "▾" : "▸" }) }),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        javascript({ jsx: true, typescript: true }),
        syntaxHighlighting(highlight),
        autocompletion({ override: [...(opts.completions ? [tscadCompletions(opts.completions)] : []), localCompletionSource], icons: true }),
        lintGutter(),
        keymap.of([runKey, runKey2, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        theme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text: string) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    setProblems(problems: EditorProblem[]) {
      const doc = view.state.doc;
      const diags: Diagnostic[] = [];
      for (const p of problems) {
        if (!(p.line >= 1 && p.line <= doc.lines)) continue;
        const line = doc.line(p.line);
        let from = line.from + Math.min(Math.max(0, (p.column ?? 1) - 1), line.length);
        // Underline the token (or the JSX element's tag) at the position, else the line's text.
        const rest = line.text.slice(from - line.from);
        const tok = rest.match(/^<?\/?[\w.$-]+/) ?? rest.match(/^\S+/);
        let to = tok ? from + tok[0].length : line.to;
        if (to <= from) {
          from = line.from + (line.text.length - line.text.trimStart().length);
          to = line.to;
        }
        diags.push({ from, to: Math.max(to, from + 1 > line.to ? from : from + 1), severity: p.severity ?? "error", message: p.message });
      }
      view.dispatch(setDiagnostics(view.state, diags));
    },
  };
}
