import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** SHA-256 of the Oracle Siebel.jar build verified with this debugger. */
export const VERIFIED_SIEBEL_JAR_SHA256 = 'A083007FD4A30F3CE0AA1A68F968496672BFECFFCB4F8332C22DBCEB58A8DDB1';

export async function sha256File(filename) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const input = createReadStream(filename);
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', resolve);
  });
  return hash.digest('hex').toUpperCase();
}

export async function inspectSiebelJar(filename, expectedHash = VERIFIED_SIEBEL_JAR_SHA256) {
  const actualHash = await sha256File(filename);
  return { actualHash, expectedHash: expectedHash.toUpperCase(), compatible: actualHash === expectedHash.toUpperCase() };
}
