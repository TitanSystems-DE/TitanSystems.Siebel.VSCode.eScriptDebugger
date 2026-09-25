import { deflateSync, inflateSync } from 'node:zlib';
import { ProtocolError, type SiebelErrorDetail } from './errors.js';

export type Translation = 1 | 2 | 3 | 4;
export class Writer {
  private chunks: Buffer[] = [];
  constructor(public translation: Translation = 4) {}
  int(n: number): this { if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) throw new ProtocolError('Invalid int32'); const b = Buffer.alloc(4); b.writeInt32BE(n); this.chunks.push(b); return this; }
  bytes(b: Uint8Array | null): this { this.int(b?.length ?? 0); if (b) this.chunks.push(Buffer.from(b)); return this; }
  string(s: string | null): this {
    if (s === null) return this.bytes(null);
    if (this.translation === 3) return this.bytes(Buffer.from(s + '\0', 'utf16le').swap16());
    if (this.translation === 2 && /[^\x00-\x7f]/.test(s)) throw new ProtocolError('Character not representable in negotiated ASCII');
    return this.bytes(Buffer.from(s, this.translation === 2 ? 'ascii' : 'utf8'));
  }
  build(): Buffer { return Buffer.concat(this.chunks); }
}
export class Reader {
  offset = 0;
  constructor(public readonly buffer: Buffer, public translation: Translation = 4) {}
  get remaining(): number { return this.buffer.length - this.offset; }
  int(): number { if (this.remaining < 4) throw new ProtocolError('Truncated int32'); const n = this.buffer.readInt32BE(this.offset); this.offset += 4; return n; }
  count(minBytes = 4): number { const n = this.int(); if (n < 0 || n > Math.floor(this.remaining / minBytes)) throw new ProtocolError('Invalid collection count'); return n; }
  bytes(): Buffer | null { const n = this.int(); if (n < 0 || n > this.remaining) throw new ProtocolError('Invalid byte length'); if (!n) return null; const b = this.buffer.subarray(this.offset, this.offset + n); this.offset += n; return b; }
  string(): string | null {
    const b = this.bytes(); if (!b) return null;
    if (this.translation === 3 && b.length % 2) throw new ProtocolError('Odd UTF-16 length');
    const s = this.translation === 3 ? Buffer.from(b).swap16().toString('utf16le').replace(/^\uFEFF/, '') : b.toString(this.translation === 2 ? 'ascii' : 'utf8');
    return s.endsWith('\0') ? s.slice(0, -1) : s;
  }
}
export interface ObjectSpec { name: string | null; type: number; id: number }
export interface FieldSpec {
  name: string | null; displayName: string | null; dataType: number;
  calculated: boolean; caseInsensitive: boolean; hasPickList: boolean; hidden: boolean;
  multiValued: boolean; readOnly: boolean; required: boolean; scale: number; textLength: number;
  currencyCodeField: string | null; exchangeDateField: string | null;
}
export interface NotifySpec {
  activeRow: number; begRow: number; flag1: boolean; flag2: boolean; busCompId: number;
  currRow: number; fieldName: string | null; index: number; intValue: number; notifyId: number;
  type: number; values: (string | null)[]; errorFields: (string | null)[]; fields: FieldSpec[]; size: number;
}
export type Arg = { type: 1; value: string | null } | { type: 2 | 5 | 6 | 12 | 13; value: number } |
  { type: 4; value: Buffer | null } | { type: 7; value: ObjectSpec[] } | { type: 8; value: FieldSpec[] } |
  { type: 9; value: (string | null)[] } | { type: 10; value: NotifySpec[] } | { type: 11; value: Args };
export type Args = Map<string, Arg>;
export type Input = string | number | boolean | null | string[] | Buffer | Args;
export function args(values: Record<string, Input> = {}): Args {
  return new Map(Object.entries(values).map(([key, v]): [string, Arg] => [key,
    v instanceof Map ? { type: 11, value: v } : Buffer.isBuffer(v) ? { type: 4, value: v } :
    Array.isArray(v) ? { type: 9, value: v } : typeof v === 'number' || typeof v === 'boolean' ?
    { type: 2, value: Number(v) } : { type: 1, value: v }]));
}
export function value<T>(list: Args, key: string): T {
  const a = list.get(key); if (!a) throw new ProtocolError(`Missing RPC argument: ${key}`); return a.value as T;
}
function readField(r: Reader): FieldSpec {
  return { name: r.string(), displayName: r.string(), dataType: r.int(), calculated: !!r.int(), caseInsensitive: !!r.int(), hasPickList: !!r.int(), hidden: !!r.int(), multiValued: !!r.int(), readOnly: !!r.int(), required: !!r.int(), scale: r.int(), textLength: r.int(), currencyCodeField: r.string(), exchangeDateField: r.string() };
}
function writeField(w: Writer, f: FieldSpec): void {
  w.string(f.name).string(f.displayName).int(f.dataType);
  for (const b of [f.calculated, f.caseInsensitive, f.hasPickList, f.hidden, f.multiValued, f.readOnly, f.required]) w.int(Number(b));
  w.int(f.scale).int(f.textLength).string(f.currencyCodeField).string(f.exchangeDateField);
}
const array = <T>(r: Reader, read: () => T): T[] => Array.from({ length: r.count() }, read);
function readNotify(r: Reader): NotifySpec {
  return { activeRow: r.int(), begRow: r.int(), flag1: !!r.int(), flag2: !!r.int(), busCompId: r.int(), currRow: r.int(), fieldName: r.string(), index: r.int(), intValue: r.int(), notifyId: r.int(), type: r.int(), values: array(r, () => r.string()), errorFields: array(r, () => r.string()), fields: array(r, () => readField(r)), size: r.int() };
}
export function writeArgs(w: Writer, list: Args, depth = 0): void {
  if (depth > 128) throw new ProtocolError('ArgList nesting exceeds 128');
  w.int(list.size);
  for (const [name, a] of list) {
    w.string(name).int(a.type);
    switch (a.type) {
      case 1: w.string(a.value); break;
      case 2: case 5: case 6: case 12: case 13: w.int(a.value); break;
      case 4: w.bytes(a.value); break;
      case 9: w.int(a.value.length); for (const s of a.value) w.string(s); break;
      case 11: writeArgs(w, a.value, depth + 1); break;
      case 7: w.int(a.value.length); for (const o of a.value) w.string(o.name).int(o.type).int(o.id); break;
      case 8: w.int(a.value.length); for (const f of a.value) writeField(w, f); break;
      case 10: throw new ProtocolError('Notifications cannot be sent by clients');
    }
  }
}
export function readArgs(r: Reader, depth = 0): Args {
  if (depth > 128) throw new ProtocolError('ArgList nesting exceeds 128');
  const list: Args = new Map(); const count = r.count(8);
  for (let i = 0; i < count; i++) {
    const name = r.string() ?? '', type = r.int(); let a: Arg;
    switch (type) {
      case 1: a = { type, value: r.string() }; break;
      case 2: case 5: case 6: case 12: case 13: a = { type, value: r.int() }; break;
      case 4: a = { type, value: r.bytes() }; break;
      case 9: a = { type, value: array(r, () => r.string()) }; break;
      case 11: a = { type, value: readArgs(r, depth + 1) }; break;
      case 7: a = { type, value: array(r, () => ({ name: r.string(), type: r.int(), id: r.int() })) }; break;
      case 8: a = { type, value: array(r, () => readField(r)) }; break;
      case 10: a = { type, value: array(r, () => readNotify(r)) }; break;
      default: throw new ProtocolError(`Unsupported argument type ${type}`);
    }
    list.set(name, a);
  }
  return list;
}
export function readErrors(r: Reader): SiebelErrorDetail[] {
  const result: SiebelErrorDetail[] = [], count = r.count(16);
  for (let i = 0; i < count; i++) { r.int(); const code = r.int(), message = r.string() ?? ''; r.int(); result.push({ code, message }); }
  return result;
}
export function encodeRequest(type: number, sequence: number, session: number, body: Buffer, compress = false, whiteListedMethod = 0): Buffer {
  const wireType = type === 401 && body.length >= 4 && body.readInt32BE(0) === 1001 ? type | -2147483648 : type;
  const inner = new Writer().int(1).int(12).int(type === 1101 || type === 1102 ? 0 : body.length + 16).int(wireType).int(session).int(sequence).int(whiteListedMethod).build();
  let payload = Buffer.concat([inner, body]);
  const compression = compress && payload.length + 48 >= 100;
  if (compression) payload = deflateSync(payload);
  const header = new Writer().int(44 + payload.length).int(compression ? 16 : 0).int(1).int(sequence).int(session).int(1).int(payload.length).int(0).int(0).int(0).int(0).int(0).build();
  return Buffer.concat([header, payload]);
}
export interface DecodedPacket { sequence: number; session: number; type: number; reader: Reader }
export function decodePacket(frame: Buffer, translation: Translation = 4, maxBytes = 64 * 1024 * 1024): DecodedPacket {
  if (frame.length < 60 || frame.length > maxBytes || frame.readInt32BE(0) !== frame.length - 4) throw new ProtocolError('Invalid frame length');
  const flags = frame.readInt32BE(4);
  if ((flags & ~16) !== 0) throw new ProtocolError(`Unsupported frame flags ${flags}`);
  let payload = frame.subarray(48);
  if (flags & 16) { try { payload = inflateSync(payload, { maxOutputLength: maxBytes - 48 }); } catch { throw new ProtocolError('Invalid or oversized zlib payload'); } }
  const r = new Reader(payload, translation), type = r.int(), headerLength = r.int(), bodyLength = r.int();
  if (![2, 3, 5].includes(type) || headerLength !== 12 || bodyLength < 0 || bodyLength > r.remaining) throw new ProtocolError('Invalid SISNAPI message header');
  return { sequence: frame.readInt32BE(12), session: frame.readInt32BE(16), type, reader: r };
}

/** Reassembles fragmented/coalesced TCP frames with a bounded advertised size. */
export class FrameDecoder {
  private header = Buffer.alloc(4);
  private headerUsed = 0;
  private frame?: Buffer;
  private used = 0;
  constructor(public readonly maxBytes = 64 * 1024 * 1024) {}
  push(chunk: Buffer): Buffer[] {
    const frames: Buffer[] = []; let offset = 0;
    while (offset < chunk.length) {
      if (!this.frame) {
        const n = Math.min(4 - this.headerUsed, chunk.length - offset);
        chunk.copy(this.header, this.headerUsed, offset, offset + n); this.headerUsed += n; offset += n;
        if (this.headerUsed < 4) break;
        const length = this.header.readInt32BE(0) + 4;
        if (length < 60 || length > this.maxBytes) throw new ProtocolError('Invalid SISNAPI frame size');
        this.frame = Buffer.allocUnsafe(length); this.header.copy(this.frame); this.used = 4; this.headerUsed = 0;
      }
      const n = Math.min(this.frame.length - this.used, chunk.length - offset);
      chunk.copy(this.frame, this.used, offset, offset + n); this.used += n; offset += n;
      if (this.used === this.frame.length) { frames.push(this.frame); this.frame = undefined; this.used = 0; }
    }
    return frames;
  }
}
