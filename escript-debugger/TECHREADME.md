[🇩🇪 Deutsch](TECHREADME_de.md) | 🇬🇧 **English**

# Technical documentation

This document describes the architecture, runtime behavior, development workflow, tests, and packaging of the Siebel eScript Debugger. See [`README.md`](README.md) for user documentation.

## Requirements

- Node.js 22 or newer
- npm
- a compatible VS Code version starting with `1.95`
- the local SISNAPI package `../sisnapi-framework/ts-sisnapi-0.1.0.tgz`

## Project structure

```text
escript-debugger/
├── src/
│   ├── extension.ts          Extension activation and debug configuration
│   ├── debugger-ui.ts        Webview and service configuration
│   └── profiles.ts           Connection profiles and SecretStorage
├── runtime/
│   ├── runner.mjs            Debug process entry point
│   ├── worker.mjs            Asynchronous SISNAPI execution
│   ├── sync-bridge.mjs       Synchronous remote-object facade
│   ├── constants.mjs         Global eScript constants
│   ├── service-runtime.mjs   Service load-order planning
│   ├── type-stripper.mjs     ST eScript type processing
│   └── reference-transformer.mjs
│                              Call-by-reference transformation
├── service-implementation.escript
├── assets/icon.png           VSIX and extension view icon
├── typings/
│   └── siebel-escript.d.ts   Ambient runtime type declarations
├── syntaxes/                 TextMate grammar
├── scripts/build.mjs         Build and bundling
└── test/bridge.test.mjs      Runtime and transformation tests
```

## Architecture

The extension consists of three runtime areas:

1. The VS Code extension host manages the GUI, profiles, and debug configurations.
2. `runner.mjs`, launched through the built-in Node debugger, loads and executes eScript.
3. A worker owns the SISNAPI connection and all Siebel objects.

The runner must expose synchronous eScript calls while `ts-sisnapi` is Promise-based. `sync-bridge.mjs` therefore sends operations to the worker through a `MessageChannel` and waits for the result with `Atomics.wait`. The worker performs the asynchronous RPC, serializes the result, and wakes the runner. Siebel objects are not copied between threads; synchronous proxies represent them through numeric handles.

PascalCase calls such as `GetBusObject` are mapped at the proxy boundary to the TypeScript framework's camelCase methods.

The runner deliberately executes eScript as a classic, non-strict script so legacy `with (object)` statements remain valid. Remote Siebel proxies advertise the known synchronous API during JavaScript's scope lookup, allowing unqualified calls such as `with (bc) { FirstRecord(); }` while leaving unrelated local and global identifiers untouched.

## Debug integration

A `DebugConfigurationProvider` translates the `escript` debug type into a Node launch configuration. The built-in JavaScript debugger starts `dist/runtime/runner.mjs`.

The runner always uses VS Code's integrated terminal. `Clib.WriteLn` and `Clib.puts` write synchronously to the standard-output file descriptor, bypassing debugger console interception and stream buffering. Their output therefore appears live in the terminal during both debugging and run-without-debugging sessions. The Debug Console is not opened for eScript output.

Each source file is executed through `vm.Script`, using its real path as `filename`. VS Code can consequently associate breakpoints, call-stack entries, and exceptions with the original `.escript` files.

Connection data is Base64-encoded and passed to the launched process through `SIEBEL_ESCRIPT_CONNECTION`; it is removed from the process environment immediately after being read. The extension host stores the password exclusively through `ExtensionContext.secrets`.

## Webview and Activity Bar

The `siebelEscript` view container is registered through `viewsContainers.activitybar` and uses `assets/sidebar-icon.svg` as its monochrome Activity Bar icon. The `siebelEscript.debugger` Webview view provides the compact debug interface inside it.

`DebuggerSidebarProvider` and the `escript.openDebugger` command use the same Webview initialization. The interface therefore works both in the sidebar and in a separate panel. Local resources are restricted to the `assets` directory, while a nonce-based Content Security Policy protects scripts and styles.

## Standalone runtime

In Standalone mode, the runner reads exactly one file. Before execution, it collects reference signatures, transforms reference parameters, and processes ST eScript type annotations. The result is then executed in the VM context.

## Service runtime

`serviceScriptPlan` builds a deterministic list of files to execute:

1. `dist/runtime/service-implementation.escript`
2. the optional `(declerations).escript` found in the target directory
3. all other `.escript` files in the target directory, sorted alphabetically

All sources are read first and jointly analyzed for reference signatures. Each file is then executed in the order above within the same global VM context.

For `Direct`, the extension removes the selected filename extension and calls the corresponding global function. No case normalization is performed; the filename maps case-sensitively and 1:1 to the function name.

For `InvokeMethod`, the runner creates two PropertySets through the synchronous Application facade. GUI inputs are written to `SERV_INPUTS` with `SetProperty`. After

```js
InvokeMethod(methodName, SERV_INPUTS, SERV_OUTPUTS);
```

the runner iterates over `GetFirstProperty` and `GetNextProperty`. Results are passed through a temporary JSON file. The extension host watches this file, sends the outputs to the Webview, and then removes it.

The bundled implementation denies methods by default. User method files loaded later must override `Service_PreCanInvokeMethod` and `Service_PreInvokeMethod` as appropriate. The `canInvoke` argument must remain an `&` reference parameter so the generated call-by-reference bridge writes the decision back into `InvokeMethod`. `ContinueOperation` delegates to the next stage; `CancelOperation` marks the current stage as handled.

## ST eScript type processing

`type-stripper.mjs` contains a lexer that treats strings, comments, template strings, and regular expressions as immutable regions. It removes type annotations from:

- `var`, `let`, and `const` declarations
- function parameters
- function return values

Every character in a type annotation is replaced by whitespace. UTF-16 length, line breaks, and all following source positions remain unchanged. Colons in object literals, labels, and ternary expressions are not treated as type annotations.

Processing applies only to the in-memory copy. Source files are never written.

## Reference parameters

`reference-transformer.mjs` analyzes function declarations for parameters of the form `&name`. In Service mode, it does this across all sources before executing the first file.

Call arguments at reference positions are converted into getter/setter cells. A function with reference parameters receives a generated prologue and a `try/finally` epilogue:

- The prologue unwraps the current value into the ordinary parameter.
- The original function body operates on a normal local variable.
- The `finally` block writes the final value back to the reference cell.

This also writes values back after `return` and exceptions. The transformation adds no line breaks. Function names resolved dynamically from strings cannot be transformed statically.

## Cursor constants

eScript uses the values `256` and `257` for `ForwardBackward` and `ForwardOnly`. The DataBean-compatible SISNAPI API expects `0` and `1`. At the method boundary, `worker.mjs` normalizes these values for `ExecuteQuery` and `ExecuteQuery2`.

## Ambient type declarations

`typings/siebel-escript.d.ts` describes the synchronous API visible to scripts. It therefore cannot be derived directly from the Promise return types in `ts-sisnapi`. The file contains no imports or exports and remains an ambient script. Project declarations can extend `Application`, `BusObject`, `BusComp`, `Service`, `PropertySet`, and `ClibRuntime` through declaration merging.

The `escript.installTypings` command copies the file to `.vscode/typings/siebel-escript.d.ts` only at the user's explicit request. A modal confirmation is required before an existing file is overwritten.

## Build

Install dependencies:

```powershell
npm install
```

Check TypeScript and generate runtime files:

```powershell
npm run build
```

The build runs `tsc --noEmit` for type checking. `esbuild` then bundles the extension host and worker, including `ts-sisnapi`. The remaining runtime files and `service-implementation.escript` are copied to `dist/runtime`.

Continuous TypeScript checking is available through:

```powershell
npm run watch
```

## Tests

Run the build and tests together:

```powershell
npm test
```

The current test suite covers, among other things:

- PascalCase proxies and object handles
- the complete constant set
- service load order
- position-preserving type processing
- protection of strings, comments, and regular expressions
- reference parameters and write-back behavior
- cross-file reference signatures
- legacy `with` scope resolution for ordinary and remote objects
- case-sensitive Direct entry-point mapping
- Service-mode `InvokeMethod` dispatch, custom hook overrides, reference contracts, inputs, outputs, post-invocation, and rejection paths
- service property helper behavior

An actual SISNAPI login is not part of the automated tests and requires access to a suitable Siebel system.

## Creating a VSIX

Create an installable extension with `@vscode/vsce`:

```powershell
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
```

`--no-dependencies` is intentional because `ts-sisnapi` is already bundled into the extension and worker by `esbuild`. The resulting package is named after the current version, for example `siebel-escript-debugger-0.4.0.vsix`.

## Changing the general service implementation

`service-implementation.escript` is a regular source file in the project. The build copies it to `dist/runtime`. Changes therefore take effect only after another build or before packaging a new VSIX.
