export type JavaReferenceBuildTool = "maven" | "gradle";

export const javaCrossModuleClassMoveSources = {
  "app/src/main/java/pkg/MigrateToLibrary.java": `package pkg;
public final class MigrateToLibrary {
  public static String value() { return "moved"; }
}
`,
  "app/src/main/java/pkg/MoveClient.java": `package pkg;
public final class MoveClient {
  public String value() { return MigrateToLibrary.value(); }
}
`,
};

export const JAVA_REFERENCE_MODULES = [
  "processor",
  "library",
  "runtime",
  "testsupport",
  "unrelated",
  "app",
] as const;

/** Minimal offline Maven reactor for module-operation qualification. */
export function javaMavenModuleRenameReference(): Record<string, string> {
  const parent = `<parent><groupId>ide.rename</groupId><artifactId>rename-reactor</artifactId><version>1.0</version><relativePath>../pom.xml</relativePath></parent>`;
  return {
    "pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion><groupId>ide.rename</groupId>
  <artifactId>rename-reactor</artifactId><version>1.0</version><packaging>pom</packaging>
  <modules><module>library</module><module>app</module></modules>
  <properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
</project>\n`,
    "library/pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>${parent}<artifactId>library</artifactId></project>\n`,
    "app/pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>${parent}<artifactId>app</artifactId><dependencies><dependency><groupId>ide.rename</groupId><artifactId>library</artifactId><version>1.0</version></dependency></dependencies></project>\n`,
    "library/src/main/java/pkg/Library.java": `package pkg;\npublic final class Library { public String value() { return "library"; } }\n`,
    "app/src/main/java/pkg/Runner.java": `package pkg;\npublic final class Runner { public static void main(String[] args) { System.out.println("rename-preview"); } }\n`,
  };
}

/** Real build inputs shared by the Maven reactor and Gradle multi-project qualification. */
const sources: Record<string, string> = {
  "processor/src/main/java/fixtures/processor/GenerateGreeting.java": `package fixtures.processor;
import java.lang.annotation.*;
@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.TYPE)
public @interface GenerateGreeting {}
`,
  "processor/src/main/java/fixtures/processor/GreetingProcessor.java": `package fixtures.processor;
import java.io.*;
import java.util.*;
import javax.annotation.processing.*;
import javax.lang.model.SourceVersion;
import javax.lang.model.element.TypeElement;
import javax.tools.StandardLocation;
@SupportedAnnotationTypes("fixtures.processor.GenerateGreeting")
@SupportedOptions("greeting.mode")
public final class GreetingProcessor extends AbstractProcessor {
  private boolean generated;
  @Override public SourceVersion getSupportedSourceVersion() {
    return SourceVersion.latestSupported();
  }
  @Override public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment round) {
    if (generated || round.processingOver() || round.getElementsAnnotatedWith(GenerateGreeting.class).isEmpty()) return false;
    String mode = processingEnv.getOptions().getOrDefault("greeting.mode", "base");
    if (!"base".equals(mode) && !"alternate".equals(mode)) throw new IllegalArgumentException("Unknown fixture mode");
    try (Writer writer = processingEnv.getFiler().createSourceFile("generated.GeneratedGreeting").openWriter()) {
      writer.write("package generated; public final class GeneratedGreeting { public static String value() { return \\\"generated-greeting\\\"; } public static String mode() { return \\\"" + mode + "\\\"; } }");
    } catch (IOException exception) { throw new UncheckedIOException(exception); }
    try (Writer writer = processingEnv.getFiler().createResource(StandardLocation.CLASS_OUTPUT, "", "processor-jdk-home.txt").openWriter()) {
      writer.write(System.getProperty("java.home"));
    } catch (IOException exception) { throw new UncheckedIOException(exception); }
    generated = true;
    return true;
  }
}
`,
  "processor/src/main/resources/META-INF/services/javax.annotation.processing.Processor":
    "fixtures.processor.GreetingProcessor\n",
  "library/src/main/java/fixtures/library/BaseGreeting.java": `package fixtures.library;
public class BaseGreeting {
  public String message(int count) { return "count:" + count; }
}
`,
  "library/src/main/java/fixtures/library/GreetingService.java": `package fixtures.library;
public final class GreetingService extends BaseGreeting {
  public String message(String name) { return "hello " + name; }
}
`,
  "runtime/src/main/java/fixtures/runtime/RuntimeToken.java": `package fixtures.runtime;
public final class RuntimeToken {
  public static final String VALUE = "runtime-token";
}
`,
  "testsupport/src/main/java/fixtures/testsupport/TestToken.java": `package fixtures.testsupport;
public final class TestToken {
  public static final String VALUE = "test-token";
}
`,
  "unrelated/src/main/java/pkg/Peer.java": `package pkg;
public final class Peer {
  public static String value() { return "WRONG_UNRELATED_PEER"; }
}
`,
  "unrelated/src/main/java/fixtures/unrelated/Hidden.java": `package fixtures.unrelated;
public final class Hidden {}
`,
  "app/src/main/java/pkg/Runner.java": `package pkg;
import fixtures.library.GreetingService;
import fixtures.processor.GenerateGreeting;
import generated.GeneratedGreeting;
@GenerateGreeting
public final class Runner {
  public static String result() throws Exception {
    GreetingService service = new GreetingService();
    String runtime = (String) Class.forName("fixtures.runtime.RuntimeToken").getField("VALUE").get(null);
    return service.message("JVM") + "|" + service.message(2) + "|" + GeneratedGreeting.value() + "|" + runtime + "|" + Peer.value();
  }
  public static void main(String[] args) throws Exception {
    System.out.println("JAVA_REFERENCE_OK:" + result() + "|" + GeneratedGreeting.mode());
  }
}
class Peer {
  static String value() { return "main-peer"; }
}
`,
  "app/src/test/java/pkg/Runner.java": `package pkg;
class Unrelated {
  static String value() { return "test-source-with-same-relative-path"; }
}
`,
  "app/src/test/java/pkg/RunnerTest.java": `package pkg;
import fixtures.testsupport.TestToken;
import generated.GeneratedGreeting;
import org.junit.Test;
import static org.junit.Assert.*;
public class RunnerTest {
  @Test public void dependenciesOverloadsAndGeneratedSource() throws Exception {
    assertEquals("hello JVM|count:2|generated-greeting|runtime-token|main-peer", Runner.result());
    assertEquals(System.getProperty("fixture.expectedMode"), GeneratedGreeting.mode());
  }
  @Test public void testScopeAndSamePathSource() {
    assertEquals("test-token", TestToken.VALUE);
    assertEquals("test-source-with-same-relative-path", Unrelated.value());
  }
  @Test public void unrelatedModuleIsNotVisible() {
    try {
      Class.forName("fixtures.unrelated.Hidden");
      fail("An unrelated reactor module leaked into the application classpath");
    } catch (ClassNotFoundException expected) { }
  }
}
`,
};

const parent = `<parent><groupId>ide.reference</groupId><artifactId>java-effective-project</artifactId><version>1.0</version><relativePath>../pom.xml</relativePath></parent>`;
const dependency = (module: string, scope = "compile") =>
  `<dependency><groupId>ide.reference</groupId><artifactId>${module}</artifactId><version>1.0</version><scope>${scope}</scope></dependency>`;
const pom = (module: string, body = "") =>
  `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>${parent}<artifactId>${module}</artifactId>${body}</project>\n`;

/** No classes, generated sources, dependency models or test reports are fabricated. */
export function javaEffectiveProjectReference(
  tool: JavaReferenceBuildTool,
  customGradleOutputs = false,
  referencedSafeDeleteFixture = false,
  javaRelease = 17,
  useGradleToolchain = false,
): Record<string, string> {
  if (!Number.isInteger(javaRelease) || javaRelease < 8 || javaRelease > 27) {
    throw new Error("Java reference fixture release must be an integer from 8 through 27");
  }
  const files = { ...sources };
  if (referencedSafeDeleteFixture) {
    if (tool !== "maven") throw new Error("Referenced safe-delete fixture requires Maven");
    Object.assign(files, javaCrossModuleClassMoveSources);
    files["unrelated/src/main/java/fixtures/unrelated/UsesHidden.java"] =
      `package fixtures.unrelated;
public final class UsesHidden {
  private final Hidden hidden = new Hidden();
  public Hidden value() { return hidden; }
}
`;
    files["unrelated/src/main/java/fixtures/unrelated/Unused.java"] = `package fixtures.unrelated;
public final class Unused {}
`;
  }
  if (tool === "maven") {
    files["pom.xml"] = `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion><groupId>ide.reference</groupId>
  <artifactId>java-effective-project</artifactId><version>1.0</version><packaging>pom</packaging>
  <modules>${JAVA_REFERENCE_MODULES.map((module) => `<module>${module}</module>`).join("")}</modules>
  <properties><maven.compiler.release>${javaRelease}</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding><greeting.fixture.mode>base</greeting.fixture.mode></properties>
  <profiles><profile><id>alternate</id><properties><greeting.fixture.mode>alternate</greeting.fixture.mode></properties></profile></profiles>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version>
      <configuration><systemPropertyVariables><fixture.expectedMode>\${greeting.fixture.mode}</fixture.expectedMode></systemPropertyVariables></configuration></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-jar-plugin</artifactId><version>3.4.2</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-source-plugin</artifactId><version>3.3.1</version>
      <executions><execution><id>sources</id><goals><goal>jar-no-fork</goal></goals></execution></executions></plugin>
  </plugins></build>
</project>
`;
    if (referencedSafeDeleteFixture) {
      files["pom.xml"] = files["pom.xml"]!.replace(
        "<fixture.expectedMode>",
        "<fixture.safeDeleteTarget>fixtures.unrelated.Unused</fixture.safeDeleteTarget><fixture.expectedMode>",
      );
    }
    for (const module of JAVA_REFERENCE_MODULES) files[`${module}/pom.xml`] = pom(module);
    files["processor/pom.xml"] = pom(
      "processor",
      `<build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><configuration><proc>none</proc></configuration></plugin></plugins></build>`,
    );
    files["app/pom.xml"] = pom(
      "app",
      `<dependencies>${dependency("library")}${dependency("processor", "provided")}${dependency("runtime", "runtime")}${dependency("testsupport", "test")}
        <dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency></dependencies>
      <build><plugins><plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId>
        <configuration><annotationProcessorPaths><path><groupId>ide.reference</groupId><artifactId>processor</artifactId><version>1.0</version></path></annotationProcessorPaths>
          <annotationProcessors><annotationProcessor>fixtures.processor.GreetingProcessor</annotationProcessor></annotationProcessors>
          <compilerArgs><arg>-Agreeting.mode=\${greeting.fixture.mode}</arg></compilerArgs></configuration>
      </plugin></plugins></build>`,
    );
  } else {
    files["settings.gradle"] =
      `rootProject.name = 'java-effective-project'\ninclude ${JAVA_REFERENCE_MODULES.map((module) => `'${module}'`).join(", ")}\n`;
    files["gradle.properties"] =
      "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n";
    files["build.gradle"] = `subprojects {
  apply plugin: 'java-library'
  group = 'ide.reference'
  version = '1.0'
  repositories { mavenCentral() }
  java {
    withSourcesJar()
${javaRelease >= 26 || useGradleToolchain ? `    toolchain { languageVersion = JavaLanguageVersion.of(${javaRelease}) }\n` : ""}  }
  tasks.withType(JavaCompile).configureEach {
${javaRelease === 8 && useGradleToolchain
    ? "    sourceCompatibility = '1.8'\n    targetCompatibility = '1.8'\n"
    : `    options.release = ${javaRelease}\n`}
${javaRelease === 27 ? "    doFirst { println('PROJECT_COMPILER_JDK:' + javaCompiler.get().metadata.installationPath.asFile.absolutePath) }\n" : ""}  }
  tasks.withType(Test).configureEach { useJUnit() }
}
`;
    for (const module of JAVA_REFERENCE_MODULES) files[`${module}/build.gradle`] = "";
    files["processor/build.gradle"] =
      "tasks.withType(JavaCompile).configureEach { options.compilerArgs.add('-proc:none') }\n";
    files["app/build.gradle"] = `apply plugin: 'application'
application { mainClass = 'pkg.Runner' }
dependencies {
  implementation project(':library')
  compileOnly project(':processor')
  annotationProcessor project(':processor')
  runtimeOnly project(':runtime')
  testImplementation project(':testsupport')
  testImplementation 'junit:junit:4.13.2'
}
def fixtureMode = providers.gradleProperty('fixtureMode').getOrElse('base')
tasks.named('compileJava') { options.compilerArgs.add('-Agreeting.mode=' + fixtureMode) }
tasks.named('test') { systemProperty 'fixture.expectedMode', fixtureMode }
`;
    if (customGradleOutputs) {
      files["app/build.gradle"] += `
def customMainOutput = layout.buildDirectory.dir('products/main')
def customTestOutput = layout.buildDirectory.dir('products/test')
sourceSets.main.output.classesDirs.setFrom(customMainOutput)
sourceSets.test.output.classesDirs.setFrom(customTestOutput)
tasks.named('compileJava') { destinationDirectory = customMainOutput }
tasks.named('compileTestJava') { destinationDirectory = customTestOutput }
`;
    }
  }
  return files;
}

/** Minimal Java 27 Maven project for metadata-only context qualification. */
export function javaMavenJava27MetadataReference(
  {
    crossModuleDefinition = false,
    execution = false,
  }: { crossModuleDefinition?: boolean; execution?: boolean } = {},
): Record<string, string> {
  return {
    "pom.xml": [
      "<project>",
      "  <modelVersion>4.0.0</modelVersion>",
      "  <groupId>fixture.release</groupId><artifactId>java27-context</artifactId><version>1</version>",
      `  <packaging>pom</packaging><modules>${crossModuleDefinition ? "<module>library</module>" : ""}<module>app</module></modules>`,
      "  <properties><maven.compiler.release>27</maven.compiler.release></properties>",
      "  <build><plugins><plugin>",
      "    <groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId>",
      "    <version>3.13.0</version><configuration><release>27</release></configuration>",
      "  </plugin>",
      ...(execution ? [
        "  <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin>",
      ] : []),
      "  </plugins></build>",
      "</project>",
      "",
    ].join("\n"),
    ...(crossModuleDefinition
      ? {
          "library/pom.xml": [
            "<project>",
            "  <modelVersion>4.0.0</modelVersion>",
            "  <parent><groupId>fixture.release</groupId><artifactId>java27-context</artifactId><version>1</version></parent>",
            "  <artifactId>library</artifactId>",
            ...(execution ? ["  <properties><skipTests>true</skipTests></properties>"] : []),
            "</project>",
            "",
          ].join("\n"),
          "library/src/main/java/fixtures/library/BaseGreeting.java": [
            "package fixtures.library;",
            "public class BaseGreeting {",
            '  public String message(int count) { return "count:" + count; }',
            "}",
            "",
          ].join("\n"),
          "library/src/main/java/fixtures/library/GreetingService.java": [
            "package fixtures.library;",
            "public class GreetingService extends BaseGreeting {}",
            "",
          ].join("\n"),
        }
      : {}),
    "app/pom.xml": [
      "<project>",
      "  <modelVersion>4.0.0</modelVersion>",
      "  <parent><groupId>fixture.release</groupId><artifactId>java27-context</artifactId><version>1</version></parent>",
      "  <artifactId>app</artifactId>",
      ...(crossModuleDefinition
        ? [
            "  <dependencies>",
            "    <dependency><groupId>fixture.release</groupId><artifactId>library</artifactId><version>1</version></dependency>",
            ...(execution ? ["    <dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.13.2</version><scope>test</scope></dependency>"] : []),
            "  </dependencies>",
          ]
        : []),
      "</project>",
      "",
    ].join("\n"),
    "app/src/main/java/pkg/Runner.java": crossModuleDefinition
      ? [
          "package pkg;",
          "import fixtures.library.GreetingService;",
          "public final class Runner extends GreetingService {",
          "  public int result() { return message(2).length(); }",
          execution
            ? "  public static void main(String[] args) throws java.io.IOException {"
            : "  public static void main(String[] args) {",
          ...(execution ? [
            '    if (Boolean.getBoolean("java27.gui.input")) {',
            '      System.out.println("PROJECT_GUI_INPUT_PID:" + ProcessHandle.current().pid());',
            '      System.out.println("PROJECT_GUI_INPUT_READY");',
            '      System.out.println("JAVA_27_INPUT:" + java.util.Base64.getEncoder().encodeToString(System.in.readAllBytes()));',
            "    }",
          ] : []),
          '    System.out.println("JAVA_27_CROSS_MODULE:" + new Runner().result());',
          ...(execution ? ['    System.out.println("JAVA_27_RUNTIME:" + System.getProperty("java.specification.version"));'] : []),
          "  }",
          "  public String describe(GreetingService receiver) { return receiver.toString(); }",
          "}",
          "",
        ].join("\n")
      : [
          "package pkg;",
          "public final class Runner {",
          "  public static void main(String[] args) {",
          '    System.out.println("java-27");',
          "  }",
          "}",
          "",
        ].join("\n"),
    ...(execution ? {
      "library/src/test/java/pkg/RunnerTest.java":
        "package pkg; public class RunnerTest { public void unrelatedDeclaration() {} }\n",
      "app/src/test/java/pkg/RunnerTest.java": `package pkg;
public class RunnerTest {
  @org.junit.Test public void runsWithSelectedSdk() throws Exception {
    org.junit.Assert.assertEquals(7, new Runner().result());
    org.junit.Assert.assertEquals("27", System.getProperty("java.specification.version"));
    org.junit.Assert.assertEquals("value with spaces", System.getProperty("java27.gui.test"));
    java.nio.file.Files.writeString(java.nio.file.Path.of("target/selected-test-proof.txt"), "selected",
        java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
  }
  @org.junit.Test public void verifiesCrossModuleValue() throws Exception {
    org.junit.Assert.assertEquals(7, new Runner().result());
    java.nio.file.Files.writeString(java.nio.file.Path.of("target/unselected-test-proof.txt"), "unselected");
  }
}
`,
    } : {}),
  };
}

/** Single-project Maven JPMS fixture with a real named dependency module. */
export function javaMavenJpmsV5Reference(): Record<string, string> {
  return {
    "pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion><groupId>fixture</groupId><artifactId>app</artifactId><version>1.0</version>
  <properties><maven.compiler.release>21</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
  <dependencies><dependency><groupId>fixture</groupId><artifactId>dependency</artifactId><version>1</version></dependency></dependencies>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-resources-plugin</artifactId><version>3.3.1</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.3</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-jar-plugin</artifactId><version>3.4.2</version></plugin>
  </plugins></build>
</project>\n`,
    "src/main/java/module-info.java": `module fixture.app {
  requires transitive fixture.dependency;
  exports fixture.api to fixture.dependency;
  opens fixture.api to fixture.dependency;
  uses fixture.service.Service;
  provides fixture.service.Service with fixture.service.Provider;
}
`,
    "src/main/java/fixture/app/Main.java": `package fixture.app;
public final class Main {
  public static void main(String[] args) {
    String dependencyModule = dependency.api.DependencyApi.class.getModule().getName();
    System.out.println("MAVEN_JPMS_OK:" + dependencyModule + ":" + String.join("|", args));
  }
}
`,
    "src/main/java/fixture/api/Api.java": `package fixture.api;
public final class Api {}
`,
    "src/main/java/fixture/service/Service.java": `package fixture.service;
public interface Service {}
`,
    "src/main/java/fixture/service/Provider.java": `package fixture.service;
public final class Provider implements Service {
  public Provider() {}
}
`,
  };
}

/** Single-project Gradle JPMS fixture with a real named dependency module. */
export function javaGradleJpmsReference(
  modulePathJar: string,
  includeStandardDirectives = false,
): Record<string, string> {
  const quotedModulePathJar = modulePathJar.replaceAll("'", "\\'");
  const directives = includeStandardDirectives
    ? `  opens fixture.api to fixture.dependency;
  uses fixture.service.Service;
  provides fixture.service.Service with fixture.service.Provider;
`
    : "";
  return {
    "settings.gradle": "rootProject.name = 'gradle-jpms-reference'\n",
    "gradle.properties":
      "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n",
    "build.gradle": `apply plugin: 'java'
tasks.withType(JavaCompile).configureEach {
  options.release = 21
  options.compilerArgs.addAll(['--module-path', '${quotedModulePathJar}'])
}
`,
    "src/main/java/module-info.java": `module fixture.gradle {
  requires transitive fixture.dependency;
  exports fixture.api to fixture.dependency;
${directives}}
`,
    ...(includeStandardDirectives
      ? {
          "src/main/java/fixture/app/Main.java": `package fixture.app;
public final class Main {
  public static void main(String[] args) throws java.io.IOException {
    String dependencyModule = dependency.api.DependencyApi.class.getModule().getName();
    System.out.println("GRADLE_JPMS_OK:" + dependencyModule + ":" + String.join("|", args));
  }
}
`,
          "src/main/java/fixture/service/Service.java": `package fixture.service;
public interface Service {}
`,
          "src/main/java/fixture/service/Provider.java": `package fixture.service;
public final class Provider implements Service {
  public Provider() {}
}
`,
        }
      : {}),
    "src/main/java/fixture/api/Api.java": `package fixture.api;
public final class Api {
  private final dependency.api.DependencyApi dependency = new dependency.api.DependencyApi();
  public dependency.api.DependencyApi dependency() { return dependency; }
}
`,
  };
}

/** Single-project Gradle preview fixture for synchronizing verified compiler options to JDT LS. */
export function javaGradlePreviewReference(javaRelease = 21): Record<string, string> {
  if (javaRelease !== 21 && javaRelease !== 25 && javaRelease !== 27) {
    throw new Error("Gradle preview fixture release must be 21, 25 or 27");
  }
  const previewSource =
    javaRelease === 25 || javaRelease === 27
      ? `package pkg;
public final class PreviewFixture {
  static int classify(int value) {
    return switch (value) {
      case int matched -> matched;
    };
  }
}
`
      : `package pkg;
public final class PreviewFixture {
  static int classify(Object value) {
    return switch (value) {
      case String _ -> 1;
      default -> 0;
    };
  }
}
`;
  return {
    "settings.gradle": "rootProject.name = 'gradle-preview-reference'\ninclude 'app'\n",
    "gradle.properties":
      "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n",
    "build.gradle": `subprojects {
  apply plugin: 'java-library'
  java {
    sourceCompatibility = JavaVersion.toVersion(${javaRelease})
    targetCompatibility = JavaVersion.toVersion(${javaRelease})
  }
  tasks.withType(JavaCompile).configureEach {
    options.release = ${javaRelease}
    options.compilerArgs.add('--enable-preview')
  }
}
`,
    "app/build.gradle": "",
    "app/src/main/java/pkg/PreviewFixture.java": previewSource,
  };
}

export const JAVA_REFERENCE_COMPILE_SCOPE_PROBE = `package pkg;
public class ScopeProbe {
  fixtures.runtime.RuntimeToken runtimeOnly;
  fixtures.testsupport.TestToken testOnly;
}
`;

export const JAVA_REFERENCE_RUN_MARKER =
  "JAVA_REFERENCE_OK:hello JVM|count:2|generated-greeting|runtime-token|main-peer|";

/** Two-module Java/JUnit project whose build and settings scripts use Gradle Kotlin DSL. */
export function javaGradleLiteralDependencyReference(kotlin: boolean): Record<string, string> {
  const settingsName = kotlin ? "settings.gradle.kts" : "settings.gradle";
  const buildName = kotlin ? "build.gradle.kts" : "build.gradle";
  const include = kotlin ? 'include(":app", ":library")' : "include ':app', ':library'";
  const javaPlugin = kotlin ? "plugins { java }" : "plugins { id 'java' }";
  const dependency = kotlin ? 'implementation(project(":library"))' : "implementation project(':library')";
  return {
    [settingsName]: `rootProject.name = "literal-rename"\n${include}\n`,
    "gradle.properties": "org.gradle.daemon=false\norg.gradle.workers.max=2\n",
    [`app/${buildName}`]: `${javaPlugin}\ndependencies { ${dependency} }\n`,
    [`library/${buildName}`]: `${javaPlugin}\n`,
    "app/src/main/java/pkg/Runner.java":
      "package pkg; public class Runner { public static void main(String[] args) { System.out.println(Library.value()); } }\n",
    "library/src/main/java/pkg/Library.java":
      'package pkg; public class Library { public static String value() { return "library remains linked"; } }\n',
  };
}

export function javaGradleKotlinDslReference(): Record<string, string> {
  return {
    "settings.gradle.kts": `rootProject.name = "java-kotlin-dsl-reference"
include(":app", ":library")
`,
    "build.gradle.kts": `plugins {
    base
}
`,
    "gradle.properties":
      "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n",
    "library/build.gradle.kts": `import org.gradle.api.tasks.compile.JavaCompile

plugins {
    id("java-library")
}

group = "ide.reference"
version = "1.0"

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}
`,
    "library/src/main/java/pkg/Greeter.java": `package pkg;
public final class Greeter {
  private Greeter() {}
  public static String message() { return "from-gradle-library"; }
}
`,
    "app/build.gradle.kts": `import org.gradle.api.tasks.compile.JavaCompile
import org.gradle.api.tasks.testing.Test

plugins {
    application
}

group = "ide.reference"
version = "1.0"

application {
    mainClass.set("pkg.Runner")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(project(":library"))
    testImplementation("junit:junit:4.13.2")
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(17)
}

tasks.withType<Test>().configureEach {
    useJUnit()
    systemProperty("ide.gradle.kotlin.dsl", "enabled")
}
`,
    "app/src/main/java/pkg/Runner.java": `package pkg;
public final class Runner {
  public static void main(String[] args) throws Exception {
    System.out.println("GRADLE_KOTLIN_DSL_MAIN:" + pkg.Greeter.message() + ":" + System.getProperty("java.home"));
  }
}
`,
    "app/src/test/java/pkg/RunnerDslTest.java": `package pkg;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class RunnerDslTest {
  @Test public void kotlinDslConfiguredTaskRuns() throws Exception {
    assertEquals("enabled", System.getProperty("ide.gradle.kotlin.dsl"));
    assertEquals("from-gradle-library", pkg.Greeter.message());
    Files.writeString(Path.of("gradle-kotlin-dsl-test-proof.txt"), "kotlin-dsl:" + pkg.Greeter.message() + "\\n");
  }
}
`,
  };
}

/** Small offline Gradle reactor for package-move acceptance with a local JUnit test dependency. */
export function javaGradlePackageMoveReference(): Record<string, string> {
  return {
    "settings.gradle": `rootProject.name = 'java-package-move-reference'\ninclude 'library', 'app', 'unrelated'\n`,
    "gradle.properties":
      "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n",
    "build.gradle": `subprojects {
  apply plugin: 'java-library'
  group = 'ide.package.move'
  version = '1.0'
  java { withSourcesJar() }
  tasks.withType(JavaCompile).configureEach { options.release = 17 }
}
`,
    "library/build.gradle": "",
    "app/build.gradle": `apply plugin: 'application'
application { mainClass = 'pkg.Runner' }
dependencies { implementation project(':library') }
`,
    "unrelated/build.gradle": "",
    "library/src/main/java/pkg/Library.java": `package pkg;
public final class Library { public static String value() { return "library"; } }
`,
    "app/src/main/java/pkg/Runner.java": `package pkg;
public final class Runner {
  public static void main(String[] args) { System.out.println(Library.value()); }
}
`,
    "app/src/test/java/pkg/RunnerTest.java": `package pkg;
final class RunnerTest { static String value() { return Runner.class.getName(); } }
`,
    "unrelated/src/main/java/pkg/Peer.java": `package pkg;
public final class Peer { public static String value() { return "unrelated"; } }
`,
  };
}

export const NESTED_COMPOSITE_BUILD = "included-build/second-build";

const mixedJvmSources = {
  "app/src/main/java/pkg/Runner.java": `package pkg;
public final class Runner {
    public static void main(String[] args) {
        System.out.println("JAVA_KOTLIN_INTEROP:" + Greeter.message());
    }
    static String fromJava() {
        return "java";
    }
    static String javaControl() {
        return fromJava();
    }
}
`,
  "app/src/main/kotlin/pkg/Greeter.kt": `package pkg
object Greeter {
    @JvmStatic fun message(): String = Runner.fromJava() + "-kotlin"
}
`,
};

export function javaGradleMixedJvmReference(repositoryUrl: string): Record<string, string> {
  const repository = `maven { url = uri(${JSON.stringify(repositoryUrl)}) }`;
  return {
    "settings.gradle": `pluginManagement { repositories { ${repository} } }
rootProject.name = 'mixed-jvm'
include 'app'
`,
    "gradle.properties": "org.gradle.daemon=false\norg.gradle.workers.max=2\nkotlin.compiler.execution.strategy=in-process\norg.gradle.java.installations.auto-download=false\n",
    "app/build.gradle": `plugins {
    id 'application'
    id 'org.jetbrains.kotlin.jvm' version '2.0.21'
}
repositories { ${repository} }
application { mainClass = 'pkg.Runner' }
kotlin { jvmToolchain(21) }
`,
    ...mixedJvmSources,
  };
}

export function javaMavenMixedJvmReference(): Record<string, string> {
  return {
    "pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>ide.mixed</groupId><artifactId>mixed-jvm</artifactId><version>1.0</version>
  <packaging>pom</packaging>
  <modules><module>app</module></modules>
</project>
`,
    "app/pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <parent><groupId>ide.mixed</groupId><artifactId>mixed-jvm</artifactId><version>1.0</version></parent>
  <artifactId>app</artifactId>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <kotlin.version>2.0.21</kotlin.version>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency><groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-stdlib</artifactId><version>\${kotlin.version}</version></dependency>
  </dependencies>
  <build><plugins>
    <plugin>
      <groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-maven-plugin</artifactId><version>\${kotlin.version}</version>
      <executions><execution><id>kotlin-compile</id><phase>process-sources</phase><goals><goal>compile</goal></goals></execution></executions>
      <configuration><jvmTarget>21</jvmTarget><sourceDirs><sourceDir>\${project.basedir}/src/main/kotlin</sourceDir><sourceDir>\${project.basedir}/src/main/java</sourceDir></sourceDirs></configuration>
    </plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.14.1</version></plugin>
  </plugins></build>
</project>
`,
    ...mixedJvmSources,
  };
}

/** Gradle composite with an included build whose project directories are siblings of its build root. */
export function javaGradleCompositeProjectReference(samePathApp = false): Record<string, string> {
  const files: Record<string, string> = {
    "settings.gradle": `rootProject.name = 'java-composite-workspace'\nincludeBuild 'included-build'\n`,
    "gradle.properties":
      "org.gradle.daemon=false\norg.gradle.parallel=false\norg.gradle.workers.max=2\n",
    "included-build/settings.gradle": `rootProject.name = 'included-build'\ninclude 'app', 'library'\nproject(':app').projectDir = file('../app')\nproject(':library').projectDir = file('../library')\n`,
    "included-build/build.gradle": `subprojects {\n  apply plugin: 'java-library'\n  group = 'ide.composite'\n  version = '1.0'\n  repositories { mavenCentral() }\n  tasks.withType(JavaCompile).configureEach { options.release = 17 }\n}\n`,
    "app/build.gradle": `apply plugin: 'application'\napplication { mainClass = 'pkg.Runner' }\ndependencies { implementation project(':library') }\n`,
    "library/build.gradle": "",
    "app/src/main/java/pkg/Runner.java": `package pkg;\npublic final class Runner {\n  public static void main(String[] args) throws Exception {\n    System.out.println("GRADLE_COMPOSITE_RUN_OK:" + Greeter.message());\n    System.out.println("PROJECT_GUI_JDK:" + System.getProperty("java.home"));\n  }\n}\n`,
    "library/src/main/java/pkg/Greeter.java": `package pkg;\npublic final class Greeter {\n  public static String message() { return "included-build"; }\n}\n`,
  };
  if (samePathApp) {
    files["settings.gradle"] += "includeBuild('shared-runtime') { name = 'runtimeAlias' }\n";
    files["included-build/settings.gradle"] += "includeBuild('second-build') { name = 'nested-app' }\n";
    files[`${NESTED_COMPOSITE_BUILD}/settings.gradle`] = "rootProject.name = 'second-build'\ninclude 'app'\n";
    files[`${NESTED_COMPOSITE_BUILD}/app/build.gradle`] = `plugins { id 'application' }
application { mainClass = 'pkg.Runner' }
dependencies {
  implementation 'ide.composite:nested-runtime:1.0'
  implementation 'ide.composite:library:1.0'
}
`;
    files["library/src/main/java/pkg/ParentLibrary.java"] = `package pkg;
public final class ParentLibrary {
  public static String marker(String build) { return build; }
}
`;
    files["shared-runtime/settings.gradle"] = "rootProject.name = 'nested-runtime'\n";
    files["shared-runtime/build.gradle"] = "plugins { id 'java-library' }\ngroup = 'ide.composite'\nversion = '1.0'\n";
    files["shared-runtime/src/main/java/pkg/BuildLibrary.java"] = `package pkg;
public final class BuildLibrary {
  public static String origin() { return "second-build"; }
}
`;
    files[`${NESTED_COMPOSITE_BUILD}/app/src/main/java/pkg/Runner.java`] = `package pkg;
public final class Runner {
  public static String origin() {
    return ParentLibrary.marker(BuildLibrary.origin());
  }
  public static void main(String[] args) {
    System.out.println("GRADLE_COMPOSITE_RUN_OK:" + origin());
    System.out.println("PROJECT_GUI_JDK:" + System.getProperty("java.home"));
  }
}
`;
    files[`${NESTED_COMPOSITE_BUILD}/app/src/test/java/pkg/RunnerTest.java`] = `package pkg;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public final class RunnerTest {
  @Test public void testScopeAndSamePathSource() throws Exception {
    String origin = Runner.origin();
    assertEquals("second-build", origin);
    Files.writeString(Path.of("selected-method.txt"), origin + "\\n", StandardOpenOption.CREATE, StandardOpenOption.APPEND);
  }
  @Test public void secondBuildOnly() throws Exception {
    Files.writeString(Path.of("other-method.txt"), Runner.origin());
  }
}
`;
  }
  return files;
}
