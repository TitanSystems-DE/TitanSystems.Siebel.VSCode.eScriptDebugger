import { SisnapiConnection, type ConnectionOptions, type LoginOptions } from './connection.js';
import { ProtocolError, SiebelException } from './errors.js';
import { SiebelPropertySet } from './property-set.js';
import { args, value, type Args, type FieldSpec, type Input, type NotifySpec } from './protocol.js';

export enum ViewMode { SalesRep = 0, Manager = 1, Personal = 2, All = 3, None = 4, Organization = 5, Contact = 6, Group = 7, Catalog = 8, SubOrganization = 9 }
export enum CursorMode { ForwardBackward = 0, ForwardOnly = 1 }
export enum NewRecordPosition { Before = 0, After = 1, BeforeCopy = 2, AfterCopy = 3 }
const text = (a: Args, name: string): string => value<string | null>(a, name) ?? '';

/** Application object, corresponding to Java SiebelDataBean. */
export class SiebelDataBean {
  readonly connection: SisnapiConnection;
  private generation = 0;
  private fields: FieldSpec[] = [];
  private components = new Map<number, SiebelBusComp>();
  private startup?: Promise<Args>;
  private attachFlag = false;
  constructor(options: ConnectionOptions = {}) {
    this.connection = new SisnapiConnection(options);
    this.connection.on('rpcResult', (result: Args, rpc: { code: number; hasErrors: boolean }) => {
      // Creation responses must install global field definitions and object IDs
      // before any notification in the response is applied.
      if (rpc.code !== 1 || rpc.hasErrors) this.processNotifications(result);
    });
    this.connection.on('disconnect', () => { this.generation++; this.components.clear(); this.fields = []; this.startup = undefined; });
  }
  async login(url: string, username: string, password: string, _language = 'enu', sweFragment: boolean | LoginOptions = false, sessionTimeout = -1, debugData: string | null = null): Promise<boolean> {
    const options: LoginOptions = typeof sweFragment === 'object' ? sweFragment : { sweFragment, sessionTimeout: sessionTimeout > 0 ? sessionTimeout : undefined, debugData };
    await this.connection.login(url, username, password, options); this.attachFlag = false; return true;
  }
  getSessionID(): string { return this.connection.getSessionID(); }
  async detach(): Promise<string> { return this.connection.detach(); }
  async attach(handle: string): Promise<boolean> { return this.attachSession(handle, true); }
  async attachEx(handle: string): Promise<boolean> { return this.attachSession(handle, false); }
  private async attachSession(handle: string, flag: boolean): Promise<boolean> {
    await this.connection.attach(handle); this.attachFlag = flag;
    try { await this.startupState(); return true; } catch (error) { this.close(); throw error; }
  }
  async sendMsgAsync(input: Args): Promise<string> { return (await this.rpc(510, 0, 0, input)).get('returnArgs')?.value as string ?? ''; }
  async sendExecuteQueryAsync(input: Args, code: number): Promise<string> { return text(await this.rpc(code, 0, 0, input), 'outputArgs'); }
  cancelQuery(requestId = -1): Promise<void> { return this.connection.cancelQuery(requestId); }
  async logoff(commit = true): Promise<boolean> { await this.connection.logoff(commit); return true; }
  close(): void { this.connection.close(); }
  newPropertySet(): SiebelPropertySet { return new SiebelPropertySet(); }
  getApplication(): SiebelDataBean { return this; }
  /** Low-level escape hatch for the RPCs documented in docs/protocol.md. */
  rpc(code: number, objectType = 0, objectId = 0, input: Args = new Map()): Promise<Args> { return this.connection.rpc(code, objectType, objectId, input); }
  /** @internal */ epoch(): number { return this.generation; }
  /** @internal */ assertEpoch(epoch: number): void { if (!this.connection.connected || epoch !== this.generation) throw new SiebelException('Object belongs to a closed session'); }
  /** @internal */ register(bc: SiebelBusComp): void { this.components.set(bc.id, bc); }
  /** @internal */ unregister(bc: SiebelBusComp): void { if (this.components.get(bc.id) === bc) this.components.delete(bc.id); }
  /** @internal */ fieldList(indices: (string | null)[], added: FieldSpec[]): FieldSpec[] {
    this.fields.push(...added);
    return indices.map(index => {
      if (!index || !/^p?r?\d+$/.test(index)) throw new ProtocolError('Invalid field index');
      const field = this.fields[Number(index.replace(/^p?r?/, ''))];
      if (!field) throw new ProtocolError(`Unknown field definition ${index}`); return field;
    });
  }
  /** @internal */ processNotifications(result: Args): void {
    const notifications = result.get('notifyList');
    if (notifications?.type === 10) for (const n of notifications.value) this.components.get(n.busCompId)?.notify(n);
  }
  async getBusObject(name: string): Promise<SiebelBusObject> {
    const result = await this.rpc(1, 5, 0, args({ busObjName: name }));
    this.processNotifications(result);
    return new SiebelBusObject(this, value<number>(result, 'busObjId'), name);
  }
  async getService(name: string): Promise<SiebelService> {
    const result = await this.rpc(5, 0, 0, args({ serviceName: name, bRequestedByEL: false }));
    return new SiebelService(this, value<number>(result, 'serviceId'), name);
  }
  async invokeMethod(methodName: string, parameterArray?: string[]): Promise<string> {
    const input = args({ methodName }); if (parameterArray) input.set('parameterArray', { type: 9, value: parameterArray });
    const result = await this.rpc(506, 0, 0, input); return (result.get('returnVal')?.value as string | null) ?? '';
  }
  async getProfileAttr(name: string): Promise<string> { return text(await this.rpc(702, 0, 0, args({ Name: name })), 'Value'); }
  async setProfileAttr(name: string, val: string): Promise<boolean> { await this.rpc(703, 0, 0, args({ Name: name, Value: val })); return true; }
  async getServerVersion(): Promise<string> { return text(await this.rpc(505), 'strVersion'); }
  /** @internal */ startupState(): Promise<Args> {
    if (!this.startup) {
      const profile = args({ type: '', propArray: args({
        'Intl iDigits': '3', 'Intl iLzero': '1', 'Intl sShortDate': 'MM/DD/YY', 'Intl iTime': '0',
        'Intl iTLZero': '0', 'Intl iCurrency': '0', 'Intl iNegCurr': '0', 'Intl sThousand': ',',
        'Intl sDecimal': '.', 'Intl sDate': '/', 'Intl sTime': ':', 'Intl s1159': 'AM', 'Intl s2359': 'PM',
        'Intl iCountry': '1', 'Intl sCountry': '', 'Intl sCurrency': ''
      }), subsetArray: args() });
      const input = args({ SISNSIOMVersion: 203, localeProfile: profile, bJavaClient: true,
        bReturnCommonDefs: false, bReturnProductConfig: false, bReturnPreferences: false, bReturnViewAccessMap: false
      });
      if (this.attachFlag) input.set('bAttach', { type: 2, value: 1 });
      this.startup = this.rpc(501, 0, 0, input).then(r => value<Args>(r, 'startupState')).catch(e => { this.startup = undefined; throw e; });
    }
    return this.startup;
  }
  async loginId(): Promise<string> { return text(await this.startupState(), 'loginId'); }
  async loginName(): Promise<string> { return text(await this.startupState(), 'loginName'); }
  async positionId(): Promise<string> { return text(await this.startupState(), 'positionId'); }
  async positionName(): Promise<string> { return text(await this.startupState(), 'positionName'); }
  async currencyCode(): Promise<string> { return text(await this.startupState(), 'currencyCode'); }
  private async setPosition(code: number, position: string): Promise<boolean> {
    const result = await this.rpc(code, 0, 0, args({ Value: position }));
    if (this.startup) { const state = await this.startup; for (const k of ['positionId', 'positionName']) if (result.has(k)) state.set(k, result.get(k)!); } return true;
  }
  setPositionId(position: string): Promise<boolean> { return this.setPosition(511, position); }
  setPositionName(position: string): Promise<boolean> { return this.setPosition(512, position); }
  async trace(message: string): Promise<boolean> { await this.rpc(15, 0, 0, args({ Msg: message })); return true; }
  async traceOn(fileName: string, category: string, source: string): Promise<boolean> { await this.rpc(17, 0, 0, args({ FileName: fileName, Category: category, Src: source })); return true; }
  async traceOff(): Promise<boolean> { await this.rpc(16); return true; }
}

abstract class RemoteObject {
  protected released = false;
  private readonly epoch: number;
  constructor(protected readonly app: SiebelDataBean, public readonly id: number, protected readonly objectName: string) { this.epoch = app.epoch(); }
  protected assertValid(): void { if (this.released) throw new SiebelException('Object has been released'); this.app.assertEpoch(this.epoch); }
  protected abstract readonly objectType: number;
  protected call(code: number, input: Record<string, Input> = {}): Promise<Args> { this.assertValid(); return this.app.rpc(code, this.objectType, this.id, args(input)); }
  protected async ok(code: number, input: Record<string, Input> = {}): Promise<boolean> { await this.call(code, input); return true; }
}

export class SiebelBusObject extends RemoteObject {
  protected readonly objectType = 5;
  private components = new Map<number, SiebelBusComp>();
  name(): string { return this.objectName; }
  async getBusComp(name: string): Promise<SiebelBusComp> {
    this.assertValid();
    const cached = [...this.components.values()].find(bc => bc.name() === name && bc.kind === 0);
    if (cached) return cached;
    const bc = this.makeComponent(await this.call(1, { busCompName: name }), name, 0); bc.deactivateFields(); return bc;
  }
  /** @internal */ makeComponent(result: Args, name: string, kind: number): SiebelBusComp {
    const id = value<number>(result, 'busCompId');
    let bc = this.components.get(id);
    if (!bc) {
      bc = new SiebelBusComp(this.app, id, name, this, kind);
      bc.setFields(value<(string | null)[]>(result, 'fieldIndexList'), (result.get('newFieldList')?.value as FieldSpec[]) ?? []);
      this.components.set(id, bc); this.app.register(bc);
    }
    this.app.processNotifications(result);
    return bc;
  }
  /** @internal */ forget(bc: SiebelBusComp): void { this.components.delete(bc.id); this.app.unregister(bc); }
  /** @internal */ valid(): void { this.assertValid(); }
  async release(): Promise<void> {
    if (this.released) return; await this.call(403); this.released = true;
    for (const bc of this.components.values()) bc.invalidate(); this.components.clear();
  }
}

export class SiebelBusComp extends RemoteObject {
  protected readonly objectType = 6;
  private fields = new Map<string, FieldSpec>();
  private activeFields: string[] = [];
  private rows: Array<Map<string, string | null>> = [];
  private rowErrors: Array<Set<string>> = [];
  private activeRow = -1;
  private flags = new Map<string, number>();
  private deactivate = false;
  private viewMode = 4;
  private userProperties = new Map<string, string>();
  constructor(app: SiebelDataBean, id: number, name: string, private readonly parent: SiebelBusObject, readonly kind = 0) { super(app, id, name); }
  protected override assertValid(): void { super.assertValid(); this.parent.valid(); }
  name(): string { return this.objectName; }
  busObject(): SiebelBusObject { return this.parent; }
  /** @internal */ setFields(indices: (string | null)[], added: FieldSpec[]): void {
    this.fields = new Map(this.app.fieldList(indices, added).map(f => [f.name ?? '', f]));
  }
  /** @internal */ notify(n: NotifySpec): void {
    this.activeRow = n.activeRow;
    const row = () => new Map(this.activeFields.map((f, i) => [f, n.values[i] ?? null]));
    const insert = (index: number) => {
      if (index < 0 || index > 1_000_000) throw new ProtocolError('Invalid workset row');
      if (index >= this.rows.length) { this.rows[index] = row(); this.rowErrors[index] = new Set(n.errorFields.filter((v): v is string => v !== null)); }
      else { this.rows.splice(index, 0, row()); this.rowErrors.splice(index, 0, new Set(n.errorFields.filter((v): v is string => v !== null))); }
    };
    switch (n.type) {
      case 3: if (n.index >= 0) { this.rows.splice(n.index, 1); this.rowErrors.splice(n.index, 1); } break;
      case 8: insert(n.index); break;
      case 10: this.activeFields = this.app.fieldList(n.values, []).map(f => f.name ?? ''); break;
      case 13: {
        const field = n.fieldName ?? ''; this.rows[n.index]?.set(field, n.values[0] ?? null);
        if (n.errorFields.length) this.rowErrors[n.index]?.add(field); else this.rowErrors[n.index]?.delete(field); break;
      }
      case 14: this.setFields(n.values, n.fields); break;
      case 17: if (n.activeRow >= 0) { this.rows.splice(n.activeRow, 1); this.rowErrors.splice(n.activeRow, 1); insert(n.activeRow); } break;
      case 23: this.flags.set(n.fieldName ?? '', n.intValue); break;
    }
  }
  async activateField(fieldName: string): Promise<boolean> {
    await this.call(300, { bDeactivateFields: this.deactivate, fieldName, displayName: null, displayFormat: null }); this.deactivate = false; return true;
  }
  async activateMultipleFields(input: SiebelPropertySet): Promise<boolean> {
    await this.call(351, { bDeactivateFields: this.deactivate, inputArgs: input.encodeAsString() }); this.deactivate = false; return true;
  }
  deactivateFields(): boolean { this.assertValid(); this.deactivate = true; return true; }
  async clearToQuery(): Promise<boolean> { await this.setSearchExpr(''); await this.setSortSpec(''); return true; }
  setSearchExpr(searchSpec: string): Promise<boolean> { return this.ok(342, { searchSpec, bRawFieldData: false, bFormatted: false }); }
  setSearchSpec(fieldName: string, searchSpec: string): Promise<boolean> { return this.ok(342, { fieldName, searchSpec, bRawFieldData: false, bFormatted: false }); }
  setSortSpec(sortSpec: string): Promise<boolean> { return this.ok(343, { sortSpec, bUserEntered: false }); }
  async getSearchExpr(): Promise<string> { return text(await this.call(318), 'searchSpec'); }
  async getSearchSpec(fieldName: string): Promise<string> { return text(await this.call(318, { fieldName, bFormatted: false }), 'searchSpec'); }
  async getSortSpec(): Promise<string> { return text(await this.call(319), 'sortSpec'); }
  async setViewMode(viewMode: number): Promise<boolean> { await this.call(344, { viewMode, bExecute: false }); this.viewMode = viewMode; return true; }
  getViewMode(): number { this.assertValid(); return this.viewMode; }
  executeQuery(mode: boolean | CursorMode = false): Promise<boolean> { return this.executeQuery2(mode, false); }
  async executeQuery2(mode: boolean | CursorMode, ignoreMaxCursorSize: boolean): Promise<boolean> {
    await this.call(201, { bDeactivateFields: this.deactivate, bForwardOnly: !!mode, bSetupOnly: false, bIgnoreMaxCursorSize: ignoreMaxCursorSize }); this.deactivate = false; return true;
  }
  private async move(code: number): Promise<boolean> {
    try { await this.call(code); return this.activeRow !== -1; }
    catch (e) { if (e instanceof SiebelException && (e.getErrorCode() === 7668105 || (code === 205 && e.getErrorCode() === 7668076))) return false; throw e; }
  }
  firstRecord(): Promise<boolean> { return this.move(202); }
  lastRecord(): Promise<boolean> { return this.move(203); }
  nextRecord(): Promise<boolean> { return this.move(204); }
  previousRecord(): Promise<boolean> { return this.move(205); }
  async getFieldValue(field: string): Promise<string> {
    this.assertValid(); if (this.activeRow < 0 || !this.rows[this.activeRow]) throw new SiebelException('No active record');
    if (!this.fields.has(field)) throw new SiebelException(`Unknown field ${field}`);
    const result = this.rows[this.activeRow].get(field) ?? '';
    if (this.rowErrors[this.activeRow]?.has(field)) throw new SiebelException(result || `Server error reading field ${field}`);
    return result;
  }
  async getFormattedFieldValue(fieldName: string): Promise<string> { return text(await this.call(312, { fieldName, format: '' }), 'fieldData'); }
  setFieldValue(fieldName: string, fieldValue: string): Promise<boolean> { return this.ok(209, { fieldNameList: [fieldName], valueList: [fieldValue] }); }
  setFormattedFieldValue(fieldName: string, fieldValue: string): Promise<boolean> { return this.ok(354, { fieldName, fieldValue, format: '' }); }
  async getMultipleFieldValues(input: SiebelPropertySet, output: SiebelPropertySet): Promise<boolean> {
    const result = await this.call(352, { inputArgs: input.encodeAsString() }); output.copy(SiebelPropertySet.fromString(text(result, 'outputArgs'))); return true;
  }
  setMultipleFieldValues(input: SiebelPropertySet): Promise<boolean> { return this.ok(353, { inputArgs: input.encodeAsString() }); }
  async newRecord(position: boolean | NewRecordPosition = NewRecordPosition.After): Promise<boolean> {
    if (!this.flags.get('bExecuted')) { await this.call(201, { bDeactivateFields: this.deactivate, bForwardOnly: false, bSetupOnly: true, bIgnoreMaxCursorSize: false }); this.deactivate = false; }
    if (typeof position === 'boolean') return this.ok(206, { bInsertBefore: position });
    if (![0, 1, 2, 3].includes(position)) throw new RangeError('Invalid insert position');
    return this.ok(position >= 2 ? 211 : 206, { bInsertBefore: position % 2 === 0 });
  }
  writeRecord(): Promise<boolean> { return this.ok(210); }
  deleteRecord(): Promise<boolean> { return this.ok(207, { bDefer: false }); }
  undoRecord(): Promise<boolean> { return this.ok(348); }
  refineQuery(): Promise<boolean> { return this.ok(303); }
  setNamedSearch(searchName: string, searchSpec: string): Promise<boolean> { return this.ok(341, { searchName, searchSpec, bSystem: true }); }
  getUserProperty(name: string): string { this.assertValid(); if (!this.userProperties.has(name)) throw new SiebelException(`Unknown user property ${name}`); return this.userProperties.get(name)!; }
  setUserProperty(name: string, val: string): boolean { this.assertValid(); this.userProperties.set(name, val); return true; }
  async getNamedSearch(searchName: string): Promise<string> { return text(await this.call(315, { searchName }), 'searchSpec'); }
  async invokeMethod(methodName: string, parameterArray?: string[]): Promise<string> {
    const input: Record<string, Input> = { methodName }; if (parameterArray) input.parameterArray = parameterArray;
    const result = await this.call(324, input); return (result.get('returnVal')?.value as string | null) ?? '';
  }
  private async related(mode: string, fieldName?: string): Promise<SiebelBusComp> {
    const input: Record<string, Input> = { mode, bParm: mode !== 'parent' }; if (fieldName !== undefined) input.fieldName = fieldName;
    const result = await this.call(1, input); return this.parent.makeComponent(result, text(result, 'busCompName'), (result.get('busCompType')?.value as number) ?? 1);
  }
  getPicklistBusComp(field: string): Promise<SiebelBusComp> { return this.related('pick', field); }
  getMVGBusComp(field: string): Promise<SiebelBusComp> { return this.related('mvg', field); }
  getAssocBusComp(): Promise<SiebelBusComp> { return this.related('assoc'); }
  async parentBusComp(): Promise<SiebelBusComp | null> {
    const result = await this.call(1, { mode: 'parent', bParm: false });
    if (result.get('bHasParent')?.value === 0) { this.app.processNotifications(result); return null; }
    return this.parent.makeComponent(result, text(result, 'busCompName'), (result.get('busCompType')?.value as number) ?? 0);
  }
  pick(): Promise<boolean> { return this.ok(329); }
  associate(insertBefore = false): Promise<boolean> { return this.ok(301, { bInsertBefore: insertBefore }); }
  /** @internal */ invalidate(): void { this.released = true; this.rows = []; this.app.unregister(this); }
  async release(): Promise<void> { if (this.released) return; if (this.kind === 0) await this.call(332); this.invalidate(); this.parent.forget(this); }
}

export class SiebelService extends RemoteObject {
  protected readonly objectType = 12;
  private properties?: Promise<Map<string, string>>;
  private iterator: Iterator<string> = [][Symbol.iterator]();
  private async props(): Promise<Map<string, string>> {
    this.assertValid();
    if (!this.properties) this.properties = (async () => {
      await this.app.startupState();
      const result = await this.app.rpc(2, 0, 0, args({ Type: 'Service', Name: this.objectName }));
      const definition = value<Args>(result, 'Service'), data = value<Args>(definition, 'Data');
      const properties = new Map<string, string>();
      for (const entry of data.values()) {
        if (entry.type === 11 && entry.value.get('Type')?.value === 'UserPropMap') {
          properties.set(text(entry.value, 'Name'), text(value<Args>(entry.value, 'Data'), 'value'));
        }
      }
      return properties;
    })().catch(e => { this.properties = undefined; throw e; });
    return this.properties;
  }
  async getFirstProperty(): Promise<string> { this.iterator = (await this.props()).keys(); return this.getNextProperty(); }
  async getNextProperty(): Promise<string> { this.assertValid(); return this.iterator.next().value ?? ''; }
  async getProperty(name: string): Promise<string> { return (await this.props()).get(name) ?? ''; }
  async propertyExists(name: string): Promise<boolean> { return (await this.props()).has(name); }
  async setProperty(name: string, val: string): Promise<void> { (await this.props()).set(name, val); }
  async removeProperty(name: string): Promise<void> { (await this.props()).delete(name); }
  getName(): string { return this.objectName; }
  async invokeMethod(methodName: string, input: SiebelPropertySet): Promise<SiebelPropertySet>;
  async invokeMethod(methodName: string, input: SiebelPropertySet, output: SiebelPropertySet): Promise<boolean>;
  async invokeMethod(methodName: string, input: SiebelPropertySet, output: SiebelPropertySet, preserveEncodedOutput: boolean): Promise<boolean>;
  async invokeMethod(methodName: string, input: SiebelPropertySet, output?: SiebelPropertySet, preserveEncodedOutput?: boolean): Promise<SiebelPropertySet | boolean> {
    this.assertValid();
    if (input.getProperty('SWSECmd').trim().toLowerCase() === 'swsecancelquery') {
      const id = input.getProperty('SWSECancelID').trim() || '-1';
      if (!/^-?\d+$/.test(id)) throw new TypeError('Invalid SWSECancelID');
      await this.app.cancelQuery(Number(id));
      input.removeProperty('SWSECmd'); input.removeProperty('SWSECancelID'); input.setProperty('requestId', id);
      const result = output ?? new SiebelPropertySet(); result.setProperty('B', '200'); return output ? true : result;
    }
    const parameters: Record<string, Input> = { methodName, inputArgs: preserveEncodedOutput === undefined ? input.encodeAsString() : input.getProperty('#INOPENINT') };
    if (input.getProperty('WLM').toUpperCase() === 'T') parameters.WLM = 'T';
    const result = await this.call(603, parameters), encoded = text(result, 'outputArgs');
    const decoded = SiebelPropertySet.fromString(encoded);
    if (preserveEncodedOutput) decoded.setProperty('#OUTOPENINT', encoded);
    if (output) { output.copy(decoded); return true; } return decoded;
  }
  async release(): Promise<void> { if (this.released) return; await this.call(600); this.released = true; }
}

export { SiebelDataBean as Application, SiebelDataBean as SiebelApplication, SiebelBusObject as BusObject, SiebelBusComp as BusComp, SiebelService as Service };
