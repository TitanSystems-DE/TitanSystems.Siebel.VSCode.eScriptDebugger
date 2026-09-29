import { readFileSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { SyncBridge, remoteObject } from './sync-bridge.mjs';
import { SIEBEL_CONSTANTS } from './constants.mjs';
import { createLocalServiceResolver } from './local-service-runtime.mjs';
import { directMethodName, localServiceFolders, serviceScriptPlan } from './service-runtime.mjs';
import { stripSiebelTypes } from './type-stripper.mjs';
import { collectReferenceSignatures, transformSiebelReferences } from './reference-transformer.mjs';
import { debuggableScript } from './source-map.mjs';

const file = process.argv[2];
if (!file) throw new Error('Missing .escript program path');
const encoded = process.env.SIEBEL_ESCRIPT_CONNECTION;
if (!encoded) throw new Error('Missing Siebel connection configuration');
delete process.env.SIEBEL_ESCRIPT_CONNECTION;
const connection = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
const bridge = new SyncBridge(new URL('./worker.mjs', import.meta.url), connection);
const remoteApplication = remoteObject(bridge, 0);
let application = remoteApplication;
// Write to the process file descriptor synchronously. This bypasses console API
// interception and stream buffering performed by the JavaScript debugger.
const writeLine = value => { writeSync(1, `${String(value ?? '')}\n`); };

Object.assign(globalThis, {
  ...SIEBEL_CONSTANTS,
  TheApplication: () => application,
  Application: () => application,
  ToNumber: value => Number(value), ToString: value => String(value),
  Clib: {
    WriteLn: writeLine,
    puts: writeLine,
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
  const debugScript = debuggableScript(filename, source, executable);
  new vm.Script(debugScript.code, { filename: debugScript.filename, displayErrors: true }).runInThisContext();
}

function runService(selectedFile, service) {
  const folder = path.dirname(selectedFile);
  const implementation = fileURLToPath(new URL('./service-implementation.escript', import.meta.url));
  let localServices;
  if (service.debugLocalServices) {
    const folders = localServiceFolders(folder, readdirSync(path.dirname(folder), { withFileTypes: true }));
    localServices = createLocalServiceResolver({
      startingFolder: folder,
      folders,
      remoteApplication,
      globals: app => ({
        ...SIEBEL_CONSTANTS,
        TheApplication: () => app,
        Application: () => app,
        ToNumber: value => Number(value), ToString: value => String(value),
        Clib: globalThis.Clib,
        __escriptMakeRef: globalThis.__escriptMakeRef
      }),
      loadService: (serviceFolder, scope) => loadService(serviceFolder, implementation, scope)
    });
    application = localServices.application;
    localServices.registerStartingService(globalThis);
  }
  loadService(folder, implementation, globalThis);

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

function loadService(folder, implementation, scope) {
  const names = readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.escript'))
    .map(entry => entry.name);
  const sources = serviceScriptPlan(folder, implementation, names).map(filename => ({ filename, source: readFileSync(filename, 'utf8') }));
  const signatures = collectReferenceSignatures(sources.map(item => item.source));
  for (const script of sources) {
    const executable = stripSiebelTypes(transformSiebelReferences(script.source, signatures));
    const debugScript = debuggableScript(script.filename, script.source, executable);
    const compiled = new vm.Script(debugScript.code, { filename: debugScript.filename, displayErrors: true });
    if (scope === globalThis) compiled.runInThisContext(); else compiled.runInContext(scope);
  }
  scope.___srvName = path.basename(folder);
}

function writeResult(filename, outputs) {
  if (filename) writeFileSync(filename, JSON.stringify({ outputs }), 'utf8');
}
