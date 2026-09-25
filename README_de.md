[🇬🇧 English](README.md) | 🇩🇪 **Deutsch**

# Siebel eScript Debugger & TypeScript SISNAPI

Dieses Repository vereint einen Visual-Studio-Code-Debugger für Siebel eScript mit dem nativen TypeScript-SISNAPI-Client, der die Serverkommunikation übernimmt. Zusammen ermöglichen beide Projekte, `.escript`-Dateien direkt in VS Code auszuführen, zu untersuchen und zu debuggen – ohne Java oder proprietäre Oracle-Clientbibliotheken zur Laufzeit.

> [!WARNING]
> **Experimentelle Software:** Beide Projekte befinden sich in einem frühen Entwicklungsstadium und werden ohne Gewährleistung oder Funktionsgarantie bereitgestellt. Verwende sie nicht in produktiven Siebel-Umgebungen. Nutze abgesicherte Entwicklungs- oder Testsysteme, Konten mit minimalen Berechtigungen, geeignete Testdaten und aktuelle Sicherungen. Skripte und API-Aufrufe können Daten lesen, verändern oder löschen. Dies ist ein unabhängiges Projekt und kein offizielles Oracle-Produkt.

## Projekte

| Projekt | Aufgabe | Details |
| --- | --- | --- |
| [`escript-debugger`](escript-debugger/) | VS-Code-Extension zum Ausführen und Debuggen von Siebel-`.escript`-Dateien | [Benutzerhandbuch](escript-debugger/README_de.md) · [Technische Dokumentation](escript-debugger/TECHREADME_de.md) |
| [`sisnapi-framework`](sisnapi-framework/) | Nativer TypeScript-/Node.js-SISNAPI-Client mit asynchroner Siebel-DataBean-API | [Benutzerhandbuch](sisnapi-framework/README.md) · [Technische Dokumentation](sisnapi-framework/TECHREADME.md) |

Die Extension stellt die Entwicklungsoberfläche und eine synchrone Runtime-API im Stil von eScript bereit. Das Framework übernimmt den SISNAPI-Transport, Sitzungen, RPCs, PropertySets und Siebel-Business-Objekte. Beide Projekte sind getrennt aufgebaut, damit `ts-sisnapi` auch unabhängig in Node.js-Anwendungen eingesetzt werden kann.

## Siebel eScript Debugger

Die VS-Code-Extension macht `.escript`-Dateien direkt gegen einen Siebel Server debuggbar:

- übliche VS-Code-Funktionen wie Breakpoints, Einzelschritte, Variablenansicht, Call Stack und Debug-Konsole
- Standalone-Ausführung einzelner Skripte
- Service-Modus mit gemeinsam geladenen Skripten, direkten Einstiegspunkten und `InvokeMethod`
- Verbindungsprofile mit Kennwörtern im VS Code SecretStorage
- typisiertes ST eScript und Referenzparameter mit `&`
- synchrone APIs für `Application`, `BusObject`, `BusComp`, `Service` und `PropertySet`
- mitgelieferte Typdefinitionen für Linter, Type-Checker und weitere Entwicklungswerkzeuge

![Siebel eScript Debugger im Service-Modus](escript-debugger/docs/screenshots/service.png)

### Schnellstart

1. Installiere oder paketiere die Extension aus [`escript-debugger`](escript-debugger/).
2. Öffne eine `.escript`-Datei in VS Code.
3. Rufe **Siebel eScript: Manage Connections** auf und lege ein Verbindungsprofil an.
4. Öffne die Startzentrale über das Siebel-eScript-Icon oder mit **Siebel eScript: Open Debugger**.
5. Wähle Standalone- oder Service-Modus und starte das Skript mit oder ohne Debugger.

Mit `F5` wird die aktive `.escript`-Datei im Standalone-Modus gestartet. Das [vollständige Handbuch der Extension](escript-debugger/README_de.md) beschreibt das Laden von Services, Einstiegspunkte, Typdefinitionen, Konstanten und die Konfiguration per `launch.json`.

## TypeScript-SISNAPI-Framework

`ts-sisnapi` ist eine unabhängig entwickelte TypeScript-Implementierung für die interoperable Kommunikation mit Siebel über SISNAPI. Sie benötigt Node.js 22 oder neuer; Java und Oracle-Bibliotheken werden zur Laufzeit nicht benötigt.

Die Bibliothek bietet:

- Login, Logoff, Sitzungsverwaltung und serialisierte RPC-Ausführung
- `Application`, `SiebelPropertySet`, `SiebelBusObject`, `SiebelBusComp` und `SiebelService`
- Abfragen, Datensatzänderungen, Service-Aufrufe und Objektfreigabe
- TCP-Transport, optionale Zlib-Kompression und ausgewählte TLS-Modi
- verschachtelte PropertySets mit Properties, Text, Binärwerten und Kindelementen
- TypeScript-Deklarationen für die öffentliche API

Netzwerkoperationen sind asynchron und liefern Promises; lokale PropertySet-Operationen sind synchron.

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

Unterstützte Operationen und Protokolldetails sind in der [API-Abdeckung](sisnapi-framework/docs/api.md) und der [Protokollbeschreibung](sisnapi-framework/docs/protocol.md) dokumentiert.

## Build und Tests

Voraussetzungen:

- Node.js 22 oder neuer
- npm
- Visual Studio Code 1.95 oder neuer zum Ausführen der Extension

Zuerst das Framework bauen und testen:

```sh
cd sisnapi-framework
npm ci
npm test
npm pack
```

Anschließend die Extension bauen und testen:

```sh
cd ../escript-debugger
npm ci
npm test
```

Die Extension referenziert das lokal paketierte `ts-sisnapi`-Paket. Beim Build wird die Runtime-Abhängigkeit in die Ausgabe der Extension gebündelt.

## Aktueller Stand und Einschränkungen

Beide Pakete weisen derzeit Version `0.1.0` aus. Das Framework deckt den dokumentierten Protokoll- und DataBean-Umfang ab und enthält automatisierte Tests mit Referenzbytes, lokalen TCP-Sitzungen und Fehlerfällen. Hello, SessionHello und SessionClose wurden gegen einen Siebel-26.5-Endpunkt erprobt; ein vollständiger Login und reale Objektaufrufe müssen mit Zugangsdaten im Zielsystem noch validiert werden.

Zu den bekannten Einschränkungen zählen nicht unterstützte RSA/RC4- und MSCRYPTO-Modi, PKWARE-Kompression, HTTP-Tunneling, virtuelle Serverlisten, Connection-Pooling und automatisches Failover. TLS wurde noch nicht gegen einen echten Siebel-Server geprüft. Browser- und Siebel-Client-spezifische APIs, die das Framework nicht bereitstellt, stehen auch im Debugger nicht zur Verfügung. Die Kompatibilität muss gegen die jeweils verwendete Siebel-Version und das konkrete Repository geprüft werden.

Den verbindlichen Umfang beschreiben der [Live-Test-Status](sisnapi-framework/docs/live-test.md) und die projektspezifischen Dokumentationen.

## Sicherheit

- Speichere niemals Zugangsdaten im Repository oder in `.escript`-Dateien.
- Verwende die Verbindungsverwaltung der Extension; Kennwörter liegen im VS Code SecretStorage.
- Übergib Framework-Zugangsdaten über eine lokale Secret-Verwaltung oder Umgebungsvariablen.
- Beginne mit rein lesenden Operationen und teste Schreibzugriffe nur in einer isolierten Umgebung.
- Behandle Timeouts bei Schreibzugriffen als unbekanntes Ergebnis; Schreiboperationen werden bewusst nicht automatisch wiederholt.

## Lizenz und Marken

Die VS-Code-Extension wird unter der [MIT-Lizenz](escript-debugger/LICENSE) veröffentlicht. Oracle, Siebel und zugehörige Produktnamen sind Marken ihrer jeweiligen Inhaber. Dieses Repository ist unabhängig und wird von Oracle weder unterstützt noch empfohlen.
