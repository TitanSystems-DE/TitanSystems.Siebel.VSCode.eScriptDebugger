import com.siebel.om.sisnapi.*;
import com.siebel.data.SiebelPropertySet;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Generates interoperability fixtures for the protocol conformance tests. */
public class Golden {
    static Path target;
    static void save(String name, Request request, int translation) throws Exception {
        request.setSequence(7); request.setSessionId(42); request.setTransCode(translation);
        request.startRequest();
        Files.write(target.resolve(name + ".bin"), Arrays.copyOf(request.getPacketData(), request.getLength()));
    }
    public static void main(String[] argv) throws Exception {
        target = Paths.get(argv[0]); Files.createDirectories(target);
        save("hello", new HelloRequest(131077, 8, 0, 16, null), 4);
        save("session", new SessHelloReq(1, 2700), 4);
        save("logon-utf8", new LogonRequest(null, "J\u00f6rg", "p\u00e4ss\ud83d\udd11", 4, false, 1, 0, "", "JAVA", null), 4);
        save("logon-utf16", new LogonRequest(null, "J\u00f6rg", "p\u00e4ss\ud83d\udd11", 4, false, 1, 0, "", "JAVA", null), 3);
        save("logoff", new LogoffRequest(false), 4);
        save("close", new SessCloseReq(), 4);
        ArgList inner = new ArgList(); inner.addArg("text", new ArgSpec("Gr\u00fc\u00dfe\ud83d\ude00"));
        inner.addArg("int", new ArgSpec(-123)); inner.addArg("bytes", new ArgSpec(new byte[]{0, 1, -1}));
        inner.addArg("array", new ArgSpec(new String[]{"", "x", "\u6f22"}));
        ArgList outer = new ArgList(); outer.addArg("nested", new ArgSpec(inner));
        outer.addArg("ref", new ArgSpec(123, 6));
        save("rpc", new OMRPCRequest(603, 12, 99, outer), 4);
        ArgList wlm = new ArgList(); wlm.addArg("WLM", new ArgSpec("T"));
        save("whitelist", new OMRPCRequest(603, 12, 99, wlm), 3);
        ArgList cancel = new ArgList(); cancel.addArg("requestId", new ArgSpec(1234, 13));
        save("cancel", new OMRPCRequest(1001, 0, 0, cancel), 3);
        SiebelPropertySet p = new SiebelPropertySet(); p.setType("Root\ud83d\ude00"); p.setValue("a*b\u00e4"); p.setProperty("Name", "\u6f22\ud83d\ude00");
        SiebelPropertySet child = new SiebelPropertySet(); child.setType("Child"); child.setByteValue(new byte[]{0, 1, -1, 3}); p.addChild(child);
        Files.write(target.resolve("property-set.txt"), p.encodeAsString().getBytes(StandardCharsets.UTF_8));
        System.out.println("Generated Java reference fixtures in " + target);
    }
}
