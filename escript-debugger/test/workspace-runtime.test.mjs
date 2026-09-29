import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderWorkspaceScript } from '../runtime/workspace-runtime.mjs';

test('renders the workspace startup script with an escaped required name', () => {
  const template = readFileSync(new URL('../assets/templates/ws-change.escript', import.meta.url), 'utf8');
  const rendered = renderWorkspaceScript(template, 'Developer "One"');
  assert.ok(rendered.includes('Developer \\"One\\"'));
  assert.ok(!rendered.includes('{{WS_NAME}}'));
  assert.throws(() => renderWorkspaceScript(template, '  '), /workspace is required/i);
});
