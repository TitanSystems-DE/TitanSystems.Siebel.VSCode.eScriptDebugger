# Siebel eScript Debugger

This repository contains the Visual Studio Code extension **Siebel eScript Debugger**. It runs and debugs `.escript` files against a Siebel server using Oracle's official Siebel Java Data Bean.

The Oracle libraries are not distributed with the extension. Each user provides a compatible `Siebel.jar` and its companion JARs, including `SiebelJI_<language>.jar`, in a central local directory.

## Requirements

- Visual Studio Code 1.95 or newer
- Java 8 or newer
- Oracle `Siebel.jar` and the matching language JAR from the target Siebel installation
- access to a Siebel Object Manager

Configure the absolute path to `Siebel.jar` in `escriptDebugger.siebelJar`. Keep all required companion JARs in the same directory. If `java` is not on `PATH`, configure `escriptDebugger.javaPath` as well.

Version 0.2.0 compares the configured `Siebel.jar` with the SHA-256 of the build verified for the debugger. A different build produces a warning, but does not block execution; compatibility and correct operation cannot be guaranteed in that case.

## Version 0.3.0 highlights

- Debug several locally stored business services in one Service-mode session. The selected script's folder is the starting service and its sibling folders are available through `TheApplication().GetService()`.
- See every locally available service directly in the debugger panel before starting the session. Calls without a matching local folder continue to use Siebel.
- Right-click a folder in the Explorer and select **Add Siebel Service** to create a service folder from the bundled starter scripts.

See the [Service mode guide](escript-debugger/README.md#service-mode) for the required folder layout and a complete walkthrough.

## Documentation

- [User guide](escript-debugger/README.md)
- [Technical documentation](escript-debugger/TECHREADME.md)

## Development

```powershell
cd escript-debugger
npm install
npm test
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
```

The generated VSIX does not contain Oracle JAR files.

The release archive is named `siebel-escript-dbger-0.3.0.vsix`.

## License

The [TitanSystems Free-to-Use No-Derivatives License](escript-debugger/LICENSE) permits the unmodified official extension to be used free of charge, including for professional work in commercial environments. Modification is permitted only to prepare contributions to the official project. Commercial distribution, unofficial modified versions, and integration of the extension into other products require prior written permission. Third-party components remain governed by their own licenses.

Oracle, Siebel, and related names are trademarks of their respective owners. This independent project is not endorsed or supported by Oracle.
