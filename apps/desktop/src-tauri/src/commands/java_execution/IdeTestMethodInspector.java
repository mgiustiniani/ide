import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.util.*;

/** Optional compiled-test metadata, run with the test task's own Java executable. */
public final class IdeTestMethodInspector {
    private static final int LIMIT = 2 * 1024 * 1024;

    private static boolean supportedOwner(String name) {
        if (name.isEmpty() || name.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 512) return false;
        for (String part : name.split("[.]", -1)) {
            if (part.isEmpty()) return false;
            for (int offset = 0; offset < part.length();) {
                int point = part.codePointAt(offset);
                if (Character.isISOControl(point) || !(offset == 0 ? Character.isJavaIdentifierStart(point) : Character.isJavaIdentifierPart(point))) return false;
                offset += Character.charCount(point);
            }
        }
        return true;
    }

    private static Class<?> declaration(Class<?> type, String name) {
        List<Class<?>> pending = new ArrayList<Class<?>>();
        Set<Class<?>> seen = new HashSet<Class<?>>();
        pending.add(type);
        Method sole = null;
        int count = 0;
        boolean publicOnly = true;
        while (!pending.isEmpty()) {
            Class<?> current = pending.remove(pending.size() - 1);
            if (!seen.add(current)) continue;
            if (seen.size() > 256) return null;
            for (Method method : current.getDeclaredMethods()) {
                if (!method.getName().equals(name)) continue;
                if (method.isBridge() || method.isSynthetic() || ++count > 1024) return null;
                sole = method;
                if (!Modifier.isPublic(method.getModifiers())) publicOnly = false;
                if (!publicOnly && count > 1) return null;
            }
            if (current.getSuperclass() != null) pending.add(current.getSuperclass());
            Collections.addAll(pending, current.getInterfaces());
        }
        if (count == 1) return sole.getDeclaringClass();
        if (!publicOnly) return null;
        sole = null;
        for (Method method : type.getMethods()) {
            if (!method.getName().equals(name)) continue;
            if (method.isBridge() || method.isSynthetic() || sole != null) return null;
            sole = method;
        }
        return sole == null ? null : sole.getDeclaringClass();
    }

    private static String origin(Class<?> type) throws Exception {
        URL location = type.getProtectionDomain().getCodeSource() == null ? null
            : type.getProtectionDomain().getCodeSource().getLocation();
        if (location == null || !location.getProtocol().equals("file")) return "";
        String path = new File(location.toURI()).getCanonicalPath();
        return path.getBytes("UTF-8").length <= 4096 ? path : "";
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2 || new File(args[0]).length() > LIMIT) throw new IOException("Invalid inspection request");
        try (DataInputStream input = new DataInputStream(new FileInputStream(args[0]))) {
            int files = input.readInt();
            if (files < 0 || files > 4096) throw new IOException("Invalid classpath size");
            URL[] urls = new URL[files];
            for (int i = 0; i < files; i++) {
                String path = input.readUTF();
                if (path.getBytes("UTF-8").length > 4096 || !new File(path).isAbsolute()) throw new IOException("Invalid classpath");
                urls[i] = new File(path).toURI().toURL();
            }
            int queries = input.readInt();
            if (queries < 0 || queries > 10000) throw new IOException("Invalid query count");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            DataOutputStream output = new DataOutputStream(bytes);
            output.writeInt(queries);
            // The parent supplies only JDK classes, never Gradle or application dependencies.
            try (URLClassLoader loader = new URLClassLoader(urls, ClassLoader.getSystemClassLoader().getParent())) {
                for (int i = 0; i < queries; i++) {
                    String runtimeClass = input.readUTF();
                    String name = input.readUTF();
                    String testOrigin = "", owner = "", declaringOrigin = "";
                    if (runtimeClass.length() > 512 || name.length() > 512) throw new IOException("Invalid query");
                    try {
                        Class<?> type = Class.forName(runtimeClass, false, loader);
                        testOrigin = origin(type);
                        Class<?> declaring = declaration(type, name);
                        if (declaring != null && declaring.getName().length() <= 512
                                && supportedOwner(declaring.getName())) {
                            owner = declaring.getName();
                            declaringOrigin = origin(declaring);
                        }
                    } catch (Exception ignored) {
                    } catch (LinkageError ignored) { }
                    output.writeUTF(testOrigin);
                    output.writeUTF(owner);
                    output.writeUTF(declaringOrigin);
                    if (bytes.size() > LIMIT) throw new IOException("Inspection response too large");
                }
            }
            if (input.read() != -1) throw new IOException("Trailing inspection request");
            try (OutputStream file = new FileOutputStream(args[1])) { bytes.writeTo(file); }
        }
    }
}
