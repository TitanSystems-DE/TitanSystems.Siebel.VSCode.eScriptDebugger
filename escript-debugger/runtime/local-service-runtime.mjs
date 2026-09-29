import path from 'node:path';
import vm from 'node:vm';

export function createLocalServiceResolver({ startingFolder, folders, remoteApplication, globals, loadService }) {
  const records = new Map();
  let applicationFacade;

  const facade = record => new Proxy(Object.create(null), {
    has(_target, property) { return property in record.scope; },
    get(_target, property) {
      const value = record.scope[property];
      return typeof value === 'function' ? (...args) => value.apply(record.scope, args) : value;
    }
  });

  const register = (folder, scope, loaded) => {
    const record = { folder, scope, loaded };
    record.facade = facade(record);
    records.set(path.basename(folder).toLocaleLowerCase('en'), record);
    return record;
  };

  const resolve = name => {
    const key = String(name).toLocaleLowerCase('en');
    const folder = folders.get(key);
    if (!folder) return undefined;
    let record = records.get(key);
    if (!record) record = register(folder, vm.createContext(globals(applicationFacade)), false);
    if (!record.loaded) {
      // Cache before evaluation so circular local GetService calls resolve to
      // the same service object instead of recursively rebuilding it.
      record.loaded = true;
      loadService(folder, record.scope);
    }
    return record.facade;
  };

  applicationFacade = new Proxy(remoteApplication, {
    get(target, property, receiver) {
      if (property === 'GetService') return name => resolve(name) ?? target.GetService(name);
      return Reflect.get(target, property, receiver);
    }
  });

  return {
    application: applicationFacade,
    registerStartingService(scope) { register(startingFolder, scope, true); }
  };
}
