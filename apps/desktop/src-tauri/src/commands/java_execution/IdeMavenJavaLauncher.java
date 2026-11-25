import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/** Launches Java with Maven's resolved classpath and the IDE's literal arguments. */
class IdeMavenJavaLauncher {
    public static void main(String[] args) throws Exception {
        if ((args.length != 2 && args.length != 3) || args[1].isEmpty()) {
            throw new IllegalArgumentException("Maven Java launch requires settings and a resolved classpath");
        }
        Path settings = Paths.get(args[0]);
        if (Files.size(settings) > 64 * 1024) {
            throw new IllegalArgumentException("Maven Java launch settings exceed the size limit");
        }
        List<String> values = new ArrayList<>();
        for (String line : Files.readAllLines(settings, StandardCharsets.US_ASCII)) {
            values.add(new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8));
        }
        if (values.size() < 4) throw new IllegalArgumentException("Incomplete Maven Java launch settings");
        int optionCount = Integer.parseInt(values.get(3));
        if (optionCount < 0 || optionCount > 128 || values.size() < 4 + optionCount) {
            throw new IllegalArgumentException("Invalid Maven Java launch option count");
        }
        String extraClasspath = values.get(2);
        String classpath = extraClasspath.isEmpty() ? args[1] : extraClasspath + File.pathSeparator + args[1];
        List<String> command = new ArrayList<>();
        command.add(values.get(0));
        command.addAll(values.subList(4, 4 + optionCount));
        command.add("-classpath");
        command.add(classpath);
        command.add(values.get(1));
        command.addAll(values.subList(4 + optionCount, values.size()));
        if ("IdeTestDiscovery".equals(values.get(1))) {
            if (args.length != 3 || args[2].isEmpty()) {
                throw new IllegalArgumentException("Maven test discovery requires its resolved test output directory");
            }
            command.add(args[2]);
        } else if (args.length != 2) {
            throw new IllegalArgumentException("Unexpected Maven Java launcher argument");
        }
        System.exit(new ProcessBuilder(command).inheritIO().start().waitFor());
    }
}
