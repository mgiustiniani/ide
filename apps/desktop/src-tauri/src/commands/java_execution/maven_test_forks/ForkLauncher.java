package ide.maven;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.HashSet;
import java.util.Set;
import org.apache.maven.eventspy.AbstractEventSpy;
import org.apache.maven.execution.ExecutionEvent;
import org.apache.maven.plugin.MojoExecution;
import org.apache.maven.project.MavenProject;
import org.apache.maven.plugin.PluginParameterExpressionEvaluator;
import org.apache.maven.toolchain.Toolchain;
import org.apache.maven.toolchain.ToolchainManager;
import org.codehaus.plexus.component.configurator.expression.ExpressionEvaluationException;
import org.codehaus.plexus.util.xml.Xpp3Dom;

public final class ForkLauncher extends AbstractEventSpy {
    private ToolchainManager toolchains;
    private final Map<List<String>, Fork> forks = new HashMap<>();
    private boolean loaded;

    @Override
    public void onEvent(Object value) {
        if (!(value instanceof ExecutionEvent)) return;
        ExecutionEvent event = (ExecutionEvent) value;
        String rerunManifest = event.getSession().getUserProperties().getProperty("ide.maven.test.rerun");
        if (rerunManifest != null) {
            try {
                if (event.getType() == ExecutionEvent.Type.SessionStarted) {
                    loadRerunProjects(event, rerunManifest);
                } else if (event.getType() == ExecutionEvent.Type.MojoStarted) {
                    if (!configureRerun(event)) return;
                }
            } catch (IOException | RuntimeException failure) {
                throw stop("The IDE could not verify the Maven reactor test selection.", failure);
            }
        }
        if (event.getType() != ExecutionEvent.Type.MojoStarted) return;
        String forksManifest = event.getSession().getUserProperties().getProperty("ide.maven.test.forks");
        if (forksManifest == null) return;
        MojoExecution mojo = event.getMojoExecution();
        String plugin = mojo.getGroupId() + ":" + mojo.getArtifactId();
        String goal = mojo.getGoal();
        if (!("org.apache.maven.plugins:maven-surefire-plugin".equals(plugin) && "test".equals(goal))
                && !("org.apache.maven.plugins:maven-failsafe-plugin".equals(plugin)
                     && "integration-test".equals(goal))) return;
        try {
            loadForks(forksManifest);
            Path module = event.getProject().getBasedir().toPath().toRealPath();
            Fork fork = forks.get(Arrays.asList(module.toString(), plugin, mojo.getVersion(),
                                                 mojo.getExecutionId(), goal));
            if (fork == null) {
                throw stop("Maven started a test execution outside the synchronized JVM selection.");
            }
            Xpp3Dom configuration = mojo.getConfiguration();
            if (configuration == null || !matchesFork(event, configuration, fork)) {
                throw stop("The Maven test JVM changed after synchronization. Synchronize Java Project and run again.");
            }
            String launcher = fork.launcher;
            String argumentFile = fork.argumentFile;
            if (fork.buildContextToolchain || !fork.requirements.isEmpty()) {
                Path java = fork.buildContextToolchain ? resolveBuildContextJava(event)
                        : resolveToolchain(event, fork.requirements);
                if (javaMajor(java) == 8) {
                    Path launcherHome = Paths.get(launcher).getParent().getParent();
                    Files.write(launcherHome.resolve("real-java"), (java.toString() + "\n").getBytes(StandardCharsets.UTF_8),
                                StandardOpenOption.CREATE_NEW);
                    argumentFile = "";
                } else {
                    launcher = "";
                }
            }
            if (!launcher.isEmpty()) {
                setParameter(configuration, "jvm", launcher);
            }
            configureArgLine(event, configuration, argumentFile);
        } catch (IOException | ExpressionEvaluationException | RuntimeException failure) {
            throw stop("The IDE could not verify the Maven test fork settings.", failure);
        }
    }

    private final Map<Path, String> rerunProjects = new HashMap<>();
    private boolean integrationRerun;

    private void loadRerunProjects(ExecutionEvent event, String manifest) throws IOException {
        String phase = event.getSession().getUserProperties().getProperty("ide.maven.test.phase");
        integrationRerun = "rerun-integration-test".equals(phase);
        if (!integrationRerun && !"rerun-test".equals(phase)) {
            throw stop("The Maven reactor test phase is invalid.");
        }
        Set<Path> reactor = new HashSet<>();
        for (MavenProject project : event.getSession().getProjects()) {
            reactor.add(project.getBasedir().toPath().toRealPath());
        }
        for (String line : Files.readAllLines(Paths.get(manifest), StandardCharsets.UTF_8)) {
            String[] fields = line.split("\\t", -1);
            if (fields.length != 2) throw stop("Invalid IDE Maven reactor test selection.");
            Path module = Paths.get(decode(fields[0]));
            if (!reactor.contains(module) || rerunProjects.putIfAbsent(module, decode(fields[1])) != null) {
                throw stop("A selected test module does not match the Maven reactor.");
            }
        }
        if (rerunProjects.isEmpty()) throw stop("No Maven reactor test modules were selected.");
    }

    private boolean configureRerun(ExecutionEvent event) throws IOException {
        MojoExecution mojo = event.getMojoExecution();
        if (!"org.apache.maven.plugins".equals(mojo.getGroupId())) return true;
        String plugin = mojo.getArtifactId();
        String goal = mojo.getGoal();
        boolean surefire = "maven-surefire-plugin".equals(plugin) && "test".equals(goal);
        boolean failsafe = "maven-failsafe-plugin".equals(plugin)
                && ("integration-test".equals(goal) || "verify".equals(goal));
        if (!surefire && !(integrationRerun && failsafe)) return true;
        if (rerunProjects.isEmpty()) throw stop("Maven did not initialize the reactor test selection.");
        Xpp3Dom configuration = mojo.getConfiguration();
        if (configuration == null) throw stop("Maven did not supply the test plugin configuration.");
        String selection = rerunProjects.get(event.getProject().getBasedir().toPath().toRealPath());
        if (selection == null) {
            setParameter(configuration, surefire ? "skipTests" : "skipITs", "true");
            return false;
        }
        if (!selection.isEmpty() && ((!integrationRerun && surefire) || "integration-test".equals(goal))) {
            setParameter(configuration, "test", selection);
        }
        return true;
    }

    private static String decode(String text) {
        return new String(Base64.getDecoder().decode(text), StandardCharsets.UTF_8);
    }

    private static void setParameter(Xpp3Dom configuration, String name, String value) {
        Xpp3Dom parameter = configuration.getChild(name);
        if (parameter == null) {
            parameter = new Xpp3Dom(name);
            configuration.addChild(parameter);
        }
        parameter.setValue(value);
    }

    private boolean matchesFork(ExecutionEvent event, Xpp3Dom configuration, Fork fork)
            throws IOException, ExpressionEvaluationException {
        PluginParameterExpressionEvaluator evaluator =
                new PluginParameterExpressionEvaluator(event.getSession(), event.getMojoExecution());
        String jvm = parameter(evaluator, configuration.getChild("jvm"), "${jvm}");
        String count = parameter(evaluator, configuration.getChild("forkCount"), "${forkCount}");
        if (count != null && !count.isEmpty()) {
            count = count.trim();
            boolean usesCpuCount = count.endsWith("C");
            double forks = usesCpuCount
                    ? Double.parseDouble(count.substring(0, count.length() - 1))
                    : Integer.parseInt(count);
            if (!Double.isFinite(forks) || forks <= 0) return false;
        }
        Xpp3Dom requirements = configuration.getChild("jdkToolchain");
        if (!fork.requirements.isEmpty()) {
            if (!Fork.usesBuildJvm(jvm) || requirements == null) return false;
            Map<String, String> actual = new HashMap<>();
            for (Xpp3Dom child : requirements.getChildren()) {
                String value = parameter(evaluator, child, "");
                if (value == null || actual.putIfAbsent(child.getName(), value) != null) return false;
            }
            return fork.requirements.equals(actual);
        }
        if (fork.buildContextToolchain) {
            return requirements == null && Fork.usesBuildJvm(jvm);
        }
        if (fork.inherited && (requirements != null
                || toolchains.getToolchainFromBuildContext("jdk", event.getSession()) != null)) return false;
        return fork.matches(jvm);
    }

    private Path resolveToolchain(ExecutionEvent event, Map<String, String> requirements) throws IOException {
        List<Toolchain> matches = toolchains.getToolchains(event.getSession(), "jdk", requirements);
        if (matches.isEmpty()) {
            throw stop("Requested toolchain specification did not match any configured toolchain for the Maven test fork.");
        }
        return checkedJavaExecutable(matches.get(0).findTool("java"));
    }

    private Path resolveBuildContextJava(ExecutionEvent event) throws IOException {
        Toolchain selected = toolchains.getToolchainFromBuildContext("jdk", event.getSession());
        String executable = selected == null ? Paths.get(System.getProperty("java.home"), "bin", "java").toString()
                : selected.findTool("java");
        return checkedJavaExecutable(executable);
    }

    private static Path checkedJavaExecutable(String executable) throws IOException {
        Path selected = executable == null ? null : Paths.get(executable);
        if (selected == null || !selected.isAbsolute()) {
            throw stop("The selected Maven test toolchain has no absolute Java executable.");
        }
        Path java = selected.toRealPath();
        if (!Files.isRegularFile(java) || !Files.isExecutable(java)
                || java.getParent() == null || java.getParent().getParent() == null
                || java.toString().chars().anyMatch(Character::isISOControl)) {
            throw stop("The selected Maven test toolchain does not provide an available Java executable.");
        }
        return java;
    }

    private static int javaMajor(Path java) throws IOException {
        Path home = java.getParent().getParent();
        Path release = home.resolve("release");
        if (!Files.isRegularFile(release) && "jre".equals(home.getFileName().toString())) {
            release = home.getParent().resolve("release");
        }
        if (Files.isRegularFile(release) && Files.size(release) <= 16384) {
            for (String line : Files.readAllLines(release, StandardCharsets.UTF_8)) {
                if (!line.startsWith("JAVA_VERSION=")) continue;
                String version = line.substring("JAVA_VERSION=".length()).replace("\"", "");
                if (version.startsWith("1.")) version = version.substring(2);
                int major = Integer.parseInt(version.split("[._+-]", 2)[0]);
                if (major >= 8) return major;
            }
        }
        throw stop("The selected Maven test toolchain Java version could not be established.");
    }

    private static String parameter(PluginParameterExpressionEvaluator evaluator, Xpp3Dom node,
                                    String expression) throws ExpressionEvaluationException {
        String configured = node == null ? null : node.getValue();
        Object value = evaluator.evaluate(configured != null ? configured : expression);
        return value == null ? null : value.toString();
    }

    private synchronized void loadForks(String manifest) throws IOException {
        if (loaded) return;
        for (String line : Files.readAllLines(Paths.get(manifest), StandardCharsets.UTF_8)) {
            String[] fields = line.split("\t", -1);
            if (fields.length < 9 || (fields.length - 9) % 2 != 0) throw stop("Invalid IDE Maven test fork settings.");
            for (int i = 0; i < fields.length; i++) {
                fields[i] = new String(Base64.getDecoder().decode(fields[i]), StandardCharsets.UTF_8);
            }
            List<String> key = Arrays.asList(Arrays.copyOf(fields, 5));
            Map<String, String> requirements = new HashMap<>();
            for (int i = 9; i < fields.length; i += 2) {
                if (requirements.putIfAbsent(fields[i], fields[i + 1]) != null) {
                    throw stop("Conflicting requirements for one Maven test execution.");
                }
            }
            if (requirements.isEmpty() == "toolchain".equals(fields[6])) {
                throw stop("Invalid Maven test JVM selector.");
            }
            Path java = fields[5].isEmpty() ? null : Paths.get(fields[5]);
            Fork fork = new Fork(java, "inherited".equals(fields[6]), "build-context-toolchain".equals(fields[6]),
                                 fields[7], fields[8], requirements);
            Fork previous = forks.putIfAbsent(key, fork);
            if (previous != null && !previous.equalsSelection(fork)) {
                throw stop("Conflicting JVM selections for one Maven test execution.");
            }
        }
        loaded = true;
    }

    private static void configureArgLine(ExecutionEvent event, Xpp3Dom configuration, String argumentFile) {
        String property = "ide.coverage.agent";
        boolean coverage = property.equals(event.getSession().getUserProperties().getProperty("jacoco.propertyName"))
                && event.getProject().getProperties().getProperty(property) != null;
        if (!coverage && argumentFile.isEmpty()) return;
        Xpp3Dom argLine = configuration.getChild("argLine");
        if (argLine == null) {
            argLine = new Xpp3Dom("argLine");
            configuration.addChild(argLine);
        }
        String original = argLine.getValue();
        if (original == null || "${argLine}".equals(original)) {
            original = event.getSession().getUserProperties().getProperty("argLine",
                       event.getProject().getProperties().getProperty("argLine", ""));
        }
        String lateAgent = "@{" + property + "}";
        if (coverage && !original.contains(lateAgent)) {
            original = lateAgent + " " + original;
        }
        argLine.setValue(argumentFile.isEmpty() ? original : original + " " + argumentFile);
    }

    // Maven's EventSpy dispatcher catches Exception and LinkageError and continues the build.
    private static AssertionError stop(String message) {
        return new AssertionError(message);
    }

    private static AssertionError stop(String message, Throwable cause) {
        return new AssertionError(message, cause);
    }

    private static final class Fork {
        private final Path java;
        private final boolean inherited;
        private final boolean buildContextToolchain;
        private final String launcher;
        private final String argumentFile;
        private final Map<String, String> requirements;

        Fork(Path java, boolean inherited, boolean buildContextToolchain, String launcher,
             String argumentFile, Map<String, String> requirements) {
            this.java = java;
            this.inherited = inherited;
            this.buildContextToolchain = buildContextToolchain;
            this.launcher = launcher;
            this.argumentFile = argumentFile;
            this.requirements = requirements;
        }

        boolean equalsSelection(Fork other) {
            return Objects.equals(java, other.java) && inherited == other.inherited
                    && buildContextToolchain == other.buildContextToolchain
                    && launcher.isEmpty() == other.launcher.isEmpty() && argumentFile.equals(other.argumentFile)
                    && requirements.equals(other.requirements);
        }

        static boolean usesBuildJvm(String configured) {
            return configured == null || configured.isEmpty() || "${jvm}".equals(configured);
        }

        boolean matches(String configured) throws IOException {
            boolean useBuildJvm = usesBuildJvm(configured);
            if (!inherited) {
                Path path = useBuildJvm ? null : Paths.get(configured);
                return path != null && path.isAbsolute() && path.toRealPath().equals(java);
            }
            if (!useBuildJvm) return false;
            Path runtime = Paths.get(System.getProperty("java.home")).toRealPath();
            Path sdk = java.getParent().getParent();
            return runtime.equals(sdk) || runtime.equals(sdk.resolve("jre"));
        }
    }
}
