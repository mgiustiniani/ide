import { describe, expect, it } from "vitest";
import type { JavaEffectiveProjectContext } from "@ide/contracts";
import { javaClassFileSuggestions } from "./javaClassFileSuggestions";

function context(): JavaEffectiveProjectContext {
  return {
    schemaVersion: "java-project-context-v1",
    status: "available",
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    sdk: [],
    providers: [],
    modules: [
      {
        providerId: "maven-effective-v1",
        id: "app",
        name: "app",
        root: "app",
        sourceSets: [
          {
            id: "main",
            kind: "main",
            sourceLevel: 21,
            release: null,
            sourceRoots: ["app/src/main/java"],
            generatedSourceRoots: [],
            outputDirectories: ["app/target/classes"],
            analysisSourceRoots: [],
            compileClasspath: [],
            runtimeClasspath: [
              {
                path: "lib/target/classes",
                providerId: "maven-effective-v1",
                moduleId: "lib",
                sourceSetId: "main",
                dependencyScope: "compile",
                fingerprint: null,
              },
              {
                path: "lib/target/classes",
                providerId: "maven-effective-v1",
                moduleId: "lib",
                sourceSetId: "main",
                dependencyScope: "compile",
                fingerprint: null,
              },
            ],
            moduleDependencies: [{ moduleId: "lib", scope: "compile" }],
          },
          {
            id: "test",
            kind: "test",
            sourceLevel: 21,
            release: null,
            sourceRoots: ["app/src/test/java"],
            generatedSourceRoots: [],
            outputDirectories: ["app/target/test-classes"],
            analysisSourceRoots: [],
            compileClasspath: [],
            runtimeClasspath: [],
            moduleDependencies: [],
          },
        ],
      },
      {
        providerId: "maven-effective-v1",
        id: "lib",
        name: "lib",
        root: "lib",
        sourceSets: [
          {
            id: "main",
            kind: "main",
            sourceLevel: 21,
            release: null,
            sourceRoots: ["lib/src/main/java"],
            generatedSourceRoots: [],
            outputDirectories: ["lib/target/classes"],
            analysisSourceRoots: [],
            compileClasspath: [],
            runtimeClasspath: [],
            moduleDependencies: [],
          },
        ],
      },
    ],
    buildEvidence: [],
    selectedSource: null,
    analysis: null,
    refusal: null,
  };
}

describe("Java class file suggestions", () => {
  it("uses selected and provider-declared runtime project outputs for a binary class name", () => {
    expect(
      javaClassFileSuggestions(
        context(),
        { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        "p.Outer$Inner",
      ),
    ).toEqual({
      paths: ["app/target/classes/p/Outer$Inner.class", "lib/target/classes/p/Outer$Inner.class"],
      truncated: false,
    });
    expect(
      javaClassFileSuggestions(
        context(),
        { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        "p.Type",
        "maven",
      ).paths,
    ).toEqual(["maven/app/target/classes/p/Type.class", "maven/lib/target/classes/p/Type.class"]);
    const workspaceRelativeContext = context();
    workspaceRelativeContext.modules[0]!.sourceSets[0]!.outputDirectories = [
      "maven/app/target/classes",
    ];
    expect(
      javaClassFileSuggestions(
        workspaceRelativeContext,
        { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        "p.Type",
        "maven",
      ).paths,
    ).toEqual(["maven/app/target/classes/p/Type.class", "maven/lib/target/classes/p/Type.class"]);
  });

  it("rejects partial contexts, ambiguous selections and unsafe names or output paths", () => {
    const project = context();
    project.status = "partial";
    expect(
      javaClassFileSuggestions(
        project,
        { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        "p.Type",
      ),
    ).toEqual({ paths: [], truncated: false });

    project.status = "available";
    project.modules[0].sourceSets[0].outputDirectories.push(
      "../outside/classes",
      "/external/classes",
    );
    expect(
      javaClassFileSuggestions(project, { moduleId: "missing", sourceSetId: "main" }, "p.Type"),
    ).toEqual({ paths: [], truncated: false });
    expect(
      javaClassFileSuggestions(
        project,
        { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        "../Type",
      ),
    ).toEqual({ paths: [], truncated: false });
    expect(
      javaClassFileSuggestions(
        project,
        { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        "p.Type",
      ),
    ).toEqual({
      paths: ["app/target/classes/p/Type.class", "lib/target/classes/p/Type.class"],
      truncated: false,
    });
  });

  it("uses provider-qualified module and dependency identities when module IDs collide", () => {
    const project = context();
    const gradleApp = structuredClone(project.modules[0]!);
    gradleApp.providerId = "gradle-effective-v1";
    gradleApp.root = "other-app";
    gradleApp.sourceSets[0]!.outputDirectories = ["other-app/classes"];
    gradleApp.sourceSets[0]!.runtimeClasspath = [
      {
        path: "other-lib/classes",
        providerId: "gradle-effective-v1",
        moduleId: "lib",
        sourceSetId: "main",
        dependencyScope: "compile",
        fingerprint: null,
      },
    ];
    const gradleLib = structuredClone(project.modules[1]!);
    gradleLib.providerId = "gradle-effective-v1";
    gradleLib.root = "other-lib";
    gradleLib.sourceSets[0]!.outputDirectories = ["other-lib/classes"];
    project.modules.push(gradleApp, gradleLib);

    expect(
      javaClassFileSuggestions(
        project,
        { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        "p.Type",
      ).paths,
    ).toEqual(["app/target/classes/p/Type.class", "lib/target/classes/p/Type.class"]);
    expect(
      javaClassFileSuggestions(
        project,
        { providerId: "gradle-effective-v1", moduleId: "app", sourceSetId: "main" },
        "p.Type",
      ).paths,
    ).toEqual(["other-app/classes/p/Type.class", "other-lib/classes/p/Type.class"]);
    expect(
      javaClassFileSuggestions(project, { moduleId: "app", sourceSetId: "main" }, "p.Type"),
    ).toEqual({ paths: [], truncated: false });
  });

  it("bounds provider output suggestions", () => {
    const project = context();
    project.modules[0].sourceSets[0].outputDirectories = Array.from(
      { length: 70 },
      (_, index) => `app/build-${index}/classes`,
    );
    project.modules[0].sourceSets[0].runtimeClasspath = [];
    const result = javaClassFileSuggestions(
      project,
      { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
      "p.Type",
    );
    expect(result.paths).toHaveLength(64);
    expect(result.truncated).toBe(true);
  });
});
