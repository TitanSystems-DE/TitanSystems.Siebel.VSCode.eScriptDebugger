// @this: Service;
function Service_PreCanInvokeMethod(MethodName: String, &CanInvoke: Boolean)
{
    // implement your logic here
    CanInvoke = false;
    return (CancelOperation);
}
