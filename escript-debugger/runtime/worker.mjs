import { workerData } from 'node:worker_threads';
import { OracleSiebelClient } from './oracle-client.mjs';

const { profile, password, requestTimeout, port, javaPath, siebelJar, siebelJars, bridgeSource } = workerData;
const objects = new Map(), reverse = new WeakMap(); let nextHandle = 1;
const client = new OracleSiebelClient({ javaPath, siebelJar, siebelJars, bridgeSource, requestTimeout });
const app = remote(0, 'Object');
objects.set(0, app); reverse.set(app, 0);

function remote(handle, kind) {
  const value = { __oracleHandle: handle, __oracleKind: kind };
  return new Proxy(value, { get(target, property) {
    if (property in target) return target[property];
    if (property === 'then') return undefined;
    if (typeof property !== 'string') return undefined;
    return (...args) => client.call(handle, property, args.map(arg => arg?.__oracleHandle === undefined ? arg : { __handle: arg.__oracleHandle })).then(materialize);
  }});
}
function materialize(value) { return value && typeof value === 'object' && value.__handle !== undefined ? remote(value.__handle, value.__kind) : value; }

async function encode(value) {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  if (typeof value === 'object') {
    let handle = reverse.get(value);
    if (handle === undefined) { handle = nextHandle++; reverse.set(value, handle); objects.set(handle, value); }
    if (!isPropertySet(value)) return { __handle: handle };
    try { return { __handle: handle, __kind: 'PropertySet', __preview: await propertySetPreview(value) }; }
    catch { return { __handle: handle, __kind: 'PropertySet' }; }
  }
  return String(value);
}
function isPropertySet(value) {
  return value?.__oracleKind === 'PropertySet';
}
async function propertySetPreview(value) {
  const children = [];
  const count = await value.getChildCount();
  for (let index = 0; index < count; index++) children.push(await propertySetPreview(await value.getChild(index)));
  const properties = {}; let name = await value.getFirstProperty();
  while (name) { properties[name] = await value.getProperty(name); name = await value.getNextProperty(); }
  const stringValue = await value.isStringValue();
  return {
    Type: await value.getType(),
    Value: stringValue ? await value.getValue() : `<${(await value.getByteValue())?.length ?? 0} bytes>`,
    Properties: properties,
    Children: children
  };
}
async function previews(values) {
  const result = [];
  for (const value of values) {
    if (!isPropertySet(value)) continue;
    let handle = reverse.get(value);
    if (handle === undefined) { handle = nextHandle++; reverse.set(value, handle); objects.set(handle, value); }
    try { result.push({ handle, preview: await propertySetPreview(value) }); }
    catch { /* A debugger preview must never fail the successful Siebel call. */ }
  }
  return result;
}
function decode(value) { return value && typeof value === 'object' && '__handle' in value ? objects.get(value.__handle) : value; }
function errorData(error) {
  return { name: error?.name, message: error?.message || String(error), code: typeof error?.getErrorCode === 'function' ? error.getErrorCode() : error?.code };
}

let ready;
port.on('message', async request => {
  const state = new Int32Array(request.signal);
  Atomics.store(state, 1, 1);
  try {
    ready ??= client.login(profile.url, profile.username, password, profile.language);
    await ready;
    Atomics.store(state, 1, 2);
    if (request.op === 'ready') {
      port.postMessage({ id: request.id, ok: true });
    } else if (request.op === 'close') {
      try { await app.logoff(); } catch { /* Process shutdown closes the connection. */ }
      await client.close();
      port.postMessage({ id: request.id, ok: true });
    } else {
      const target = objects.get(request.target); if (!target) throw new Error('Invalid or released Siebel object');
      const [method, ...rawArgs] = request.args, fn = target[method];
      if (typeof fn !== 'function') throw new TypeError(`Siebel method '${method}' is not available`);
      const callArgs = rawArgs.map(decode);
      Atomics.store(state, 1, 3);
      // eScript exposes cursor modes as 256/257; the Java Data Bean uses 0/1.
      if ((method === 'executeQuery' || method === 'executeQuery2') && callArgs.length) {
        if (callArgs[0] === 256) callArgs[0] = 0;
        else if (callArgs[0] === 257) callArgs[0] = 1;
      }
      Atomics.store(state, 1, 4);
      const value = await fn.apply(target, callArgs);
      Atomics.store(state, 1, 5);
      const encodedValue = await encode(value);
      Atomics.store(state, 1, 6);
      const previewValues = method === 'getFirstProperty' || method === 'getNextProperty' ? [value] : [target, ...callArgs, value];
      const previewData = await previews(previewValues);
      Atomics.store(state, 1, 7);
      port.postMessage({ id: request.id, ok: true, value: encodedValue, previews: previewData });
      Atomics.store(state, 1, 8);
    }
  } catch (error) { port.postMessage({ id: request.id, ok: false, error: errorData(error) }); }
  finally { Atomics.store(state, 0, 1); Atomics.notify(state, 0); }
});
