import { describe, expect, test } from "bun:test";
import { compile, createContext, createElement, Fragment, isElement, useContext, type Children } from "tscad";
import { jsx } from "tscad/jsx-runtime";
import { jsxDEV } from "tscad/jsx-dev-runtime";

describe("jsx runtime", () => {
  test("elements are plain objects with type, props, key", () => {
    const el = <box key="a" size={1} />;
    expect(isElement(el)).toBe(true);
    expect(el.type).toBe("box");
    expect(el.props).toEqual({ size: 1 });
    expect(el.key).toBe("a");
  });

  test("source is captured from the stack (bun passes none)", () => {
    const el = <box size={1} />; const line = new Error().stack!.split("\n")[1]!.match(/:(\d+):\d+/)![1];
    expect(el.source?.file).toEndWith("core.runtime.test.tsx");
    expect(el.source?.line).toBe(Number(line));
    expect(el.source!.column).toBeGreaterThan(0);
  });

  test("jsxDEV uses the compiler-provided source", () => {
    const el = jsxDEV("box", { size: 1 }, undefined, false, { fileName: "/x/model.tsx", lineNumber: 7, columnNumber: 3 });
    expect(el.source).toEqual({ file: "/x/model.tsx", line: 7, column: 3 });
    expect(jsx("box", {}).type).toBe("box");
  });

  test("createElement with children", () => {
    const el = createElement("union", { key: 1 }, createElement("box", { size: 1 }), createElement("sphere", { r: 1 }));
    expect(el.key).toBe(1);
    expect((el.props.children as unknown[]).length).toBe(2);
  });
});

describe("render", () => {
  test("components, fragments, arrays, conditionals", () => {
    function Peg({ x }: { x: number }) {
      return <cylinder r={1} h={2} x={x} />;
    }
    const Pegs = ({ n }: { n: number }) => (
      <>
        {Array.from({ length: n }, (_, i) => (
          <Peg key={i} x={i * 5} />
        ))}
        {false}
        {null}
        {n > 100 && <box size={1} />}
      </>
    );
    const r = compile(
      <union>
        <Pegs n={3} />
        <Fragment>
          <sphere r={1} />
        </Fragment>
      </union>,
    );
    const node = r.document.parts![0]!.node;
    expect(node.type).toBe("union");
    expect((node as any).children.length).toBe(4);
  });

  test("children are passed to components", () => {
    const Lift = ({ children, by }: { children?: Children; by: number }) => <group z={by}>{children}</group>;
    const r = compile(
      <Lift by={5}>
        <box size={2} center />
      </Lift>,
    );
    const n = r.document.parts![0]!.node as any;
    expect(n.type).toBe("transform");
    expect(n.matrix[11]).toBe(5);
    expect(n.children[0]).toEqual({ type: "box", size: [2, 2, 2], center: true });
  });

  test("context: provider stack, default value, nesting", () => {
    const Wall = createContext(2, "Wall");
    const seen: number[] = [];
    function Probe() {
      seen.push(useContext(Wall));
      return <box size={useContext(Wall)} center />;
    }
    compile(
      <union>
        <Probe />
        <Wall.Provider value={5}>
          <Probe />
          <Wall.Provider value={7}>
            <Probe />
          </Wall.Provider>
          <Probe />
        </Wall.Provider>
        <Probe />
      </union>,
    );
    expect(seen).toEqual([2, 5, 7, 5, 2]);
  });

  test("context is restored after a throw", () => {
    const C = createContext("outer");
    const Boom = () => {
      throw new Error("boom");
    };
    expect(() =>
      compile(
        <C.Provider value="inner">
          <Boom />
        </C.Provider>,
      ),
    ).toThrow("boom");
    let got = "";
    const Read = () => {
      got = useContext(C);
      return <box size={1} />;
    };
    compile(<Read />);
    expect(got).toBe("outer");
  });

  test("text children warn, not fail", () => {
    const r = compile(<group>hello<box size={1} /></group>);
    expect(r.warnings.some((w) => w.includes("hello"))).toBe(true);
  });
});
