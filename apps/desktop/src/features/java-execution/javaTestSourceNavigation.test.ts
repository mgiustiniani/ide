import { describe, expect, it } from "vitest";
import type { JavaWorkspaceSymbol } from "@ide/contracts";
import { reports } from "../../../../../packages/tauri-adapters/src/java-test-results.test-fixtures";
import { resolveJavaTestClassSymbol, resolveJavaTestFailureLine, resolveJavaTestReportScope } from "./javaTestSourceNavigation";

function symbol(path: string, overrides: Partial<JavaWorkspaceSymbol> = {}): JavaWorkspaceSymbol {
  return {
    name: "RunnerTest",
    kind: "class",
    path,
    range: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 17 },
    },
    containerName: "pkg",
    ...overrides,
  };
}

describe("Java test source resolution", () => {
  it("scopes identically named Maven cases to each report's module, including a nested module", () => {
    const results = reports();
    const parent = results.suites[0]!;
    parent.reportPath = "service/app/target/surefire-reports/TEST-pkg.RunnerTest.xml";
    const one = { ...parent.cases[0]!, className: "pkg.RunnerTest" };
    const two = { ...one, id: "other-case" };
    parent.cases = [one];
    results.suites.push({
      ...parent,
      reportPath: "service/app/components/library/target/failsafe-reports/TEST-pkg.RunnerTest.xml",
      cases: [two],
    });
    const sources = [
      symbol("service/app/src/test/java/pkg/RunnerTest.java"),
      symbol("service/app/components/library/src/test/java/pkg/RunnerTest.java"),
    ];
    for (const [index, test] of [one, two].entries()) {
      const scope = resolveJavaTestReportScope(test, results);
      expect(resolveJavaTestClassSymbol(sources, test.className, scope.modulePath, scope))
        .toEqual({ kind: "resolved", symbol: sources[index] });
    }
    expect(resolveJavaTestReportScope({ ...one }, results).modulePath).toBe("service");
    expect(resolveJavaTestReportScope(one, { ...results, buildTool: "gradle" }).modulePath).toBe("service");
  });

  it("uses the verified module from a custom Maven report inside the selected project", () => {
    const results = reports();
    const suite = results.suites[0]!;
    suite.reportPath = "service/app/test-evidence/TEST-pkg.RunnerTest.xml";
    suite.mavenReportModulePath = "service/app";
    const test = suite.cases[0]!;
    expect(resolveJavaTestReportScope(test, results).modulePath).toBe("service/app");
    suite.mavenReportModulePath = "service/core";
    expect(resolveJavaTestReportScope(test, results).modulePath).toBe("service");
  });

  it("retains the ordinary project scope for custom and uncontained Maven reports", () => {
    const results = reports();
    const suite = results.suites[0]!;
    const test = suite.cases[0]!;
    for (const path of [
      "service/app/reports/TEST-Sample.xml",
      "outside/target/surefire-reports/TEST-Sample.xml",
      "service/app/../target/failsafe-reports/TEST-Sample.xml",
      "/service/target/surefire-reports/TEST-Sample.xml",
    ]) {
      suite.reportPath = path;
      expect(resolveJavaTestReportScope(test, results)).toEqual({ modulePath: "service", nestedModulePaths: [] });
    }
  });

  it("accepts an interface only for a compiled declaring type and preserves type ambiguity", () => {
    const contract = symbol("library/src/main/java/pkg/Contract.java", { name: "Contract", kind: "interface" });
    expect(resolveJavaTestClassSymbol([contract], "pkg.Contract", "library").kind).toBe("unavailable");
    expect(resolveJavaTestClassSymbol([contract], "pkg.Contract", "library", { allowInterface: true }))
      .toMatchObject({ kind: "resolved", symbol: contract });
    const duplicate = { ...contract, kind: "class" as const, path: "library/generated/pkg/Contract.java" };
    expect(resolveJavaTestClassSymbol([contract, duplicate], "pkg.Contract", "library", { allowInterface: true })).toMatchObject({ kind: "unavailable", reason: expect.stringContaining("More than one") });
    expect(resolveJavaTestClassSymbol([contract], "pkg.Contract", "app", { allowInterface: true }).kind).toBe("unavailable");
    expect(resolveJavaTestClassSymbol([{ ...contract, containerName: "other" }], "pkg.Contract", "library", { allowInterface: true }).kind).toBe("unavailable");
    expect(resolveJavaTestClassSymbol([{ ...contract, kind: "function" }], "pkg.Contract", "library", { allowInterface: true }).kind).toBe("unavailable");
  });

  it("resolves a workspace-root module and refuses non-canonical source paths", () => {
    expect(resolveJavaTestClassSymbol([symbol("src/test/java/pkg/RunnerTest.java")], "pkg.RunnerTest", ".").kind).toBe("resolved");
    expect(resolveJavaTestClassSymbol([symbol("src/./test/java/pkg/RunnerTest.java")], "pkg.RunnerTest", ".").kind).toBe("unavailable");
  });

  it("opens the unique class declaration inside the reported test module", () => {
    const result = resolveJavaTestClassSymbol(
      [
        symbol("maven/app/src/test/java/pkg/RunnerTest.java"),
        symbol("maven/library/src/test/java/pkg/RunnerTest.java"),
      ],
      "pkg.RunnerTest",
      "maven/app",
    );
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved")
      expect(result.symbol.path).toBe("maven/app/src/test/java/pkg/RunnerTest.java");
  });

  it("resolves Unicode Java package and type identifiers in test reports and stack frames", () => {
    const result = resolveJavaTestClassSymbol(
      [
        symbol("app/src/test/java/café/ΔRunner.java", {
          name: "ΔRunner",
          containerName: "café",
        }),
      ],
      "café.ΔRunner",
      "app",
    );
    expect(result).toMatchObject({
      kind: "resolved",
      symbol: { path: "app/src/test/java/café/ΔRunner.java" },
    });

    expect(
      resolveJavaTestFailureLine(
        "at café.ΔRunner.testCase(ΔRunner.java:2)",
        "café.ΔRunner",
        "package café;\nclass ΔRunner {}\n",
      ),
    ).toBe(2);
  });

  it("resolves nested test declarations and refuses ambiguous or unrelated candidates", () => {
    const ambiguous = resolveJavaTestClassSymbol(
      [
        symbol("app/src/test/java/pkg/RunnerTest.java"),
        symbol("app/generated/test/pkg/RunnerTest.java"),
      ],
      "pkg.RunnerTest",
      "app",
    );
    expect(ambiguous.kind).toBe("unavailable");

    expect(
      resolveJavaTestClassSymbol(
        [symbol("../outside/pkg/RunnerTest.java")],
        "pkg.RunnerTest",
        "app",
      ).kind,
    ).toBe("unavailable");
    expect(
      resolveJavaTestClassSymbol(
        [symbol("app/src/test/java/pkg/Outer.java", { name: "Outer" })],
        "pkg.Outer$Nested",
        "app",
      ),
    ).toMatchObject({ kind: "resolved", symbol: { path: "app/src/test/java/pkg/Outer.java" } });

    const nested = resolveJavaTestClassSymbol(
      [
        symbol("app/src/test/java/pkg/Outer.java", {
          name: "Outer",
          range: { start: { line: 2, character: 0 }, end: { line: 10, character: 1 } },
        }),
        symbol("app/src/test/java/pkg/Outer.java", {
          name: "Nested",
          containerName: "pkg.Outer",
          range: { start: { line: 5, character: 2 }, end: { line: 8, character: 3 } },
        }),
      ],
      "pkg.Outer$Nested",
      "app",
    );
    expect(nested).toMatchObject({
      kind: "resolved",
      symbol: {
        name: "Nested",
        path: "app/src/test/java/pkg/Outer.java",
        range: { start: { line: 5 } },
      },
    });

    expect(
      resolveJavaTestClassSymbol(
        [symbol("app/src/test/java/pkg/Outer$Nested.java", { name: "Outer$Nested" })],
        "pkg.Outer$Nested",
        "app",
      ),
    ).toMatchObject({
      kind: "resolved",
      symbol: { path: "app/src/test/java/pkg/Outer$Nested.java" },
    });
  });

  it("resolves only a bounded stack frame for the exact test class and source file", () => {
    const source = "package pkg;\nclass RunnerTest {\n  void fails() {}\n}\n";
    expect(
      resolveJavaTestFailureLine(
        "java.lang.AssertionError\n\tat pkg.RunnerTest.testCase(RunnerTest.java:3)",
        "pkg.RunnerTest",
        source,
      ),
    ).toBe(3);
    expect(
      resolveJavaTestFailureLine(
        "at pkg.OtherTest.testCase(OtherTest.java:3)\nat pkg.RunnerTest.testCase(OtherTest.java:2)",
        "pkg.RunnerTest",
        source,
      ),
    ).toBeNull();
    expect(
      resolveJavaTestFailureLine(
        "at pkg.RunnerTest.testCase(RunnerTest.java:99)",
        "pkg.RunnerTest",
        source,
      ),
    ).toBeNull();
    expect(
      resolveJavaTestFailureLine(
        "at pkg.RunnerTest.testCase(RunnerTest.java:3)",
        "pkg.RunnerTest",
        source,
        { detailTruncated: true },
      ),
    ).toBeNull();
    expect(
      resolveJavaTestFailureLine(
        "at pkg.RunnerTest.testCase(RunnerTest.java:3)",
        "pkg.RunnerTest",
        source,
        { sourceIsDirty: true },
      ),
    ).toBeNull();
  });

  it("maps nested-class frames to their exact source file and rejects malformed frame paths", () => {
    const source = "package pkg;\nclass RunnerTest {\n  void fails() {}\n}\n";
    for (const detail of [
      "at pkg.RunnerTest.testCase(Other.java:3)",
      "at pkg.RunnerTest.testCase(RunnerTest.java:0)",
      "at pkg.RunnerTest.testCase(RunnerTest.java:3) /tmp/RunnerTest.java",
      "/workspace/app/src/test/java/pkg/RunnerTest.java:3",
    ]) {
      expect(resolveJavaTestFailureLine(detail, "pkg.RunnerTest", source)).toBeNull();
    }
    const nestedSource =
      "package pkg;\nclass Outer {\n  static class Nested { void fails() {} }\n}\n";
    expect(
      resolveJavaTestFailureLine(
        "at pkg.Outer$Nested.testCase(Outer.java:3)",
        "pkg.Outer$Nested",
        nestedSource,
        { sourceFileName: "Outer.java" },
      ),
    ).toBe(3);
    expect(
      resolveJavaTestFailureLine(
        "at pkg.Outer$Nested.testCase(Nested.java:3)",
        "pkg.Outer$Nested",
        nestedSource,
        { sourceFileName: "Outer.java" },
      ),
    ).toBeNull();
  });

  it.each([
    "test.module/",
    "test.module@1.0/",
    "test-loader/test.module/",
    "test-loader/test.module@1.0-rc+2/",
    "test-loader//",
  ])("resolves the exact test frame with the Java runtime prefix %s", (prefix) => {
    const source = "package pkg;\nclass Outer {\n  class Nested {}\n}\n";
    const detail = `java.lang.AssertionError\n\tat java.base/java.lang.Thread.run(Thread.java:1)\n\tat ${prefix}pkg.Outer$Nested.testCase(Outer.java:3)`;
    expect(
      resolveJavaTestFailureLine(detail, "pkg.Outer$Nested", source, {
        sourceFileName: "Outer.java",
      }),
    ).toBe(3);
    for (const options of [{ sourceIsDirty: true }, { detailTruncated: true }]) {
      expect(
        resolveJavaTestFailureLine(detail, "pkg.Outer$Nested", source, {
          sourceFileName: "Outer.java",
          ...options,
        }),
      ).toBeNull();
    }
  });

  it.each([
    "/pkg.RunnerTest.testCase(RunnerTest.java:3)",
    "loader///pkg.RunnerTest.testCase(RunnerTest.java:3)",
    "loader/module/extra/pkg.RunnerTest.testCase(RunnerTest.java:3)",
    "loader\\module/pkg.RunnerTest.testCase(RunnerTest.java:3)",
    "loader\u0000/module/pkg.RunnerTest.testCase(RunnerTest.java:3)",
    "test.module/pkg.OtherTest.testCase(RunnerTest.java:3)",
    "test.module/pkg.RunnerTest.OtherTest.testCase(RunnerTest.java:3)",
    "pkg.RunnerTest.OtherTest.testCase(RunnerTest.java:3)",
    "test.module/pkg.RunnerTest.testCase(OtherTest.java:3)",
    "test.module/pkg.RunnerTest.testCase(RunnerTest.java:99)",
    "test.module/pkg.RunnerTest.testCase(Unknown Source)",
    "test.module/pkg.RunnerTest.testCase(Native Method)",
  ])("refuses malformed or unrelated modular frames: %s", (entry) => {
    expect(
      resolveJavaTestFailureLine(
        `at ${entry}`,
        "pkg.RunnerTest",
        "package pkg;\nclass RunnerTest {\n}\n",
      ),
    ).toBeNull();
  });
});

describe("provider-owned type identities without filename assumptions", () => {
  it("resolves an additional non-public top-level type and its nested declaration", () => {
    const path = "app/src/test/java/pkg/RunnerTest.java";
    const base = symbol(path, { name: "BaseTests", containerName: "pkg" });
    expect(resolveJavaTestClassSymbol([base], "pkg.BaseTests", "app")).toMatchObject({ kind: "resolved", symbol: base });
    const nested = symbol(path, { name: "Nested", containerName: "pkg.BaseTests" });
    expect(resolveJavaTestClassSymbol([base, nested], "pkg.BaseTests$Nested", "app")).toMatchObject({ kind: "resolved", symbol: nested });
    expect(resolveJavaTestClassSymbol([base], "pkg.BaseTests$Nested", "app")).toMatchObject({ kind: "resolved", symbol: base });
  });
  it("does not let source paths override a contradictory provider package", () => {
    for (const containerName of ["other.pkg", "other", "pkg.Other"]) {
      expect(resolveJavaTestClassSymbol([symbol("app/src/test/java/pkg/RunnerTest.java", { containerName })], "pkg.RunnerTest", "app").kind).toBe("unavailable");
    }
    expect(resolveJavaTestClassSymbol([symbol("app/src/test/java/pkg/RunnerTest.java")], "RunnerTest", "app").kind).toBe("unavailable");
  });
  it("preserves module confinement and refuses duplicate type identities", () => {
    const own = symbol("app/src/test/java/pkg/RunnerTest.java", { name: "BaseTests" });
    const other = symbol("library/src/main/java/pkg/Support.java", { name: "BaseTests" });
    expect(resolveJavaTestClassSymbol([other], "pkg.BaseTests", "app").kind).toBe("unavailable");
    expect(resolveJavaTestClassSymbol([own, other], "pkg.BaseTests", "app")).toMatchObject({ kind: "resolved", symbol: own });
    expect(resolveJavaTestClassSymbol([own, { ...own, path: "app/generated/pkg/Support.java" }], "pkg.BaseTests", "app").kind).toBe("unavailable");
    expect(resolveJavaTestClassSymbol([{ ...own, path: "app/target/classes/pkg/BaseTests.class" }], "pkg.BaseTests", "app").kind).toBe("unavailable");
  });
  it("keeps dollar signs in provider package identities and literal Java type names", () => {
    for (const name of ["$Test", "Outer$$Test", "Test$"]) {
      const type = symbol("app/src/test/java/pkg$/Support.java", { name, containerName: "pkg$" });
      expect(resolveJavaTestClassSymbol([type], `pkg$.${name}`, "app")).toMatchObject({ kind: "resolved", symbol: type });
      expect(resolveJavaTestFailureLine(`at pkg$.${name}.check(Support.java:2)`, `pkg$.${name}`, "package pkg$;\nclass Support {}", { sourceFileName: "Support.java" })).toBe(2);
    }
  });
});
