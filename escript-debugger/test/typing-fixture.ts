/// <reference path="../typings/siebel-escript.d.ts" />

const app = TheApplication();
const bo: BusObject = app.GetBusObject('Contact');
const bc: BusComp = bo.GetBusComp('Contact');
bc.SetViewMode(AllView);
bc.ExecuteQuery(ForwardOnly);
Clib.WriteLn(bc.GetFieldValue('Id'));
bo.Release();

const input: PropertySet = app.NewPropertySet();
const output: PropertySet = app.NewPropertySet();
input.SetProperty('Name', 'Value');
app.GetService('Workflow Process Manager').InvokeMethod('RunProcess', input, output);
