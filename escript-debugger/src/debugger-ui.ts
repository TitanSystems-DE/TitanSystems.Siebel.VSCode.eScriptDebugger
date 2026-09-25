import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ProfileStore } from './profiles.js';

export interface ServiceLaunchConfig {
  entryPoint: 'direct' | 'invokeMethod';
  directFile?: string;
  methodName?: string;
  inputs: Array<{ name: string; value: string }>;
}

export interface UiActions {
  launch(program: string, connection: string, noDebug: boolean, service?: ServiceLaunchConfig, onOutputs?: (outputs: Record<string, string>) => void): Promise<void>;
  manageConnections(): Promise<void>;
}

export function openDebuggerUi(context: vscode.ExtensionContext, store: ProfileStore, actions: UiActions): void {
  const panel = vscode.window.createWebviewPanel('siebelEscriptDebugger', 'Siebel eScript Debugger', vscode.ViewColumn.Beside, {
    enableScripts: true, retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'assets')]
  });
  configureWebview(panel.webview, context, store, actions);
}

export class DebuggerSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly store: ProfileStore, private readonly actions: UiActions) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'assets')]
    };
    configureWebview(view.webview, this.context, this.store, this.actions);
  }
}

function configureWebview(webview: vscode.Webview, context: vscode.ExtensionContext, store: ProfileStore, actions: UiActions): void {
  let program = currentProgram();
  let mode: 'standalone' | 'service' = 'standalone';
  const retainMode = (value: unknown) => { if (value === 'standalone' || value === 'service') mode = value; };
  const render = () => { webview.html = html(webview, context, store, program, mode); };
  render();
  webview.onDidReceiveMessage(async message => {
    switch (message?.command) {
      case 'launch': {
        retainMode(message.mode);
        const requestedProgram = typeof message.program === 'string' ? message.program : '';
        const connection = typeof message.connection === 'string' ? message.connection : '';
        if (!requestedProgram.toLowerCase().endsWith('.escript')) { void vscode.window.showErrorMessage('Select an open .escript file first.'); return; }
        let service: ServiceLaunchConfig | undefined;
        if (message.mode === 'service') {
          const entryPoint = message.entryPoint === 'direct' ? 'direct' : 'invokeMethod';
          const inputs = Array.isArray(message.inputs) ? message.inputs
            .filter((item: unknown): item is { name: string; value: string } => !!item && typeof (item as { name?: unknown }).name === 'string' && typeof (item as { value?: unknown }).value === 'string')
            .map((item: { name: string; value: string }) => ({ name: item.name.trim(), value: item.value }))
            .filter((item: { name: string; value: string }) => item.name) : [];
          if (entryPoint === 'direct') {
            const directFile = typeof message.directFile === 'string' ? message.directFile : '';
            if (!serviceFiles(requestedProgram).includes(directFile)) { void vscode.window.showErrorMessage('Select a valid Direct script.'); return; }
            service = { entryPoint, directFile, inputs: [] };
          } else {
            const methodName = typeof message.methodName === 'string' ? message.methodName.trim() : '';
            if (!methodName) { void vscode.window.showErrorMessage('Enter an InvokeMethod method name.'); return; }
            service = { entryPoint, methodName, inputs };
          }
        } else if (message.mode !== 'standalone') return;
        await actions.launch(requestedProgram, connection, message.noDebug === true, service, outputs => void webview.postMessage({ command: 'serviceOutputs', outputs }));
        break;
      }
      case 'chooseFile': {
        retainMode(message.mode);
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Select eScript', filters: { 'Siebel eScript': ['escript'] } });
        if (picked?.[0]) { program = picked[0].fsPath; render(); }
        break;
      }
      case 'useActiveFile': retainMode(message.mode); program = currentProgram(); render(); break;
      case 'manageConnections': await actions.manageConnections(); render(); break;
    }
  }, undefined, context.subscriptions);
}

function currentProgram(): string {
  const document = vscode.window.activeTextEditor?.document;
  return document?.languageId === 'escript' ? document.uri.fsPath : '';
}

function serviceFiles(program: string): string[] {
  if (!program) return [];
  try {
    return readdirSync(path.dirname(program), { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.escript') && entry.name.toLowerCase() !== '(declerations).escript')
      .map(entry => entry.name).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  } catch { return []; }
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function html(webview: vscode.Webview, context: vscode.ExtensionContext, store: ProfileStore, program: string, initialMode: 'standalone' | 'service'): string {
  const nonce = randomBytes(16).toString('base64');
  const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png'));
  const active = vscode.workspace.getConfiguration('escriptDebugger').get<string>('activeConnection', '');
  const profiles = store.all();
  const options = profiles.length ? profiles.map(profile => `<option value="${escape(profile.name)}"${profile.name === active ? ' selected' : ''}>${escape(profile.name)} — ${escape(profile.username)}@${escape(profile.url)}</option>`).join('') : '<option value="">No connection configured</option>';
  const files = serviceFiles(program);
  const directOptions = files.length ? files.map(file => `<option value="${escape(file)}">${escape(file)}</option>`).join('') : '<option value="">No service scripts found</option>';
  const filename = program ? path.basename(program) : 'No .escript file selected';
  const polishCss = `
    body { background:
      radial-gradient(circle at 15% 0%, color-mix(in srgb, var(--vscode-focusBorder) 16%, transparent), transparent 34%),
      var(--vscode-editor-background); }
    main { padding-bottom: 24px; }
    header { padding: 4px 0 18px; border-bottom: 1px solid var(--vscode-panel-border); }
    .logo { width: 48px; height: 48px; object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,.28); }
    h1 { letter-spacing: -.02em; }
    .mode, .field { background: color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent); box-shadow: 0 5px 18px rgba(0,0,0,.09); }
    .mode { overflow: hidden; transition: border-color .15s ease, transform .15s ease, background .15s ease; }
    .mode-heading { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
    .mode-heading strong { margin: 0; }
    .mode-icon { width: 22px; height: 22px; flex: 0 0 auto; color: var(--vscode-symbolIcon-functionForeground, currentColor); }
    .mode-icon path, .mode-icon rect, .mode-icon circle { vector-effect: non-scaling-stroke; }
    .mode:hover { transform: translateY(-1px); border-color: var(--vscode-focusBorder); }
    .mode.selected::after { content: ''; position: absolute; inset: auto 0 0; height: 3px; background: linear-gradient(90deg, #26d7ff, #9866ff); }
    .mode:not(.selected) .badge { display: none; }
    .badge { background: color-mix(in srgb, currentColor 12%, transparent); }
    button { min-height: 32px; font-weight: 600; transition: filter .15s ease, transform .1s ease; }
    button:hover { filter: brightness(1.08); }
    button:active { transform: translateY(1px); }
    button:focus-visible, input:focus-visible, select:focus-visible, .mode:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    #debug { background: linear-gradient(110deg, var(--vscode-button-background), color-mix(in srgb, var(--vscode-button-background) 58%, #8d5cff)); }
    #methodName { width: 100%; margin: 7px 0 12px; }
    #directFile { margin-top: 7px; }
    .output-table tbody tr:hover { background: var(--vscode-list-hoverBackground); }
    @media (max-width: 540px) {
      body { padding: 16px 12px; }
      header { gap: 11px; } h1 { font-size: 17px; }
      .logo { width: 40px; height: 40px; border-radius: 9px; }
      .modes { grid-template-columns: 1fr; }
      .mode { min-height: 88px; padding: 14px; }
      .file { flex-wrap: wrap; }
      .file-name { flex: 1 0 100%; margin-bottom: 3px; }
      .file button { flex: 1; }
      .input-row { grid-template-columns: 1fr auto; }
      .input-row input:nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
      footer { flex-wrap: wrap; } footer #modeLabel { flex: 1 0 100%; } footer .spacer { display: none; } footer button { flex: 1; }
    }
  `;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;padding:28px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px var(--vscode-font-family);user-select:none}.file-name,input,.output-table{user-select:text}main{max-width:760px;margin:0 auto}header{display:flex;gap:14px;align-items:center;margin-bottom:26px}.logo{display:grid;place-items:center;width:42px;height:42px;border-radius:10px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);font-size:21px}h1{font-size:20px;margin:0 0 3px}.subtle{color:var(--vscode-descriptionForeground)}h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:24px 0 10px;color:var(--vscode-descriptionForeground)}.modes{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mode{position:relative;border:1px solid var(--vscode-panel-border);border-radius:8px;padding:16px;min-height:110px;cursor:pointer}.mode.selected{border-color:var(--vscode-focusBorder);background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}.mode strong{display:block;font-size:15px;margin-bottom:7px}.badge{position:absolute;top:12px;right:12px;border:1px solid currentColor;border-radius:10px;padding:2px 7px;font-size:10px}.field{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:14px;background:var(--vscode-sideBar-background)}.file{display:flex;align-items:center;gap:10px}.file-name{flex:1;min-width:0}.file-name strong,.file-name span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}select,input,button{font:inherit}select,input{height:32px;padding:0 8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}select{width:100%}button{cursor:pointer;border:1px solid transparent;padding:7px 13px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border-radius:3px}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}button.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}button.link{color:var(--vscode-textLink-foreground);background:transparent;padding-left:0}.hidden{display:none!important}.entry-tabs{display:flex;gap:16px;margin-bottom:14px}.entry-tabs label{cursor:pointer}.input-row{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-top:8px}.input-row input{width:100%}.remove{padding:4px 10px}.output-table{width:100%;border-collapse:collapse}.output-table th,.output-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--vscode-panel-border)}.empty{padding:8px;color:var(--vscode-descriptionForeground)}footer{display:flex;align-items:center;gap:9px;margin-top:24px;padding-top:18px;border-top:1px solid var(--vscode-panel-border)}footer .spacer{flex:1}</style></head><body><main>
<style nonce="${nonce}">${polishCss}</style><header><img class="logo" src="${iconUri}" alt=""><div><h1>Siebel eScript Debugger</h1><div class="subtle">Configure and start an eScript runtime.</div></div></header>
<h2>Debug method</h2><div class="modes"><div id="standaloneMode" class="mode selected"><span class="badge">Selected</span><div class="mode-heading"><svg class="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h5M8 16h7"/><path d="m16.5 13.5 3 2-3 2z" fill="currentColor" stroke="none"/></svg><strong>Standalone</strong></div><span>Run only the selected script.</span></div><div id="serviceMode" class="mode"><span class="badge">Selected</span><div class="mode-heading"><svg class="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="6" rx="1.5"/><rect x="14" y="4" width="7" height="6" rx="1.5"/><rect x="8.5" y="15" width="7" height="5" rx="1.5"/><path d="M6.5 10v2.5H12V15m5.5-5v2.5H12"/></svg><strong>Service</strong></div><span>Build a runtime from every script in the selected script's folder.</span></div></div>
<h2>Script</h2><div class="field file"><div class="file-name"><strong>${escape(filename)}</strong><span class="subtle" title="${escape(program)}">${escape(program || 'Open an eScript file or select one from disk.')}</span></div><button id="active" class="secondary">Active editor</button><button id="choose" class="secondary">Choose…</button></div>
<section id="serviceConfig" class="hidden"><h2>Service entry point</h2><div class="field"><div class="entry-tabs"><label><input type="radio" name="entry" value="invokeMethod" checked> InvokeMethod</label><label><input type="radio" name="entry" value="direct"> Direct</label></div><div id="invokeConfig"><label>Method name</label><input id="methodName" type="text" placeholder="MethodName" style="width:100%;margin:6px 0 10px"><div><strong>Input properties</strong><div id="inputs"></div><button id="addInput" class="link">+ Add property</button></div></div><div id="directConfig" class="hidden"><label for="directFile">Script / method</label><select id="directFile" style="margin-top:6px">${directOptions}</select><p class="subtle">The function named like the file (without .escript) will be called after the runtime is loaded.</p></div></div><h2>Output properties</h2><div class="field"><div id="outputEmpty" class="empty">Outputs appear here after InvokeMethod has completed.</div><table id="outputs" class="output-table hidden"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody></tbody></table></div></section>
<h2>Connection</h2><div class="field"><select id="connection" aria-label="Siebel connection">${options}</select><button id="connections" class="link">Manage connections</button></div>
<footer><span id="modeLabel" class="subtle">Mode: Standalone</span><span class="spacer"></span><button id="run" class="secondary">Run without debugging</button><button id="debug">Start debugging</button></footer>
</main><script nonce="${nonce}">const vscode=acquireVsCodeApi(),program=${JSON.stringify(program)};let mode=${JSON.stringify(initialMode)};const byId=id=>document.getElementById(id),setMode=value=>{mode=value;byId('standaloneMode').classList.toggle('selected',value==='standalone');byId('serviceMode').classList.toggle('selected',value==='service');byId('serviceConfig').classList.toggle('hidden',value!=='service');byId('modeLabel').textContent='Mode: '+(value==='service'?'Service':'Standalone')};setMode(mode);byId('standaloneMode').onclick=()=>setMode('standalone');byId('serviceMode').onclick=()=>setMode('service');document.querySelectorAll('input[name="entry"]').forEach(r=>r.onchange=()=>{byId('invokeConfig').classList.toggle('hidden',r.value!=='invokeMethod'||!r.checked);byId('directConfig').classList.toggle('hidden',r.value!=='direct'||!r.checked)});const addInput=(name='',value='')=>{const row=document.createElement('div');row.className='input-row';const n=document.createElement('input');n.placeholder='Name';n.value=name;const v=document.createElement('input');v.placeholder='Value';v.value=value;const remove=document.createElement('button');remove.className='secondary remove';remove.textContent='×';remove.onclick=()=>row.remove();row.append(n,v,remove);byId('inputs').append(row)};byId('addInput').onclick=()=>addInput();const launch=noDebug=>{const entryPoint=document.querySelector('input[name="entry"]:checked').value,inputs=[...document.querySelectorAll('.input-row')].map(row=>({name:row.children[0].value,value:row.children[1].value}));vscode.postMessage({command:'launch',mode,program,connection:byId('connection').value,noDebug,entryPoint,directFile:byId('directFile').value,methodName:byId('methodName').value,inputs})};byId('debug').onclick=()=>launch(false);byId('run').onclick=()=>launch(true);byId('choose').onclick=()=>vscode.postMessage({command:'chooseFile',mode});byId('active').onclick=()=>vscode.postMessage({command:'useActiveFile',mode});byId('connections').onclick=()=>vscode.postMessage({command:'manageConnections'});window.addEventListener('message',event=>{if(event.data.command!=='serviceOutputs')return;const entries=Object.entries(event.data.outputs||{}),tbody=byId('outputs').querySelector('tbody');tbody.textContent='';for(const [name,value]of entries){const row=tbody.insertRow(),a=row.insertCell(),b=row.insertCell();a.textContent=name;b.textContent=value}byId('outputs').classList.toggle('hidden',!entries.length);byId('outputEmpty').classList.toggle('hidden',entries.length>0);if(!entries.length)byId('outputEmpty').textContent='InvokeMethod completed without output properties.'});</script></body></html>`;
}
