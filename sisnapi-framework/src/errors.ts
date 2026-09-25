export interface SiebelErrorDetail { code: number; message: string }

export class SiebelException extends Error {
  constructor(message: string, public readonly errors: readonly SiebelErrorDetail[] = []) {
    super(message); this.name = 'SiebelException';
  }
  getErrorCode(): number { return this.errors[0]?.code ?? 0; }
  getErrorMessage(): string { return this.message; }
}
export class ProtocolError extends SiebelException {
  constructor(message: string) { super(message); this.name = 'ProtocolError'; }
}
