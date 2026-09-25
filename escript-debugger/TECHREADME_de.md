[🇬🇧 English](TECHREADME.md) | 🇩🇪 **Deutsch**

# Technische Dokumentation

Dieses Dokument beschreibt Architektur, Laufzeitverhalten, Entwicklung, Tests und Paketierung des Siebel eScript Debuggers. Die Bedienung der Extension ist in der [`README_de.md`](README_de.md) beschrieben.

## Voraussetzungen

- Node.js 22 oder neuer
- npm
- eine kompatible VS-Code-Version ab `1.95`
- das lokale SISNAPI-Paket `../sisnapi-framework/ts-sisnapi-0.1.0.tgz`

## Projektstruktur

```text
escript-debugger/
├── src/
│   ├── extension.ts          Extension-Aktivierung und Debug-Konfiguration
│   ├── debugger-ui.ts        Webview und Service-Konfiguration
│   └── profiles.ts           Verbindungsprofile und SecretStorage
├── runtime/
│   ├── runner.mjs            Einstiegspunkt des Debug-Prozesses
│   ├── worker.mjs            asynchrone SISNAPI-Ausführung
│   ├── sync-bridge.mjs       synchrone Remote-Objekt-Fassade
│   ├── constants.mjs         globale eScript-Konstanten
│   ├── service-runtime.mjs   Planung der Service-Ladereihenfolge
│   ├── type-stripper.mjs     Verarbeitung von ST-eScript-Typen
│   └── reference-transformer.mjs
│                              Call-by-reference-Transformation
├── service-implementation.escript
├── assets/icon.png           Icon für VSIX und Extension-Ansicht
├── typings/
│   └── siebel-escript.d.ts   Ambient Runtime-Typdefinitionen
├── syntaxes/                 TextMate-Grammatik
├── scripts/build.mjs         Build und Bundling
└── test/bridge.test.mjs      Laufzeit- und Transformations-Tests
```

## Architektur

Die Extension besteht aus drei Laufzeitbereichen:

1. Der VS-Code-Extension-Host verwaltet GUI, Profile und Debug-Konfigurationen.
2. Der über den integrierten Node-Debugger gestartete `runner.mjs` lädt und führt eScript aus.
3. Ein Worker besitzt die SISNAPI-Verbindung und sämtliche Siebel-Objekte.

Der Runner muss eScript-Aufrufe synchron bereitstellen, während `ts-sisnapi` Promise-basiert arbeitet. `sync-bridge.mjs` sendet deshalb Operationen über einen `MessageChannel` an den Worker und wartet mit `Atomics.wait` auf das Ergebnis. Der Worker führt den asynchronen RPC aus, serialisiert das Ergebnis und weckt den Runner. Siebel-Objekte werden nicht zwischen Threads kopiert, sondern über numerische Handles als synchrone Proxies dargestellt.

PascalCase-Aufrufe wie `GetBusObject` werden an der Proxy-Grenze auf die camelCase-Methoden des TypeScript-Frameworks abgebildet.

Der Runner führt eScript bewusst als klassisches, nicht-striktes Skript aus, damit ältere `with (object)`-Anweisungen gültig bleiben. Remote-Siebel-Proxies melden die bekannte synchrone API bei der JavaScript-Namensauflösung, sodass unqualifizierte Aufrufe wie `with (bc) { FirstRecord(); }` funktionieren, ohne andere lokale oder globale Bezeichner abzufangen.

## Debug-Integration

Der Debug-Typ `escript` wird durch einen `DebugConfigurationProvider` auf eine Node-Launch-Konfiguration umgesetzt. Der integrierte JavaScript-Debugger startet `dist/runtime/runner.mjs`.

Jede Quelldatei wird über `vm.Script` mit ihrem realen Dateipfad als `filename` ausgeführt. Dadurch ordnet VS Code Breakpoints, Call-Stack-Einträge und Exceptions den ursprünglichen `.escript`-Dateien zu.

Die Verbindungsdaten werden für den gestarteten Prozess Base64-kodiert über `SIEBEL_ESCRIPT_CONNECTION` übertragen und unmittelbar nach dem Einlesen aus der Prozessumgebung entfernt. Das Kennwort wird im Extension-Host ausschließlich über `ExtensionContext.secrets` gespeichert.

## Webview und Activity Bar

Der View-Container `siebelEscript` wird über `viewsContainers.activitybar` registriert und verwendet `assets/sidebar-icon.svg` als monochromes Activity-Bar-Symbol. Darin stellt der Webview-View `siebelEscript.debugger` die kompakte Debug-Oberfläche bereit.

`DebuggerSidebarProvider` und der Befehl `escript.openDebugger` verwenden dieselbe Webview-Initialisierung. Die Oberfläche funktioniert daher sowohl in der Seitenleiste als auch als separates Panel. Lokale Ressourcen sind auf den `assets`-Ordner beschränkt; Skripte und Styles werden durch eine Nonce-basierte Content Security Policy geschützt.

## Standalone-Laufzeit

Im Standalone-Modus liest der Runner genau eine Datei. Vor der Ausführung werden Referenzsignaturen gesammelt, Referenzparameter transformiert und ST-eScript-Typannotationen verarbeitet. Anschließend wird das Ergebnis im VM-Kontext ausgeführt.

## Service-Laufzeit

`serviceScriptPlan` erstellt eine deterministische Liste der auszuführenden Dateien:

1. `dist/runtime/service-implementation.escript`
2. optional die im Zielordner gefundene `(declerations).escript`
3. alle übrigen `.escript`-Dateien des Zielordners, alphabetisch sortiert

Zunächst werden alle Quellen gelesen und gemeinsam auf Referenzsignaturen untersucht. Danach wird jede Datei in der oben genannten Reihenfolge im selben globalen VM-Kontext ausgeführt.

Bei `Direct` wird aus dem gewählten Dateinamen die Erweiterung entfernt und die entsprechende globale Funktion aufgerufen.

Bei `InvokeMethod` erzeugt der Runner über die synchrone Application-Fassade zwei PropertySets. Die GUI-Eingaben werden mit `SetProperty` in `SERV_INPUTS` geschrieben. Nach

```js
InvokeMethod(methodName, SERV_INPUTS, SERV_OUTPUTS);
```

iteriert der Runner über `GetFirstProperty` und `GetNextProperty`. Das Ergebnis wird als temporäre JSON-Datei übergeben. Der Extension-Host überwacht diese Datei, überträgt die Outputs an die Webview und entfernt sie anschließend.

## ST-eScript-Typverarbeitung

`type-stripper.mjs` enthält einen Lexer, der Strings, Kommentare, Template-Strings und reguläre Ausdrücke als nicht veränderbare Bereiche behandelt. Entfernt werden Typannotationen an:

- `var`-, `let`- und `const`-Deklarationen
- Funktionsparametern
- Funktionsrückgabewerten

Die Zeichen einer Typannotation werden durch Leerzeichen ersetzt. UTF-16-Länge, Zeilenumbrüche und Positionen der folgenden Quellzeilen bleiben damit erhalten. Doppelpunkte aus Objektliteralen, Labels und ternären Ausdrücken werden nicht als Typannotationen behandelt.

Die Verarbeitung erfolgt nur auf der im Speicher gehaltenen Kopie. Quelldateien werden nicht geschrieben.

## Referenzparameter

`reference-transformer.mjs` analysiert Funktionsdeklarationen auf Parameter der Form `&name`. Im Service-Modus geschieht dies über alle Quellen, bevor die erste Datei ausgeführt wird.

Aufrufargumente für Referenzpositionen werden in Getter-/Setter-Zellen umgewandelt. Eine Funktion mit Referenzparametern erhält einen generierten Prolog und einen `try/finally`-Epilog:

- Der Prolog entpackt den aktuellen Wert in den normalen Parameter.
- Der originale Funktionskörper arbeitet mit einer gewöhnlichen lokalen Variable.
- Der `finally`-Block schreibt den Endwert in die Referenzzelle zurück.

Dadurch erfolgt das Rückschreiben auch bei `return` und Exceptions. Die Transformation fügt keine Zeilenumbrüche hinzu. Dynamisch über einen String aufgelöste Funktionsnamen können nicht statisch transformiert werden.

## Cursor-Konstanten

eScript verwendet für `ForwardBackward` und `ForwardOnly` die Werte `256` und `257`. Die DataBean-kompatible SISNAPI-API erwartet `0` und `1`. `worker.mjs` normalisiert diese Werte an der Methoden-Grenze für `ExecuteQuery` und `ExecuteQuery2`.

## Ambient Typdefinitionen

`typings/siebel-escript.d.ts` beschreibt die synchrone, in Skripten sichtbare API. Sie darf deshalb nicht direkt aus den Promise-Rückgabetypen von `ts-sisnapi` abgeleitet werden. Die Datei enthält keine Imports oder Exports und bleibt damit ein ambient Script. Die Interfaces `Application`, `BusObject`, `BusComp`, `Service`, `PropertySet` und `ClibRuntime` können in Projektdateien über Declaration Merging erweitert werden.

Der Befehl `escript.installTypings` kopiert die Datei auf ausdrücklichen Benutzerwunsch nach `.vscode/typings/siebel-escript.d.ts`. Vor dem Überschreiben einer bestehenden Datei wird eine modale Bestätigung angefordert.

## Build

Abhängigkeiten installieren:

```powershell
npm install
```

TypeScript prüfen und Laufzeitdateien erzeugen:

```powershell
npm run build
```

Der Build führt `tsc --noEmit` zur Typprüfung aus. Anschließend bündelt `esbuild` den Extension-Host und den Worker einschließlich `ts-sisnapi`. Die übrigen Runtime-Dateien und `service-implementation.escript` werden nach `dist/runtime` kopiert.

Für eine fortlaufende TypeScript-Prüfung steht zur Verfügung:

```powershell
npm run watch
```

## Tests

Build und Tests gemeinsam ausführen:

```powershell
npm test
```

Die Tests prüfen derzeit unter anderem:

- PascalCase-Proxy und Objekt-Handles
- vollständigen Konstantensatz
- Service-Ladereihenfolge
- positionsstabile Typverarbeitung
- Schutz von Strings, Kommentaren und regulären Ausdrücken
- Referenzparameter und Rückschreiben
- dateiübergreifende Referenzsignaturen

Ein echter SISNAPI-Login ist kein Bestandteil der automatisierten Tests und benötigt Zugang zu einem passenden Siebel-System.

## VSIX erzeugen

Eine installierbare Extension wird mit `@vscode/vsce` erstellt:

```powershell
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
```

`--no-dependencies` ist hier vorgesehen, weil `ts-sisnapi` bereits durch `esbuild` in Extension und Worker gebündelt wird. Das erzeugte Paket heißt entsprechend der aktuellen Version beispielsweise `siebel-escript-debugger-0.3.0.vsix`.

## Änderungen an der allgemeinen Service-Implementierung

`service-implementation.escript` ist eine normale Quelldatei im Projekt. Der Build kopiert sie nach `dist/runtime`. Änderungen werden daher erst nach einem erneuten Build beziehungsweise vor dem Verpacken der VSIX wirksam.
