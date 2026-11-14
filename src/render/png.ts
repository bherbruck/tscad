/** Minimal PNG encoder and decoder: 8-bit RGB or RGBA, zlib via fflate. */
import { unzlibSync, zlibSync } from "fflate";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

/** Encode `pixels` (row-major, `channels` bytes per pixel: 3 = RGB, 4 = RGBA) as a PNG file. */
export function encodePNG(pixels: Uint8Array, width: number, height: number, channels: 3 | 4 = 3): Uint8Array {
  const stride = width * channels;
  // Filter type 1 (Sub) on every row: cheap and compresses smooth gradients well.
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const src = y * stride, dst = y * (stride + 1);
    raw[dst] = 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[src + x - channels]! : 0;
      raw[dst + 1 + x] = (pixels[src + x]! - left) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type
  // compression, filter, interlace = 0
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Decode an 8-bit, non-interlaced PNG (grey, grey+alpha, RGB, RGBA; any row filter) to RGBA
 * pixels. Enough for render snapshots; palette and 16-bit images throw.
 */
export function decodePNG(file: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => file[i] !== b)) throw new Error("not a PNG file");
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 8 <= file.length; ) {
    const len = dv.getUint32(o);
    const kind = String.fromCharCode(file[o + 4]!, file[o + 5]!, file[o + 6]!, file[o + 7]!);
    const body = file.subarray(o + 8, o + 8 + len);
    if (kind === "IHDR") {
      width = dv.getUint32(o + 8);
      height = dv.getUint32(o + 12);
      depth = body[8]!;
      type = body[9]!;
      interlace = body[12]!;
    } else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    o += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${type}${interlace ? ", interlaced" : ""})`);
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of idat) joined.set(c, (at += c.length) - c.length);
  const raw = unzlibSync(joined);
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels]! : 0;
      const b = y > 0 ? px[dst - stride + x]! : 0;
      const c = x >= channels && y > 0 ? px[dst - stride + x - channels]! : 0;
      const v = raw[src + x]!;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const e = a + b - c, pa = Math.abs(e - a), pb = Math.abs(e - b), pc = Math.abs(e - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[dst + x] = (v + p) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    if (channels === 1 || channels === 2) data.set([px[s]!, px[s]!, px[s]!, channels === 2 ? px[s + 1]! : 255], i * 4);
    else data.set([px[s]!, px[s + 1]!, px[s + 2]!, channels === 4 ? px[s + 3]! : 255], i * 4);
  }
  return { width, height, data };
}
