import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';

export class SyncBridge {
  constructor(workerUrl, workerData) {
    const { port1, port2 } = new MessageChannel();
    this.port = port1; this.nextId = 1; this.timeout = Math.max(1000, Number(workerData.requestTimeout) || 30000) + 5000;
    const workerEnv = { ...process.env };
    // The bridge is infrastructure, not debuggee code. VS Code's JavaScript
    // debugger injects a bootloader through these variables; allowing the
    // worker to inherit it can suspend the worker after login while the main
    // thread is synchronously waiting for its response.
    delete workerEnv.NODE_OPTIONS;
    delete workerEnv.VSCODE_INSPECTOR_OPTIONS;
    this.worker = new Worker(workerUrl, {
      workerData: { ...workerData, port: port2 }, transferList: [port2],
      env: workerEnv, execArgv: []
    });
    this.worker.on('error', error => { this.workerError = error; });
    this.call('ready', 0);
  }
  call(op, target, args = []) {
    if (this.workerError) throw this.workerError;
    const signal = new SharedArrayBuffer(8), state = new Int32Array(signal), id = this.nextId++;
    this.port.postMessage({ id, op, target, args, signal });
    const deadline = Date.now() + this.timeout;
    while (Atomics.load(state, 0) === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || Atomics.wait(state, 0, 0, remaining) === 'timed-out') {
        void this.worker.terminate();
        const operation = op === 'ready' ? 'login' : op === 'call' ? String(args[0] || 'call') : op;
        const stages = ['not received by worker', 'received by worker', 'login completed', 'method resolved', 'calling Java', 'Java returned', 'result encoded', 'previews completed', 'response posted'];
        throw new Error(`Siebel bridge operation '${operation}' timed out after ${this.timeout} ms (${stages[Atomics.load(state, 1)] || `stage ${Atomics.load(state, 1)}`})`);
      }
    }
    let packet;
    while (!(packet = receiveMessageOnPort(this.port))) {
      if (this.workerError) throw this.workerError;
    }
    const response = packet.message;
    if (response.id !== id) throw new Error('Siebel bridge response was out of sequence');
    if (!response.ok) {
      const error = new Error(response.error.message); error.name = response.error.name || 'SiebelError';
      if (response.error.code !== undefined) error.code = response.error.code;
      throw error;
    }
    updatePreviews(this, response.previews);
    return response.value;
  }
  close() { try { this.call('close', 0); } finally { void this.worker.terminate(); } }
}

const camel = name => name.length ? name[0].toLowerCase() + name.slice(1) : name;

// `with (siebelObject) { Method(); }` performs a [[HasProperty]] lookup before
// reading Method. Remote objects do not have concrete method properties, so
// advertise the synchronous Siebel API explicitly without capturing unrelated
// local or global identifiers from the with scope.
const remoteMembers = new Set([
  'GetApplication', 'GetBusObject', 'GetService', 'NewPropertySet',
  'InvokeMethod', 'GetProfileAttr', 'SetProfileAttr', 'GetServerVersion',
  'LoginId', 'LoginName', 'PositionId', 'PositionName', 'CurrencyCode',
  'SetPositionId', 'SetPositionName', 'Trace', 'TraceOn', 'TraceOff',
  'GetSessionID', 'CancelQuery',
  'Name', 'GetBusComp', 'Release',
  'BusObject', 'ActivateField', 'ActivateMultipleFields', 'DeactivateFields',
  'ClearToQuery', 'SetSearchExpr', 'SetSearchSpec', 'SetSortSpec',
  'GetSearchExpr', 'GetSearchSpec', 'GetSortSpec', 'SetViewMode', 'GetViewMode',
  'ExecuteQuery', 'ExecuteQuery2', 'FirstRecord', 'LastRecord', 'NextRecord',
  'PreviousRecord', 'GetFieldValue', 'GetFormattedFieldValue', 'SetFieldValue',
  'SetFormattedFieldValue', 'GetMultipleFieldValues', 'SetMultipleFieldValues',
  'NewRecord', 'WriteRecord', 'DeleteRecord', 'UndoRecord', 'RefineQuery',
  'SetNamedSearch', 'GetNamedSearch', 'GetUserProperty', 'SetUserProperty',
  'GetPicklistBusComp', 'GetMVGBusComp', 'GetAssocBusComp', 'ParentBusComp',
  'Pick', 'Associate',
  'GetName', 'GetFirstProperty', 'GetNextProperty', 'GetProperty',
  'PropertyExists', 'SetProperty', 'RemoveProperty',
  'GetType', 'SetType', 'GetValue', 'SetValue', 'GetByteValue', 'SetByteValue',
  'IsStringValue', 'GetPropertyCount', 'GetPropertyNames', 'Entries',
  'GetChildCount', 'GetChild', 'AddChild', 'InsertChildAt', 'RemoveChild',
  'Reset', 'Copy', 'EncodeAsString', 'DecodeFromString'
]);

export function remoteObject(bridge, handle) {
  return remoteObjectWithPreview(bridge, handle);
}

function remoteObjectWithPreview(bridge, handle, kind, preview) {
  bridge.remoteObjects ??= new Map();
  const cached = bridge.remoteObjects.get(handle);
  if (cached) { if (preview) applyPreview(cached.target, preview); return cached.proxy; }
  const target = Object.create(null);
  if (kind === 'PropertySet') applyPreview(target, preview ?? emptyPreview());
  const proxy = new Proxy(target, {
    has(current, property) { return Reflect.has(current, property) || typeof property === 'string' && remoteMembers.has(property); },
    get(current, property) {
      if (property === '__handle') return handle;
      if (property === Symbol.toStringTag) return kind === 'PropertySet' ? 'SiebelPropertySet' : 'SiebelObject';
      if (property === 'toString') return () => `[${kind === 'PropertySet' ? 'PropertySet' : 'SiebelObject'} ${handle}]`;
      if (Reflect.has(current, property)) return Reflect.get(current, property);
      if (typeof property !== 'string') return undefined;
      return (...args) => decode(bridge, bridge.call('call', handle, [camel(property), ...args.map(encode)]));
    }
  });
  bridge.remoteObjects.set(handle, { proxy, target });
  return proxy;
}

export const encode = value => value && typeof value === 'object' && value.__handle !== undefined ? { __handle: value.__handle } : value;
export const decode = (bridge, value) => value && typeof value === 'object' && '__handle' in value
  ? remoteObjectWithPreview(bridge, value.__handle, value.__kind, value.__preview)
  : value;

const emptyPreview = () => ({ Type: '', Value: '', Properties: {}, Children: [] });
function applyPreview(target, preview) {
  target.Type = preview.Type;
  target.Value = preview.Value;
  target.Properties = preview.Properties;
  target.Children = preview.Children;
}
function updatePreviews(bridge, previews) {
  for (const item of previews ?? []) {
    const cached = bridge.remoteObjects?.get(item.handle);
    if (cached) applyPreview(cached.target, item.preview);
  }
}
