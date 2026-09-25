# SISNAPI-Protokoll dieser Implementierung

## Grundlage und Versionsbindung

Die Bibliothek implementiert das für die Kommunikation mit dem Zielsystem erforderliche Wire-Protokoll unmittelbar mit Node.js-Primitiven. Sie verwendet eine eigene Codec-, Transport- und Objektproxy-Architektur und benötigt keine Oracle-Clientbibliothek. Zielsystem der bisherigen Kompatibilitätsprüfung ist Siebel 26.5.

Die Protokollnummer 131077 allein identifiziert nicht das vollständige Wireformat: Beobachtete Clientversionen verwenden unter derselben Nummer unterschiedliche Requestheader. Es gibt deshalb keinen automatischen Fallback auf ältere Varianten.

## Verbindungsablauf

1. TCP-Verbindung zum angegebenen SCBroker-/Object-Manager-Endpunkt.
2. Einmaliger ASCII/UTF8-Routing-Vorspann und Hello101:

   ```text
   POST http://host:port/enterprise/component HTTP/1.1\r\n
   Content-Type: application/octet-stream\r\n
   Content-Length: 108\r\n
   \r\n
   <binärer Hello-Frame>
   ```

3. Binäres Hello-ACK lesen. Die Antwort ist keine HTTP-Antwort. Hello liefert ConnectionId, Protokollversion, Schlüssel, String, Translation sowie Multiplexing-Parameter.
4. Bei `siebel.ssl`/`siebel.tls`: vorhandenen Socket auf TLS upgraden. Standardmäßig mindestens TLS1.3 und Zertifikats-/Hostnamenprüfung. Kein direkter TLS-Handshake vor Hello.
5. SessionHello1101 mit Version1 und Sessiontimeout in Sekunden (Standard2700). Hier ist die Session-ID zunächst die Hello-ConnectionId.
6. SessionHello-ACK enthält ProcessId, TaskId, Timestamp, ServerId. Ab jetzt ist die Session-ID in Requests die TaskId.
7. Logon102 mit Credentials und Clientmerkmalen. Anschließend Object-Manager-RPC401.
8. Geordnetes Abmelden: Logoff103 mit Commit-Flag, danach SessionClose1102. Bei abgelehntem Login wird eine bereits angelegte Sitzung ebenfalls geschlossen.

Hello-Body: int32 Protokoll131077, Facility0, leeres Bytefeld für ClientKey, Compression0/16, Services8, ServiceProtocol0, Codepage65001, int32 Null. Das ergibt mit den Headern108 Bytes.

Logon-Body: Strings Instance(null), Username, Password; int32 Service4, Anonymous0, MsConnection1, Version0; Strings ClientSessionType(leer oder SWEFragment), ClientType(JAVA), DebugData(null oder expliziter Wert). Der `language`-Parameter der DataBean-Java-API dient dort Meldungen; er wird nicht als Logon-Feld übertragen. Die Sprache des OM wird über den Component-Namen ausgewählt.

## Framing

Alle Integer sind 32 Bit, Big Endian. Offsets beziehen sich auf den Frame einschließlich Längenpräfix.

| Offset | Bytes | Bedeutung |
| --- | --- | --- |
| 0 | 4 | Gesamtlänge minus4 |
| 4 | 4 | Transportflags: 0 oder Zlib0x10 |
| 8 | 4 | Transportversion1 |
| 12 | 4 | Sequenznummer |
| 16 | 4 | Connection-/TaskId |
| 20 | 4 | äußerer Nachrichtentyp |
| 24 | 4 | TrailerOffset; beim Client Payloadlänge nach Byte48 |
| 28 | 4 | TrailerLength; beim Client0 |
| 32 | 16 | reserviert, Client0 |
| 48 | 4 | innerer Nachrichtentyp: Request1, ACK2, NAK3, Notify5 |
| 52 | 4 | Messageheader-Länge12 |
| 56 | 4 | innerer BodyLength |
| 60 | variabel | Nachrichtendaten |

Bei Zlib wird der gesamte Bereich ab48 komprimiert, einschließlich Messageheader. Das 4-Byte-Längenpräfix bleibt unkomprimiert und beschreibt die tatsächlich übertragenen Bytes. Der Client komprimiert optional ab einer unkomprimierten Framelänge von100 Bytes; Hello bleibt unkomprimiert.

Requestdaten ab60: RequestType, SessionId, Sequence, **WhiteListedMethod**, danach requestspezifische Daten ab76. RequestTypes101/102/103/401/1101/1102 sind implementiert. Für RPC1001 trägt RequestType401 zusätzlich Bit31. `WLM=T` als ArgList-String setzt WhiteListedMethod1; sonst0.

ACK-Daten ab60: RequestId (=Clientsequenz), RequestType, dann spezifischer Inhalt ab68. Es gibt kein Whitelist-Feld in ACKs. NAK-Daten: RequestId, Fehlerliste. RPC-ACK: ArgList, Fehlerliste. Fehlerliste: Count, je Fehler int32 ignoriert, int32 Fehlercode, String Meldung, int32 ignoriert.

Bei SessionHello und SessionClose bleibt das innere BodyLength-Feld protokollbedingt 0. Der äußere Frame enthält trotzdem die vollständige Länge.

## Primitive und Argumente

Bytefelder: int32 Bytezahl, danach exakt diese Bytes; Länge0 entspricht null/leer. Negative Längen und unvollständige Daten werden abgelehnt. Bool ist int32(0/1).

Translation1 verwendet hier UTF8, passend zur explizit angebotenen Codepage65001. Translation2 ist ASCII (nicht darstellbare ausgehende Zeichen werden abgelehnt). Translation3 ist UTF16BE: ausgehend mit abschließendem Nullzeichen; beim Lesen wird ein abschließendes Nullzeichen entfernt. Translation4 ist UTF8 ohne zusätzliches Nullzeichen. Ein Hello-NAK vor Aushandlung wird wie Java als Translation3 gelesen.

Argumentliste: Count, wiederholt String Name, int32 Typ und typabhängiger Wert. Namen sind case-sensitive; die Reihenfolge ist fachlich nicht relevant.

| Typ | Wert |
| --- | --- |
| 1 | String |
| 2 | int32, auch Bool |
| 4 | Bytefeld |
| 5/6/12 | int32 Referenz auf BusObject/BusComp/Service |
| 7 | Count + ObjectSpecs(Name, Type, Id) |
| 8 | Count + FieldSpecs |
| 9 | Count + Strings |
| 10 | Count + NotifySpecs, nur empfangend |
| 11 | rekursive ArgList |
| 13 | int32 Request-ID |

FieldSpec: Name, DisplayName, DataType; sieben bool/int32 für Calculated, CaseInsensitive, HasPickList, Hidden, MultiValued, ReadOnly, Required; Scale, TextLength; CurrencyCodeField, ExchangeDateField.

NotifySpec: ActiveRow, BegRow, Flag1, Flag2, BusCompId, CurrRow, FieldName, Index, IntValue, NotifyId, NotifyType; Stringarray Values, Stringarray ErrorFields, FieldSpecarray Fields; Size.

## Objekt-RPCs und Zustand

ObjectType0/Id0 adressiert die Application, Type5 BusObject, Type6 BusComp, Type12 Service. RPC-Codes sind nicht gleich RequestTypes: alle folgenden Aufrufe verwenden äußeren Request401.

| RPC | Funktion / wichtige Argumente |
| --- | --- |
| 1 | Objekt erzeugen: busObjName (Type5/Id0), busCompName (Type5/BusObjectId), verwandtes BC über mode/fieldName/bParm |
| 5 | Service: serviceName, bRequestedByEL |
| 18 | Sitzung detach |
| 201 | Query ausführen: bDeactivateFields, bForwardOnly, bSetupOnly, bIgnoreMaxCursorSize |
| 202–205 | First/Last/Next/Previous |
| 206/211 | New/Copy: bInsertBefore |
| 207 | Delete: bDefer |
| 209 | Feldwerte setzen: fieldNameList, valueList |
| 210 | WriteRecord |
| 300/351 | Einzelne/mehrere Felder aktivieren |
| 301/329 | Associate/Pick |
| 303 | RefineQuery |
| 312/354 | Formatierte Feldwerte lesen/schreiben |
| 315/318/319 | NamedSearch/SearchSpec/SortSpec lesen |
| 324 | BC invokeMethod: methodName, parameterArray |
| 332/403/600 | BC/BO/Service freigeben |
| 341–344 | NamedSearch/SearchSpec/SortSpec/ViewMode setzen |
| 348 | UndoRecord |
| 352/353 | Mehrere Feldwerte lesen/schreiben, PropertySet als inputArgs/outputArgs |
| 501 | StartupState mit SISNSIOMVersion203 und localeProfile |
| 505/506/510 | ServerVersion/Application.invokeMethod/sendMsgAsync |
| 511/512 | PositionId/PositionName setzen |
| 603 | Service invokeMethod: methodName, inputArgs; Antwort outputArgs |
| 702/703 | Profilattribut lesen/schreiben: Name, Value |
| 1001 | Query abbrechen: requestId Typ13, ObjectType0/Id0 |

Felddefinitionen liegen in einem sitzungsweiten Pool. `newFieldList` erweitert ihn, `fieldIndexList` enthält globale numerische Indizes mit optionalen p/r-Präfixen. Notification10 enthält ebenfalls solche Indizes und legt die Reihenfolge aktiver Felder fest. Zeilenwerte werden in dieser Reihenfolge geliefert. Neue Objekte und FieldSpecs müssen vor ihren Notifications registriert werden.

Die Implementierung verarbeitet BC-Notifications3(DeleteWorkSet),8(InsertWorkSet),10(ActiveFields),13(FieldData),14(FieldList),17(RecordData),23(Status) und aktualisiert ActiveRow. UI-Callbacks werden nicht nachgebildet. Fehlerfelder werden beim Lesen als Exceptions gemeldet.

## PropertySet

Service-PropertySets sind Text, nicht direkt ArgList. Format `@0*0*` gefolgt von rekursiven Knoten: PropertyCount, ChildCount, Type-String, Value-Variant, Properties als Name/Value-Paare, Kinder. Integer enden auf `*`; String = Länge + `*` + Inhalt. **Längen sind UTF16-Codeunits wie Java String.length/JavaScript string.length**, nicht UTF8-Bytes.

Geschrieben werden Value-Variant3(String) und2(Binärdaten: Bytezahl + Base64). Gelesen außerdem0(leer),1(Integer),4(Binär),5(binär mit verdoppelter deklarierter Länge),6(String). Leere Serviceausgabe ergibt ein leeres PropertySet. Nicht implementiert sind dateibasierte Varianten12/13, altes Format und spezielle SessionToken-Darstellung.

## Sessions und Fehlerverhalten

Session-Handle wie Java: `siebel://host:port/enterprise/component/!serverHex.processHex.taskHex.timestampHex`. Bei Attach oder einem zusätzlichen Cancellation-Transport enthält der Routing-Pfad nur `!serverHex.processHex`; der anschließende RPC verwendet die TaskId. Es wird dabei weder eine zweite Session angelegt noch erneut mit Passwort angemeldet. Application.attach lädt StartupState mit bAttach=true, attachEx ohne dieses Flag.

Normale RPCs sind pro Transport serialisiert. Cancellation verwendet einen gesonderten Transport zur bestehenden Sitzung und kann somit die wartende Hauptverbindung überholen. Er wird anschließend nur geschlossen, nicht ausgeloggt. Attach/Detach/Cancellation sind lokal getestet; serverseitige Rechte, Sessiongültigkeit und Multiplexing müssen im echten System passen.

Timeout oder Protokollverletzung schließt den betroffenen Transport; ausstehende Operationen schlagen fehl. Kein automatisches Wiederholen möglicherweise bereits ausgeführter Schreiboperationen. RPC-Fehler erhalten die Servercodes und lassen eine sonst intakte Sitzung offen. Alte Objekt-Handles werden nach Verbindungsende ungültig. Framegröße standardmäßig64MiB, Rekursion128; Fragment-Reassembly kopiert Bytes linear statt den gesamten Restpuffer bei jedem TCP-Fragment neu zusammenzusetzen.
