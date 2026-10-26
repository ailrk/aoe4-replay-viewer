// Little-endian binary reader mirroring AoE4.Replay.Binary.

export class ParseError extends Error {}

const utf16 = new TextDecoder("utf-16le");

export function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x2000) {
    s += String.fromCharCode(...b.subarray(i, i + 0x2000));
  }
  return s;
}

export function decodeUtf16(b: Uint8Array): string {
  return utf16.decode(b);
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += (x < 16 ? "0" : "") + x.toString(16);
  return s;
}

export function le32At(b: Uint8Array, i: number): number {
  if (i < 0 || i + 4 > b.length) return 0;
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

export class Reader {
  readonly buf: Uint8Array;
  private readonly view: DataView;
  pos: number;

  constructor(buf: Uint8Array, pos = 0) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = pos;
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  isEmpty(): boolean {
    return this.pos >= this.buf.length;
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.buf.length) {
      throw new ParseError(`not enough bytes at offset ${this.pos}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  peekU8(): number {
    this.need(1);
    return this.buf[this.pos];
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  peekU32(): number {
    this.need(4);
    return this.view.getUint32(this.pos, true);
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  rest(): Uint8Array {
    return this.bytes(this.remaining);
  }

  /** u32 byte length followed by 8-bit characters. */
  ascii(): string {
    return latin1(this.bytes(this.u32()));
  }

  /** u32 character count followed by UTF-16LE code units (lenient). */
  utf16(): string {
    return decodeUtf16(this.bytes(this.u32() * 2));
  }
}

/** Run a decoder that must consume the whole buffer. */
export function runExact<T>(buf: Uint8Array, f: (r: Reader) => T): T {
  const r = new Reader(buf);
  const v = f(r);
  if (!r.isEmpty()) throw new ParseError(`unconsumed bytes at offset ${r.pos}`);
  return v;
}

/** Run a decoder on a prefix, returning the value and the unconsumed rest. */
export function runPrefix<T>(buf: Uint8Array, f: (r: Reader) => T): [T, Uint8Array] {
  const r = new Reader(buf);
  const v = f(r);
  return [v, buf.subarray(r.pos)];
}

export function attempt<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch (e) {
    if (e instanceof ParseError || e instanceof RangeError) return undefined;
    throw e;
  }
}

/** u32-length-prefixed printable ASCII strings of 3+ characters. */
export function scanStrings(b: Uint8Array): string[] {
  const out: string[] = [];
  let i = 0;
  while (i + 4 <= b.length) {
    const n = le32At(b, i);
    if (n >= 3 && n <= 1024 && i + 4 + n <= b.length) {
      let ok = true;
      for (let j = i + 4; j < i + 4 + n; j++) {
        if (b[j] < 0x20 || b[j] >= 0x7f) { ok = false; break; }
      }
      if (ok) {
        out.push(latin1(b.subarray(i + 4, i + 4 + n)));
        i += 4 + n;
        continue;
      }
    }
    i += 1;
  }
  return out;
}
