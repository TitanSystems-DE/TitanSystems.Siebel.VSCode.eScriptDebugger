(function WS_CHANGE(){
    try{
        var $___WS_NAME = "{{WS_NAME}}";
        var oBO = TheApplication().GetBusObject("Workspace");
        var oBC = oBO.GetBusComp("Repository Workspace");
        oBC.SetViewMode(AllView);
        oBC.SetSearchExpr("[Name]= '" + $___WS_NAME + "'");
        oBC.ExecuteQuery(ForwardBackward);

        if(!oBC.FirstRecord()) {
            throw "[ERROR]: Workspace nicht gefunden!";
        }

        oBC.InvokeMethod("OpenWS");
        Clib.WriteLn("[INFO]: workspace " + $___WS_NAME + " opened");
        oBC.InvokeMethod("PreviewWS");
        Clib.WriteLn("[INFO]: successfully connected to workspace " + $___WS_NAME);
    }
    catch(e)
    {
        Clib.WriteLn("[ERROR]: " + e.toString());
        throw e;
    }
})();
