import java.lang.annotation.Annotation;
import java.lang.invoke.MethodHandles;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Stream;

/** Discovery through public JUnit/TestNG APIs on the classpath resolved by the build tool. */
class IdeTestDiscovery {
    private static final List<String> rows = new ArrayList<>();
    private static final ClassLoader loader = Thread.currentThread().getContextClassLoader();
    private static int nodes;
    private static int unsupportedEntries;
    private static final int LIMIT = 10000;
    private static Path reportingRoot;
    private static final Map<Class<?>, Object> reportingProviders = new HashMap<>();

    private static synchronized Object reportingProvider(Class<?> api) throws Exception {
        Object existing = reportingProviders.get(api);
        if (existing != null) return existing;
        Files.createDirectories(reportingRoot);
        Map<Object, Path> directories = new IdentityHashMap<>();
        Object provider = Proxy.newProxyInstance(loader, new Class<?>[]{api}, (proxy, method, args) -> {
            if (method.getName().equals("getRootDirectory")) return reportingRoot;
            if (method.getName().equals("createOutputDirectory")) {
                Objects.requireNonNull(args[0]);
                synchronized (directories) {
                    Path directory = directories.get(args[0]);
                    if (directory == null) {
                        if (directories.size() >= LIMIT) throw new IllegalArgumentException("Too many discovery output directories");
                        directory = Files.createTempDirectory(reportingRoot, "test-");
                        directories.put(args[0], directory);
                    }
                    return directory;
                }
            }
            if (method.getName().equals("toString")) return "Private JUnit discovery output";
            if (method.getName().equals("hashCode")) return System.identityHashCode(proxy);
            if (method.getName().equals("equals")) return proxy == args[0];
            throw new UnsupportedOperationException("Unsupported public output directory method: " + method.getName());
        });
        reportingProviders.put(api, provider);
        return provider;
    }

    private static Class<?> type(String name) throws ClassNotFoundException {
        return Class.forName(name, false, loader);
    }
    private static Object call(Class<?> api, Object value, String method) throws Exception {
        return api.getMethod(method).invoke(value);
    }
    private static Object invokeDefault(Object proxy, Method method, Object[] args) throws Throwable {
        Object[] arguments = args == null ? new Object[0] : args;
        try {
            Method invoke = InvocationHandler.class.getMethod("invokeDefault", Object.class, Method.class, Object[].class);
            return invoke.invoke(null, proxy, method, arguments);
        } catch (InvocationTargetException failure) {
            throw failure.getCause();
        } catch (NoSuchMethodException legacyRuntime) {
            Class<?> owner = method.getDeclaringClass();
            MethodHandles.Lookup lookup;
            try {
                Method privateLookup = MethodHandles.class.getMethod("privateLookupIn", Class.class, MethodHandles.Lookup.class);
                lookup = (MethodHandles.Lookup) privateLookup.invoke(null, owner, MethodHandles.lookup());
            } catch (NoSuchMethodException java8) {
                Constructor<MethodHandles.Lookup> constructor = MethodHandles.Lookup.class.getDeclaredConstructor(Class.class, int.class);
                constructor.setAccessible(true);
                lookup = constructor.newInstance(owner, MethodHandles.Lookup.PRIVATE);
            } catch (InvocationTargetException failure) {
                throw failure.getCause();
            }
            return lookup.unreflectSpecial(method, owner).bindTo(proxy).invokeWithArguments(arguments);
        }
    }
    private static String quote(String value) {
        if (value == null) return "null";
        if (value.length() > 4096 || value.indexOf(0) >= 0) throw new IllegalArgumentException("Oversized discovery label");
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default: if (c < 32) out.append(String.format("\\u%04x", (int)c)); else out.append(c);
            }
        }
        return out.append('"').toString();
    }
    private static synchronized void add(String className, String method, String label) {
        add(className, method, label, false);
    }
    private static synchronized void add(String className, String method, String label, boolean testng) {
        if (className == null || className.isEmpty()) return;
        if (rows.size() >= LIMIT) throw new IllegalArgumentException("Too many discovered tests");
        rows.add("{\"className\":" + quote(className) + ",\"methodName\":" + quote(method) + ",\"label\":" + quote(label) + ",\"testng\":" + testng + "}");
    }
    private static void bounded(int depth) {
        if (++nodes > 100000 || depth > 64) throw new IllegalArgumentException("Discovery traversal limit exceeded");
    }
    private static void platformNode(Object descriptor, Class<?> api, int depth) throws Exception {
        bounded(depth);
        Optional<?> source = (Optional<?>) call(api, descriptor, "getSource");
        boolean supportedSource = false;
        if (source.isPresent()) {
            Object origin = source.get();
            Class<?> methodSource = type("org.junit.platform.engine.support.descriptor.MethodSource");
            Class<?> classSource = type("org.junit.platform.engine.support.descriptor.ClassSource");
            if (methodSource.isInstance(origin)) {
                supportedSource = true;
                add((String) call(methodSource, origin, "getClassName"), (String) call(methodSource, origin, "getMethodName"), String.valueOf(call(api, descriptor, "getDisplayName")));
            } else if (classSource.isInstance(origin)) {
                supportedSource = true;
                add((String) call(classSource, origin, "getClassName"), null, String.valueOf(call(api, descriptor, "getDisplayName")));
            }
        }
        if (!supportedSource && Boolean.TRUE.equals(call(api, descriptor, "isTest"))) unsupportedEntries++;
        for (Object child : (Set<?>) call(api, descriptor, "getChildren")) platformNode(child, api, depth + 1);
    }
    private static int platform(Set<Path> roots) throws Exception {
        Class<?> engine;
        try { engine = type("org.junit.platform.engine.TestEngine"); }
        catch (ClassNotFoundException absent) { return 0; }
        Class<?> request = type("org.junit.platform.engine.EngineDiscoveryRequest");
        Class<?> configuration = type("org.junit.platform.engine.ConfigurationParameters");
        Properties properties = new Properties();
        Enumeration<java.net.URL> resources = loader.getResources("junit-platform.properties");
        while (resources.hasMoreElements()) try (java.io.InputStream input = resources.nextElement().openStream()) { properties.load(input); }
        properties.putAll(System.getProperties());
        Object parameters = Proxy.newProxyInstance(loader, new Class<?>[]{configuration}, (proxy, method, args) -> {
            if (method.getName().equals("get") && args.length == 1) return Optional.ofNullable(properties.getProperty((String) args[0]));
            if (method.getName().equals("getBoolean")) return Optional.ofNullable(properties.getProperty((String) args[0])).map(Boolean::parseBoolean);
            if (method.getName().equals("keySet")) return properties.stringPropertyNames();
            if (method.getName().equals("size")) return properties.size();
            if (method.isDefault()) return invokeDefault(proxy, method, args);
            if (method.getName().equals("toString")) return "JUnit discovery configuration";
            throw new UnsupportedOperationException("Unsupported public configuration method: " + method.getName());
        });
        List<?> selectors = (List<?>) type("org.junit.platform.engine.discovery.DiscoverySelectors").getMethod("selectClasspathRoots", Set.class).invoke(null, roots);
        Object discoveryRequest = Proxy.newProxyInstance(loader, new Class<?>[]{request}, (proxy, method, args) -> {
            if (method.getName().equals("getSelectorsByType")) {
                List<Object> selected = new ArrayList<>();
                for (Object selector : selectors) if (((Class<?>) args[0]).isInstance(selector)) selected.add(selector);
                return selected;
            }
            if (method.getName().equals("getFiltersByType")) return Collections.emptyList();
            if (method.getName().equals("getConfigurationParameters")) return parameters;
            if (method.getName().equals("getOutputDirectoryProvider")) return reportingProvider(method.getReturnType());
            if (method.isDefault()) return invokeDefault(proxy, method, args);
            if (method.getName().equals("toString")) return "JUnit discovery request";
            throw new UnsupportedOperationException("Unsupported public discovery method: " + method.getName());
        });
        Class<?> uniqueId = type("org.junit.platform.engine.UniqueId");
        Class<?> descriptor = type("org.junit.platform.engine.TestDescriptor");
        int count = 0;
        for (Object provider : ServiceLoader.load(engine, loader)) {
            String id = (String) call(engine, provider, "getId");
            Object identity = uniqueId.getMethod("forEngine", String.class).invoke(null, id);
            Object tree = engine.getMethod("discover", request, uniqueId).invoke(provider, discoveryRequest, identity);
            platformNode(tree, descriptor, 0);
            count++;
        }
        return count;
    }
    private static boolean annotated(Annotation[] annotations, String name) {
        for (Annotation annotation : annotations) if (annotation.annotationType().getName().equals(name)) return true;
        return false;
    }
    private static boolean junit4Class(Class<?> klass) {
        if (Modifier.isAbstract(klass.getModifiers()) || klass.isInterface()) return false;
        if (annotated(klass.getAnnotations(), "org.junit.runner.RunWith")) return true;
        for (Method method : klass.getMethods()) if (annotated(method.getAnnotations(), "org.junit.Test")) return true;
        for (Class<?> parent = klass; parent != null; parent = parent.getSuperclass()) if (parent.getName().equals("junit.framework.TestCase")) return true;
        return false;
    }
    private static void junit4Node(Object node, Class<?> api, int depth) throws Exception {
        bounded(depth);
        add((String) call(api, node, "getClassName"), (String) call(api, node, "getMethodName"), String.valueOf(call(api, node, "getDisplayName")));
        for (Object child : (List<?>) call(api, node, "getChildren")) junit4Node(child, api, depth + 1);
    }
    private static List<Class<?>> compiledClasses(Set<Path> roots) throws Exception {
        Set<String> names = new TreeSet<>();
        int files = 0;
        for (Path root : roots) try (Stream<Path> paths = Files.walk(root, 32)) {
            Iterator<Path> iterator = paths.iterator();
            while (iterator.hasNext()) {
                Path path = iterator.next();
                if (++files > 50000) throw new IllegalArgumentException("Compiled class traversal limit exceeded");
                if (Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && path.toString().endsWith(".class")) {
                    String name = root.relativize(path).toString().replace(java.io.File.separatorChar, '.');
                    name = name.substring(0, name.length() - 6);
                    if (!name.endsWith("module-info") && !name.endsWith("package-info")) names.add(name);
                }
            }
        }
        List<Class<?>> classes = new ArrayList<>();
        for (String name : names) classes.add(Class.forName(name, false, loader));
        return classes;
    }
    private static boolean junit4(List<Class<?>> classes) throws Exception {
        Class<?> request;
        try { request = type("org.junit.runner.Request"); }
        catch (ClassNotFoundException absent) { return false; }
        Class<?> runner = type("org.junit.runner.Runner"), description = type("org.junit.runner.Description");
        for (Class<?> klass : classes) {
            if (junit4Class(klass)) {
                Object plan = request.getMethod("aClass", Class.class).invoke(null, klass);
                Object value = request.getMethod("getRunner").invoke(plan);
                junit4Node(runner.getMethod("getDescription").invoke(value), description, 0);
            }
        }
        return true;
    }
    private static boolean testngClass(Class<?> klass) {
        if (Modifier.isAbstract(klass.getModifiers()) || klass.isInterface()) return false;
        for (Class<?> parent = klass; parent != null; parent = parent.getSuperclass()) {
            if (annotated(parent.getDeclaredAnnotations(), "org.testng.annotations.Test")) return true;
            for (Method method : parent.getDeclaredMethods()) {
                if (annotated(method.getDeclaredAnnotations(), "org.testng.annotations.Test") || annotated(method.getDeclaredAnnotations(), "org.testng.annotations.Factory")) return true;
            }
            for (Constructor<?> constructor : parent.getDeclaredConstructors()) if (annotated(constructor.getDeclaredAnnotations(), "org.testng.annotations.Factory")) return true;
        }
        return false;
    }
    private static boolean testng(List<Class<?>> classes) throws Exception {
        Class<?> api;
        try { api = type("org.testng.TestNG"); }
        catch (ClassNotFoundException absent) { return false; }
        String version = api.getPackage().getImplementationVersion();
        if (version == null) version = api.getPackage().getSpecificationVersion();
        java.util.regex.Matcher components = java.util.regex.Pattern.compile("^(\\d+)\\.(\\d+)(?:[.\\-+].*)?$").matcher(version == null ? "" : version);
        if (!components.matches() || Integer.parseInt(components.group(1)) < 6 || (Integer.parseInt(components.group(1)) == 6 && Integer.parseInt(components.group(2)) < 14)) {
            throw new IllegalArgumentException("TestNG discovery needs an identifiable TestNG version 6.14 or later with documented dry-run support");
        }
        // Set the documented property before initializing TestNG or project test instances.
        System.setProperty("testng.mode.dryrun", "true");
        Class<?> context = type("org.testng.ITestContext"), testMethod = type("org.testng.ITestNGMethod"), testClass = type("org.testng.IClass");
        Class<?> interceptor = type("org.testng.IMethodInterceptor");
        Object listener = Proxy.newProxyInstance(loader, new Class<?>[]{interceptor}, (proxy, method, args) -> {
            if (method.getName().equals("intercept")) {
                if (!"true".equals(System.getProperty("testng.mode.dryrun"))) throw new IllegalStateException("The project disabled TestNG discovery dry-run");
                // The intercepted list can omit methods with dependencies.
                // Public context metadata retains the complete configured list.
                for (Object candidate : (Object[]) call(context, args[1], "getAllTestMethods")) {
                    if (Boolean.TRUE.equals(call(testMethod, candidate, "isTest")) && Boolean.TRUE.equals(call(testMethod, candidate, "getEnabled"))) {
                        Object owner = call(testMethod, candidate, "getTestClass");
                        Class<?> realClass = (Class<?>) call(testClass, owner, "getRealClass");
                        String name = (String) call(testMethod, candidate, "getMethodName");
                        add(realClass.getName(), name, name + " (" + realClass.getName() + ", TestNG)", true);
                    }
                }
                // Omit the intercepted executions; TestNG's documented dry-run
                // also suppresses dependent test method and configuration bodies.
                return Collections.emptyList();
            }
            if (method.getName().equals("toString")) return "IDE TestNG discovery";
            if (method.getName().equals("hashCode")) return System.identityHashCode(proxy);
            if (method.getName().equals("equals")) return proxy == args[0];
            if (method.isDefault()) return invokeDefault(proxy, method, args);
            throw new UnsupportedOperationException("Unsupported public TestNG discovery method: " + method.getName());
        });
        List<Class<?>> selected = new ArrayList<>();
        for (Class<?> klass : classes) if (testngClass(klass)) selected.add(klass);
        Object runner = api.getConstructor(boolean.class).newInstance(false);
        api.getMethod("setVerbose", int.class).invoke(runner, 0);
        api.getMethod("setTestClasses", Class[].class).invoke(runner, (Object) selected.toArray(new Class<?>[0]));
        api.getMethod("addListener", type("org.testng.ITestNGListener")).invoke(runner, listener);
        api.getMethod("run").invoke(runner);
        if (Boolean.TRUE.equals(call(api, runner, "hasFailure"))) throw new IllegalStateException("TestNG reported a discovery failure");
        return true;
    }
    public static void main(String[] args) throws Exception {
        if (args.length < 3 || args.length > 131) throw new IllegalArgumentException("Discovery requires output, workspace, request identity and bounded optional test roots");
        Path output = Paths.get(args[0]), workspace = Paths.get(args[1]).toRealPath();
        reportingRoot = output.toAbsolutePath().getParent().resolve("junit-engine-output");
        boolean junitOnly = args.length >= 4 && "--junit-only".equals(args[3]);
        int rootsStart = junitOnly ? 4 : 3;
        Set<Path> roots = new LinkedHashSet<>();
        String[] selectedRoots = args.length == rootsStart ? System.getProperty("java.class.path").split(java.util.regex.Pattern.quote(java.io.File.pathSeparator)) : Arrays.copyOfRange(args, rootsStart, args.length);
        for (String value : selectedRoots) {
            Path path = Paths.get(value).toAbsolutePath().normalize();
            if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
                Path canonical = path.toRealPath();
                if (canonical.startsWith(workspace) && canonical.equals(path)) roots.add(canonical);
            }
        }
        if (roots.isEmpty()) throw new IllegalArgumentException("No workspace-contained compiled test roots on the resolved classpath");
        List<Class<?>> classes = compiledClasses(roots);
        int providers = platform(roots);
        if (junit4(classes)) providers++;
        if (!junitOnly && testng(classes)) providers++;
        if (providers == 0) throw new IllegalArgumentException("No supported JUnit or TestNG discovery provider on the project's test classpath");
        String result = "{\"version\":1,\"requestId\":" + quote(args[2]) + ",\"scope\":\"engines\",\"unsupportedEntries\":" + unsupportedEntries + ",\"tests\":[" + String.join(",", rows) + "]}";
        byte[] encoded = result.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (encoded.length > 2*1024*1024) throw new IllegalArgumentException("Discovery output exceeds 2 MiB");
        Files.write(output, encoded, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS);
    }
}
