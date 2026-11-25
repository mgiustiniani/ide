import { reports } from "../../../../../packages/tauri-adapters/src/java-test-results.test-fixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { JavaExecutionPanel } from "./JavaExecutionPanel";
import type { JavaExecutionController } from "./useJavaExecutionController";
import { debuggerState } from "../../../../../packages/tauri-adapters/src/java-debugger-state.test-fixtures";
import { coverage } from "../../../../../packages/tauri-adapters/src/java-coverage.test-fixtures";

function controller(): JavaExecutionController {
  return {
    entryPoints: {launchProfile:"classic-declared-v1",setLaunchProfile:vi.fn(),cancel:vi.fn(),sourcePath:undefined,sourceOperation:undefined,sourceAvailable:false,available:false,pending:false,message:undefined,result:undefined,discover:vi.fn(),select:vi.fn()},
    applicationInput: { draft: "", setDraft: vi.fn(), sendLine: vi.fn(), close: vi.fn(), resume: vi.fn(),
      busy: false, error: null, hasQueue: false, pendingBytes: 0, uncertain: false, open: false,
      eof: false, acceptedBytes: 0, state: undefined, reason: undefined },
    restart: vi.fn(),
    canRestart: false,
    projectContext: undefined,
    coverageProjectContext: null,
    coverageHistory: [],
    coverageHistoryError: null,
    clearCoverageHistory: vi.fn(),
    coverageThresholds: { lines: "", branches: "", instructions: "" },
    updateCoverageThresholds: vi.fn(),
    coverageThresholdCheck: null,
    configuration: {
      buildTool: "auto",
      mainClass: "example.Main",
      classPath: [],
      projectPath: "modules/service",
      testFilter: "example.MainTest#computes",
    },
    updateConfiguration: vi.fn(),
    configurations: [
      {
        id: "default",
        name: "Default",
        configuration: { buildTool: "auto", mainClass: "example.Main", classPath: [] },
      },
    ],
    selectedConfigurationId: "default",
    selectConfiguration: vi.fn(),
    createConfiguration: vi.fn(),
    renameConfiguration: vi.fn(),
    deleteConfiguration: vi.fn(),
    sessionConfigurationName: null,
    trusted: true,
    setTrusted: vi.fn(),
    capabilities: {
      workspaceId: "one",
      generation: 1,
      projectPath: "modules/service",
      available: true,
      projectKind: "maven",
      jdk: true,
      maven: true,
      gradle: false,
      debugger: true,
      reason: null,
    },
    snapshot: null,
    flightRecordingSummary: null,
    flightRecordingAnalysisPending: false,
    canAnalyzeFlightRecording: true,
    analyzeFlightRecording: vi.fn(async () => undefined),
    flightRecordingTimeline: null,
    flightRecordingTimelinePending: false,
    canReadFlightRecordingTimeline: true,
    readFlightRecordingTimeline: vi.fn(async () => undefined),
    error: null,
    pending: false,
    classReloadPending: false,
    classReloadBuild: null,
    buildAndReloadClasses: vi.fn(async () => undefined),
    buildAndReviewClasses: vi.fn(async () => undefined),
    reloadClasses: vi.fn(async () => undefined),
    running: false,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    rerunFailed: vi.fn(async () => undefined),
    runDiscovered: vi.fn(async () => undefined),
    debugCommand: vi.fn(async () => undefined),
    debugAction: vi.fn(async () => undefined),
    stepFilterText: "",
    setStepFilterText: vi.fn(),
  };
}
describe("Java execution panel", () => {
  it("presents explicit launcher profiles, inherited owners and excluded construction", async () => {
    const { javaProjectContextResponse } = await import("../../../../../tests/story/fixtures/java-project-context-response");
    const { modernEntryPointRequest, modernEntryPointResult } = await import("../../../../../packages/tauri-adapters/src/java-entry-point-v2.test-fixtures");
    const current = controller(), settings = modernEntryPointRequest.projectContext;
    const context = javaProjectContextResponse({ ...settings, workspaceId: "one", generation: 1, requestId: "modern" }).context;
    context.modules[0].id = modernEntryPointRequest.scope.moduleId;
    current.projectContext = { settings, context, getSettings: () => settings, refresh: async () => context };
    current.configuration = { ...current.configuration, projectModule: modernEntryPointRequest.scope };
    current.entryPoints.available = true;
    current.entryPoints.launchProfile = "java25-v1";
    current.entryPoints.result = modernEntryPointResult;
    render(<JavaExecutionPanel controller={current} />);
    fireEvent.change(screen.getByLabelText("Launcher discovery rules"), { target: { value: "inherited-v1" } });
    expect(current.entryPoints.setLaunchProfile).toHaveBeenCalledWith("inherited-v1");
    expect(screen.getByText(/instance main\(\)/)).toBeInTheDocument();
    expect(screen.getByText(/inherited from demo.Parent/)).toBeInTheDocument();
    expect(screen.getByLabelText("Main types that cannot be constructed")).toHaveTextContent("demo.AbstractMain");
    expect(screen.getByText(/Complete for the qualified profile/)).toBeInTheDocument();
  });
  it("uses the declared JDK provider and main source-set kind despite outer build detection", async () => {
    const { javaProjectContextResponse } = await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = { projectPath: "plain", sdkHome: "/project-jdk", mavenRepository: "", activeMavenProfiles: [], inactiveMavenProfiles: [] };
    const context = javaProjectContextResponse({ ...settings, workspaceId: "one", generation: 1, requestId: "declared" }).context;
    const module = context.modules[0]!;
    module.providerId = "java-declared-v1";
    module.sourceSets = [{ ...module.sourceSets[0]!, id: "application", kind: "main" }];
    current.projectContext = { settings, context, getSettings: () => settings, refresh: async () => context };
    current.configuration = { ...current.configuration, projectModule: { providerId: module.providerId, moduleId: module.id, sourceSetId: "application" } };
    current.capabilities = { ...current.capabilities!, projectKind: "maven", maven: false, gradle: false };
    render(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("option", { name: "JDK · app / application" })).toBeInTheDocument();
    expect(screen.getByText(/Compilation dependencies come from the Java project declaration/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Plain-JDK test framework"), { target: { value: "testng" } });
    expect(current.updateConfiguration).toHaveBeenCalledWith(expect.objectContaining({ testFramework: "testng" }));
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run tests with coverage" })).toBeDisabled();
  });
  it("opens reported source lines, displays tool columns, and blocks actions during replacement execution", () => {
    const value = controller();
    const item = { path: "library/src/Main.java", line: 7, reportedColumn: 12, severity: "error" as const, message: "cannot find symbol" };
    value.snapshot = { workspaceId: "one", generation: 1, sessionId: "build", operation: "build", state: "failed", exitCode: 1,
      output: "error", outputTruncated: true, compilerDiagnostics: { items: [item], truncated: true } };
    const open = vi.fn();
    const view = render(<JavaExecutionPanel controller={value} onOpenCompilerSource={open} />);
    expect(screen.getByText("Tool column 12", { exact: false })).toBeDefined();
    expect(screen.getByText(/Some output locations may be omitted/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "library/src/Main.java:7 · error" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(item);
    value.pending = true;
    view.rerender(<JavaExecutionPanel controller={value} onOpenCompilerSource={open} />);
    expect(screen.getByRole("button", { name: "library/src/Main.java:7 · error" })).toBeDisabled();
    value.pending = false;
    value.snapshot = null;
    view.rerender(<JavaExecutionPanel controller={value} onOpenCompilerSource={open} />);
    expect(screen.queryByRole("region", { name: "Reported compiler locations" })).toBeNull();
  });
  it.each([
    ["gradle", "jdk", true],
    ["maven", "jdk", true],
    ["jdk", "gradle", false],
  ] as const)("offers coverage for %s discovery after switching to %s", (captured, visible, supported) => {
    const value = controller();
    value.configuration = { ...value.configuration, buildTool: visible };
    value.snapshot = {
      workspaceId: "one", generation: 1, sessionId: "discovery", operation: "discover",
      state: "succeeded", exitCode: 0, output: "", outputTruncated: false,
      testDiscovery: {
        status: "ready", buildTool: captured, projectPath: "app",
        scope: captured === "gradle" ? "test-task" : "engines", message: null,
        tests: [{ id: "case", kind: "class", className: "CaseTest", methodName: null, label: "CaseTest" }],
      },
    };
    render(<JavaExecutionPanel controller={value} />);
    const action = screen.queryByRole("button", { name: "Cover class CaseTest" });
    if (supported) {
      expect(action).toBeEnabled();
      fireEvent.click(action!);
      expect(value.runDiscovered).toHaveBeenCalledWith("case", true);
    } else {
      expect(action).toBeNull();
    }
  });
  it("resets discovery search and kind filtering for a new completed discovery session", () => {
    const value = controller();
    value.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "first",
      operation: "discover",
      state: "succeeded",
      output: "",
      outputTruncated: false,
      exitCode: 0,
      testDiscovery: {
        status: "ready",
        projectPath: "",
        buildTool: "maven",
        scope: "engines",
        message: null,
        tests: [
          {
            id: "class",
            kind: "class",
            className: "CaseTest",
            methodName: null,
            label: "CaseTest",
          },
        ],
      },
    };
    const view = render(<JavaExecutionPanel controller={value} />);
    fireEvent.change(screen.getByLabelText("Search discovered tests"), {
      target: { value: "missing" },
    });
    fireEvent.change(screen.getByLabelText("Discovered test kind"), {
      target: { value: "method" },
    });
    expect(screen.getByText(/No matching discovered tests/)).toBeVisible();
    value.snapshot = { ...value.snapshot, sessionId: "second" };
    view.rerender(<JavaExecutionPanel controller={value} />);
    expect(screen.getByLabelText("Search discovered tests")).toHaveValue("");
    expect(screen.getByLabelText("Discovered test kind")).toHaveValue("all");
    expect(screen.getByText(/Showing 1–1 of 1/)).toBeVisible();
  });
  it("starts a new execution with an unfiltered test result view", () => {
    const value = controller();
    value.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "first",
      operation: "test",
      state: "succeeded",
      output: "",
      outputTruncated: false,
      exitCode: 0,
      testResults: {
        status: "ready",
        projectPath: "modules/service",
        buildTool: "maven",
        unchangedReports: 0,
        message: null,
        canRerunFailed: false,
        rerunReason: null,
        summary: { total: 1, passed: 1, failed: 0, error: 0, skipped: 0, flaky: 0 },
        suites: [
          {
            name: "CaseTest",
            reportPath: "TEST-CaseTest.xml",
            cases: [
              {
                id: "case",
                name: "passes",
                className: "CaseTest",
                state: "passed",
                durationMs: 1,
                detail: "",
                detailTruncated: false,
              },
            ],
          },
        ],
      },
    };
    const view = render(<JavaExecutionPanel controller={value} />);
    fireEvent.change(screen.getByLabelText("Search reported tests"), {
      target: { value: "missing" },
    });
    fireEvent.change(screen.getByLabelText("Show test outcomes"), {
      target: { value: "failures" },
    });
    fireEvent.change(screen.getByLabelText("Order reported tests"), {
      target: { value: "duration" },
    });
    expect(screen.getByText(/No matching reported tests/)).toBeVisible();
    value.snapshot = { ...value.snapshot, sessionId: "second" };
    view.rerender(<JavaExecutionPanel controller={value} />);
    expect(screen.getByLabelText("Search reported tests")).toHaveValue("");
    expect(screen.getByLabelText("Show test outcomes")).toHaveValue("all");
    expect(screen.getByLabelText("Order reported tests")).toHaveValue("failures");
    expect(screen.getByText(/Showing 1–1 of 1/)).toBeVisible();
  });
  it("selects a provider module and source set with the shared project JDK and directory", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const value = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "panel",
    }).context;
    value.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    const view = render(<JavaExecutionPanel controller={value} />);
    fireEvent.change(screen.getByLabelText("Synchronized module and source set"), {
      target: { value: JSON.stringify(["maven-effective-v1", "app", "main"]) },
    });
    expect(value.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        projectModule: {
          providerId: "maven-effective-v1",
          moduleId: "app",
          sourceSetId: "main",
        },
        projectPath: "reactor",
        jdkHome: "/project-jdk",
        buildTool: "auto",
      }),
    );
    value.configuration = {
      ...value.configuration,
      projectModule: {
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
      },
    };
    view.rerender(<JavaExecutionPanel controller={value} />);
    expect(screen.getByLabelText("Build tool")).toBeDisabled();
    expect(screen.getByLabelText("Project or module directory (workspace-relative)")).toHaveValue(
      "reactor",
    );
    expect(screen.getByText("Project JDK is selected in Java Project.")).toBeInTheDocument();
  });
  it("keeps build and test selection available with a v6 metadata-only context", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk-27",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "panel-metadata-v6",
    }).context;
    context.schemaVersion = "java-project-context-v6";
    context.analysis = null;
    context.selectedSource = null;
    context.semanticAnalysis = {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    };
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    current.configuration = {
      ...current.configuration,
      projectPath: settings.projectPath,
      jdkHome: settings.sdkHome,
      projectModule: {
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
      },
    };

    render(<JavaExecutionPanel controller={current} />);

    expect(screen.getByRole("button", { name: "Build" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run tests" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    expect(current.start).toHaveBeenCalledWith("test");
  });
  it("offers named-module launch only after selecting a synchronized project module", () => {
    const value = controller();
    value.configuration = {
      ...value.configuration,
      projectModule: { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
    };
    render(<JavaExecutionPanel controller={value} />);
    const launchMode = screen.getByLabelText("Launch Run/Debug as a named JPMS module");
    expect(launchMode).not.toBeChecked();
    fireEvent.click(launchMode);
    expect(value.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        projectModule: { providerId: "maven-effective-v1", moduleId: "app", sourceSetId: "main" },
        launchAsModule: true,
      }),
    );
  });
  it("distinguishes modules with the same ID from different build providers", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const value = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "provider-collision",
    }).context;
    context.modules.push({
      ...structuredClone(context.modules[0]!),
      providerId: "gradle-effective-v1",
      root: "included/app",
    });
    value.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    value.configuration = {
      ...value.configuration,
      projectModule: { moduleId: "app", sourceSetId: "main" },
    };

    render(<JavaExecutionPanel controller={value} />);
    expect(
      screen.getByText(/This saved module ID matches more than one build provider/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Synchronized module and source set"), {
      target: { value: JSON.stringify(["gradle-effective-v1", "app", "main"]) },
    });
    expect(value.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        projectModule: {
          providerId: "gradle-effective-v1",
          moduleId: "app",
          sourceSetId: "main",
        },
      }),
    );
  });
  it("blocks synchronized execution until a stale saved source-set selection is restored", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "stale-project-selection",
    }).context;
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    current.configuration = {
      ...current.configuration,
      debuggerMode: "jdi",
      projectModule: {
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "removed-source-set",
      },
    };
    current.capabilities = {
      ...current.capabilities!,
      structuredDebugger: true,
      attachDebugger: true,
    };

    const view = render(<JavaExecutionPanel controller={current} />);
    expect(
      screen.getByText(/saved module or source set is not present in the current Java Project/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Socket Attach requires Manual configuration/i)).toBeInTheDocument();
    for (const action of ["Build", "Run", "Run tests", "Discover tests", "Debug"]) {
      expect(screen.getByRole("button", { name: action })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();

    current.configuration = {
      ...current.configuration,
      projectModule: {
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "main",
      },
    };
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Debug" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
  });
  it("keeps one debugger and one reload panel across repeated session polls and preserves class selections", () => {
    const value = controller();
    value.running = true;
    value.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "same-session",
      operation: "debug",
      state: "running",
      exitCode: null,
      output: "",
      outputTruncated: false,
      debuggerState: { ...debuggerState(), canReloadClasses: true },
    };
    const view = render(<JavaExecutionPanel controller={value} />);
    fireEvent.change(screen.getByLabelText("Class name 1"), { target: { value: "example.Main" } });
    for (let poll = 0; poll < 4; poll++)
      view.rerender(
        <JavaExecutionPanel
          controller={{ ...value, snapshot: { ...value.snapshot, output: `poll ${poll}` } }}
        />,
      );
    expect(screen.getAllByLabelText("Structured Java debugger")).toHaveLength(1);
    expect(screen.getAllByLabelText("Java class reload")).toHaveLength(1);
    expect(screen.getByLabelText("Class name 1")).toHaveValue("example.Main");
  });
  it("offers an advertised Attach independently of build tools and labels Stop as Detach", () => {
    const current = controller();
    current.configuration = {
      ...current.configuration,
      debuggerMode: "jdi",
      debuggerAttach: { host: "127.0.0.1", port: "5006" },
    };
    Object.assign(current.capabilities!, {
      available: false,
      maven: false,
      structuredDebugger: true,
      attachDebugger: true,
    });
    const view = render(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(current.start).toHaveBeenCalledWith("attach");
    expect(screen.getByLabelText("JDWP port")).toHaveValue("5006");
    fireEvent.change(screen.getByLabelText("JDWP host"), { target: { value: "localhost" } });
    expect(current.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ debuggerAttach: { host: "localhost", port: "5006" } }),
    );
    current.running = true;
    current.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "attached",
      operation: "attach",
      state: "running",
      output: "",
      outputTruncated: false,
      exitCode: null,
    };
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(screen.getByLabelText("JDWP host")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    expect(current.stop).toHaveBeenCalled();
    expect(
      screen.getByText(/does not verify that a local file produced the bytecode/),
    ).toBeInTheDocument();
    current.running = false;
    current.trusted = false;
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
  });
  it("offers coverage only for an available Maven or Gradle runner in a trusted workspace", () => {
    const current = controller();
    const view = render(<JavaExecutionPanel controller={current} />);
    fireEvent.click(screen.getByRole("button", { name: "Run tests with coverage" }));
    expect(current.start).toHaveBeenCalledWith("coverage");
    current.capabilities!.projectKind = "jdk";
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Run tests with coverage" })).toBeDisabled();
    current.capabilities!.projectKind = "maven";
    current.trusted = false;
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Run tests with coverage" })).toBeDisabled();
  });
  it("selects and persists JDI mode while refusing an unavailable structured provider", () => {
    const current = controller();
    const view = render(<JavaExecutionPanel controller={current} />);
    fireEvent.change(screen.getByLabelText("Debugger"), { target: { value: "jdi" } });
    expect(current.updateConfiguration).toHaveBeenCalledWith({
      ...current.configuration,
      debuggerMode: "jdi",
    });
    current.configuration = { ...current.configuration, debuggerMode: "jdi" };
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: /^Debug$/ })).toBeDisabled();
    current.capabilities = { ...current.capabilities!, structuredDebugger: true };
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: /^Debug$/ })).toBeEnabled();
  });
  it("shows an unconfirmed test JVM configuration independently of the actual tool exit", () => {
    const current = controller();
    current.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "test-1",
      operation: "test",
      state: "failed",
      exitCode: 0,
      output: "BUILD SUCCESS",
      outputTruncated: false,
      testJvmOptionsError: "The project ignored the requested test JVM options.",
    };
    render(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The project ignored the requested test JVM options.",
    );
    expect(screen.getByText("test: failed (exit 0)")).toBeVisible();
    expect(screen.getByLabelText("Java console output")).toHaveTextContent("BUILD SUCCESS");
  });
  it("edits module and test settings and delegates a selected test run", () => {
    const current = controller();
    render(<JavaExecutionPanel controller={current} />);
    fireEvent.change(screen.getByLabelText("Project or module directory (workspace-relative)"), {
      target: { value: "modules/other" },
    });
    expect(current.updateConfiguration).toHaveBeenCalledWith({
      ...current.configuration,
      projectPath: "modules/other",
    });
    fireEvent.change(screen.getByLabelText("Test class or class#method (optional)"), {
      target: { value: "example.MainTest#other" },
    });
    expect(current.updateConfiguration).toHaveBeenCalledWith({
      ...current.configuration,
      testFilter: "example.MainTest#other",
    });
    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    expect(current.start).toHaveBeenCalledWith("test");
  });
  it("offers Maven Failsafe integration tests separately from unit tests", () => {
    const current = controller();
    const view = render(<JavaExecutionPanel controller={current} />);
    fireEvent.click(screen.getByRole("button", { name: "Run integration tests" }));
    expect(current.start).toHaveBeenCalledWith("integration-test");
    fireEvent.click(screen.getByRole("button", { name: "Run integration tests with coverage" }));
    expect(current.start).toHaveBeenCalledWith("integration-coverage");
    current.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "integration-coverage",
      operation: "integration-coverage",
      state: "succeeded",
      output: "",
      outputTruncated: false,
      exitCode: 0,
      coverage: coverage(),
    };
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(
      screen.getByText(
        "Coverage includes Maven's full verify lifecycle, including earlier Surefire tests and Failsafe integration tests.",
      ),
    ).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Run tests" })).toBeVisible();
  });
  it("selects an explicit Maven integration-test source set and maps it to Failsafe operations", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "panel-maven-integration-set",
    }).context;
    const module = context.modules.find((item) => item.id === "app");
    if (!module) throw new Error("Expected Maven app module fixture.");
    const mainSourceSet = module.sourceSets.find((sourceSet) => sourceSet.kind === "main");
    if (!mainSourceSet) throw new Error("Expected Maven main source-set fixture.");
    module.sourceSets.push({ ...mainSourceSet, id: "integrationTest", kind: "integration-test" });
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };

    const view = render(<JavaExecutionPanel controller={current} />);
    expect(
      screen.getByRole("option", { name: "Maven · app / integration-test (integrationTest)" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Synchronized module and source set"), {
      target: {
        value: JSON.stringify(["maven-effective-v1", "app", "integrationTest"]),
      },
    });
    expect(current.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        buildTool: "auto",
        projectPath: settings.projectPath,
        jdkHome: settings.sdkHome,
        projectModule: {
          providerId: "maven-effective-v1",
          moduleId: "app",
          sourceSetId: "integrationTest",
        },
      }),
    );
    current.configuration = {
      ...current.configuration,
      buildTool: "auto",
      projectPath: settings.projectPath,
      jdkHome: settings.sdkHome,
      projectModule: {
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "integrationTest",
      },
    };
    view.rerender(<JavaExecutionPanel controller={current} />);

    expect(screen.getByRole("status")).toHaveTextContent("checked before launch");
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run tests" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discover tests" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run integration tests" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Run integration tests with coverage" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Run integration tests" }));
    expect(current.start).toHaveBeenCalledWith("integration-test");
  });
  it.each([4, 5, 6, 7] as const)("disables Maven integration tests when v%s execution metadata is partial", async (version) => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "panel-maven-integration-partial",
    }).context;
    context.schemaVersion = `java-project-context-v${version}`;
    const module = context.modules.find((item) => item.id === "app");
    if (!module) throw new Error("Expected Maven app module fixture.");
    const mainSourceSet = module.sourceSets.find((sourceSet) => sourceSet.kind === "main");
    if (!mainSourceSet) throw new Error("Expected Maven main source-set fixture.");
    module.sourceSets.push({
      ...mainSourceSet,
      id: "integrationTest",
      kind: "integration-test",
      mavenFailsafe: {
        availability: "partial",
        refusalCode: "java.context.mavenFailsafeConfigurationIncomplete",
        executions: [],
      },
    });
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    current.configuration = {
      ...current.configuration,
      buildTool: "auto",
      projectPath: settings.projectPath,
      jdkHome: settings.sdkHome,
      projectModule: {
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "integrationTest",
      },
    };

    render(<JavaExecutionPanel controller={current} />);

    expect(screen.getByRole("status")).toHaveTextContent("did not attest one complete");
    expect(screen.getByRole("button", { name: "Run integration tests" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Run integration tests with coverage" }),
    ).toBeDisabled();
  });
  it.each([4, 5, 6, 7] as const)("shows Maven integration operations as mapped only after complete v%s metadata", async (version) => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "panel-maven-integration-complete",
    }).context;
    context.schemaVersion = `java-project-context-v${version}`;
    const module = context.modules.find((item) => item.id === "app");
    if (!module) throw new Error("Expected Maven app module fixture.");
    const mainSourceSet = module.sourceSets.find((sourceSet) => sourceSet.kind === "main");
    if (!mainSourceSet) throw new Error("Expected Maven main source-set fixture.");
    module.sourceSets.push({
      ...mainSourceSet,
      id: "integrationTest",
      kind: "integration-test",
      mavenFailsafe: {
        availability: "complete",
        refusalCode: null,
        executions: [
          {
            pluginId: "org.apache.maven.plugins:maven-failsafe-plugin",
            pluginVersion: "3.5.2",
            executionId: "run-tests",
            goals: ["integration-test", "verify"],
            phase: "integration-test",
            profileId: null,
            selectors: [],
            reports: [
              {
                name: "reportsDirectory",
                value: "target/failsafe-reports",
                origin: "execution:run-tests",
                availability: "complete",
              },
            ],
            availability: "complete",
            refusalCode: null,
          },
        ],
      },
    });
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    current.configuration = {
      ...current.configuration,
      buildTool: "auto",
      projectPath: settings.projectPath,
      jdkHome: settings.sdkHome,
      projectModule: {
        providerId: "maven-effective-v1",
        moduleId: "app",
        sourceSetId: "integrationTest",
      },
    };

    render(<JavaExecutionPanel controller={current} />);

    expect(screen.getByRole("status")).toHaveTextContent("mapped to its declared Failsafe");
    expect(screen.getByRole("button", { name: "Run integration tests" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Run integration tests with coverage" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Build" })).toBeDisabled();
  });
  it("refuses every execution operation for an unmapped Maven custom source set", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "panel-maven-custom-set",
    }).context;
    const module = context.modules.find((item) => item.id === "app");
    if (!module) throw new Error("Expected Maven app module fixture.");
    const mainSourceSet = module.sourceSets.find((sourceSet) => sourceSet.kind === "main");
    if (!mainSourceSet) throw new Error("Expected Maven main source-set fixture.");
    module.sourceSets.push({ ...mainSourceSet, id: "smoke", kind: "custom" });
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    current.configuration = {
      ...current.configuration,
      projectModule: { moduleId: "app", sourceSetId: "smoke" },
    };

    render(<JavaExecutionPanel controller={current} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "This build tool does not provide a qualified task mapping for the selected source set.",
    );
    for (const name of [
      "Build",
      "Run",
      "Run tests",
      "Run tests with coverage",
      "Discover tests",
      "Run integration tests",
      "Run integration tests with coverage",
      "Debug",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(current.start).not.toHaveBeenCalled();
  });
  it("offers the plain-JDK JUnit and TestNG paths and still requires an installed build tool", () => {
    const current = controller();
    current.capabilities = { ...current.capabilities!, projectKind: "jdk", maven: false };
    const { rerender } = render(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Run tests" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discover tests" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run tests with coverage" })).toBeDisabled();
    expect(screen.getByText(/ConsoleLauncher and its engines/)).toBeInTheDocument();
    const framework = screen.getByRole("combobox", { name: "Plain-JDK test framework" });
    expect(framework).toHaveValue("junit");
    fireEvent.change(framework, { target: { value: "testng" } });
    expect(current.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ testFramework: "testng" }),
    );
    expect(screen.getByRole("button", { name: "Build" })).toBeEnabled();
    current.configuration = { ...current.configuration, buildTool: "gradle" };
    rerender(<JavaExecutionPanel controller={current} />);
    for (const name of ["Build", "Run", "Run tests", "Debug"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(current.start).not.toHaveBeenCalled();
  });
  it("offers the opt-in JFR run only when the selected JDK advertises support", () => {
    const current = controller();
    const view = render(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Run with JFR" })).toBeDisabled();
    current.capabilities = { ...current.capabilities!, flightRecorder: true };
    view.rerender(<JavaExecutionPanel controller={current} />);
    fireEvent.click(screen.getByRole("button", { name: "Run with JFR" }));
    expect(current.start).toHaveBeenCalledWith("run", true);
  });
  it("shows bounded event metadata for the current completed JFR session", () => {
    const current = controller();
    current.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "jfr-1",
      operation: "run",
      state: "succeeded",
      output: "",
      outputTruncated: false,
      exitCode: 0,
      profilePath: ".ide/flight-recordings/session/recording.jfr",
    };
    current.flightRecordingSummary = {
      workspaceId: "one",
      generation: 1,
      sessionId: "jfr-1",
      profilePath: ".ide/flight-recordings/session/recording.jfr",
      recordingVersion: "2.1",
      chunks: 1,
      startTime: "2026-10-18 12:00:00 (UTC)",
      duration: "1 s",
      events: [
        { name: "jdk.ExecutionSample", count: 9, sizeBytes: 108 },
        { name: "jdk.ThreadStart", count: 2, sizeBytes: 64 },
      ],
    };
    render(<JavaExecutionPanel controller={current} />);
    fireEvent.click(screen.getByRole("button", { name: "Analyze recording" }));
    expect(current.analyzeFlightRecording).toHaveBeenCalledOnce();
    expect(screen.getByRole("table", { name: "JFR event type summary" })).toBeInTheDocument();
    expect(screen.getByText("jdk.ExecutionSample")).toBeInTheDocument();
    expect(screen.getByText("jdk.ThreadStart")).toBeInTheDocument();
    expect(screen.getByText("2026-10-18 12:00:00 (UTC)")).toBeInTheDocument();
    fireEvent.input(screen.getByRole("textbox", { name: "Filter JFR event types" }), {
      target: { value: "Execution" },
    });
    expect(screen.getByText("jdk.ExecutionSample")).toBeInTheDocument();
    expect(screen.queryByText("jdk.ThreadStart")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 event types")).toBeInTheDocument();
  });
  it("shows a bounded event timeline for a selected JFR event type", () => {
    const current = controller();
    current.snapshot = {
      workspaceId: "one",
      generation: 1,
      sessionId: "jfr-2",
      operation: "run",
      state: "succeeded",
      output: "",
      outputTruncated: false,
      exitCode: 0,
      profilePath: ".ide/flight-recordings/session/recording.jfr",
    };
    current.flightRecordingSummary = {
      workspaceId: "one",
      generation: 1,
      sessionId: "jfr-2",
      profilePath: ".ide/flight-recordings/session/recording.jfr",
      recordingVersion: "2.1",
      chunks: 1,
      startTime: "2026-10-20 12:00:00 (UTC)",
      duration: "1 s",
      events: [{ name: "jdk.GarbageCollection", count: 2, sizeBytes: 80 }],
    };
    const view = render(<JavaExecutionPanel controller={current} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect timeline for jdk.GarbageCollection" }),
    );
    expect(current.readFlightRecordingTimeline).toHaveBeenCalledWith("jdk.GarbageCollection");
    current.flightRecordingTimeline = {
      workspaceId: "one",
      generation: 1,
      sessionId: "jfr-2",
      profilePath: ".ide/flight-recordings/session/recording.jfr",
      eventType: "jdk.GarbageCollection",
      eventCount: 2,
      truncated: false,
      events: [
        {
          startTime: "2026-10-20T12:00:00.000+02:00",
          duration: "PT0.007S",
          threadName: "VM Thread",
          payload: [{ name: "cause", value: '"System.gc()"' }],
          payloadTruncated: false,
          stackFrames: [
            {
              className: "example.Main",
              methodName: "main",
              lineNumber: 12,
              frameType: "Interpreted",
            },
          ],
          stackTraceTruncated: false,
        },
      ],
    };
    view.rerender(<JavaExecutionPanel controller={current} />);
    expect(
      screen.getByRole("table", { name: "JFR events ordered by recorded timestamp" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 events.")).toBeInTheDocument();
    expect(screen.getByText("VM Thread")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Inspect 1 fields"));
    expect(screen.getByText("cause")).toBeInTheDocument();
    expect(screen.getByText('"System.gc()"')).toBeInTheDocument();
    fireEvent.click(screen.getByText("Inspect stack trace (1 frame)"));
    expect(screen.getByText("example.Main.main:12 (Interpreted)")).toBeInTheDocument();
  });
  it("keeps JFR profiling disabled for a synchronized test source set", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "jfr-test-source",
    }).context;
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    current.configuration = {
      ...current.configuration,
      projectModule: { moduleId: "app", sourceSetId: "test" },
    };
    current.capabilities = { ...current.capabilities!, flightRecorder: true };
    render(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Run with JFR" })).toBeDisabled();
  });
  it("allows mapped custom Gradle test execution, discovery and coverage", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "reactor",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "gradle-custom-source-set",
    }).context;
    const app = context.modules.find((module) => module.id === "app")!;
    app.providerId = "gradle-effective-v1";
    app.sourceSets.push({
      ...app.sourceSets[0],
      id: "smoke",
      kind: "custom",
      sourceRoots: ["app/src/smoke/java"],
      generatedSourceRoots: [],
      outputDirectories: ["app/build/classes/java/smoke"],
      analysisSourceRoots: ["app/src/smoke/java"],
      compileClasspath: [],
      runtimeClasspath: [],
    });
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    current.configuration = {
      ...current.configuration,
      projectModule: { moduleId: "app", sourceSetId: "smoke" },
    };
    current.capabilities = { ...current.capabilities!, projectKind: "gradle", gradle: true };
    render(<JavaExecutionPanel controller={current} />);
    expect(screen.getByRole("button", { name: "Build" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Debug" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run tests" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run tests with coverage" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discover tests" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/exactly one Gradle Test task/i);
    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    expect(current.start).toHaveBeenCalledWith("test");
    fireEvent.click(screen.getByRole("button", { name: "Discover tests" }));
    expect(current.start).toHaveBeenCalledWith("discover");
    fireEvent.click(screen.getByRole("button", { name: "Run tests with coverage" }));
    expect(current.start).toHaveBeenCalledWith("coverage");
  });
  it("distinguishes Gradle execution choices by composite build and project identity", async () => {
    const { javaProjectContextResponse } =
      await import("../../../../../tests/story/fixtures/java-project-context-response");
    const current = controller();
    const settings = {
      projectPath: "gradle",
      sdkHome: "/project-jdk",
      mavenRepository: "",
      activeMavenProfiles: [],
      inactiveMavenProfiles: [],
    };
    const context = javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "composite-module-label",
    }).context;
    const module = context.modules[0]!;
    module.providerId = "gradle-effective-v1";
    module.root = "gradle/app";
    module.buildRoot = "gradle/included-build";
    module.projectPath = ":app";
    context.schemaVersion = "java-project-context-v3";
    context.providers = [
      {
        providerId: "gradle-effective-v1",
        status: "available",
        strategy: "embedded-effective-model",
        buildCodeExecution: "denied",
        credentialsAccess: "denied",
        networkAccess: "denied",
        diagnostics: [],
      },
    ];
    current.projectContext = {
      settings,
      context,
      getSettings: () => settings,
      refresh: async () => context,
    };
    current.configuration = {
      ...current.configuration,
      projectModule: {
        providerId: module.providerId,
        moduleId: module.id,
        sourceSetId: "main",
      },
    };
    // An included build can be Gradle even when auto-detection classifies the outer
    // workspace root as plain JDK. The selected provider owns project-mode actions.
    current.capabilities = { ...current.capabilities!, projectKind: "jdk", gradle: true };

    render(<JavaExecutionPanel controller={current} />);

    expect(
      screen.getByRole("option", {
        name: "Gradle · app / main [gradle/included-build :app]",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run tests with coverage" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Run tests with coverage" }));
    expect(current.start).toHaveBeenCalledWith("coverage");
  });
  it("disables configuration and launch actions while save preparation is pending", () => {
    const current = { ...controller(), pending: true };
    render(<JavaExecutionPanel controller={current} />);
    expect(
      screen.getByLabelText("Project or module directory (workspace-relative)"),
    ).toBeDisabled();
    expect(screen.getByLabelText("Test class or class#method (optional)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run tests" })).toBeDisabled();
  });
});

it("offers test debugging only with a concrete selector and explicit native capability", () => {
  const current = controller();
  const view = render(<JavaExecutionPanel controller={current} />);
  expect(screen.getByRole("button", { name: "Debug test" })).toBeDisabled();
  current.capabilities = { ...current.capabilities!, structuredDebugger: true, debugTests: true };
  view.rerender(<JavaExecutionPanel controller={current} />);
  expect(screen.getByRole("button", { name: "Debug test" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Debug test" }));
  expect(current.start).toHaveBeenCalledWith("debug-test");
  current.configuration = { ...current.configuration, testFilter: "example.*" };
  view.rerender(<JavaExecutionPanel controller={current} />);
  expect(screen.getByRole("button", { name: "Debug test" })).toBeDisabled();
});


it("renders the real test report alongside JDI state after test debugging", () => {
  const current = controller();
  current.snapshot = { workspaceId: "one", generation: 1, sessionId: "test-debug", operation: "debug-test", state: "succeeded", output: "", outputTruncated: false, exitCode: 0, testResults: reports(), debuggerState: { ...debuggerState(), status: "terminated", stopId: null, reason: null, selectedThreadId: null, selectedFrameId: null, threads: [], frames: [], variables: [], canReloadClasses: false } };
  render(<JavaExecutionPanel controller={current} />);
  expect(screen.getByLabelText("Java test results")).toBeVisible();
  expect(screen.getByLabelText("Structured Java debugger")).toBeVisible();
});

it.each(["clean", "rebuild"] as const)("enables %s only for a supported build tool and delegates the explicit action", (operation) => {
  const label = operation === "clean" ? "Clean build outputs" : "Rebuild";
  const current = controller();
  const view = render(<JavaExecutionPanel controller={current} />);
  expect(screen.getByRole("button", { name: label })).toBeDisabled();
  current.capabilities = { ...current.capabilities!, cleanProject: true, rebuildProject: true };
  view.rerender(<JavaExecutionPanel controller={current} />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(current.start).toHaveBeenCalledWith(operation);
  current.running = true;
  view.rerender(<JavaExecutionPanel controller={current} />);
  expect(screen.getByRole("button", { name: label })).toBeDisabled();
  current.running = false;
  current.configuration = { ...current.configuration, buildTool: "jdk" };
  view.rerender(<JavaExecutionPanel controller={current} />);
  expect(screen.getByRole("button", { name: label })).toBeDisabled();
});

it.each(["preparing", "running", "reloading"] as const)("allows trust withdrawal while %s and keeps Stop available for a live session", phase => {
  const current = controller();
  current.pending = phase === "preparing";
  current.running = phase !== "preparing";
  current.classReloadPending = phase === "reloading";
  if (current.running) current.snapshot = {
    workspaceId: "one", generation: 1, sessionId: "live", operation: "debug", state: "running",
    exitCode: null, output: "", outputTruncated: false,
    debuggerState: { ...debuggerState(), canReloadClasses: true },
  };
  const view = render(<JavaExecutionPanel controller={current} />);
  const trust = screen.getByRole("checkbox", { name: /I trust this workspace/ });
  expect(trust).toBeEnabled();
  fireEvent.click(trust);
  expect(current.setTrusted).toHaveBeenCalledWith(false);
  current.trusted = false;
  view.rerender(<JavaExecutionPanel controller={current} />);
  expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  if (current.running) expect(screen.getByRole("button", { name: /^Stop$/ })).toBeEnabled();
  expect(screen.getByText(/Revoking trust prevents new execution/)).toBeVisible();
});
