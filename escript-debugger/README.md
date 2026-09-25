[🇩🇪 Deutsch](README_de.md) | 🇬🇧 **English**

# Siebel eScript Debugger

> [!WARNING]
> **Experimental software:** This extension is at an experimental stage and is provided without warranties or guarantees regarding functionality, reliability, correctness, or fitness for a particular purpose. Using it in a production Siebel environment is explicitly discouraged. Use it only in secured development or test environments, with suitable test data, least-privilege accounts, and current backups. Scripts can read, modify, or delete data; review them carefully before execution. Use is entirely at your own risk. This extension is not an official Oracle product and is not supported by Oracle.

The Siebel eScript Debugger executes and debugs `.escript` files from Visual Studio Code against a Siebel Server. It exposes the SISNAPI-backed Siebel eScript API synchronously.

## Getting started

1. Open an `.escript` file in VS Code.
2. Run **Siebel eScript: Manage Connections** and create a connection profile.
3. Open the launcher through the Siebel eScript icon in the Activity Bar, the editor debug icon, or **Siebel eScript: Open Debugger**.
4. Select the script, connection, and execution mode.
5. Choose **Start debugging** or **Run without debugging**.

`F5` starts the currently open `.escript` file directly in Standalone mode.

## Managing connections

The connection manager lets you:

- create a Siebel connection
- edit an existing connection
- select the active connection
- test a connection
- remove a connection

A profile contains a name, SISNAPI URL, user name, and language. The password is stored in VS Code SecretStorage, never in settings or script files.

The active connection appears in the VS Code status bar. A different profile can be selected for each run in the launcher.

## Launcher

The launcher provides two execution modes:

- **Standalone** runs exactly one script.
- **Service** loads all related scripts in one directory into a shared runtime.

The script can be taken from the active editor or selected in a file dialog. Both modes can run with the debugger or without breakpoints.

Changing the script through **Active editor** or **Choose…** preserves the selected Standalone or Service mode.

The compact launcher is permanently available in the VS Code sidebar. **Siebel eScript: Open Debugger** opens the same interface as a larger editor panel.

### Standalone interface

![Siebel eScript Debugger in Standalone mode](docs/screenshots/standalone.png)

Standalone mode shows the active file and selected connection profile. The script can be started with or without the debugger.

### Service interface

![Siebel eScript Debugger in Service mode with InvokeMethod](docs/screenshots/service.png)

Service mode adds entry-point selection and input properties. After an `InvokeMethod` call, values read from `SERV_OUTPUTS` appear under **Output properties**.

## Standalone mode

Standalone mode loads and executes only the selected `.escript` file. It is suitable for self-contained scripts, tests, and direct SISNAPI calls.

Example:

```js
var oBO = TheApplication().GetBusObject("Contact");
var oBC = oBO.GetBusComp("Contact");

oBC.ActivateField("Last Name");
oBC.ClearToQuery();
oBC.SetSearchSpec("Last Name", "Miller*");
oBC.ExecuteQuery(ForwardOnly);

if (oBC.FirstRecord()) {
  Clib.WriteLn(oBC.GetFieldValue("Last Name"));
}

oBO.Release();
```

## Service mode

In Service mode, every `.escript` file in the selected script's directory is part of the same service. All files share global variables and functions.

### Building the service runtime

Before invoking the selected entry point, the extension performs these steps:

1. It loads the bundled general-purpose `service-implementation.escript`, which provides core service functions such as `InvokeMethod`, `SetProperty`, and `GetProperty`.
2. If `(declerations).escript` exists in the script directory, it is loaded next. It may contain shared service variables and declarations.
3. All remaining `.escript` files in that directory are loaded in alphabetical order. `(declerations).escript` is not executed again.
4. After every file has run in the shared context, the entry point configured in the GUI is invoked.

Breakpoints can be set in all participating files.

### Direct entry point

For **Direct**, a dropdown lists every `.escript` file in the service directory except `(declerations).escript`. After building the runtime, the extension invokes a global function whose name matches the selected filename without `.escript`. This mapping is case-sensitive: the filename must match the function name exactly.

Example:

- selected file: `CalculatePrice.escript`
- expected function: `CalculatePrice()`

```js
function CalculatePrice() {
  // Entry point
}
```

### InvokeMethod entry point

For **InvokeMethod**, configure:

- the method name to invoke
- any number of string input properties, each consisting of a name and value

The runtime provides two global PropertySets:

- `SERV_INPUTS` contains the input properties configured in the GUI.
- `SERV_OUTPUTS` receives the service results.

After building the runtime, the extension calls:

```js
InvokeMethod(methodName, SERV_INPUTS, SERV_OUTPUTS);
```

When the call completes, all properties in `SERV_OUTPUTS` are read and displayed by name and value in the launcher.

User method files must override the service hooks that decide whether and how a method is handled. `canInvoke` is a reference parameter and therefore must retain the `&` marker:

```js
function Service_PreCanInvokeMethod(methodName, &canInvoke) {
  canInvoke = methodName == "MyMethod";
  return CancelOperation;
}

function Service_PreInvokeMethod(methodName, inputs, outputs) {
  if (methodName != "MyMethod") return ContinueOperation;
  outputs.SetProperty("Result", inputs.GetProperty("Value"));
  return CancelOperation;
}
```

Returning `ContinueOperation` delegates processing to the next stage. Returning `CancelOperation` indicates that the hook handled the stage. An allowed method for which `Service_PreInvokeMethod` returns `ContinueOperation` must be implemented by another handler or the runtime reports it as unimplemented.

## Debugging

The extension supports the standard VS Code debugging features:

- breakpoints in `.escript` files
- step into, step over, and step out
- Variables view
- Call Stack
- live `Clib.WriteLn` and `Clib.puts` output in the integrated terminal
- stopping and restarting execution

In Service mode, every loaded file runs under its original path, so breakpoints also work in helper functions and shared scripts.

## Typed ST eScript

Typed variables, parameters, and return values can use the customary eScript syntax:

```js
var oBC : BusComp;

function FindContact(id : String) : BusComp {
  // ...
}
```

Original files remain unchanged. Type declarations are processed only in memory for execution. Breakpoints and stack traces continue to refer to the original `.escript` files.

## Reference parameters

Primitive values can be passed by reference using `&` parameters:

```js
function SetResult(input, &result) {
  result = input + " processed";
}

var value = "";
SetResult("data", value);
// value is now "data processed"
```

Inside the function, a reference parameter is used like an ordinary variable. Changes are written back to the caller when the function exits, including after an early `return` or exception.

Assignable expressions such as variables, object properties, and array elements may be passed as reference arguments. Fully dynamic calls whose function name is resolved from a string at runtime cannot be matched to an `&` signature.

## Legacy `with` statements

Legacy Siebel eScript `with (object)` statements are supported for ordinary objects and synchronous remote Siebel objects:

```js
with (oBC) {
  ClearToQuery();
  ExecuteQuery(ForwardOnly);
  FirstRecord();
}
```

Scripts run as classic, non-strict scripts because JavaScript strict mode does not permit `with` statements.

## Siebel objects and global functions

The familiar Siebel methods are exposed synchronously in PascalCase. Objects and methods backed by the SISNAPI framework are available for:

- Application
- BusObject
- BusComp
- Service
- PropertySet

Additional global functions and objects include:

- `TheApplication()`
- `Application()`
- `ToNumber(value)`
- `ToString(value)`
- `Clib.WriteLn(value)`
- `Clib.puts(value)`
- `Clib.getenv(name)`
- `Clib.time()`

## Type definitions for development tools

The extension includes the ambient declaration file `siebel-escript.d.ts`. It describes the additional globals, constants, and synchronous Siebel objects supplied by the debugger runtime. TypeScript-based tools can therefore resolve expressions such as:

```js
Clib.WriteLn("Starting");

var oBO = TheApplication().GetBusObject("Contact");
var oBC = oBO.GetBusComp("Contact");
oBC.ExecuteQuery(ForwardOnly);
oBO.Release();
```

### Installing declarations in a project

1. Open the project directory as a VS Code workspace.
2. Run **Siebel eScript: Install Type Definitions** from the Command Palette.
3. The extension copies the declarations to `.vscode/typings/siebel-escript.d.ts`.
4. Include this file in the configuration of your TypeScript, ESLint, or analysis tool.

A TypeScript-compatible checking project can include it as follows:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true
  },
  "include": [
    ".vscode/typings/**/*.d.ts",
    "scripts/**/*"
  ]
}
```

Tools that ignore unknown file extensions must also be configured for `.escript`. With ESLint and a TypeScript-based parser, this is typically done with `extraFileExtensions: [".escript"]`. VS Code's built-in TypeScript language support does not automatically analyze the custom `escript` language mode, so the declaration file is primarily intended for suitably configured linters, type checkers, and other analysis tools.

### Adding project-specific types

The interfaces are intentionally incremental. A project can add methods in its own `.d.ts` file without modifying the bundled declaration:

```ts
interface BusComp {
  RefreshRecord(): string;
}

interface Application {
  GetCustomContext(): string;
}
```

TypeScript combines identically named interfaces through declaration merging. A newer extension can replace its base definitions while project-specific additions remain in a separate file.

## Constants

The following Siebel constants are globally available:

- events: `ContinueOperation`, `CancelOperation`
- cursors: `ForwardBackward`, `ForwardOnly`
- new records: `NewBefore`, `NewAfter`, `NewBeforeCopy`, `NewAfterCopy`
- visibility: `SalesRepView`, `ManagerView`, `PersonalView`, `AllView`, `NoneSetView`, `OrganizationView`, `ContactView`, `GroupView`, `CatalogView`, `SubOrganizationView`
- compatibility aliases: `NoneView`, `NoneSetViewMode`, `OperationComplete`

## Optional launch.json

Standalone debugging can alternatively be launched through `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [{
    "type": "escript",
    "request": "launch",
    "name": "Debug Siebel eScript",
    "program": "${file}",
    "connection": "Development"
  }]
}
```

If `connection` is omitted, the extension uses the active connection profile.

## Limitations and notes

- Browser- and Siebel Client-specific APIs not provided by the SISNAPI framework are unavailable.
- Business Object, Business Component, Service, and field names must match the target Siebel repository.
- `ViewMode` constants do not alter server-side permissions.
- Test scripts that write data in a suitable test environment first.
- The SISNAPI client is experimental and should be validated against the Siebel version in use.

## License and trademarks

This extension is distributed under the [MIT License](LICENSE). Oracle, Siebel, and related product names are trademarks of their respective owners. This extension is an independent project and is not endorsed or supported by Oracle.
