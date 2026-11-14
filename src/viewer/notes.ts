/** Drawing text notes in the viewport: labels that always face the screen, centred on their point, `size` mm tall. */
import * as THREE from "three";
import type { DrawingNoteData } from "./protocol";

const PX = 64; // texture pixels per text height

/** A group of screen-facing text sprites for a drawing's notes, in its colour. */
export function noteGroup(notes: DrawingNoteData[], color: string): THREE.Group {
  const group = new THREE.Group();
  for (const n of notes) {
    if (!n.text || !(n.size > 0)) continue;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    const font = `600 ${PX}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.font = font;
    c.width = Math.max(1, Math.ceil(ctx.measureText(n.text).width) + 24);
    c.height = Math.ceil(PX * 1.4);
    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    // A dark halo keeps the label readable over lines and faces.
    ctx.lineWidth = PX / 6;
    ctx.strokeStyle = "rgba(10, 12, 18, 0.85)";
    ctx.strokeText(n.text, c.width / 2, c.height / 2);
    ctx.fillStyle = color;
    ctx.fillText(n.text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    const h = n.size * 1.4;
    sprite.scale.set((h * c.width) / c.height, h, 1);
    sprite.position.set(n.at[0], n.at[1], 0.01);
    sprite.renderOrder = 16;
    sprite.userData.note = n.text;
    group.add(sprite);
  }
  return group;
}

/** Remove a note group and free its GPU resources. */
export function disposeNotes(group: THREE.Group): void {
  group.removeFromParent();
  for (const s of group.children as THREE.Sprite[]) {
    s.material.map?.dispose();
    s.material.dispose();
  }
}
