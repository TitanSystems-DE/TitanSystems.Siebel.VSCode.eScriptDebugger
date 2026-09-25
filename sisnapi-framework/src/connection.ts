import net from 'node:net';
import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { ProtocolError, SiebelException } from './errors.js';
import { Writer, FrameDecoder, decodePacket, encodeRequest, readArgs, readErrors, writeArgs, type Args, type DecodedPacket, type Translation } from './protocol.js';

export interface ConnectionOptions {
  requestTimeout?: number;
  sessionTimeout?: number;
  maxPacketBytes?: number;
  /** Trusted CA and optional client certificate for the TLS upgrade after Hello. */
  tls?: Pick<tls.ConnectionOptions, 'ca' | 'cert' | 'key' | 'passphrase' | 'servername' | 'minVersion'>;
}
export interface LoginOptions { sweFragment?: boolean; sessionTimeout?: number; debugData?: string | null }
export interface ConnectionAddress { host: string; port: number; path: string; tls: boolean; compression: boolean }
export interface HandshakeInfo { protocolVersion: number; translation: Translation; connectionId: number; muxSessions: number; muxConnections: number; minServiceProcesses: number }
export function parseConnectionString(input: string): ConnectionAddress {
  const m = /^(siebel(?:\.[a-z0-9]+)*)\:\/\/(\[[^\]]+\]|[^/:\s]+):(\d+)\/([^\s?#]+)$/i.exec(input.trim());
  if (!m) throw new ProtocolError('Expected siebel[.tcpip|.ssl][.none][.none|.zlib]://host:port/enterprise/component');
  const [, scheme, host, portString, path] = m, parts = scheme.toLowerCase().split('.');
  if (parts.length > 5 || !['tcpip', 'ssl', 'tls'].includes(parts[1] ?? 'tcpip')) throw new ProtocolError('Only TCP/IP and TLS transports are supported');
  if ((parts[2] ?? 'none') !== 'none') throw new ProtocolError('Legacy RSA/MSCRYPTO encryption is not implemented; use SSL or none');
  if (!['none', 'zlib'].includes(parts[3] ?? 'none')) throw new ProtocolError('Only none and zlib compression are supported');
  if (parts[4] && parts[4] !== '0' && parts[4] !== '1') throw new ProtocolError('Invalid load balancing option');
  if (path.split('/').length !== 2 || path.split('/').some(p => !p)) throw new ProtocolError('Expected enterprise/component path');
  const port = Number(portString); if (port < 1 || port > 65535) throw new ProtocolError('Invalid TCP port');
  return { host: host.replace(/^\[|\]$/g, ''), port, path: path.toLowerCase(), tls: ['ssl', 'tls'].includes(parts[1]), compression: parts[3] === 'zlib' };
}

/** One session, serialized requests. No automatic replay of possibly committed writes. */
export class SisnapiConnection extends EventEmitter {
  private socket?: net.Socket;
  private decoder: FrameDecoder;
  private sequence = 0;
  private session = 0;
  private handle?: string;
  private ending = false;
  private generation = 0;
  private sideConnections = new Set<SisnapiConnection>();
  private translation: Translation = 4;
  private address?: ConnectionAddress;
  private tail: Promise<unknown> = Promise.resolve();
  private pending?: { sequence: number; type: number; resolve: (p: DecodedPacket) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
  private state: 'closed' | 'connecting' | 'open' | 'closing' = 'closed';
  private readonly timeout: number;
  private readonly maxBytes: number;
  constructor(private readonly options: ConnectionOptions = {}) {
    super(); this.timeout = options.requestTimeout ?? 30_000; this.maxBytes = options.maxPacketBytes ?? 64 * 1024 * 1024;
    if (!Number.isInteger(this.timeout) || this.timeout <= 0 || this.timeout > 2147483647 || !Number.isInteger(this.maxBytes) || this.maxBytes < 108) throw new RangeError('Invalid connection limits');
    this.decoder = new FrameDecoder(this.maxBytes);
  }
  get connected(): boolean { return this.state === 'open'; }
  private onData = (chunk: Buffer): void => {
    try {
      for (const frame of this.decoder.push(chunk)) {
        const packet = decodePacket(frame, this.translation, this.maxBytes), r = packet.reader;
        if (packet.type === 5) {
          const code = r.int(), detail = r.string(), subtype = r.remaining >= 4 ? r.int() : 0;
          const errors = subtype === 2 ? readErrors(r) : [];
          if (errors.length) throw new SiebelException(errors.map(e => e.message).join('\n'), errors);
          this.emit('notification', { code, detail, subtype }); continue;
        }
        const requestId = r.int();
        const pending = this.pending;
        if (!pending || requestId !== pending.sequence) throw new ProtocolError(`Unexpected response sequence ${requestId}`);
        if (packet.type === 3) {
          // The Java client uses UTF-16BE for an initial Hello NAK.
          if (pending.type === 101) r.translation = 3;
          const errors = readErrors(r).reverse();
          this.pending = undefined; clearTimeout(pending.timer);
          pending.reject(new SiebelException(errors.map(e => e.message).join('\n') || 'SISNAPI NAK', errors)); continue;
        }
        if (r.int() !== pending.type) throw new ProtocolError('Response request type mismatch');
        this.pending = undefined; clearTimeout(pending.timer); pending.resolve(packet);
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
  };
  private onError = (error: Error): void => { this.fail(error); };
  private onClose = (): void => { this.fail(new SiebelException('SISNAPI connection closed')); };
  private bind(socket: net.Socket): void { socket.on('data', this.onData); socket.on('error', this.onError); socket.on('close', this.onClose); }
  private unbind(socket: net.Socket): void { socket.off('data', this.onData); socket.off('error', this.onError); socket.off('close', this.onClose); }
  private fail(error: Error): void {
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    const wasClosed = this.state === 'closed'; this.state = 'closed';
    if (!wasClosed) this.generation++;
    this.handle = undefined; this.ending = false;
    for (const side of this.sideConnections) side.close(); this.sideConnections.clear();
    if (this.socket) { this.unbind(this.socket); this.socket.destroy(); }
    if (!wasClosed) this.emit('disconnect', error);
  }
  close(): void { this.fail(new SiebelException('SISNAPI connection closed by client')); }
  private exchange(type: number, body: Buffer, initial = false, whiteListedMethod = 0): Promise<DecodedPacket> {
    if (!this.socket || this.socket.destroyed || this.state === 'closed') return Promise.reject(new SiebelException('Not connected'));
    if (this.pending) return Promise.reject(new ProtocolError('Concurrent request on session'));
    if (body.length + 76 > this.maxBytes) return Promise.reject(new ProtocolError('Outgoing packet exceeds size limit'));
    this.sequence = this.sequence >= 2147483647 ? 1 : this.sequence + 1;
    const sequence = this.sequence;
    let frame = encodeRequest(type, sequence, this.session, body, !initial && this.address!.compression, whiteListedMethod);
    if (frame.length > this.maxBytes) return Promise.reject(new ProtocolError('Outgoing packet exceeds size limit'));
    if (initial) {
      const a = this.address!, host = net.isIPv6(a.host) ? `[${a.host}]` : a.host;
      const header = `POST http://${host}:${a.port}/${a.path} HTTP/1.1\r\nContent-Type: application/octet-stream\r\nContent-Length: ${frame.length}\r\n\r\n`;
      frame = Buffer.concat([Buffer.from(header, 'utf8'), frame]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new SiebelException(`SISNAPI request ${type} timed out; result may be unknown`)), this.timeout);
      this.pending = { sequence, type, resolve, reject, timer };
      this.socket!.write(frame, error => { if (error) this.fail(error); });
    });
  }
  private writer(): Writer { return new Writer(this.translation); }
  private async open(url: string, route?: string): Promise<HandshakeInfo> {
    if (this.state !== 'closed') throw new SiebelException('Already connected or connecting');
    this.address = parseConnectionString(url); const generation = ++this.generation;
    this.state = 'connecting'; this.session = this.sequence = 0; this.translation = 4;
    if (route) this.address.path += '/!' + route;
    this.decoder = new FrameDecoder(this.maxBytes);
    try {
      const socket = net.createConnection({ host: this.address.host, port: this.address.port }); this.socket = socket; this.bind(socket); socket.setNoDelay(true);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new SiebelException('TCP connection timed out')); }, this.timeout);
        const closed = () => { cleanup(); reject(new SiebelException('Connection closed during TCP handshake')); };
        const cleanup = () => { clearTimeout(timer); socket.off('connect', connected); socket.off('error', failed); socket.off('close', closed); };
        const connected = () => { cleanup(); resolve(); }; const failed = (e: Error) => { cleanup(); reject(e); };
        socket.once('connect', connected); socket.once('error', failed); socket.once('close', closed);
      });
      if (generation !== this.generation) throw new SiebelException('Connection attempt was cancelled');
      const hello = await this.exchange(101, this.writer().int(131077).int(0).bytes(null).int(this.address.compression ? 16 : 0).int(8).int(0).int(65001).int(0).build(), true);
      if (generation !== this.generation) throw new SiebelException('Connection attempt was cancelled');
      const r = hello.reader; this.session = r.int(); const protocolVersion = r.int(); const key = r.bytes(); r.string(); const translation = r.int();
      const muxSessions = r.int(), muxConnections = r.int(), minServiceProcesses = r.int();
      if (key?.length) throw new ProtocolError('Unexpected server encryption key');
      if (![1, 2, 3, 4].includes(translation)) throw new ProtocolError(`Unsupported translation ${translation}`);
      this.translation = translation as Translation;
      if (this.address.tls) {
        this.unbind(socket);
        const secure = tls.connect({ minVersion: 'TLSv1.3', ...this.options.tls, socket, host: this.address.host, servername: this.options.tls?.servername ?? (net.isIP(this.address.host) ? undefined : this.address.host), rejectUnauthorized: true });
        this.socket = secure; this.bind(secure);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { cleanup(); reject(new SiebelException('TLS handshake timed out')); }, this.timeout);
          const closed = () => { cleanup(); reject(new SiebelException('Connection closed during TLS handshake')); };
          const cleanup = () => { clearTimeout(timer); secure.off('secureConnect', connected); secure.off('error', failed); secure.off('close', closed); };
          const connected = () => { cleanup(); resolve(); }; const failed = (e: Error) => { cleanup(); reject(e); };
          secure.once('secureConnect', connected); secure.once('error', failed); secure.once('close', closed);
        });
      }
      if (generation !== this.generation) throw new SiebelException('Connection attempt was cancelled');
      return { protocolVersion, translation: this.translation, connectionId: this.session, muxSessions, muxConnections, minServiceProcesses };
    } catch (error) { if (generation === this.generation) this.close(); throw error; }
  }
  /** Tests routing/Hello without credentials; optionally creates and closes an unauthenticated session. */
  async probe(url: string, createSession = false): Promise<HandshakeInfo & { sessionEstablished?: boolean }> {
    if (this.state !== 'closed') throw new SiebelException('Already connected or connecting');
    const generation = this.generation + 1;
    try {
      const info = await this.open(url);
      if (createSession) { await this.createSession(url); await this.exchange(1102, Buffer.alloc(0)); return { ...info, sessionEstablished: true }; }
      return info;
    } finally { if (generation === this.generation) this.close(); }
  }
  private async createSession(url: string, timeout = this.options.sessionTimeout ?? 2700): Promise<void> {
    if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new RangeError('Invalid session timeout');
    const generation = this.generation, reply = await this.exchange(1101, this.writer().int(1).int(timeout).build());
    if (generation !== this.generation) throw new SiebelException('Session creation was cancelled');
    const process = reply.reader.int(); this.session = reply.reader.int();
    const timestamp = reply.reader.int(), server = reply.reader.int();
    const hex = (n: number) => (n >>> 0).toString(16);
    this.handle = url.replace(/\/$/, '') + '/!' + [server, process, this.session, timestamp].map(hex).join('.');
  }
  getSessionID(): string { if (!this.connected || !this.handle) throw new SiebelException('Not logged in'); return this.handle; }
  /** Opens another transport to an existing session; Application.attach initializes its startup state. */
  async attach(handle: string): Promise<void> {
    if (this.state !== 'closed') throw new SiebelException('Already connected or connecting');
    const match = /^(.*)\/!([a-f\d]{1,8})\.([a-f\d]{1,8})\.([a-f\d]{1,8})\.([a-f\d]{1,8})$/i.exec(handle);
    if (!match) throw new ProtocolError('Invalid session handle');
    const generation = this.generation + 1;
    try { await this.open(match[1], `${match[2]}.${match[3]}`); this.session = parseInt(match[4], 16) | 0; this.handle = handle; this.state = 'open'; }
    catch (error) { if (generation === this.generation) this.close(); throw error; }
  }
  /** A separate routed transport allows cancellation while the primary RPC is waiting. */
  async cancelQuery(requestId = -1): Promise<void> {
    const handle = this.getSessionID();
    if (!Number.isInteger(requestId) || requestId < -2147483648 || requestId > 2147483647) throw new RangeError('Invalid request ID');
    const side = new SisnapiConnection(this.options); this.sideConnections.add(side);
    try { await side.attach(handle); await side.rpc(1001, 0, 0, new Map([['requestId', { type: 13, value: requestId }]])); }
    finally { side.close(); this.sideConnections.delete(side); }
  }
  async detach(): Promise<string> {
    if (this.ending) throw new SiebelException('Session is closing');
    const handle = this.getSessionID(), request = this.rpc(18, 0, 0); this.ending = true;
    try { await request; this.close(); return handle; } finally { this.ending = false; }
  }
  async login(url: string, username: string, password: string, options: LoginOptions = {}): Promise<void> {
    if (this.state !== 'closed') throw new SiebelException('Already connected or connecting');
    const generation = this.generation + 1;
    try {
      await this.open(url);
      await this.createSession(url, options.sessionTimeout);
      try {
        await this.exchange(102, this.writer().string(null).string(username).string(password).int(4).int(0).int(1).int(0).string(options.sweFragment ? 'SWEFragment' : '').string('JAVA').string(options.debugData ?? null).build());
      } catch (error) { if (generation === this.generation && this.socket && !this.socket.destroyed) { try { await this.exchange(1102, Buffer.alloc(0)); } catch {} } throw error; }
      if (generation !== this.generation) throw new SiebelException('Login was cancelled');
      this.state = 'open';
    } catch (error) { if (generation === this.generation) this.close(); throw error; }
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> { const result = this.tail.then(work); this.tail = result.catch(() => {}); return result; }
  rpc(code: number, objectType: number, objectId: number, list: Args = new Map()): Promise<Args> {
    if (!this.connected || this.ending) return Promise.reject(new SiebelException('Not logged in or session is closing'));
    const socket = this.socket;
    return this.enqueue(async () => {
      if (!this.connected || this.socket !== socket) throw new SiebelException('Session closed before queued request was sent');
      const writer = this.writer().int(code).int(objectType).int(objectId); writeArgs(writer, list);
      const wlm = list.get('WLM');
      const reply = await this.exchange(401, writer.build(), false, wlm?.type === 1 && wlm.value?.toUpperCase() === 'T' ? 1 : 0);
      try {
        const result = readArgs(reply.reader), errors = readErrors(reply.reader);
        this.emit('rpcResult', result, { code, objectType, objectId, hasErrors: errors.length > 0 });
        if (errors.length) throw new SiebelException(errors.map(e => e.message).join('\n'), errors);
        return result;
      } catch (error) { if (error instanceof ProtocolError) this.fail(error); throw error; }
    });
  }
  logoff(commit = true): Promise<void> {
    if (this.ending) return Promise.reject(new SiebelException('Session is closing'));
    this.ending = true;
    const socket = this.socket;
    return this.enqueue(async () => {
      if (this.socket !== socket) return;
      if (!this.connected) { this.close(); return; }
      this.state = 'closing';
      try { try { await this.exchange(103, this.writer().int(Number(commit)).build()); } finally { if (!this.socket?.destroyed) await this.exchange(1102, Buffer.alloc(0)); } }
      finally { this.close(); }
    });
  }
}
