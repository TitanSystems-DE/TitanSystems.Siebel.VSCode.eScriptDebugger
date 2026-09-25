# Technische Build- und Paketierungsanleitung

Diese Datei beschreibt, wie das Paket `ts-sisnapi` gebaut und als lokale
`.tgz`-Datei bereitgestellt wird. Das benachbarte Projekt
`../escript-debugger` verwendet genau dieses Archiv als Build-Abhängigkeit.

## Voraussetzungen

- Node.js 22 oder neuer
- npm
- ein Terminal im Verzeichnis `sisnapi-framework`

Die folgenden Beispiele verwenden PowerShell und gehen von der Struktur dieses
Repositories aus:

```text
TitanSystems.Siebel.VSCode.eScriptDebugger/
|-- sisnapi-framework/
`-- escript-debugger/
```

## Abhängigkeiten installieren

Für einen reproduzierbaren Build auf Basis von `package-lock.json`:

```powershell
Set-Location sisnapi-framework
npm ci
```

`npm ci` ersetzt ein vorhandenes `node_modules`-Verzeichnis. Während der
lokalen Entwicklung kann alternativ `npm install` verwendet werden.

## Framework bauen und testen

```powershell
npm test
```

`npm test` führt zuerst den TypeScript-Build und anschließend die automatischen
Tests aus. Nur den Build startet:

```powershell
npm run build
```

Der TypeScript-Compiler erzeugt in `dist/` die JavaScript-Dateien,
Source-Maps und TypeScript-Deklarationen. `dist/` ist Build-Ausgabe und wird
nicht von Hand gepflegt.

## `.tgz`-Paket erzeugen

Im Verzeichnis `sisnapi-framework` ausführen:

```powershell
npm pack
```

Vor dem Packen führt npm automatisch das Script `prepack` aus. Dadurch wird
`npm run build` erneut ausgeführt und das Archiv enthält den aktuellen Stand
aus `src/`.

Der Dateiname wird aus `name` und `version` in `package.json` gebildet. Bei
Version `0.1.0` entsteht im aktuellen Verzeichnis:

```text
ts-sisnapi-0.1.0.tgz
```

Über das Feld `files` in `package.json` ist der Paketinhalt auf `dist/`,
`README.md`, `docs/` und die von npm ergänzten Paketmetadaten begrenzt.
Quelltests, Beispiele, `node_modules` und proprietäre Oracle-Bibliotheken
werden nicht mitgeliefert.

Der vorgesehene Inhalt lässt sich ohne ein Archiv zu erzeugen kontrollieren:

```powershell
npm pack --dry-run
```

## Verwendung durch `escript-debugger`

Der Debugger referenziert das Archiv relativ in
`escript-debugger/package.json`:

```json
"ts-sisnapi": "file:../sisnapi-framework/ts-sisnapi-0.1.0.tgz"
```

Nach dem Erzeugen oder Ersetzen des Archivs werden die Abhängigkeiten des
Debuggers installiert und der Debugger geprüft:

```powershell
Set-Location ..\escript-debugger
npm install
npm test
```

`npm install` ist hier bewusst angegeben: Es aktualisiert bei Bedarf auch den
Eintrag und die Integritätsprüfung des lokalen Archivs in
`escript-debugger/package-lock.json`. Anschließend bündelt der Debugger-Build
`ts-sisnapi` über esbuild in seine Laufzeitdateien.

Falls npm trotz eines neu erzeugten Archivs noch eine zuvor installierte
Paketversion verwendet, kann das lokale Paket gezielt neu installiert werden:

```powershell
npm install ..\sisnapi-framework\ts-sisnapi-0.1.0.tgz
```

## Version ändern

Wenn die Version von `ts-sisnapi` geändert wird, ändert sich auch der Name des
Archivs. Danach müssen folgende Stellen denselben neuen Dateinamen verwenden:

1. `sisnapi-framework/package.json`: Feld `version`
2. `escript-debugger/package.json`: lokale `ts-sisnapi`-Abhängigkeit
3. `escript-debugger/package-lock.json`: durch `npm install` aktualisieren

Beispiel für Version `0.2.0`:

```powershell
Set-Location sisnapi-framework
npm version 0.2.0 --no-git-tag-version
npm test
npm pack

Set-Location ..\escript-debugger
# Zuvor die Abhängigkeit in package.json auf
# file:../sisnapi-framework/ts-sisnapi-0.2.0.tgz ändern.
npm install
npm test
```

## Kompletter Ablauf für Version `0.1.0`

Vom Repository-Stamm aus:

```powershell
Set-Location sisnapi-framework
npm ci
npm test
npm pack

Set-Location ..\escript-debugger
npm install
npm test
```

Nach diesem Ablauf liegt `sisnapi-framework/ts-sisnapi-0.1.0.tgz` vor und der
Debugger ist gegen genau dieses lokale Paket installiert, gebaut und getestet.
