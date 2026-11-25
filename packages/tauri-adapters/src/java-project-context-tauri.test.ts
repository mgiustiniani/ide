import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { JavaProjectContextRequest } from "@ide/contracts";
import type { JavaProjectLanguageSettingsRequest } from "@ide/contracts";
import { javaProjectContextResponse } from "../../../tests/story/fixtures/java-project-context-response";
import {
  normalizeJavaProjectContext,
  TauriJavaProjectContextAdapter,
} from "./java-project-context-tauri";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const request: JavaProjectContextRequest = {
  workspaceId: "one",
  generation: 3,
  requestId: "project-1",
  projectPath: "services",
  sdkHome: "/sdk",
  mavenRepository: "/repository",
  activeMavenProfiles: [],
  inactiveMavenProfiles: [],
};
function javaProjectContextV2Response(configuredRequest = request) {
  const response = javaProjectContextResponse(configuredRequest);
  response.context.schemaVersion = "java-project-context-v2";
  for (const module of response.context.modules) {
    for (const sourceSet of module.sourceSets) {
      sourceSet.sourceRootEvidence = [
        {
          path: sourceSet.sourceRoots[0] ?? "",
          origin: "build-plugin",
          providerId: module.providerId,
          descriptorPath: "pom.xml",
          profileId: null,
          pluginId: "org.codehaus.mojo:build-helper-maven-plugin",
          executionId: "add-main-sources",
          goal: "add-source",
          phase: "generate-sources",
          availability: "complete",
        },
      ];
      sourceSet.compilerOptionsAvailability = "complete";
      sourceSet.compilerOptionsRefusalCode = null;
      sourceSet.compilerOptions = [
        { name: "-parameters", value: "", origin: "pom.xml", redacted: true },
      ];
      sourceSet.resolvedArtifactAvailability = "complete";
      sourceSet.resolvedArtifactRefusalCode = null;
      sourceSet.resolvedArtifacts = [
        {
          path: "/repository/z-first-tests.jar",
          coordinates: { groupId: "example", artifactId: "first", version: "1.2.3" },
          extension: "jar",
          classifier: "tests",
          scope: "compile",
          transitive: true,
          fingerprint: "artifact:first",
        },
      ];
      sourceSet.annotationProcessors = {
        availability: "complete",
        processorPath: ["/repository/processor.jar"],
        dependencies: [],
        processorNames: ["example.Processor"],
        options: { generatedPackage: "example.generated" },
        mode: "explicit",
        refusalCode: null,
      };
      sourceSet.jpms = {
        availability: "not-declared",
        modulePath: [],
        descriptors: [],
        refusalCode: null,
      };
      for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath])
        entry.artifact = null;
      sourceSet.compileClasspath[1]!.artifact = {
        path: "/repository/a-second.jar",
        coordinates: { groupId: "example", artifactId: "second", version: "4.5.6" },
        extension: "jar",
        classifier: null,
        scope: "compile",
        transitive: false,
        fingerprint: "artifact:second",
      };
    }
  }
  return response;
}
function javaProjectContextV3Response(configuredRequest: JavaProjectContextRequest) {
  const response = javaProjectContextV2Response(configuredRequest);
  response.context.schemaVersion = "java-project-context-v3";
  if (response.context.selectedSource)
    response.context.selectedSource.providerId = configuredRequest.providerId;
  return response;
}
function javaProjectContextV4Response(configuredRequest: JavaProjectContextRequest) {
  const response = javaProjectContextV2Response(configuredRequest);
  response.context.schemaVersion = "java-project-context-v4";
  const sourceSet = structuredClone(response.context.modules[0]!.sourceSets[0]!);
  sourceSet.id =
    configuredRequest.sourceSetId && configuredRequest.sourceSetId !== "main"
      ? configuredRequest.sourceSetId
      : "integrationTest";
  sourceSet.kind = "integration-test";
  for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath])
    entry.sourceSetId = sourceSet.id;
  sourceSet.mavenFailsafe = {
    availability: "complete",
    refusalCode: null,
    executions: [
      {
        pluginId: "org.apache.maven.plugins:maven-failsafe-plugin",
        pluginVersion: "3.5.2",
        executionId: "run-tests",
        goals: ["integration-test", "verify"],
        phase: "integration-test",
        profileId: "quality",
        selectors: [
          {
            name: "includes",
            value: "**/*IT.java",
            origin: "profile-execution:quality",
            availability: "complete",
          },
        ],
        reports: [
          {
            name: "reportsDirectory",
            value: "target/failsafe-reports",
            origin: "profile-execution:quality",
            availability: "complete",
          },
          {
            name: "reportFormat",
            value: "plain",
            origin: "profile-execution:quality",
            availability: "complete",
          },
        ],
        availability: "complete",
        refusalCode: null,
      },
    ],
  };
  response.context.modules[0]!.sourceSets.push(sourceSet);
  if (response.context.selectedSource)
    response.context.selectedSource.providerId = configuredRequest.providerId;
  return response;
}
function javaProjectContextV5Response(configuredRequest: JavaProjectContextRequest) {
  const response = javaProjectContextV4Response(configuredRequest);
  response.context.schemaVersion = "java-project-context-v5";
  response.context.modules[0]!.coordinates = null;
  for (const sourceSet of response.context.modules[0]!.sourceSets) {
    sourceSet.mavenFailsafe ??= {
      availability: "not-declared",
      refusalCode: null,
      executions: [],
    };
  }
  const sourceSet = response.context.modules[0]!.sourceSets.find(
    (candidate) =>
      candidate.id === configuredRequest.sourceSetId ||
      (configuredRequest.sourceSetKind !== undefined &&
        candidate.kind === configuredRequest.sourceSetKind),
  )!;
  sourceSet.jpms = {
    availability: "complete",
    modulePath: [],
    descriptors: [
      {
        path: "app/src/main/java/module-info.java",
        moduleName: "example.app",
        open: false,
        requires: [{ moduleName: "java.sql", modifiers: ["transitive"] }],
        exports: [{ packageName: "example.app.api", targets: ["consumer.app"] }],
        opens: [{ packageName: "example.app.internal", targets: ["spring.core"] }],
        uses: ["example.app.spi.Service"],
        provides: [
          {
            serviceType: "example.app.spi.Service",
            implementations: ["example.app.internal.ServiceImpl"],
          },
        ],
        unreportedDirectives: [],
        contentSha256: "f".repeat(64),
      },
    ],
    refusalCode: null,
  };
  const descriptor = sourceSet.jpms.descriptors[0]!;
  delete (descriptor as unknown as Record<string, unknown>).unreportedDirectives;
  (
    descriptor as unknown as { provides: { serviceName: string; implementations: string[] }[] }
  ).provides = [
    {
      serviceName: "example.app.spi.Service",
      implementations: ["example.app.internal.ServiceImpl"],
    },
  ];
  return response;
}
function javaProjectContextV6Response(configuredRequest: JavaProjectContextRequest = request) {
  const response = javaProjectContextV5Response({
    ...configuredRequest,
    providerId: configuredRequest.providerId ?? "maven-effective-v1",
    moduleId: configuredRequest.moduleId ?? "app",
    sourceSetId: configuredRequest.sourceSetId ?? "main",
  });
  response.context.schemaVersion = "java-project-context-v6";
  response.context.analysis = null;
  response.context.selectedSource = null;
  response.context.semanticAnalysis = {
    availability: "unqualified",
    refusalCode: "java.context.sourceAnalysisUnqualified",
  };
  return response;
}
function javaProjectContextV7Response(configuredRequest: JavaProjectContextRequest = request) {
  const response = javaProjectContextV6Response(configuredRequest);
  response.context.schemaVersion = "java-project-context-v7";
  for (const module of response.context.modules) {
    const additionalSourceSets: typeof module.sourceSets = [];
    for (const sourceSet of module.sourceSets) {
      sourceSet.mavenTestJvm = {
        availability: "not-applicable",
        mode: "unknown",
        refusalCode: null,
        executions: [],
      };
      if (sourceSet.kind === "main") {
        const testSourceSet = structuredClone(sourceSet);
        testSourceSet.id = "test";
        testSourceSet.kind = "test";
        testSourceSet.sourceRoots = ["app/src/test/java"];
        testSourceSet.outputDirectories = ["app/target/test-classes"];
        for (const entry of [...testSourceSet.compileClasspath, ...testSourceSet.runtimeClasspath])
          entry.sourceSetId = "test";
        testSourceSet.mavenTestJvm = {
          availability: "complete",
          mode: "forked",
          refusalCode: null,
          executions: [
            {
              pluginId: "org.apache.maven.plugins:maven-surefire-plugin",
              pluginVersion: "3.5.3",
              executionId: "default-test",
              goals: ["test"],
              phase: "test",
              mode: "forked",
              availability: "complete",
              refusalCode: null,
              forkSettings: [
                {
                  name: "forkCount",
                  value: "1",
                  origin: "plugin-default",
                  availability: "complete",
                  redacted: false,
                },
              ],
              argLineLayers: [
                {
                  name: "argLine",
                  value: "-Dfixture.project=retained @{argLine}",
                  origin: "plugin-configuration",
                  availability: "complete",
                  redacted: false,
                },
              ],
              effectiveArgLineTemplate: "-Dfixture.project=retained @{argLine}",
            },
          ],
        };
        additionalSourceSets.push(testSourceSet);
      }
    }
    module.sourceSets.push(...additionalSourceSets);
  }
  return response;
}
describe("Java project-context provider boundary", () => {
  it("accepts saved-file recovery only for the exact reviewed synchronization", async () => {
    const recovery = { workspaceId: "one", generation: 3, requestId: "project-1", projectPath: "services" };
    const adapter = new TauriJavaProjectContextAdapter();
    vi.mocked(invoke).mockResolvedValueOnce({ ...recovery, recovered: true });
    await expect(adapter.recoverSavedSources(recovery)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("recover_refactorkit_java_saved_sources", { request: recovery });
    vi.mocked(invoke).mockResolvedValueOnce({ ...recovery, projectPath: "another", recovered: true });
    await expect(adapter.recoverSavedSources(recovery)).rejects.toThrow("uncorrelated");
  });

  it("admits a declared Java provider while preserving readonly policy and identity checks", () => {
    const response = javaProjectContextResponse(request);
    const providerId = "java-declared-v1";
    response.context.providers[0]!.providerId = providerId;
    for (const module of response.context.modules) {
      module.providerId = providerId;
      for (const set of module.sourceSets)
        for (const entry of [...set.compileClasspath, ...set.runtimeClasspath]) entry.providerId = providerId;
    }
    expect(normalizeJavaProjectContext(response, request)).toEqual(response);
    const unsafe = structuredClone(response);
    unsafe.context.providers[0]!.buildCodeExecution = "allowed-explicit";
    expect(() => normalizeJavaProjectContext(unsafe, request)).toThrow();
    const unknown = structuredClone(response);
    unknown.context.providers[0]!.providerId = "unknown-provider";
    expect(() => normalizeJavaProjectContext(unknown, request)).toThrow();
  });
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(listen).mockReset();
  });
  it("accepts evaluated Gradle only with matching session evidence and refuses unauthorized provider execution", () => {
    const configured = {
      ...request,
      gradle: { executable: "/gradle", userHome: "/cache", projectProperties: { mode: "base" } },
    };
    const response = javaProjectContextResponse(configured);
    response.context.providers[0] = {
      ...response.context.providers[0],
      providerId: "gradle-effective-v1",
      strategy: "gradle-evaluated-v1",
      buildCodeExecution: "allowed-explicit",
      credentialsAccess: "build-controlled",
      networkAccess: "offline-resolution",
    };
    response.context.modules[0].providerId = "gradle-effective-v1";
    for (const set of response.context.modules[0].sourceSets)
      for (const entry of [...set.compileClasspath, ...set.runtimeClasspath])
        entry.providerId = "gradle-effective-v1";
    const qualified = {
      ...response,
      gradleSync: {
        schemaVersion: "java-gradle-sync-v1",
        status: "synchronized",
        snapshotHash: response.context.snapshotHash,
        providerId: "gradle-effective-v1",
        gradleVersion: "9.8.0",
        sdkHome: "/sdk",
      },
    };
    expect(normalizeJavaProjectContext(qualified, configured).status).toBe("available");
    expect(() => normalizeJavaProjectContext(response, configured)).toThrow();
    expect(() => normalizeJavaProjectContext(qualified, request)).toThrow();
    const refreshed = {
      ...qualified,
      gradleSync: { ...qualified.gradleSync, snapshotHash: "f".repeat(64) },
    };
    const currentRequest = { ...configured, expectedSnapshotHash: response.context.snapshotHash };
    expect(normalizeJavaProjectContext(refreshed, currentRequest).gradleSync?.snapshotHash).toBe(
      "f".repeat(64),
    );
    expect(() =>
      normalizeJavaProjectContext(refreshed, { ...configured, evaluateGradle: true }),
    ).toThrow();
    expect(() =>
      normalizeJavaProjectContext(refreshed, {
        ...configured,
        expectedSnapshotHash: "f".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      normalizeJavaProjectContext(
        { ...refreshed, gradleSync: { ...refreshed.gradleSync, sdkHome: "/another-sdk" } },
        currentRequest,
      ),
    ).toThrow();
    const forged = structuredClone(qualified);
    forged.context.providers[0].providerId = "maven-effective-v1";
    expect(() => normalizeJavaProjectContext(forged, configured)).toThrow();
  });
  it("refuses implicit or unbounded Gradle execution settings before native invocation", async () => {
    const adapter = new TauriJavaProjectContextAdapter();
    for (const bad of [
      { ...request, evaluateGradle: true },
      { ...request, aggregateGradleCompositeContext: true },
      {
        ...request,
        evaluateGradle: true,
        aggregateGradleCompositeContext: true,
        gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
        providerId: "gradle-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
      },
      { ...request, gradle: { executable: "relative", userHome: "", projectProperties: {} } },
      {
        ...request,
        gradle: {
          executable: "/gradle",
          userHome: "",
          projectProperties: { invalid: "x".repeat(1025) },
        },
      },
    ]) {
      await expect(adapter.query(bad as JavaProjectContextRequest)).rejects.toThrow();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it("retains provider classpath order and forwards only the bounded request authority", async () => {
    vi.mocked(invoke).mockResolvedValue(javaProjectContextResponse(request));
    const result = await new TauriJavaProjectContextAdapter().query(request);
    expect(invoke).toHaveBeenCalledWith("query_refactorkit_java_project_context", { request });
    expect(
      "context" in result &&
        result.context.modules[0].sourceSets[0].compileClasspath.map((p) => p.path),
    ).toEqual(["/repository/z-first.jar", "/repository/a-second.jar"]);
    await new TauriJavaProjectContextAdapter().stop({ workspaceId: "one", generation: 3 });
    expect(invoke).toHaveBeenLastCalledWith("stop_refactorkit_java_project_context", {
      authority: { workspaceId: "one", generation: 3 },
    });
  });

  it("requests aggregate composite identity only with explicit Gradle evaluation", async () => {
    const aggregateRequest: JavaProjectContextRequest = {
      ...request,
      gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      evaluateGradle: true,
      aggregateGradleCompositeContext: true,
    };
    const response = javaProjectContextV2Response(aggregateRequest);
    response.context.schemaVersion = "java-project-context-v3";
    response.context.providers[0]!.providerId = "gradle-effective-v1";
    const module = response.context.modules[0]!;
    module.providerId = "gradle-effective-v1";
    module.id = "included-build-hash::app";
    module.name = "app";
    module.root = "gradle/app";
    module.buildRoot = "gradle/included-build";
    module.projectPath = ":app";
    for (const sourceSet of module.sourceSets) {
      for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath]) {
        entry.providerId = module.providerId;
        entry.moduleId = module.id;
      }
    }
    response.gradleSync = {
      schemaVersion: "java-gradle-sync-v1",
      status: "synchronized",
      snapshotHash: response.context.snapshotHash,
      providerId: "gradle-effective-v1",
      gradleVersion: "9.6.1",
      sdkHome: "/sdk",
    };
    vi.mocked(invoke).mockResolvedValue(response);

    const result = await new TauriJavaProjectContextAdapter().query(aggregateRequest);

    expect(invoke).toHaveBeenCalledWith("query_refactorkit_java_project_context", {
      request: aggregateRequest,
    });
    expect("context" in result && result.context.schemaVersion).toBe("java-project-context-v3");
    expect("context" in result && result.context.modules[0]).toEqual(
      expect.objectContaining({ buildRoot: "gradle/included-build", projectPath: ":app" }),
    );
  });

  it("accepts metadata-only Gradle v6 after an aggregate Java release refusal", async () => {
    const aggregateRequest: JavaProjectContextRequest = {
      ...request,
      gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
      evaluateGradle: true,
      aggregateGradleCompositeContext: true,
    };
    const response = javaProjectContextV6Response(aggregateRequest);
    response.context.providers[0]!.providerId = "gradle-effective-v1";
    const module = response.context.modules[0]!;
    module.providerId = "gradle-effective-v1";
    module.id = ":app";
    module.root = "gradle/app";
    module.buildRoot = ".";
    module.projectPath = ":app";
    for (const sourceSet of module.sourceSets) {
      sourceSet.mavenFailsafe = {
        availability: "not-applicable",
        refusalCode: null,
        executions: [],
      };
      for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath]) {
        entry.providerId = module.providerId;
        entry.moduleId = module.id;
      }
    }
    response.gradleSync = {
      schemaVersion: "java-gradle-sync-v1",
      status: "synchronized",
      snapshotHash: response.context.snapshotHash,
      providerId: "gradle-effective-v1",
      gradleVersion: "9.6.1",
      sdkHome: "/sdk",
      gradleRuntimeHome: "/jdk-21",
    };
    vi.mocked(invoke).mockResolvedValue(response);

    const result = await new TauriJavaProjectContextAdapter().query(aggregateRequest);

    expect("context" in result && result.context.schemaVersion).toBe("java-project-context-v6");
    expect("context" in result && result.context.semanticAnalysis).toEqual({
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
    expect("gradleSync" in result && result.gradleSync?.gradleRuntimeHome).toBe("/jdk-21");
  });

  it("applies only a correlated project-context compiler setting and can clear its session override", async () => {
    const adapter = new TauriJavaProjectContextAdapter();
    const settingsRequest: JavaProjectLanguageSettingsRequest = {
      workspaceId: "one",
      generation: 3,
      projectPath: "services",
      contextSchemaVersion: "java-project-context-v2",
      snapshotHash: "a".repeat(64),
      contextHash: "b".repeat(64),
    };
    vi.mocked(invoke).mockResolvedValue({
      ...settingsRequest,
      outcome: "applied",
      message: "Applied verified compiler settings.",
    });
    await expect(adapter.applyLanguageSettings(settingsRequest)).resolves.toEqual({
      ...settingsRequest,
      outcome: "applied",
      message: "Applied verified compiler settings.",
    });
    expect(invoke).toHaveBeenCalledWith("apply_refactorkit_java_project_language_settings", {
      request: settingsRequest,
    });

    vi.mocked(invoke).mockResolvedValue({
      ...settingsRequest,
      contextHash: "c".repeat(64),
      outcome: "applied",
      message: "Forged response.",
    });
    await expect(adapter.applyLanguageSettings(settingsRequest)).rejects.toThrow();

    await adapter.clearLanguageSettings?.({ workspaceId: "one", generation: 3 });
    expect(invoke).toHaveBeenLastCalledWith("clear_refactorkit_java_project_language_settings", {
      authority: { workspaceId: "one", generation: 3 },
    });
  });
  it("accepts only the source-set kinds declared by the Java context protocol", () => {
    const response = javaProjectContextV2Response();
    const sourceSets = response.context.modules[0]!.sourceSets;
    sourceSets.push(
      ...(["test", "integration-test", "custom"] as const).map((kind, index) => ({
        ...structuredClone(sourceSets[0]!),
        id: `additional-${index}`,
        kind,
      })),
    );
    expect(() => normalizeJavaProjectContext(response, request)).not.toThrow();

    const unrecognized = structuredClone(response);
    Object.assign(unrecognized.context.modules[0]!.sourceSets[0]!, {
      kind: "integrationTest",
    });
    expect(() => normalizeJavaProjectContext(unrecognized, request)).toThrow();
  });
  it("normalizes complete v4 Maven Failsafe execution metadata without guessing plugin defaults", () => {
    const selectedRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "integrationTest",
    };
    const response = javaProjectContextV4Response(selectedRequest);
    const normalized = normalizeJavaProjectContext(response, selectedRequest);
    expect("context" in normalized).toBe(true);
    if (!("context" in normalized)) throw new Error("Expected an effective context.");
    expect(normalized.context.schemaVersion).toBe("java-project-context-v4");
    expect(normalized.context.modules[0]!.sourceSets[1]!.mavenFailsafe).toEqual(
      response.context.modules[0]!.sourceSets[1]!.mavenFailsafe,
    );
  });
  it("correlates the v4 Maven source-set-kind selector and refuses that selector on v3", () => {
    const selectedRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetKind: "integration-test",
    };
    const response = javaProjectContextV4Response(selectedRequest);
    expect(() => normalizeJavaProjectContext(response, selectedRequest)).not.toThrow();
    const legacy = structuredClone(response);
    legacy.context.schemaVersion = "java-project-context-v3";
    delete legacy.context.modules[0]!.sourceSets[1]!.mavenFailsafe;
    expect(() => normalizeJavaProjectContext(legacy, selectedRequest)).toThrow();
  });
  it("accepts provider-qualified v5 JPMS directives and refuses incomplete closed descriptors", () => {
    const selectedRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "integrationTest",
      requiredFacts: ["jpms"],
    };
    const response = javaProjectContextV5Response(selectedRequest);
    const normalized = normalizeJavaProjectContext(response, selectedRequest);
    expect("context" in normalized).toBe(true);
    if (!("context" in normalized)) throw new Error("Expected an effective context.");
    expect(normalized.context.schemaVersion).toBe("java-project-context-v5");
    expect(normalized.context.modules[0]!.coordinates).toBeNull();
    expect(normalized.context.modules[0]!.sourceSets[1]!.jpms?.descriptors[0]).toMatchObject({
      opens: [{ packageName: "example.app.internal", targets: ["spring.core"] }],
      uses: ["example.app.spi.Service"],
      provides: [
        {
          serviceType: "example.app.spi.Service",
          implementations: ["example.app.internal.ServiceImpl"],
        },
      ],
      unreportedDirectives: [],
    });

    const incomplete = structuredClone(response);
    delete (
      incomplete.context.modules[0]!.sourceSets[1]!.jpms!.descriptors[0] as unknown as Record<
        string,
        unknown
      >
    ).opens;
    expect(() => normalizeJavaProjectContext(incomplete, selectedRequest)).toThrow();

    const legacyProvidesField = structuredClone(response);
    const provides =
      legacyProvidesField.context.modules[0]!.sourceSets[1]!.jpms!.descriptors[0]!.provides[0]!;
    const rawProvides = provides as unknown as Record<string, unknown>;
    rawProvides.serviceType = rawProvides.serviceName;
    delete rawProvides.serviceName;
    expect(() => normalizeJavaProjectContext(legacyProvidesField, selectedRequest)).toThrow();

    const missingModuleCoordinates = structuredClone(response);
    delete missingModuleCoordinates.context.modules[0]!.coordinates;
    expect(() => normalizeJavaProjectContext(missingModuleCoordinates, selectedRequest)).toThrow();

    const extraContextField = structuredClone(response);
    Object.assign(extraContextField.context, { unexpected: true });
    expect(() => normalizeJavaProjectContext(extraContextField, selectedRequest)).toThrow();

    const extraSourceSetField = structuredClone(response);
    Object.assign(extraSourceSetField.context.modules[0]!.sourceSets[1]!, { unexpected: true });
    expect(() => normalizeJavaProjectContext(extraSourceSetField, selectedRequest)).toThrow();

    const extraClasspathField = structuredClone(response);
    Object.assign(extraClasspathField.context.modules[0]!.sourceSets[0]!.compileClasspath[0]!, {
      unexpected: true,
    });
    expect(() => normalizeJavaProjectContext(extraClasspathField, selectedRequest)).toThrow();
  });
  it("accepts v6 metadata-only project context without inventing source ownership", () => {
    const response = javaProjectContextV6Response();
    const normalized = normalizeJavaProjectContext(response, request);
    expect("context" in normalized).toBe(true);
    if (!("context" in normalized)) throw new Error("Expected a metadata project context.");
    expect(normalized.context.schemaVersion).toBe("java-project-context-v6");
    expect(normalized.context.analysis).toBeNull();
    expect(normalized.context.selectedSource).toBeNull();
    expect(normalized.context.semanticAnalysis).toEqual({
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });

    const selectedMetadataRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
    };
    const selectedMetadata = normalizeJavaProjectContext(
      javaProjectContextV6Response(selectedMetadataRequest),
      selectedMetadataRequest,
    );
    expect("context" in selectedMetadata).toBe(true);
    if ("context" in selectedMetadata)
      expect(selectedMetadata.context.selectedSource).toBeNull();

    const sourceRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
    };
    expect(() => normalizeJavaProjectContext(javaProjectContextV6Response(sourceRequest), sourceRequest)).toThrow();

    const v6OwnerOnly = javaProjectContextV6Response(sourceRequest);
    v6OwnerOnly.context.selectedSource = {
      path: "app/src/main/java/pkg/Runner.java",
      symbol: null,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      sourceRoot: "app/src/main/java",
      generated: false,
      bindingKey: null,
      evidence: "SOURCE_ROOT_OWNERSHIP",
    };
    expect(() => normalizeJavaProjectContext(v6OwnerOnly, sourceRequest)).toThrow();
  });
  it("accepts v7 owner-only source selection without qualifying Java semantics", () => {
    const sourceRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
    };
    const response = javaProjectContextV7Response(sourceRequest);
    response.context.selectedSource = {
      path: "app/src/main/java/pkg/Runner.java",
      symbol: null,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      sourceRoot: "app/src/main/java",
      generated: false,
      bindingKey: null,
      evidence: "SOURCE_ROOT_OWNERSHIP",
    };

    const normalized = normalizeJavaProjectContext(response, sourceRequest);
    expect("context" in normalized).toBe(true);
    if (!("context" in normalized)) throw new Error("Expected an owner-only Java project context.");
    expect(normalized.context.analysis).toBeNull();
    expect(normalized.context.semanticAnalysis).toEqual({
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
    expect(normalized.context.selectedSource).toMatchObject({
      path: "app/src/main/java/pkg/Runner.java",
      symbol: null,
      evidence: "SOURCE_ROOT_OWNERSHIP",
      bindingKey: null,
      moduleId: "app",
      sourceSetId: "main",
    });

    const semanticSelectionRequest = { ...sourceRequest, symbol: "pkg.Runner" };
    expect(() => normalizeJavaProjectContext(response, semanticSelectionRequest)).toThrow();

    const fabricatedBinding = structuredClone(response);
    fabricatedBinding.context.selectedSource!.bindingKey = "Lpkg/Runner;";
    expect(() => normalizeJavaProjectContext(fabricatedBinding, sourceRequest)).toThrow();
  });
  it("requires JDT binding evidence for v7 symbol selection", () => {
    const symbolRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
      symbol: "pkg.Runner",
    };
    const response = javaProjectContextV7Response(symbolRequest);
    response.context.analysis = {
      backend: "eclipse-jdt",
      snapshotHash: response.context.snapshotHash,
      platformIdentitiesByRelease: { "27": "d".repeat(64) },
      warningCount: 0,
    };
    response.context.semanticAnalysis = { availability: "available", refusalCode: null };
    response.context.selectedSource = {
      path: "app/src/main/java/pkg/Runner.java",
      symbol: "pkg.Runner",
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      sourceRoot: "app/src/main/java",
      generated: false,
      bindingKey: "Lpkg/Runner;",
      evidence: "JDT_BINDING",
    };

    const normalized = normalizeJavaProjectContext(response, symbolRequest);
    expect("context" in normalized).toBe(true);
    if (!("context" in normalized))
      throw new Error("Expected a binding-backed Java symbol selection.");
    expect(normalized.context.selectedSource).toMatchObject({
      symbol: "pkg.Runner",
      bindingKey: "Lpkg/Runner;",
      evidence: "JDT_BINDING",
    });

    const unbound = structuredClone(response);
    unbound.context.selectedSource!.bindingKey = null;
    expect(() => normalizeJavaProjectContext(unbound, symbolRequest)).toThrow();
  });
  it("accepts v7 JVM provenance facts while preserving metadata-only source-analysis limits", () => {
    const response = javaProjectContextV7Response();
    const normalized = normalizeJavaProjectContext(response, request);
    expect("context" in normalized).toBe(true);
    if (!("context" in normalized)) throw new Error("Expected a metadata project context.");
    expect(normalized.context.schemaVersion).toBe("java-project-context-v7");
    expect(normalized.context.semanticAnalysis).toEqual({
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    });
    expect(normalized.context.modules[0]?.sourceSets[2]?.mavenTestJvm).toMatchObject({
      availability: "complete",
      mode: "forked",
      executions: [
        {
          effectiveArgLineTemplate: "-Dfixture.project=retained @{argLine}",
          argLineLayers: [
            { origin: "plugin-configuration", value: "-Dfixture.project=retained @{argLine}" },
          ],
        },
      ],
    });

    const emptyArgLine = structuredClone(response);
    const emptyArgLineExecution =
      emptyArgLine.context.modules[0]!.sourceSets[2]!.mavenTestJvm!.executions[0]!;
    emptyArgLineExecution.argLineLayers[0]!.value = "";
    emptyArgLineExecution.effectiveArgLineTemplate = "";
    const emptyArgLineContext = normalizeJavaProjectContext(emptyArgLine, request);
    expect("context" in emptyArgLineContext).toBe(true);
    if ("context" in emptyArgLineContext)
      expect(emptyArgLineContext.context.modules[0]?.sourceSets[2]?.mavenTestJvm).toMatchObject({
        executions: [{ argLineLayers: [{ value: "" }], effectiveArgLineTemplate: "" }],
      });

    const missingFact = structuredClone(response);
    delete missingFact.context.modules[0]!.sourceSets[2]!.mavenTestJvm;
    expect(() => normalizeJavaProjectContext(missingFact, request)).toThrow();
    const invalidOrigin = structuredClone(response);
    invalidOrigin.context.modules[0]!.sourceSets[2]!.mavenTestJvm!.executions[0]!.argLineLayers[0]!.availability = "unknown" as never;
    expect(() => normalizeJavaProjectContext(invalidOrigin, request)).toThrow();

    const analyzed = structuredClone(response);
    analyzed.context.semanticAnalysis = { availability: "available", refusalCode: null };
    analyzed.context.analysis = {
      backend: "eclipse-jdt",
      snapshotHash: analyzed.context.snapshotHash,
      platformIdentitiesByRelease: { "17": "c".repeat(64) },
      warningCount: 0,
    };
    expect(normalizeJavaProjectContext(analyzed, request).status).toBe("available");
  });
  it("admits SDK API 27 without extending v2-v5 source-language contracts", () => {
    const selectedRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
    };
    const fixtures = [
      [() => javaProjectContextV2Response(), request],
      [() => javaProjectContextV3Response(selectedRequest), selectedRequest],
      [() => javaProjectContextV4Response(selectedRequest), selectedRequest],
      [() => javaProjectContextV5Response(selectedRequest), selectedRequest],
    ] as const;
    for (const [fixture, configuredRequest] of fixtures) {
      for (const apiRelease of [8, 25, 27]) {
        const response = fixture();
        response.context.sdk[0]!.sourceRelease = apiRelease;
        expect(normalizeJavaProjectContext(response, configuredRequest).status).toBe("available");
      }
      for (const apiRelease of [7, 26, 28, 27.5]) {
        const response = fixture();
        response.context.sdk[0]!.sourceRelease = apiRelease;
        expect(() => normalizeJavaProjectContext(response, configuredRequest)).toThrow();
      }
      for (const field of ["sourceLevel", "release"] as const) {
        for (const level of [26, 27]) {
          const response = fixture();
          response.context.sdk[0]!.sourceRelease = 27;
          response.context.modules[0]!.sourceSets[0]![field] = level;
          expect(() => normalizeJavaProjectContext(response, configuredRequest)).toThrow();
        }
      }
    }
  });
  it("accepts Java 27 metadata levels in provider-qualified v6 and v7 contexts", () => {
    for (const response of [javaProjectContextV6Response(), javaProjectContextV7Response()]) {
      response.context.sdk[0]!.sourceRelease = 27;
      response.context.sdk[0]!.platformRelease = 27;
      for (const module of response.context.modules) {
        for (const sourceSet of module.sourceSets) {
          sourceSet.sourceLevel = 27;
          sourceSet.release = 27;
        }
      }

      const normalized = normalizeJavaProjectContext(response, request);
      expect("context" in normalized).toBe(true);
      if (!("context" in normalized)) throw new Error("Expected a Java 27 metadata context.");
      expect(normalized.context.sdk[0]?.sourceRelease).toBe(27);

      const unsupported = structuredClone(response);
      unsupported.context.sdk[0]!.sourceRelease = 28;
      expect(() => normalizeJavaProjectContext(unsupported, request)).toThrow();
    }
  });
  it("preserves an attested Gradle runtime JDK in the v6 synchronization receipt", () => {
    const configured: JavaProjectContextRequest = {
      ...request,
      providerId: "gradle-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      evaluateGradle: true,
      gradle: {
        executable: "/gradle",
        userHome: "",
        gradleRuntimeHome: "/jdk-21",
        projectProperties: {},
      },
    };
    const response = javaProjectContextV6Response(configured);
    response.context.providers[0] = {
      ...response.context.providers[0],
      providerId: "gradle-effective-v1",
      strategy: "gradle-evaluated-v1",
      buildCodeExecution: "allowed-explicit",
      credentialsAccess: "build-controlled",
      networkAccess: "offline-resolution",
    };
    response.context.modules[0]!.providerId = "gradle-effective-v1";
    response.context.modules[0]!.buildRoot = ".";
    response.context.modules[0]!.projectPath = ":";
    for (const sourceSet of response.context.modules[0]!.sourceSets) {
      sourceSet.mavenFailsafe = {
        availability: "not-applicable",
        refusalCode: null,
        executions: [],
      };
      for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath])
        entry.providerId = "gradle-effective-v1";
    }
    response.gradleSync = {
      schemaVersion: "java-gradle-sync-v1",
      status: "synchronized",
      providerId: "gradle-effective-v1",
      snapshotHash: response.context.snapshotHash,
      gradleVersion: "9.6.1",
      sdkHome: "/sdk",
      gradleRuntimeHome: "/jdk-21",
    };

    const normalized = normalizeJavaProjectContext(response, configured);
    expect(normalized.gradleSync?.gradleRuntimeHome).toBe("/jdk-21");
    const missingRuntime = structuredClone(response);
    delete missingRuntime.gradleSync!.gradleRuntimeHome;
    expect(() => normalizeJavaProjectContext(missingRuntime, configured)).toThrow();
  });
  it("accepts SDK API 27 with Java 25 source in v5 and refuses newer source levels", () => {
    const selectedRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
    };
    const response = javaProjectContextV5Response(selectedRequest);
    response.context.sdk[0]!.sourceRelease = 27;
    response.context.sdk[0]!.platformRelease = 27;
    response.context.analysis!.platformIdentitiesByRelease = { "27": "c".repeat(64) };
    for (const sourceSet of response.context.modules[0]!.sourceSets) {
      sourceSet.sourceLevel = 25;
      sourceSet.release = 25;
    }

    const normalized = normalizeJavaProjectContext(response, selectedRequest);
    expect("context" in normalized).toBe(true);
    if (!("context" in normalized)) throw new Error("Expected a Java 25 effective context with SDK API 27.");
    expect(normalized.context.modules[0]!.sourceSets[0]).toMatchObject({
      sourceLevel: 25,
      release: 25,
    });

    for (const sourceLevel of [26, 27, 28]) {
      const unsupported = structuredClone(response);
      unsupported.context.modules[0]!.sourceSets[0]!.sourceLevel = sourceLevel;
      expect(() => normalizeJavaProjectContext(unsupported, selectedRequest)).toThrow();
    }
  });
  it("accepts v5's explicit not-applicable Failsafe fact for a Gradle source set", () => {
    const selectedRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "gradle-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      requiredFacts: ["jpms"],
      gradle: { executable: "/usr/bin/gradle", userHome: "", projectProperties: {} },
    };
    const response = javaProjectContextV5Response(selectedRequest);
    const module = response.context.modules[0]!;
    module.providerId = "gradle-effective-v1";
    module.buildRoot = ".";
    module.projectPath = ":app";
    for (const sourceSet of module.sourceSets) {
      sourceSet.mavenFailsafe = {
        availability: "not-applicable",
        refusalCode: null,
        executions: [],
      };
      for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath])
        entry.providerId = "gradle-effective-v1";
    }
    response.context.providers[0]!.providerId = "gradle-effective-v1";
    response.context.providers[0]!.strategy = "gradle-evaluated-v1";
    response.gradleSync = {
      schemaVersion: "java-gradle-sync-v1",
      status: "synchronized",
      snapshotHash: response.context.snapshotHash,
      providerId: "gradle-effective-v1",
      gradleVersion: "9.8",
      sdkHome: selectedRequest.sdkHome,
    };

    const normalized = normalizeJavaProjectContext(response, selectedRequest);
    expect("context" in normalized).toBe(true);
    if (!("context" in normalized)) throw new Error("Expected an effective context.");
    expect(normalized.context.modules[0]!.sourceSets[0]!.mavenFailsafe?.availability).toBe(
      "not-applicable",
    );
  });
  it("refuses malformed or cross-provider v4 Failsafe metadata", () => {
    const selectedRequest: JavaProjectContextRequest = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "integrationTest",
    };
    const response = javaProjectContextV4Response(selectedRequest);
    const forged = structuredClone(response);
    forged.context.modules[0]!.providerId = "gradle-effective-v1";
    expect(() => normalizeJavaProjectContext(forged, selectedRequest)).toThrow();

    const malformed = structuredClone(response);
    malformed.context.modules[0]!.sourceSets[1]!.mavenFailsafe!.executions[0]!.reports[0]!.availability =
      "unqualified" as never;
    expect(() => normalizeJavaProjectContext(malformed, selectedRequest)).toThrow();
    const extra = structuredClone(response);
    Object.assign(extra.context.modules[0]!.sourceSets[1]!.mavenFailsafe!, {
      inferredDefault: true,
    });
    expect(() => normalizeJavaProjectContext(extra, selectedRequest)).toThrow();
  });
  it("normalizes RefactorKit context v2 compiler, artifact, processor, provenance and JPMS facts", async () => {
    const response = javaProjectContextV2Response();
    const sourceSet = response.context.modules[0]!.sourceSets[0]!;
    response.context.buildEvidence = [
      {
        path: "/repository/processor.jar",
        kind: "annotation-processor",
        fingerprint: "processor-jar:current",
      },
    ];
    sourceSet.jpms = {
      availability: "complete",
      modulePath: [
        {
          path: "/repository/fixture-dependency.jar",
          moduleNames: ["fixture.dependency"],
          fingerprint: "module-path:fixture-dependency",
        },
      ],
      descriptors: [
        {
          path: "app/src/main/java/module-info.java",
          moduleName: "example.app",
          open: false,
          requires: [{ moduleName: "java.sql", modifiers: ["transitive"] }],
          exports: [{ packageName: "example.app.api", targets: ["consumer.app"] }],
          opens: [{ packageName: "example.app.internal", targets: ["spring.core"] }],
          uses: ["example.app.spi.Service"],
          provides: [
            {
              serviceType: "example.app.spi.Service",
              implementations: ["example.app.internal.ServiceImpl"],
            },
          ],
          unreportedDirectives: [],
          contentSha256: "f".repeat(64),
        },
      ],
      refusalCode: null,
    };
    const normalized = normalizeJavaProjectContext(response, request);
    expect("context" in normalized && normalized.context.schemaVersion).toBe(
      "java-project-context-v2",
    );
    if (!("context" in normalized)) throw new Error("Expected an effective context.");
    const normalizedSourceSet = normalized.context.modules[0]!.sourceSets[0]!;
    expect(normalized.context.buildEvidence).toEqual([
      {
        path: "/repository/processor.jar",
        kind: "annotation-processor",
        fingerprint: "processor-jar:current",
      },
    ]);
    expect(normalizedSourceSet.compilerOptions).toEqual([
      { name: "-parameters", value: "", origin: "pom.xml", redacted: true },
    ]);
    expect(normalizedSourceSet.resolvedArtifacts?.[0]).toEqual({
      path: "/repository/z-first-tests.jar",
      coordinates: { groupId: "example", artifactId: "first", version: "1.2.3" },
      extension: "jar",
      classifier: "tests",
      scope: "compile",
      transitive: true,
      fingerprint: "artifact:first",
    });
    expect(normalizedSourceSet.compileClasspath[1]?.artifact).toEqual({
      path: "/repository/a-second.jar",
      coordinates: { groupId: "example", artifactId: "second", version: "4.5.6" },
      extension: "jar",
      classifier: null,
      scope: "compile",
      transitive: false,
      fingerprint: "artifact:second",
    });
    expect(normalizedSourceSet.annotationProcessors).toEqual({
      availability: "complete",
      processorPath: ["/repository/processor.jar"],
      dependencies: [],
      processorNames: ["example.Processor"],
      options: { generatedPackage: "example.generated" },
      mode: "explicit",
      refusalCode: null,
    });
    expect(normalizedSourceSet.sourceRootEvidence?.[0]?.executionId).toBe("add-main-sources");
    expect(normalizedSourceSet.jpms?.availability).toBe("complete");
    expect(normalizedSourceSet.jpms?.modulePath).toEqual([
      {
        path: "/repository/fixture-dependency.jar",
        moduleNames: ["fixture.dependency"],
        fingerprint: "module-path:fixture-dependency",
      },
    ]);
    expect(normalizedSourceSet.jpms?.descriptors[0]?.opens).toEqual([
      { packageName: "example.app.internal", targets: ["spring.core"] },
    ]);
    expect(normalizedSourceSet.jpms?.descriptors[0]?.uses).toEqual(["example.app.spi.Service"]);
    expect(normalizedSourceSet.jpms?.descriptors[0]?.provides[0]?.implementations).toEqual([
      "example.app.internal.ServiceImpl",
    ]);
    expect(normalizedSourceSet.jpms?.descriptors[0]?.unreportedDirectives).toEqual([]);
  });
  it("downgrades a provider's complete JPMS fact when legacy descriptors omit module directives", () => {
    const response = javaProjectContextV2Response();
    const jpms = response.context.modules[0]!.sourceSets[0]!.jpms!;
    jpms.availability = "complete";
    jpms.descriptors = [
      {
        path: "app/src/main/java/module-info.java",
        moduleName: "example.app",
        open: false,
        requires: [],
        exports: [],
        contentSha256: "f".repeat(64),
      } as unknown as (typeof jpms.descriptors)[number],
    ];
    const normalized = normalizeJavaProjectContext(response, request);
    if (!("context" in normalized)) throw new Error("Expected an effective context.");
    const fact = normalized.context.modules[0]!.sourceSets[0]!.jpms!;
    expect(fact.availability).toBe("partial");
    expect(fact.refusalCode).toBe("java.context.jpmsDirectivesNotReported");
    expect(fact.descriptors[0]?.unreportedDirectives).toEqual(["opens", "uses", "provides"]);
    expect(fact.descriptors[0]?.opens).toEqual([]);
  });
  it("preserves a provider's JPMS descriptor-completeness refusal and supported directives", () => {
    const response = javaProjectContextV2Response();
    const jpms = response.context.modules[0]!.sourceSets[0]!.jpms!;
    jpms.availability = "partial";
    jpms.refusalCode = "java.context.jpmsDescriptorIncomplete";
    jpms.descriptors = [
      {
        path: "app/src/main/java/module-info.java",
        moduleName: "example.app",
        open: false,
        requires: [{ moduleName: "java.sql", modifiers: ["transitive"] }],
        exports: [{ packageName: "example.app.api", targets: [] }],
        opens: [{ packageName: "example.app.internal", targets: ["spring.core"] }],
        uses: ["example.app.spi.Service"],
        provides: [
          {
            serviceType: "example.app.spi.Service",
            implementations: ["example.app.internal.ServiceImpl"],
          },
        ],
        unreportedDirectives: [],
        contentSha256: "f".repeat(64),
      },
    ];

    const normalized = normalizeJavaProjectContext(response, request);
    if (!("context" in normalized)) throw new Error("Expected an effective context.");
    const fact = normalized.context.modules[0]!.sourceSets[0]!.jpms!;
    expect(fact.availability).toBe("partial");
    expect(fact.refusalCode).toBe("java.context.jpmsDescriptorIncomplete");
    expect(fact.descriptors[0]?.requires).toEqual([
      { moduleName: "java.sql", modifiers: ["transitive"] },
    ]);
    expect(fact.descriptors[0]?.opens).toEqual([
      { packageName: "example.app.internal", targets: ["spring.core"] },
    ]);
    expect(fact.descriptors[0]?.uses).toEqual(["example.app.spi.Service"]);
    expect(fact.descriptors[0]?.provides).toEqual([
      {
        serviceType: "example.app.spi.Service",
        implementations: ["example.app.internal.ServiceImpl"],
      },
    ]);
  });
  it("rejects incomplete v2 facts and invalid required-fact scopes before invocation", async () => {
    const response = javaProjectContextV2Response();
    delete response.context.modules[0]!.sourceSets[0]!.jpms;
    expect(() => normalizeJavaProjectContext(response, request)).toThrow();

    const adapter = new TauriJavaProjectContextAdapter();
    for (const invalid of [
      { ...request, requiredFacts: ["compiler-options", "compiler-options"] as never },
      { ...request, requiredFacts: ["unknown-fact"] as never },
      { ...request, moduleId: "app" },
    ])
      await expect(adapter.query(invalid as JavaProjectContextRequest)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("forwards bounded required facts for a project or selected source set", async () => {
    const projectWide: JavaProjectContextRequest = {
      ...request,
      requiredFacts: ["jpms"],
    };
    vi.mocked(invoke).mockResolvedValue(javaProjectContextV2Response(projectWide));
    await new TauriJavaProjectContextAdapter().query(projectWide);
    expect(invoke).toHaveBeenLastCalledWith("query_refactorkit_java_project_context", {
      request: projectWide,
    });

    vi.mocked(invoke).mockClear();
    const selected: JavaProjectContextRequest = {
      ...request,
      moduleId: "app",
      sourceSetId: "main",
      requiredFacts: ["compiler-options", "artifact-coordinates"],
    };
    vi.mocked(invoke).mockResolvedValue(javaProjectContextResponse(selected));
    await new TauriJavaProjectContextAdapter().query(selected);
    expect(invoke).toHaveBeenCalledWith("query_refactorkit_java_project_context", {
      request: selected,
    });
  });
  it("refuses a required JPMS fact when the provider omits module directives", async () => {
    const requestWithJpms: JavaProjectContextRequest = { ...request, requiredFacts: ["jpms"] };
    const response = javaProjectContextV2Response(requestWithJpms);
    const jpms = response.context.modules[0]!.sourceSets[0]!.jpms!;
    jpms.availability = "complete";
    jpms.descriptors = [
      {
        path: "app/src/main/java/module-info.java",
        moduleName: "example.app",
        open: false,
        requires: [],
        exports: [],
        contentSha256: "f".repeat(64),
      } as unknown as (typeof jpms.descriptors)[number],
    ];
    vi.mocked(invoke).mockResolvedValue(response);

    await expect(
      new TauriJavaProjectContextAdapter().query(requestWithJpms),
    ).resolves.toMatchObject({
      status: "refused",
      code: "java.context.requiredFactIncomplete",
    });
  });
  it("tracks only correlated project changes and stops the exact watcher on cleanup", async () => {
    let receive: ((event: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    vi.mocked(listen).mockImplementation(async (_name, callback) => {
      receive = callback as (event: { payload: unknown }) => void;
      return unlisten;
    });
    vi.mocked(invoke).mockResolvedValue(undefined);
    const changed = vi.fn();
    const authority = { workspaceId: "one", generation: 3 };
    const cleanup = await new TauriJavaProjectContextAdapter().watch(
      authority,
      "services",
      "watch-1",
      changed,
    );
    expect(invoke).toHaveBeenCalledWith("watch_refactorkit_java_project_inputs", {
      authority,
      projectPath: "services",
      watchId: "watch-1",
    });
    const event = {
      workspaceId: "one",
      generation: 3,
      projectPath: "services",
      watchId: "watch-1",
      status: "changed",
    };
    receive?.({ payload: event });
    receive?.({ payload: { ...event, generation: 4 } });
    receive?.({ payload: { ...event, projectPath: "other" } });
    receive?.({ payload: { ...event, watchId: "old-watch" } });
    receive?.({ payload: { ...event, status: "forged" } });
    expect(changed).toHaveBeenCalledExactlyOnceWith(event);
    receive?.({ payload: { ...event, changeKind: "source" } });
    receive?.({ payload: { ...event, changeKind: "buildConfiguration" } });
    receive?.({ payload: { ...event, changeKind: "unknown" } });
    receive?.({ payload: { ...event, status: "unavailable", changeKind: "source" } });
    expect(changed).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenNthCalledWith(2, { ...event, changeKind: "source" });
    expect(changed).toHaveBeenNthCalledWith(3, { ...event, changeKind: "buildConfiguration" });
    cleanup();
    cleanup();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenLastCalledWith("stop_refactorkit_java_project_watch", {
      authority,
      watchId: "watch-1",
    });
  });
  it("keeps unavailable and partial outcomes explicit without effective analysis", () => {
    const partial = normalizeJavaProjectContext(
      javaProjectContextResponse(request, "partial"),
      request,
    );
    expect(partial.status).toBe("partial");
    expect("context" in partial && partial.context.analysis).toBeNull();
    const unavailable = {
      workspaceId: "one",
      generation: 3,
      requestId: "project-1",
      projectPath: "services",
      status: "unavailable",
      code: "unsupported",
      message: "Provider absent",
    };
    expect(normalizeJavaProjectContext(unavailable, request)).toEqual(unavailable);
  });
  it("rejects crossed authority, stale evidence, missing analysis, classpath owners and execution policy", () => {
    const good = javaProjectContextResponse(request);
    for (const mutate of [
      (v: typeof good) => {
        v.workspaceId = "other";
      },
      (v: typeof good) => {
        v.generation++;
      },
      (v: typeof good) => {
        v.requestId = "old";
      },
      (v: typeof good) => {
        v.projectPath = "other";
      },
      (v: typeof good) => {
        v.context.schemaVersion = "unknown" as never;
      },
      (v: typeof good) => {
        v.context.analysis = null;
      },
      (v: typeof good) => {
        v.context.analysis!.snapshotHash = "f".repeat(64);
      },
      (v: typeof good) => {
        v.context.providers[0].providerId = "gradle-declarative-v1";
      },
      (v: typeof good) => {
        v.context.providers[0].networkAccess = "anonymous-opt-in";
      },
      (v: typeof good) => {
        v.context.modules[0].sourceSets[0].compileClasspath[0].moduleId = "unrelated";
      },
      (v: typeof good) => {
        v.context.modules[0].sourceSets[0].sourceRoots = ["../outside"];
      },
    ]) {
      const bad = structuredClone(good);
      mutate(bad);
      expect(() => normalizeJavaProjectContext(bad, request)).toThrow("Invalid or uncorrelated");
    }
    expect(() =>
      normalizeJavaProjectContext(good, { ...request, expectedContextHash: "f".repeat(64) }),
    ).toThrow();
    expect(() =>
      normalizeJavaProjectContext(good, { ...request, expectedSnapshotHash: "f".repeat(64) }),
    ).toThrow();
  });
  it("requires source association to match the selected source root, scope and type", () => {
    const selected = {
      ...request,
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
      symbol: "pkg.Peer",
    };
    const good = javaProjectContextResponse(selected);
    expect(normalizeJavaProjectContext(good, selected).status).toBe("available");
    for (const mutate of [
      (v: typeof good) => {
        v.context.selectedSource!.path = "app/src/test/java/pkg/Runner.java";
      },
      (v: typeof good) => {
        v.context.selectedSource!.symbol = "pkg.Unrelated";
      },
      (v: typeof good) => {
        v.context.selectedSource!.sourceSetId = "test";
      },
      (v: typeof good) => {
        v.context.selectedSource!.sourceRoot = "app/src/test/java";
      },
    ]) {
      const bad = structuredClone(good);
      mutate(bad);
      expect(() => normalizeJavaProjectContext(bad, selected)).toThrow();
    }
  });
  it("rejects legacy source associations when provider-scoped module IDs collide", () => {
    const selected = {
      ...request,
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
      symbol: "pkg.Peer",
    };
    const ambiguous = javaProjectContextResponse(selected);
    ambiguous.context.providers.push({
      providerId: "gradle-effective-v1",
      status: "available",
      strategy: "gradle-evaluated-v1",
      buildCodeExecution: "denied",
      credentialsAccess: "denied",
      networkAccess: "denied",
      diagnostics: [],
    });
    const duplicate = structuredClone(ambiguous.context.modules[0]!);
    duplicate.providerId = "gradle-effective-v1";
    for (const sourceSet of duplicate.sourceSets)
      for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath])
        entry.providerId = duplicate.providerId;
    ambiguous.context.modules.push(duplicate);

    expect(() => normalizeJavaProjectContext(ambiguous, selected)).toThrow(
      "Invalid or uncorrelated Java project context.",
    );
  });
  it("uses the v3 selected provider to resolve colliding module and source-set IDs", () => {
    const selected = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
      symbol: "pkg.Peer",
      gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
    };
    const qualified = javaProjectContextV3Response(selected);
    Object.assign(qualified, {
      gradleSync: {
        schemaVersion: "java-gradle-sync-v1",
        status: "synchronized",
        providerId: "gradle-effective-v1",
        snapshotHash: "a".repeat(64),
        gradleVersion: "9.8",
        sdkHome: selected.sdkHome,
      },
    });
    qualified.context.providers.push({
      providerId: "gradle-effective-v1",
      status: "available",
      strategy: "gradle-evaluated-v1",
      buildCodeExecution: "denied",
      credentialsAccess: "denied",
      networkAccess: "denied",
      diagnostics: [],
    });
    const duplicate = structuredClone(qualified.context.modules[0]!);
    duplicate.providerId = "gradle-effective-v1";
    duplicate.buildRoot = ".";
    duplicate.projectPath = ":app";
    for (const sourceSet of duplicate.sourceSets)
      for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath])
        entry.providerId = duplicate.providerId;
    qualified.context.modules.push(duplicate);

    const normalized = normalizeJavaProjectContext(qualified, selected);
    expect("context" in normalized && normalized.context.selectedSource?.providerId).toBe(
      "maven-effective-v1",
    );

    const wrongProvider = structuredClone(qualified);
    wrongProvider.context.selectedSource!.providerId = "gradle-effective-v1";
    expect(() => normalizeJavaProjectContext(wrongProvider, selected)).toThrow();
    expect(() =>
      normalizeJavaProjectContext(qualified, { ...selected, providerId: undefined }),
    ).toThrow();
  });
  it("preserves Gradle composite identity without deriving module roots from logical paths", () => {
    const selected = {
      ...request,
      providerId: "gradle-effective-v1",
      moduleId: "gradle-aaa::lib",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
      gradle: { executable: "/gradle", userHome: "/cache", projectProperties: {} },
    };
    const composite = javaProjectContextV3Response(selected);
    composite.gradleSync = {
      schemaVersion: "java-gradle-sync-v1",
      status: "synchronized",
      snapshotHash: composite.context.snapshotHash,
      providerId: "gradle-effective-v1",
      gradleVersion: "9.8.0",
      sdkHome: selected.sdkHome,
    };
    composite.context.providers[0] = {
      ...composite.context.providers[0]!,
      providerId: "gradle-effective-v1",
      strategy: "gradle-evaluated-v1",
    };
    const first = composite.context.modules[0]!;
    first.providerId = "gradle-effective-v1";
    first.id = "gradle-aaa::lib";
    first.name = "lib";
    first.buildRoot = ".";
    first.projectPath = ":lib";
    first.root = "custom/project-one";
    const sourceSet = first.sourceSets[0]!;
    sourceSet.sourceRoots = ["shared/src/main/java"];
    sourceSet.analysisSourceRoots = sourceSet.sourceRoots;
    sourceSet.generatedSourceRoots = ["shared/generated/java"];
    sourceSet.outputDirectories = ["outputs/project-one/classes"];
    for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath]) {
      entry.providerId = first.providerId;
      entry.moduleId = first.id;
    }
    sourceSet.runtimeClasspath[0]!.path = sourceSet.outputDirectories[0]!;
    composite.context.selectedSource = {
      ...composite.context.selectedSource!,
      providerId: "gradle-effective-v1",
      moduleId: first.id,
      path: "shared/src/main/java/pkg/Runner.java",
      sourceRoot: "shared/src/main/java",
    };

    const included = structuredClone(first);
    included.id = "gradle-bbb::lib";
    included.buildRoot = "included-build";
    included.projectPath = ":lib";
    included.root = "shared/custom-project-two";
    included.sourceSets[0]!.sourceRoots = ["shared/src/second/java"];
    composite.context.modules.push(included);

    const normalized = normalizeJavaProjectContext(composite, selected);
    expect(
      "context" in normalized &&
        normalized.context.modules.map(({ buildRoot, projectPath, root }) => ({
          buildRoot,
          projectPath,
          root,
        })),
    ).toEqual([
      { buildRoot: ".", projectPath: ":lib", root: "custom/project-one" },
      { buildRoot: "included-build", projectPath: ":lib", root: "shared/custom-project-two" },
    ]);

    const duplicateBuildPath = structuredClone(composite);
    duplicateBuildPath.context.modules[1]!.buildRoot = ".";
    expect(() => normalizeJavaProjectContext(duplicateBuildPath, selected)).toThrow();

    const escapingBuildRoot = structuredClone(composite);
    escapingBuildRoot.context.modules[1]!.buildRoot = "../outside";
    expect(() => normalizeJavaProjectContext(escapingBuildRoot, selected)).toThrow();
  });
  it("refuses provider-qualified Gradle modules without composite identity", () => {
    const selected = {
      ...request,
      providerId: "gradle-effective-v1",
      moduleId: "gradle-aaa::app",
      sourceSetId: "main",
      gradle: { executable: "/gradle", userHome: "/cache", projectProperties: {} },
    };
    const qualified = javaProjectContextV3Response(selected);
    qualified.gradleSync = {
      schemaVersion: "java-gradle-sync-v1",
      status: "synchronized",
      snapshotHash: qualified.context.snapshotHash,
      providerId: "gradle-effective-v1",
      gradleVersion: "9.8.0",
      sdkHome: selected.sdkHome,
    };
    qualified.context.providers[0] = {
      ...qualified.context.providers[0]!,
      providerId: "gradle-effective-v1",
      strategy: "gradle-evaluated-v1",
    };
    const module = qualified.context.modules[0]!;
    module.providerId = "gradle-effective-v1";
    module.id = selected.moduleId!;
    module.buildRoot = ".";
    module.projectPath = ":app";
    for (const sourceSet of module.sourceSets) {
      sourceSet.compileClasspath = [];
      sourceSet.runtimeClasspath = [];
      sourceSet.moduleDependencies = [];
    }

    for (const field of ["buildRoot", "projectPath"] as const) {
      const missingIdentity = structuredClone(qualified);
      delete missingIdentity.context.modules[0]![field];
      expect(() => normalizeJavaProjectContext(missingIdentity, selected)).toThrow(
        "Gradle project context is missing the build root or logical project path required to identify this module.",
      );
    }

    const includedBuild = structuredClone(qualified);
    const includedModule = structuredClone(includedBuild.context.modules[0]!);
    includedModule.id = "gradle-bbb::library";
    includedModule.name = "library";
    includedModule.root = "included-build";
    includedModule.buildRoot = "included-build";
    includedModule.projectPath = ":library";
    for (const sourceSet of includedModule.sourceSets) {
      sourceSet.sourceRoots = ["included-build/src/main/java"];
      sourceSet.analysisSourceRoots = sourceSet.sourceRoots;
      sourceSet.generatedSourceRoots = [];
      sourceSet.outputDirectories = ["included-build/build/classes/java/main"];
      sourceSet.compileClasspath = [];
      sourceSet.runtimeClasspath = [];
      sourceSet.moduleDependencies = [];
    }
    includedBuild.context.modules.push(includedModule);
    expect(normalizeJavaProjectContext(includedBuild, selected).status).toBe("available");

    for (const field of ["buildRoot", "projectPath"] as const) {
      const missingIncludedIdentity = structuredClone(includedBuild);
      delete missingIncludedIdentity.context.modules[1]![field];
      expect(() => normalizeJavaProjectContext(missingIncludedIdentity, selected)).toThrow(
        "Gradle project context is missing the build root or logical project path required to identify this module.",
      );
    }
  });
  it("requires a provider-qualified selector for the v3 response and rejects unpaired requests", async () => {
    const selected = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
    };
    expect(() =>
      normalizeJavaProjectContext(javaProjectContextV3Response(selected), request),
    ).toThrow();
    const adapter = new TauriJavaProjectContextAdapter();
    await expect(adapter.query({ ...request, providerId: "maven-effective-v1" })).rejects.toThrow();
    await expect(
      adapter.query({ ...request, providerId: "maven-effective-v1", moduleId: "app" }),
    ).rejects.toThrow();
  });
  it("validates the selected provider/module/source-set scope even without a file selector", () => {
    const selected = {
      ...request,
      providerId: "maven-effective-v1",
      moduleId: "app",
      sourceSetId: "main",
      gradle: { executable: "/gradle", userHome: "", projectProperties: {} },
    };
    const qualified = javaProjectContextV3Response(selected);
    Object.assign(qualified, {
      gradleSync: {
        schemaVersion: "java-gradle-sync-v1",
        status: "synchronized",
        providerId: "gradle-effective-v1",
        snapshotHash: "a".repeat(64),
        gradleVersion: "9.8",
        sdkHome: selected.sdkHome,
      },
    });
    qualified.context.providers.push({
      providerId: "gradle-effective-v1",
      status: "available",
      strategy: "gradle-evaluated-v1",
      buildCodeExecution: "denied",
      credentialsAccess: "denied",
      networkAccess: "denied",
      diagnostics: [],
    });
    const duplicate = structuredClone(qualified.context.modules[0]!);
    duplicate.providerId = "gradle-effective-v1";
    duplicate.buildRoot = ".";
    duplicate.projectPath = ":app";
    for (const sourceSet of duplicate.sourceSets)
      for (const entry of [...sourceSet.compileClasspath, ...sourceSet.runtimeClasspath])
        entry.providerId = duplicate.providerId;
    qualified.context.modules.push(duplicate);
    expect(normalizeJavaProjectContext(qualified, selected).status).toBe("available");

    const mismatched = structuredClone(qualified);
    mismatched.context.modules = mismatched.context.modules.filter(
      (module) => module.providerId !== "maven-effective-v1",
    );
    expect(() => normalizeJavaProjectContext(mismatched, selected)).toThrow();

    const ambiguousLegacy = structuredClone(qualified);
    ambiguousLegacy.context.schemaVersion = "java-project-context-v2";
    expect(() =>
      normalizeJavaProjectContext(ambiguousLegacy, {
        ...selected,
        providerId: undefined,
      }),
    ).toThrow();
  });
  it("rejects a source association that was not requested", () => {
    const selected = {
      ...request,
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
      symbol: "pkg.Peer",
    };
    const response = javaProjectContextResponse(selected);

    expect(() => normalizeJavaProjectContext(response, request)).toThrow(
      "Invalid or uncorrelated Java project context.",
    );
  });
  it("validates the source root against the module that owns its source set", () => {
    const selected = {
      ...request,
      moduleId: "app",
      sourceSetId: "main",
      sourceRelativePath: "pkg/Runner.java",
      symbol: "pkg.Peer",
    };
    const response = javaProjectContextResponse(selected, "partial");
    const integration = structuredClone(response.context.modules[0]!);
    integration.providerId = "maven-effective-v1";
    integration.sourceSets[0]!.id = "integration";
    integration.sourceSets[0]!.sourceRoots = ["app/src/integration/java"];
    integration.sourceSets[0]!.outputDirectories = ["app/target/integration-classes"];
    for (const entry of [
      ...integration.sourceSets[0]!.compileClasspath,
      ...integration.sourceSets[0]!.runtimeClasspath,
    ]) {
      entry.providerId = integration.providerId;
      entry.sourceSetId = "integration";
    }
    response.context.providers.push({
      ...response.context.providers[0]!,
      providerId: integration.providerId,
    });
    response.context.modules.unshift(integration);

    expect(normalizeJavaProjectContext(response, selected).status).toBe("partial");
  });
});
