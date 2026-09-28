# Changelog

## 0.2.0 - 2026-09-28

- Correctly maps eScript cursor modes `ForwardBackward` and `ForwardOnly` to the Boolean arguments expected by the Java Data Bean for `ExecuteQuery` and `ExecuteQuery2`.
- Compares the configured `Siebel.jar` with the SHA-256 of the build verified for this extension.
- Shows a non-blocking warning when a different JAR build is selected because compatibility and correct operation cannot be guaranteed.
- Adds automated regression tests for cursor conversion and JAR compatibility detection.

## 0.1.0 - 2026-09-27

- Initial release of the Siebel eScript Debugger.
- Runs synchronous eScript APIs through a user-provided Oracle Siebel Java Data Bean.
- Supports standalone scripts, service folders, breakpoints, typed ST eScript, reference parameters, legacy `with` statements, and project type definitions.
- Keeps credentials in VS Code SecretStorage.
- Does not distribute Oracle JAR files; `Siebel.jar` and its companion language JARs are loaded from a user-configured central directory.
- Licensed for free use of the unmodified official extension, including professional use in commercial environments; redistribution, unofficial modifications, and product integration require prior written permission.
