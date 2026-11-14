import { beforeAll, describe, expect, test } from "bun:test";
import { compile, edges, TscadError } from "../src/index";
import type { Node } from "../src/ir";
import { loadKernel, type KernelHost } from "../src/kernel/index.ts";
import { Bolt as LibBolt } from "../src/parts";

/** A bolt-like component: named sub-solids, no name of its own. */
function Bolt({ length = 12, x = 0 }: { length?: number; x?: number }) {
  return (
    <group x={x}>
      <cylinder name="shank" r={1.5} h={length} z={4 - length} />
      <cylinder name="head" r={2.75} h={3} />
    </group>
  );
}

/** Every node of a tree, depth first. */
function all(n: Node): Node[] {
  return [n, ...kidsOf(n).flatMap(all)];
}
const kidsOf = (n: Node | undefined): Node[] => (n && "children" in n ? n.children : []);
const radii = (n: Node) => all(n).flatMap((x) => (x.type === "cylinder" ? [x.radius] : []));
const nodeOf = (src: Parameters<typeof compile>[0]) => compile(src).document.parts![0]!.node;
const err = (src: Parameters<typeof compile>[0]): TscadError => {
  try {
    compile(src);
  } catch (e) {
    if (e instanceof TscadError) return e;
    throw e;
  }
  throw new Error("expected a TscadError");
};

describe("ref ops", () => {
  test("subtract from/tool: the tool is cut and used up, the rest stays", () => {
    const r = compile(
      <part name="bracket">
        <Bolt name="bolt" />
        <box name="plate" size={[40, 20, 4]} />
        <subtract from=".plate" tool=".bolt > .shank" />
      </part>,
    );
    const root = r.document.parts![0]!.node;
    const diff = all(root).find((n) => n.type === "difference")!;
    expect(diff).toBeDefined();
    // the shank only survives inside the difference; the head is still a separate solid
    expect(radii(diff)).toEqual([1.5]);
    expect(radii(root).sort()).toEqual([1.5, 2.75]);
    // the difference maps back to the <subtract> line
    const path = Object.keys(r.sourceMap).find((k) => r.sourceMap[k]!.tag === "subtract");
    expect(path).toBeDefined();
  });

  test("a tool in another frame is moved into the target's frame", () => {
    const root = nodeOf(
      <part>
        <group x={10}>
          <box name="plate" size={[40, 20, 4]} />
        </group>
        <cylinder name="hole" r={2} h={10} x={15} z={-3} />
        <subtract from=".plate" tool=".hole" />
      </part>,
    );
    const diff = all(root).find((n) => n.type === "difference")!;
    const moved = kidsOf(diff)[1]!;
    // hole at x = 15 in the part, the plate's frame starts at x = 10: 5 along x in the plate's frame
    expect(moved.type).toBe("transform");
    const m = (moved as { matrix: number[] }).matrix;
    expect(m[3]).toBeCloseTo(-10);
  });

  test("features by target wrap the named solid, which keeps its name", () => {
    const root = nodeOf(
      <part>
        <box name="plate" size={[40, 20, 4]} />
        <cylinder name="hole" r={2} h={10} z={-3} />
        <subtract from=".plate" tool=".hole" />
        <fillet target=".plate" radius={1} edges={edges.max("z")} />
        <chamfer target=".plate" distance={0.5} edges={edges.min("z")} />
      </part>,
    );
    expect(root.type).toBe("chamfer");
    expect(kidsOf(root)[0]!.type).toBe("fillet");
    expect(kidsOf(kidsOf(root)[0])[0]!.type).toBe("difference");
  });

  test("union of and intersect of", () => {
    const u = nodeOf(
      <part>
        <box name="a" size={10} />
        <box name="b" size={10} x={5} />
        <union of=".a, .b" />
      </part>,
    );
    expect(u.type).toBe("union");
    expect(kidsOf(u).length).toBe(2);
    const i = nodeOf(
      <part>
        <box name="a" size={10} />
        <sphere name="b" r={6} />
        <intersect of=".a, .b" />
      </part>,
    );
    expect(i.type).toBe("intersection");
  });

  test("descendant and comma selectors", () => {
    const root = nodeOf(
      <part>
        <Bolt name="bolt" />
        <box name="plate" size={[40, 20, 4]} />
        <subtract from=".plate" tool=".bolt .shank, .bolt .head" />
      </part>,
    );
    expect(root.type).toBe("difference");
    expect(radii(root).sort()).toEqual([1.5, 2.75]);
  });

  test("a whole named component can be a tool", () => {
    const root = nodeOf(
      <part>
        <Bolt name="bolt" />
        <box name="plate" size={[40, 20, 4]} />
        <subtract from=".plate" tool=".bolt" />
      </part>,
    );
    expect(root.type).toBe("difference");
  });

  test("refs inside a component resolve within that call", () => {
    function Counterbored({ x }: { x: number }) {
      return (
        <group x={x}>
          <cylinder name="body" r={4} h={6} />
          <cylinder name="bore" r={1} h={8} z={-1} />
          <subtract from=".body" tool=".bore" />
        </group>
      );
    }
    const root = nodeOf(
      <part>
        <Counterbored x={0} />
        <Counterbored x={10} />
      </part>,
    );
    expect(all(root).filter((n) => n.type === "difference").length).toBe(2);
  });

  test("nesting still works next to refs", () => {
    const root = nodeOf(
      <part>
        <difference name="plate">
          <box size={[40, 20, 4]} />
          <cylinder r={2} h={10} z={-3} />
        </difference>
        <fillet target=".plate" radius={0.5} />
      </part>,
    );
    expect(root.type).toBe("fillet");
    expect(kidsOf(root)[0]!.type).toBe("difference");
  });

  test("loose solids (no part) resolve together", () => {
    const r = compile(
      <>
        <box name="plate" size={[40, 20, 4]} />
        <cylinder name="hole" r={2} h={10} z={-3} />
        <subtract from=".plate" tool=".hole" />
      </>,
    );
    expect(r.document.parts!.length).toBe(1);
    expect(r.document.parts![0]!.node.type).toBe("difference");
  });
});

describe("ghosts", () => {
  test("a used ghost tool cuts; an unused one is left out with a warning", () => {
    const r = compile(
      <part>
        <box name="plate" size={[40, 20, 4]} />
        <cylinder name="hole" ghost r={2} h={10} z={-3} />
        <cylinder name="spare" ghost r={3} h={10} z={-3} x={10} />
        <subtract from=".plate" tool=".hole" />
      </part>,
    );
    const root = r.document.parts![0]!.node;
    expect(root.type).toBe("difference");
    expect(radii(root)).toEqual([2]);
    expect(r.warnings.some((w) => w.includes(".spare is a ghost") && w.includes("left out"))).toBe(true);
  });

  test("a ghost component call", () => {
    function Cutter() {
      return <cylinder name="bore" r={1} h={10} z={-3} />;
    }
    const r = compile(
      <part>
        <box name="plate" size={10} />
        <Cutter name="c" ghost />
        <Cutter name="unused" ghost />
        <subtract from=".plate" tool=".c" />
      </part>,
    );
    expect(r.document.parts![0]!.node.type).toBe("difference");
    expect(radii(r.document.parts![0]!.node)).toEqual([1]);
    expect(r.warnings.some((w) => w.includes(".unused is a ghost"))).toBe(true);
  });

  test("a ghost nested in a boolean is kept (it is in use)", () => {
    const root = nodeOf(
      <part>
        <difference>
          <box size={10} />
          <cylinder ghost r={1} h={20} z={-5} />
        </difference>
      </part>,
    );
    expect(root.type).toBe("difference");
    expect(radii(root)).toEqual([1]);
  });

  test("<Bolt cutter> from tscad/parts is a ghost: cuts by ref, left out when unused", () => {
    const r = compile(
      <part>
        <box name="plate" size={[40, 20, 6]} />
        <LibBolt name="used" cutter thread="M3" length={10} z={6} x={-10} />
        <LibBolt name="unused" cutter thread="M3" length={10} z={6} x={10} />
        <subtract from=".plate" tool=".used" />
      </part>,
    );
    expect(r.document.parts![0]!.node.type).toBe("difference");
    expect(r.warnings.some((w) => w.includes(".unused is a ghost"))).toBe(true);
  });

  test("a part of only unused ghosts is empty", () => {
    const r = compile(
      <>
        <part name="p">
          <box ghost size={1} />
        </part>
        <part name="q">
          <box size={1} />
        </part>
      </>,
    );
    expect(r.document.parts!.map((p) => p.name)).toEqual(["q"]);
  });
});

describe("ref errors", () => {
  test("did you mean", () => {
    const e = err(
      <part>
        <box name="plate" size={10} />
        <cylinder name="hole" r={1} h={20} />
        <subtract from=".plat" tool=".hole" />
      </part>,
    );
    expect(e.message).toContain('from=".plat" matches nothing');
    expect(e.hint).toContain('did you mean ".plate"');
    expect(e.loc?.tag).toBe("subtract");
  });

  test("ambiguous single target", () => {
    const e = err(
      <part>
        <Bolt name="a" />
        <Bolt name="b" x={10} />
        <fillet target=".shank" radius={0.2} />
      </part>,
    );
    expect(e.message).toContain("matches 2 solids: .a > .shank, .b > .shank");
  });

  test("a used-up tool can't be referenced again", () => {
    const e = err(
      <part>
        <box name="plate" size={10} />
        <cylinder name="hole" r={1} h={20} />
        <subtract from=".plate" tool=".hole" />
        <fillet target=".hole" radius={0.2} />
      </part>,
    );
    expect(e.message).toContain("already used up as a tool by <subtract>");
  });

  test("refs stay inside their part", () => {
    const e = err(
      <assembly>
        <part name="a">
          <box name="plate" size={10} />
        </part>
        <part name="b">
          <cylinder name="hole" r={1} h={20} />
          <subtract from=".plate" tool=".hole" />
        </part>
      </assembly>,
    );
    expect(e.message).toContain("matches nothing in part \"b\"");
    expect(e.hint).toContain(".plate is outside it");
  });

  test("patterned solids need the pattern's name", () => {
    const e = err(
      <part>
        <box name="plate" size={[40, 20, 4]} />
        <linearPattern count={3} dx={10}>
          <cylinder name="pin" r={1} h={10} />
        </linearPattern>
        <subtract from=".plate" tool=".pin" />
      </part>,
    );
    expect(e.message).toContain("appears 3 times");
  });

  test("children and refs don't mix; ref ops take no placement", () => {
    expect(
      err(
        <part>
          <box name="a" size={1} />
          <fillet target=".a" radius={0.1}>
            <box size={1} />
          </fillet>
        </part>,
      ).message,
    ).toContain("either children or a ref");
    expect(
      err(
        <part>
          <box name="a" size={1} />
          <box name="b" size={1} />
          <union of=".a, .b" x={3} />
        </part>,
      ).message,
    ).toContain("x has no effect on a ref <union>");
  });

  test("selector syntax", () => {
    const e = err(
      <part>
        <box name="plate" size={1} />
        <box name="b" size={1} />
        <subtract from="plate" tool=".b" />
      </part>,
    );
    expect(e.message).toContain('needs a leading dot: ".plate"');
  });

  test("a difference's body can't be a tool", () => {
    const e = err(
      <part>
        <difference>
          <box name="core" size={10} />
          <box size={2} />
        </difference>
        <box name="other" size={20} x={30} />
        <subtract from=".other" tool=".core" />
      </part>,
    );
    expect(e.message).toContain("it's the body a <difference> cuts from");
  });
});

describe("ref ops in the kernel", () => {
  let k: KernelHost;
  beforeAll(async () => {
    k = await loadKernel();
  });

  test("plate minus a bolt's shank and head", async () => {
    const r = compile(
      <part name="bracket">
        <Bolt name="bolt" x={5} />
        <box name="plate" size={[40, 20, 4]} center={[true, true, false]} />
        <subtract from=".plate" tool=".bolt > .shank" />
        <subtract from=".plate" tool=".bolt > .head" />
      </part>,
    );
    const res = await k.evaluate(r.document, { noMesh: true });
    expect(res.ok).toBe(true);
    // the shank (z = -8..4) cuts through the 4 mm plate; the head (z = 0..3) widens the cut
    const shank = Math.PI * 1.5 ** 2 * 4;
    const headExtra = Math.PI * (2.75 ** 2 - 1.5 ** 2) * 3;
    expect(res.parts[0]!.volume!).toBeCloseTo(40 * 20 * 4 - shank - headExtra, 1);
  });
});
