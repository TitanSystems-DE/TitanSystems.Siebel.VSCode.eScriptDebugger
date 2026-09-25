import assert from 'node:assert/strict';
import test from 'node:test';
import { decode, encode } from '../dist/runtime/sync-bridge.mjs';
import { SIEBEL_CONSTANTS } from '../dist/runtime/constants.mjs';
import { directMethodName, serviceScriptPlan } from '../dist/runtime/service-runtime.mjs';
import { stripSiebelTypes } from '../dist/runtime/type-stripper.mjs';
import { collectReferenceSignatures, transformSiebelReferences } from '../dist/runtime/reference-transformer.mjs';
import vm from 'node:vm';

test('remote facade maps Siebel PascalCase methods and handles', () => {
  const calls = [], bridge = { call(op, target, args) { calls.push({ op, target, args }); return { __handle: 9 }; } };
  const root = decode(bridge, { __handle: 0 });
  const child = root.GetBusObject('Contact');
  assert.equal(child.__handle, 9);
  assert.deepEqual(calls, [{ op: 'call', target: 0, args: ['getBusObject', 'Contact'] }]);
  assert.deepEqual(encode(child), { __handle: 9 });
});

test('supports with statements for ordinary and remote Siebel objects', () => {
  const calls = [], bridge = { call(op, target, args) { calls.push({ op, target, args }); return 'Smith'; } };
  const context = { ordinary: { value: 4 }, busComp: decode(bridge, { __handle: 12 }) };
  vm.createContext(context);
  new vm.Script(`
    with (ordinary) { ordinaryResult = value + 1; }
    var field = "Last Name";
    with (busComp) { remoteResult = GetFieldValue(field); }
  `).runInContext(context);
  assert.equal(context.ordinaryResult, 5);
  assert.equal(context.remoteResult, 'Smith');
  assert.deepEqual(calls, [{ op: 'call', target: 12, args: ['getFieldValue', 'Last Name'] }]);
});

test('plans a service runtime in the required order', () => {
  assert.deepEqual(
    serviceScriptPlan('C:\\service', 'C:\\extension\\service-implementation.escript', ['Zeta.escript', '(declerations).escript', 'Alpha.escript', 'notes.txt']),
    ['C:\\extension\\service-implementation.escript', 'C:\\service\\(declerations).escript', 'C:\\service\\Alpha.escript', 'C:\\service\\Zeta.escript']
  );
  assert.equal(directMethodName('MyMethod.escript'), 'MyMethod');
  assert.equal(directMethodName('UPPERCaseMethod.ESCRIPT'), 'UPPERCaseMethod');
  assert.equal(directMethodName('lowerCaseMethod.escript'), 'lowerCaseMethod');
  assert.notEqual(directMethodName('Test.escript'), directMethodName('test.escript'));
});

test('strips ST eScript types while preserving breakpoint positions', () => {
  const source = `// var fake:Wrong\nvar oBC : BusComp;\nvar text:String = "keep:Type";\nvar a:Number = 1, b : String = "x";\nvar typedFunction:Function = function(value:String) { return value; };\nfunction join(left : String, right:String) : String {\n  var object = { label: left ? right : "none" };\n  return typedFunction(object.label + text);\n}`;
  const stripped = stripSiebelTypes(source);
  assert.equal(stripped.length, source.length);
  assert.deepEqual([...stripped.matchAll(/\n/g)].map(match => match.index), [...source.matchAll(/\n/g)].map(match => match.index));
  assert.match(stripped, /var oBC\s+;/);
  assert.match(stripped, /"keep:Type"/);
  assert.match(stripped, /label: left \? right : "none"/);
  const context = {}; vm.createContext(context); new vm.Script(`${stripped}\nresult = join("a", "b");`).runInContext(context);
  assert.equal(context.result, 'bkeep:Type');
});

test('does not treat comments, strings or regular expressions as type declarations', () => {
  const source = `var matcher = /item,a:Type/;\nvar emoji:String = "😀:Type";\nvar value = condition ? "a:b" : "c:d";`;
  const stripped = stripSiebelTypes(source);
  assert.equal(stripped.length, source.length);
  assert.match(stripped, /\/item,a:Type\//);
  assert.match(stripped, /"😀:Type"/);
  assert.match(stripped, /condition \? "a:b" : "c:d"/);
});

test('implements primitive pass-by-reference with normal variables inside the function', () => {
  const source = `var caller = 3;\nfunction MyFunc(param1:Number, &param2:String) {\n  param2 = String(param1 * 2);\n  return param2;\n}\nvar returned = MyFunc(5, caller);`;
  const transformed = stripSiebelTypes(transformSiebelReferences(source, collectReferenceSignatures([source])));
  assert.equal((transformed.match(/\n/g) ?? []).length, (source.match(/\n/g) ?? []).length);
  const context = { __escriptMakeRef: (get, set) => ({ get value() { return get(); }, set value(value) { set(value); } }) };
  vm.createContext(context); new vm.Script(transformed).runInContext(context);
  assert.equal(context.caller, '10');
  assert.equal(context.returned, '10');
});

test('writes reference values back on early return and across source files', () => {
  const declaration = `function Update(&target) { target = "updated"; return true; }`;
  const caller = `var result = "old";\nUpdate(result);`;
  const signatures = collectReferenceSignatures([declaration, caller]);
  const context = { __escriptMakeRef: (get, set) => ({ get value() { return get(); }, set value(value) { set(value); } }) };
  vm.createContext(context);
  new vm.Script(transformSiebelReferences(declaration, signatures)).runInContext(context);
  new vm.Script(transformSiebelReferences(caller, signatures)).runInContext(context);
  assert.equal(context.result, 'updated');
});

test('exports the complete Siebel constant set with official values', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(SIEBEL_CONSTANTS).filter(([name]) => !['NoneView', 'NoneSetViewMode', 'OperationComplete'].includes(name))),
    {
      ContinueOperation: 1, CancelOperation: 2,
      ForwardBackward: 256, ForwardOnly: 257,
      NewBefore: 0, NewAfter: 1, NewBeforeCopy: 2, NewAfterCopy: 3,
      SalesRepView: 0, ManagerView: 1, PersonalView: 2, AllView: 3,
      NoneSetView: 4, OrganizationView: 5, ContactView: 6,
      GroupView: 7, CatalogView: 8, SubOrganizationView: 9
    }
  );
  assert.equal(Object.isFrozen(SIEBEL_CONSTANTS), true);
});
