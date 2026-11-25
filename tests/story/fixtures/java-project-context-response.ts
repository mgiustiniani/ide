import type {
  JavaEffectiveProjectContext,
  JavaProjectContextRequest,
  JavaProjectContextResult,
} from "../../../packages/contracts/src/java-project-context";

/** Substituted wire inputs for consumer refusal tests; real-provider qualification is separate. */
export function javaProjectContextResponse(
  request: JavaProjectContextRequest,
  status: "available" | "partial" = "available",
): JavaProjectContextResult & { context: JavaEffectiveProjectContext } {
  const providerId = status === "available" ? "maven-effective-v1" : "gradle-declarative-v1";
  const context: JavaEffectiveProjectContext = {
    schemaVersion: "java-project-context-v1",
    status,
    snapshotHash: "a".repeat(64),
    contextHash: "b".repeat(64),
    sdk: [
      {
        home: request.sdkHome,
        sourceRelease: 17,
        platformRelease: 21,
        identitySha256: "c".repeat(64),
        releaseMetadataSha256: "d".repeat(64),
        signatureArchive: `${request.sdkHome}/lib/ct.sym`,
        signatureArchiveSha256: "e".repeat(64),
      },
    ],
    providers: [
      {
        providerId,
        status,
        strategy: status === "available" ? "embedded-effective-model" : "declarative",
        buildCodeExecution: "denied",
        credentialsAccess: "denied",
        networkAccess: "denied",
        diagnostics: [],
      },
    ],
    modules: [
      {
        providerId,
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
            generatedSourceRoots: ["app/target/generated-sources/annotations"],
            outputDirectories: ["app/target/classes"],
            analysisSourceRoots: ["app/src/main/java", "library/src/main/java"],
            compileClasspath: [
              {
                path: "/repository/z-first.jar",
                providerId,
                moduleId: "app",
                sourceSetId: "main",
                dependencyScope: null,
                fingerprint: "jar:first",
              },
              {
                path: "/repository/a-second.jar",
                providerId,
                moduleId: "app",
                sourceSetId: "main",
                dependencyScope: "compile",
                fingerprint: "jar:second",
              },
            ],
            runtimeClasspath: [
              {
                path: "app/target/classes",
                providerId,
                moduleId: "app",
                sourceSetId: "main",
                dependencyScope: null,
                fingerprint: "classes:current",
              },
            ],
            moduleDependencies: [],
          },
        ],
      },
    ],
    buildEvidence: [{ path: "pom.xml", kind: "declaration-file", fingerprint: "file:current" }],
    selectedSource:
      request.symbol || request.sourceRelativePath
        ? {
            path: `app/src/main/java/${request.sourceRelativePath || "pkg/Runner.java"}`,
            sourceRoot: "app/src/main/java",
            moduleId: "app",
            sourceSetId: "main",
            symbol: request.symbol || null,
            generated: false,
            bindingKey: "Lpkg/Runner;",
            evidence: "JDT_BINDING",
          }
        : null,
    analysis:
      status === "available"
        ? {
            backend: "eclipse-jdt",
            snapshotHash: "a".repeat(64),
            platformIdentitiesByRelease: { "17": "c".repeat(64) },
            warningCount: 0,
          }
        : null,
    refusal: null,
  };
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    projectPath: request.projectPath,
    status,
    engineVersion: "0.7.0",
    context,
  };
}
