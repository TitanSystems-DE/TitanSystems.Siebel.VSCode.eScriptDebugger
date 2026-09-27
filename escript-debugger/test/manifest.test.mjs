import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('declares editor breakpoint support for eScript documents', () => {
  assert.ok(
    manifest.contributes.breakpoints?.some(contribution => contribution.language === 'escript'),
    'package.json must contribute breakpoints for the escript language'
  );
});
