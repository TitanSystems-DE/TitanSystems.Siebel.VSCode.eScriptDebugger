[🇩🇪 Deutsch](TECHREADME_de.md) | 🇬🇧 **English**

# Technical documentation

This document describes the architecture, runtime behavior, development workflow, tests, and packaging of the Siebel eScript Debugger. See [`README.md`](README.md) for user documentation.

## Requirements

- Node.js 22 or newer
- npm
- a compatible VS Code version starting with `1.95`
- Java 8 or newer and a user-provided Oracle `Siebel.jar`

## Project structure

```text
escript-debugger/
├── src/
│   ├── extension.ts          Extension activation and debug configuration
│   ├── debugger-ui.ts        Webview and service configuration
│   └── profiles.ts           Connection profiles and SecretStorage
├── runtime/
│   ├── runner.mjs            Debug process entry point
│   ├── worker.mjs            Oracle Java Data Bean process management
│   ├── sync-bridge.mjs       Synchronous remote-object facade
│   ├── constants.mjs         Global eScript constants
│   ├── service-runtime.mjs   Service load-order planning
│   ├── local-service-runtime.mjs
│   │                          Local service resolution and isolation
│   ├── service-scaffold.mjs  Service folder-name validation
│   ├── workspace-runtime.mjs Workspace validation and template rendering
│   ├── type-stripper.mjs     ST eScript type processing
│   └── reference-transformer.mjs
│                              Call-by-reference transformation
├── service-implementation.escript
├── assets/
│   ├── icon.png              VSIX and extension view icon
│   ├── templates/ws-change.escript
│   │                          Workspace open/preview startup script
│   └── templates/service-scripts/
│                              New-service starter scripts
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
3. A worker owns the Oracle Java Data Bean process and all Siebel objects.

The runner exposes synchronous eScript calls while Oracle's Java Data Bean runs in a separate Java process. `sync-bridge.mjs` sends operations through a worker, which forwards them to `OracleSiebelBridge.java`; Siebel objects are represented by numeric handles.

The worker and Java process exchange tab-separated packets through request and response files in a private temporary directory. Each side writes a complete packet to a sibling `.tmp` file and then atomically renames it to the watched path. This prevents the polling reader from observing a file between creation and completion. The Java bridge also validates the packet header and declared argument count before dispatch and reports malformed packets as protocol errors.

PascalCase calls such as `GetBusObject` are forwarded by the proxy boundary to the corresponding Java Data Bean operations.

The runner deliberately executes eScript as a classic, non-strict script so legacy `with (object)` statements remain valid. Remote Siebel proxies advertise the known synchronous API during JavaScript's scope lookup, allowing unqualified calls such as `with (bc) { FirstRecord(); }` while leaving unrelated local and global identifiers untouched.

## Debug integration

A `DebugConfigurationProvider` translates the `escript` debug type into a Node launch configuration. The built-in JavaScript debugger starts `dist/runtime/runner.mjs`.

The generated Node launch configuration uses `console: 'internalConsole'` and `internalConsoleOptions: 'openOnSessionStart'`. `Clib.WriteLn` and `Clib.puts` write synchronously to standard output, and VS Code presents that stream in the Debug Console during both debugging and run-without-debugging sessions. No integrated terminal is created, so VS Code does not echo its environment-variable setup as a PowerShell command.

Each source file is executed through `vm.Script` with an inline source map. Every generated runtime line maps to the same line in the original `.escript` file. VS Code can consequently bind gutter breakpoints before a dynamically loaded script exists and show its original source in the call stack. When execution pauses, locals and globals are available in the standard Variables, Watch, and Debug Console views.

Connection data, including the required launch workspace, is Base64-encoded and passed to the launched process through `SIEBEL_ESCRIPT_CONNECTION`; it is removed from the process environment immediately after being read. Base64 is transport encoding, not encryption. The extension host persists the password exclusively through `ExtensionContext.secrets`; non-secret profile fields, including the workspace name, live in `ExtensionContext.globalState`. Using the internal console prevents the encoded payload from being echoed into terminal history.

## Connection and workspace lifecycle

The term *workspace* in the runtime means a Siebel Repository Workspace. It is unrelated to `vscode.WorkspaceFolder`. The latter only determines the source-file/debug-session context, while `ConnectionProfile.workspace` determines the server-side repository context in which eScript executes.

`ProfileStore` persists profiles under `escriptDebugger.connections`. Each profile has `{ name, url, username, language, workspace? }`; its password uses a separate SecretStorage key. The setting `escriptDebugger.activeConnection` stores the active profile name. The status-bar renderer combines that name with the profile's current workspace as `Siebel: <connection> (<workspace>)`. The Webview uses `<connection> (<workspace>)` as well and intentionally excludes the URL and user name.

Workspace resolution happens in `resolveLaunch` before a debug configuration is returned:

1. `config.connection` wins when supplied by the launcher or `launch.json`; otherwise `escriptDebugger.activeConnection` is used.
2. If that profile has a non-empty `workspace`, it becomes the launch workspace.
3. Otherwise an input box requires a non-empty name. This fallback is copied into the in-memory launch profile only and is not persisted. Persistence is deliberately explicit through **Set workspace for active connection**.
4. The resolved profile and password are serialized into the launch payload. A launch can therefore never reach the runner without a non-empty workspace.

Selecting a profile in the Webview updates the active connection when the launch starts. Changing the workspace through the connection manager saves a new copy of the active profile without passing a password to `ProfileStore.save`, so the existing SecretStorage value remains unchanged. The status bar is refreshed after the operation. **Test connection** currently performs login, server-version lookup, and logoff only; it does not execute the workspace startup sequence.

At process start, `runner.mjs` reads and deletes `SIEBEL_ESCRIPT_CONNECTION`, initializes the Java Data Bean bridge, and then performs workspace activation before loading any user source:

1. `workspace-runtime.mjs` trims and validates the workspace name.
2. It injects the name into `assets/templates/ws-change.escript`. `JSON.stringify`-style escaping preserves the JavaScript string literal and prevents a workspace name from injecting eScript source.
3. The startup script queries the `Repository Workspace` business component with `AllView` and an exact name expression.
4. `FirstRecord` must find the workspace; otherwise the startup script throws.
5. The script invokes `OpenWS` followed by `PreviewWS`.
6. Only after this sequence completes does the runner dispatch the Standalone source or Service entry point.

Any validation, lookup, `OpenWS`, or `PreviewWS` failure propagates through the normal runner error path, sets a non-zero exit code, and prevents user code from running. The sequence is repeated on every launch so correctness does not depend on state retained by an earlier Siebel session.

## Webview and Activity Bar

The `siebelEscript` view container is registered through `viewsContainers.activitybar` and uses `assets/sidebar-icon.svg` as its monochrome Activity Bar icon. The `siebelEscript.debugger` Webview view provides the compact debug interface inside it.

`DebuggerSidebarProvider` and the `escript.openDebugger` command use the same Webview initialization. The interface therefore works both in the sidebar and in a separate panel. Local resources are restricted to the `assets` directory, while a nonce-based Content Security Policy protects scripts and styles.

For Service mode, `debugger-ui.ts` enumerates the directories beside the selected service whenever the Webview is rendered. Checking **Debug local sibling services** reveals this precomputed, HTML-escaped list and distinguishes the starting service from the other locally resolvable services. Selecting a different script rerenders the Webview and refreshes the discovery result.

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

When `debugLocalServices` is enabled, `local-service-runtime.mjs` indexes the directories beside the starting service folder by case-insensitive folder name. The Application facade intercepts `GetService`: matching folders are built lazily with `serviceScriptPlan`, cached, and returned as synchronous local service proxies; unmatched names are forwarded to the remote Java Data Bean Application. Each local service runs in a separate `vm` context so globals and hook overrides remain isolated. The starting service is registered under its own folder name, allowing local calls back to it and circular service references without rebuilding contexts.

## Service scaffolding command

`escript.addSiebelService` is contributed to `explorer/context` when `explorerResourceIsFolder` is true. The selected Explorer resource is the parent directory. The command asks for a service name, validates it through `service-scaffold.mjs`, rejects an existing target, and copies `assets/templates/service-scripts` recursively through `vscode.workspace.fs`. The Explorer is refreshed only after a successful copy.

Validation rejects empty names, `.` and `..`, path separators, control characters, Windows-invalid characters and reserved device names, and names ending in a period or space. The template directory is explicitly included in the package manifest so it is available from `ExtensionContext.extensionUri` in an installed VSIX.

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

eScript uses the values `256` and `257` for `ForwardBackward` and `ForwardOnly`. Oracle's Java Data Bean expects the Boolean values `false` and `true`. At the method boundary, `siebel-call.mjs` normalizes these values for `ExecuteQuery` and `ExecuteQuery2`.

## Siebel.jar compatibility check

Before a launch or connection test, `jar-compatibility.mjs` calculates the SHA-256 of the configured `Siebel.jar`. It is compared with the verified build hash `A083007FD4A30F3CE0AA1A68F968496672BFECFFCB4F8332C22DBCEB58A8DDB1`. A mismatch displays a non-blocking warning; execution continues because other JAR builds may work, but their compatibility is not guaranteed. Missing or unreadable files remain blocking configuration errors.

## Ambient type declarations

`typings/siebel-escript.d.ts` describes the synchronous API visible to scripts. The file contains no imports or exports and remains an ambient script. Project declarations can extend `Application`, `BusObject`, `BusComp`, `Service`, `PropertySet`, and `ClibRuntime` through declaration merging.

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

The build runs `tsc --noEmit` for type checking. `esbuild` then bundles the extension host and worker. The Java bridge, remaining runtime files, and `service-implementation.escript` are copied to `dist/runtime`; Oracle's JAR is never copied.

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
- cursor-mode conversion for the Java Data Bean
- atomic publication of Java bridge request packets
- matching and differing `Siebel.jar` hashes
- service load order
- sibling-service discovery, caching, local invocation, and remote fallback
- Explorer command registration, service-name validation, and packaged starter templates
- required workspace validation and injection-safe startup-script rendering
- position-preserving type processing
- protection of strings, comments, and regular expressions
- reference parameters and write-back behavior
- cross-file reference signatures
- legacy `with` scope resolution for ordinary and remote objects
- case-sensitive Direct entry-point mapping
- Service-mode `InvokeMethod` dispatch, custom hook overrides, reference contracts, inputs, outputs, post-invocation, and rejection paths
- service property helper behavior

An actual Java Data Bean login is not part of the automated tests and requires access to a suitable Siebel system and user-provided Oracle JARs.

## Creating a VSIX

Create an installable extension with `@vscode/vsce`:

```powershell
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
```

`--no-dependencies` is intentional because the extension has no production npm dependencies. The resulting package for this release is `siebel-escript-dbger-0.4.0.vsix`. Oracle JARs are never included.

## Changing the general service implementation

`service-implementation.escript` is a regular source file in the project. The build copies it to `dist/runtime`. Changes therefore take effect only after another build or before packaging a new VSIX.
