/**
 * Ambient runtime declarations for the Siebel eScript Debugger.
 *
 * This file intentionally has no imports or exports. Interfaces can be extended
 * in project-local .d.ts files through TypeScript declaration merging.
 */

interface Application {
  GetApplication(): Application;
  GetBusObject(name: string): BusObject;
  GetService(name: string): Service;
  NewPropertySet(): PropertySet;
  InvokeMethod(methodName: string, parameterArray?: string[]): string;
  GetProfileAttr(name: string): string;
  SetProfileAttr(name: string, value: string): boolean;
  GetServerVersion(): string;
  LoginId(): string;
  LoginName(): string;
  PositionId(): string;
  PositionName(): string;
  CurrencyCode(): string;
  SetPositionId(position: string): boolean;
  SetPositionName(position: string): boolean;
  Trace(message: string): boolean;
  TraceOn(fileName: string, category: string, source: string): boolean;
  TraceOff(): boolean;
  GetSessionID(): string;
  CancelQuery(requestId?: number): void;
}

interface BusObject {
  Name(): string;
  GetBusComp(name: string): BusComp;
  Release(): void;
}

interface BusComp {
  Name(): string;
  BusObject(): BusObject;
  ActivateField(fieldName: string): boolean;
  ActivateMultipleFields(input: PropertySet): boolean;
  DeactivateFields(): boolean;
  ClearToQuery(): boolean;
  SetSearchExpr(searchSpec: string): boolean;
  SetSearchSpec(fieldName: string, searchSpec: string): boolean;
  SetSortSpec(sortSpec: string): boolean;
  GetSearchExpr(): string;
  GetSearchSpec(fieldName: string): string;
  GetSortSpec(): string;
  SetViewMode(viewMode: number): boolean;
  GetViewMode(): number;
  ExecuteQuery(mode?: number | boolean): boolean;
  ExecuteQuery2(mode: number | boolean, ignoreMaxCursorSize: boolean): boolean;
  FirstRecord(): boolean;
  LastRecord(): boolean;
  NextRecord(): boolean;
  PreviousRecord(): boolean;
  GetFieldValue(fieldName: string): string;
  GetFormattedFieldValue(fieldName: string): string;
  SetFieldValue(fieldName: string, fieldValue: string): boolean;
  SetFormattedFieldValue(fieldName: string, fieldValue: string): boolean;
  GetMultipleFieldValues(input: PropertySet, output: PropertySet): boolean;
  SetMultipleFieldValues(input: PropertySet): boolean;
  NewRecord(position?: number | boolean): boolean;
  WriteRecord(): boolean;
  DeleteRecord(): boolean;
  UndoRecord(): boolean;
  RefineQuery(): boolean;
  SetNamedSearch(searchName: string, searchSpec: string): boolean;
  GetNamedSearch(searchName: string): string;
  GetUserProperty(name: string): string;
  SetUserProperty(name: string, value: string): boolean;
  InvokeMethod(methodName: string, parameterArray?: string[]): string;
  GetPicklistBusComp(fieldName: string): BusComp;
  GetMVGBusComp(fieldName: string): BusComp;
  GetAssocBusComp(): BusComp;
  ParentBusComp(): BusComp | null;
  Pick(): boolean;
  Associate(insertBefore?: boolean): boolean;
  Release(): void;
}

interface Service {
  GetName(): string;
  InvokeMethod(methodName: string, input: PropertySet): PropertySet;
  InvokeMethod(methodName: string, input: PropertySet, output: PropertySet): boolean;
  InvokeMethod(methodName: string, input: PropertySet, output: PropertySet, preserveEncodedOutput: boolean): boolean;
  GetFirstProperty(): string;
  GetNextProperty(): string;
  GetProperty(name: string): string;
  PropertyExists(name: string): boolean;
  SetProperty(name: string, value: string): void;
  RemoveProperty(name: string): void;
  Release(): void;
}

interface PropertySet {
  GetType(): string;
  SetType(value: string): boolean;
  GetValue(): string;
  SetValue(value: string): boolean;
  GetByteValue(): Uint8Array | undefined;
  SetByteValue(value: Uint8Array): void;
  IsStringValue(): boolean;
  SetProperty(name: string, value: string): boolean;
  GetProperty(name: string): string;
  PropertyExists(name: string): boolean;
  RemoveProperty(name: string): boolean;
  GetPropertyCount(): number;
  GetPropertyNames(): IterableIterator<string>;
  GetFirstProperty(): string;
  GetNextProperty(): string;
  Entries(): IterableIterator<[string, string]>;
  GetChildCount(): number;
  GetChild(index: number): PropertySet;
  AddChild(child: PropertySet): number;
  InsertChildAt(child: PropertySet, index: number): boolean;
  RemoveChild(index: number): boolean;
  Reset(): boolean;
  Copy(): PropertySet;
  Copy(source: PropertySet): void;
  EncodeAsString(): string;
  DecodeFromString(text: string): boolean;
}

interface ClibRuntime {
  WriteLn(value: unknown): void;
  puts(value: unknown): void;
  getenv(name: string): string;
  time(): number;
}

declare function TheApplication(): Application;
declare function Application(): Application;
declare function ToNumber(value: unknown): number;
declare function ToString(value: unknown): string;
declare const Clib: ClibRuntime;

/** Globals available while a Service runtime is active. */
declare var SERV_INPUTS: PropertySet;
declare var SERV_OUTPUTS: PropertySet;
declare function InvokeMethod(methodName: string, input: PropertySet, output: PropertySet): void;
declare function Name(): string;
declare function PropertyExists(name: string): boolean;
declare function RemoveProperty(name: string): void;
declare function SetProperty(name: string, value: string): void;
declare function GetProperty(name: string): string;
declare function GetFirstProperty(): string;
declare function GetNextProperty(): string;

declare const ContinueOperation: 1;
declare const CancelOperation: 2;
declare const OperationComplete: 2;
declare const ForwardBackward: 256;
declare const ForwardOnly: 257;
declare const NewBefore: 0;
declare const NewAfter: 1;
declare const NewBeforeCopy: 2;
declare const NewAfterCopy: 3;
declare const SalesRepView: 0;
declare const ManagerView: 1;
declare const PersonalView: 2;
declare const AllView: 3;
declare const NoneSetView: 4;
declare const NoneView: 4;
declare const NoneSetViewMode: 4;
declare const OrganizationView: 5;
declare const ContactView: 6;
declare const GroupView: 7;
declare const CatalogView: 8;
declare const SubOrganizationView: 9;
