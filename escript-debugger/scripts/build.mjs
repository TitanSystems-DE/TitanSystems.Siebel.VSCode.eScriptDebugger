import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const path = relative => fileURLToPath(new URL(relative, import.meta.url));

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/runtime/', import.meta.url), { recursive: true });
await build({
  entryPoints: [path('../src/extension.ts')],
  outfile: path('../dist/extension.js'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['vscode'], sourcemap: true
});
await build({
  entryPoints: [path('../runtime/worker.mjs')],
  outfile: path('../dist/runtime/worker.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true
});
for (const file of ['runner.mjs', 'sync-bridge.mjs', 'constants.mjs', 'service-runtime.mjs', 'type-stripper.mjs', 'reference-transformer.mjs'])
  await cp(new URL(`../runtime/${file}`, import.meta.url), new URL(`../dist/runtime/${file}`, import.meta.url));
await cp(new URL('../service-implementation.escript', import.meta.url), new URL('../dist/runtime/service-implementation.escript', import.meta.url));
