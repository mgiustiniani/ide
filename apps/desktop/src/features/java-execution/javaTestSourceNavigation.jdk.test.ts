import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveJavaTestFailureLine } from "./javaTestSourceNavigation";

// Opt-in real-JDK qualification; ordinary component tests need no installed JDK.
const jdk = process.env.IDE_JAVA_TEST_NAVIGATION_JDK;

describe.skipIf(!jdk)("Java test failure navigation with a real JDK", () => {
  const executable = (name: string) =>
    join(jdk!, "bin", `${name}${process.platform === "win32" ? ".exe" : ""}`);

  it("accepts the JDK's StackTraceElement output for named and unnamed runtime components", () => {
    const root = mkdtempSync(join(tmpdir(), "ide-test-stack-trace-"));
    try {
      const oracle = join(root, "StackTraceOracle.java");
      writeFileSync(
        oracle,
        `
class StackTraceOracle {
  public static void main(String[] args) {
    for (String loader : new String[] {null, "test-loader"}) {
      for (String module : new String[] {null, "test.module"}) {
        for (String version : new String[] {null, "1.0-rc+2"}) {
          System.out.println("at " + new StackTraceElement(loader, module, version,
            "pkg.Outer$Nested", "fails", "Outer.java", 3));
        }
      }
    }
  }
}
`,
      );
      const lines = execFileSync(executable("java"), ["--source", "17", oracle], {
        encoding: "utf8",
        timeout: 30_000,
      })
        .trim()
        .split(/\r?\n/);
      expect(lines).toHaveLength(8);
      expect(lines.some((line) => line.includes("test-loader//"))).toBe(true);
      expect(lines.some((line) => line.includes("test.module@1.0-rc+2/"))).toBe(true);
      for (const detail of lines) {
        expect(
          resolveJavaTestFailureLine(
            detail,
            "pkg.Outer$Nested",
            "package pkg;\nclass Outer {\n}\n",
            {
              sourceFileName: "Outer.java",
            },
          ),
          detail,
        ).toBe(3);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 40_000);

  it("reveals the throwing line from an actual named-module exception", () => {
    const root = mkdtempSync(join(tmpdir(), "ide-modular-test-failure-"));
    try {
      mkdirSync(join(root, "pkg"));
      const source = [
        "package pkg;",
        "public class RunnerTest {",
        "  public static void main(String[] args) {",
        "    try { fails(); } catch (AssertionError failure) { failure.printStackTrace(System.out); }",
        "  }",
        '  static void fails() { throw new AssertionError("expected fixture failure"); }',
        "}",
      ].join("\n");
      writeFileSync(join(root, "module-info.java"), "module test.navigation {}\n");
      writeFileSync(join(root, "pkg", "RunnerTest.java"), source);
      execFileSync(
        executable("javac"),
        [
          "-g",
          "-d",
          join(root, "classes"),
          join(root, "module-info.java"),
          join(root, "pkg", "RunnerTest.java"),
        ],
        {
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      const detail = execFileSync(
        executable("java"),
        ["--module-path", join(root, "classes"), "--module", "test.navigation/pkg.RunnerTest"],
        {
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      expect(detail).toContain("at test.navigation/pkg.RunnerTest.fails(RunnerTest.java:6)");
      expect(resolveJavaTestFailureLine(detail, "pkg.RunnerTest", source)).toBe(6);
      expect(
        resolveJavaTestFailureLine(detail, "pkg.RunnerTest", source, { sourceIsDirty: true }),
      ).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 70_000);
});
