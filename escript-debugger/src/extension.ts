import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { inspectSiebelJar } from '../runtime/jar-compatibility.mjs';
import { OracleSiebelClient } from '../runtime/oracle-client.mjs';
import { validateServiceName } from '../runtime/service-scaffold.mjs';
import { DebuggerSidebarProvider, openDebuggerUi, type ServiceLaunchConfig, type UiActions } from './debugger-ui.js';
import { ConnectionProfile, ProfileStore } from './profiles.js';

const activeSetting = 'activeConnection';

export function activate(context: vscode.ExtensionContext): void {
  const store = new ProfileStore(context);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  status.command = 'escript.connections'; context.subscriptions.push(status);
  const refresh = () => {
    const name = vscode.workspace.getConfiguration('escriptDebugger').get<string>(activeSetting);
    const profile = name ? store.get(name) : undefined;
    const workspace = profile?.workspace?.trim();
    status.text = `$(debug-alt) Siebel: ${name || 'no connection'}${workspace ? ` (${workspace})` : ''}`;
    status.show();
  };
  refresh();
  const uiActions: UiActions = {
    launch: (program, connection, noDebug, service, onOutputs) => launchProgram(store, context, program, connection, noDebug, service, onOutputs),
    manageConnections: () => manageConnections(store, refresh)
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('escript.connections', () => manageConnections(store, refresh)),
    vscode.commands.registerCommand('escript.installTypings', () => installTypings(context)),
    vscode.commands.registerCommand('escript.addSiebelService', (resource?: vscode.Uri) => addSiebelService(context, resource)),
    vscode.commands.registerCommand('escript.openDebugger', () => openDebuggerUi(context, store, uiActions)),
    vscode.window.registerWebviewViewProvider('siebelEscript.debugger', new DebuggerSidebarProvider(context, store, uiActions), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('escript.debugFile', () => launchCurrent(store, context, false)),
    vscode.commands.registerCommand('escript.runFile', () => launchCurrent(store, context, true)),
    vscode.debug.registerDebugConfigurationProvider('escript', {
      resolveDebugConfiguration: async (_folder, config) => resolveLaunch(store, context, config)
    }),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('escriptDebugger.activeConnection')) refresh(); })
  );
}

async function addSiebelService(context: vscode.ExtensionContext, parent?: vscode.Uri): Promise<void> {
  if (!parent) { void vscode.window.showErrorMessage('Select a folder in the Explorer before adding a Siebel service.'); return; }
  let parentStat: vscode.FileStat;
  try { parentStat = await vscode.workspace.fs.stat(parent); }
  catch { void vscode.window.showErrorMessage('The selected Explorer folder is no longer available.'); return; }
  if ((parentStat.type & vscode.FileType.Directory) === 0) { void vscode.window.showErrorMessage('Select a folder in the Explorer before adding a Siebel service.'); return; }

  const name = await vscode.window.showInputBox({
    title: 'Add Siebel Service',
    prompt: 'Enter the business service name. A folder with this name will be created.',
    placeHolder: 'My Business Service',
    validateInput: validateServiceName
  });
  if (name === undefined) return;
  const serviceName = name.trim();
  const target = vscode.Uri.joinPath(parent, serviceName);
  try {
    await vscode.workspace.fs.stat(target);
    void vscode.window.showErrorMessage(`A file or folder named '${serviceName}' already exists.`);
    return;
  } catch { /* The target must not exist before copying the template. */ }

  const template = vscode.Uri.joinPath(context.extensionUri, 'assets', 'templates', 'service-scripts');
  try {
    await vscode.workspace.fs.copy(template, target, { overwrite: false });
    await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
    void vscode.window.showInformationMessage(`Siebel service '${serviceName}' was created.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not create Siebel service '${serviceName}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function installTypings(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.window.activeTextEditor
    ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
    : vscode.workspace.workspaceFolders?.[0];
  if (!folder) { void vscode.window.showErrorMessage('Open a workspace before installing the eScript type definitions.'); return; }
  const source = vscode.Uri.joinPath(context.extensionUri, 'typings', 'siebel-escript.d.ts');
  const targetFolder = vscode.Uri.joinPath(folder.uri, '.vscode', 'typings');
  const target = vscode.Uri.joinPath(targetFolder, 'siebel-escript.d.ts');
  try {
    await vscode.workspace.fs.stat(target);
    const replace = await vscode.window.showWarningMessage('The project already contains Siebel eScript type definitions. Replace them?', { modal: true }, 'Replace');
    if (replace !== 'Replace') return;
  } catch { /* Target does not exist yet. */ }
  await vscode.workspace.fs.createDirectory(targetFolder);
  await vscode.workspace.fs.copy(source, target, { overwrite: true });
  void vscode.window.showInformationMessage(`Siebel eScript type definitions installed in ${vscode.workspace.asRelativePath(target)}.`);
}

async function launchCurrent(store: ProfileStore, context: vscode.ExtensionContext, noDebug: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'escript') { void vscode.window.showErrorMessage('Open a .escript file first.'); return; }
  if (editor.document.isDirty) await editor.document.save();
  await launchProgram(store, context, editor.document.uri.fsPath, '', noDebug);
}

async function launchProgram(store: ProfileStore, context: vscode.ExtensionContext, program: string, connection: string, noDebug: boolean, service?: ServiceLaunchConfig, onOutputs?: (outputs: Record<string, string>) => void): Promise<void> {
  const document = vscode.workspace.textDocuments.find(item => item.uri.fsPath === program);
  if (document?.isDirty) await document.save();
  if (connection && store.get(connection)) {
    await vscode.workspace.getConfiguration('escriptDebugger').update(activeSetting, connection, vscode.ConfigurationTarget.Global);
  }
  let resultFile: string | undefined;
  if (service) resultFile = path.join(os.tmpdir(), `siebel-escript-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const config = await resolveLaunch(store, context, { type: 'escript', request: 'launch', name: noDebug ? 'Run Siebel eScript' : 'Debug Siebel eScript', program, connection, noDebug, service: service && { ...service, resultFile } });
  if (!config) return;
  const stopWatching = resultFile && onOutputs
    ? watchServiceResult(resultFile, String(config.env?.SIEBEL_ESCRIPT_SERVICE ?? ''), onOutputs, context)
    : undefined;
  const started = await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(program)), config, { noDebug });
  if (!started) stopWatching?.();
}

async function resolveLaunch(store: ProfileStore, context: vscode.ExtensionContext, config: vscode.DebugConfiguration): Promise<vscode.DebugConfiguration | undefined> {
  const program = config.program || vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!program?.toLowerCase().endsWith('.escript')) { void vscode.window.showErrorMessage('The debug target must be a .escript file.'); return; }
  const requested = config.connection || vscode.workspace.getConfiguration('escriptDebugger').get<string>(activeSetting);
  let profile = requested ? store.get(requested) : undefined;
  if (!profile) profile = await selectProfile(store);
  if (!profile) { void vscode.window.showErrorMessage('Create or select a Siebel connection first.'); return; }
  const configuredWorkspace = profile.workspace?.trim();
  const workspaceName = configuredWorkspace || await vscode.window.showInputBox({
    title: 'Siebel workspace',
    prompt: `Enter the workspace for connection '${profile.name}'.`,
    placeHolder: 'Workspace name',
    ignoreFocusOut: true,
    validateInput: value => value.trim() ? undefined : 'A workspace is required to run Siebel eScript'
  });
  if (!workspaceName?.trim()) { void vscode.window.showErrorMessage('A Siebel workspace is required before the script can run.'); return; }
  profile = { ...profile, workspace: workspaceName.trim() };
  const password = await store.password(profile.name);
  if (password === undefined) { void vscode.window.showErrorMessage(`No password stored for connection '${profile.name}'.`); return; }
  const runtime = await oracleRuntime(context, profile.language); if (!runtime) return;
  const payload = Buffer.from(JSON.stringify({ profile, password, requestTimeout: vscode.workspace.getConfiguration('escriptDebugger').get('requestTimeout', 30000), ...runtime }), 'utf8').toString('base64');
  const env: Record<string, string> = { SIEBEL_ESCRIPT_CONNECTION: payload };
  if (config.service) env.SIEBEL_ESCRIPT_SERVICE = Buffer.from(JSON.stringify(config.service), 'utf8').toString('base64');
  return {
    type: 'node', request: 'launch', name: config.name || 'Siebel eScript',
    program: path.join(context.extensionPath, 'dist', 'runtime', 'runner.mjs'),
    args: [program], cwd: path.dirname(program), noDebug: config.noDebug,
    stopOnEntry: config.stopOnEntry, sourceMaps: true,
    autoAttachChildProcesses: false,
    skipFiles: ['<node_internals>/**', `${context.extensionPath.replace(/\\/g, '/')}/dist/runtime/**`],
    env, console: 'internalConsole', internalConsoleOptions: 'openOnSessionStart'
  };
}

function watchServiceResult(resultFile: string, servicePayload: string, onOutputs: (outputs: Record<string, string>) => void, context: vscode.ExtensionContext): () => void {
  let finished = false;
  let terminated: vscode.Disposable | undefined;
  const cleanup = () => {
    if (finished) return; finished = true; fs.unwatchFile(resultFile);
    void fs.promises.rm(resultFile, { force: true }).catch(() => {});
    terminated?.dispose();
  };
  fs.watchFile(resultFile, { interval: 250 }, async current => {
    if (finished || !current.isFile() || current.size === 0) return;
    try {
      const result = JSON.parse(await fs.promises.readFile(resultFile, 'utf8')) as { outputs?: Record<string, unknown> };
      onOutputs(Object.fromEntries(Object.entries(result.outputs ?? {}).map(([name, value]) => [name, String(value ?? '')])));
      cleanup();
    } catch { /* The debuggee may still be completing the write. */ }
  });
  terminated = vscode.debug.onDidTerminateDebugSession(session => {
    if (session.configuration.env?.SIEBEL_ESCRIPT_SERVICE === servicePayload && !finished) setTimeout(cleanup, 1000);
  });
  context.subscriptions.push(terminated);
  return cleanup;
}

async function selectProfile(store: ProfileStore): Promise<ConnectionProfile | undefined> {
  const all = store.all();
  if (!all.length) return createProfile(store);
  const name = await vscode.window.showQuickPick(all.map(p => p.name), { placeHolder: 'Select a Siebel connection' });
  return name ? store.get(name) : undefined;
}

async function manageConnections(store: ProfileStore, refresh: () => void): Promise<void> {
  const action = await vscode.window.showQuickPick(['$(add) Add connection', '$(check) Select active connection', '$(folder) Set workspace for active connection', '$(edit) Edit connection', '$(trash) Remove connection', '$(plug) Test connection'], { placeHolder: 'Manage Siebel connections' });
  if (!action) return;
  if (action.includes('Add')) await createProfile(store);
  else if (action.includes('Set workspace')) await setActiveWorkspace(store);
  else {
    const names = store.all().map(p => p.name); const name = await vscode.window.showQuickPick(names, { placeHolder: 'Connection' }); if (!name) return;
    if (action.includes('Select')) await vscode.workspace.getConfiguration('escriptDebugger').update(activeSetting, name, vscode.ConfigurationTarget.Global);
    if (action.includes('Edit')) await createProfile(store, store.get(name));
    if (action.includes('Remove') && await vscode.window.showWarningMessage(`Remove connection '${name}'?`, { modal: true }, 'Remove') === 'Remove') await store.remove(name);
    if (action.includes('Test')) await testProfile(store, name);
  }
  refresh();
}

async function setActiveWorkspace(store: ProfileStore): Promise<void> {
  const activeName = vscode.workspace.getConfiguration('escriptDebugger').get<string>(activeSetting);
  const profile = activeName ? store.get(activeName) : undefined;
  if (!profile) { void vscode.window.showErrorMessage('Select an active Siebel connection first.'); return; }
  const workspace = await vscode.window.showInputBox({
    title: 'Siebel workspace',
    prompt: `Set the workspace for active connection '${profile.name}'.`,
    value: profile.workspace || '',
    ignoreFocusOut: true,
    validateInput: value => value.trim() ? undefined : 'A workspace is required'
  });
  if (workspace === undefined) return;
  await store.save({ ...profile, workspace: workspace.trim() });
}

async function createProfile(store: ProfileStore, current?: ConnectionProfile): Promise<ConnectionProfile | undefined> {
  const name = await vscode.window.showInputBox({ title: 'Connection name', value: current?.name, validateInput: v => v.trim() ? undefined : 'A name is required' }); if (!name) return;
  const url = await vscode.window.showInputBox({ title: 'Siebel connection string', value: current?.url || 'siebel://server:2321/ENT/EAIObjMgr_enu', validateInput: v => /^siebel(?:\.ssl|\.tls)?\.[^:]+:\/\//.test(v) || /^siebel:\/\//.test(v) ? undefined : 'Enter a valid siebel:// connection string' }); if (!url) return;
  const username = await vscode.window.showInputBox({ title: 'Siebel user', value: current?.username }); if (username === undefined) return;
  const password = await vscode.window.showInputBox({ title: 'Siebel password', password: true, prompt: current ? 'Leave empty to keep the stored password' : undefined }); if (password === undefined) return;
  const language = await vscode.window.showInputBox({ title: 'Language', value: current?.language || 'enu' }); if (!language) return;
  const workspace = await vscode.window.showInputBox({ title: 'Siebel workspace', value: current?.workspace || '', prompt: 'Optional here; if empty, it must be entered before each run.' }); if (workspace === undefined) return;
  const profile = { name: name.trim(), url: url.trim(), username, language, workspace: workspace.trim() || undefined };
  await store.save(profile, password || (current ? undefined : ''));
  await vscode.workspace.getConfiguration('escriptDebugger').update(activeSetting, profile.name, vscode.ConfigurationTarget.Global);
  return profile;
}

async function testProfile(store: ProfileStore, name: string): Promise<void> {
  const profile = store.get(name), password = await store.password(name); if (!profile || password === undefined) return;
  const extension = vscode.extensions.getExtension('titansystems-de.siebel-escript-dbger');
  if (!extension) { void vscode.window.showErrorMessage('Cannot locate the Siebel eScript Debugger extension.'); return; }
  const runtime = await oracleRuntime(extension.extensionPath, profile.language); if (!runtime) return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connecting to ${name}…` }, async () => {
    const app = new OracleSiebelClient({ ...runtime, requestTimeout: vscode.workspace.getConfiguration('escriptDebugger').get('requestTimeout', 30000) });
    try { await app.login(profile.url, profile.username, password, profile.language); const version = await app.call(0, 'getServerVersion'); await app.call(0, 'logoff', [false]); void vscode.window.showInformationMessage(`Connection succeeded${version ? ` (Siebel ${version})` : ''}.`); }
    catch (e) { void vscode.window.showErrorMessage(`Connection failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { await app.close().catch(() => {}); }
  });
}

async function oracleRuntime(context: vscode.ExtensionContext | string, language: string): Promise<{ javaPath: string; siebelJar: string; siebelJars: string[]; bridgeSource: string } | undefined> {
  const configuration = vscode.workspace.getConfiguration('escriptDebugger');
  const siebelJar = configuration.get<string>('siebelJar', '').trim();
  const javaPath = configuration.get<string>('javaPath', 'java').trim() || 'java';
  if (!siebelJar || !path.isAbsolute(siebelJar)) { void vscode.window.showErrorMessage('Configure an absolute path in escriptDebugger.siebelJar before connecting.'); return; }
  try { if (!(await fs.promises.stat(siebelJar)).isFile()) throw new Error(); }
  catch { void vscode.window.showErrorMessage(`Siebel.jar was not found at '${siebelJar}'.`); return; }
  try {
    const compatibility = await inspectSiebelJar(siebelJar);
    if (!compatibility.compatible) {
      void vscode.window.showWarningMessage(
        `The configured Siebel.jar differs from the verified version (expected SHA-256 ${compatibility.expectedHash}, found ${compatibility.actualHash}). Compatibility and correct operation cannot be guaranteed.`
      );
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not verify Siebel.jar at '${siebelJar}': ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const jarDirectory = path.dirname(siebelJar);
  const jarNames = (await fs.promises.readdir(jarDirectory)).filter(name => name.toLowerCase().endsWith('.jar'));
  const localeJar = `siebelji_${language.toLowerCase()}.jar`;
  if (!jarNames.some(name => name.toLowerCase() === localeJar)) {
    void vscode.window.showErrorMessage(`Oracle ${localeJar} is required for language '${language}'. Place it next to Siebel.jar in '${jarDirectory}'.`); return;
  }
  const siebelJars = jarNames.map(name => path.join(jarDirectory, name));
  const extensionPath = typeof context === 'string' ? context : context.extensionPath;
  return { javaPath, siebelJar, siebelJars, bridgeSource: path.join(extensionPath, 'dist', 'runtime', 'OracleSiebelBridge.java') };
}

export function deactivate(): void {}
