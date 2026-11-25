import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

/** Owned JDI process. It reads runtime mirrors, never invokes application toString or methods. */
class IdeJavaDebugger {
    private final VirtualMachine vm;
    private final boolean ownsTarget;
    private volatile boolean commandTransportFailed;
    private final Object lock = new Object();
    private final Map<String, Breakpoint> breakpoints = new LinkedHashMap<>();
    private final Map<String, ObjectReference> references = new HashMap<>();
    private final Set<String> watches = new LinkedHashSet<>();
    private final Map<String, StackFrame> frames = new LinkedHashMap<>();
    private String status = "running", reason, stopId, selectedThread, selectedFrame, message, error;
    private Map<String, Object> evaluation;
    private long stopSequence;
    private boolean breakpointsMuted;
    private String exceptionMode = "none";
    private String exceptionClassName = "";
    private boolean exceptionIncludeSubclasses = true;
    private Object variablePage;
    private List<Object> loadedClasses = List.of();
    private boolean loadedClassesTruncated;
    private static final int THREAD_LIMIT = 128, FRAME_LIMIT = 128, VARIABLE_LIMIT = 128, PAGE_SIZE = 32, LOADED_CLASS_LIMIT = 2000;
    private static final Pattern PATH = Pattern.compile("[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*(?:\\.[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*|\\[[0-9]+\\])*");
    private static final Pattern LOCAL_ASSIGNMENT = Pattern.compile("^\\s*([\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*)\\s*=\\s*(.+?)\\s*$");

    private static class Breakpoint {
        String className, message;
        String sourcePath;
        int minimumComponents;
        int line;
        boolean verified;
        String condition = "";
        String logMessage = "";
        boolean temporary;
        int hitCount;
        long hits;
        IdeJavaDebuggerExpressions.Expression expression = resolver -> Boolean.TRUE;
        List<LogPart> logTemplate = List.of();
        List<BreakpointRequest> requests = new ArrayList<>();
        ClassPrepareRequest prepare;
        Breakpoint(String className, int line) { this.className = className; this.line = line; }
    }
    private record LogPart(String literal, IdeJavaDebuggerExpressions.Expression expression) { }

    IdeJavaDebugger(VirtualMachine vm) { this(vm, true); }
    IdeJavaDebugger(VirtualMachine vm, boolean ownsTarget) { this.vm = vm; this.ownsTarget = ownsTarget; }

    public static void main(String[] args) throws Exception {
        if ((args.length == 2 || args.length == 3) && args[0].equals("--launch-direct")) {
            System.exit(launchDirect(Path.of(args[1]), args.length == 3 ? initialBreakpoints(args[2]) : List.of()));
        }
        if ((args.length == 1 || args.length == 2) && args[0].equals("--listen-test")) {
            listenForTest(args.length == 2 ? initialBreakpoints(args[1]) : List.of());
            return;
        }
        if (args.length == 3 && args[0].equals("--attach")) {
            attach(args[1], args[2]);
            return;
        }
        if ((args.length != 1 && args.length != 2) || args[0].contains("\"") || args[0].contains("\n") || args[0].contains("\r"))
            throw new IllegalArgumentException("Unsupported private debugger launch path.");
        List<String[]> initial = args.length == 2 ? initialBreakpoints(args[1]) : List.of();
        LaunchingConnector connector = Bootstrap.virtualMachineManager().defaultConnector();
        Map<String, Connector.Argument> options = connector.defaultArguments();
        options.get("home").setValue(System.getProperty("java.home"));
        options.get("main").setValue("\"@" + args[0] + "\"");
        options.get("suspend").setValue("true");
        VirtualMachine vm = connector.launch(options);
        Process process = vm.process();
        System.exit(runOwned(vm, process, initial, output(process.getInputStream()), output(process.getErrorStream())));
    }

    /** A local JDK 8 or 11 can run the debuggee while this helper uses a newer JDK. */
    private static int launchDirect(Path argumentFile, List<String[]> initial) throws Exception {
        List<String> arguments = new ArrayList<>();
        for (String line : Files.readAllLines(argumentFile, StandardCharsets.US_ASCII)) {
            arguments.add(new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8));
        }
        if (arguments.size() < 2 || !Path.of(arguments.get(0)).isAbsolute())
            throw new IllegalArgumentException("Invalid private debugger launch arguments.");
        ListeningConnector connector = socketListener();
        Map<String, Connector.Argument> options = loopbackOptions(connector);
        String address = connector.startListening(options);
        Process process = null;
        try {
            VirtualMachine vm;
            Thread output, errors;
            try {
                arguments.add(1, "-agentlib:jdwp=transport=dt_socket,server=n,suspend=y,address=127.0.0.1:" + listenerPort(address));
                process = new ProcessBuilder(arguments).start();
                output = output(process.getInputStream());
                errors = output(process.getErrorStream());
                FutureTask<VirtualMachine> connection = new FutureTask<>(() -> connector.accept(options));
                Thread receiver = new Thread(connection, "IDE debuggee connection");
                receiver.setDaemon(true);
                receiver.start();
                while (true) {
                    try {
                        vm = connection.get(100, TimeUnit.MILLISECONDS);
                        break;
                    } catch (TimeoutException waiting) {
                        if (!process.isAlive()) {
                            output.join();
                            errors.join();
                            throw new IOException("The application exited before connecting to the debugger (exit " + process.exitValue() + ").");
                        }
                    }
                }
            } finally {
                connector.stopListening(options);
            }
            return runOwned(vm, process, initial, output, errors);
        } finally {
            if (process != null) process.destroyForcibly();
        }
    }

    private static int runOwned(VirtualMachine vm, Process process, List<String[]> initial, Thread output, Thread errors) throws Exception {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> process.destroyForcibly()));
        IdeJavaDebugger debugger = new IdeJavaDebugger(vm);
        for (String[] point : initial) debugger.addSourceBreakpoint(point[0], Integer.parseInt(point[1]), Integer.parseInt(point[2]), point.length >= 5 ? point[3] : "", point.length >= 5 ? Integer.parseInt(point[4]) : 0, point.length >= 6 ? point[5] : "");
        Thread commands = new Thread(debugger::commands, "IDE debugger commands");
        commands.setDaemon(true);
        commands.start();
        int exit;
        try {
            debugger.events();
            exit = process.waitFor();
            output.join();
            errors.join();
        } finally {
            process.destroyForcibly();
        }
        return exit;
    }

    private static ListeningConnector socketListener() {
        return Bootstrap.virtualMachineManager().listeningConnectors().stream()
            .filter(candidate -> candidate.name().equals("com.sun.jdi.SocketListen"))
            .findFirst().orElseThrow(() -> new IllegalStateException("The selected JDK has no JDI socket listener."));
    }

    private static Map<String, Connector.Argument> loopbackOptions(ListeningConnector connector) {
        Map<String, Connector.Argument> options = connector.defaultArguments();
        options.get("localAddress").setValue("127.0.0.1");
        options.get("port").setValue("0");
        options.get("timeout").setValue("120000");
        return options;
    }

    private static int listenerPort(String address) throws IOException {
        int port = Integer.parseInt(address.substring(address.lastIndexOf(':') + 1));
        if (port < 1 || port > 65535) throw new IOException("Invalid private JDWP listener port.");
        return port;
    }

    /** The build tool owns the test process; this helper reserves its JDWP endpoint. */
    private static void listenForTest(List<String[]> initial) throws Exception {
        ListeningConnector connector = socketListener();
        Map<String, Connector.Argument> options = loopbackOptions(connector);
        String address = connector.startListening(options);
        VirtualMachine vm;
        try {
            emit(map("kind", "testListener", "port", listenerPort(address)));
            vm = connector.accept(options);
        } finally {
            connector.stopListening(options);
        }
        java.util.concurrent.atomic.AtomicBoolean completed = new java.util.concurrent.atomic.AtomicBoolean();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            if (!completed.get()) try { vm.exit(1); } catch (VMDisconnectedException ignored) { }
        }, "IDE owned test JVM shutdown"));
        IdeJavaDebugger debugger = new IdeJavaDebugger(vm);
        for (String[] point : initial) debugger.addSourceBreakpoint(point[0], Integer.parseInt(point[1]), Integer.parseInt(point[2]), point.length >= 5 ? point[3] : "", point.length >= 5 ? Integer.parseInt(point[4]) : 0, point.length >= 6 ? point[5] : "");
        Thread commands = new Thread(debugger::commands, "IDE test debugger commands");
        commands.setDaemon(true);
        commands.start();
        try { debugger.events(); completed.set(true); }
        finally {
            try { if (completed.get()) vm.dispose(); else vm.exit(1); } catch (VMDisconnectedException ignored) { }
        }
        if (debugger.commandTransportFailed) throw new IOException("Test debugger command transport closed.");
    }

    private static void attach(String host, String port) throws Exception {
        if (host.isEmpty() || host.length() > 255 || !host.matches("[A-Za-z0-9._:\\[\\]-]+")
            || !port.matches("[0-9]{1,5}") || Integer.parseInt(port) < 1 || Integer.parseInt(port) > 65535)
            throw new IllegalArgumentException("Invalid JDWP socket endpoint.");
        AttachingConnector connector = Bootstrap.virtualMachineManager().attachingConnectors().stream()
            .filter(candidate -> candidate.name().equals("com.sun.jdi.SocketAttach"))
            .findFirst().orElseThrow(() -> new IllegalStateException("The selected JDK has no JDI socket attach connector."));
        Map<String, Connector.Argument> options = connector.defaultArguments();
        options.get("hostname").setValue(host);
        options.get("port").setValue(port);
        options.get("timeout").setValue("10000");
        VirtualMachine vm = connector.attach(options);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try { vm.dispose(); } catch (VMDisconnectedException ignored) { }
        }, "IDE JDI detach"));
        IdeJavaDebugger debugger = new IdeJavaDebugger(vm, false);
        synchronized (debugger.lock) {
            debugger.message = "Connected to JDWP " + host + ":" + port + ". The target JVM is external; application output and exit status remain with that process. Local source provenance is unverified.";
            debugger.publish();
        }
        Thread commands = new Thread(debugger::commands, "IDE debugger commands");
        commands.setDaemon(true);
        commands.start();
        try { debugger.events(); }
        finally { try { vm.dispose(); } catch (VMDisconnectedException ignored) { } }
        if (debugger.commandTransportFailed) throw new IOException("Debugger command transport closed.");
    }

    private static List<String[]> initialBreakpoints(String path) throws IOException {
        byte[] bytes;
        try (InputStream input = new FileInputStream(path)) { bytes = input.readNBytes(320 * 1024 + 1); }
        if (bytes.length > 320 * 1024) throw new IOException("Initial breakpoint settings exceed their limit.");
        String[] lines = new String(bytes, StandardCharsets.US_ASCII).split("\n", -1);
        if (lines.length > 130 || !(lines[0].equals("1") || lines[0].equals("2") || lines[0].equals("3")) || !lines[lines.length - 1].isEmpty())
            throw new IOException("Invalid initial breakpoint settings.");
        List<String[]> points = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (int i = 1; i < lines.length - 1; i++) {
            String[] fields = new String(Base64.getDecoder().decode(lines[i]), StandardCharsets.UTF_8).split("\0", -1);
            if (fields.length != (lines[0].equals("1") ? 3 : lines[0].equals("2") ? 5 : 6) || fields[0].isEmpty() || fields[0].length() > 1024 || !fields[0].endsWith(".java")
                || fields[0].startsWith("/") || fields[0].contains("\\") || fields[0].contains(":")
                || Arrays.stream(fields[0].split("/", -1)).anyMatch(part -> part.isEmpty() || part.equals(".") || part.equals(".."))
                || Integer.parseInt(fields[1]) <= 0 || Integer.parseInt(fields[2]) <= 0 || !seen.add(fields[0] + ":" + fields[1]))
                throw new IOException("Invalid initial source breakpoint.");
            if (fields.length == 5) {
                IdeJavaDebuggerExpressions.compile(fields[3]);
                int hits = Integer.parseInt(fields[4]);
                if (hits < 0 || hits > 1_000_000_000) throw new IOException("Invalid initial matching-hit condition.");
            } else if (fields.length == 6) {
                IdeJavaDebuggerExpressions.compile(fields[3]);
                int hits = Integer.parseInt(fields[4]);
                if (hits < 0 || hits > 1_000_000_000) throw new IOException("Invalid initial matching-hit condition.");
                compileLogMessage(fields[5]);
            }
            points.add(fields);
        }
        return points;
    }

    private void addSourceBreakpoint(String target, int line, int minimumComponents, String condition, int hitCount, String logMessage) throws Exception {
        String id = "source:" + target + ":" + line;
        if (breakpoints.containsKey(id)) return;
        if (breakpoints.size() >= 128) throw new IllegalArgumentException("The breakpoint limit is 128.");
        Breakpoint breakpoint = new Breakpoint(null, line);
        configure(breakpoint, condition, hitCount, logMessage);
        breakpoint.sourcePath = target; breakpoint.minimumComponents = minimumComponents;
        breakpoint.prepare = vm.eventRequestManager().createClassPrepareRequest();
        if (vm.canUseSourceNameFilters()) breakpoint.prepare.addSourceNameFilter(target.substring(target.lastIndexOf('/') + 1));
        breakpoint.prepare.setSuspendPolicy(EventRequest.SUSPEND_ALL); breakpoint.prepare.enable();
        breakpoints.put(id, breakpoint);
        for (ReferenceType type : vm.allClasses()) if (matches(breakpoint, type)) install(breakpoint, type);
    }

    private static Thread output(InputStream input) {
        Thread thread = new Thread(() -> {
            try (Reader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
                char[] buffer = new char[2048];
                String pending = "";
                for (int count; (count = reader.read(buffer)) >= 0;) {
                    if (count == 0) continue;
                    String text = pending + new String(buffer, 0, count); pending = "";
                    if (Character.isHighSurrogate(text.charAt(text.length() - 1))) {
                        pending = text.substring(text.length() - 1); text = text.substring(0, text.length() - 1);
                    }
                    if (!text.isEmpty()) emit(map("kind", "output", "text", text));
                }
                if (!pending.isEmpty()) emit(map("kind", "output", "text", "\ufffd"));
            } catch (IOException exception) {
                emit(map("kind", "output", "text", "Cannot read debuggee output.\n"));
            }
        }, "IDE debuggee output");
        thread.start();
        return thread;
    }

    private void events() throws Exception {
        try {
            while (true) {
                EventSet set = vm.eventQueue().remove();
                synchronized (lock) {
                    ThreadReference stopped = null;
                    String stoppedReason = null;
                    String breakpointError = null;
                    boolean ended = false;
                    boolean changed = false;
                    for (Event event : set) {
                        if (event instanceof VMStartEvent start && set.suspendPolicy() != EventRequest.SUSPEND_NONE) { stopped = start.thread(); stoppedReason = "entry"; }
                        else if (event instanceof ClassPrepareEvent prepare) {
                            changed = true;
                            for (Breakpoint breakpoint : breakpoints.values())
                                if (matches(breakpoint, prepare.referenceType())) install(breakpoint, prepare.referenceType());
                        } else if (event instanceof BreakpointEvent breakpoint) {
                            Breakpoint point = (Breakpoint) breakpoint.request().getProperty("ide.breakpoint");
                            if (point == null || !breakpoints.containsValue(point) || (breakpointsMuted && !point.temporary)) continue;
                            try {
                                if (matchesCondition(point, breakpoint.thread())) { stopped = breakpoint.thread(); stoppedReason = "breakpoint"; }
                            } catch (Exception exception) {
                                breakpointError = "Breakpoint evaluation failed: " + bounded(exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage(), 1024);
                                if (point != null) point.message = breakpointError;
                                stopped = breakpoint.thread(); stoppedReason = "breakpoint";
                            }
                        }
                        else if (event instanceof StepEvent step) {
                            vm.eventRequestManager().deleteEventRequest(step.request());
                            stopped = step.thread(); stoppedReason = "step";
                        } else if (event instanceof ExceptionEvent exception && matchesException(exception)) {
                            stopped = exception.thread(); stoppedReason = "exception";
                            message = "Exception: " + bounded(exception.exception().referenceType().name(), 512);
                        } else if (event instanceof VMDeathEvent || event instanceof VMDisconnectEvent) ended = true;
                    }
                    if (ended) { clearTemporaryBreakpoints(); invalidate("terminated"); publish(); return; }
                    if (stopped != null) {
                        clearTemporaryBreakpoints();
                        suspend(stopped, stoppedReason, breakpointError);
                    }
                    else {
                        set.resume();
                        if (changed) publish();
                    }
                }
            }
        } catch (VMDisconnectedException exception) {
            synchronized (lock) { invalidate("terminated"); publish(); }
        }
    }

    private void suspend(ThreadReference thread, String why) throws IncompatibleThreadStateException {
        suspend(thread, why, null);
    }
    private void suspend(ThreadReference thread, String why, String conditionError) throws IncompatibleThreadStateException {
        status = "suspended"; reason = why; stopId = "stop-" + (++stopSequence); evaluation = null;
        selectedThread = Long.toString(thread.uniqueID()); selectedFrame = null;
        references.clear(); variablePage = null; frames.clear(); error = conditionError;
        if (!"exception".equals(why)) message = null;
        loadFrames(thread);
        publish();
    }

    private void invalidate(String next) {
        status = next; reason = null; stopId = null; selectedThread = null; selectedFrame = null;
        references.clear(); variablePage = null; frames.clear(); evaluation = null; message = null; error = null;
    }

    private void loadFrames(ThreadReference thread) throws IncompatibleThreadStateException {
        frames.clear(); references.clear(); variablePage = null;
        int count = Math.min(thread.frameCount(), FRAME_LIMIT);
        List<StackFrame> loaded = thread.frames(0, count);
        for (int index = 0; index < loaded.size(); index++)
            frames.put(stopId + ":" + thread.uniqueID() + ":" + index, loaded.get(index));
        selectedFrame = frames.isEmpty() ? null : frames.keySet().iterator().next();
        if (thread.frameCount() > FRAME_LIMIT) message = "Only the first 128 stack frames are shown.";
    }

    private void commands() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII))) {
            for (String line; (line = reader.readLine()) != null;) {
                if (line.length() > 3072) throw new IOException("Debugger command too large.");
                String[] fields = new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8).split("\0", -1);
                boolean runToCursorCommand = fields[0].equals("runToCursor");
                boolean sourceCommand = runToCursorCommand || fields[0].endsWith("SourceBreakpoint");
                if (!(runToCursorCommand ? fields.length == 6 : sourceCommand ? fields.length == 6 || fields.length == 8 || fields.length == 9 : fields[0].equals("setBreakpoint") ? fields.length == 6 || fields.length == 7 : fields[0].equals("exceptions") ? fields.length == 4 || fields.length == 6 : fields[0].equals("step") ? fields.length >= 4 && fields.length <= 20 : fields.length == (fields[0].equals("reloadClasses") ? 6 : fields[0].equals("setLocalValue") ? 5 : 4))) throw new IOException("Invalid debugger command framing.");
                synchronized (lock) {
                    boolean sourceCurrent = !sourceCommand || sourceCurrent(fields);
                    try { command(fields); }
                    catch (Exception exception) {
                        // A command from an earlier stop cannot replace a later stop's observation.
                        if (sourceCurrent && (fields[1].isEmpty() || fields[1].equals(stopId))) {
                            error = bounded(exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage(), 1024);
                            publish();
                        }
                    }
                }
            }
            try { if (ownsTarget) vm.exit(1); else vm.dispose(); } catch (VMDisconnectedException ignored) { }
        } catch (Exception exception) {
            commandTransportFailed = true;
            emit(map("kind", "output", "text", "Debugger command transport closed.\n"));
            try { if (ownsTarget) vm.exit(1); else vm.dispose(); } catch (Exception ignored) { }
        }
    }

    private void requireStop(String expected) {
        if (!"suspended".equals(status) || expected.isEmpty() || !expected.equals(stopId))
            throw new IllegalArgumentException("The debugger stop is obsolete; refresh the suspended session.");
    }

    private boolean canDropSelectedFrame() {
        if (!status.equals("suspended") || !vm.canBeModified() || !vm.canPopFrames()) return false;
        List<String> ids = new ArrayList<>(frames.keySet());
        int index = ids.indexOf(selectedFrame);
        if (index < 0 || index + 1 >= ids.size()) return false;
        // JDI requires the removed frames and the surviving caller to be non-native.
        // A caller outside our bounded captured stack is deliberately unavailable.
        for (int i = 0; i <= index + 1; i++)
            if (frames.get(ids.get(i)).location().method().isNative()) return false;
        return true;
    }

    private boolean matchesException(ExceptionEvent event) {
        if (exceptionClassName.isEmpty()) return true;
        ReferenceType type = event.exception().referenceType();
        while (type != null) {
            if (exceptionClassName.equals(type.name())) return true;
            if (!exceptionIncludeSubclasses) return false;
            type = type instanceof ClassType cls ? cls.superclass() : null;
        }
        return false;
    }

    private void command(String[] fields) throws Exception {
        String action = fields[0], expected = fields[1], target = fields[2];
        if (action.equals("reloadClasses")) { reloadClasses(fields); return; }
        int number = Integer.parseInt(fields[3]);
        if (action.equals("muteBreakpoints")) {
            if (!target.equals("true") && !target.equals("false")) throw new IllegalArgumentException("Invalid breakpoint mute setting.");
            breakpointsMuted = Boolean.parseBoolean(target);
            for (Breakpoint breakpoint : breakpoints.values()) updateBreakpointRequests(breakpoint);
            error = null;
            publish(); return;
        }
        if (action.equals("listLoadedClasses")) {
            error = null;
            listLoadedClasses();
            publish();
            return;
        }
        if ((action.endsWith("SourceBreakpoint") || action.equals("runToCursor")) && !sourceCurrent(fields)) throw new IllegalArgumentException("The debugger source request is obsolete.");
        error = null;
        if (action.equals("setSourceBreakpoint")) {
            addSourceBreakpoint(target, number, Integer.parseInt(fields[4]), fields.length >= 8 ? fields[6] : "", fields.length >= 8 ? Integer.parseInt(fields[7]) : 0, fields.length >= 9 ? fields[8] : "");
            publish(); return;
        }
        if (action.equals("runToCursor")) {
            requireStop(expected);
            String id = "source:" + target + ":" + number;
            if (breakpoints.containsKey(id)) throw new IllegalArgumentException("A breakpoint already exists on this line.");
            try {
                addSourceBreakpoint(target, number, Integer.parseInt(fields[4]), "", 1, "");
                Breakpoint temporary = breakpoints.get(id);
                if (temporary == null) throw new IllegalStateException("The temporary source breakpoint could not be installed.");
                temporary.temporary = true;
                updateBreakpointRequests(temporary);
                vm.resume();
                invalidate("running");
                publish();
            } catch (Exception exception) {
                removeBreakpoint(id);
                throw exception;
            }
            return;
        }
        if (action.equals("clearSourceBreakpoint")) {
            Breakpoint breakpoint = breakpoints.remove("source:" + target + ":" + number);
            if (breakpoint != null) { vm.eventRequestManager().deleteEventRequests(breakpoint.requests); vm.eventRequestManager().deleteEventRequest(breakpoint.prepare); }
            publish(); return;
        }
        if (action.equals("clearClassSourceBreakpoint")) {
            Breakpoint breakpoint = breakpoints.remove(target + ":" + number);
            if (breakpoint != null) { vm.eventRequestManager().deleteEventRequests(breakpoint.requests); vm.eventRequestManager().deleteEventRequest(breakpoint.prepare); }
            publish(); return;
        }
        if (action.equals("setBreakpoint")) {
            String id = target + ":" + number;
            if (breakpoints.containsKey(id)) { configure(breakpoints.get(id), fields[4], Integer.parseInt(fields[5]), fields.length >= 7 ? fields[6] : ""); publish(); return; }
            if (breakpoints.size() >= 128) throw new IllegalArgumentException("The breakpoint limit is 128.");
            Breakpoint breakpoint = new Breakpoint(target, number);
            configure(breakpoint, fields[4], Integer.parseInt(fields[5]), fields.length >= 7 ? fields[6] : "");
            breakpoint.prepare = vm.eventRequestManager().createClassPrepareRequest();
            breakpoint.prepare.addClassFilter(target);
            breakpoint.prepare.setSuspendPolicy(EventRequest.SUSPEND_ALL);
            breakpoint.prepare.enable();
            breakpoints.put(id, breakpoint);
            for (ReferenceType type : vm.classesByName(target)) install(breakpoint, type);
            publish(); return;
        }
        if (action.equals("clearBreakpoint")) {
            Breakpoint breakpoint = breakpoints.remove(target + ":" + number);
            if (breakpoint != null) {
                vm.eventRequestManager().deleteEventRequests(breakpoint.requests);
                vm.eventRequestManager().deleteEventRequest(breakpoint.prepare);
            }
            publish(); return;
        }
        if (action.equals("exceptions")) {
            String className = fields.length == 6 ? fields[4] : "";
            boolean subclasses = fields.length == 4 || fields[5].equals("true");
            if (!Set.of("none", "caught", "uncaught", "all").contains(target)
                || (!className.isEmpty() && (className.getBytes(StandardCharsets.UTF_8).length > 512
                    || !className.matches("[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*(?:\\.[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*)*")))
                || (fields.length == 6 && !Set.of("true", "false").contains(fields[5])))
                throw new IllegalArgumentException("Invalid exception class filter.");
            vm.eventRequestManager().deleteEventRequests(new ArrayList<>(vm.eventRequestManager().exceptionRequests()));
            if (!target.equals("none")) {
                ExceptionRequest request = vm.eventRequestManager().createExceptionRequest(null, target.equals("caught") || target.equals("all"), target.equals("uncaught") || target.equals("all"));
                request.setSuspendPolicy(EventRequest.SUSPEND_ALL); request.enable();
            }
            exceptionMode = target;
            exceptionClassName = className;
            exceptionIncludeSubclasses = subclasses;
            publish(); return;
        }
        if (action.equals("pause")) {
            if (!"running".equals(status)) throw new IllegalArgumentException("The JVM is already suspended or terminated.");
            clearTemporaryBreakpoints();
            vm.suspend();
            ThreadReference thread = vm.allThreads().stream().filter(t -> t.name().equals("main")).findFirst().orElse(null);
            if (thread == null) { vm.resume(); throw new IllegalStateException("No main thread is available for Pause."); }
            suspend(thread, "pause"); return;
        }
        requireStop(expected);
        if (action.equals("dropFrame")) {
            if (!Objects.equals(target, selectedFrame) || !canDropSelectedFrame())
                throw new IllegalArgumentException("The selected frame cannot be removed at this suspension.");
            StackFrame frame = frames.get(target);
            ThreadReference thread = frame.thread();
            thread.popFrames(frame);
            clearTemporaryBreakpoints();
            vm.eventRequestManager().deleteEventRequests(new ArrayList<>(vm.eventRequestManager().stepRequests()));
            suspend(thread, "frame-drop"); return;
        }
        if (action.equals("continue") || action.equals("step")) {
            if (action.equals("step")) {
                for (int index = 4; index < fields.length; index++) {
                    String pattern = fields[index];
                    String core = pattern.startsWith("*") ? pattern.substring(1) : pattern.endsWith("*") ? pattern.substring(0, pattern.length() - 1) : pattern;
                    if (pattern.getBytes(StandardCharsets.UTF_8).length > 512 || core.isEmpty() || !core.matches("[\\p{L}\\p{N}._$]+"))
                        throw new IllegalArgumentException("Invalid step exclusion pattern.");
                }
                StackFrame frame = frames.get(selectedFrame);
                if (frame == null) throw new IllegalArgumentException("Select a suspended frame before stepping.");
                ThreadReference thread = frame.thread();
                if (!selectedFrame.endsWith(":0")) throw new IllegalArgumentException("Step requires the top frame of the selected thread.");
                vm.eventRequestManager().deleteEventRequests(new ArrayList<>(vm.eventRequestManager().stepRequests()));
                int depth = target.equals("into") ? StepRequest.STEP_INTO : target.equals("over") ? StepRequest.STEP_OVER : StepRequest.STEP_OUT;
                StepRequest step = vm.eventRequestManager().createStepRequest(thread, StepRequest.STEP_LINE, depth);
                for (int index = 4; index < fields.length; index++) step.addClassExclusionFilter(fields[index]);
                step.addCountFilter(1); step.setSuspendPolicy(EventRequest.SUSPEND_ALL); step.enable();
            }
            invalidate("running"); publish(); vm.resume(); return;
        }
        if (action.equals("selectThread")) {
            ThreadReference thread = vm.allThreads().stream().filter(t -> Long.toString(t.uniqueID()).equals(target)).findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown thread."));
            if (!thread.isSuspended()) throw new IllegalArgumentException("The selected thread is not suspended.");
            selectedThread = target; message = null; evaluation = null; loadFrames(thread); publish(); return;
        }
        if (action.equals("selectFrame")) {
            if (!frames.containsKey(target)) throw new IllegalArgumentException("Unknown or obsolete frame.");
            selectedFrame = target; references.clear(); variablePage = null; evaluation = null; message = null; publish(); return;
        }
        if (action.equals("variables")) { expand(target, number); publish(); return; }
        if (action.equals("evaluate")) { evaluateExpression(target); publish(); return; }
        if (action.equals("setLocalValue")) { setLocalValue(target, fields[4]); publish(); return; }
        if (action.equals("watch")) {
            if (target.isBlank()) throw new IllegalArgumentException("Enter a debugger watch expression.");
            IdeJavaDebuggerExpressions.compile(target);
            if (watches.size() >= 32 && !watches.contains(target)) throw new IllegalArgumentException("The watch limit is 32.");
            watches.add(target); publish(); return;
        }
        if (action.equals("removeWatch")) { watches.remove(target); publish(); return; }
        throw new IllegalArgumentException("Unsupported JDI action.");
    }

    private void removeBreakpoint(String id) {
        Breakpoint breakpoint = breakpoints.remove(id);
        if (breakpoint == null) return;
        try { vm.eventRequestManager().deleteEventRequests(breakpoint.requests); } catch (VMDisconnectedException ignored) { }
        if (breakpoint.prepare != null) {
            try { vm.eventRequestManager().deleteEventRequest(breakpoint.prepare); } catch (VMDisconnectedException ignored) { }
        }
    }

    private void clearTemporaryBreakpoints() {
        for (Map.Entry<String, Breakpoint> entry : new ArrayList<>(breakpoints.entrySet()))
            if (entry.getValue().temporary) removeBreakpoint(entry.getKey());
    }

    private static boolean supportedBinaryName(String name) {
        if (name.isEmpty() || name.getBytes(StandardCharsets.UTF_8).length > 512) return false;
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

    private void listLoadedClasses() {
        SortedMap<String, Integer> counts = new TreeMap<>();
        boolean unsupportedNameOmitted = false;
        for (ReferenceType type : vm.allClasses()) {
            if (!type.isPrepared()) continue;
            String name = type.name();
            if (type instanceof ArrayType) continue;
            if (!supportedBinaryName(name)) {
                unsupportedNameOmitted = true;
                continue;
            }
            counts.merge(name, 1, Integer::sum);
        }
        loadedClassesTruncated = unsupportedNameOmitted || counts.size() > LOADED_CLASS_LIMIT;
        List<Object> result = new ArrayList<>();
        for (Map.Entry<String, Integer> item : counts.entrySet()) {
            if (result.size() == LOADED_CLASS_LIMIT) break;
            result.add(map("className", displayText(bounded(item.getKey(), 512)), "classLoaderCount", item.getValue()));
        }
        loadedClasses = result;
    }

    private void reloadClasses(String[] fields) {
        List<String> names = new ArrayList<>();
        boolean requestCurrent = fields[1].isEmpty() ? status.equals("running") : fields[1].equals(stopId);
        boolean applied = false;
        String failure = null;
        try {
            if (!fields[4].matches("reload-[0-9]+") || !fields[5].matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid class reload identity.");
            if (fields[1].isEmpty()) {
                if (!status.equals("running")) throw new IllegalArgumentException("The running debugger state changed before class reload.");
            } else requireStop(fields[1]);
            if (!vm.canRedefineClasses() || !vm.canBeModified()) throw new UnsupportedOperationException("This JVM does not support class redefinition.");
            Path path = Path.of(fields[2]);
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Class reload storage is unavailable.");
            byte[] captured;
            try (InputStream input = Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS)) {
                captured = input.readNBytes(12 * 1024 * 1024 + 1);
            }
            if (captured.length > 12 * 1024 * 1024 || !HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(captured)).equals(fields[5])) throw new IOException("Class reload storage changed or exceeded its limit.");
            String[] lines = new String(captured, StandardCharsets.US_ASCII).split("\n", -1);
            if (!lines[0].equals("IDE JDI class reload 1") || lines.length < 3 || lines.length > 34 || !lines[lines.length - 1].isEmpty()) throw new IOException("Invalid class reload file.");
            Map<ReferenceType, byte[]> definitions = new LinkedHashMap<>();
            int total = 0;
            for (int index = 1; index < lines.length - 1; index++) {
                String[] parts = lines[index].split("\t", -1);
                if (parts.length != 2) throw new IOException("Invalid compiled class entry.");
                String name = new String(Base64.getDecoder().decode(parts[0]), StandardCharsets.UTF_8);
                byte[] bytes = Base64.getDecoder().decode(parts[1]);
                total += bytes.length;
                if (name.isEmpty() || name.length() > 512 || names.contains(name) || bytes.length > 1024 * 1024 || total > 8 * 1024 * 1024) throw new IOException("Compiled class reload exceeded its limits.");
                names.add(name);
                List<ReferenceType> types = vm.classesByName(name);
                if (types.size() != 1 || !types.get(0).isPrepared()) throw new IllegalArgumentException("Class " + name + " is not uniquely loaded and prepared; reload cannot choose a class loader.");
                definitions.put(types.get(0), bytes);
            }
            vm.redefineClasses(definitions);
            applied = true;
            String warning = "";
            for (Iterator<Breakpoint> iterator = breakpoints.values().iterator(); iterator.hasNext();) {
                Breakpoint point = iterator.next();
                if (point.sourcePath != null || names.contains(point.className)) {
                    iterator.remove();
                    try {
                        vm.eventRequestManager().deleteEventRequests(point.requests);
                        vm.eventRequestManager().deleteEventRequest(point.prepare);
                    } catch (RuntimeException exception) { warning = " Runtime breakpoint cleanup needs a debugger restart."; }
                }
            }
            references.clear(); variablePage = null; frames.clear(); selectedFrame = null; evaluation = null;
            if (status.equals("suspended")) {
                stopId = "stop-" + (++stopSequence);
                ThreadReference thread = vm.allThreads().stream().filter(candidate -> Long.toString(candidate.uniqueID()).equals(selectedThread)).findFirst().orElseThrow(() -> new IllegalStateException("Selected suspended thread is unavailable after reload."));
                loadFrames(thread);
            }
            error = null;
            message = "JDI accepted " + names.size() + " reloaded class(es). New invocations use the new methods; active obsolete frames retain their old code. Review runtime breakpoints; local source binding was retired." + warning;
        } catch (Exception | LinkageError exception) {
            String detail = exception.getClass().getSimpleName() + (exception.getMessage() == null ? "" : ": " + exception.getMessage());
            failure = bounded(displayText(detail), 1024);
            if (requestCurrent || applied) error = failure;
            if (applied) message = "JDI accepted the classes, but refreshing debugger presentation failed. Restart the debugger before further inspection.";
        }
        emit(map("kind", "classReload", "result", map("requestId", fields[4], "status", applied ? "applied" : "failed", "classes", names, "error", applied ? null : failure)));
        publish();
    }

    private boolean matches(Breakpoint breakpoint, ReferenceType type) {
        if (breakpoint.className != null) return breakpoint.className.equals(type.name());
        try {
            for (String path : type.sourcePaths("Java")) {
                path = path.replace('\\', '/');
                if (breakpoint.sourcePath.equals(path) || breakpoint.sourcePath.endsWith("/" + path)) {
                    if (path.split("/").length >= breakpoint.minimumComponents) return true;
                    breakpoint.message = "Runtime source path is ambiguous between captured workspace files.";
                }
            }
        } catch (AbsentInformationException | ClassNotPreparedException ignored) { }
        return false;
    }

    private boolean sourceCurrent(String[] fields) {
        return Objects.equals(stopId, fields[1].isEmpty() ? null : fields[1]) && Objects.equals(selectedFrame, fields[5].isEmpty() ? null : fields[5]);
    }

    private void install(Breakpoint breakpoint, ReferenceType type) {
        try {
            List<Location> locations = type.locationsOfLine(breakpoint.line);
            if (locations.isEmpty()) { if (!breakpoint.verified) breakpoint.message = "No executable location exists at this line."; return; }
            for (Location location : locations) {
                if (breakpoint.requests.stream().anyMatch(request -> request.location().equals(location))) continue;
                BreakpointRequest request = vm.eventRequestManager().createBreakpointRequest(location);
                request.putProperty("ide.breakpoint", breakpoint);
                request.setSuspendPolicy(EventRequest.SUSPEND_ALL);
                if ((!breakpointsMuted || breakpoint.temporary) && (breakpoint.hitCount == 0 || breakpoint.hits < breakpoint.hitCount)) request.enable();
                breakpoint.requests.add(request);
            }
            breakpoint.verified = true; breakpoint.message = null;
        } catch (AbsentInformationException exception) { if (!breakpoint.verified) breakpoint.message = "Line information is unavailable in this class."; }
    }

    private void configure(Breakpoint breakpoint, String condition, int hitCount, String logMessage) {
        IdeJavaDebuggerExpressions.Expression expression = IdeJavaDebuggerExpressions.compile(condition);
        List<LogPart> logTemplate = compileLogMessage(logMessage);
        if (hitCount < 0 || hitCount > 1_000_000_000) throw new IllegalArgumentException("Matching-hit count must be between zero and 1,000,000,000.");
        breakpoint.condition = condition; breakpoint.hitCount = hitCount; breakpoint.hits = 0; breakpoint.expression = expression; breakpoint.logMessage = logMessage; breakpoint.logTemplate = logTemplate;
        if (breakpoint.verified) breakpoint.message = null;
        updateBreakpointRequests(breakpoint);
    }
    private void updateBreakpointRequests(Breakpoint breakpoint) {
        boolean enabled = (!breakpointsMuted || breakpoint.temporary) &&
            (breakpoint.hitCount == 0 || breakpoint.hits < breakpoint.hitCount);
        for (BreakpointRequest request : breakpoint.requests) request.setEnabled(enabled);
    }
    private boolean matchesCondition(Breakpoint breakpoint, ThreadReference thread) throws Exception {
        if (breakpoint == null) throw new IllegalArgumentException("Breakpoint settings are unavailable.");
        if (breakpoint.hitCount > 0 && breakpoint.hits >= breakpoint.hitCount) return false;
        StackFrame frame = thread.frame(0);
        boolean accepted = IdeJavaDebuggerExpressions.truth(breakpoint.expression.evaluate(expressionResolver(frame)));
        if (breakpoint.verified) breakpoint.message = null;
        if (!accepted) return false;
        if (breakpoint.hits >= 1_000_000_000) throw new IllegalArgumentException("The matching-hit counter reached its limit. Reset the breakpoint before continuing.");
        breakpoint.hits++;
        boolean finalHit = breakpoint.hitCount > 0 && breakpoint.hits == breakpoint.hitCount;
        if (finalHit) {
            for (BreakpointRequest request : breakpoint.requests) request.disable();
        }
        if (!breakpoint.logMessage.isEmpty()) {
            if (breakpoint.hitCount == 0 || finalHit) {
                String location = breakpoint.sourcePath != null ? breakpoint.sourcePath : breakpoint.className;
                emit(map("kind", "logpoint", "text", location + ":" + breakpoint.line + ": " + renderLogMessage(breakpoint, frame)));
            }
            return false;
        }
        if (finalHit) return true;
        return breakpoint.hitCount == 0;
    }

    private static List<LogPart> compileLogMessage(String template) {
        if (template.getBytes(StandardCharsets.UTF_8).length > 512 || template.indexOf('\0') >= 0 || template.indexOf('\n') >= 0 || template.indexOf('\r') >= 0)
            throw new IllegalArgumentException("Log messages are limited to 512 UTF-8 bytes on one line.");
        List<LogPart> parts = new ArrayList<>();
        StringBuilder literal = new StringBuilder();
        int interpolations = 0;
        for (int index = 0; index < template.length();) {
            char character = template.charAt(index);
            if (character == '}') throw new IllegalArgumentException("A log message contains an unmatched closing brace.");
            if (character != '{') { literal.append(character); index++; continue; }
            int end = template.indexOf('}', index + 1);
            if (end < 0 || template.substring(index + 1, end).contains("{"))
                throw new IllegalArgumentException("A log message placeholder must use {readOnlyExpression}.");
            String expression = template.substring(index + 1, end).trim();
            if (expression.isEmpty()) throw new IllegalArgumentException("A log message placeholder cannot be empty.");
            if (++interpolations > 16) throw new IllegalArgumentException("A log message supports at most 16 value placeholders.");
            parts.add(new LogPart(literal.toString(), null));
            literal.setLength(0);
            parts.add(new LogPart(null, IdeJavaDebuggerExpressions.compile(expression)));
            index = end + 1;
        }
        parts.add(new LogPart(literal.toString(), null));
        return List.copyOf(parts);
    }

    private String renderLogMessage(Breakpoint breakpoint, StackFrame frame) throws Exception {
        StringBuilder result = new StringBuilder();
        for (LogPart part : breakpoint.logTemplate) {
            if (part.expression() == null) result.append(part.literal());
            else {
                Object value = part.expression().evaluate(expressionResolver(frame));
                String text;
                if (value == null) text = "null";
                else if (value instanceof IdeJavaDebuggerExpressions.ExpressionString string) text = string.value();
                else if (value instanceof IdeJavaDebuggerExpressions.ExpressionCharacter character) text = String.valueOf(character.value());
                else if (value instanceof IdeJavaDebuggerExpressions.ExpressionWrapper wrapper) {
                    Object primitive = wrapper.value();
                    text = primitive instanceof IdeJavaDebuggerExpressions.ExpressionCharacter character
                        ? String.valueOf(character.value())
                        : String.valueOf(primitive);
                }
                else if (value instanceof StringReference string) text = string.value();
                else if (value instanceof ObjectReference object) text = object.referenceType().name() + " @" + object.uniqueID();
                else text = String.valueOf(value);
                result.append(displayText(bounded(text, 256)));
            }
            if (result.length() > 4096) throw new IllegalArgumentException("Rendered log message exceeds its 4096-character limit.");
        }
        return result.toString();
    }

    private Object variable(String name, String declaredType, Value value) {
        String type = value == null ? declaredType : value.type().name();
        String display;
        String reference = null;
        int children = 0;
        boolean truncated = false;
        if (value == null) display = "null";
        else if (value instanceof StringReference string) {
            String literal = string.value(); truncated = literal.length() > 256;
            display = "\"" + displayText(bounded(literal, 256), true) + "\"";
        }
        else if (value instanceof ObjectReference object) {
            display = type + " @" + object.uniqueID();
            if (object instanceof ArrayReference array) { children = array.length(); display += " [" + children + "]"; }
            else children = object.referenceType().allFields().size();
            if (children > 0 && references.size() < 1024) {
                reference = stopId + ":object:" + object.uniqueID(); references.put(reference, object);
            }
        } else display = value.toString(); // PrimitiveValue formatting does not execute debuggee code.
        return map("name", bounded(displayText(name), 512), "type", bounded(displayText(type), 512), "value", bounded(display, 512), "valueTruncated", display.length() > 512 || truncated, "reference", reference, "childCount", children);
    }

    private void expand(String reference, int start) {
        ObjectReference object = references.get(reference);
        if (object == null) throw new IllegalArgumentException("Unknown or obsolete object reference.");
        List<Object> children = new ArrayList<>();
        int total;
        if (object instanceof ArrayReference array) {
            total = array.length();
            if (start < 0 || start > total) throw new IllegalArgumentException("Invalid array page.");
            int end = Math.min(total, start + PAGE_SIZE);
            for (int index = start; index < end; index++) children.add(variable("[" + index + "]", ((ArrayType) array.type()).componentTypeName(), array.getValue(index)));
        } else {
            List<Field> fields = object.referenceType().allFields(); total = fields.size();
            if (start < 0 || start > total) throw new IllegalArgumentException("Invalid field page.");
            int end = Math.min(total, start + PAGE_SIZE);
            for (Field field : fields.subList(start, end))
                children.add(variable(field.declaringType().name() + "." + field.name(), field.typeName(), field.isStatic() ? field.declaringType().getValue(field) : object.getValue(field)));
        }
        variablePage = map("reference", reference, "start", start, "total", total, "variables", children);
    }

    private Value watchValue(StackFrame frame, String path) throws Exception {
        Matcher first = Pattern.compile("[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*").matcher(path);
        if (!first.lookingAt()) throw new IllegalArgumentException("Invalid watch path.");
        String name = first.group(); Value value;
        if (name.equals("this")) value = frame.thisObject();
        else {
            LocalVariable local;
            try { local = frame.visibleVariableByName(name); }
            catch (AbsentInformationException exception) { local = null; }
            if (local == null) return staticWatchValue(path);
            value = frame.getValue(local);
        }
        return accessPath(value, path, first.end());
    }

    private Value accessPath(Value value, String path, int offset) throws Exception {
        while (offset < path.length()) {
            if (path.charAt(offset) == '[') {
                int end = path.indexOf(']', offset);
                if (end < 0) throw new IllegalArgumentException("Invalid array index.");
                int index = Integer.parseInt(path.substring(offset + 1, end));
                if (!(value instanceof ArrayReference array)) throw new IllegalArgumentException("The watch value is not an array.");
                value = array.getValue(index); offset = end + 1;
            } else {
                if (path.charAt(offset) != '.') throw new IllegalArgumentException("Invalid field path.");
                Matcher fieldName = Pattern.compile("[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*").matcher(path.substring(offset + 1));
                if (!fieldName.lookingAt() || !(value instanceof ObjectReference object)) throw new IllegalArgumentException("The watch value has no field.");
                if (object instanceof ArrayReference array && fieldName.group().equals("length")) { value = vm.mirrorOf(array.length()); offset += 1 + fieldName.end(); continue; }
                Field field = object.referenceType().fieldByName(fieldName.group());
                if (field == null) throw new IllegalArgumentException("Unknown field.");
                value = field.isStatic() ? field.declaringType().getValue(field) : object.getValue(field);
                offset += 1 + fieldName.end();
            }
        }
        return value;
    }

    private Value staticWatchValue(String path) throws Exception {
        Pattern identifier = Pattern.compile("[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*");
        for (int separator = path.lastIndexOf('.'); separator > 0; separator = path.lastIndexOf('.', separator - 1)) {
            String className = path.substring(0, separator);
            List<ReferenceType> types = loadedTypes(className);
            if (types.isEmpty()) continue;
            if (types.size() != 1)
                throw new IllegalArgumentException("The static field's declaring class is ambiguous across class loaders.");
            ReferenceType type = types.get(0);
            if (!type.isInitialized())
                throw new IllegalArgumentException("The static field's declaring class has not initialized.");
            String memberPath = path.substring(separator + 1);
            Matcher member = identifier.matcher(memberPath);
            if (!member.lookingAt()) throw new IllegalArgumentException("The static field path has no field name.");
            Field field = type.fieldByName(member.group());
            if (field == null || !field.isStatic())
                throw new IllegalArgumentException("The path does not identify a static field.");
            Value value = field.declaringType().getValue(field);
            return accessPath(value, memberPath, member.end());
        }
        throw new IllegalArgumentException("A local variable or loaded static field is unavailable in this frame.");
    }

    private IdeJavaDebuggerExpressions.Resolver expressionResolver(StackFrame frame) {
        return new IdeJavaDebuggerExpressions.Resolver() {
            @Override public Object value(String path) throws Exception {
                return IdeJavaDebuggerExpressions.mirror(watchValue(frame, path));
            }
            @Override public Object memberPath(Object value, String path) throws Exception {
                if (value instanceof IdeJavaDebuggerExpressions.ExpressionWrapper wrapper)
                    value = wrapper.reference();
                else if (value instanceof IdeJavaDebuggerExpressions.ExpressionString string)
                    value = string.reference();
                if (!(value instanceof ObjectReference object))
                    throw new IllegalArgumentException("An object member read requires a captured reference.");
                return IdeJavaDebuggerExpressions.mirror(accessPath(object, "." + path, 0));
            }
            @Override public boolean instanceOf(Object value, String typeName) throws Exception {
                return evaluateInstanceOf(frame, value, typeName);
            }
        };
    }

    private boolean evaluateInstanceOf(StackFrame frame, Object value, String typeName) throws Exception {
        if (value == null) {
            ReferenceType context = frame.location().declaringType();
            uniqueType(typeName, context);
            return false;
        }
        ReferenceType source;
        if (value instanceof IdeJavaDebuggerExpressions.ExpressionWrapper wrapper) {
            if (wrapper.reference() == null)
                throw new IllegalArgumentException("The wrapper's runtime reference is unavailable.");
            source = wrapper.reference().referenceType();
        } else if (value instanceof IdeJavaDebuggerExpressions.ExpressionString string) {
            if (string.reference() != null) source = string.reference().referenceType();
            else source = uniqueType("java.lang.String", null);
        } else if (value instanceof ObjectReference object) {
            source = object.referenceType();
        } else {
            throw new IllegalArgumentException("instanceof requires a reference value.");
        }
        if (!(source instanceof ArrayType) && !source.isPrepared())
            throw new IllegalArgumentException("The value's runtime type is not prepared by the JVM.");
        ReferenceType target = uniqueType(typeName, source);
        return assignable(source, target, new HashSet<>());
    }

    private ReferenceType uniqueType(String name, ReferenceType source) {
        List<ReferenceType> candidates = new ArrayList<>();
        ClassLoaderReference loader = source == null ? null : source.classLoader();
        for (String candidateName : typeNameCandidates(name)) {
            if (loader != null) {
                for (ReferenceType type : loader.visibleClasses())
                    if (type.name().equals(candidateName) && !candidates.contains(type)) candidates.add(type);
            } else {
                for (ReferenceType type : vm.classesByName(candidateName))
                    if (!candidates.contains(type)) candidates.add(type);
            }
            if (!candidates.isEmpty()) break;
        }
        if (candidates.isEmpty())
            throw new IllegalArgumentException("The referenced type is not loaded and visible in the debuggee: " + name);
        if (candidates.size() != 1)
            throw new IllegalArgumentException("The referenced type is ambiguous across class loaders: " + name);
        return candidates.get(0);
    }

    private List<ReferenceType> loadedTypes(String name) {
        for (String candidateName : typeNameCandidates(name)) {
            List<ReferenceType> types = vm.classesByName(candidateName);
            if (!types.isEmpty()) return types;
        }
        return List.of();
    }

    private List<String> typeNameCandidates(String name) {
        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        candidates.add(name);
        String candidate = name;
        for (int dot = name.lastIndexOf('.'); dot > 0; dot = name.lastIndexOf('.', dot - 1)) {
            candidate = candidate.substring(0, dot) + '$' + candidate.substring(dot + 1);
            candidates.add(candidate);
        }
        return new ArrayList<>(candidates);
    }

    private boolean assignable(ReferenceType source, ReferenceType target, Set<ReferenceType> visited)
        throws ClassNotLoadedException {
        if (source.equals(target)) return true;
        if (!visited.add(source)) return false;
        if (source instanceof ArrayType array) {
            if (target instanceof ArrayType targetArray) {
                Type sourceComponent = array.componentType();
                Type targetComponent = targetArray.componentType();
                if (sourceComponent instanceof ReferenceType sourceReference
                    && targetComponent instanceof ReferenceType targetReference)
                    return assignable(sourceReference, targetReference, visited);
                return sourceComponent.equals(targetComponent);
            }
            return target.classLoader() == null
                && Set.of("java.lang.Object", "java.lang.Cloneable", "java.io.Serializable").contains(target.name());
        }
        if (source instanceof ClassType type) {
            if (type.superclass() != null && assignable(type.superclass(), target, visited)) return true;
            for (InterfaceType implemented : type.allInterfaces())
                if (assignable(implemented, target, visited)) return true;
        } else if (source instanceof InterfaceType type) {
            if (target.classLoader() == null && target.name().equals("java.lang.Object")) return true;
            for (InterfaceType parent : type.superinterfaces())
                if (assignable(parent, target, visited)) return true;
        }
        return false;
    }

    private Value debuggerValue(Object value) {
        if (value == null || value instanceof Value) return (Value) value;
        if (value instanceof IdeJavaDebuggerExpressions.ExpressionString string) {
            if (string.reference() != null) return string.reference();
            throw new IllegalArgumentException("Computed strings are presented without allocating values in the debuggee.");
        }
        if (value instanceof IdeJavaDebuggerExpressions.ExpressionWrapper wrapper) {
            if (wrapper.reference() != null) return wrapper.reference();
            throw new IllegalArgumentException("The wrapper's runtime reference is unavailable.");
        }
        if (value instanceof IdeJavaDebuggerExpressions.ExpressionCharacter character) return vm.mirrorOf(character.value());
        if (value instanceof Boolean result) return vm.mirrorOf(result);
        if (value instanceof Byte result) return vm.mirrorOf(result);
        if (value instanceof Short result) return vm.mirrorOf(result);
        if (value instanceof Integer result) return vm.mirrorOf(result);
        if (value instanceof Long result) return vm.mirrorOf(result);
        if (value instanceof Float result) return vm.mirrorOf(result);
        if (value instanceof Double result) return vm.mirrorOf(result);
        throw new IllegalArgumentException("The debugger expression result cannot be displayed.");
    }

    private Object expressionVariable(String name, Object value, String nullType) {
        if (value instanceof IdeJavaDebuggerExpressions.ExpressionString string && string.reference() == null) {
            String text = string.value();
            boolean truncated = text.length() > 256;
            String display = "\"" + displayText(bounded(text, 256), true) + "\"";
            return map("name", bounded(displayText(name), 512), "type", "java.lang.String", "value", bounded(display, 512),
                "valueTruncated", display.length() > 512 || truncated, "reference", null, "childCount", 0);
        }
        Value mirrored = debuggerValue(value);
        return variable(name, mirrored == null ? nullType : mirrored.type().name(), mirrored);
    }

    private void evaluateExpression(String expression) {
        String evaluatedStop = stopId, evaluatedFrame = selectedFrame;
        try {
            StackFrame frame = frames.get(evaluatedFrame);
            if (frame == null) throw new IllegalArgumentException("Select a suspended frame to evaluate this expression.");
            Object result = IdeJavaDebuggerExpressions.compile(expression).evaluate(expressionResolver(frame));
            evaluation = map("stopId", evaluatedStop, "frameId", evaluatedFrame, "expression", expression,
                "variable", expressionVariable(expression, result, "null"), "error", null);
        } catch (Exception exception) {
            String detail = exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage();
            evaluation = map("stopId", evaluatedStop, "frameId", evaluatedFrame, "expression", expression,
                "variable", null, "error", bounded(displayText(detail), 1024));
        }
    }

    private void setLocalValue(String assignment, String requestedFrame) throws Exception {
        if (!Objects.equals(selectedFrame, requestedFrame))
            throw new IllegalArgumentException("The selected frame changed before the local assignment.");
        Matcher match = LOCAL_ASSIGNMENT.matcher(assignment);
        if (!match.matches())
            throw new IllegalArgumentException("Use `localName = expression` to change one visible local variable.");
        StackFrame frame = frames.get(selectedFrame);
        if (frame == null || frame.location().method().isObsolete())
            throw new IllegalArgumentException("Select a current, non-obsolete frame before changing a local variable.");
        String name = match.group(1);
        LocalVariable local;
        try { local = frame.visibleVariableByName(name); }
        catch (AbsentInformationException exception) { local = null; }
        if (local == null)
            throw new IllegalArgumentException("The selected frame has no visible local variable named `" + name + "`.");
        Object evaluated = IdeJavaDebuggerExpressions.compile(match.group(2)).evaluate(expressionResolver(frame));
        Type declared = local.type();
        Value replacement;
        if (declared instanceof PrimitiveType primitive) {
            replacement = debuggerValue(IdeJavaDebuggerExpressions.primitiveAssignment(primitive.name(), evaluated));
        } else if (declared instanceof ReferenceType target) {
            replacement = evaluated instanceof IdeJavaDebuggerExpressions.ExpressionString string && string.reference() == null
                ? vm.mirrorOf(string.value())
                : debuggerValue(evaluated);
            if (replacement != null && (!(replacement instanceof ObjectReference object)
                || !assignable(object.referenceType(), target, new HashSet<>())))
                throw new IllegalArgumentException("The expression result is not assignable to the local variable's reference type.");
        } else {
            throw new IllegalArgumentException("The local variable's runtime type is unavailable.");
        }
        frame.setValue(local, replacement);
        references.clear();
        variablePage = null;
        evaluation = null;
        message = "Set local variable `" + name + "` in the selected frame.";
    }

    private void publish() {
        List<Object> threadValues = new ArrayList<>(), frameValues = new ArrayList<>(), variables = new ArrayList<>(), breakpointValues = new ArrayList<>(), watchValues = new ArrayList<>();
        boolean threadsTruncated = false, framesTruncated = false, variablesTruncated = false;
        if (!status.equals("terminated")) {
            List<ThreadReference> threads = new ArrayList<>(vm.allThreads()); threadsTruncated = threads.size() > THREAD_LIMIT;
            threads.sort(Comparator.comparingLong(ThreadReference::uniqueID));
            if (threads.size() > THREAD_LIMIT && selectedThread != null) {
                int selectedIndex = -1;
                for (int index = 0; index < threads.size(); index++) if (Long.toString(threads.get(index).uniqueID()).equals(selectedThread)) selectedIndex = index;
                if (selectedIndex >= THREAD_LIMIT) {
                    ThreadReference selected = threads.remove(selectedIndex);
                    threads.add(THREAD_LIMIT - 1, selected);
                }
            }
            for (ThreadReference thread : threads.subList(0, Math.min(threads.size(), THREAD_LIMIT)))
                threadValues.add(map("id", Long.toString(thread.uniqueID()), "name", displayText(bounded(thread.name(), 256)), "status", thread.status(), "suspended", thread.isSuspended()));
        }
        for (Map.Entry<String, StackFrame> item : frames.entrySet()) {
            Location location = item.getValue().location(); String source = null;
            try { source = displayText(bounded(location.sourcePath(), 2048)); } catch (AbsentInformationException ignored) { }
            frameValues.add(map("id", item.getKey(), "className", displayText(bounded(location.declaringType().name(), 256)), "methodName", displayText(bounded(location.method().name(), 256)), "sourcePath", source, "line", location.lineNumber() > 0 ? location.lineNumber() : null, "obsolete", location.method().isObsolete()));
        }
        if (status.equals("suspended")) {
            ThreadReference selected = vm.allThreads().stream().filter(thread -> Long.toString(thread.uniqueID()).equals(selectedThread)).findFirst().orElse(null);
            try { framesTruncated = selected != null && selected.frameCount() > FRAME_LIMIT; } catch (IncompatibleThreadStateException ignored) { }
        }
        StackFrame frame = frames.get(selectedFrame);
        if (frame != null) {
            if (frame.thisObject() != null) variables.add(variable("this", frame.location().declaringType().name(), frame.thisObject()));
            try {
                List<LocalVariable> locals = frame.visibleVariables(); variablesTruncated = locals.size() + variables.size() > VARIABLE_LIMIT;
                for (LocalVariable local : locals.subList(0, Math.min(locals.size(), VARIABLE_LIMIT - variables.size())))
                    variables.add(variable(local.name(), local.typeName(), frame.getValue(local)));
            } catch (AbsentInformationException | NativeMethodException exception) { message = "Local-variable debug information is unavailable for this frame."; }
        }
        for (Breakpoint breakpoint : breakpoints.values())
            breakpointValues.add(map("className", breakpoint.className, "sourcePath", breakpoint.sourcePath, "line", breakpoint.line, "verified", breakpoint.verified, "message", breakpoint.message, "condition", breakpoint.condition, "hitCount", breakpoint.hitCount, "hits", breakpoint.hits, "logMessage", breakpoint.logMessage));
        for (String expression : watches) {
            try {
                if (frame == null) throw new IllegalArgumentException("Select a suspended frame to inspect this watch.");
                Object result = IdeJavaDebuggerExpressions.compile(expression).evaluate(expressionResolver(frame));
                watchValues.add(map("expression", expression, "variable", expressionVariable(expression, result, "unknown"), "error", null));
            } catch (Exception exception) { watchValues.add(map("expression", expression, "variable", null, "error", bounded(exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage(), 1024))); }
        }
        emit(map("kind", "state", "state", map("status", status, "breakpointsMuted", breakpointsMuted, "canReloadClasses", !status.equals("terminated") && vm.canRedefineClasses() && vm.canBeModified(), "canDropFrame", canDropSelectedFrame(), "stopId", stopId, "reason", reason, "exceptionMode", exceptionMode, "exceptionClassName", exceptionClassName, "exceptionIncludeSubclasses", exceptionIncludeSubclasses, "selectedThreadId", selectedThread, "selectedFrameId", selectedFrame, "threads", threadValues, "frames", frameValues, "variables", variables, "variablePage", variablePage, "breakpoints", breakpointValues, "watches", watchValues, "evaluation", evaluation, "threadsTruncated", threadsTruncated, "framesTruncated", framesTruncated, "variablesTruncated", variablesTruncated, "loadedClasses", loadedClasses, "loadedClassesTruncated", loadedClassesTruncated, "message", message, "error", error)));
    }

    private static String bounded(String value, int maximum) {
        if (value.length() <= maximum) return value;
        int end = maximum;
        if (Character.isHighSurrogate(value.charAt(end - 1))) end--;
        return value.substring(0, end);
    }
    private static String displayText(String text) {
        return displayText(text, false);
    }
    private static String displayText(String text, boolean quoted) {
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (Character.isHighSurrogate(character) && index + 1 < text.length() && Character.isLowSurrogate(text.charAt(index + 1))) {
                result.append(character).append(text.charAt(++index));
            } else if (character < 32 || Character.isSurrogate(character)) result.append(String.format("\\u%04x", (int) character));
            else {
                if (quoted && (character == '\\' || character == '"')) result.append('\\');
                result.append(character);
            }
        }
        return result.toString();
    }
    private static Map<String, Object> map(Object... fields) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < fields.length; index += 2) result.put((String) fields[index], fields[index + 1]);
        return result;
    }
    private static synchronized void emit(Object value) { System.out.println(json(value)); System.out.flush(); }
    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean || value instanceof Number) return value.toString();
        if (value instanceof Map<?, ?> fields) {
            List<String> items = new ArrayList<>();
            fields.forEach((key, item) -> items.add(json(key.toString()) + ":" + json(item)));
            return "{" + String.join(",", items) + "}";
        }
        if (value instanceof Collection<?> items) return "[" + String.join(",", items.stream().map(IdeJavaDebugger::json).toList()) + "]";
        String text = value.toString(); StringBuilder encoded = new StringBuilder("\"");
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (character == '"' || character == '\\') encoded.append('\\').append(character);
            else if (character < 32 || Character.isSurrogate(character)) encoded.append(String.format("\\u%04x", (int) character));
            else encoded.append(character);
        }
        return encoded.append('"').toString();
    }
}
