import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Starts Java 8 with literal arguments and connects the console debugger to it. */
class IdeJdbLauncher {
    private static final Pattern LISTENING = Pattern.compile(
        "Listening for transport dt_socket at address: ([0-9]{1,5})");

    private static int port(InputStream output) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        for (int count = 0; count < 4096; count++) {
            int next = output.read();
            if (next < 0) break;
            if (next == '\n') {
                Matcher banner = LISTENING.matcher(new String(line.toByteArray(), StandardCharsets.US_ASCII).trim());
                if (banner.matches()) {
                    int port = Integer.parseInt(banner.group(1));
                    if (port > 0 && port <= 65535) return port;
                }
                line.reset();
            } else {
                line.write(next);
            }
        }
        throw new IOException("The Java 8 debugger listener did not report a port");
    }

    private static void forward(InputStream output) {
        try {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = output.read(buffer)) != -1) {
                System.out.write(buffer, 0, count);
                System.out.flush();
            }
        } catch (IOException failure) {
            System.err.println("Cannot read the Java 8 application output: " + failure.getMessage());
        }
    }

    private static int debug(String jdb, String settings) throws Exception {
        List<String> command = new ArrayList<>();
        for (String encoded : Files.readAllLines(Paths.get(settings), StandardCharsets.US_ASCII)) {
            command.add(new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8));
        }
        if (command.size() < 2) throw new IllegalArgumentException("Incomplete Java 8 debugger settings");
        command.add(1, "-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:0");
        Process target = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        Process debugger = null;
        try (InputStream output = new BufferedInputStream(target.getInputStream())) {
            FutureTask<Integer> address = new FutureTask<>(() -> port(output));
            Thread listener = new Thread(address, "jdb-listener");
            listener.setDaemon(true);
            listener.start();
            int port = address.get(15, TimeUnit.SECONDS);
            target.getOutputStream().close();
            Thread reader = new Thread(() -> forward(output), "java-application-output");
            reader.setDaemon(true);
            reader.start();
            debugger = new ProcessBuilder(jdb, "-attach", "127.0.0.1:" + port).inheritIO().start();
            int debuggerExit = debugger.waitFor();
            if (!target.waitFor(2, TimeUnit.SECONDS)) {
                throw new IOException("The console debugger disconnected before the application exited");
            }
            reader.join(1000);
            int targetExit = target.exitValue();
            return targetExit != 0 ? targetExit : debuggerExit;
        } finally {
            if (debugger != null && debugger.isAlive()) debugger.destroyForcibly();
            if (target.isAlive()) target.destroyForcibly();
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Missing Java 8 debugger launcher paths");
        System.exit(debug(args[0], args[1]));
    }
}
