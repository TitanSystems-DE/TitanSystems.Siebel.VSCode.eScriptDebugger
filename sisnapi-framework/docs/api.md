# API-Abdeckung

Alle exportierten Typen sind über `src/index.ts` bzw. die generierten `.d.ts` verfügbar. `Application` und `SiebelApplication` sind Aliase von `SiebelDataBean`; die Kurzformen `PropertySet`, `BusObject`, `BusComp`, `Service` sind ebenfalls exportiert.

| Klasse | Implementiert |
| --- | --- |
| SiebelDataBean | login, logoff, close, getSessionID, attach, attachEx, detach, cancelQuery, sendMsgAsync, sendExecuteQueryAsync, newPropertySet, getApplication, getBusObject, getService, invokeMethod, loginId, loginName, positionId, positionName, currencyCode, getProfileAttr, setProfileAttr, setPositionId, setPositionName, trace, traceOn, traceOff, getServerVersion, rpc |
| SiebelBusObject | name, getBusComp, release |
| SiebelBusComp | name, busObject, activateField, activateMultipleFields, deactivateFields, clearToQuery, executeQuery, executeQuery2, firstRecord, lastRecord, nextRecord, previousRecord, newRecord, writeRecord, deleteRecord, undoRecord, refineQuery, getFieldValue, setFieldValue, getFormattedFieldValue, setFormattedFieldValue, getMultipleFieldValues, setMultipleFieldValues, getSearchExpr, setSearchExpr, getSearchSpec, setSearchSpec, getSortSpec, setSortSpec, getNamedSearch, setNamedSearch, getViewMode, setViewMode, getUserProperty, setUserProperty, invokeMethod, getPicklistBusComp, getMVGBusComp, getAssocBusComp, parentBusComp, pick, associate, release |
| SiebelService | getName, invokeMethod, getFirstProperty, getNextProperty, getProperty, setProperty, removeProperty, propertyExists, release |
| SiebelPropertySet | Konstruktor, getType/setType, getValue/setValue, getByteValue/setByteValue, isStringValue, getProperty/setProperty, propertyExists, removeProperty, getPropertyCount, getPropertyNames, getFirstProperty/getNextProperty, entries, addChild, insertChildAt, getChild, getChildCount, removeChild, reset, copy, encodeAsString, decodeFromString, fromString |
| SisnapiConnection | probe, login, rpc, logoff, getSessionID, attach, detach, cancelQuery, close, connected; Events notification, disconnect |

`getFieldValue` liefert einen Promise für den lokalen, durch Server-Notifications aktualisierten Wert. PropertySet-Methoden, Namen, `getViewMode`, lokale BusComp-UserProperties und `deactivateFields` sind synchron. Service-Properties laden ihre Repository-Definition beim ersten Zugriff; Änderungen daran sind wie im Java-Client lokal und ändern nicht das Siebel-Repository.

`nextRecord` gibt beim bekannten Ende-Fehler `7668105` false zurück, `previousRecord` beim Anfangsfehler `7668076`. Andere Fehler bleiben Exceptions. Fehlende optionale Stringwerte werden als leerer String dargestellt. `parentBusComp` kann null liefern.

`release` ist asynchron und Fehler werden nicht wie im Java-Finalizer verschluckt. Nach Logoff/Verbindungsabbruch werden alte Objektreferenzen ungültig, auch wenn später neu angemeldet wird. `close` beendet nur die Verbindung; geordnetes Abmelden erfolgt über `await logoff(...)`.

Nicht zum API-Umfang gehören PropertySet-Dateireferenzen, Streaming/DataHandler, SessionToken-Textformate, Java-Serialisierung und UI-Notification-Callbacks. Java-UI-, JCA-, JMS-, Servlet- und Codegenerator-Schnittstellen sind ebenfalls nicht Bestandteil der TypeScript-API.

## Session-Erweiterungen

`login(url, user, password, language?, options?)` akzeptiert als fünften Parameter `{ sweFragment?, sessionTimeout?, debugData? }`. Alternativ wird die kompatible Parameterreihenfolge `login(url, user, password, language, sweFragment, sessionTimeout, debugData)` unterstützt. Sessiontimeout ist in Sekunden, `ConnectionOptions.requestTimeout` in Millisekunden. `language` wird nicht als Logon-Feld übertragen; den OM wählt die URL aus.

`getSessionID()` liefert den Session-Handle. `await detach()` gibt ihn ebenfalls zurück und beendet den lokalen Transport. Mit `await attach(handle)` oder `await attachEx(handle)` lässt sich die Sitzung übernehmen; attach setzt zusätzlich das Java-Startup-Flag `bAttach`. Alte BO-/BC-/Service-Referenzen bleiben ungültig und müssen neu beschafft werden. Session-Handles ermöglichen Sitzungszugriff und sollten wie Zugangsdaten behandelt werden.

`cancelQuery(requestId = -1)` verwendet einen zusätzlichen Transport zur vorhandenen Sitzung, damit ein wartender Haupt-RPC den Abbruch nicht blockiert. `sendMsgAsync(args)` sendet RPC510 und liefert `returnArgs`; `sendExecuteQueryAsync(args, code)` liefert `outputArgs` des angegebenen RPC. Beide nehmen die exportierte `Args`-Map und liefern Promises.

Service-Aufrufe übernehmen Input-Property `WLM=T` in das Whitelist-Argument. Das Overload `invokeMethod(method, input, output, encoded)` liest `#INOPENINT` und setzt bei `encoded=true` die Antwort in `#OUTOPENINT`. Der Sonderpfad `SWSECmd=SWSECancelQuery` wird unterstützt.

`rpc(code, objectType, objectId, args)` und der Export `ts-sisnapi/protocol` erlauben zusätzliche Protokollaufrufe. Die Objektarten und Argumenttypen sind Protokollwerte; beliebige Methodennamen werden nicht automatisch auf erfundene RPC-Codes abgebildet.
