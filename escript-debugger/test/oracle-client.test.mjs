import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConnectionString } from '../runtime/oracle-client.mjs';

test('expands the short Siebel URL for older Oracle Java Data Beans', () => {
  assert.equal(
    normalizeConnectionString('siebel://gateway:2321/ENT/EAIObjMgr_enu'),
    'siebel.tcpip.none.none://gateway:2321/ENT/EAIObjMgr_enu'
  );
  assert.equal(
    normalizeConnectionString('siebel.tcpip.rsa.none://gateway:2321/ENT/EAIObjMgr_enu'),
    'siebel.tcpip.rsa.none://gateway:2321/ENT/EAIObjMgr_enu'
  );
});
