import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { readNativeJUnitReport } = await tsImport(
  "../story/support/native-java-test-report.ts",
  import.meta.url,
);
const { nativeJavaBuildToolFixture, MAIN_MODE_PREFIX, TEST_EXPECTED_PREFIX } = await tsImport(
  "../story/fixtures/native-java-build-tool-fixtures.ts",
  import.meta.url,
);
const marker = "GUI_MAVEN_JUNIT_EXECUTED";
function xml(failed = false) {
  return `<?xml version="1.0"?><testsuite name="MainTest" tests="1" failures="${failed ? 1 : 0}" errors="0" skipped="0"><testcase classname="MainTest" name="savedSource">${failed ? '<failure message="expected:&lt;2&gt; but was:&lt;1&gt;"/>' : ""}<system-out>${marker}</system-out></testcase></testsuite>`;
}
async function fixture(run) {
  const workspace = await mkdtemp(path.join(tmpdir(), "native-junit-evidence-"));
  const relative = "target/surefire-reports/TEST-MainTest.xml";
  const file = path.join(workspace, relative);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(file, xml());
    await run({ workspace, relative, file });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
test("JUnit observation correlates the executed case and parses passing/failing XML without mutation", async () => {
  await fixture(async ({ workspace, relative, file }) => {
    const before = await readFile(file);
    const passed = await readNativeJUnitReport(workspace, relative, marker);
    assert.equal(passed.tests, 1);
    assert.equal(passed.failures, 0);
    assert.equal(passed.errors, 0);
    assert.equal(passed.skipped, 0);
    assert.equal(passed.caseFailure, false);
    assert.equal(passed.markerObserved, true);
    assert.deepEqual(await readFile(file), before);
    await writeFile(file, xml(true));
    const failed = await readNativeJUnitReport(workspace, relative, marker);
    assert.equal(failed.failures, 1);
    assert.equal(failed.caseFailure, true);
    assert.equal(failed.failureMessage, "expected:<2> but was:<1>");
    assert.notEqual(failed.sha256, passed.sha256);
  });
});
test("JUnit Platform reports may qualify the literal method name with empty parentheses", async () => {
  await fixture(async ({ workspace, relative, file }) => {
    await writeFile(file, xml().replace('name="savedSource"', 'name="savedSource()"'));
    const report = await readNativeJUnitReport(workspace, relative, marker);
    assert.equal(report.tests, 1);
    assert.equal(report.caseFailure, false);
    assert.equal(report.markerObserved, true);
  });
});
test("Failsafe reports may identify a test compiled from a custom integration source root", async () => {
  await fixture(async ({ workspace, relative, file }) => {
    const customSourceRootReport = xml().replaceAll("MainTest", "MainIT");
    await writeFile(file, customSourceRootReport);
    const report = await readNativeJUnitReport(workspace, relative, marker, "MainIT", "MainIT");
    assert.equal(report.tests, 1);
    assert.equal(report.failures, 0);
    assert.equal(report.markerObserved, true);
  });
});
test("JUnit observation refuses missing, oversized, uncorrelated and unsafe reports", async () => {
  await fixture(async ({ workspace, relative, file }) => {
    await assert.rejects(readNativeJUnitReport(workspace, "../outside.xml", marker));
    await assert.rejects(readNativeJUnitReport(workspace, "absent.xml", marker));
    for (const content of [
      "<broken",
      Buffer.alloc(128 * 1024 + 1),
      xml().replaceAll("MainTest", "OtherTest"),
      xml().replace(marker, "an unrelated test"),
      xml().replace('tests="1"', 'tests="0"'),
      '<!DOCTYPE testsuite [<!ENTITY x "boom">]>' + xml(),
    ]) {
      await writeFile(file, content);
      await assert.rejects(readNativeJUnitReport(workspace, relative, marker));
    }
    await rm(file);
    await writeFile(path.join(workspace, "outside.xml"), xml());
    await symlink(path.join(workspace, "outside.xml"), file);
    await assert.rejects(readNativeJUnitReport(workspace, relative, marker));
  });
});
test("build-tool fixtures are genuine source inputs with bounded keyboard edits and pinned JUnit", () => {
  for (const tool of ["maven", "gradle"]) {
    const value = nativeJavaBuildToolFixture(tool);
    assert.equal(value.files["src/main/java/Main.java"], value.main("0"));
    assert.equal(value.files["src/test/java/MainTest.java"], value.test("1"));
    for (const [prefix, content] of [
      [MAIN_MODE_PREFIX, value.main("1")],
      [TEST_EXPECTED_PREFIX, value.test("2")],
    ]) {
      assert.ok(prefix.length < 128);
      assert.ok(content.startsWith(prefix));
    }
    assert.ok(Object.values(value.files).some((input) => input.includes("4.13.2")));
    assert.ok(value.main("1").includes("StandardOpenOption.APPEND"));
    assert.ok(
      !Object.keys(value.files).some((file) =>
        /\.(class|jar)$|TEST-MainTest|proof\.txt/.test(file),
      ),
    );
  }
  const failsafe = nativeJavaBuildToolFixture("maven", "failsafe");
  assert.ok(failsafe.files["src/integration-test/java/MainIT.java"]);
  assert.match(failsafe.files["pom.xml"], /src\/integration-test\/java/);
  assert.match(failsafe.files["pom.xml"], /\*\*\/MainIT\.java/);
  assert.equal(failsafe.testReportSuite, "MainIT");
  assert.equal(failsafe.testReport, "target/failsafe-reports/TEST-MainIT.xml");
  const jupiter = nativeJavaBuildToolFixture("gradle", "discovery", "junit5");
  assert.match(jupiter.files["src/test/java/MainTest.java"], /org\.junit\.jupiter\.api\.Test/);
  assert.match(jupiter.files["build.gradle"], /testImplementation 'org\.junit\.jupiter:junit-jupiter:5\.11\.2'/);
  assert.match(jupiter.files["build.gradle"], /testRuntimeOnly 'org\.junit\.platform:junit-platform-launcher:1\.11\.2'/);
  assert.match(jupiter.files["build.gradle"], /useJUnitPlatform\(\)/);
});
