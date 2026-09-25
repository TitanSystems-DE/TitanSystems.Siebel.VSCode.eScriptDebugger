import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';

export class SyncBridge {
  constructor(workerUrl, workerData) {
    const { port1, port2 } = new MessageChannel();
    this.port = port1; this.nextId = 1;
    this.worker = new Worker(workerUrl, { workerData: { ...workerData, port: port2 }, transferList: [port2] });
    this.worker.on('error', error => { this.workerError = error; });
  }
  call(op, target, args = []) {
    if (this.workerError) throw this.workerError;
    const signal = new SharedArrayBuffer(4), state = new Int32Array(signal), id = this.nextId++;
    this.port.postMessage({ id, op, target, args, signal });
    while (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0);
    let packet;
    while (!(packet = receiveMessageOnPort(this.port))) {
      if (this.workerError) throw this.workerError;
    }
    const response = packet.message;
    if (response.id !== id) throw new Error('SISNAPI bridge response was out of sequence');
    if (!response.ok) {
      const error = new Error(response.error.message); error.name = response.error.name || 'SiebelError';
      if (response.error.code !== undefined) error.code = response.error.code;
      throw error;
    }
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
  return new Proxy(Object.create(null), {
    has(_target, property) { return typeof property === 'string' && remoteMembers.has(property); },
    get(_target, property) {
      if (property === '__handle') return handle;
      if (property === Symbol.toStringTag) return 'SiebelObject';
      if (property === 'toString') return () => `[SiebelObject ${handle}]`;
      if (typeof property !== 'string') return undefined;
      return (...args) => decode(bridge, bridge.call('call', handle, [camel(property), ...args.map(encode)]));
    }
  });
}

export const encode = value => value && typeof value === 'object' && value.__handle !== undefined ? { __handle: value.__handle } : value;
export const decode = (bridge, value) => value && typeof value === 'object' && '__handle' in value ? remoteObject(bridge, value.__handle) : value;
