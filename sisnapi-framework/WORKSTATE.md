# Arbeitsstand – 24.09.2026

Die Pause wurde durch den Auftrag „lade den letzten Arbeitsstand … Finalisiere bitte die SISNAPI Implementierung“ aufgehoben. Version 0.1.0 wurde für den dokumentierten Umfang fertiggestellt und lokal paketiert. Keine Veröffentlichung und kein Git-Commit; hier ist kein Git-Repository eingerichtet.

## Ziel und Referenz

Native TypeScript-/Node.js-Bibliothek ohne Java zur Laufzeit, einschließlich Application/DataBean, PropertySet, BusObject, BusComp und Service.

- Nutzerziel: Siebel 26.5, keine Verschlüsselung.
- Endpunkt: siebel://siebel.ttn-systems.de:2321/ENT/EAIObjMgr_enu
- Keine Credentials erhalten; kein authentifizierter Live-Login und keine Geschäftsoperation ausgeführt.
- Workspace: C:\codex\ts-sisnapi, PowerShell, Node22.18.0/npm10.9.3.
- Maßgebliche Siebel.jar: 1406324 Bytes, SHA256 A083007FD4A30F3CE0AA1A68F968496672BFECFFCB4F8332C22DBCEB58A8DDB1.
- Eine zuerst verwendete Clientversion war mit dem Zielsystem nicht kompatibel.

## Implementiert

- src/protocol.ts: Big-Endian-Framing, ArgList/FieldSpec/ObjectSpec/NotifySpec, UTF8/UTF16BE/ASCII, Zlib, lineare TCP-Reassembly, Größen- und Rekursionslimits.
- src/connection.ts: Routing, Hello, SessionHello, Logon, RPC, Logoff/SessionClose, Attach/Detach, Session-Handles, Cancellation über separaten Transport, optionales TLS-Upgrade nach Hello. Lebensdauer-/Race-Schutz, Timeouts ohne Replay, Schließen angelegter Sitzung bei abgelehntem Logon.
- src/databean.ts: Application/DataBean, BusObject, BusComp mit Query/CRUD/Cursor/Picklist/MVG/Association, Profile, Services, Notifications und Feldpool, Objektlebensdauer; sendMsgAsync/sendExecuteQueryAsync, attach/attachEx/detach, cancelQuery, Login-Erweiterungen, Service-WLM und #INOPENINT/#OUTOPENINT.
- src/property-set.ts: verschachtelte PropertySets, Text und Binärwerte, Kopien und aktuelles @-Format.
- src/index.ts: öffentliche Exporte; dist enthält JavaScript, Declaration-Dateien und Source Maps mit TypeScript-Quellen.
- examples/probe.mjs: Hello, mit --session zusätzlich SessionHello/SessionClose. examples/connect.mjs: Login aus Prozessumgebung und optional lesende Abfrage.
- README.md, docs/api.md, docs/protocol.md und docs/live-test.md beschreiben Nutzung, Abdeckung und Analyse.

## Verifikation

Zuletzt npm test: **19 Tests bestanden**, keine Fehler.

- Bytevergleiche gegen ausgeführte aktuelle JAR: Hello (auch TCP-Capture), SessionHello, Logon UTF8/UTF16BE, Logoff/Close, ArgList, PropertySet, Whitelist und Cancel-Request.
- Lokale TCP-Integration: vollständige Anmeldung, StartupState, Notifications, Query/CRUD/Cursor/Service, Translation3/4, Kompression, fragmentierte/zusammengefasste Frames und Limits.
- Neue Tests: Login-Zusatzfelder, Attach/Detach/AttachEx und Routing, alte Objektreferenzen, Service-Properties/Whitelist/encoded Overload/Async-APIs, Abbruch während wartendem RPC über separate Verbindung, Hello-NAK, falsche Antwortsequenz, Sessionprobe, Wiederanmeldung nach Abbruch, SessionClose nach abgelehntem Logon.
- **Echter Server:** node examples/probe.mjs --session erfolgreich. Hello + SessionHello + SessionClose bestätigt; Protokoll131077, Translation3, ConnectionId -832570688, MuxSessions/MuxConnections/MinServiceProcesses jeweils1. Diagnoseverbindung geschlossen. Keine Credentials oder Geschäftsdaten gesendet.
- npm pack erfolgreich: ts-sisnapi-0.1.0.tgz, 23 Dateien, 55199 Bytes. Enthält nur dist, README, docs und package.json; keine proprietären Oracle-Bibliotheken.
- Archiv unter .research/package-smoke/node_modules/ts-sisnapi extrahiert. Separates Consumer-Paket mit TypeScript strict/NodeNext kompiliert und unter Node ausgeführt: Root-Exports, Protocol-Subpath, Typen, PropertySet-Unicode-Roundtrip erfolgreich. Consumer muss eigene package.json haben, damit nicht das Self-Reference-Export des Workspace aufgelöst wird.

## Offene echte Integration und bewusste Grenzen

Implementierung für den dokumentierten Umfang steht; **Produktionskompatibilität noch nicht vollständig nachgewiesen**. Als Nächstes mit lokal gesetzten SIEBEL_USER/SIEBEL_PASSWORD `npm run test:live` ausführen. Für eine bekannte lesende Abfrage optional SIEBEL_BUS_OBJECT, SIEBEL_BUS_COMP und SIEBEL_SEARCH_EXPR setzen. Zugangsdaten nicht in Dateien oder Logs speichern. Bei Problemen echte Java-Verbindung und Serverlogs vergleichen.

Login und fachliche Serveraufrufe, Attach/Detach/Cancellation und TLS sind am Zielserver noch nicht authentifiziert/live geprüft. Keine schreibenden Live-Tests ohne definierten Testdatensatz.

Nicht enthalten: RSA/RC4/MSCRYPTO, PKWARE, HTTP-Tunneling, virtuelle Serverlisten, Pooling/Failover; PropertySet-Dateireferenzen, Streaming/DataHandler, Altdarstellung und SessionToken-Textdarstellung; vollständige lokale Locale-/Datentypformatierung; UI-/JCA-/JMS-/Servlet-/Codegenerator-Schnittstellen. Formatierte Feldzugriffe delegieren an den Server.

## Referenztools und Wireformat

- test/java/Golden.java erzeugt test/fixtures aus aktueller JAR (inkl. whitelist.bin/cancel.bin).
- test/java/Probe.java prüft Java-Hello und initialisiert CSSMsgMgr trotz fehlender lokalisierter Meldungs-JAR, um Fehlercodes zu erhalten.
- test/capture-java-hello.mjs zeichnet Java-Hello lokal auf; danach wird Socket absichtlich geschlossen, Java-Exception ist dabei erwartbar.
- JDK21 unter D:\Programme\JetBrains\IntelliJ\IntelliJ IDEA Community Edition 2024.2.0.1\jbr\bin; Java im PATH ist Java8.
- javac --release 8 -Xlint:-options -encoding UTF-8 -cp Siebel.jar -d .research/classes test/java/Golden.java test/java/Probe.java
- PowerShell: Argument '-Dfile.encoding=UTF-8' und Classpath 'Siebel.jar;.research/classes' quoten.

Wichtige Wire-Eigenheiten: Transport48 + Message12 + Request16 Bytes. Zusätzliches Whitelist-int32 bei Offset72; Body ab76, RPC-Args ab88, Hello108 Bytes. Gleiche Protokollnummer wie alte JAR trotz verändertem Layout. SessionHello/Close haben wie Java inneres BodyLength0. Logon endet mit clientSessionType, clientType JAVA, debugData. Nach SessionHello TaskId statt ConnectionId verwenden. Translation3 UTF16BE mit ausgehendem Nullzeichen; PropertySet-Längen sind UTF16-Codeunits. FieldIndexList/Notification10 referenzieren globale Feldindizes. Creation-Notifications erst nach Feld-/Objektregistrierung anwenden. RPC1001 setzt RequestType401 Bit31 und requestId Arg-Typ13. WLM=T setzt Whitelist1.

logoff() setzt wie Java Commit=true; logoff(false) setzt es nicht und ist kein allgemeines Rollback. RPCs seriell; Cancellation nutzt separaten Transport. Alte Handles nach Sitzungsende ungültig. Kein Replay nach Timeout.

## Umgebung

Netzwerkzugriff und npm-Standardcache außerhalb Workspace sind sandboxbeschränkt. Live-Probe und npm pack wurden nach Freigabe ausgeführt. Keine weiteren Freigaben ohne konkreten Bedarf einholen. Keine Subagenten verwenden, sofern nicht ausdrücklich angefordert. Kein git im PATH oder am früher vermuteten Pfad. Dateien mit Get-Content -Encoding UTF8 lesen.
