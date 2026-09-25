import com.siebel.om.conmgr.Connection;
import com.siebel.om.conmgr.SISString;

/** Hello-only comparison using the original implementation. No credentials. */
public class Probe {
    public static void main(String[] args) throws Exception {
        // The optional locale JAR is absent. Initialize the message manager so
        // transport failures still retain their numeric CSSException code.
        try { com.siebel.common.common.CSSMsgMgr.loadMessages("enu"); } catch (Exception ignored) {}
        try {
            Connection connection = new Connection(new SISString(args[0]), 10);
            System.out.println("Hello OK; translation=" + connection.getTransCode());
            System.exit(0);
        } catch (Throwable error) {
            if (error instanceof com.siebel.common.common.CSSException)
                System.err.println("CSS error code=" + ((com.siebel.common.common.CSSException) error).getErrorCode());
            error.printStackTrace(); System.exit(1);
        }
    }
}
