import { workerData } from 'node:worker_threads';
import { SiebelDataBean } from 'ts-sisnapi';

const { profile, password, requestTimeout, port } = workerData;
const objects = new Map(), reverse = new WeakMap(); let nextHandle = 1;
const app = new SiebelDataBean({ requestTimeout });
objects.set(0, app); reverse.set(app, 0);

function encode(value) {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    let handle = reverse.get(value);
    if (handle === undefined) { handle = nextHandle++; reverse.set(value, handle); objects.set(handle, value); }
    return { __handle: handle };
  }
  return String(value);
}
function decode(value) { return value && typeof value === 'object' && '__handle' in value ? objects.get(value.__handle) : value; }
function errorData(error) {
  return { name: error?.name, message: error?.message || String(error), code: typeof error?.getErrorCode === 'function' ? error.getErrorCode() : error?.code };
}

let ready = app.login(profile.url, profile.username, password, profile.language);
port.on('message', async request => {
  const state = new Int32Array(request.signal);
  try {
    await ready;
    if (request.op === 'close') {
      try { await app.logoff(false); } catch { app.close(); }
      port.postMessage({ id: request.id, ok: true });
    } else {
      const target = objects.get(request.target); if (!target) throw new Error('Invalid or released Siebel object');
      const [method, ...rawArgs] = request.args, fn = target[method];
      if (typeof fn !== 'function') throw new TypeError(`Siebel method '${method}' is not available`);
      const callArgs = rawArgs.map(decode);
      // eScript exposes cursor modes as 256/257; the Java-DataBean-compatible
      // ts-sisnapi API uses 0/1. Accept both representations at the boundary.
      if ((method === 'executeQuery' || method === 'executeQuery2') && callArgs.length) {
        if (callArgs[0] === 256) callArgs[0] = 0;
        else if (callArgs[0] === 257) callArgs[0] = 1;
      }
      const value = await fn.apply(target, callArgs);
      port.postMessage({ id: request.id, ok: true, value: encode(value) });
    }
  } catch (error) { port.postMessage({ id: request.id, ok: false, error: errorData(error) }); }
  finally { Atomics.store(state, 0, 1); Atomics.notify(state, 0); }
});
