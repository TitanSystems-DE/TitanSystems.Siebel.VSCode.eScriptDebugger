/** Adapt eScript arguments to the Java Data Bean API. */
export function adaptSiebelCall(method, args) {
  if ((method === 'executeQuery' || method === 'executeQuery2') && args.length) {
    // eScript uses cursor constants, while the Java Data Bean expects a
    // forward-only boolean for the first argument.
    if (args[0] === 256) args[0] = false;
    else if (args[0] === 257) args[0] = true;
  }
  return args;
}
