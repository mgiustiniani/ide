import { describe, expect, it } from "vitest";
import type { JavaProjectContextRequest } from "@ide/contracts";
import { coverage } from "../../../../../packages/tauri-adapters/src/java-coverage.test-fixtures";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import { javaCoverageSourcePaths } from "./javaCoverageSourcePaths";

const request: JavaProjectContextRequest = {
  workspaceId: "workspace",
  generation: 1,
  requestId: "context",
  projectPath: "maven",
  sdkHome: "/jdk",
  mavenRepository: "",
  activeMavenProfiles: [],
  inactiveMavenProfiles: [],
};

describe("Java coverage source mapping", () => {
  it.each(["java-project-context-v2", "java-project-context-v7"] as const)(
    "resolves a project at the workspace root for %s",
    (schemaVersion) => {
      const rootSettings = { ...request, projectPath: "" };
      const { context } = javaProjectContextResponse(rootSettings);
      context.schemaVersion = schemaVersion;
      const module = context.modules[0]!;
      module.root = "";
      module.sourceSets[0]!.sourceRoots = ["src/main/java"];

      const path = "src/main/java/pkg/Runner.java";
      const results = coverage();
      results.projectPath = "";
      results.files = [{
        ...results.files[0]!,
        id: "runner",
        moduleRoot: schemaVersion === "java-project-context-v7" ? "" : null,
        packageName: "pkg",
        name: "Runner.java",
      }];

      expect(javaCoverageSourcePaths(results, rootSettings, context, [path]))
        .toEqual(new Map([["runner", path]]));
      expect(javaCoverageSourcePaths(results, rootSettings, context, []))
        .toEqual(new Map());
    },
  );

  it("resolves source files through one provider-declared main root and an open buffer", () => {
    const results = coverage();
    results.projectPath = "maven/app";
    results.files[0] = {
      ...results.files[0]!,
      id: "target/site/jacoco/jacoco.xml:pkg/Runner.java",
      reportPath: "maven/app/target/site/jacoco/jacoco.xml",
      packageName: "pkg",
      name: "Runner.java",
    };
    const project = javaProjectContextResponse(request);

    expect(
      javaCoverageSourcePaths(results, request, project.context, [
        "maven/app/src/main/java/pkg/Runner.java",
      ]),
    ).toEqual(
      new Map([
        [
          "target/site/jacoco/jacoco.xml:pkg/Runner.java",
          "maven/app/src/main/java/pkg/Runner.java",
        ],
      ]),
    );

    results.files[0] = {
      ...results.files[0]!,
      id: "target/site/jacoco/jacoco.xml:generated/GeneratedGreeting.java",
      packageName: "generated",
      name: "GeneratedGreeting.java",
    };
    expect(
      javaCoverageSourcePaths(results, request, project.context, [
        "maven/app/target/generated-sources/annotations/generated/GeneratedGreeting.java",
      ]),
    ).toEqual(new Map());
  });

  it.each([
    ["java-project-context-v2", "maven", "maven"],
    ["java-project-context-v7", "maven", "maven"],
    ["java-project-context-v7", "maven", ""],
    ["java-project-context-v2", "", ""],
    ["java-project-context-v7", "", ""],
  ] as const)(
    "uses each Maven report's module for %s in reactor %j with project setting %j",
    (schemaVersion, projectPath, configuredPath) => {
      const prefix = projectPath ? `${projectPath}/` : "";
      const results = coverage();
      results.projectPath = projectPath;
      results.files = [
        ["app", "app/target/site/jacoco/jacoco.xml"],
        ["library", "components/library/target/site/jacoco-it/jacoco.xml"],
        ["unknown", "unknown/target/site/jacoco/jacoco.xml"],
        ["nonstandard", "app/other/jacoco.xml"],
      ].map(([id, reportPath]) => ({
        ...results.files[0]!,
        id,
        reportPath: prefix + reportPath,
        packageName: "pkg",
        name: "Runner.java",
      }));
      const { context } = javaProjectContextResponse(request);
      context.schemaVersion = schemaVersion;
      const app = context.modules[0]!;
      const main = app.sourceSets[0]!;
      context.modules = ["app", "components/library"].map((root) => {
        const moduleRoot = schemaVersion === "java-project-context-v2" ? root : prefix + root;
        return {
          ...app,
          id: root,
          root: moduleRoot,
          sourceSets: [{ ...main, sourceRoots: [`${moduleRoot}/src/main/java`] }],
        };
      });
      const settings = { ...request, projectPath: configuredPath };
      const appPath = `${prefix}app/src/main/java/pkg/Runner.java`;
      const libraryPath = `${prefix}components/library/src/main/java/pkg/Runner.java`;

      expect(javaCoverageSourcePaths(results, settings, context, [appPath, libraryPath]))
        .toEqual(new Map([["app", appPath], ["library", libraryPath]]));
      expect(javaCoverageSourcePaths(results, settings, context, [libraryPath]))
        .toEqual(new Map([["library", libraryPath]]));
      context.modules.splice(1);
      expect(javaCoverageSourcePaths(results, settings, context, [appPath, libraryPath]))
        .toEqual(new Map([["app", appPath]]));
    },
  );

  it("resolves a dependency module's measured source inside the complete synchronized project", () => {
    const results = coverage();
    results.projectPath = "maven/app";
    results.files = [
      {
        ...results.files[0]!,
        id: "coverage-report/0/jacoco.xml:pkg/Runner.java",
        reportPath: "coverage-report/0/jacoco.xml",
        moduleRoot: "app",
        packageName: "pkg",
        name: "Runner.java",
      },
      {
        ...results.files[0]!,
        id: "coverage-report/1/jacoco.xml:pkg/Greeter.java",
        reportPath: "coverage-report/1/jacoco.xml",
        moduleRoot: "library",
        packageName: "pkg",
        name: "Greeter.java",
      },
    ];
    const project = javaProjectContextResponse(request);
    const app = project.context.modules[0]!;
    const appMain = app.sourceSets.find((sourceSet) => sourceSet.kind === "main")!;
    project.context.modules.push({
      ...app,
      id: "library",
      name: "library",
      root: "library",
      sourceSets: [
        {
          ...appMain,
          sourceRoots: [
            "library/src/main/java",
            "library/build/generated/sources/annotationProcessor/java/main",
          ],
          generatedSourceRoots: ["library/build/generated/sources/annotationProcessor/java/main"],
          outputDirectories: ["library/target/classes"],
        },
      ],
    });
    expect(
      javaCoverageSourcePaths(results, request, project.context, [
        "maven/app/src/main/java/pkg/Runner.java",
        "maven/library/src/main/java/pkg/Greeter.java",
      ]),
    ).toEqual(
      new Map([
        ["coverage-report/0/jacoco.xml:pkg/Runner.java", "maven/app/src/main/java/pkg/Runner.java"],
        [
          "coverage-report/1/jacoco.xml:pkg/Greeter.java",
          "maven/library/src/main/java/pkg/Greeter.java",
        ],
      ]),
    );

    // Gradle can discover its build below the workspace root while project-context
    // settings keep the project directory empty (the workspace root). Infer only
    // the path prefix proven by the selected module's provider-declared root.
    results.projectPath = "gradle/app";
    const gradleSources = [
      "gradle/app/src/main/java/pkg/Runner.java",
      "gradle/library/src/main/java/pkg/Greeter.java",
    ];
    expect(
      javaCoverageSourcePaths(
        results,
        { ...request, projectPath: "gradle" },
        project.context,
        gradleSources,
      ),
    ).toEqual(
      new Map([
        [
          "coverage-report/0/jacoco.xml:pkg/Runner.java",
          "gradle/app/src/main/java/pkg/Runner.java",
        ],
        [
          "coverage-report/1/jacoco.xml:pkg/Greeter.java",
          "gradle/library/src/main/java/pkg/Greeter.java",
        ],
      ]),
    );
    expect(
      javaCoverageSourcePaths(
        results,
        { ...request, projectPath: "" },
        project.context,
        gradleSources,
      ),
    ).toEqual(
      new Map([
        [
          "coverage-report/0/jacoco.xml:pkg/Runner.java",
          "gradle/app/src/main/java/pkg/Runner.java",
        ],
        [
          "coverage-report/1/jacoco.xml:pkg/Greeter.java",
          "gradle/library/src/main/java/pkg/Greeter.java",
        ],
      ]),
    );
  });

  it("maps workspace-relative JaCoCo roots through provider-qualified included-build modules", () => {
    const compositeSettings = { ...request, projectPath: "gradle" };
    const results = coverage();
    results.projectPath = "gradle/app";
    results.files = [
      {
        ...results.files[0]!,
        id: "coverage-report/app/jacoco.xml:pkg/Runner.java",
        reportPath: "coverage-report/app/jacoco.xml",
        moduleRoot: "gradle/app",
        packageName: "pkg",
        name: "Runner.java",
      },
      {
        ...results.files[0]!,
        id: "coverage-report/library/jacoco.xml:pkg/Greeter.java",
        reportPath: "coverage-report/library/jacoco.xml",
        moduleRoot: "gradle/library",
        packageName: "pkg",
        name: "Greeter.java",
      },
    ];
    const project = javaProjectContextResponse(compositeSettings);
    project.context.schemaVersion = "java-project-context-v3";
    const app = project.context.modules[0]!;
    app.providerId = "gradle-effective-v1";
    app.root = "gradle/app";
    app.buildRoot = "gradle/included-build";
    app.projectPath = ":app";
    const appMain = app.sourceSets.find((sourceSet) => sourceSet.kind === "main")!;
    appMain.sourceRoots = ["gradle/app/src/main/java"];
    const library = {
      ...app,
      id: "library",
      name: "library",
      root: "gradle/library",
      projectPath: ":library",
      sourceSets: [
        {
          ...appMain,
          sourceRoots: ["gradle/library/src/main/java"],
          generatedSourceRoots: [],
          outputDirectories: ["gradle/library/build/classes/java/main"],
        },
      ],
    };
    project.context.modules.push(library);

    expect(
      javaCoverageSourcePaths(results, compositeSettings, project.context, [
        "gradle/app/src/main/java/pkg/Runner.java",
        "gradle/library/src/main/java/pkg/Greeter.java",
      ]),
    ).toEqual(
      new Map([
        [
          "coverage-report/app/jacoco.xml:pkg/Runner.java",
          "gradle/app/src/main/java/pkg/Runner.java",
        ],
        [
          "coverage-report/library/jacoco.xml:pkg/Greeter.java",
          "gradle/library/src/main/java/pkg/Greeter.java",
        ],
      ]),
    );

    for (const schemaVersion of ["java-project-context-v6", "java-project-context-v7"] as const) {
      project.context.schemaVersion = schemaVersion;
      project.context.analysis = null;
      project.context.semanticAnalysis = {
        availability: "unqualified",
        refusalCode: "java.context.sourceAnalysisUnqualified",
      };
      expect(
        javaCoverageSourcePaths(results, compositeSettings, project.context, [
          "gradle/app/src/main/java/pkg/Runner.java",
          "gradle/library/src/main/java/pkg/Greeter.java",
        ]),
      ).toEqual(
        new Map([
          [
            "coverage-report/app/jacoco.xml:pkg/Runner.java",
            "gradle/app/src/main/java/pkg/Runner.java",
          ],
          [
            "coverage-report/library/jacoco.xml:pkg/Greeter.java",
            "gradle/library/src/main/java/pkg/Greeter.java",
          ],
        ]),
      );
    }
  });

  it.each([
    "java-project-context-v3",
    "java-project-context-v4",
    "java-project-context-v5",
    "java-project-context-v6",
    "java-project-context-v7",
  ] as const)(
    "uses workspace-relative Maven source roots for %s without Gradle identity fields",
    (schemaVersion) => {
      const results = coverage();
      results.projectPath = "maven/app";
      results.files = [
        {
          ...results.files[0]!,
          id: "runner",
          moduleRoot: "maven/app",
          packageName: "pkg",
          name: "Runner.java",
        },
      ];
      const project = javaProjectContextResponse(request);
      project.context.schemaVersion = schemaVersion;
      const module = project.context.modules[0]!;
      module.root = "maven/app";
      module.sourceSets = [
        {
          ...module.sourceSets[0]!,
          sourceRoots: ["maven/app/src/main/java"],
          generatedSourceRoots: [],
        },
      ];
      expect(
        javaCoverageSourcePaths(results, request, project.context, [
          "maven/app/src/main/java/pkg/Runner.java",
        ]),
      ).toEqual(new Map([["runner", "maven/app/src/main/java/pkg/Runner.java"]]));
      module.sourceSets[0]!.sourceRoots.push("maven/app/alternate/java");
      expect(
        javaCoverageSourcePaths(results, request, project.context, [
          "maven/app/src/main/java/pkg/Runner.java",
        ]),
      ).toEqual(new Map());
    },
  );
  it("does not infer source ownership for a covered included build missing from project context", () => {
    const results = coverage();
    results.projectPath = "maven/app";
    results.files = [
      {
        ...results.files[0]!,
        id: "coverage-report/included/jacoco.xml:pkg/Greeter.java",
        reportPath: "coverage-report/included/jacoco.xml",
        moduleRoot: "included-library",
        packageName: "pkg",
        name: "Greeter.java",
      },
    ];
    const project = javaProjectContextResponse(request);

    expect(
      javaCoverageSourcePaths(results, request, project.context, [
        "maven/included-library/src/main/java/pkg/Greeter.java",
      ]),
    ).toEqual(new Map());
  });

  it("refuses partial, mismatched, unsafe and ambiguous source ownership", () => {
    const results = coverage();
    results.projectPath = "maven/app";
    results.files[0] = {
      ...results.files[0]!,
      id: "target/site/jacoco/jacoco.xml:pkg/Runner.java",
      packageName: "pkg",
      name: "Runner.java",
    };
    const project = javaProjectContextResponse(request);

    expect(
      javaCoverageSourcePaths(results, request, {
        ...project.context,
        status: "partial",
      }),
    ).toEqual(new Map());
    expect(
      javaCoverageSourcePaths({ ...results, projectPath: "other/app" }, request, project.context),
    ).toEqual(new Map());

    results.files[0] = { ...results.files[0]!, packageName: "../outside" };
    expect(
      javaCoverageSourcePaths(results, request, project.context, [
        "maven/app/src/main/java/pkg/Runner.java",
      ]),
    ).toEqual(new Map());

    results.files[0] = {
      ...results.files[0]!,
      packageName: "pkg",
      name: "Runner.java",
    };
    project.context.modules[0]!.sourceSets[0]!.sourceRoots.push("app/alternate/java");
    expect(
      javaCoverageSourcePaths(results, request, project.context, [
        "maven/app/src/main/java/pkg/Runner.java",
      ]),
    ).toEqual(new Map());
  });
});
