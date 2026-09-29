import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

const b64 = value => Buffer.from(String(value), 'utf8').toString('base64');
const unb64 = value => Buffer.from(value, 'base64').toString('utf8');
export const normalizeConnectionString = url => url.replace(/^siebel:\/\//i, 'siebel.tcpip.none.none://');

export function publishRequest(requestFile, line) {
  const temporary = `${requestFile}.tmp`;
  writeFileSync(temporary, line, 'utf8');
  renameSync(temporary, requestFile);
}

export class OracleSiebelClient {
  constructor({ javaPath = 'java', siebelJar, siebelJars, bridgeSource, requestTimeout = 30000 }) {
    if (!siebelJar) throw new Error('Configure escriptDebugger.siebelJar with the absolute path to Oracle Siebel.jar.');
    this.timeout = requestTimeout;
    this.waitState = new Int32Array(new SharedArrayBuffer(4));
    this.directory = mkdtempSync(join(tmpdir(), 'siebel-bridge-'));
    this.requestFile = join(this.directory, 'request');
    this.responseFile = join(this.directory, 'response');
    const classPath = [...(siebelJars?.length ? siebelJars : [siebelJar]), dirname(bridgeSource)].join(delimiter);
    this.process = spawn(javaPath, ['-cp', classPath, 'OracleSiebelBridge', this.requestFile, this.responseFile], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.stderr = '';
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-8192); });
    this.process.on('error', error => { this.processError = error; });
    this.process.on('exit', code => { if (code && !this.closing) this.processError = new Error(`Oracle Siebel bridge exited with code ${code}${this.stderr ? `: ${this.stderr.trim()}` : ''}`); });
  }
  #settle(line) {
    const parts = line.split('\t');
    if (parts[0] === 'OK') return this.#decode(parts[1] || 'Z');
    const error = new Error(unb64(parts[2] || '')); error.name = unb64(parts[3] || '') || 'SiebelError'; if (parts[1]) error.code = unb64(parts[1]); throw error;
  }
  #encode(value) {
    if (value === null || value === undefined) return 'Z';
    if (value && typeof value === 'object' && value.__handle !== undefined) return `H${value.__handle}`;
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `Y${Buffer.from(value).toString('base64')}`;
    if (typeof value === 'boolean') return value ? 'B1' : 'B0';
    if (typeof value === 'number') return `D${value}`;
    return `S${b64(value)}`;
  }
  #decode(token) {
    const type = token[0], value = token.slice(1);
    if (type === 'Z') return null;
    if (type === 'S') return unb64(value);
    if (type === 'D') return Number(value);
    if (type === 'B') return value === '1';
    if (type === 'Y') return Buffer.from(value, 'base64');
    if (type === 'O') { const [handle, kind] = value.split(':'); return { __handle: Number(handle), __kind: unb64(kind) }; }
    throw new Error('Invalid response from Oracle Siebel bridge');
  }
  request(command, target = 0, method = '', args = []) {
    const line = [command, target, b64(method), args.length, ...args.map(value => this.#encode(value))].join('\t') + '\n';
    // Publish only complete packets. The Java process polls for requestFile,
    // so writing directly to that path lets it observe an empty/partial line.
    publishRequest(this.requestFile, line);
    const deadline = Date.now() + this.timeout;
    while (!existsSync(this.responseFile)) {
      if (this.processError) throw this.processError;
      if (Date.now() >= deadline) { this.process.kill(); throw new Error(`Siebel Java Data Bean request timed out after ${this.timeout} ms${this.stderr ? `: ${this.stderr.trim()}` : ''}`); }
      Atomics.wait(this.waitState, 0, 0, 2);
    }
    const response = readFileSync(this.responseFile, 'utf8').trimEnd();
    rmSync(this.responseFile, { force: true });
    return Promise.resolve(this.#settle(response));
  }
  call(target, method, args = []) { return this.request('CALL', target, method, args); }
  async login(url, username, password, language) {
    const oracleUrl = normalizeConnectionString(url);
    await this.request('CREATE');
    await this.call(0, 'login', [oracleUrl, username, password, language]);
  }
  async close() { this.closing = true; try { await this.request('CLOSE'); } finally { this.process.kill(); rmSync(this.directory, { recursive: true, force: true }); } }
}
