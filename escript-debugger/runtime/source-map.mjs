import path from 'node:path';

/**
 * Maps each transformed runtime line to the corresponding original eScript
 * line. The transformations preserve line breaks, even where they add code.
 */
export function debuggableScript(filename, source, executable) {
  const generatedFilename = `${filename}.generated.js`;
  const lineCount = source.split(/\r\n|\r|\n/).length;
  const sourceMap = {
    version: 3,
    file: path.basename(generatedFilename),
    sources: [path.basename(filename)],
    sourcesContent: [source],
    names: [],
    // AAAA maps line 1/column 1; every AACA advances the source line by one.
    mappings: lineCount > 0 ? `AAAA${';AACA'.repeat(lineCount - 1)}` : ''
  };
  const encodedMap = Buffer.from(JSON.stringify(sourceMap), 'utf8').toString('base64');
  return {
    filename: generatedFilename,
    code: `${executable}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encodedMap}`
  };
}
