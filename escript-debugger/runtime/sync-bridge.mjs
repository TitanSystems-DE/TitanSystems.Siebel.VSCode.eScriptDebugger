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

export function remoteObject(bridge, handle) {
  return new Proxy(Object.create(null), {
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
