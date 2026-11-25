import type { JavaEffectiveProjectContext } from "@ide/contracts";
import { describe, expect, it } from "vitest";
import {
  javaMoveClassSourceSelection,
  javaMoveClassTargetModules,
} from "./javaMoveClassTargetModules";

function context(): JavaEffectiveProjectContext {
  return {
    schemaVersion: "java-project-context-v5",
    status: "available",
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    sdk: [],
    providers: [
      {
        providerId: "maven-effective-v1",
        status: "available",
        strategy: "effective-model",
        buildCodeExecution: "denied",
        credentialsAccess: "denied",
        networkAccess: "denied",
        diagnostics: [],
      },
    ],
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
            sourceLevel: 17,
            release: 17,
            sourceRoots: ["app/src/main/java"],
            generatedSourceRoots: ["app/target/generated-sources"],
            outputDirectories: [],
            analysisSourceRoots: [],
            compileClasspath: [],
            runtimeClasspath: [],
            moduleDependencies: [],
          },
        ],
      },
      {
        providerId: "maven-effective-v1",
        id: "library",
        name: "library",
        root: "library",
        sourceSets: [
          {
            id: "main",
            kind: "main",
            sourceLevel: 17,
            release: 17,
            sourceRoots: ["library/src/main/java"],
            generatedSourceRoots: ["library/target/generated-sources"],
            outputDirectories: [],
            analysisSourceRoots: [],
            compileClasspath: [],
            runtimeClasspath: [],
            moduleDependencies: [],
          },
        ],
      },
      {
        providerId: "gradle-effective-v1",
        id: "library",
        name: "other-provider-library",
        root: "other/library",
        sourceSets: [
          {
            id: "main",
            kind: "main",
            sourceLevel: 17,
            release: 17,
            sourceRoots: ["other/library/src/main/java"],
            generatedSourceRoots: [],
            outputDirectories: [],
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

describe("Java move-class target modules", () => {
  it("resolves a source module from the broad v2 context for a scoped refresh", () => {
    const broad = context();
    broad.schemaVersion = "java-project-context-v2";
    expect(
      javaMoveClassSourceSelection(
        broad,
        "maven/app/src/main/java/pkg/Source.java",
        "maven",
      ),
    ).toEqual({ providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" });
  });

  it("offers only unique main roots from the source provider", () => {
    const expected = [{ id: "library", name: "library", root: "library" }];
    expect(
      javaMoveClassTargetModules(
        context(),
        "/workspace/project/app/src/main/java/pkg/Source.java",
        "/workspace/project",
      ),
    ).toEqual(expected);
    expect(
      javaMoveClassTargetModules(
        context(),
        "maven/app/src/main/java/pkg/Source.java",
        "maven",
      ),
    ).toEqual(expected);
    expect(
      javaMoveClassTargetModules(
        context(),
        "C:\\workspace\\project\\app\\src\\main\\java\\pkg\\Source.java",
        "C:\\workspace\\project",
      ),
    ).toEqual(expected);
  });

  it.each(["java-project-context-v6", "java-project-context-v7"] as const)(
    "offers target modules for %s only with snapshot-qualified Java analysis",
    (schemaVersion) => {
      const qualified = context();
      qualified.schemaVersion = schemaVersion;
      qualified.semanticAnalysis = { availability: "available", refusalCode: null };
      qualified.analysis = {
        backend: "jdt",
        snapshotHash: qualified.snapshotHash,
        platformIdentitiesByRelease: {},
        warningCount: 0,
      };

      expect(
        javaMoveClassSourceSelection(
          qualified,
          "app/src/main/java/pkg/Source.java",
          "/workspace/project",
        ),
      ).toEqual({ providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" });
      expect(
        javaMoveClassTargetModules(
          qualified,
          "/workspace/project/app/src/main/java/pkg/Source.java",
          "/workspace/project",
        ),
      ).toEqual([{ id: "library", name: "library", root: "library" }]);

      qualified.analysis.snapshotHash = "c".repeat(64);
      expect(
        javaMoveClassTargetModules(
          qualified,
          "/workspace/project/app/src/main/java/pkg/Source.java",
          "/workspace/project",
        ),
      ).toEqual([]);
    },
  );

  it.each(["java-project-context-v6", "java-project-context-v7"] as const)(
    "does not offer semantic move targets for metadata-only %s contexts",
    (schemaVersion) => {
      const metadataOnly = context();
      metadataOnly.schemaVersion = schemaVersion;
      metadataOnly.semanticAnalysis = {
        availability: "unqualified",
        refusalCode: "java.context.sourceAnalysisUnqualified",
      };
      metadataOnly.analysis = null;
      metadataOnly.selectedSource = {
        path: "app/src/main/java/pkg/Source.java",
        symbol: null,
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
        sourceRoot: "app/src/main/java",
        generated: false,
        bindingKey: null,
        evidence: "SOURCE_ROOT_OWNERSHIP",
      };

      expect(
        javaMoveClassSourceSelection(
          metadataOnly,
          "app/src/main/java/pkg/Source.java",
          "/workspace/project",
        ),
      ).toBeNull();
      expect(
        javaMoveClassTargetModules(
          metadataOnly,
          "/workspace/project/app/src/main/java/pkg/Source.java",
          "/workspace/project",
        ),
      ).toEqual([]);
    },
  );

  it("matches source roots qualified with the configured project path", () => {
    const qualified = context();
    qualified.modules[0]!.sourceSets[0]!.sourceRoots = ["maven/app/src/main/java"];
    qualified.modules[1]!.sourceSets[0]!.sourceRoots = ["maven/library/src/main/java"];
    expect(
      javaMoveClassTargetModules(
        qualified,
        "maven/app/src/main/java/pkg/Source.java",
        "maven",
      ),
    ).toEqual([{ id: "library", name: "library", root: "library" }]);
  });

  it("refuses old, partial, or source-ambiguous contexts", () => {
    const oldContext = context();
    oldContext.schemaVersion = "java-project-context-v2";
    expect(
      javaMoveClassTargetModules(
        oldContext,
        "app/src/main/java/pkg/Source.java",
        "/workspace/project",
      ),
    ).toEqual([]);

    const partialContext = context();
    partialContext.status = "partial";
    expect(
      javaMoveClassTargetModules(
        partialContext,
        "app/src/main/java/pkg/Source.java",
        "/workspace/project",
      ),
    ).toEqual([]);

    const ambiguous = context();
    ambiguous.modules.push({ ...ambiguous.modules[0]!, id: "duplicate", root: "another" });
    expect(
      javaMoveClassTargetModules(
        ambiguous,
        "app/src/main/java/pkg/Source.java",
        "/workspace/project",
      ),
    ).toEqual([]);
  });

  it("rejects destinations without one non-generated main source root", () => {
    const unsafe = context();
    unsafe.modules[1]!.sourceSets[0]!.sourceRoots = [
      "library/src/main/java",
      "library/src/other/java",
    ];
    expect(
      javaMoveClassTargetModules(
        unsafe,
        "app/src/main/java/pkg/Source.java",
        "/workspace/project",
      ),
    ).toEqual([]);

    unsafe.modules[1]!.sourceSets[0]!.sourceRoots = ["library/target/generated-sources"];
    unsafe.modules[1]!.sourceSets[0]!.generatedSourceRoots = [
      "library/target/generated-sources",
    ];
    expect(
      javaMoveClassTargetModules(
        unsafe,
        "app/src/main/java/pkg/Source.java",
        "/workspace/project",
      ),
    ).toEqual([]);
  });
});
