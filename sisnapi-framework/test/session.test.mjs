import test from 'node:test';
import assert from 'node:assert/strict';
import { Application, PropertySet, SiebelException } from '../dist/index.js';
import { args } from '../dist/protocol.js';
import { mockServer, rpcData, rpcWithNotifications, notification } from './mock-server.mjs';

const field = name => ({ name, displayName: name, dataType: 2, calculated: false, caseInsensitive: false, hasPickList: false, hidden: false, multiValued: false, readOnly: false, required: false, scale: 0, textLength: 255, currencyCodeField: null, exchangeDateField: null });
for (const translation of [3, 4]) test(`full DataBean session, notifications, CRUD, service, UTF ${translation}, compression`, async () => {
  let current = 'Grüße😀', cursor = 0;
  const server = await mockServer(req => {
    if (req.type === 102) {
      assert.equal(req.session, 99); assert.equal(req.reader.string(), null);
      assert.equal(req.reader.string(), 'Jörg'); assert.equal(req.reader.string(), 'päss🔑'); return;
    }
    if (req.type !== 401) return;
    const a = req.args; assert.equal(req.session, 99);
    const rpc = (values = {}) => rpcData(args(values), [], translation);
    if (req.code === 1 && req.objectId === 0) { assert.equal(req.objectType, 5); return rpc({ busObjId: 50 }); }
    if (req.code === 1 && req.objectId === 50) {
      const list = args({ busCompId: 100, fieldIndexList: ['0', '1'] }); list.set('newFieldList', { type: 8, value: [field('Id'), field('Name')] });
      return rpcData(list, [], translation);
    }
    if (req.code === 201 || req.code === 202) {
      cursor = 0;
      return rpcWithNotifications(args(), [notification({ type: 10, values: ['r0', '1'] }), notification({ type: 17, values: ['1-ABC', current] }), notification({ type: 23, fieldName: 'bExecuted', intValue: 1 })], [], translation);
    }
    if (req.code === 204) {
      if (++cursor > 1) return rpcWithNotifications(args(), [notification({ activeRow: -1 })], [{ code: 7668105, message: 'End of cursor' }], translation);
      return rpcWithNotifications(args(), [notification({ type: 17, values: ['1-DEF', 'Zweite Zeile'] })], [], translation);
    }
    if (req.code === 209) {
      current = a.get('valueList').value[0];
      return rpcWithNotifications(args(), [notification({ type: 13, fieldName: 'Name', values: [current] })], [], translation);
    }
    if (req.code === 5) return rpc({ serviceId: 200 });
    if (req.code === 603) {
      assert.equal(req.objectType, 12); assert.equal(req.objectId, 200);
      const p = PropertySet.fromString(a.get('inputArgs').value); p.setProperty('Output', 'OK'); return rpc({ outputArgs: p.encodeAsString() });
    }
    if (req.code === 702) return rpc({ Value: 'ProfileValue' });
    if (req.code === 506) return rpc({ returnVal: 'Invoked' });
    if ([300, 342, 343, 344, 210, 207, 348, 332, 403, 600].includes(req.code)) return rpc();
    throw Error(`Unexpected RPC ${req.code}`);
  }, { translation, compression: true });
  const app = new Application({ requestTimeout: 2000 });
  try {
    await app.login(server.url, 'Jörg', 'päss🔑');
    const bo = await app.getBusObject('Account'), bc = await bo.getBusComp('Account');
    assert.equal(await bo.getBusComp('Account'), bc);
    await bc.activateField('Name'); await bc.clearToQuery(); await bc.setSearchSpec('Name', 'A*'); await bc.executeQuery();
    assert.equal(await bc.firstRecord(), true); assert.equal(await bc.getFieldValue('Name'), 'Grüße😀');
    await bc.setFieldValue('Name', 'Changed'); assert.equal(await bc.getFieldValue('Name'), 'Changed'); await bc.writeRecord();
    assert.equal(await bc.nextRecord(), true); assert.equal(await bc.getFieldValue('Name'), 'Zweite Zeile'); assert.equal(await bc.nextRecord(), false);
    await assert.rejects(bc.getFieldValue('Name'), /No active record/);
    const service = await app.getService('Echo'), input = new PropertySet(), output = new PropertySet(); input.setValue('漢😀');
    assert.equal(await service.invokeMethod('Echo', input, output), true); assert.equal(output.getValue(), '漢😀'); assert.equal(output.getProperty('Output'), 'OK');
    assert.equal(await app.getProfileAttr('Test'), 'ProfileValue'); assert.equal(await app.invokeMethod('Test'), 'Invoked');
    await service.release(); await assert.rejects(service.invokeMethod('Echo', input), /released/);
    await bo.release(); await assert.rejects(bc.getFieldValue('Name'), /released/);
    await app.logoff(); assert.deepEqual(server.received.slice(-2).map(r => r.type), [103, 1102]); assert.deepEqual(server.failures, []);
  } finally { app.close(); await server.close(); }
});
test('RPC errors retain codes and do not poison session; concurrent calls serialize', async () => {
  let outstanding = false, observedOverlap = false;
  const server = await mockServer(req => {
    if (req.type !== 401) return;
    if (outstanding) observedOverlap = true; outstanding = true; queueMicrotask(() => { outstanding = false; });
    if (req.code === 702 && req.args.get('Name').value === 'bad') return rpcData(args(), [{ code: 12345, message: 'SBL-TEST: failed' }]);
    return rpcData(args({ Value: req.args.get('Name').value }));
  });
  const app = new Application();
  try {
    await app.login(server.url, 'u', 'p');
    await assert.rejects(app.getProfileAttr('bad'), e => e instanceof SiebelException && e.getErrorCode() === 12345);
    assert.deepEqual(await Promise.all(['a', 'b', 'c'].map(x => app.getProfileAttr(x))), ['a', 'b', 'c']);
    assert.equal(observedOverlap, false); assert.deepEqual(server.failures, []);
  } finally { app.close(); await server.close(); }
});
test('timeout closes transport and rejects queued requests without replay', async () => {
  const server = await mockServer(req => req.type === 401 ? null : undefined);
  const app = new Application({ requestTimeout: 60 });
  try {
    await app.login(server.url, 'u', 'p');
    const results = await Promise.allSettled([app.getProfileAttr('a'), app.getProfileAttr('b')]);
    assert.equal(results[0].status, 'rejected'); assert.match(results[0].reason.message, /timed out/);
    assert.equal(results[1].status, 'rejected'); assert.equal(app.connection.connected, false);
    assert.equal(server.received.filter(r => r.type === 401).length, 1);
  } finally { app.close(); await server.close(); }
});
