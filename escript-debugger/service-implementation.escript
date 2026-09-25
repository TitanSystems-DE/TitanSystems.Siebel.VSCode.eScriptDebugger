var ___srvName = "<unknown, runtime>";
var ___propMap = {};
var ___propIdx = -1;

// @this: Service
function Name(){ return ___srvName; }

// @this: Service
function PropertyExists(name) { return ___propMap.hasOwnProperty(name); }

// @this: Service
function RemoveProperty(name) { delete ___propMap[name]; }

// @this: Service
function SetProperty(name, value){ ___propMap[name] = value; }

// @this: Service
function GetProperty(name){ return ___propMap[name] ?? ""; }

// @this: Service
function GetFirstProperty(){
    ___propIdx = 0;
    var keys = Object.keys(___propMap);
    return keys.length > 0 ? keys[___propIdx] : "";
}

// @this: Service
function GetNextProperty(){
    if(___propIdx < 0) { return GetFirstProperty(); }
    ___propIdx++;
    var keys = Object.keys(___propMap);
    return keys.length > ___propIdx ? keys[___propIdx] : "";
}

// @this: Service
function Service_PreCanInvokeMethod(methodName, &canInvoke) {
    canInvoke = false;
    return ContinueOperation;
}

// @this: Service
function CanInvokeMethod(methodName, &canInvoke) {
    canInvoke = false;
    return CancelOperation;
}

// @this: Service
function Service_PreInvokeMethod(methodName, inputs, outputs) {}

// @this: Service
function Service_InvokeMethod(methodName) {}

// @this: Service
function InvokeMethod(methodName, inputArgs, outputArgs)
{
    var canInvoke = false;
    var operationResult = this.Service_PreCanInvokeMethod(methodName, canInvoke);
    if(operationResult == ContinueOperation) {
        operationResult = this.CanInvokeMethod(methodName, canInvoke);
    }
    if(!canInvoke) throw "cannot invoke method " + methodName;

    // pre-execution
    operationResult = this.Service_PreInvokeMethod(methodName, inputArgs, outputArgs);
    
    // execution if not handled in pre-invocation
    if (operationResult == ContinueOperation) {
        throw "service doesn´t implement the method " + methodName;
    }

    // post-execution
    this.Service_InvokeMethod(methodName);
}