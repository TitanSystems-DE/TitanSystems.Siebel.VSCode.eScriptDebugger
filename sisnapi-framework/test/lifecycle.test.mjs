import test from 'node:test';
import assert from 'node:assert/strict';
import { Application, PropertySet, SisnapiConnection } from '../dist/index.js';
import { Writer, args } from '../dist/protocol.js';
import { mockServer, rpcData, response } from './mock-server.mjs';

test('extended login, detach/attach and old handle invalidation', async () => {
  let flag;
  const server = await mockServer(req => {
    if (req.type === 1101) { assert.equal(req.reader.int(), 1); assert.equal(req.reader.int(), 120); }
    if (req.type === 102) {
      const r = req.reader; assert.equal(r.string(), null); assert.equal(r.string(), 'u'); assert.equal(r.string(), 'p');
      assert.deepEqual([r.int(), r.int(), r.int(), r.int()], [4, 0, 1, 0]);
      assert.equal(r.string(), 'SWEFragment'); assert.equal(r.string(), 'JAVA'); assert.equal(r.string(), 'debug'); assert.equal(r.remaining, 0);
    }
    if (req.type !== 401) return;
    if (req.code === 1) return rpcData(args({ busObjId: 50 }));
    if (req.code === 501) { flag = req.args.get('bAttach')?.value; return rpcData(args({ startupState: args({ loginName: 'u' }) })); }
    return rpcData();
  });
  const app = new Application();
  try {
    await app.login(server.url, 'u', 'p', 'enu', true, 120, 'debug');
    const bo = await app.getBusObject('Account');
    const handle = app.getSessionID(); assert.equal(handle, server.url + '/!1.7b.63.3e8');
    assert.equal(await app.detach(), handle); assert.equal(app.connection.connected, false);
    await app.attach(handle); assert.equal(flag, 1); assert.equal(await app.loginName(), 'u');
    await assert.rejects(bo.getBusComp('Account'), /closed session/);
    assert.match(server.received.filter(r => r.type === 101)[1].routingHeader, /\/!1\.7b HTTP/);
    const handle2 = await app.detach(); await app.attachEx(handle2); assert.equal(flag, undefined);
    assert.equal(server.received.filter(r => r.type === 102).length, 1);
    await app.logoff(false); assert.deepEqual(server.failures, []);
  } finally { app.close(); await server.close(); }
});

test('service WLM, encoded overload, properties and asynchronous application RPCs', async () => {
  const server = await mockServer(req => {
    if (req.type !== 401) return;
    if (req.code === 5) return rpcData(args({ serviceId: 200 }));
    if (req.code === 603) {
      assert.equal(req.whitelist, 1); assert.equal(req.args.get('WLM').value, 'T');
      const p = PropertySet.fromString(req.args.get('inputArgs').value); p.setValue('reply'); return rpcData(args({ outputArgs: p.encodeAsString() }));
    }
    if (req.code === 501) return rpcData(args({ startupState: args({ loginName: 'u' }) }));
    if (req.code === 2) return rpcData(args({ Service: args({ Type: 'Service', Name: 'Echo', Data: args({
      property: args({ Type: 'UserPropMap', Name: 'Configured', Data: args({ value: 'yes' }) })
    }) }) }));
    if (req.code === 510) return rpcData(args({ returnArgs: 'async result' }));
    if (req.code === 777) return rpcData(args({ outputArgs: 'query result' }));
    return rpcData();
  });
  const app = new Application();
  try {
    await app.login(server.url, 'u', 'p'); const service = await app.getService('Echo');
    const p = new PropertySet(); p.setProperty('WLM', 'T');
    assert.equal((await service.invokeMethod('Echo', p)).getValue(), 'reply');
    p.setProperty('#INOPENINT', new PropertySet().encodeAsString()); const out = new PropertySet();
    await service.invokeMethod('Echo', p, out, true); assert.equal(PropertySet.fromString(out.getProperty('#OUTOPENINT')).getValue(), 'reply');
    assert.equal(await service.getProperty('Configured'), 'yes'); await service.setProperty('local', 'test'); assert.equal(await service.propertyExists('local'), true);
    await service.removeProperty('local'); assert.equal(await service.getFirstProperty(), 'Configured'); assert.equal(await service.getNextProperty(), '');
    assert.equal(await app.sendMsgAsync(args()), 'async result'); assert.equal(await app.sendExecuteQueryAsync(args(), 777), 'query result');
    assert.deepEqual(server.failures, []);
  } finally { app.close(); await server.close(); }
});

test('cancellation reaches the server while the main request is still pending', async () => {
  let blocked, entered; const waiting = new Promise(resolve => { entered = resolve; });
  const server = await mockServer(req => {
    if (req.type !== 401) return;
    if (req.code === 506) { blocked = req; entered(); return null; }
    if (req.code === 1001) {
      assert.notEqual(req.socket, blocked.socket); assert.match(req.routingHeader, /\/!1\.7b HTTP/);
      assert.equal(req.wireType, 401 | -2147483648); assert.equal(req.session, 99);
      assert.equal(req.args.get('requestId').type, 13); assert.equal(req.args.get('requestId').value, 1234);
      blocked.socket.write(response(blocked.sequence, 401, rpcData(args({ returnVal: 'cancelled' })))); return rpcData();
    }
    return rpcData();
  });
  const app = new Application({ requestTimeout: 2000 });
  try {
    await app.login(server.url, 'u', 'p'); const operation = app.invokeMethod('LongQuery'); await waiting;
    await app.cancelQuery(1234); assert.equal(await operation, 'cancelled'); assert.deepEqual(server.failures, []);
    assert.equal(server.received.filter(r => r.type === 1101).length, 1);
    assert.equal(server.received.filter(r => r.type === 103).length, 0);
  } finally { app.close(); await server.close(); }
});

test('Hello NAK preserves server code and closes failed login', async () => {
  const server = await mockServer(req => {
    if (req.type !== 101) return;
    const data = new Writer(3).int(1).int(0).int(12345).string('Abgelehnt').int(0).build();
    req.socket.write(response(req.sequence, 101, data, { nak: true })); return null;
  });
  const app = new Application();
  try { await assert.rejects(app.login(server.url, 'u', 'p'), e => e.getErrorCode() === 12345 && e.message === 'Abgelehnt'); assert.equal(app.connection.connected, false); }
  finally { app.close(); await server.close(); }
});

test('malformed response correlation closes connection and rejects pending RPC', async () => {
  const server = await mockServer(req => {
    if (req.type !== 401) return;
    req.socket.write(response(req.sequence + 1, 401, rpcData())); return null;
  });
  const app = new Application();
  try { await app.login(server.url, 'u', 'p'); await assert.rejects(app.getProfileAttr('x'), /sequence/); assert.equal(app.connection.connected, false); }
  finally { app.close(); await server.close(); }
});

test('probe opens and closes a session without a Logon request', async () => {
  const server = await mockServer(() => undefined); const client = new SisnapiConnection();
  try { assert.equal((await client.probe(server.url, true)).sessionEstablished, true); assert.deepEqual(server.received.map(r => r.type), [101, 1101, 1102]); }
  finally { client.close(); await server.close(); }
});

test('cancelled login cannot close a subsequent connection', async () => {
  let entered; const waiting = new Promise(resolve => { entered = resolve; });
  const blocked = await mockServer(req => { if (req.type === 101) { entered(); return null; } });
  const healthy = await mockServer(() => undefined); const client = new SisnapiConnection();
  try {
    const old = client.login(blocked.url, 'u', 'p').catch(e => e); await waiting; client.close();
    await client.login(healthy.url, 'u', 'p'); assert.ok(await old instanceof Error); assert.equal(client.connected, true);
    await client.logoff(false);
  } finally { client.close(); await blocked.close(); await healthy.close(); }
});

test('rejected Logon closes the allocated session', async () => {
  const server = await mockServer(req => {
    if (req.type !== 102) return;
    const data = new Writer().int(1).int(0).int(777).string('Login rejected').int(0).build();
    req.socket.write(response(req.sequence, 102, data, { nak: true })); return null;
  });
  const client = new SisnapiConnection();
  try { await assert.rejects(client.login(server.url, 'u', 'p'), e => e.getErrorCode() === 777); assert.equal(server.received.at(-1).type, 1102); }
  finally { client.close(); await server.close(); }
});
