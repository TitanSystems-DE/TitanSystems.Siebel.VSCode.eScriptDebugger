/** Adapt eScript arguments to the Java Data Bean API. */
export function adaptSiebelCall(method, args) {
  if (method === 'invokeMethod') {
    // Business services already use invokeMethod(String, PropertySet, ...).
    // Preserve those object arguments (and an explicitly supplied array).
    if (args.slice(1).some(value => value && typeof value === 'object')) return args;
    // eScript accepts InvokeMethod(name, arg1, ...), whereas the Java Data
    // Bean BusComp exposes invokeMethod(String, String[]). Always supply the
    // array, including for calls which have no method arguments.
    return [args[0], args.slice(1).map(value => value == null ? '' : String(value))];
  }
  if ((method === 'executeQuery' || method === 'executeQuery2') && args.length) {
    // eScript uses cursor constants, while the Java Data Bean expects a
    // forward-only boolean for the first argument.
    if (args[0] === 256) args[0] = false;
    else if (args[0] === 257) args[0] = true;
  }
  return args;
}
