import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { SyncBridge, remoteObject } from './sync-bridge.mjs';
import { SIEBEL_CONSTANTS } from './constants.mjs';
import { directMethodName, serviceScriptPlan } from './service-runtime.mjs';
import { stripSiebelTypes } from './type-stripper.mjs';
import { collectReferenceSignatures, transformSiebelReferences } from './reference-transformer.mjs';

const file = process.argv[2];
if (!file) throw new Error('Missing .escript program path');
const encoded = process.env.SIEBEL_ESCRIPT_CONNECTION;
if (!encoded) throw new Error('Missing Siebel connection configuration');
delete process.env.SIEBEL_ESCRIPT_CONNECTION;
const connection = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
const bridge = new SyncBridge(new URL('./worker.mjs', import.meta.url), connection);
const application = remoteObject(bridge, 0);

Object.assign(globalThis, {
  ...SIEBEL_CONSTANTS,
  TheApplication: () => application,
  Application: () => application,
  ToNumber: value => Number(value), ToString: value => String(value),
  Clib: {
    WriteLn: value => console.log(value),
    puts: value => console.log(value),
    getenv: name => process.env[name] ?? '',
    time: () => Math.floor(Date.now() / 1000)
  },
  __escriptMakeRef: (get, set) => ({ get value() { return get(); }, set value(value) { set(value); } })
});

let exitCode = 0;
try {
  const encodedService = process.env.SIEBEL_ESCRIPT_SERVICE;
  delete process.env.SIEBEL_ESCRIPT_SERVICE;
  if (encodedService) {
    const service = JSON.parse(Buffer.from(encodedService, 'base64').toString('utf8'));
    runService(file, service);
  } else {
    const source = readFileSync(file, 'utf8');
    runScript(file, source, collectReferenceSignatures([source]));
  }
} catch (error) {
  exitCode = 1; console.error(error?.stack || error);
} finally {
  try { bridge.close(); } catch (error) { console.error(`Siebel logoff failed: ${error?.message || error}`); exitCode ||= 1; }
}
process.exitCode = exitCode;

function runScript(filename, source, signatures) {
  const executable = stripSiebelTypes(transformSiebelReferences(source, signatures));
  new vm.Script(executable, { filename, displayErrors: true }).runInThisContext();
}

function runService(selectedFile, service) {
  const folder = path.dirname(selectedFile);
  const names = readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.escript'))
    .map(entry => entry.name);
  const implementation = fileURLToPath(new URL('./service-implementation.escript', import.meta.url));
  const sources = serviceScriptPlan(folder, implementation, names).map(filename => ({ filename, source: readFileSync(filename, 'utf8') }));
  const signatures = collectReferenceSignatures(sources.map(item => item.source));
  for (const script of sources) runScript(script.filename, script.source, signatures);

  if (service.entryPoint === 'direct') {
    const methodName = directMethodName(service.directFile);
    const method = globalThis[methodName];
    if (typeof method !== 'function') throw new TypeError(`Direct entry point '${methodName}' is not defined`);
    method.call(globalThis);
    writeResult(service.resultFile, {});
    return;
  }

  globalThis.SERV_INPUTS = application.NewPropertySet();
  globalThis.SERV_OUTPUTS = application.NewPropertySet();
  for (const property of service.inputs ?? []) globalThis.SERV_INPUTS.SetProperty(String(property.name), String(property.value));
  if (typeof globalThis.InvokeMethod !== 'function') throw new TypeError('Service runtime does not define InvokeMethod');
  globalThis.InvokeMethod(String(service.methodName), globalThis.SERV_INPUTS, globalThis.SERV_OUTPUTS);

  const outputs = {};
  for (let name = globalThis.SERV_OUTPUTS.GetFirstProperty(); name; name = globalThis.SERV_OUTPUTS.GetNextProperty())
    outputs[name] = globalThis.SERV_OUTPUTS.GetProperty(name);
  writeResult(service.resultFile, outputs);
}

function writeResult(filename, outputs) {
  if (filename) writeFileSync(filename, JSON.stringify({ outputs }), 'utf8');
}
