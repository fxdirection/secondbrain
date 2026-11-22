import { createHash } from "crypto";

const ZK = [
  1170614578, 1024848638, 1413669199, 3951632832, 3528873006, 2921909214, 4151847688, 3997739139,
  1933479194, 3323781115, 3888513386, 460404854, 3747539722, 2403641034, 2615871395, 2119585428,
  2265697227, 2035090028, 2773447226, 4289380121, 4217216195, 2200601443, 3051914490, 1579901135,
  1321810770, 456816404, 2903323407, 4065664991, 330002838, 3506006750, 363569021, 2347096187,
];

const ZB = [
  20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91, 237, 9, 125, 157, 230,
  93, 252, 205, 90, 79, 144, 199, 159, 197, 186, 167, 39, 37, 156, 198, 38, 42, 43, 168, 217,
  153, 15, 103, 80, 189, 71, 191, 97, 84, 247, 95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148,
  86, 182, 32, 83, 158, 109, 22, 255, 94, 238, 151, 85, 77, 124, 254, 18, 4, 26, 123, 176, 232,
  193, 131, 172, 143, 142, 150, 30, 10, 146, 162, 62, 224, 218, 196, 229, 1, 192, 213, 27, 110,
  56, 231, 180, 138, 107, 242, 187, 54, 120, 19, 44, 117, 228, 215, 203, 53, 239, 251, 127, 81,
  11, 133, 96, 204, 132, 41, 115, 73, 55, 249, 147, 102, 48, 122, 145, 106, 118, 74, 190, 29, 16,
  174, 5, 177, 129, 63, 113, 99, 31, 161, 76, 246, 34, 211, 13, 60, 68, 207, 160, 65, 111, 82,
  165, 67, 169, 225, 57, 112, 244, 155, 51, 236, 200, 233, 58, 61, 47, 100, 137, 185, 64, 17, 70,
  234, 163, 219, 108, 170, 166, 59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226, 119, 136,
  206, 135, 175, 195, 25, 92, 121, 208, 126, 139, 3, 75, 141, 21, 130, 98, 241, 40, 154, 66, 184,
  49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188, 104, 179, 210, 134, 250, 201, 164, 89, 216,
  202, 220, 50, 221, 152, 140, 33, 235, 214,
];

const ALPHABET = "6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE";
const KEY16 = Array.from(Buffer.from("059053f7d15e01d7"));
export const ZHIHU_ZSE93 = "101_3_3.0";

function encodeUriComponentBytes(input: string): number[] {
  const out: number[] = [];
  const hex = "0123456789ABCDEF";
  for (const byte of Buffer.from(input)) {
    if (/[A-Za-z0-9\-_.!~*'()]/.test(String.fromCharCode(byte))) out.push(byte);
    else {
      out.push("%".charCodeAt(0), hex.charCodeAt(byte >> 4), hex.charCodeAt(byte & 0x0f));
    }
  }
  return out;
}

function readU32(bytes: number[] | Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeU32(value: number, out: number[], offset: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function gTransform(value: number): number {
  const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  const mapped = bytes.map((byte) => ZB[byte]);
  const mixed = readU32(mapped, 0);
  return (mixed ^ rotateLeft(mixed, 2) ^ rotateLeft(mixed, 10) ^ rotateLeft(mixed, 18) ^ rotateLeft(mixed, 24)) >>> 0;
}

function rBlock(input: number[]): number[] {
  const words = [readU32(input, 0), readU32(input, 4), readU32(input, 8), readU32(input, 12)];
  for (let index = 0; index < 32; index += 1) {
    words.push((words[index] ^ gTransform((words[index + 1] ^ words[index + 2] ^ words[index + 3] ^ ZK[index]) >>> 0)) >>> 0);
  }
  const out = new Array<number>(16).fill(0);
  writeU32(words[35], out, 0);
  writeU32(words[34], out, 4);
  writeU32(words[33], out, 8);
  writeU32(words[32], out, 12);
  return out;
}

function xBlocks(data: number[], iv: number[]): number[] {
  const out: number[] = [];
  let current = iv.slice();
  for (let offset = 0; offset < data.length; offset += 16) {
    const mixed = current.map((byte, index) => data[offset + index] ^ byte);
    current = rBlock(mixed);
    out.push(...current);
  }
  return out;
}

function customEncode(bytes: number[]): string {
  const padded = bytes.slice();
  while (padded.length % 3 !== 0) padded.push(0);
  let out = "";
  let index = 0;
  for (let position = padded.length - 1; position >= 0; position -= 3) {
    let value = 0;
    for (let shift = 0; shift < 3; shift += 1) {
      const mask = (58 >> (8 * (index % 4))) & 0xff;
      index += 1;
      value |= ((padded[position - shift] ^ mask) & 0xff) << (8 * shift);
    }
    out += ALPHABET[value & 63];
    out += ALPHABET[(value >> 6) & 63];
    out += ALPHABET[(value >> 12) & 63];
    out += ALPHABET[(value >> 18) & 63];
  }
  return out;
}

export function encryptZseV4(input: string): string {
  const plain = [210, 0, ...encodeUriComponentBytes(input)];
  const pad = 16 - (plain.length % 16);
  for (let index = 0; index < pad; index += 1) plain.push(pad);
  const first = plain.slice(0, 16).map((byte, index) => byte ^ KEY16[index] ^ 42);
  const firstBlock = rBlock(first);
  const cipher = firstBlock.concat(plain.length > 16 ? xBlocks(plain.slice(16), firstBlock) : []);
  return customEncode(cipher);
}

export function signZhihuRequest(url: string, dc0: string): Record<string, string> {
  const pathname = new URL(url).pathname + new URL(url).search;
  const source = `${ZHIHU_ZSE93}+${pathname}+${dc0}`;
  const digest = createHash("md5").update(source).digest("hex");
  return {
    "x-zse-93": ZHIHU_ZSE93,
    "x-zse-96": `2.0_${encryptZseV4(digest)}`,
    "x-requested-with": "fetch",
  };
}

export function guestDc0(): string {
  return `${createHash("sha256").update(String(Math.random())).digest("base64url").slice(0, 22)}|${Math.floor(Date.now() / 1000)}`;
}
