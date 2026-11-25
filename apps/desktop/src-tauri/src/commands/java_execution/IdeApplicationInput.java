package dev.ide.runtime;

import java.io.FileInputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

/** Connects only the application's System.in, before its main method starts. */
public final class IdeApplicationInput {
    private static Socket connection;

    private IdeApplicationInput() {}

    public static void premain(String settingsPath) {
        Socket socket = new Socket();
        try {
            Properties settings = new Properties();
            try (InputStream file = new FileInputStream(settingsPath)) {
                settings.load(file);
            }
            String token = settings.getProperty("token", "");
            if (!token.matches("[0-9a-f]{32}")) throw new IllegalArgumentException();
            int port = Integer.parseInt(settings.getProperty("port", ""));
            socket.connect(new InetSocketAddress("127.0.0.1", port), 5000);
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(token.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().flush();
            if (socket.getInputStream().read() != 1) throw new IllegalStateException();
            socket.setSoTimeout(0);
            System.setIn(socket.getInputStream());
            connection = socket;
        } catch (Exception failure) {
            try { socket.close(); } catch (Exception ignored) { }
            // A requested but unavailable input channel must fail the launch.
            // Do not print the private settings or authentication token.
            throw new IllegalStateException("IDE application input could not connect.");
        }
    }
}
