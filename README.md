[🇩🇪 Deutsch](README_de.md) | 🇬🇧 **English**

# Siebel eScript Debugger & TypeScript SISNAPI

This repository combines a Visual Studio Code debugger for Siebel eScript with the native TypeScript SISNAPI client that powers its server communication. Together, the projects make it possible to run, inspect, and debug `.escript` files directly from VS Code without Java or proprietary Oracle client libraries at runtime.

> [!WARNING]
> **Experimental software:** Both projects are at an early stage and are provided without warranties or guarantees. Do not use them in production Siebel environments. Use secured development or test systems, least-privilege accounts, suitable test data, and current backups. Scripts and API calls can read, modify, or delete data. This is an independent project and not an official Oracle product.

## Projects

| Project | Purpose | Details |
| --- | --- | --- |
| [`escript-debugger`](escript-debugger/) | VS Code extension for executing and debugging Siebel `.escript` files | [User guide](escript-debugger/README.md) · [Technical documentation](escript-debugger/TECHREADME.md) |
| [`sisnapi-framework`](sisnapi-framework/) | Native TypeScript/Node.js SISNAPI client and asynchronous Siebel DataBean API | [User guide](sisnapi-framework/README.md) · [Technical documentation](sisnapi-framework/TECHREADME.md) |

The extension provides the development experience and a synchronous, eScript-style runtime API. The framework handles the underlying SISNAPI transport, sessions, RPCs, PropertySets, and Siebel business objects. The two projects are kept separate so that `ts-sisnapi` can also be used independently in Node.js applications.

## Siebel eScript Debugger

The VS Code extension turns `.escript` files into a debuggable workflow against a Siebel Server:

- standard VS Code breakpoints, stepping, variables, call stack, and Debug Console
- standalone execution of individual scripts
- service mode with shared scripts, direct entry points, and `InvokeMethod`
- connection profiles with passwords stored in VS Code SecretStorage
- typed ST eScript and reference parameters using `&`
- synchronous `Application`, `BusObject`, `BusComp`, `Service`, and `PropertySet` APIs
- bundled type definitions for linters, type checkers, and other development tools

![Siebel eScript Debugger in Service mode](escript-debugger/docs/screenshots/service.png)

### Quick start

1. Install or package the extension from [`escript-debugger`](escript-debugger/).
2. Open an `.escript` file in VS Code.
3. Run **Siebel eScript: Manage Connections** and create a connection profile.
4. Open the launcher from the Siebel eScript Activity Bar icon or run **Siebel eScript: Open Debugger**.
5. Select standalone or service mode and start the script with or without debugging.

Pressing `F5` starts the active `.escript` file in standalone mode. See the [complete extension guide](escript-debugger/README.md) for service loading, entry points, type definitions, constants, and `launch.json` configuration.

## TypeScript SISNAPI framework

`ts-sisnapi` is an independently written TypeScript implementation for interoperable communication with Siebel over SISNAPI. It requires Node.js 22 or newer and does not require Java or Oracle libraries at runtime.

The library provides:

- login, logoff, session handling, and serialized RPC execution
- `Application`, `SiebelPropertySet`, `SiebelBusObject`, `SiebelBusComp`, and `SiebelService`
- queries, record changes, service calls, and object release
- TCP transport, optional Zlib compression, and selected TLS modes
- nested PropertySets with properties, text, binary values, and child nodes
- TypeScript declarations for the public API

Network operations are asynchronous and return Promises; local PropertySet operations are synchronous.

```ts
import { Application, CursorMode } from 'ts-sisnapi';

const app = new Application({ requestTimeout: 30_000 });

try {
  await app.login(
    process.env.SIEBEL_URL!,
    process.env.SIEBEL_USER!,
    process.env.SIEBEL_PASSWORD!,
  );

  const bo = await app.getBusObject('Account');
  try {
    const bc = await bo.getBusComp('Account');
    await bc.activateField('Name');
    await bc.clearToQuery();
    await bc.setSearchSpec('Name', 'Acme*');
    await bc.executeQuery(CursorMode.ForwardOnly);

    if (await bc.firstRecord()) {
      console.log(await bc.getFieldValue('Name'));
    }
  } finally {
    await bo.release();
  }
} finally {
  app.close();
}
```

For supported operations and protocol details, see the [API coverage](sisnapi-framework/docs/api.md) and [protocol documentation](sisnapi-framework/docs/protocol.md).

## Building and testing

Prerequisites:

- Node.js 22 or newer
- npm
- Visual Studio Code 1.95 or newer to run the extension

Build and test the framework first:

```sh
cd sisnapi-framework
npm ci
npm test
npm pack
```

Then build and test the extension:

```sh
cd ../escript-debugger
npm ci
npm test
```

The extension references the locally packed `ts-sisnapi` package. Its build bundles the runtime dependency into the extension output.

## Current status and limitations

Both packages currently report version `0.1.0`. The framework covers the documented protocol and DataBean surface and includes automated tests against reference bytes, local TCP sessions, and error cases. Basic Hello, SessionHello, and SessionClose exchanges have been exercised against a Siebel 26.5 endpoint; a complete login and real object calls still require validation with credentials in the target environment.

Notable limitations include unsupported RSA/RC4 and MSCRYPTO modes, PKWARE compression, HTTP tunneling, virtual server lists, connection pooling, and automatic failover. TLS support has not yet been verified against a live Siebel server. Browser- and Siebel Client-specific APIs that are not exposed by the framework are unavailable to the debugger. Compatibility must be tested against the specific Siebel version and repository in use.

See the framework's [live-test status](sisnapi-framework/docs/live-test.md) and the project-specific documentation for the authoritative scope.

## Security

- Never commit credentials or place passwords in `.escript` files.
- Use the extension's connection manager; passwords are stored in VS Code SecretStorage.
- Supply framework credentials through a local secret manager or environment variables.
- Start with read-only operations and test write operations only in an isolated environment.
- Treat a timeout during a write as an unknown result; write requests are deliberately not retried automatically.

## License and trademarks

The VS Code extension is distributed under the [MIT License](escript-debugger/LICENSE). Oracle, Siebel, and related product names are trademarks of their respective owners. This repository is independent of and not endorsed or supported by Oracle.
