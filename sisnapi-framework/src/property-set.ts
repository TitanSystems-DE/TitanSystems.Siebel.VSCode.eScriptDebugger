import { ProtocolError } from './errors.js';

/** Local DataBean PropertySet. Lengths in the wire text format are UTF-16 code units. */
export class SiebelPropertySet {
  private type = '';
  private value = '';
  private bytes?: Buffer;
  private properties = new Map<string, string>();
  private children: SiebelPropertySet[] = [];
  private iterator: Iterator<string> = [][Symbol.iterator]();
  getType(): string { return this.type; }
  constructor(source?: string | SiebelPropertySet) { if (typeof source === 'string') this.copy(SiebelPropertySet.fromString(source)); else if (source) this.copy(source); }
  setType(value: string): boolean { this.type = value; return true; }
  getValue(): string { return this.value; }
  setValue(value: string): boolean { this.value = value; this.bytes = undefined; return true; }
  getByteValue(): Buffer | undefined { return this.bytes && Buffer.from(this.bytes); }
  setByteValue(value: Uint8Array): void { this.bytes = Buffer.from(value); this.value = ''; }
  isStringValue(): boolean { return this.bytes === undefined; }
  setProperty(name: string, value: string): boolean { this.properties.set(name, value); return true; }
  getProperty(name: string): string { return this.properties.get(name) ?? ''; }
  propertyExists(name: string): boolean { return this.properties.has(name); }
  removeProperty(name: string): boolean { this.properties.delete(name); return true; }
  getPropertyNames(): IterableIterator<string> { return this.properties.keys(); }
  getPropertyCount(): number { return this.properties.size; }
  getFirstProperty(): string { this.iterator = this.properties.keys(); return this.getNextProperty(); }
  getNextProperty(): string { return this.iterator.next().value ?? ''; }
  entries(): IterableIterator<[string, string]> { return this.properties.entries(); }
  getChildCount(): number { return this.children.length; }
  getChild(index: number): SiebelPropertySet { this.checkIndex(index); return this.children[index]; }
  private checkIndex(index: number, insert = false): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.children.length + Number(insert)) throw new RangeError('Invalid child index');
  }
  private checkChild(child: SiebelPropertySet): void {
    const visit = (p: SiebelPropertySet): boolean => p === this || p.children.some(visit);
    if (visit(child)) throw new TypeError('Cyclic PropertySet');
  }
  addChild(child: SiebelPropertySet): number { this.checkChild(child); return this.children.push(child) - 1; }
  insertChildAt(child: SiebelPropertySet, index: number): boolean { this.checkIndex(index, true); this.checkChild(child); this.children.splice(index, 0, child); return true; }
  removeChild(index: number): boolean { this.checkIndex(index); this.children.splice(index, 1); return true; }
  reset(): boolean { this.type = this.value = ''; this.bytes = undefined; this.properties.clear(); this.children = []; this.iterator = [][Symbol.iterator](); return true; }
  copy(): SiebelPropertySet;
  copy(source: SiebelPropertySet): void;
  copy(source?: SiebelPropertySet): SiebelPropertySet | void {
    if (!source) { const result = new SiebelPropertySet(); result.copy(this); return result; }
    if (source === this) return;
    this.type = source.type; this.value = source.value; this.bytes = source.getByteValue();
    this.properties = new Map(source.properties); this.children = source.children.map(c => c.copy());
  }
  encodeAsString(): string {
    const str = (s: string) => `${s.length}*${s}`;
    const encode = (p: SiebelPropertySet, depth: number): string => {
      if (depth > 128) throw new ProtocolError('PropertySet nesting exceeds 128');
      return `${p.properties.size}*${p.children.length}*${str(p.type)}` +
        (p.bytes === undefined ? `3*${str(p.value)}` : `2*${p.bytes.length}*${p.bytes.toString('base64')}`) +
        [...p.properties].map(([k, v]) => str(k) + str(v)).join('') + p.children.map(c => encode(c, depth + 1)).join('');
    };
    return '@0*0*' + encode(this, 0);
  }
  static fromString(text: string): SiebelPropertySet {
    if (text === '') return new SiebelPropertySet();
    if (!text.startsWith('@')) throw new ProtocolError('Unsupported PropertySet format (expected @)');
    let offset = 1;
    const num = (signed = false): number => {
      const end = text.indexOf('*', offset); const token = text.slice(offset, end);
      if (end < 0 || !(signed ? /^-?\d+$/ : /^\d+$/).test(token)) throw new ProtocolError('Invalid PropertySet integer');
      const n = Number(token); if (!Number.isSafeInteger(n) || (!signed && n > text.length)) throw new ProtocolError('PropertySet length limit');
      offset = end + 1; return n;
    };
    const take = (n: number): string => { if (offset + n > text.length) throw new ProtocolError('Truncated PropertySet'); const s = text.slice(offset, offset + n); offset += n; return s; };
    const str = () => take(num());
    if (num() !== 0 || num() !== 0) throw new ProtocolError('Unsupported PropertySet version');
    const read = (depth: number): SiebelPropertySet => {
      if (depth > 128) throw new ProtocolError('PropertySet nesting exceeds 128');
      const p = new SiebelPropertySet(), props = num(), children = num(); p.setType(str());
      const variant = num();
      if (variant === 0) p.setValue('');
      else if (variant === 1) p.setValue(String(num(true)));
      else if (variant === 3 || variant === 6) p.setValue(str());
      else if (variant === 2 || variant === 4 || variant === 5) {
        const size = num() * (variant === 5 ? 2 : 1), encoded = take(Math.ceil(size / 3) * 4);
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new ProtocolError('Invalid PropertySet base64');
        const bytes = Buffer.from(encoded, 'base64'); if (bytes.length !== size) throw new ProtocolError('Invalid PropertySet binary length'); p.setByteValue(bytes);
      } else throw new ProtocolError(`Unsupported PropertySet variant ${variant}`);
      for (let i = 0; i < props; i++) { const k = str(); p.setProperty(k, str()); }
      for (let i = 0; i < children; i++) p.addChild(read(depth + 1));
      return p;
    };
    const result = read(0); if (offset !== text.length) throw new ProtocolError('Trailing PropertySet data'); return result;
  }
  decodeFromString(text: string): boolean { try { this.copy(SiebelPropertySet.fromString(text)); return true; } catch { return false; } }
}
export { SiebelPropertySet as PropertySet };
