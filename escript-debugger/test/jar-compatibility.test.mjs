import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectSiebelJar, sha256File, VERIFIED_SIEBEL_JAR_SHA256 } from '../dist/runtime/jar-compatibility.mjs';

test('detects matching and differing JAR hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'siebel-jar-test-'));
  const filename = join(directory, 'Siebel.jar');
  try {
    await writeFile(filename, 'verified fixture');
    const fixtureHash = await sha256File(filename);
    assert.equal((await inspectSiebelJar(filename, fixtureHash.toLowerCase())).compatible, true);
    const mismatch = await inspectSiebelJar(filename, '0'.repeat(64));
    assert.equal(mismatch.compatible, false);
    assert.equal(mismatch.actualHash, fixtureHash);
    assert.equal(VERIFIED_SIEBEL_JAR_SHA256, 'A083007FD4A30F3CE0AA1A68F968496672BFECFFCB4F8332C22DBCEB58A8DDB1');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
