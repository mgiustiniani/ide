import { describe, expect, it } from "vitest";
import type { JavaEffectiveProjectContext, JavaProjectSourceSet } from "@ide/contracts";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import { javaTestSourceBelongsToOwner, resolveJavaTestDeclaringOwner, resolveJavaTestRuntimeOwner } from "./javaTestSourceOwnership";

function fixture() {
  const context = javaProjectContextResponse({ workspaceId: "one", generation: 1, requestId: "one", projectPath: "", sdkHome: "/jdk", mavenRepository: "", activeMavenProfiles: [], inactiveMavenProfiles: [] }).context;
  context.schemaVersion = "java-project-context-v7";
  context.providers[0]!.providerId = "gradle-effective-v1";
  const template = context.modules[0]!.sourceSets[0]!;
  const source = (module: string, id: string): JavaProjectSourceSet => ({
    ...structuredClone(template), id, kind: id === "main" ? "main" : "test",
    sourceRoots: [`${module}/src/${id}/java`], generatedSourceRoots: [`${module}/build/generated/${id}`],
    outputDirectories: [`${module}/build/classes/${id}`], analysisSourceRoots: ["other/src/main/java"], runtimeClasspath: [],
  });
  const entry = (path: string, moduleId: string, sourceSetId: string) => ({ path, providerId: "gradle-effective-v1", moduleId, sourceSetId, fingerprint: "present", dependencyScope: moduleId === ":base" ? "compile" : null });
  const main = source("app", "main"), test = source("app", "test"), base = source("base", "main");
  test.moduleDependencies = [{ moduleId: ":base", scope: "compile" }];
  test.runtimeClasspath = [entry("app/build/classes/test", ":app", "test"), entry("app/build/classes/main", ":app", "main"), entry("base/build/libs/base.jar", ":base", "main")];
  context.modules = [
    { providerId: "gradle-effective-v1", id: ":app", name: "app", root: "app", sourceSets: [main, test] },
    { providerId: "gradle-effective-v1", id: ":base", name: "base", root: "base", sourceSets: [base] },
  ];
  const runtime = () => resolveJavaTestRuntimeOwner(context, "app", { path: "app/build/classes/test", kind: "directory" });
  const executing = () => { const result = runtime(); if (result.kind !== "resolved") throw new Error(result.reason); return result.owner; };
  return { context, test, main, base, entry, runtime, executing };
}

describe("compiled Java test source ownership", () => {
  it("selects the executing source set and internal project JAR through provider-qualified runtime entries", () => {
    const f = fixture();
    const result = resolveJavaTestDeclaringOwner(f.context, f.executing(), { path: "base/build/libs/base.jar", kind: "archive" });
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") return;
    expect(result.owner.module.id).toBe(":base");
    expect(javaTestSourceBelongsToOwner("base/src/main/java/pkg/Base.java", result.owner)).toBe(true);
    expect(javaTestSourceBelongsToOwner("app/src/test/java/pkg/Base.java", result.owner)).toBe(false);
    expect(javaTestSourceBelongsToOwner("base/src/test/java/pkg/Base.java", result.owner)).toBe(false);
    expect(javaTestSourceBelongsToOwner("base/build/generated/main/pkg/Base.java", result.owner)).toBe(true);
  });

  it("distinguishes same-module main and test declarations and excludes dependency analysis roots", () => {
    const f = fixture(), owner = f.executing();
    f.test.analysisSourceRoots.push("app/src/main/java");
    expect(javaTestSourceBelongsToOwner("app/src/test/java/pkg/Same.java", owner)).toBe(true);
    expect(javaTestSourceBelongsToOwner("app/src/main/java/pkg/Same.java", owner)).toBe(false);
    expect(javaTestSourceBelongsToOwner("other/src/main/java/pkg/Same.java", owner)).toBe(false);
    const result = resolveJavaTestDeclaringOwner(f.context, owner, { path: "app/build/classes/main", kind: "directory" });
    expect(result.kind === "resolved" && result.owner.sourceSet.id).toBe("main");
  });

  it("accepts dependency output directories only when producer output and runtime ownership agree", () => {
    const f = fixture();
    f.test.runtimeClasspath.push(f.entry("base/build/classes/main", ":base", "main"));
    expect(resolveJavaTestDeclaringOwner(f.context, f.executing(), { path: "base/build/classes/main", kind: "directory" }).kind).toBe("resolved");
    f.test.runtimeClasspath.at(-1)!.moduleId = ":app";
    expect(resolveJavaTestDeclaringOwner(f.context, f.executing(), { path: "base/build/classes/main", kind: "directory" }).kind).toBe("unavailable");
  });

  it("refuses consumer-owned external archives and conflicting runtime owners", () => {
    const f = fixture();
    f.test.runtimeClasspath.push(f.entry("vendor/base.jar", ":app", "test"));
    expect(resolveJavaTestDeclaringOwner(f.context, f.executing(), { path: "vendor/base.jar", kind: "archive" }).kind).toBe("unavailable");
    f.test.runtimeClasspath.push(f.entry("base/build/libs/base.jar", ":app", "test"));
    expect(resolveJavaTestDeclaringOwner(f.context, f.executing(), { path: "base/build/libs/base.jar", kind: "archive" }).kind).toBe("unavailable");
  });

  it("refuses missing or unowned runtime artifacts and unavailable producing providers", () => {
    for (const change of [
      (f: ReturnType<typeof fixture>) => { f.test.runtimeClasspath.pop(); },
      (f: ReturnType<typeof fixture>) => { f.test.runtimeClasspath.at(-1)!.fingerprint = "missing"; },
      (f: ReturnType<typeof fixture>) => { f.test.runtimeClasspath.at(-1)!.fingerprint = null; },
      (f: ReturnType<typeof fixture>) => { f.test.runtimeClasspath.at(-1)!.sourceSetId = "unknown"; },
      (f: ReturnType<typeof fixture>) => { f.test.runtimeClasspath.at(-1)!.dependencyScope = null; },
      (f: ReturnType<typeof fixture>) => { f.test.moduleDependencies = []; },
      (f: ReturnType<typeof fixture>) => { f.test.moduleDependencies.push({ moduleId: ":another", scope: "runtime" }); },
      (f: ReturnType<typeof fixture>) => { f.context.modules[1]!.providerId = "unavailable"; },
    ]) {
      const f = fixture(); change(f);
      expect(resolveJavaTestDeclaringOwner(f.context, f.executing(), { path: "base/build/libs/base.jar", kind: "archive" }).kind).toBe("unavailable");
    }
  });

  it("refuses ambiguous outputs, modules, schemas and partial contexts", () => {
    for (const change of [
      (c: JavaEffectiveProjectContext) => { c.modules[0]!.sourceSets[0]!.outputDirectories.push("app/build/classes/test"); },
      (c: JavaEffectiveProjectContext) => { c.modules.push(structuredClone(c.modules[0]!)); },
      (c: JavaEffectiveProjectContext) => { c.schemaVersion = "java-project-context-v2"; },
      (c: JavaEffectiveProjectContext) => { c.status = "partial"; },
      (c: JavaEffectiveProjectContext) => { c.providers[0]!.status = "partial"; },
      (c: JavaEffectiveProjectContext) => { c.modules[0]!.root = "other"; },
    ]) {
      const f = fixture(); change(f.context); expect(f.runtime().kind).toBe("unavailable");
    }
  });

  it("rejects origins outside the selected test module and owners retained from another context", () => {
    const f = fixture();
    expect(resolveJavaTestRuntimeOwner(f.context, "base", { path: "app/build/classes/test", kind: "directory" }).kind).toBe("unavailable");
    expect(resolveJavaTestRuntimeOwner(f.context, "app", { path: "app/build/libs/app.jar", kind: "archive" }).kind).toBe("unavailable");
    expect(resolveJavaTestDeclaringOwner(structuredClone(f.context), f.executing(), { path: "base/build/libs/base.jar", kind: "archive" }).kind).toBe("unavailable");
    for (const value of ["/base/src/main/java/Base.java", "base/src/../Base.java", "base\\src\\Base.java", "base//Base.java"])
      expect(javaTestSourceBelongsToOwner(value, { module: f.context.modules[1]!, sourceSet: f.base })).toBe(false);
  });
});
