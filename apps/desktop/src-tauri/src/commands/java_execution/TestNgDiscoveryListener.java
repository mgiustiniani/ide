import org.testng.*;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

/** Loaded only by the owned Gradle dry-run task through public TestNGOptions.listeners. */
public class IDE_CLASS_NAME implements ITestListener {
    private static final Path OUTPUT = Paths.get(IDE_OUTPUT_JSON);
    private static final String IDENTITY = "IDE_DISCOVERY_ID";
    private static final int LIMIT = 2 * 1024 * 1024;

    private static String quote(String value) {
        if (value == null || value.length() > 4096 || value.indexOf(0) >= 0) throw new IllegalArgumentException("Invalid TestNG discovery label");
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default: if (c < 32) out.append(String.format("\\u%04x",(int)c)); else out.append(c);
            }
        }
        return out.append('"').toString();
    }
    private static synchronized void append(String json) {
        try (FileChannel channel = FileChannel.open(OUTPUT, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS); FileLock lock = channel.lock()) {
            byte[] data = (json + "\n").getBytes(StandardCharsets.UTF_8);
            long size = channel.size();
            channel.position(size);
            if (size + data.length > LIMIT - 4096) {
                data = ("{\"requestId\":\"" + IDENTITY + "\",\"error\":\"TestNG discovery output limit exceeded\"}\n").getBytes(StandardCharsets.UTF_8);
                if (size + data.length > LIMIT) throw new IllegalStateException("TestNG discovery output limit exceeded");
            }
            ByteBuffer buffer = ByteBuffer.wrap(data);
            while (buffer.hasRemaining()) channel.write(buffer);
        } catch (Exception error) { throw new IllegalStateException("Cannot record TestNG discovery metadata", error); }
    }
    private static void verify() {
        String version = TestNG.class.getPackage().getImplementationVersion();
        if (version == null) version = TestNG.class.getPackage().getSpecificationVersion();
        java.util.regex.Matcher parts = java.util.regex.Pattern.compile("^(\\d+)\\.(\\d+)(?:[.\\-+].*)?$").matcher(version == null ? "" : version);
        if (!parts.matches() || Integer.parseInt(parts.group(1)) < 6 || (Integer.parseInt(parts.group(1)) == 6 && Integer.parseInt(parts.group(2)) < 14) || !Boolean.parseBoolean(System.getProperty("testng.mode.dryrun"))) {
            append("{\"requestId\":\"" + IDENTITY + "\",\"error\":\"Compatible TestNG discovery dry-run was not confirmed\"}");
            throw new IllegalStateException("Compatible TestNG discovery dry-run was not confirmed");
        }
    }
    private static void record(ITestResult result) {
        verify();
        if (!result.getMethod().isTest()) return;
        try {
            String owner = result.getTestClass().getRealClass().getName();
            String method = result.getMethod().getMethodName();
            append("{\"requestId\":\"" + IDENTITY + "\",\"className\":" + quote(owner) + ",\"methodName\":" + quote(method) + ",\"label\":" + quote(method + " (" + owner + ", TestNG)") + "}");
        } catch (RuntimeException error) {
            append("{\"requestId\":\"" + IDENTITY + "\",\"error\":\"Invalid TestNG discovery metadata\"}");
            throw error;
        }
    }
    public void onStart(ITestContext context) { verify(); }
    public void onFinish(ITestContext context) {}
    public void onTestStart(ITestResult result) { verify(); }
    public void onTestSuccess(ITestResult result) { record(result); }
    public void onTestFailure(ITestResult result) { record(result); }
    public void onTestSkipped(ITestResult result) { record(result); }
    public void onTestFailedButWithinSuccessPercentage(ITestResult result) { record(result); }
}
