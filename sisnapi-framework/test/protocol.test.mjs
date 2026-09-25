import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Writer, Reader, args, writeArgs, readArgs, encodeRequest, decodePacket, FrameDecoder } from '../dist/protocol.js';
import { PropertySet, parseConnectionString } from '../dist/index.js';

const fixture = name => readFileSync(new URL(`fixtures/${name}`, import.meta.url));
test('Hello transport bytes match an actual Java Connection captured over TCP', () => {
  const body = new Writer().int(131077).int(0).bytes(null).int(0).int(8).int(0).int(65001).int(0).build();
  assert.deepEqual(encodeRequest(101, 1, 0, body), fixture('java-hello-wire.bin'));
});
function javaWire(name) {
  const b = Buffer.from(fixture(name + '.bin'));
  // Connection.writePacket updates the reserved transport header, independently
  // of Request.startRequest, whose original bytes are preserved in the fixture.
  b.writeInt32BE(b.length - 4, 0); b.writeInt32BE(0, 4); b.writeInt32BE(7, 12);
  b.writeInt32BE(42, 16); b.writeInt32BE(b.length - 48, 24); return b;
}
test('request bytes match execution of the supplied Java JAR', () => {
  for (const [name, type, body] of [
    ['hello', 101, new Writer().int(131077).int(0).bytes(null).int(16).int(8).int(0).int(65001).int(0).build()],
    ['session', 1101, new Writer().int(1).int(2700).build()],
    ...[3, 4].map(t => [`logon-utf${t === 3 ? 16 : 8}`, 102, new Writer(t).string(null).string('Jörg').string('päss🔑').int(4).int(0).int(1).int(0).string('').string('JAVA').string(null).build()]),
    ['logoff', 103, new Writer().int(0).build()], ['close', 1102, Buffer.alloc(0)]
  ]) assert.deepEqual(encodeRequest(type, 7, 42, body), javaWire(name), name);
});
test('Java RPC nested arguments decode and re-encode exactly', () => {
  const b = fixture('rpc.bin'); const r = new Reader(b.subarray(76));
  assert.equal(r.int(), 603); assert.equal(r.int(), 12); assert.equal(r.int(), 99);
  const list = readArgs(r); assert.equal(list.get('ref').type, 6);
  const nested = list.get('nested').value;
  assert.equal(nested.get('text').value, 'Grüße😀'); assert.equal(nested.get('int').value, -123);
  assert.deepEqual(nested.get('bytes').value, Buffer.from([0, 1, 255]));
  const w = new Writer(); writeArgs(w, list); assert.deepEqual(w.build(), b.subarray(88));
});
test('whitelist and cancellation bytes match the current Java implementation', () => {
  for (const [name, code, objectType, objectId, input, whitelist] of [
    ['whitelist', 603, 12, 99, args({ WLM: 'T' }), 1],
    ['cancel', 1001, 0, 0, new Map([['requestId', { type: 13, value: 1234 }]]), 0]
  ]) {
    const w = new Writer(3).int(code).int(objectType).int(objectId); writeArgs(w, input);
    assert.deepEqual(encodeRequest(401, 7, 42, w.build(), false, whitelist), javaWire(name));
  }
});
test('PropertySet matches Java including supplementary Unicode and binary child', () => {
  const java = fixture('property-set.txt').toString('utf8');
  const p = new PropertySet(); p.setType('Root😀'); p.setValue('a*bä'); p.setProperty('Name', '漢😀');
  const child = new PropertySet(); child.setType('Child'); child.setByteValue(Buffer.from([0, 1, 255, 3])); p.addChild(child);
  assert.equal(p.encodeAsString(), java); const decoded = PropertySet.fromString(java);
  assert.equal(decoded.getValue(), 'a*bä'); assert.deepEqual(decoded.getChild(0).getByteValue(), child.getByteValue());
  assert.equal(decoded.encodeAsString(), java);
  const copy = p.copy(); copy.getChild(0).setValue('changed'); assert.equal(p.getChild(0).isStringValue(), false);
  assert.throws(() => child.addChild(p), /Cyclic/);
  assert.throws(() => PropertySet.fromString(java.slice(0, -1)), /Truncated/);
  assert.throws(() => PropertySet.fromString(java + 'x'), /Trailing/);
});
test('fragmented and coalesced frames, zlib, length guards', () => {
  const inner = new Writer().int(2).int(12).int(8).int(1).int(103).build();
  const compressed = deflateSync(inner); const frame = Buffer.alloc(48 + compressed.length);
  frame.writeInt32BE(frame.length - 4); frame.writeInt32BE(16, 4); compressed.copy(frame, 48);
  const decoder = new FrameDecoder(); const result = [];
  for (const b of Buffer.concat([frame, frame])) result.push(...decoder.push(Buffer.from([b])));
  assert.equal(result.length, 2); assert.equal(decodePacket(result[0]).reader.int(), 1);
  assert.equal(new FrameDecoder().push(Buffer.concat([frame, frame])).length, 2);
  assert.throws(() => new FrameDecoder(100).push(Buffer.from('7fffffff', 'hex')), /size/);
  assert.throws(() => new Reader(Buffer.from('ffffffff', 'hex')).bytes(), /length/);
  assert.throws(() => readArgs(new Reader(Buffer.from('7fffffff', 'hex'))), /count/);
  const bombPayload = deflateSync(Buffer.alloc(20000)); const bomb = Buffer.alloc(48 + bombPayload.length);
  bomb.writeInt32BE(bomb.length - 4); bomb.writeInt32BE(16, 4); bombPayload.copy(bomb, 48);
  assert.throws(() => decodePacket(bomb, 4, 1024), /oversized/);
});
test('connection strings validate transport and explicit endpoint', () => {
  assert.deepEqual(parseConnectionString('siebel.ssl.none.zlib://[::1]:2321/ENT/EAIObjMgr_enu'), { host: '::1', port: 2321, path: 'ent/eaiobjmgr_enu', tls: true, compression: true });
  for (const s of ['siebel://host/ent/om', 'siebel.http://host:80/e/c', 'siebel://host:99999/e/c', 'siebel.tcpip.none.pkware://host:2321/e/c']) assert.throws(() => parseConnectionString(s));
});
