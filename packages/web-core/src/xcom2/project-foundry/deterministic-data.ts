const HEX = "0123456789abcdef";

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("JSON strings must contain valid Unicode scalar values");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError("JSON strings must contain valid Unicode scalar values");
    }
  }
}

/** Serialize JSON data using RFC 8785 (JCS) deterministic property ordering. */
export function canonicalizeJsonRfc8785(value: unknown): string {
  const active = new Set<object>();

  function serialize(current: unknown): string {
    if (current === null) return "null";
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "string") {
      assertWellFormedUnicode(current);
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("RFC 8785 excludes non-finite numbers");
      }
      return JSON.stringify(current);
    }
    if (typeof current !== "object") {
      throw new TypeError("RFC 8785 input must contain only JSON data");
    }
    if (active.has(current)) throw new TypeError("RFC 8785 input must be acyclic");

    if (Array.isArray(current)) {
      active.add(current);
      try {
        const values: string[] = [];
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(current, index)) {
            throw new TypeError("RFC 8785 input must not contain sparse arrays");
          }
          values.push(serialize(current[index]));
        }
        return `[${values.join(",")}]`;
      } finally {
        active.delete(current);
      }
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("RFC 8785 input must contain only JSON objects and arrays");
    }
    if (Object.getOwnPropertySymbols(current).length !== 0) {
      throw new TypeError("RFC 8785 input must not contain symbol properties");
    }

    active.add(current);
    try {
      const record = current as Record<string, unknown>;
      const properties: string[] = [];
      for (const key of Object.keys(record).sort()) {
        assertWellFormedUnicode(key);
        properties.push(`${JSON.stringify(key)}:${serialize(record[key])}`);
      }
      return `{${properties.join(",")}}`;
    } finally {
      active.delete(current);
    }
  }

  return serialize(value);
}

/** Encode a well-formed JavaScript string as UTF-8 without runtime-specific APIs. */
export function utf8Bytes(value: string): Uint8Array {
  assertWellFormedUnicode(value);
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let point = value.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = value.charCodeAt((index += 1));
      point = 0x10000 + ((point - 0xd800) << 10) + (low - 0xdc00);
    }
    if (point <= 0x7f) bytes.push(point);
    else if (point <= 0x7ff) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
    else if (point <= 0xffff) {
      bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >>> 18),
        0x80 | ((point >>> 12) & 0x3f),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function paddedWords(bytes: Uint8Array): Uint32Array {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const words = new Uint32Array(paddedLength / 4);
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << (24 - (index & 3) * 8);
  }
  words[bytes.length >>> 2] |= 0x80 << (24 - (bytes.length & 3) * 8);
  const bitLength = bytes.length * 8;
  words[words.length - 2] = Math.floor(bitLength / 0x1_0000_0000);
  words[words.length - 1] = bitLength;
  return words;
}

function wordsToBytes(words: readonly number[]): Uint8Array {
  const output = new Uint8Array(words.length * 4);
  words.forEach((word, index) => {
    output[index * 4] = word >>> 24;
    output[index * 4 + 1] = word >>> 16;
    output[index * 4 + 2] = word >>> 8;
    output[index * 4 + 3] = word;
  });
  return output;
}

function rotateLeft(value: number, count: number): number {
  return (value << count) | (value >>> (32 - count));
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** Standards-correct synchronous SHA-1 for deterministic UUIDv5 derivation. */
export function sha1(bytes: Uint8Array): Uint8Array {
  const input = paddedWords(bytes);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const schedule = new Uint32Array(80);

  for (let offset = 0; offset < input.length; offset += 16) {
    for (let index = 0; index < 16; index += 1) schedule[index] = input[offset + index];
    for (let index = 16; index < 80; index += 1) {
      schedule[index] = rotateLeft(
        schedule[index - 3] ^ schedule[index - 8] ^ schedule[index - 14] ^ schedule[index - 16],
        1,
      );
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let index = 0; index < 80; index += 1) {
      let f: number;
      let k: number;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temporary = (rotateLeft(a, 5) + f + e + k + schedule[index]) | 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temporary;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return wordsToBytes([h0, h1, h2, h3, h4]);
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;
const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

/** Standards-correct synchronous SHA-256 over bytes. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const input = paddedWords(bytes);
  const hash: number[] = [...SHA256_INITIAL];
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < input.length; offset += 16) {
    for (let index = 0; index < 16; index += 1) schedule[index] = input[offset + index];
    for (let index = 16; index < 64; index += 1) {
      const x = schedule[index - 15];
      const y = schedule[index - 2];
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + schedule[index]) | 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  return wordsToBytes(hash);
}

export function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += HEX[byte >>> 4] + HEX[byte & 0x0f];
  return result;
}

/** SHA-256 hex digest of UTF-8 text. */
export function sha256Hex(value: string): string {
  return bytesToHex(sha256(utf8Bytes(value)));
}

/** RFC 4122 UUIDv5 using SHA-1 and a canonical UUID namespace. */
export function uuidV5(namespace: string, name: string): string {
  const canonicalNamespace = namespace.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(canonicalNamespace)) {
    throw new TypeError("UUID namespace must use canonical hexadecimal form");
  }
  const namespaceBytes = new Uint8Array(16);
  const compact = canonicalNamespace.replaceAll("-", "");
  for (let index = 0; index < compact.length; index += 2) {
    namespaceBytes[index / 2] = Number.parseInt(compact.slice(index, index + 2), 16);
  }
  const nameBytes = utf8Bytes(name);
  const material = new Uint8Array(namespaceBytes.length + nameBytes.length);
  material.set(namespaceBytes);
  material.set(nameBytes, namespaceBytes.length);
  const uuid = sha1(material).slice(0, 16);
  uuid[6] = (uuid[6] & 0x0f) | 0x50;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;
  const hex = bytesToHex(uuid);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
