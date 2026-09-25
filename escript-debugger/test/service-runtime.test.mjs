import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { SIEBEL_CONSTANTS } from '../dist/runtime/constants.mjs';
import { collectReferenceSignatures, transformSiebelReferences } from '../dist/runtime/reference-transformer.mjs';
import { stripSiebelTypes } from '../dist/runtime/type-stripper.mjs';

const implementation = readFileSync(new URL('../service-implementation.escript', import.meta.url), 'utf8');

class PropertySet {
  #properties = new Map();
  #names = [];
  #index = -1;
  SetProperty(name, value) { this.#properties.set(String(name), String(value)); return true; }
  GetProperty(name) { return this.#properties.get(String(name)) ?? ''; }
  PropertyExists(name) { return this.#properties.has(String(name)); }
  RemoveProperty(name) { return this.#properties.delete(String(name)); }
  GetFirstProperty() { this.#names = [...this.#properties.keys()]; this.#index = 0; return this.#names[0] ?? ''; }
  GetNextProperty() { this.#index++; return this.#names[this.#index] ?? ''; }
  entries() { return Object.fromEntries(this.#properties); }
}

function serviceContext(...userSources) {
  const sources = [implementation, ...userSources];
  const signatures = collectReferenceSignatures(sources);
  const context = {
    ...SIEBEL_CONSTANTS,
    __escriptMakeRef: (get, set) => ({ get value() { return get(); }, set value(value) { set(value); } })
  };
  vm.createContext(context);
  for (const [index, source] of sources.entries()) {
    const executable = stripSiebelTypes(transformSiebelReferences(source, signatures));
    new vm.Script(executable, { filename: index ? `user-method-${index}.escript` : 'service-implementation.escript' }).runInContext(context);
  }
  return context;
}

test('bundled service implementation transforms and compiles as eScript', () => {
  const signatures = collectReferenceSignatures([implementation]);
  const executable = stripSiebelTypes(transformSiebelReferences(implementation, signatures));
  assert.doesNotThrow(() => new vm.Script(executable, { filename: 'service-implementation.escript' }));
  assert.match(executable, /function Service_PreCanInvokeMethod\(methodName,\s+canInvoke\)/);
  assert.match(executable, /function CanInvokeMethod\(methodName,\s+canInvoke\)/);
});

test('default service hooks deny InvokeMethod calls', () => {
  const context = serviceContext();
  assert.throws(
    () => context.InvokeMethod.call(context, 'UnknownMethod', new PropertySet(), new PropertySet()),
    error => error === 'cannot invoke method UnknownMethod'
  );
});

test('custom PreCanInvoke and PreInvoke hooks override defaults and handle a method', () => {
  const custom = `
    var hookTrace = [];
    function Service_PreCanInvokeMethod(methodName, &canInvoke) {
      hookTrace.push("precan:" + methodName);
      canInvoke = methodName == "Echo";
      return CancelOperation;
    }
    function Service_PreInvokeMethod(methodName, inputs, outputs) {
      hookTrace.push("preinvoke:" + methodName);
      outputs.SetProperty("Result", inputs.GetProperty("Value"));
      return CancelOperation;
    }
    function Service_InvokeMethod(methodName) { hookTrace.push("post:" + methodName); }
  `;
  const context = serviceContext(custom), inputs = new PropertySet(), outputs = new PropertySet();
  inputs.SetProperty('Value', 'Hello');

  context.InvokeMethod.call(context, 'Echo', inputs, outputs);

  assert.deepEqual(outputs.entries(), { Result: 'Hello' });
  assert.deepEqual([...context.hookTrace], ['precan:Echo', 'preinvoke:Echo', 'post:Echo']);
});

test('PreCanInvoke can continue into a custom CanInvoke implementation', () => {
  const custom = `
    var hookTrace = [];
    function Service_PreCanInvokeMethod(methodName, &canInvoke) {
      hookTrace.push("precan");
      canInvoke = false;
      return ContinueOperation;
    }
    function CanInvokeMethod(methodName, &canInvoke) {
      hookTrace.push("caninvoke");
      canInvoke = methodName == "Allowed";
      return CancelOperation;
    }
    function Service_PreInvokeMethod(methodName, inputs, outputs) {
      hookTrace.push("preinvoke");
      outputs.SetProperty("Handled", "yes");
      return CancelOperation;
    }
    function Service_InvokeMethod(methodName) { hookTrace.push("post"); }
  `;
  const context = serviceContext(custom), outputs = new PropertySet();

  context.InvokeMethod.call(context, 'Allowed', new PropertySet(), outputs);

  assert.equal(outputs.GetProperty('Handled'), 'yes');
  assert.deepEqual([...context.hookTrace], ['precan', 'caninvoke', 'preinvoke', 'post']);
  assert.throws(
    () => context.InvokeMethod.call(context, 'Denied', new PropertySet(), new PropertySet()),
    error => error === 'cannot invoke method Denied'
  );
});

test('InvokeMethod reports an allowed but unhandled method', () => {
  const custom = `
    function Service_PreCanInvokeMethod(methodName, &canInvoke) {
      canInvoke = true;
      return CancelOperation;
    }
    function Service_PreInvokeMethod(methodName, inputs, outputs) {
      return ContinueOperation;
    }
  `;
  const context = serviceContext(custom);
  assert.throws(
    () => context.InvokeMethod.call(context, 'MissingImplementation', new PropertySet(), new PropertySet()),
    error => typeof error === 'string' && error.includes('MissingImplementation')
  );
});

test('custom CanInvoke hooks must keep canInvoke as a reference parameter', () => {
  const invalidCustomHook = `
    function Service_PreCanInvokeMethod(methodName, canInvoke) {
      canInvoke = true;
      return CancelOperation;
    }
    function Service_PreInvokeMethod(methodName, inputs, outputs) {
      return CancelOperation;
    }
  `;
  const context = serviceContext(invalidCustomHook);
  assert.throws(
    () => context.InvokeMethod.call(context, 'NotActuallyAllowed', new PropertySet(), new PropertySet()),
    error => error === 'cannot invoke method NotActuallyAllowed'
  );
});

test('a later method file replaces an earlier custom hook definition', () => {
  const first = `function Service_PreCanInvokeMethod(methodName, &canInvoke) { canInvoke = false; return CancelOperation; }`;
  const second = `
    function Service_PreCanInvokeMethod(methodName, &canInvoke) { canInvoke = true; return CancelOperation; }
    function Service_PreInvokeMethod(methodName, inputs, outputs) { outputs.SetProperty("Owner", "second"); return CancelOperation; }
  `;
  const context = serviceContext(first, second), outputs = new PropertySet();
  context.InvokeMethod.call(context, 'Overridden', new PropertySet(), outputs);
  assert.equal(outputs.GetProperty('Owner'), 'second');
});

test('service property helpers support set, get, iteration, existence and removal', () => {
  const context = serviceContext();
  context.SetProperty('First', '1');
  context.SetProperty('Second', '2');
  assert.equal(context.Name(), '<unknown, runtime>');
  assert.equal(context.PropertyExists('First'), true);
  assert.equal(context.GetProperty('Missing'), '');
  assert.equal(context.GetFirstProperty(), 'First');
  assert.equal(context.GetNextProperty(), 'Second');
  assert.equal(context.GetNextProperty(), '');
  context.RemoveProperty('First');
  assert.equal(context.PropertyExists('First'), false);
});
