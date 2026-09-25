import * as vscode from 'vscode';

export interface ConnectionProfile { name: string; url: string; username: string; language: string; }
const profilesKey = 'escriptDebugger.connections';
const passwordKey = (name: string) => `escriptDebugger.password.${name}`;

export class ProfileStore {
  constructor(private readonly context: vscode.ExtensionContext) {}
  all(): ConnectionProfile[] { return this.context.globalState.get<ConnectionProfile[]>(profilesKey, []); }
  get(name: string): ConnectionProfile | undefined { return this.all().find(p => p.name === name); }
  async password(name: string): Promise<string | undefined> { return this.context.secrets.get(passwordKey(name)); }
  async save(profile: ConnectionProfile, password?: string): Promise<void> {
    const profiles = this.all().filter(p => p.name !== profile.name); profiles.push(profile);
    await this.context.globalState.update(profilesKey, profiles.sort((a, b) => a.name.localeCompare(b.name)));
    if (password !== undefined) await this.context.secrets.store(passwordKey(profile.name), password);
  }
  async remove(name: string): Promise<void> {
    await this.context.globalState.update(profilesKey, this.all().filter(p => p.name !== name));
    await this.context.secrets.delete(passwordKey(name));
  }
}
