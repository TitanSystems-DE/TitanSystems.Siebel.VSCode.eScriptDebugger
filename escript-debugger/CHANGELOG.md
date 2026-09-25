# Changelog

All notable changes to the Siebel eScript Debugger are documented in this file.

## [0.4.0] - 2026-09-25

### Added

- Added support for legacy `with (object)` statements when working with ordinary JavaScript objects and remote Siebel proxy objects.
- Added scope-aware lookup for synchronous Siebel API methods inside `with` blocks without masking unrelated local or global identifiers.
- Added reliable live `Clib.WriteLn` and `Clib.puts` output to the integrated terminal for debug and run-without-debugging sessions.
- Added realistic Service-mode tests covering `InvokeMethod`, custom hook overrides, reference parameters, inputs, outputs, post-invocation, rejection paths, and service property helpers.

### Fixed

- Guaranteed case-sensitive 1:1 mapping from a Direct script filename to its global method name; only the file extension is removed.
- Preserved the selected Standalone or Service debug method when choosing the active editor or another script file.
- Added the missing `Selected` badge to the active Service debug-method card.
- Prevented accidental text selection on controls while retaining selection for file paths, input values, and output properties.

### Documentation

- Documented the non-strict classic-script execution required for `with` statements in the English and German technical documentation.
- Documented case-sensitive Direct entry points and the required custom Service hook contracts in both user guides.

## [0.1.0] - 2026-09-25

### Added

- Initial release containing all features and functionality available to date.
