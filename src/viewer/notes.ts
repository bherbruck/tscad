/** Drawing text notes in the viewport: flat text on z = 0, centred, `size` mm tall, turned by `angle`. */
import * as THREE from "three";
import type { DrawingNoteData } from "./protocol";

const PX = 64; // texture pixels per text height

/** A group of flat text meshes for a drawing's notes, in its colour. */
export function noteGroup(notes: DrawingNoteData[], color: string): THREE.Group {
  const group = new THREE.Group();
  for (const n of notes) {
    if (!n.text || !(n.size > 0)) continue;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    const font = `600 ${PX}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.font = font;
    c.width = Math.max(1, Math.ceil(ctx.measureText(n.text).width) + 8);
    c.height = Math.ceil(PX * 1.25);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(n.text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const h = n.size * 1.25;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry((h * c.width) / c.height, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set(n.at[0], n.at[1], 0.01);
    mesh.rotation.z = THREE.MathUtils.degToRad(n.angle ?? 0);
    mesh.renderOrder = 16;
    mesh.userData.note = n.text;
    group.add(mesh);
  }
  return group;
}

/** Remove a note group and free its GPU resources. */
export function disposeNotes(group: THREE.Group): void {
  group.removeFromParent();
  for (const m of group.children as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[]) {
    m.geometry.dispose();
    m.material.map?.dispose();
    m.material.dispose();
  }
}
