# Siebel eScript Debugger

Dieses Repository enthält die Visual-Studio-Code-Extension **Siebel eScript Debugger**. Sie führt `.escript`-Dateien gegen einen Siebel Server aus und debuggt sie über die offizielle Oracle Siebel Java Data Bean.

Die Oracle-Bibliotheken werden nicht mit der Extension ausgeliefert. Jeder Benutzer stellt eine kompatible `Siebel.jar` und die zugehörigen Begleit-JARs, darunter `SiebelJI_<Sprache>.jar`, in einem zentralen lokalen Verzeichnis bereit.

## Voraussetzungen

Version 0.2.0 vergleicht die konfigurierte `Siebel.jar` mit dem SHA-256-Hash der für den Debugger verifizierten Version. Eine abweichende Version erzeugt einen Warnhinweis, blockiert die Ausführung jedoch nicht; Kompatibilität und korrekte Funktion können in diesem Fall nicht garantiert werden.

- Visual Studio Code ab Version 1.95
- Java 8 oder neuer
- Oracle `Siebel.jar` und die passende Sprach-JAR der eingesetzten Siebel-Installation
- Zugriff auf einen Siebel Object Manager

Unter `escriptDebugger.siebelJar` wird der absolute Pfad zur `Siebel.jar` eingetragen. Alle benötigten Begleit-JARs müssen im selben Verzeichnis liegen. Ist `java` nicht über `PATH` erreichbar, wird zusätzlich `escriptDebugger.javaPath` konfiguriert.

## Neuerungen in Version 0.3.0

- Mehrere lokal gespeicherte Business Services können in derselben Service-Modus-Sitzung debuggt werden. Der Ordner des ausgewählten Skripts ist der startende Service; seine Nachbarordner sind über `TheApplication().GetService()` verfügbar.
- Die Debugger-Oberfläche zeigt vor dem Start alle lokal verfügbaren Services an. Aufrufe ohne passenden lokalen Ordner werden weiterhin an Siebel geleitet.
- Über **Add Siebel Service** im Kontextmenü eines Explorer-Ordners wird ein neuer Service-Ordner aus den mitgelieferten Startskripten erstellt.

Das [Kapitel zum Service-Modus](escript-debugger/README_de.md#service-modus) beschreibt die benötigte Ordnerstruktur und den vollständigen Ablauf.

## Dokumentation

- [Benutzerhandbuch](escript-debugger/README_de.md)
- [Technische Dokumentation](escript-debugger/TECHREADME_de.md)

## Entwicklung

```powershell
cd escript-debugger
npm install
npm test
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
```

Die erzeugte VSIX-Datei enthält keine Oracle-JAR-Dateien.

Das Release-Archiv heißt `siebel-escript-dbger-0.3.0.vsix`.

## Lizenz

Die [TitanSystems Free-to-Use No-Derivatives License](escript-debugger/LICENSE) erlaubt die kostenlose Nutzung der unveränderten offiziellen Extension ausdrücklich auch für berufliche Tätigkeiten in kommerziellen Umgebungen. Änderungen sind ausschließlich zur Vorbereitung eines Beitrags zum offiziellen Projekt gestattet. Kommerzieller Vertrieb, inoffizielle veränderte Versionen und die Integration der Extension in andere Produkte benötigen eine vorherige schriftliche Zustimmung. Drittanbieterkomponenten bleiben ihren eigenen Lizenzen unterstellt.

Oracle, Siebel und zugehörige Namen sind Marken ihrer jeweiligen Inhaber. Dieses unabhängige Projekt wird von Oracle weder unterstützt noch empfohlen.
