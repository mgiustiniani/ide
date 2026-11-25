import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefactorKitCapabilities, RefactorKitStatus, WorkspaceInfo } from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import type { JavaProjectScaffoldPort } from "@ide/web-core";
import { JavaProjectModelPanel } from "./JavaProjectModelPanel";
import {
  useJavaProjectModelController,
  type JavaProjectModelController,
  type UseJavaProjectModelControllerDependencies,
} from "./useJavaProjectModelController";
import type { JavaProjectContextController } from "./useJavaProjectContextController";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";

const workspace: WorkspaceInfo = {
  id: "workspace-one",
  name: "Sample",
  rootPath: "/workspace/sample",
};

const status: RefactorKitStatus = { available: true };

const capabilities: RefactorKitCapabilities = {
  api: "RefactorKit",
  apiVersion: "0.3",
  provider: "engine",
  providerVersion: "0.7.0-SNAPSHOT",
  javaImportExternalClass: {
    supported: false,
    targetDirectory: false,
    preview: false,
    apply: false,
    rollback: false,
    stability: "experimental",
  },
  operationalSurface: ["scan", "symbols"],
} as RefactorKitCapabilities & { operationalSurface: string[] };

function oversizedSymbolsStdout(entryCount: number): string {
  return Array.from(
    { length: entryCount },
    (_, index) =>
      `CLASS\tcom.example.Class${index}\t/workspace/sample/Class${index}.java:${index + 1}`,
  ).join("\n");
}

/**
 * Renders the real controller hook against a stub RefactorKit port, performs
 * the user-initiated refresh, and returns the settled controller for panel
 * rendering. The engine result is the only symbol source; nothing is mocked
 * into a fake model.
 */
async function renderControllerPanel(symbolsStdout: string): Promise<JavaProjectModelController> {
  const refactorKit = {
    scan: vi.fn(async () => ({
      stdout: "",
      stderr: "",
      locations: [],
      success: true,
      code: 0,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      command: ["refactorkit", "scan", "/workspace/sample"],
    })),
    symbols: vi.fn(async () => ({
      stdout: symbolsStdout,
      stderr: "",
      locations: [],
      success: true,
      code: 0,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      command: ["refactorkit", "symbols", "/workspace/sample"],
    })),
  } as unknown as RefactorKitPort;
  const dependencies: UseJavaProjectModelControllerDependencies = {
    refactorKit,
    status,
    capabilities,
    isCheckingCapabilities: false,
    workspaceInfo: workspace,
    workspaceGeneration: 1,
    getWorkspaceContext: () => ({
      generation: 1,
      workspaceId: workspace.id,
      isSwitching: false,
      isMetadataLoading: false,
    }),
  };
  const hook = renderHook(
    (current: UseJavaProjectModelControllerDependencies) => useJavaProjectModelController(current),
    { initialProps: dependencies },
  );
  let controller: JavaProjectModelController = hook.result.current;
  await act(async () => {
    controller = hook.result.current;
    await controller.refresh();
  });
  controller = hook.result.current;
  return controller;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JavaProjectModelPanel", () => {
  it("keeps metadata-only context usable for file ownership while disabling symbol analysis", async () => {
    const controller = await renderControllerPanel("");
    const response = javaProjectContextResponse({
      projectPath: "",
      sdkHome: "/jdk-27",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
      workspaceId: workspace.id,
      generation: 1,
      requestId: "metadata-only-v6",
    });
    response.context.schemaVersion = "java-project-context-v7";
    response.context.analysis = null;
    response.context.selectedSource = null;
    response.context.semanticAnalysis = {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    };
    const contextController = {
      settings: {
        projectPath: "",
        sdkHome: "/jdk-27",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: response.context,
      engineVersion: "0.8.0",
      isBusy: false,
      error: null,
      message: null,
      setSettings: vi.fn(),
      synchronize: vi.fn(),
      evaluateGradle: vi.fn(),
      inspectSource: vi.fn(),
      inspectJpms: vi.fn(),
      cancel: vi.fn(),
      retireContext: vi.fn(),
      refreshForExecution: vi.fn(),
    } as unknown as JavaProjectContextController;

    render(
      <JavaProjectModelPanel
        controller={controller}
        contextController={contextController}
        refactorKitCapabilities={
          {
            methods: [
              {
                name: "project.context.v7",
                requiresProject: true,
                writesWorkspace: false,
                features: {
                  typedSchemaV7: true,
                  providerQualifiedSourceAssociation: true,
                },
              },
            ],
          } as never
        }
      />,
    );

    expect(
      screen.getByText(/Project metadata is available for build, run and tests/),
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("pkg/Runner.java"), {
      target: { value: "pkg/Runner.java" },
    });
    const inspectSource = screen.getByRole("button", {
      name: "Resolve source ownership",
    });
    expect(inspectSource).toHaveProperty("disabled", false);
    expect(
      screen.getByText(
        "Java symbol analysis is unavailable. Clear the optional type field to inspect source-file ownership by path.",
      ),
    ).toBeTruthy();
    fireEvent.click(inspectSource);
    expect(contextController.inspectSource).toHaveBeenCalledWith(
      "maven-effective-v1",
      "app",
      "main",
      "pkg/Runner.java",
      "",
    );
    fireEvent.change(screen.getByPlaceholderText("pkg.Runner"), {
      target: { value: "pkg.Runner" },
    });
    expect(inspectSource).toHaveProperty("disabled", true);
  });

  it("keeps v6 metadata-only source ownership disabled even with a path", async () => {
    const controller = await renderControllerPanel("");
    const response = javaProjectContextResponse({
      projectPath: "",
      sdkHome: "/jdk-27",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
      workspaceId: workspace.id,
      generation: 1,
      requestId: "metadata-only-v6-source-owner",
    });
    response.context.schemaVersion = "java-project-context-v6";
    response.context.analysis = null;
    response.context.selectedSource = null;
    response.context.semanticAnalysis = {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    };
    const inspectSource = vi.fn();
    const contextController = {
      settings: {
        projectPath: "",
        sdkHome: "/jdk-27",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: response.context,
      engineVersion: "0.8.0",
      isBusy: false,
      error: null,
      message: null,
      setSettings: vi.fn(),
      synchronize: vi.fn(),
      evaluateGradle: vi.fn(),
      inspectSource,
      inspectJpms: vi.fn(),
      cancel: vi.fn(),
      retireContext: vi.fn(),
      refreshForExecution: vi.fn(),
    } as unknown as JavaProjectContextController;

    render(
      <JavaProjectModelPanel
        controller={controller}
        contextController={contextController}
        refactorKitCapabilities={
          {
            methods: [
              {
                name: "project.context.v6",
                requiresProject: true,
                writesWorkspace: false,
                features: {
                  typedSchemaV6: true,
                  providerQualifiedSourceAssociation: true,
                },
              },
            ],
          } as never
        }
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("pkg/Runner.java"), {
      target: { value: "pkg/Runner.java" },
    });
    const inspect = screen.getByRole("button", { name: "Resolve source ownership" });
    expect(inspect).toHaveProperty("disabled", true);
    expect(
      screen.getByText(
        "Source-file ownership and Java analysis are unavailable for this metadata-only context.",
      ),
    ).toBeTruthy();
    fireEvent.click(inspect);
    expect(inspectSource).not.toHaveBeenCalled();
  });

  it("connects the Java project panel to the workspace-scoped Maven scaffold port", async () => {
    const controller = await renderControllerPanel("");
    const contextController: JavaProjectContextController = {
      reviewForSourceNavigation: vi.fn(),
      settings: {
        projectPath: "",
        sdkHome: "/jdk",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: null,
      engineVersion: null,
      isBusy: false,
      error: null,
      message: null,
      setSettings: vi.fn(),
      applyLanguageSettings: vi.fn(async () => null),
      retireContext: vi.fn(),
      pauseMonitoring: vi.fn(async () => {}),
      synchronize: vi.fn(async () => {}),
      refreshForExecution: vi.fn(async () => {
        throw new Error("not used");
      }),
      evaluateGradle: vi.fn(async () => {}),
      inspectSource: vi.fn(async () => {}),
      inspectJpms: vi.fn(async () => {}),
      cancel: vi.fn(),
    };
    const scaffoldPort: JavaProjectScaffoldPort = {
      createProject: vi.fn(async (request) => ({
        workspaceId: request.workspaceId,
        generation: request.generation,
        requestId: request.requestId,
        projectPath: request.artifactId,
      })),
    };
    const onProjectCreated = vi.fn(async () => {});
    render(
      <JavaProjectModelPanel
        controller={controller}
        contextController={contextController}
        workspaceId={workspace.id}
        generation={2}
        scaffoldPort={scaffoldPort}
        getWorkspaceContext={() => ({
          workspaceId: workspace.id,
          generation: 2,
          isSwitching: false,
          isMetadataLoading: false,
        })}
        onProjectCreated={onProjectCreated}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New Maven project" }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(scaffoldPort.createProject).toHaveBeenCalledOnce());
    expect(scaffoldPort.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ buildSystem: "maven" }),
    );
    expect(onProjectCreated).toHaveBeenCalledWith("my-java-app", {
      workspaceId: workspace.id,
      generation: 2,
    });
    fireEvent.click(screen.getByRole("button", { name: "New Gradle project" }));
    expect(screen.getByRole("heading", { name: "New Gradle Java project" })).toBeTruthy();
  });

  it("AC-001: renders the honest truncation state when the engine result exceeds the bounded symbol list", async () => {
    const controller = await renderControllerPanel(oversizedSymbolsStdout(520));

    expect(controller.availability).toBe("available");
    expect(controller.model?.symbols).toHaveLength(500);
    expect(controller.totalSymbolCount).toBe(520);
    expect(controller.presentedSymbolsTruncated).toBe(true);

    render(<JavaProjectModelPanel controller={controller} />);
    expect(screen.getByText(/Symbols \(500 of 520\)/)).toBeTruthy();
    const indicator = screen.getByTestId("java-project-model-symbols-truncation");
    expect(indicator.textContent).toContain("Showing 500 of 520 symbols");
  });

  it("AC-001: renders only the presented count without a truncation indicator when the result fits the bounded list", async () => {
    const controller = await renderControllerPanel(
      "CLASS\tcom.example.Widget\t/workspace/sample/Widget.java:3\n" +
        "METHOD\tcom.example.Widget.render\t/workspace/sample/Widget.java:9",
    );

    expect(controller.availability).toBe("available");
    expect(controller.model?.symbols).toHaveLength(2);
    expect(controller.totalSymbolCount).toBe(2);
    expect(controller.presentedSymbolsTruncated).toBe(false);

    render(<JavaProjectModelPanel controller={controller} />);
    expect(screen.getByText(/Symbols \(2\)/)).toBeTruthy();
    expect(screen.queryByTestId("java-project-model-symbols-truncation")).toBeNull();
  });

  it("opens class and member rows at their engine-reported source locations", async () => {
    const controller = await renderControllerPanel(
      "CLASS\tcom.example.Widget\t/workspace/sample/Widget.java:3\n" +
        "METHOD\tcom.example.Widget.render\t/workspace/sample/Widget.java:9",
    );
    const onNavigateLocation = vi.fn();

    render(
      <JavaProjectModelPanel controller={controller} onNavigateLocation={onNavigateLocation} />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open type com.example.Widget at /workspace/sample/Widget.java:3",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open symbol com.example.Widget.render at /workspace/sample/Widget.java:9",
      }),
    );

    expect(onNavigateLocation).toHaveBeenNthCalledWith(1, {
      path: "/workspace/sample/Widget.java",
      line: 3,
      column: 1,
    });
    expect(onNavigateLocation).toHaveBeenNthCalledWith(2, {
      path: "/workspace/sample/Widget.java",
      line: 9,
      column: 1,
    });
  });

  it("offers Encapsulate only for a provider-reported field and forwards its exact identity", async () => {
    const controller = await renderControllerPanel(
      "FIELD\tcom.example.Widget#size\t/workspace/sample/src/main/java/example/Widget.java:7",
    );
    const canEncapsulateField = vi.fn(() => true);
    const onEncapsulateField = vi.fn();
    const { rerender } = render(
      <JavaProjectModelPanel
        controller={controller}
        canEncapsulateField={canEncapsulateField}
        onEncapsulateField={onEncapsulateField}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Review encapsulation of field com.example.Widget#size" }),
    );

    expect(canEncapsulateField).toHaveBeenCalledWith(controller.model!.symbols[0]);
    expect(onEncapsulateField).toHaveBeenCalledWith({
      kind: "FIELD",
      qualifiedName: "com.example.Widget#size",
      path: "/workspace/sample/src/main/java/example/Widget.java",
      line: 7,
    });

    canEncapsulateField.mockReturnValue(false);
    rerender(
      <JavaProjectModelPanel
        controller={controller}
        canEncapsulateField={canEncapsulateField}
        onEncapsulateField={onEncapsulateField}
      />,
    );
    expect(
      screen.queryByRole("button", {
        name: "Review encapsulation of field com.example.Widget#size",
      }),
    ).toBeNull();

    rerender(
      <JavaProjectModelPanel
        controller={controller}
        isWriting
        canEncapsulateField={() => true}
        onEncapsulateField={onEncapsulateField}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Review encapsulation of field com.example.Widget#size",
      }),
    ).toHaveProperty("disabled", true);
  });

  it("passes the RefactorKit package and representative source path to the reviewed move action", async () => {
    const controller = await renderControllerPanel(
      "CLASS\tcom.example.Widget\t/workspace/sample/src/main/java/example/Widget.java:3",
    );
    const onRefactorPackage = vi.fn();

    render(
      <JavaProjectModelPanel
        controller={controller}
        canRefactorPackage={() => true}
        onRefactorPackage={onRefactorPackage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review move of package com.example" }));

    expect(onRefactorPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "com.example",
        path: "/workspace/sample/src/main/java/example/Widget.java",
      }),
    );
  });

  it("offers move and safe delete only for classes approved by the supplied capability gate", async () => {
    const controller = await renderControllerPanel(
      "CLASS\tcom.example.Widget\t/workspace/sample/Widget.java:3",
    );
    const canRefactorType = vi.fn(() => true);
    const onRefactorType = vi.fn();

    const { rerender } = render(
      <JavaProjectModelPanel
        controller={controller}
        canRefactorType={canRefactorType}
        onRefactorType={onRefactorType}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review move of type com.example.Widget" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Review deletion of type com.example.Widget" }),
    );
    const type = controller.model!.classes[0]!;
    expect(onRefactorType).toHaveBeenNthCalledWith(1, "move-class", type);
    expect(onRefactorType).toHaveBeenNthCalledWith(2, "safe-delete", type);
    expect(canRefactorType).toHaveBeenCalledWith("move-class", type);
    expect(canRefactorType).toHaveBeenCalledWith("safe-delete", type);

    canRefactorType.mockImplementation(() => false);
    rerender(
      <JavaProjectModelPanel
        controller={controller}
        canRefactorType={canRefactorType}
        onRefactorType={onRefactorType}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Review move of type com.example.Widget" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review deletion of type com.example.Widget" }),
    ).toBeNull();

    rerender(
      <JavaProjectModelPanel
        controller={controller}
        isWriting
        canRefactorType={() => true}
        onRefactorType={onRefactorType}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Review move of type com.example.Widget" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: "Review deletion of type com.example.Widget" }),
    ).toHaveProperty("disabled", true);
  });

  it("offers a source-root move from the synchronized project context", async () => {
    const controller = await renderControllerPanel(
      "CLASS\tcom.example.Widget\t/workspace/sample/Widget.java:3",
    );
    const sourceRoot = "app/src/main/java";
    const contextController = {
      settings: {
        projectPath: "sample",
        sdkHome: "/jdk",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: {
        status: "available",
        snapshotHash: "a".repeat(64),
        modules: [
          {
            id: "app",
            name: "app",
            root: "app",
            sourceSets: [
              {
                id: "main",
                kind: "main",
                sourceRoots: [sourceRoot],
                generatedSourceRoots: [],
                outputDirectories: [],
                sourceLevel: 21,
                release: 21,
                compileClasspath: [],
                runtimeClasspath: [],
                moduleDependencies: [],
              },
            ],
          },
        ],
        providers: [],
        sdk: [],
        selectedSource: null,
      },
      engineVersion: "0.7.0",
      isBusy: false,
      error: null,
      message: null,
      setSettings: vi.fn(),
      synchronize: vi.fn(),
      evaluateGradle: vi.fn(),
      inspectSource: vi.fn(),
      cancel: vi.fn(),
      retireContext: vi.fn(),
      refreshForExecution: vi.fn(),
    } as unknown as JavaProjectContextController;
    const canMoveSourceRoot = vi.fn(() => true);
    const onMoveSourceRoot = vi.fn();

    render(
      <JavaProjectModelPanel
        controller={controller}
        contextController={contextController}
        canMoveSourceRoot={canMoveSourceRoot}
        onMoveSourceRoot={onMoveSourceRoot}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review move" }));
    expect(canMoveSourceRoot).toHaveBeenCalledWith(sourceRoot);
    expect(onMoveSourceRoot).toHaveBeenCalledExactlyOnceWith(sourceRoot);
  });

  it("keeps source navigation wired through the saved-source context disclosure", async () => {
    const controller = await renderControllerPanel(
      "CLASS\tcom.example.Widget\t/workspace/sample/Widget.java:3",
    );
    const onNavigateLocation = vi.fn();
    const contextController = {
      settings: {
        projectPath: "/workspace/sample",
        sdkHome: "",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: null,
      isBusy: false,
    } as unknown as JavaProjectContextController;

    render(
      <JavaProjectModelPanel
        controller={controller}
        contextController={contextController}
        onNavigateLocation={onNavigateLocation}
      />,
    );

    fireEvent.click(screen.getByText("Saved source structure"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open type com.example.Widget at /workspace/sample/Widget.java:3",
      }),
    );

    expect(onNavigateLocation).toHaveBeenCalledExactlyOnceWith({
      path: "/workspace/sample/Widget.java",
      line: 3,
      column: 1,
    });
  });

  it("presents RefactorKit v2 build facts and redacts marked compiler values", async () => {
    const controller = await renderControllerPanel("");
    const artifact = {
      path: "/repo/processor-tests.jar",
      coordinates: { groupId: "example", artifactId: "processor", version: "2.1" },
      extension: "jar",
      classifier: "tests",
      scope: "compile",
      transitive: true,
      fingerprint: "jar:processor",
    };
    const contextController = {
      settings: {
        projectPath: "sample",
        sdkHome: "/jdk",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
      },
      context: {
        schemaVersion: "java-project-context-v2",
        status: "available",
        snapshotHash: "a".repeat(64),
        contextHash: "b".repeat(64),
        semanticAnalysis: { availability: "available", refusalCode: null },
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
                sourceRoots: ["app/src/main/java"],
                generatedSourceRoots: ["app/target/generated-sources/annotations"],
                outputDirectories: [],
                analysisSourceRoots: [],
                sourceLevel: 21,
                release: 21,
                compileClasspath: [
                  {
                    path: artifact.path,
                    providerId: "maven-effective-v1",
                    moduleId: "app",
                    sourceSetId: "main",
                    dependencyScope: "compile",
                    fingerprint: artifact.fingerprint,
                    artifact,
                  },
                ],
                runtimeClasspath: [],
                moduleDependencies: [],
                sourceRootEvidence: [
                  {
                    path: "app/src/main/java",
                    origin: "build-plugin",
                    providerId: "maven-effective-v1",
                    descriptorPath: "pom.xml",
                    profileId: null,
                    pluginId: "org.codehaus.mojo:build-helper-maven-plugin",
                    executionId: "add-main-sources",
                    goal: "add-source",
                    phase: "generate-sources",
                    availability: "complete",
                  },
                ],
                compilerOptionsAvailability: "complete",
                compilerOptionsRefusalCode: null,
                compilerOptions: [
                  {
                    name: "-Asecret",
                    value: "private-value",
                    origin: "pom.xml",
                    redacted: true,
                  },
                ],
                resolvedArtifactAvailability: "complete",
                resolvedArtifactRefusalCode: null,
                resolvedArtifacts: [artifact],
                annotationProcessors: {
                  availability: "complete",
                  processorPath: [artifact.path],
                  dependencies: [artifact],
                  processorNames: ["example.Processor"],
                  options: { generatedPackage: "example.generated" },
                  mode: "explicit",
                  refusalCode: null,
                },
                jpms: {
                  availability: "complete",
                  modulePath: [
                    {
                      path: "app/target/fixture-dependency.jar",
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
                      exports: [{ packageName: "example.app", targets: [] }],
                      opens: [{ packageName: "example.app.internal", targets: ["spring.core"] }],
                      uses: ["example.app.spi.Service"],
                      provides: [
                        {
                          serviceType: "example.app.spi.Service",
                          implementations: ["example.app.internal.ServiceImpl"],
                        },
                      ],
                      unreportedDirectives: [],
                      contentSha256: "c".repeat(64),
                    },
                  ],
                  refusalCode: null,
                },
              },
            ],
          },
        ],
        buildEvidence: [],
        selectedSource: null,
        analysis: null,
        refusal: null,
      },
      engineVersion: "0.8.0",
      isBusy: false,
      error: null,
      message: null,
      setSettings: vi.fn(),
      synchronize: vi.fn(),
      evaluateGradle: vi.fn(),
      inspectSource: vi.fn(),
      cancel: vi.fn(),
      retireContext: vi.fn(),
      refreshForExecution: vi.fn(),
    } as unknown as JavaProjectContextController;
    const duplicateModule = structuredClone(contextController.context!.modules[0]!);
    duplicateModule.providerId = "gradle-effective-v1";
    duplicateModule.root = "gradle/app";
    duplicateModule.buildRoot = "gradle/included-build";
    duplicateModule.projectPath = ":app";
    contextController.context!.schemaVersion = "java-project-context-v3";
    contextController.context!.modules.push(duplicateModule);

    const panel = render(
      <JavaProjectModelPanel controller={controller} contextController={contextController} />,
    );
    const select = screen.getByLabelText("Module and source set");
    const mavenOption = screen.getByRole("option", {
      name: "Maven · app · main (main)",
    }) as HTMLOptionElement;
    expect(mavenOption).toBeTruthy();
    fireEvent.change(select, { target: { value: mavenOption.value } });
    expect(screen.getByText("app/target/generated-sources/annotations")).toBeTruthy();
    expect(
      screen.getByRole("option", {
        name: "Gradle · app · main (main) [gradle/included-build :app]",
      }),
    ).toBeTruthy();
    const gradleOption = screen.getByRole("option", {
      name: "Gradle · app · main (main) [gradle/included-build :app]",
    }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: gradleOption.value } });
    expect(gradleOption).toHaveProperty("selected", true);
    contextController.context!.modules.reverse();
    panel.rerender(
      <JavaProjectModelPanel controller={controller} contextController={contextController} />,
    );
    expect(
      screen.getByRole("option", {
        name: "Gradle · app · main (main) [gradle/included-build :app]",
      }),
    ).toHaveProperty("selected", true);
    expect(screen.getByText("Gradle build root: gradle/included-build")).toBeTruthy();
    expect(screen.getByText("Gradle project path: :app")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resolve source ownership" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByText(
        "Source ownership is unavailable because RefactorKit does not advertise provider-qualified Java source selection.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Compiler options (1)"));
    expect(screen.getByText("-Asecret [redacted]")).toBeTruthy();
    expect(screen.queryByText("-Asecret private-value")).toBeNull();
    fireEvent.click(screen.getByText("Resolved artifacts (1)"));
    expect(screen.getAllByText("jar · tests · compile · transitive")).toHaveLength(2);
    expect(screen.getAllByText("example:processor:2.1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("example.Processor").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Annotation processors (1)"));
    expect(screen.getByText("Mode: explicit")).toBeTruthy();
    expect(screen.getAllByText("/repo/processor-tests.jar").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Processor options (1)"));
    expect(screen.getByText("generatedPackage = example.generated")).toBeTruthy();
    expect(screen.getByText(/example\.app: app\/src\/main\/java\/module-info\.java/)).toBeTruthy();
    fireEvent.click(screen.getByText("Java module system · complete"));
    expect(screen.getByText("app/target/fixture-dependency.jar")).toBeTruthy();
    expect(screen.getByText("fixture.dependency")).toBeTruthy();
    expect(screen.getByText("opens example.app.internal to spring.core")).toBeTruthy();
    expect(screen.getByText("uses example.app.spi.Service")).toBeTruthy();
    expect(
      screen.getByText("provides example.app.spi.Service with example.app.internal.ServiceImpl"),
    ).toBeTruthy();
    expect(screen.getByText(/add-main-sources/)).toBeTruthy();
    expect(
      screen.queryByText(
        "Processor inputs are not fully resolved, so generated-source roots may be missing.",
      ),
    ).toBeNull();

    const annotationProcessorSummary = screen.getByText("Annotation processors (1)");
    const annotationProcessorDisclosure = annotationProcessorSummary.closest("details");
    expect(annotationProcessorDisclosure?.open).toBe(true);
    fireEvent.click(annotationProcessorSummary);
    expect(annotationProcessorDisclosure?.open).toBe(false);

    const gradleModule = contextController.context!.modules.find(
      (module) => module.providerId === "gradle-effective-v1",
    )!;
    const gradleJpms = gradleModule.sourceSets[0]!.jpms!;
    gradleJpms.availability = "partial";
    gradleJpms.refusalCode = "java.context.jpmsDirectivesNotReported";
    gradleJpms.descriptors[0]!.unreportedDirectives = ["opens", "uses", "provides"];
    panel.rerender(
      <JavaProjectModelPanel controller={controller} contextController={contextController} />,
    );
    fireEvent.click(screen.getByText("Java module system · partial"));
    expect(screen.getByText("Provider did not report: opens, uses, provides.")).toBeTruthy();

    gradleModule.sourceSets[0]!.annotationProcessors!.availability = "unavailable";
    gradleModule.sourceSets[0]!.annotationProcessors!.refusalCode =
      "java.context.annotationProcessorPathUnavailable";
    panel.rerender(
      <JavaProjectModelPanel controller={controller} contextController={contextController} />,
    );
    const processorWarning = screen.getByText(
      "Processor inputs are not fully resolved, so generated-source roots may be missing.",
    );
    expect(processorWarning.closest("details")).toBeNull();
    fireEvent.click(screen.getByText("Annotation processors (1)"));
    expect(
      processorWarning,
    ).toBeTruthy();
    expect(
      screen.getAllByText("unavailable · java.context.annotationProcessorPathUnavailable"),
    ).toHaveLength(2);
  });

  it("offers Gradle Add Module only when the synchronized build has one exact settings file", async () => {
    const controller = await renderControllerPanel("");
    const response = javaProjectContextResponse({
      projectPath: "",
      sdkHome: "/jdk-21",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
      workspaceId: workspace.id,
      generation: 1,
      requestId: "gradle-context",
    });
    const context = response.context;
    context.schemaVersion = "java-project-context-v5";
    context.providers = [
      {
        providerId: "gradle-effective-v1",
        status: "available",
        strategy: "evaluated-model",
        buildCodeExecution: "denied",
        credentialsAccess: "denied",
        networkAccess: "denied",
        diagnostics: [],
      },
    ];
    context.modules[0]!.providerId = "gradle-effective-v1";
    context.modules[0]!.buildRoot = ".";
    context.modules[0]!.projectPath = ":app";
    context.modules[0]!.root = "app";
    context.modules[0]!.sourceSets[0]!.compileClasspath = [];
    context.modules[0]!.sourceSets[0]!.runtimeClasspath = [];
    context.buildEvidence = [
      { path: "settings.gradle.kts", kind: "declaration-file", fingerprint: "settings" },
    ];
    context.selectedSource = null;

    const contextController = {
      settings: {
        projectPath: "",
        sdkHome: "/jdk-21",
        mavenRepository: "",
        activeMavenProfiles: [],
        inactiveMavenProfiles: [],
        gradle: { executable: "/opt/gradle/bin/gradle", userHome: "", projectProperties: {} },
      },
      context,
      engineVersion: "0.8.0",
      isBusy: false,
      error: null,
      message: null,
      setSettings: vi.fn(),
      applyLanguageSettings: vi.fn(async () => null),
      retireContext: vi.fn(),
      synchronize: vi.fn(async () => {}),
      refreshForExecution: vi.fn(async () => {}),
      evaluateGradle: vi.fn(async () => {}),
      inspectSource: vi.fn(async () => {}),
      inspectJpms: vi.fn(async () => {}),
      cancel: vi.fn(),
    } as unknown as JavaProjectContextController;
    const gradleCapabilities: RefactorKitCapabilities = {
      ...capabilities,
      apiVersion: "0.2",
      methods: [
        {
          name: "project.context",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: false,
          features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
        },
        {
          name: "refactor.preview",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: false,
        },
        {
          name: "refactor.apply",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: true,
        },
        {
          name: "patch.rollback",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: true,
        },
        {
          name: "java.createGradleModule",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: false,
          features: {
            preview: true,
            renderedDiff: true,
            apply: true,
            rollback: true,
            workspaceRelativeBuildRoot: true,
            canonicalNestedProjectPath: true,
            settingsInferredDsl: true,
          },
        },
      ],
    };
    const onCreateGradleModule = vi.fn();
    const panel = render(
      <JavaProjectModelPanel
        controller={controller}
        contextController={contextController}
        refactorKitCapabilities={gradleCapabilities}
        onCreateGradleModule={onCreateGradleModule}
        workspaceId={workspace.id}
        generation={1}
      />,
    );

    expect(screen.getByRole("heading", { name: "Add Gradle module" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Workspace build" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review Add Module" }));
    expect(onCreateGradleModule).toHaveBeenCalledWith(".", "settings.gradle.kts");

    context.buildEvidence.push({
      path: "settings.gradle",
      kind: "declaration-file",
      fingerprint: "ambiguous-settings",
    });
    panel.rerender(
      <JavaProjectModelPanel
        controller={controller}
        contextController={contextController}
        refactorKitCapabilities={gradleCapabilities}
        onCreateGradleModule={onCreateGradleModule}
        workspaceId={workspace.id}
        generation={1}
      />,
    );
    expect(screen.queryByRole("heading", { name: "Add Gradle module" })).toBeNull();
  });
});

it("selects a provider-qualified Gradle module rename and hides ambiguous settings or module identities", async () => {
  const controller = await renderControllerPanel("");
  const settings = { projectPath: "", sdkHome: "/jdk-21", mavenRepository: "", activeMavenProfiles: [], inactiveMavenProfiles: [] };
  const context = javaProjectContextResponse({ ...settings, workspaceId: workspace.id, generation: 1, requestId: "gradle-rename-context" }).context;
  context.schemaVersion = "java-project-context-v5";
  context.providers = [{ providerId: "gradle-effective-v1", status: "available", strategy: "evaluated-model", buildCodeExecution: "denied", credentialsAccess: "denied", networkAccess: "denied", diagnostics: [] }];
  context.modules = [{ ...context.modules[0]!, providerId: "gradle-effective-v1", buildRoot: ".", projectPath: ":app", root: "app" }];
  context.buildEvidence = [{ path: "settings.gradle.kts", kind: "declaration-file", fingerprint: "settings" }];
  context.selectedSource = null;
  const contextController = { settings, context, isBusy: false, error: null, message: null,
    setSettings: vi.fn(), applyLanguageSettings: vi.fn(async () => null), synchronize: vi.fn(async () => {}), cancel: vi.fn() } as unknown as JavaProjectContextController;
  const c = { ...capabilities, apiVersion: "0.2", methods: [
    { name: "project.context", stability: "experimental", requiresProject: true, writesWorkspace: false, features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true } },
    { name: "refactor.preview", stability: "experimental", requiresProject: true, writesWorkspace: false },
    { name: "java.renameGradleModule", stability: "experimental", requiresProject: true, writesWorkspace: false,
      features: { preview: true, renderedDiff: true, apply: true, rollback: true, literalSettingsOnly: true, preservePhysicalProjectDirectory: true, explicitGradleSyncRequired: true, inboundProjectDependenciesRefused: true } },
  ] } as RefactorKitCapabilities;
  const onRenameGradleModule = vi.fn();
  const props = { controller, contextController, refactorKitCapabilities: c, onRenameGradleModule, workspaceId: workspace.id, generation: 1 };
  const panel = render(<JavaProjectModelPanel {...props} />);
  const supportCopy = /update supported literal project dependencies/u;
  expect(screen.queryByText(supportCopy)).toBeNull();
  const features = c.methods!.at(-1)!.features!;
  features.literalInboundProjectDependencies = true;
  features.unqualifiedInboundProjectDependenciesRefused = true;
  panel.rerender(<JavaProjectModelPanel {...props} />);
  expect(screen.queryByText(supportCopy)).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review Gradle Module Rename" }));
  expect(onRenameGradleModule).toHaveBeenCalledWith(".", "settings.gradle.kts", ":app");
  context.buildEvidence.push({ path: "settings.gradle", kind: "declaration-file", fingerprint: "second" });
  panel.rerender(<JavaProjectModelPanel {...props} />);
  expect(screen.queryByRole("button", { name: "Review Gradle Module Rename" })).toBeNull();
  context.buildEvidence.pop();
  context.modules.push({ ...context.modules[0]!, id: "second-id-same-coordinates" });
  panel.rerender(<JavaProjectModelPanel {...props} />);
  expect(screen.queryByRole("button", { name: "Review Gradle Module Rename" })).toBeNull();
});
