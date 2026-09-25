# ts-sisnapi

Unabhängig geschriebene TypeScript-/Node.js-Bibliothek für die interoperable Kommunikation mit Siebel über SISNAPI. Zur Laufzeit werden weder Java noch Oracle-Bibliotheken benötigt. Die Bibliothek stellt `SiebelDataBean`/`Application`, `SiebelPropertySet`, `SiebelBusObject`, `SiebelBusComp` und `SiebelService` bereit.

**Status (24.09.2026):** Version 0.1.0 implementiert den unten dokumentierten Protokoll- und DataBean-Umfang. 19 Tests prüfen Java-Referenzbytes, lokale TCP-Sessions und Fehlerfälle. Hello, SessionHello und SessionClose funktionieren am angegebenen Siebel-26.5-Endpunkt. Ein vollständiger Login und reale Objektaufrufe sind noch **nicht** nachgewiesen; Zugangsdaten fehlen. Deshalb ist die Bibliothek bis zur Prüfung im Zielsystem als experimentell einzustufen. Details: [Live-Test](docs/live-test.md).

## Installation und Prüfung

Node.js 22 oder neuer:

```sh
npm ci
npm test
npm run build
```

In einem anderen lokalen Projekt: `npm install /pfad/zu/ts-sisnapi` nach dem Build. Für die Verteilung kann `npm pack` verwendet werden. Das Paket enthält ausschließlich `dist`, Dokumentation und Paketmetadaten; proprietäre Oracle-Bibliotheken werden weder benötigt noch mitgeliefert.

## Verbindung und Abfrage

```ts
import { Application, CursorMode, ViewMode } from 'ts-sisnapi';

const app = new Application({ requestTimeout: 30_000 });
try {
  await app.login(
    'siebel://siebel.ttn-systems.de:2321/ENT/EAIObjMgr_enu',
    process.env.SIEBEL_USER!,
    process.env.SIEBEL_PASSWORD!,
  );

  const bo = await app.getBusObject('Account');
  try {
    const bc = await bo.getBusComp('Account');
    await bc.activateField('Name');
    await bc.setViewMode(ViewMode.All);
    await bc.clearToQuery();
    await bc.setSearchSpec('Name', 'Acme*');
    await bc.executeQuery(CursorMode.ForwardOnly);

    if (await bc.firstRecord()) {
      do {
        console.log(await bc.getFieldValue('Name'));
      } while (await bc.nextRecord());
    }
  } finally {
    await bo.release();
  }
  await app.logoff(false);
} finally {
  app.close();
}
```

Objekt-, Komponenten- und Feldnamen müssen zu eurem Repository passen. `ViewMode.All` hebt keine serverseitigen Berechtigungen auf. Netzwerkoperationen liefern Promises; lokale PropertySet-Operationen sind synchron. Pro Sitzung werden RPCs serialisiert. Abhängige Cursoroperationen bitte nacheinander `await`en; eine mehrteilige Abfrage ist keine automatisch isolierte Transaktion.

## Business Service

```ts
const service = await app.getService('EAI Siebel Adapter');
try {
  const input = app.newPropertySet();
  input.setProperty('OutputIntObjectName', 'Account');
  input.setProperty('SearchSpec', "[Account.Name] = 'Acme'");

  const output = await service.invokeMethod('Query', input);
  console.log(output.getChildCount());

  // Auch die Java-Signatur wird unterstützt:
  const output2 = app.newPropertySet();
  await service.invokeMethod('Query', input, output2);
} finally {
  await service.release();
}
```

Die Integration-Object-Namen und die Service-Eingaben sind Beispiele und installationsabhängig.

## Schreiben

```ts
await bc.setFieldValue('Name', 'Neuer Name');
await bc.writeRecord();

// Weitere Methoden:
await bc.newRecord(false); // nach dem aktuellen Datensatz
await bc.setFieldValue('Name', 'Neuer Datensatz');
await bc.writeRecord();
```

`deleteRecord`, `undoRecord`, `setMultipleFieldValues`, Picklist-/MVG-/Association-BusComps und `invokeMethod` sind ebenfalls verfügbar. `logoff()` setzt wie Java das Commit-Flag; `logoff(false)` setzt es nicht. Bereits ausgeführte Serveroperationen werden dadurch nicht automatisch rückgängig gemacht. Nach Netzwerkfehlern werden Schreiboperationen nicht automatisch wiederholt: Bei einem Timeout kann das Ergebnis unbekannt sein.

## Eigener Server

Der Default in den Beispielen ist:

```text
siebel://siebel.ttn-systems.de:2321/ENT/EAIObjMgr_enu
```

`npm run probe` sendet nur Routing/Hello. `npm run probe -- --session` prüft zusätzlich SessionHello und SessionClose; beide Varianten benötigen keine Credentials. Für einen Login werden `SIEBEL_USER` und `SIEBEL_PASSWORD` aus der Prozessumgebung gelesen:

```powershell
$env:SIEBEL_URL = 'siebel://siebel.ttn-systems.de:2321/ENT/EAIObjMgr_enu'
# SIEBEL_USER und SIEBEL_PASSWORD über eure lokale Secret-Verwaltung setzen.
npm run test:live
```

Optional führen `SIEBEL_BUS_OBJECT`, `SIEBEL_BUS_COMP` und `SIEBEL_SEARCH_EXPR` eine lesende Beispielabfrage aus. Zugangsdaten werden vom Client nicht protokolliert.

## Transport und Grenzen

Implementiert sind TCP/IP ohne SISNAPI-Verschlüsselung, optionale Zlib-Kompression, UTF-8/UTF-16BE/ASCII, Session-Login/Logoff, Attach/Detach, Query-Abbruch über einen separaten Transport, RPCs, Fehler und BusComp-Benachrichtigungen. `siebel.ssl.none...` und `siebel.tls.none...` führen den TLS-Handshake **nach** dem SISNAPI-Hello aus; Zertifikatsprüfung bleibt aktiv, Mindestversion ist standardmäßig TLS 1.3. Eigene CAs und Clientzertifikate können über `ConnectionOptions.tls` übergeben werden. TLS wurde bisher nicht gegen einen echten Siebel-Server geprüft.

Nicht implementiert: RSA/RC4- und MSCRYPTO-Modi, PKWARE, HTTP-Tunneling, virtuelle Serverlisten, Connection-Pooling und automatische Umleitung/Failover.

PropertySets unterstützen verschachtelte Kinder, Properties, Text und Binärwerte im aktuellen `@`-Format. Dateireferenzen, Streaming/DataHandler und ältere PropertySet-Formate gehören nicht zum implementierten Umfang. Formatierte Feldzugriffe delegieren an den Server; eine lokale Locale-/Datentypformatierung ist nicht Bestandteil der Bibliothek. [API-Abdeckung](docs/api.md) und [Protokollbeschreibung](docs/protocol.md) beschreiben den Umfang.

Oracle weist darauf hin, dass DataBean-Clients zur jeweiligen Serverversion passen müssen: [Oracle: Accessing the Siebel Java Data Bean](https://docs.oracle.com/cd/G26828_01/books/OIRef/c-Accessing-the-Siebel-Java-Data-Bean-af1046167.html). Die Versionskompatibilität dieser unabhängigen Implementierung muss gegen das jeweilige Zielsystem geprüft werden.

## Lizenz- und Markenhinweise

Dieses Framework wird unter der [MIT-Lizenz](LICENSE) veröffentlicht. Oracle, Siebel und zugehörige Produktnamen sind Marken ihrer jeweiligen Inhaber. Dieses Framework ist eine unabhängig entwickelte Implementierung und wird von Oracle weder unterstützt noch empfohlen. Es ist kein offizielles Oracle-Produkt und enthält keine proprietären Oracle-Bibliotheken. Die MIT-Lizenz gilt ausschließlich für die Rechte, die TitanSystems an diesem Framework einräumen darf; durch seine Bereitstellung oder Nutzung werden keine Rechte an Software, Marken oder sonstigem geistigem Eigentum von Oracle eingeräumt. Für Oracle-Software gelten weiterhin die jeweils anwendbaren Oracle-Lizenzbedingungen.
