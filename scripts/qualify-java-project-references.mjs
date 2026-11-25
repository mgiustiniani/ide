#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRegressionCommand } from "./run-m0-regression.mjs";
import {
  javaEffectiveProjectReference,
  JAVA_REFERENCE_COMPILE_SCOPE_PROBE,
  JAVA_REFERENCE_MODULES,
  JAVA_REFERENCE_RUN_MARKER,
} from "../tests/story/fixtures/java-effective-project-reference.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));
const reportCheck = `import sys, xml.etree.ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
assert root.tag == 'testsuite'
assert root.get('name') == 'pkg.RunnerTest'
assert int(root.get('tests', '0')) == 3
for key in ['failures', 'errors', 'skipped']: assert int(root.get(key, '0')) == 0
cases = root.findall('testcase')
assert len(cases) == 3
assert {case.get('name') for case in cases} == {'dependenciesOverloadsAndGeneratedSource', 'testScopeAndSamePathSource', 'unrelatedModuleIsNotVisible'}
assert all(case.get('classname') == 'pkg.RunnerTest' for case in cases)
print('Three real JUnit cases passed.')
`;

async function main() {
  if (process.argv.length !== 2) throw new Error("Usage: qualify-java-project-references.mjs");
  const selectedHome = process.env.IDE_JAVA_HOME ?? process.env.JAVA_HOME;
  if (!selectedHome) throw new Error("Set IDE_JAVA_HOME or JAVA_HOME to the full JDK to qualify.");
  const jdk = await realpath(selectedHome);
  const javaRelease = Number(process.env.IDE_JAVA_REFERENCE_RELEASE ?? "17");
  if (!Number.isInteger(javaRelease) || javaRelease < 8 || javaRelease > 27)
    throw new Error("IDE_JAVA_REFERENCE_RELEASE must be an integer from 8 through 27.");
  const tools = (process.env.IDE_JAVA_REFERENCE_TOOLS ?? "maven,gradle")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
  if (
    tools.length === 0 ||
    new Set(tools).size !== tools.length ||
    tools.some((tool) => !["maven", "gradle"].includes(tool))
  )
    throw new Error("IDE_JAVA_REFERENCE_TOOLS must be a comma-separated selection of maven and gradle.");
  const configuredGradleRuntime = process.env.IDE_JAVA_REFERENCE_GRADLE_RUNTIME_JDK;
  const gradleRuntime = tools.includes("gradle") && configuredGradleRuntime
    ? await realpath(configuredGradleRuntime)
    : jdk;
  const separateGradleRuntime = gradleRuntime !== jdk;
  const environment = { ...process.env, JAVA_HOME: jdk };
  const artifactRoot = path.join(repository, "test-results/java-project-references");
  await mkdir(artifactRoot, { recursive: true });
  const artifacts = await mkdtemp(path.join(artifactRoot, "run-"));
  const result = {
    scope: "real-build-tools",
    nativeGui: false,
    packagedApplication: false,
    effectiveProjectImport: "not-tested",
    selectedJdk: jdk,
    gradleRuntimeJdk: tools.includes("gradle") ? gradleRuntime : null,
    targetRelease: javaRelease,
    buildTools: tools,
    passed: false,
    projects: [],
    commands: [],
  };
  const publish = () =>
    writeFile(path.join(artifacts, "result.json"), JSON.stringify(result, null, 2) + "\n");
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  console.log(`Java project reference artifacts: ${artifacts}`);
  await publish();
  const command = async (
    name, executable, arguments_, cwd, expectFailure = false, commandEnvironment = environment,
  ) => {
    console.log(`START ${name}`);
    const observation = await runRegressionCommand(
      { name, command: executable, arguments: arguments_, timeoutMs: 180_000 },
      { cwd, artifactPath: artifacts, environment: commandEnvironment, signal: controller.signal },
    );
    result.commands.push({
      ...observation,
      expectedOutcome: expectFailure ? "compile-refusal" : "success",
    });
    await publish();
    const output =
      (await readFile(path.join(artifacts, `${name}.stdout.log`), "utf8")) +
      (await readFile(path.join(artifacts, `${name}.stderr.log`), "utf8"));
    assert.ok(
      expectFailure
        ? observation.exitCode !== null &&
            observation.exitCode !== 0 &&
            !observation.timedOut &&
            !observation.aborted &&
            !observation.launchError
        : observation.passed,
      `${name} did not produce its expected real outcome. See ${artifacts}.\n${output.slice(-4000)}`,
    );
    console.log(`${expectFailure ? "REFUSED" : "PASS"} ${name}`);
    return output;
  };
  try {
    await command("jdk-version", path.join(jdk, "bin/java"), ["-version"], artifacts);
    for (const tool of tools) {
      const root = path.join(artifacts, tool);
      const useGradleToolchain = tool === "gradle" && separateGradleRuntime;
      const inputs = javaEffectiveProjectReference(tool, false, false, javaRelease, useGradleToolchain);
      for (const [relative, contents] of Object.entries(inputs)) {
        const target = path.join(root, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents, { flag: "wx" });
      }
      const executable = tool === "maven" ? "mvn" : "gradle";
      const baseArguments =
        tool === "maven"
          ? ["-B", "-o", "-Dstyle.color=never"]
          : ["--offline", "--no-daemon", "--console=plain"];
      if (useGradleToolchain) {
        baseArguments.push(
          `-Porg.gradle.java.installations.paths=${jdk}`,
          "-Porg.gradle.java.installations.auto-detect=false",
          "-Porg.gradle.java.installations.auto-download=false",
        );
      }
      const buildToolEnvironment = useGradleToolchain
        ? { ...environment, JAVA_HOME: gradleRuntime }
        : environment;
      const buildCommand = (name, args, expectFailure = false) =>
        command(name, executable, args, root, expectFailure, buildToolEnvironment);
      const version = await buildCommand(`${tool}-version`, ["--version"]);
      assert.match(version, tool === "maven" ? /Apache Maven [\d.]+/ : /Gradle [\d.]+/);
      const project = { tool, modules: JAVA_REFERENCE_MODULES, passed: false, modes: [] };
      result.projects.push(project);
      const report = path.join(
        root,
        "app",
        tool === "maven"
          ? "target/surefire-reports/TEST-pkg.RunnerTest.xml"
          : "build/test-results/test/TEST-pkg.RunnerTest.xml",
      );
      const generated = path.join(
        root,
        "app",
        tool === "maven"
          ? "target/generated-sources/annotations/generated/GeneratedGreeting.java"
          : "build/generated/sources/annotationProcessor/java/main/generated/GeneratedGreeting.java",
      );
      for (const mode of ["base", "alternate"]) {
        const args = [...baseArguments, "clean", tool === "maven" ? "verify" : "build"];
        if (mode === "alternate")
          args.push(tool === "maven" ? "-Palternate" : "-PfixtureMode=alternate");
        await buildCommand(`${tool}-${mode}-build`, args);
        const generatedSource = await readFile(generated, "utf8");
        assert.ok(
          generatedSource.includes(`return "${mode}"`),
          "Annotation processor did not use the requested build context",
        );
        await command(`${tool}-${mode}-junit`, "python3", ["-c", reportCheck, report], root);
        const classes = JAVA_REFERENCE_MODULES.filter((module) =>
          ["app", "library", "runtime"].includes(module),
        ).map((module) =>
          path.join(root, module, tool === "maven" ? "target/classes" : "build/classes/java/main"),
        );
        const output = await command(
          `${tool}-${mode}-run`,
          path.join(jdk, "bin/java"),
          ["-cp", classes.join(path.delimiter), "pkg.Runner"],
          root,
        );
        assert.ok(output.includes(JAVA_REFERENCE_RUN_MARKER + mode));
        const runnerClass = await readFile(
          path.join(classes[classes.length - 1], "pkg/Runner.class"),
        );
        assert.equal(runnerClass.readUInt32BE(0), 0xcafebabe);
        assert.equal(
          runnerClass.readUInt16BE(6),
          javaRelease + 44,
          `The build did not produce Java ${javaRelease} bytecode`,
        );
        const compilerHome = await readFile(
          path.join(classes[classes.length - 1], "processor-jdk-home.txt"),
          "utf8",
        );
        const processorRuntime = await realpath(compilerHome);
        assert.ok(
          processorRuntime === jdk || processorRuntime === path.join(jdk, "jre"),
          `The annotation processor ran on another JDK: ${processorRuntime}`,
        );
        const sourceJar = path.join(
          root,
          "library",
          tool === "maven"
            ? "target/library-1.0-sources.jar"
            : "build/libs/library-1.0-sources.jar",
        );
        const sourceEntries = await command(
          `${tool}-${mode}-sources`,
          path.join(jdk, "bin/jar"),
          ["tf", sourceJar],
          root,
        );
        assert.ok(sourceEntries.includes("fixtures/library/GreetingService.java"));
        project.modes.push({
          mode,
          junitCases: 3,
          generatedSource: true,
          sourceJar: true,
          application: true,
          selectedCompilerJdk: true,
        });
        await publish();
      }
      const probe = path.join(root, "app/src/main/java/pkg/ScopeProbe.java");
      await writeFile(probe, JAVA_REFERENCE_COMPILE_SCOPE_PROBE, { flag: "wx" });
      const refusal = await buildCommand(
        `${tool}-main-scope-refusal`,
        [...baseArguments, tool === "maven" ? "compile" : ":app:compileJava"],
        true,
      );
      assert.ok(
        refusal.includes("fixtures.runtime") && refusal.includes("fixtures.testsupport"),
        "The compile refusal did not identify both runtime-only and test-only dependencies",
      );
      await rm(probe);
      project.mainScopeRefusedRuntimeAndTestDependencies = true;
      for (const [relative, expected] of Object.entries(inputs)) {
        assert.equal(
          await readFile(path.join(root, relative), "utf8"),
          expected,
          `The build changed ${relative}`,
        );
      }
      project.originalInputsPreserved = true;
      project.passed = true;
      await publish();
    }
    result.passed = true;
    await publish();
    console.log(
      `PASS ${tools.join(" and ")} Java reference builds, tests, generation and dependency scopes.`,
    );
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    await publish();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
