/** 3MF writer: an OPC zip with one mesh object per part, colours as base materials, millimetres. */
import { zipSync } from "fflate";
import { DEFAULT_COLOR, parseColor, toHex } from "./color";
import { type ExportPart, encoder, fmt, weld, xmlEscape } from "./mesh";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** The `3D/3dmodel.model` XML for `parts`. */
export function threeMFModel(parts: ExportPart[]): string {
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`,
    `  <metadata name="Application">tscad</metadata>`,
    `  <resources>`,
    `    <basematerials id="1">`,
  ];
  for (const part of parts) {
    out.push(`      <base name="${xmlEscape(part.name)}" displaycolor="${toHex(parseColor(part.color) ?? DEFAULT_COLOR)}"/>`);
  }
  out.push(`    </basematerials>`);
  parts.forEach((part, i) => {
    const m = weld(part.mesh);
    out.push(`    <object id="${i + 2}" type="model" name="${xmlEscape(part.name)}" pid="1" pindex="${i}">`, `      <mesh>`, `        <vertices>`);
    const p = m.positions;
    for (let v = 0; v < p.length; v += 3) out.push(`          <vertex x="${fmt(p[v]!)}" y="${fmt(p[v + 1]!)}" z="${fmt(p[v + 2]!)}"/>`);
    out.push(`        </vertices>`, `        <triangles>`);
    const t = m.indices;
    for (let k = 0; k < t.length; k += 3) out.push(`          <triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>`);
    out.push(`        </triangles>`, `      </mesh>`, `    </object>`);
  });
  out.push(`  </resources>`, `  <build>`);
  parts.forEach((_, i) => out.push(`    <item objectid="${i + 2}"/>`));
  out.push(`  </build>`, `</model>`, ``);
  return out.join("\n");
}

/** A 3MF package (zip bytes). */
export function to3MF(parts: ExportPart[]): Uint8Array {
  return zipSync(
    {
      "[Content_Types].xml": encoder.encode(CONTENT_TYPES),
      "_rels/.rels": encoder.encode(RELS),
      "3D/3dmodel.model": encoder.encode(threeMFModel(parts)),
    },
    { level: 6 },
  );
}
