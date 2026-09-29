/** Insert a required workspace name into the startup script without allowing code injection. */
export function renderWorkspaceScript(template, workspace) {
  const name = String(workspace ?? '').trim();
  if (!name) throw new Error('A Siebel workspace is required before the script can run.');
  if (!template.includes('{{WS_NAME}}')) throw new Error('The workspace startup template does not contain {{WS_NAME}}.');
  const escaped = JSON.stringify(name).slice(1, -1);
  return template.replaceAll('{{WS_NAME}}', escaped);
}
