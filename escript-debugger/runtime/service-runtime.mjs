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
  return path.basename(filename, path.extname(filename));
}
