# Changelog

All notable changes to the Siebel eScript Debugger are documented in this file.

## [0.3.0] - 2026-09-25

### Added

- Added support for legacy `with (object)` statements when working with ordinary JavaScript objects and remote Siebel proxy objects.
- Added scope-aware lookup for synchronous Siebel API methods inside `with` blocks without masking unrelated local or global identifiers.

### Documentation

- Documented the non-strict classic-script execution required for `with` statements in the English and German technical documentation.

## [0.1.0] - 2026-09-25

### Added

- Initial release containing all features and functionality available to date.
