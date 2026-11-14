/** Share links: the model source deflated (fflate) and base64url-encoded into the URL hash. */
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

export function encodeSource(source: string): string {
  const bytes = deflateSync(strToU8(source), { level: 9 });
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeSource(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return strFromU8(inflateSync(bytes));
}
