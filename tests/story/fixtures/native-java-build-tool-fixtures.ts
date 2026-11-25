export type NativeJavaBuildTool = "maven" | "gradle";
export type NativeJavaTestFramework = "junit4" | "junit5" | "testng";
export const BUILD_TOOL_MAIN = "src/main/java/Main.java";
export const BUILD_TOOL_TEST = "src/test/java/MainTest.java";
export const BUILD_TOOL_INTEGRATION_TEST = "src/integration-test/java/MainIT.java";
export const MAVEN_AGGREGATOR_TEST_CLASS = "custom/test classes/MainTest.class";
export const MAIN_MODE_PREFIX = "import java.nio.file.*;\npublic class Main { static int mode = ";
export const TEST_EXPECTED_PREFIX =
  "import org.junit.Test; import java.nio.file.*;\npublic class MainTest { static int expected = ";
export const LAUNCH_ARGUMENTS = [
  "",
  "two words",
  "both'\"quotes",
  "back\\slash",
  "😀",
  "@literal",
  "$(touch injected.txt)",
];
export const LAUNCH_ENVIRONMENT = [
  { name: "IDE_GUI_LAUNCH_MODE", value: "literal = ' \" 😀" },
  { name: "IDE_GUI_LAUNCH_EMPTY", value: "" },
];
export const LAUNCH_JVM_LITERAL = "literal = both'\"quotes\\slash\n😀 $(touch vm-injected.txt)";
export const LAUNCH_JVM_OPTIONS = [
  "-Xmx96m",
  `-Dide.gui.jvm.literal=${LAUNCH_JVM_LITERAL}`,
  "-Dide.gui.jvm.empty=",
  "--add-opens=java.base/java.lang=ALL-UNNAMED",
];
export const TEST_JVM_LITERAL = "test = both'\"quotes\\slash\n😀 $(touch test-vm-injected.txt)";
export const TEST_JVM_OPTIONS = [
  "-Xmx96m",
  `-Dide.gui.test.literal=${TEST_JVM_LITERAL}`,
  "-Dide.gui.test.empty=",
  "--add-opens=java.base/java.lang=ALL-UNNAMED",
];
export type NativeJavaWorkflow =
  "application" | "test-jvm" | "ignored-test-jvm" | "discovery" | "failsafe";

/** Ordinary executable project inputs; no prebuilt classes, reports or replacement tools. */
export function nativeJavaBuildToolFixture(
  tool: NativeJavaBuildTool,
  workflow: NativeJavaWorkflow = "application",
  framework: NativeJavaTestFramework = "junit4",
  mavenAggregator = false,
) {
  if (workflow === "failsafe" && tool !== "maven")
    throw new Error("The Failsafe integration-test fixture requires Maven.");
  const runMarker = `GUI_${tool.toUpperCase()}_SAVED_MAIN`;
  const testMarker = `GUI_${tool.toUpperCase()}_${framework === "testng" ? "TESTNG" : framework === "junit5" ? "JUNIT_JUPITER" : "JUNIT"}_EXECUTED`;
  const main = (mode: string) => mavenAggregator ? `${MAIN_MODE_PREFIX}${mode}; }` : `${MAIN_MODE_PREFIX}${mode};
  public static int coverageChoice(boolean positive) { if (positive) return 1; return 2; }
  public static void main(String[] args) throws Exception {
    if (!java.util.Arrays.equals(args, new String[]{${LAUNCH_ARGUMENTS.map((value) => JSON.stringify(value)).join(",")}})) throw new AssertionError("Application arguments changed");
    if (!${JSON.stringify(LAUNCH_ENVIRONMENT[0].value)}.equals(System.getenv("IDE_GUI_LAUNCH_MODE"))) throw new AssertionError("Environment value changed");
    if (!"".equals(System.getenv("IDE_GUI_LAUNCH_EMPTY"))) throw new AssertionError("Empty environment value changed");
    if (!${JSON.stringify(LAUNCH_JVM_LITERAL)}.equals(System.getProperty("ide.gui.jvm.literal"))) throw new AssertionError("JVM property value changed");
    if (!"".equals(System.getProperty("ide.gui.jvm.empty"))) throw new AssertionError("Empty JVM property changed");
    boolean heapFlag = java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments().contains("-Xmx96m");
    if (!heapFlag || Runtime.getRuntime().maxMemory() < 80L*1024*1024 || Runtime.getRuntime().maxMemory() > 128L*1024*1024) throw new AssertionError("Heap option was not applied");
    ${tool === "gradle" ? 'if (!"retained".equals(System.getProperty("ide.gui.project.default"))) throw new AssertionError("Gradle JVM defaults were lost");' : ""}
    Files.writeString(Path.of("jvm-settings-proof.txt"), System.getProperty("ide.gui.jvm.literal") + "\\nEMPTY=" + System.getProperty("ide.gui.jvm.empty") + "\\nHEAP_FLAG=" + heapFlag + "\\nGRADLE_DEFAULT=" + System.getProperty("ide.gui.project.default"));
    Files.writeString(Path.of("launch-settings-proof.txt"), String.join("\\n", args) + "\\nMODE=" + System.getenv("IDE_GUI_LAUNCH_MODE") + "\\nEMPTY=" + System.getenv("IDE_GUI_LAUNCH_EMPTY"));
    Files.writeString(Path.of("execution-java-home.txt"), System.getenv("JAVA_HOME"));
    String marker = mode == 1 ? "${runMarker}" : "GUI_ORIGINAL_MAIN";
    Files.writeString(Path.of("execution-proof.txt"), marker + "\\n",
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    Files.writeString(Path.of("execution-jdk.txt"), System.getProperty("java.home"));
    System.out.println(marker);
  }
}`;
  const test = (expected: string, className = "MainTest") =>
    `${framework === "testng" ? TEST_EXPECTED_PREFIX.replace("org.junit.Test", "org.testng.annotations.Test") : framework === "junit5" ? TEST_EXPECTED_PREFIX.replace("org.junit.Test", "org.junit.jupiter.api.Test") : TEST_EXPECTED_PREFIX}${expected};
  @Test public void savedSource() throws Exception {
    ${workflow === "discovery" && framework === "junit5" ? "org.junit.jupiter.api.Assertions.assertEquals(1, Main.coverageChoice(true));" : ""}
    ${workflow === "failsafe" ? "org.junit.Assert.assertEquals(1, Main.coverageChoice(true));" : ""}
    org.junit.Assert.assertEquals(${JSON.stringify(LAUNCH_ENVIRONMENT[0].value)}, System.getenv("IDE_GUI_LAUNCH_MODE"));
    org.junit.Assert.assertEquals("", System.getenv("IDE_GUI_LAUNCH_EMPTY"));
    org.junit.Assert.assertNull(System.getProperty("ide.gui.jvm.literal"));
    org.junit.Assert.assertNull(System.getProperty("ide.gui.jvm.empty"));
    ${
      workflow === "test-jvm"
        ? `org.junit.Assert.assertEquals(${JSON.stringify(TEST_JVM_LITERAL)}, System.getProperty("ide.gui.test.literal"));
    org.junit.Assert.assertEquals("", System.getProperty("ide.gui.test.empty"));
    boolean heapFlag = java.lang.management.ManagementFactory.getRuntimeMXBean().getInputArguments().contains("-Xmx96m");
    org.junit.Assert.assertTrue(heapFlag && Runtime.getRuntime().maxMemory() >= 80L*1024*1024 && Runtime.getRuntime().maxMemory() <= 128L*1024*1024);
    ${tool === "gradle" ? 'org.junit.Assert.assertEquals("retained", System.getProperty("ide.gui.test.project.default"));' : 'org.junit.Assert.assertNull(System.getProperty("ide.gui.test.project.default"));'}
    Files.writeString(Path.of("test-jvm-settings-proof.txt"), System.getProperty("ide.gui.test.literal") + "\\nEMPTY=" + System.getProperty("ide.gui.test.empty") + "\\nHEAP_FLAG=" + heapFlag + "\\nJDK=" + Path.of(System.getProperty("java.home")).toRealPath() + "\\nJAVA_HOME=" + Path.of(System.getenv("JAVA_HOME")).toRealPath());`
        : workflow === "ignored-test-jvm"
          ? 'org.junit.Assert.assertNull(System.getProperty("ide.gui.test.literal")); org.junit.Assert.assertNull(System.getProperty("ide.gui.test.empty")); Files.writeString(Path.of("test-jvm-settings-proof.txt"), "JVM_SETTINGS_ABSENT");'
          : ""
    }
    Files.writeString(Path.of("test-proof.txt"), "${testMarker}\\n",
        StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    System.out.println("${testMarker}");
    ${framework === "testng" ? "org.testng.Assert" : framework === "junit5" ? "org.junit.jupiter.api.Assertions" : "org.junit.Assert"}.assertEquals(${framework === "testng" ? "Main.mode, expected" : "expected, Main.mode"});
  }
  ${workflow === "discovery" && framework === "junit5" ? '@Test public void savedSource(org.junit.jupiter.api.TestInfo info) throws Exception { Files.writeString(Path.of("discovery-overload-proof.txt"), "overloaded selected method\\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND); org.junit.jupiter.api.Assertions.assertEquals(2, Main.coverageChoice(false)); org.junit.jupiter.api.Assertions.assertEquals("savedSource", info.getTestMethod().orElseThrow().getName()); }' : ""}
  ${workflow === "discovery" ? '@Test public void companion() throws Exception { Files.writeString(Path.of("discovery-companion-proof.txt"), "unexpected execution"); throw new AssertionError("companion must not execute"); }' : ""}
}`
      .replace("public class MainTest", `public class ${className}`)
      .replaceAll(
        "org.junit.Assert",
        framework === "testng"
          ? "org.testng.Assert"
          : framework === "junit5"
            ? "org.junit.jupiter.api.Assertions"
            : "org.junit.Assert",
      );
  const files: Record<string, string> = {
    [BUILD_TOOL_MAIN]: main("0"),
    [BUILD_TOOL_TEST]: test("1"),
    ...(workflow === "failsafe" ? { [BUILD_TOOL_INTEGRATION_TEST]: test("1", "MainIT") } : {}),
  };
  if (tool === "maven") {
    files["pom.xml"] = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>native.fixture</groupId><artifactId>gui-main</artifactId><version>1</version>
  <properties><maven.compiler.release>21</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
  <dependencies><dependency><groupId>${framework === "testng" ? "org.testng" : framework === "junit5" ? "org.junit.jupiter" : "junit"}</groupId><artifactId>${framework === "testng" ? "testng" : framework === "junit5" ? "junit-jupiter" : "junit"}</artifactId>
    <version>${framework === "testng" ? "7.10.2" : framework === "junit5" ? "5.11.2" : "4.13.2"}</version><scope>test</scope></dependency></dependencies>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version>${workflow === "ignored-test-jvm" ? "<configuration><argLine>-Dide.gui.test.project.default=retained</argLine></configuration>" : ""}</plugin>
    ${workflow === "failsafe" ? "<plugin><groupId>org.codehaus.mojo</groupId><artifactId>build-helper-maven-plugin</artifactId><version>3.6.1</version><executions><execution><id>integration-test-source</id><phase>generate-test-sources</phase><goals><goal>add-test-source</goal></goals><configuration><sources><source>src/integration-test/java</source></sources></configuration></execution></executions></plugin><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-failsafe-plugin</artifactId><version>3.5.4</version><configuration><includes><include>**/MainIT.java</include></includes></configuration><executions><execution><goals><goal>integration-test</goal><goal>verify</goal></goals></execution></executions></plugin>" : ""}
    <plugin><groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId><version>3.5.0</version></plugin>
  </plugins></build>
</project>\n`;
    if (mavenAggregator) {
      const pom = files["pom.xml"];
      files["child/pom.xml"] = pom.replace("<artifactId>gui-main</artifactId>", "<artifactId>child</artifactId>");
      files[`child/${BUILD_TOOL_TEST}`] = `import org.junit.Test;
public class MainTest {
  @Test public void savedSource() throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("child-test-proof.txt"), "child ran");
  }
}\n`;
      files["pom.xml"] = pom
        .replace("  <properties>", "  <packaging>pom</packaging><modules><module>child</module></modules>\n  <properties>")
        .replace("<build><plugins>", "<build><testOutputDirectory>${project.basedir}/custom/test classes</testOutputDirectory><plugins>")
        .replace("<version>3.14.1</version>", `<version>3.14.1</version><executions>
      <execution><id>compile</id><phase>compile</phase><goals><goal>compile</goal></goals></execution>
      <execution><id>test-compile</id><phase>test-compile</phase><goals><goal>testCompile</goal></goals></execution>
    </executions>`)
        .replace("<version>3.5.3</version>", `<version>3.5.3</version><executions>
      <execution><id>default-test</id><phase>test</phase><goals><goal>test</goal></goals></execution>
    </executions>`);
      files[".mvn/maven.config"] = "--offline\n";
    }
  } else {
    files["settings.gradle"] = "rootProject.name = 'native-gui-main'\n";
    files["gradle.properties"] =
      "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n";
    files["build.gradle"] = `plugins { id 'java'; id 'application' }
repositories { mavenCentral() }
dependencies {
    testImplementation '${framework === "testng" ? "org.testng:testng:7.10.2" : framework === "junit5" ? "org.junit.jupiter:junit-jupiter:5.11.2" : "junit:junit:4.13.2"}'
    ${framework === "junit5" ? "testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.11.2'" : ""}
}
java { sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }
application { mainClass = 'Main'; applicationDefaultJvmArgs = ['-Dide.gui.project.default=retained'] }
test { ${framework === "testng" ? "useTestNG()" : framework === "junit5" ? "useJUnitPlatform()" : "useJUnit()"}; ${workflow === "test-jvm" ? "maxHeapSize = '128m'; systemProperty 'ide.gui.test.project.default', 'retained';" : ""} testLogging { events 'passed', 'failed'; showStandardStreams = true } }
`;
  }
  return {
    files,
    main,
    test,
    runMarker,
    testMarker,
    classFile:
      tool === "maven" ? "target/classes/Main.class" : "build/classes/java/main/Main.class",
    testReport:
      tool === "maven"
        ? `target/${workflow === "failsafe" ? "failsafe" : "surefire"}-reports/TEST-${workflow === "failsafe" ? "MainIT" : framework === "testng" && workflow === "discovery" ? "TestSuite" : "MainTest"}.xml`
        : "build/test-results/test/TEST-MainTest.xml",
    testReportSuite:
      workflow === "failsafe"
        ? "MainIT"
        : tool === "maven" && framework === "testng" && workflow === "discovery"
          ? "TestSuite"
          : "MainTest",
  };
}
