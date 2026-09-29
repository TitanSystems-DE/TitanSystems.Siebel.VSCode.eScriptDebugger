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

test('contributes the Add Siebel Service Explorer command and packages its templates', () => {
  assert.ok(manifest.contributes.commands?.some(contribution => contribution.command === 'escript.addSiebelService'));
  assert.ok(manifest.contributes.menus?.['explorer/context']?.some(contribution =>
    contribution.command === 'escript.addSiebelService' && contribution.when === 'explorerResourceIsFolder'
  ));
  assert.ok(manifest.files.includes('assets/templates/service-scripts/*.escript'));
  assert.ok(manifest.files.includes('assets/templates/ws-change.escript'));
});
