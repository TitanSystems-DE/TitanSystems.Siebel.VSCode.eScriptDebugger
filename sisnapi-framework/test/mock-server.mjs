import net from 'node:net';
import { inflateSync, deflateSync } from 'node:zlib';
import { Reader, Writer, readArgs, writeArgs, args } from '../dist/protocol.js';

/** Test peer writes response envelopes independently from the production codec. */
export function response(sequence, requestType, data = Buffer.alloc(0), { compression = false, nak = false } = {}) {
  const payload = new Writer(4).int(nak ? 3 : 2).int(12).int(data.length + (nak ? 4 : 8)).int(sequence);
  if (!nak) payload.int(requestType);
  let body = Buffer.concat([payload.build(), data]); if (compression) body = deflateSync(body);
  const header = Buffer.alloc(48); header.writeInt32BE(44 + body.length, 0); header.writeInt32BE(compression ? 16 : 0, 4);
  header.writeInt32BE(1, 8); header.writeInt32BE(sequence, 12); header.writeInt32BE(42, 16);
  header.writeInt32BE(nak ? 3 : 2, 20); header.writeInt32BE(body.length, 24);
  return Buffer.concat([header, body]);
}
export function rpcData(list = args(), errors = [], translation = 4) {
  const w = new Writer(translation); writeArgs(w, list); w.int(errors.length);
  for (const e of errors) w.int(0).int(e.code).string(e.message).int(0);
  return w.build();
}
export function notification(overrides = {}) {
  return { activeRow: 0, begRow: 0, flag1: true, flag2: true, busCompId: 100, currRow: 0, fieldName: null,
    index: 0, intValue: 0, notifyId: 1, type: 23, values: [], errorFields: [], fields: [], size: 1, ...overrides };
}
// Client intentionally cannot encode notifications; this server implementation is independent.
export function rpcWithNotifications(list, notifications, errors = [], translation = 4) {
  const w = new Writer(translation); writeArgs(w, list); const prefix = w.build(); prefix.writeInt32BE(list.size + 1);
  const n = new Writer(translation).string('notifyList').int(10).int(notifications.length);
  for (const x of notifications) {
    n.int(x.activeRow).int(x.begRow).int(+x.flag1).int(+x.flag2).int(x.busCompId).int(x.currRow).string(x.fieldName)
      .int(x.index).int(x.intValue).int(x.notifyId).int(x.type).int(x.values.length);
    for (const v of x.values) n.string(v);
    n.int(x.errorFields.length); for (const v of x.errorFields) n.string(v);
    if (x.fields.length) throw Error('Use field definitions in RPC arguments for this test');
    n.int(0).int(x.size);
  }
  n.int(errors.length); for (const e of errors) n.int(0).int(e.code).string(e.message).int(0);
  return Buffer.concat([prefix, n.build()]);
}
export async function mockServer(handler, { translation = 4, compression = false, fragment = true } = {}) {
  const sockets = new Set(), received = [], failures = [];
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffered = Buffer.alloc(0), initial = true, routingHeader;
    socket.on('data', chunk => {
      try {
        buffered = Buffer.concat([buffered, chunk]);
        if (initial) {
          const end = buffered.indexOf('\r\n\r\n'); if (end < 0) return;
          const header = buffered.subarray(0, end).toString();
          routingHeader = header;
          if (!header.startsWith('POST http://')) throw Error('Missing routing preamble');
          buffered = buffered.subarray(end + 4); initial = false;
        }
        while (buffered.length >= 4) {
          const size = buffered.readInt32BE(0) + 4; if (buffered.length < size) return;
          const frame = buffered.subarray(0, size); buffered = buffered.subarray(size);
          let payload = frame.subarray(48); if (frame.readInt32BE(4) === 16) payload = inflateSync(payload);
          const r = new Reader(payload, translation); if (r.int() !== 1 || r.int() !== 12) throw Error('Invalid request header');
          r.int(); const wireType = r.int(), type = wireType & 0x7fffffff, session = r.int(), sequence = r.int(), whitelist = r.int();
          const request = { type, wireType, whitelist, session, sequence, reader: r, socket, routingHeader }; received.push(request);
          let data;
          if (type === 101) data = new Writer().int(42).int(131077).bytes(null).string(null).int(translation).int(1).int(1).int(1).build();
          else if (type === 1101) data = new Writer().int(123).int(99).int(1000).int(1).build();
          else if ([102, 103, 1102].includes(type)) data = Buffer.alloc(0);
          else if (type === 401) { request.code = r.int(); request.objectType = r.int(); request.objectId = r.int(); request.args = readArgs(r); }
          const custom = handler(request); if (custom === null) continue; if (custom !== undefined) data = custom;
          const out = response(sequence, type, data, { compression: type !== 101 && compression });
          if (fragment) { socket.write(out.subarray(0, 2)); setImmediate(() => { if (!socket.destroyed) socket.write(out.subarray(2)); }); } else socket.write(out);
        }
      } catch (error) { failures.push(error); socket.destroy(); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { received, failures, url: `siebel.tcpip.none.${compression ? 'zlib' : 'none'}://127.0.0.1:${server.address().port}/ENT/EAIObjMgr_enu`,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); } };
}
