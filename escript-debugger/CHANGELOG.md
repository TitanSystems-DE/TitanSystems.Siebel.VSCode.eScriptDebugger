# Changelog

## 0.3.0 - 2026-09-29

- Adds a **Debug local sibling services** option to Service mode.
- Shows the discovered starting and sibling service folders in the debugger UI when local-service debugging is enabled.
- Adds an Explorer context-menu command, **Add Siebel Service**, which creates a validated service folder and copies the bundled starter scripts into it.
- Treats the selected script's folder name as the starting business-service name and sibling folder names as other available local business services.
- Resolves `TheApplication().GetService(name)` to a lazily built, cached local service when a matching sibling folder exists.
- Keeps each local service in an isolated runtime context while sharing the Siebel application and PropertySet objects needed for service calls.
- Falls back to Oracle's Java Data Bean when no matching local service folder exists.
- Supports breakpoints in locally loaded service scripts and adds regression coverage for discovery, caching, local invocation, and remote fallback.

## 0.2.1 - 2026-09-29

- Publishes Java bridge requests with an atomic temporary-file rename so the Java process cannot observe empty or partially written packets.
- Validates bridge packet headers and argument counts before dispatch, replacing low-level array-index failures with actionable malformed-request errors.
- Adds an automated regression test for atomic request publication.

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
