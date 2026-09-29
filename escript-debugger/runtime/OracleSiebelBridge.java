import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/** Process bridge for the user-supplied Oracle Siebel Java Data Bean. */
public class OracleSiebelBridge {
  static final Map<Integer,Object> objects = new HashMap<>();
  static final IdentityHashMap<Object,Integer> handles = new IdentityHashMap<>();
  static int nextHandle = 1;
  static final Base64.Decoder DEC = Base64.getDecoder();
  static final Base64.Encoder ENC = Base64.getEncoder();
  static PrintStream protocolOut;

  public static void main(String[] args) throws Exception {
    protocolOut = System.out;
    System.setOut(new PrintStream(System.err, true, "UTF-8"));
    if (args.length == 2) { fileLoop(Paths.get(args[0]), Paths.get(args[1])); return; }
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String line;
    while ((line = in.readLine()) != null) {
      try { process(line); }
      catch (Throwable error) { fail(unwrap(error)); }
    }
  }

  static void fileLoop(Path request, Path response) throws Exception {
    Path temporary = Paths.get(response.toString()+".tmp");
    while (true) {
      if (!Files.exists(request)) { Thread.sleep(2); continue; }
      String line = new String(Files.readAllBytes(request), StandardCharsets.UTF_8).trim(); Files.delete(request);
      ByteArrayOutputStream bytes = new ByteArrayOutputStream(); protocolOut = new PrintStream(bytes, true, "UTF-8");
      try { process(line); } catch (Throwable error) { fail(unwrap(error)); }
      Files.write(temporary, bytes.toByteArray());
      Files.move(temporary, response, StandardCopyOption.REPLACE_EXISTING);
      if (line.startsWith("CLOSE\t")) return;
    }
  }

  static void process(String line) throws Exception {
    String[] p = line.split("\\t", -1); String command = p[0];
    if (command.equals("CREATE")) {
      Object app = Class.forName("com.siebel.data.SiebelDataBean").getDeclaredConstructor().newInstance();
      objects.put(0, app); handles.put(app, 0); ok(null); return;
    }
    if (command.equals("CLOSE")) { ok(null); return; }
    if (p.length < 4) throw new IllegalArgumentException("Malformed bridge request: incomplete header");
    int count;
    try { count = Integer.parseInt(p[3]); }
    catch (NumberFormatException error) { throw new IllegalArgumentException("Malformed bridge request: invalid argument count", error); }
    if (count < 0 || p.length != 4 + count)
      throw new IllegalArgumentException("Malformed bridge request: expected "+count+" argument(s), received "+Math.max(0, p.length-4));
    int target = Integer.parseInt(p[1]); Object receiver = objects.get(target);
    if (receiver == null) throw new IllegalStateException("Invalid or released Siebel object");
    String method = text(p[2]); Object[] raw = new Object[count];
    for (int i=0; i<count; i++) raw[i] = decode(p[4+i]);
    MethodMatch match = find(receiver.getClass(), method, raw);
    Object result = match.method.invoke(receiver, match.args);
    if (method.equalsIgnoreCase("release")) { objects.remove(target); handles.remove(receiver); }
    ok(result);
  }

  static MethodMatch find(Class<?> type, String name, Object[] raw) throws Exception {
    MethodMatch best = null;
    for (Method method : type.getMethods()) {
      if (!method.getName().equalsIgnoreCase(name) || method.getParameterCount() != raw.length) continue;
      try {
        Object[] converted = new Object[raw.length]; int score = 0; Class<?>[] types = method.getParameterTypes();
        for (int i=0; i<raw.length; i++) { converted[i] = convert(raw[i], types[i]); if (raw[i] != null && wrap(types[i]).isInstance(raw[i])) score += 2; }
        MethodMatch candidate = new MethodMatch(method, converted, score);
        if (best == null || candidate.score > best.score) best = candidate;
      } catch (IllegalArgumentException ignored) {}
    }
    if (best == null) throw new NoSuchMethodException(type.getName()+"."+name+" with "+raw.length+" argument(s)");
    return best;
  }

  static Object convert(Object value, Class<?> type) {
    if (value == null) { if (type.isPrimitive()) throw new IllegalArgumentException(); return null; }
    Class<?> boxed = wrap(type); if (boxed.isInstance(value)) return value;
    if (value instanceof Number) {
      Number n=(Number)value;
      if (boxed==Integer.class) return n.intValue(); if (boxed==Long.class) return n.longValue();
      if (boxed==Short.class) return n.shortValue(); if (boxed==Byte.class) return n.byteValue();
      if (boxed==Double.class) return n.doubleValue(); if (boxed==Float.class) return n.floatValue();
    }
    if (boxed==String.class) return String.valueOf(value);
    throw new IllegalArgumentException();
  }
  static Class<?> wrap(Class<?> t) {
    if (!t.isPrimitive()) return t; if(t==int.class)return Integer.class;if(t==long.class)return Long.class;
    if(t==short.class)return Short.class;if(t==byte.class)return Byte.class;if(t==double.class)return Double.class;
    if(t==float.class)return Float.class;if(t==boolean.class)return Boolean.class;if(t==char.class)return Character.class;return t;
  }
  static Object decode(String token) {
    char kind=token.charAt(0); String value=token.substring(1);
    if(kind=='Z')return null;if(kind=='S')return text(value);if(kind=='B')return value.equals("1");
    if(kind=='D') { double d=Double.parseDouble(value); return d==Math.rint(d) && d>=Integer.MIN_VALUE && d<=Integer.MAX_VALUE ? Integer.valueOf((int)d) : Double.valueOf(d); }
    if(kind=='H')return objects.get(Integer.parseInt(value));if(kind=='Y')return DEC.decode(value);
    throw new IllegalArgumentException("Invalid bridge argument");
  }
  static void ok(Object value) { protocolOut.println("OK\t"+encode(value)); protocolOut.flush(); }
  static String encode(Object value) {
    if(value==null)return "Z";if(value instanceof String || value instanceof Character)return "S"+base(value.toString());
    if(value instanceof Boolean)return (Boolean)value?"B1":"B0";if(value instanceof Number)return "D"+value;
    if(value instanceof byte[])return "Y"+ENC.encodeToString((byte[])value);
    Integer handle=handles.get(value);if(handle==null){handle=nextHandle++;handles.put(value,handle);objects.put(handle,value);}
    String kind=value.getClass().getName().endsWith("SiebelPropertySet")?"PropertySet":"Object";
    return "O"+handle+":"+base(kind);
  }
  static void fail(Throwable error) {
    String code=""; try { Object v=error.getClass().getMethod("getErrorCode").invoke(error); if(v!=null)code=v.toString(); } catch(Exception ignored){}
    protocolOut.println("ERR\t"+base(code)+"\t"+base(error.getMessage()==null?error.toString():error.getMessage())+"\t"+base(error.getClass().getSimpleName()));protocolOut.flush();
  }
  static Throwable unwrap(Throwable e){return e instanceof InvocationTargetException && ((InvocationTargetException)e).getCause()!=null?((InvocationTargetException)e).getCause():e;}
  static String base(String s){return ENC.encodeToString(s.getBytes(StandardCharsets.UTF_8));}
  static String text(String s){return new String(DEC.decode(s),StandardCharsets.UTF_8);}
  static class MethodMatch { Method method; Object[] args; int score; MethodMatch(Method m,Object[]a,int s){method=m;args=a;score=s;} }
}
