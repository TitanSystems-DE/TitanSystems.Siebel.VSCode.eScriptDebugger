# Live-Prüfung vom 24.09.2026

## Aktueller Stand: Hello und Sessionaufbau erfolgreich

Die zunächst bereitgestellte JAR war veraltet. Nach Austausch und Anpassung des Request-Headers funktioniert der echte TypeScript-Hello am angegebenen Endpunkt:

```json
{
  "protocolVersion": 131077,
  "translation": 3,
  "connectionId": -832570688,
  "muxSessions": 1,
  "muxConnections": 1,
  "minServiceProcesses": 1,
  "sessionEstablished": true
}
```

Translation 3 bedeutet UTF-16BE. Die Connection-ID gehört zur inzwischen geschlossenen Diagnoseverbindung. Die neue JAR schreibt ein zusätzliches int32 `whiteListedMethod` in jeden Request: Hello wächst von 104 auf 108 Bytes. Der neue TypeScript-Hello stimmt bytegenau mit dem TCP-Capture der neuen Java-Implementierung überein. Die erweiterten Logon-Felder sind ebenfalls implementiert und gegen neue Java-Fixtures getestet.

Die Prüfung mit `node examples/probe.mjs --session` war erfolgreich: Hello, SessionHello und anschließender SessionClose wurden vom realen Server bestätigt. Vollständiger Login und Objektaufrufe am echten Server sind noch offen. Zugangsdaten wurden nicht bereitgestellt. Die folgenden Befunde gelten ausschließlich für die **alte JAR** und sind kein aktueller Verbindungsblocker mehr.

## Historischer Stand mit der alten JAR

Ziel laut Nutzer: Siebel 26.5, `siebel://siebel.ttn-systems.de:2321/ENT/EAIObjMgr_enu`, keine Verschlüsselung.

| Prüfung | Ergebnis |
| --- | --- |
| DNS/TCP | Ziel aufgelöst; TCP-Verbindung konnte außerhalb der Sandbox aufgebaut werden |
| TypeScript Routing + Hello | Verbindung vor vollständiger Hello-Antwort geschlossen |
| Original-Java `Connection(new SISString(url), 10)` | Fehler `8716601` beim Lesen des ersten 4-Byte-Längenfelds |
| Java-Hello über lokalen TCP-Capture | Bytegleich zur TypeScript-Nachricht; als Regressionstest gespeichert |
| Benutzeranmeldung | Nicht ausgeführt; keine Credentials vorhanden |
| Reale BusComp-/Service-Aufrufe | Nicht ausgeführt |

Die mitgelieferte JAR enthält keine lokalisierten `SiebelJI_enu.jar`-Meldungen. Deshalb initialisiert das Java-Diagnoseprogramm den MessageManager und zeigt den numerischen Fehlercode an. Es verändert weder die JAR noch deren Transportcode.

Der Abbruch passiert vor einer Anmeldung. Die beobachteten Daten erlauben keine sichere Aussage, ob Routing/Enterprise-/Component-Konfiguration, SCBroker/Object-Manager-Verfügbarkeit, Netzwerkfilter oder Versionskompatibilität ursächlich sind. Der Endpunkt liefert keinen auswertbaren SISNAPI-NAK mit einer fachlichen Fehlermeldung.

Nächster Integrationstest: Mit lokal gesetzten Credentials `npm run test:live` ausführen und anschließend eine lesende Abfrage auf bekannte Repository-Objekte prüfen. Bei Fehlern mit einer funktionierenden Java-Verbindung und Server-/SCBroker-Logs vergleichen. Attach/Detach, Cancellation und TLS sind noch nicht live verifiziert.

Es wurden keine Passwörter, Geschäftsabfragen oder Schreiboperationen an den realen Server gesendet.
