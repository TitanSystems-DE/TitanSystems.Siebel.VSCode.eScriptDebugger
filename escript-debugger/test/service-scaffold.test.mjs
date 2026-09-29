import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { validateServiceName } from '../dist/runtime/service-scaffold.mjs';

test('accepts business service folder names and rejects unsafe names', () => {
  assert.equal(validateServiceName('My Business Service'), undefined);
  for (const name of ['', '   ', '.', '..', 'Service/Child', 'Service\\Child', 'Bad:Name', 'Trailing.', 'Trailing ', 'CON', 'LPT1.txt'])
    assert.equal(typeof validateServiceName(name), 'string', name);
});

test('ships the standard service script templates', () => {
  assert.deepEqual(
    readdirSync(new URL('../assets/templates/service-scripts/', import.meta.url)).sort(),
    ['(declerations).escript', 'Service_InvokeMethod.escript', 'Service_PreCanInvokeMethod.escript', 'Service_PreInvokeMethod.escript']
  );
});
