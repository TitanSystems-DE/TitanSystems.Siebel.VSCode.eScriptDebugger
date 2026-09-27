export interface OracleClientOptions { javaPath?: string; siebelJar: string; siebelJars?: string[]; bridgeSource: string; requestTimeout?: number }
export class OracleSiebelClient {
  constructor(options: OracleClientOptions);
  login(url: string, username: string, password: string, language: string): Promise<void>;
  call(target: number, method: string, args?: unknown[]): Promise<unknown>;
  close(): Promise<void>;
}
