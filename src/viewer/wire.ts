/**
 * A tiny binary codec for worker-protocol messages over a WebSocket: the message as JSON with
 * every typed array swapped for a placeholder, then the arrays' bytes (8-byte aligned, so the
 * receiver views them in place without copying).
 *
 * Frame: u32 header length · header JSON `{ t: byteLengths[], m: message }` · array bytes…
 */

const KINDS = {
  f32: Float32Array,
  f64: Float64Array,
  u32: Uint32Array,
  i32: Int32Array,
  u8: Uint8Array,
  u16: Uint16Array,
} as const;
type Kind = keyof typeof KINDS;

function kindOf(v: ArrayBufferView): Kind | undefined {
  if (v instanceof Float32Array) return "f32";
  if (v instanceof Float64Array) return "f64";
  if (v instanceof Uint32Array) return "u32";
  if (v instanceof Int32Array) return "i32";
  if (v instanceof Uint8Array) return "u8";
  if (v instanceof Uint16Array) return "u16";
  return undefined;
}

const align8 = (n: number) => (n + 7) & ~7;

/** Encode a message: header JSON with typed arrays swapped for placeholders, then their bytes. */
export function encode(msg: unknown): Uint8Array {
  const arrays: ArrayBufferView[] = [];
  const m = JSON.stringify(msg, (_k, v) => {
    if (ArrayBuffer.isView(v)) {
      const kind = kindOf(v);
      if (kind) return { $ta: kind, i: arrays.push(v) - 1 };
    }
    // JSON has no Infinity/NaN (wall thickness uses Infinity for "no opposite wall").
    if (typeof v === "number" && !Number.isFinite(v)) return { $num: String(v) };
    return v;
  });
  const header = new TextEncoder().encode(`{"t":${JSON.stringify(arrays.map((a) => a.byteLength))},"m":${m ?? "null"}}`);
  let size = align8(4 + header.byteLength);
  const offsets = arrays.map((a) => {
    const at = size;
    size = align8(size + a.byteLength);
    return at;
  });
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, header.byteLength, true);
  out.set(header, 4);
  arrays.forEach((a, i) => out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offsets[i]!));
  return out;
}

/** Decode a message from {@link encode}. */
export function decode<T = unknown>(data: ArrayBuffer | ArrayBufferView): T {
  let bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  // Typed views need aligned offsets: copy once if a runtime handed us an unaligned slice.
  if (bytes.byteOffset % 8 !== 0) bytes = bytes.slice();
  const hl = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  const headText = new TextDecoder().decode(bytes.subarray(4, 4 + hl));
  const table = JSON.parse(headText.slice(0, headText.indexOf(',"m":')) + "}").t as number[];
  const raw: Uint8Array[] = [];
  let off = align8(4 + hl);
  for (const len of table) {
    raw.push(new Uint8Array(bytes.buffer, bytes.byteOffset + off, len));
    off = align8(off + len);
  }
  const head = JSON.parse(headText, (_k, v) => {
    if (v && typeof v === "object" && typeof v.$ta === "string" && typeof v.i === "number") {
      const r = raw[v.i]!;
      const C = KINDS[v.$ta as Kind];
      return new C(r.buffer as ArrayBuffer, r.byteOffset, r.byteLength / C.BYTES_PER_ELEMENT);
    }
    if (v && typeof v === "object" && typeof v.$num === "string" && Object.keys(v).length === 1) return Number(v.$num);
    return v;
  });
  return head.m as T;
}
