import path from 'node:path';

export const DECLARATIONS_FILE = '(declerations).escript';

export function serviceScriptPlan(folder, implementationFile, names) {
  const scripts = names.filter(name => name.toLowerCase().endsWith('.escript'));
  const declaration = scripts.find(name => name.toLowerCase() === DECLARATIONS_FILE);
  const others = scripts
    .filter(name => name !== declaration)
    .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));
  return [implementationFile, ...(declaration ? [path.join(folder, declaration)] : []), ...others.map(name => path.join(folder, name))];
}

export function directMethodName(filename) {
  const basename = path.basename(filename);
  const extension = path.extname(basename);
  // Function identifiers are case-sensitive. Only remove the extension; never
  // normalize the filename because it maps 1:1 to the Direct entry point.
  return extension ? basename.slice(0, -extension.length) : basename;
}
