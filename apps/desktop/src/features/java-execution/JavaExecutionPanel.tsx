import { isJavaDebuggingOperation, isJavaGradleSettings, isJavaTestDebugOperation } from "@ide/contracts";
import React, { useState } from "react";
import type {
  JavaBuildTool,
  JavaExecutionOperation,
  JavaPlainJdkTestFramework,
  JavaCompilerDiagnostic,
} from "@ide/contracts";
import type { JavaExecutionController } from "./useJavaExecutionController";
import { javaExecutionAvailability } from "./javaExecutionAvailability";
import { JavaTestResultsPanel } from "./JavaTestResultsPanel";
import { JavaCoveragePanel } from "./JavaCoveragePanel";
import { JavaCoverageHistoryPanel } from "./JavaCoverageHistoryPanel";
import { JavaCoverageThresholdPanel } from "./JavaCoverageThresholdPanel";
import { JavaLaunchSettings } from "./JavaLaunchSettings";
import { JavaApplicationInputPanel } from "./JavaApplicationInputPanel";
import { JavaConfigurationSelector } from "./JavaConfigurationSelector";
import { JavaDebuggerAttachSettings } from "./JavaDebuggerAttachSettings";
import { JavaTestDiscoveryPanel } from "./JavaTestDiscoveryPanel";
import type { OpenJavaTestSource } from "./useJavaTestSourceAction";
import { JavaDebuggerPanel } from "./JavaDebuggerPanel";
import { JavaClassReloadPanel } from "./JavaClassReloadPanel";
import { JavaSourceBreakpointsPanel } from "./JavaSourceBreakpointsPanel";
import type { JavaSourceBreakpoints } from "./useJavaSourceBreakpoints";

function providerLabel(providerId: string) {
  if (providerId === "java-declared-v1") return "JDK";
  if (providerId === "maven-effective-v1") return "Maven";
  if (providerId === "gradle-effective-v1") return "Gradle";
  return providerId;
}

export function JavaExecutionPanel({
  controller,
  sourceBreakpoints,
  coverageSourcePaths,
  onOpenCoverageSource,
  onOpenCompilerSource,
  onOpenTestSource,
  onOpenJavaProject,
}: {
  controller: JavaExecutionController;
  sourceBreakpoints?: JavaSourceBreakpoints;
  coverageSourcePaths?: ReadonlyMap<string, string>;
  onOpenCoverageSource?(filePath: string, line: number): void;
  onOpenCompilerSource?(diagnostic: JavaCompilerDiagnostic): void;
  onOpenTestSource?: OpenJavaTestSource;
  onOpenJavaProject?(): void;
}) {
  const [breakpoint, setBreakpoint] = useState("");
  const [expression, setExpression] = useState("");
  const [jfrEventFilter, setJfrEventFilter] = useState("");
  const [selectedJfrEventType, setSelectedJfrEventType] = useState<string | null>(null);
  const { configuration, capabilities, snapshot, running } = controller;
  const availability = javaExecutionAvailability(controller);
  const {
    projectMode,
    selectedProjectModule,
    selectedProjectSourceSet,
    ambiguousLegacySelection,
    unavailableProjectSelection,
    buildTool,
    customGradleSourceSet,
    mavenIntegrationSourceSet,
    mavenFailsafeMetadataBlocked,
    unsupportedProjectSourceSet,
  } = availability;
  const projectOptions =
    controller.projectContext?.context?.status === "available"
      ? controller.projectContext.context.modules.flatMap((module) =>
          module.sourceSets.map((sourceSet) => ({
            value: JSON.stringify([module.providerId, module.id, sourceSet.id]),
            label: `${providerLabel(module.providerId)} · ${module.name} / ${
              sourceSet.kind === "integration-test"
                ? `${sourceSet.kind} (${sourceSet.id})`
                : sourceSet.id
            }${
              module.buildRoot !== undefined && module.projectPath !== undefined
                ? ` [${module.buildRoot} ${module.projectPath}]`
                : ""
            }`,
            providerId: module.providerId,
            moduleId: module.id,
            sourceSetId: sourceSet.id,
          })),
        )
      : [];
  const selectedProject = configuration.projectModule
    ? selectedProjectModule && selectedProjectSourceSet
      ? JSON.stringify([
          selectedProjectModule.providerId,
          selectedProjectModule.id,
          selectedProjectSourceSet.id,
        ])
      : JSON.stringify([
          configuration.projectModule.providerId ?? "",
          configuration.projectModule.moduleId,
          configuration.projectModule.sourceSetId,
        ])
    : "";
  const fieldClass =
    "w-full rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-1 font-mono";
  const buttonClass = "rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40";
  const debugging =
    running && isJavaDebuggingOperation(snapshot?.operation);
  const flightRecordingSummary =
    controller.flightRecordingSummary?.sessionId === snapshot?.sessionId
      ? controller.flightRecordingSummary
      : null;
  const jfrEvents = flightRecordingSummary?.events.filter((event) =>
    event.name.toLowerCase().includes(jfrEventFilter.trim().toLowerCase()),
  );
  const candidateFlightRecordingTimeline = controller.flightRecordingTimeline;
  const flightRecordingTimeline =
    candidateFlightRecordingTimeline !== null &&
    candidateFlightRecordingTimeline.sessionId === snapshot?.sessionId &&
    candidateFlightRecordingTimeline.eventType === selectedJfrEventType
      ? candidateFlightRecordingTimeline
      : null;
  return (
    <React.Fragment>
      <section
        aria-label="Java execution"
        data-session-id={snapshot?.sessionId}
        className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm"
      >
        <h2 className="font-semibold">Java build, run, tests and debug</h2>
        <p>
          JDK, Maven and Gradle execute project code. RefactorKit remains the analysis and
          refactoring provider.
        </p>
        <JavaConfigurationSelector
          key={`${controller.selectedConfigurationId}:${controller.configurations.find((item) => item.id === controller.selectedConfigurationId)?.name}`}
          controller={controller}
        />
        <label>
          Synchronized module and source set
          <select
            className={fieldClass}
            value={selectedProject}
            disabled={running || controller.pending}
            onChange={(event) => {
              const selected = projectOptions.find((option) => option.value === event.target.value);
              if (!event.target.value) {
                const { projectModule: _selection, ...manual } = configuration;
                controller.updateConfiguration(manual);
              } else if (selected) {
                controller.updateConfiguration({
                  ...configuration,
                  buildTool: "auto",
                  projectPath: controller.projectContext?.settings.projectPath,
                  jdkHome: controller.projectContext?.settings.sdkHome,
                  projectModule: {
                    providerId: selected.providerId,
                    moduleId: selected.moduleId,
                    sourceSetId: selected.sourceSetId,
                  },
                });
              }
            }}
          >
            <option value="">Manual configuration</option>
            {selectedProject &&
              !projectOptions.some((option) => option.value === selectedProject) && (
                <option value={selectedProject}>
                  {ambiguousLegacySelection
                    ? "Saved module selection — choose a provider"
                    : "Saved module selection — synchronize Java Project"}
                </option>
              )}
            {projectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {ambiguousLegacySelection && (
          <p role="status">
            This saved module ID matches more than one build provider. Choose the intended Maven or
            Gradle entry before running.
          </p>
        )}
        {projectMode && (
          <p>
            Uses the JDK and dependencies from Java Project. Saved project metadata is refreshed
            before execution. Run and Debug compile the selected module before starting the
            application.
          </p>
        )}
        {unavailableProjectSelection && (
          <p role="status">
            The saved module or source set is not present in the current Java Project context.
            Choose a current entry or synchronize Java Project before running it.
          </p>
        )}
        {projectMode && configuration.debuggerMode === "jdi" && (
          <p role="status">
            Socket Attach requires Manual configuration. Choose it in the module selector before
            attaching to an external JVM.
          </p>
        )}
        {customGradleSourceSet && (
          <p role="status">
            Additional Gradle source sets support Build, Run and Debug. Test execution and discovery
            require exactly one Gradle Test task whose classes and runtime classpath match the
            selected source set; coverage uses the same mapping.
          </p>
        )}
        {mavenIntegrationSourceSet && (
          <p role="status">
            {mavenFailsafeMetadataBlocked
              ? "RefactorKit did not attest one complete, unambiguous Failsafe execution and report directory. Integration tests and coverage are unavailable for this source set."
              : controller.projectContext?.context?.schemaVersion === "java-project-context-v4" ||
                  controller.projectContext?.context?.schemaVersion === "java-project-context-v5" ||
                  controller.projectContext?.context?.schemaVersion === "java-project-context-v6" ||
                  controller.projectContext?.context?.schemaVersion === "java-project-context-v7"
                ? "This Maven integration-test source set is mapped to its declared Failsafe verify execution and report directory. Build, Run, unit tests, discovery and debugging are unavailable for this set."
                : "The declared Maven Failsafe execution and report directory are checked before launch. Build, Run, unit tests, discovery and debugging are unavailable for this set."}
          </p>
        )}
        {unsupportedProjectSourceSet && (
          <p role="status">
            This build tool does not provide a qualified task mapping for the selected source set.
          </p>
        )}
        {sourceBreakpoints && (
          <JavaSourceBreakpointsPanel
            controller={sourceBreakpoints}
            disabled={running || controller.pending}
          />
        )}
        <label>
          Build tool
          <select
            className={fieldClass}
            value={configuration.buildTool}
            disabled={running || controller.pending || projectMode}
            onChange={(event) =>
              controller.updateConfiguration({
                ...configuration,
                buildTool: event.target.value as JavaBuildTool,
              })
            }
          >
            <option value="auto">Detect project build tool</option>
            <option value="jdk">Plain JDK</option>
            <option value="maven">Maven</option>
            <option value="gradle">Gradle</option>
          </select>
        </label>
        <label>
          Project or module directory (workspace-relative)
          <input
            className={fieldClass}
            value={
              (projectMode
                ? controller.projectContext?.settings.projectPath
                : configuration.projectPath) ?? ""
            }
            placeholder="Workspace root"
            disabled={running || controller.pending || projectMode}
            onChange={(event) =>
              controller.updateConfiguration({
                ...configuration,
                projectPath: event.target.value,
              })
            }
          />
        </label>
        <label>
          Main class
          <input
            className={fieldClass}
            value={configuration.mainClass}
            placeholder="com.example.Main"
            disabled={running || controller.pending}
            onChange={(event) =>
              controller.updateConfiguration({ ...configuration, mainClass: event.target.value })
            }
          />
        </label>
        {projectMode && controller.entryPoints && (
          <section aria-label="Main-class discovery" className="flex flex-col gap-2 text-[var(--text-primary)]">
            <label>Launcher discovery rules
              <select aria-label="Launcher discovery rules" className={fieldClass}
                value={controller.entryPoints.launchProfile}
                disabled={!controller.entryPoints.available || controller.entryPoints.pending}
                onChange={event => controller.entryPoints.setLaunchProfile(event.target.value as "classic-declared-v1" | "inherited-v1" | "java25-v1")}>
                <option value="classic-declared-v1">Classic declared main</option>
                <option value="inherited-v1">Classic main including inherited methods (SDK/source 25)</option>
                <option value="java25-v1">Java 25 launcher, including compact and instance main</option>
              </select>
            </label>
            <button type="button" className={buttonClass} disabled={!controller.entryPoints.available || controller.entryPoints.pending}
              onClick={() => void controller.entryPoints.discover()}>
              {controller.entryPoints.pending ? "Discovering main classes…" : "Discover main classes"}
            </button>
            {controller.entryPoints.pending && <button type="button" className={buttonClass} onClick={controller.entryPoints.cancel}>Cancel main-class discovery</button>}
            <p className="text-xs text-[var(--text-secondary)]">Find provider-qualified main methods in the selected module and source set. Save source changes first. Java 25 profiles require a compatible RefactorKit runtime and a qualified SDK 25/source 25 project; unsupported combinations are refused.</p>
            {controller.entryPoints.sourcePath && <p>Main classes from {controller.entryPoints.sourcePath}</p>}
            {controller.entryPoints.result?.discovery?.selection && <p>Selected type: {controller.entryPoints.result.discovery.selection.binaryName}</p>}
            {controller.entryPoints.message && <p role="status">{controller.entryPoints.message}</p>}
            {controller.entryPoints.result?.discovery && (
              <>
                <p className="text-xs text-[var(--text-secondary)]">{controller.entryPoints.result.discovery.complete ? "Complete for the qualified profile and selected scope" : "Partial coverage"}{controller.entryPoints.result.discovery.truncated ? "; result limit reached" : ""}.
                  {controller.entryPoints.result.discovery.candidates.length === 0 ? controller.entryPoints.result.discovery.complete ? " No eligible main was returned for this scope and profile." : " No main was returned; unqualified launch forms may exist." : " Choose a class to fill the launch configuration."}</p>
                {controller.entryPoints.result.discovery.schemaVersion === "java-entry-points-v2" && controller.entryPoints.result.discovery.ineligibleCount > 0 && <div>
                  <p>{controller.entryPoints.result.discovery.ineligibleCount} type(s) cannot be constructed for an instance main{controller.entryPoints.result.discovery.ineligibleTypesTruncated ? "; excluded-type list truncated" : ""}.</p>
                  <ul aria-label="Main types that cannot be constructed">{controller.entryPoints.result.discovery.ineligibleTypes.map(type =>
                    <li key={type.binaryName}>{type.binaryName} · {type.source.path} · instance construction unavailable</li>
                  )}</ul>
                </div>}
                <ul className="max-h-48 overflow-auto">
                  {controller.entryPoints.result.discovery.candidates.map(candidate => (
                    <li key={candidate.entryPointId}>
                      <button type="button" className={buttonClass} disabled={!controller.entryPoints.available || controller.entryPoints.pending}
                        onClick={() => void controller.entryPoints.select(candidate)}>
                        {controller.entryPoints.sourcePath ? controller.entryPoints.sourceOperation === "debug" ? "Debug " : "Run " : ""}{candidate.binaryName} · {candidate.source.path}
                      </button>
                      {"declaration" in candidate && <p className="text-xs">
                        {candidate.invocation} {candidate.descriptor === "()V" ? "main()" : "main(String[])"}
                        {candidate.inherited ? ` inherited from ${candidate.declaringBinaryName}` : ""}
                        {candidate.source.form === "compact" ? " · compact source" : ""}
                        {candidate.declaration.kind === "source" ? ` · declaration: ${candidate.declaration.path}` : ` · binary declaration: ${candidate.declaration.uri}`}
                      </p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
        {projectMode && (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={configuration.launchAsModule === true}
                disabled={running || controller.pending}
                onChange={(event) =>
                  controller.updateConfiguration({
                    ...configuration,
                    launchAsModule: event.target.checked,
                  })
                }
              />
              Launch Run/Debug as a named JPMS module
            </label>
            <p className="text-xs">
              Requires a complete, current module descriptor and module path from the synchronized
              project provider.
            </p>
          </div>
        )}
        <label>
          Test class or class#method (optional)
          <input
            className={fieldClass}
            value={configuration.testFilter ?? ""}
            placeholder="com.example.MainTest#computes"
            disabled={running || controller.pending}
            onChange={(event) =>
              controller.updateConfiguration({
                ...configuration,
                testFilter: event.target.value,
              })
            }
          />
        </label>
        <p className="text-xs text-[var(--text-secondary)]">A class#method filter selects every matching overload and parameterized invocation, including when filled from the editor. Individual invocations are not selected separately.</p>
        {buildTool === "jdk" && (
          <label>
            Plain-JDK test framework
            <select
              className={fieldClass}
              value={configuration.testFramework ?? "junit"}
              disabled={running || controller.pending}
              onChange={(event) =>
                controller.updateConfiguration({
                  ...configuration,
                  testFramework: event.target.value as JavaPlainJdkTestFramework,
                })
              }
            >
              <option value="junit">JUnit Platform / JUnit 4</option>
              <option value="testng">TestNG</option>
            </select>
          </label>
        )}
        <label>
          {configuration.launchAsModule
            ? "Additional runtime module path entries (workspace-relative paths, one per line)"
            : "Additional runtime classpath (workspace-relative paths, one per line)"}
          <textarea
            className={fieldClass}
            rows={2}
            value={configuration.classPath.join("\n")}
            disabled={running || controller.pending}
            onChange={(event) =>
              controller.updateConfiguration({
                ...configuration,
                classPath: event.target.value.split("\n").filter((path) => path.trim().length > 0),
              })
            }
          />
        </label>
        <label>
          Custom test report directories (workspace-relative, one per line; optional)
          <textarea
            className={fieldClass}
            rows={2}
            value={(configuration.testReportPaths ?? []).join("\n")}
            disabled={running || controller.pending}
            onChange={(event) =>
              controller.updateConfiguration({
                ...configuration,
                testReportPaths: event.target.value.split("\n").filter((path) => path.length > 0),
              })
            }
          />
        </label>
        {!projectMode && (
          <p>
            Maven and Gradle Run use the project's runtime dependencies. Debugging uses the selected
            JDK; dependencies required by the application must be supplied on the runtime classpath.
            Plain-JDK testing uses the selected framework and workspace-contained libraries. JUnit
            needs the JUnit Platform ConsoleLauncher and its engines; TestNG uses its native runner.
            Discovery requires JDK 17 or later. Coverage requires Maven or Gradle.
          </p>
        )}
        <p className="text-xs">
          {projectMode
            ? configuration.launchAsModule
              ? "Additional entries extend the provider-attested module path for Run and Debug. Build and tests use the project build configuration."
              : selectedProjectModule?.providerId === "java-declared-v1"
                ? "Additional entries extend the declared runtime classpath for Run, Debug, tests and discovery. Compilation dependencies come from the Java project declaration."
                : "Additional classpath entries extend the synchronized runtime classpath for Run and Debug. Build and tests use the project build configuration."
            : "Additional classpath entries apply to plain-JDK compilation/Run and both debugger modes. Maven and Gradle Run use the dependencies configured by the project build."}
        </p>
        <JavaLaunchSettings
          configuration={configuration}
          capabilities={capabilities}
          disabled={running || controller.pending}
          update={controller.updateConfiguration}
          projectJdkHome={projectMode ? controller.projectContext?.settings.sdkHome : undefined}
        />
        <JavaCoverageThresholdPanel
          settings={controller.coverageThresholds}
          onChange={controller.updateCoverageThresholds}
          disabled={running || controller.pending}
          check={controller.coverageThresholdCheck}
        />
        <label>
          Debugger
          <select
            className={fieldClass}
            value={configuration.debuggerMode ?? "jdb"}
            disabled={running || controller.pending}
            onChange={(event) =>
              controller.updateConfiguration({
                ...configuration,
                debuggerMode: event.target.value as "jdi" | "jdb",
              })
            }
          >
            <option value="jdb">JDK console (jdb)</option>
            <option value="jdi">Structured Java debugger (JDI)</option>
          </select>
        </label>
        {configuration.debuggerMode === "jdi" && !capabilities?.structuredDebugger && (
          <p role="status">
            Structured debugging requires a full JDK 17 or later with its JDI module and Unix
            process ownership. For application or test debugging with an older project JDK, set
            IDE_JAVA_DEBUGGER_HOME to a compatible JDK before starting the IDE.
          </p>
        )}
        {configuration.debuggerMode === "jdi" && (
          <JavaDebuggerAttachSettings
            configuration={configuration}
            disabled={running || controller.pending}
            update={controller.updateConfiguration}
          />
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={controller.trusted}
            onChange={(event) => controller.setTrusted(event.target.checked)}
          />
          I trust this workspace to execute code, build plugins and dependency downloads.
        </label>
        <p className="text-xs">
          Revoking trust prevents new execution and class reloads. Use Stop to end an existing execution.
        </p>
        <label>
          <input type="checkbox" checked={configuration.applicationInput === true}
            disabled={running || controller.pending}
            onChange={(event) => controller.updateConfiguration({ ...configuration, applicationInput: event.target.checked })} />
          {" "}Application input (System.in)
        </label>
        <p className="text-xs">
          Enables UTF-8 input and end of input for the next Run or Debug launch.
          Requires a full JDK 8 or later with Java instrumentation. Tests and Attach keep their existing input.
        </p>
        {capabilities?.reason && <p role="status">{capabilities.reason}</p>}
        <div className="flex flex-wrap gap-2">
          {(
            [
              "clean",
              "rebuild",
              "build",
              "run",
              "test",
              ...(buildTool === "maven"
                ? (["integration-test", "integration-coverage"] as const)
                : []),
              "coverage",
              "discover",
              "debug",
              "debug-test",
              ...(buildTool === "maven" ? ["debug-integration-test" as const] : []),
            ] as JavaExecutionOperation[]
          ).map((operation) => (
            <button
              className={buttonClass}
              key={operation}
              disabled={!availability.canStart(operation)}
              onClick={() => void controller.start(operation)}
            >
              {operation === "clean" ? "Clean build outputs" : operation === "debug-test" ? "Debug test" : operation === "debug-integration-test" ? "Debug integration test" : operation === "integration-coverage"
                ? "Run integration tests with coverage"
                : operation === "integration-test"
                  ? "Run integration tests"
                  : operation === "test"
                    ? "Run tests"
                    : operation === "coverage"
                      ? "Run tests with coverage"
                      : operation === "discover"
                        ? "Discover tests"
                        : operation[0].toUpperCase() + operation.slice(1)}
            </button>
          ))}
          {isJavaGradleSettings(controller.projectContext?.settings.gradle) && (
            <button
              className={buttonClass}
              disabled={!controller.trusted || !controller.projectContext?.settings.sdkHome ||
                controller.pending || running}
              title="Use the settings from Java Project to download plugins and Java dependencies."
              onClick={() => void controller.start("prepare-gradle")}
            >
              Prepare Gradle dependencies
            </button>
          )}
          {controller.projectContext?.settings.sdkHome && (
            <button
              type="button"
              className={buttonClass}
              disabled={!controller.trusted || controller.pending || running}
              title="Run Maven verify with the JDK, repository and profiles selected in Java Project. This builds the reactor and runs its configured tests."
              onClick={() => void controller.start("prepare-maven")}
            >
              Verify Maven project
            </button>
          )}
          <button
            className={buttonClass}
            disabled={!availability.canStart("run", true)}
            onClick={() => void controller.start("run", true)}
          >
            Run with JFR
          </button>
          <p className="text-xs text-[var(--text-secondary)]">Debug test saves current edits and pauses the selected test class or methods matching the selected name in the structured debugger. Gradle debug uses one test worker.</p>
          {configuration.debuggerMode === "jdi" && (
            <button
              className={buttonClass}
              disabled={!availability.canAttach}
              onClick={() => void controller.start("attach")}
            >
              Attach
            </button>
          )}
          <button
            className={buttonClass}
            disabled={!availability.canStop}
            onClick={() => void controller.stop()}
          >
            {snapshot?.operation === "attach" ? "Detach" : "Stop"}
          </button>
          {controller.canRestart && (
            <button
              className={buttonClass}
              disabled={!availability.canRestart}
              onClick={() => void controller.restart()}
            >
              {running ? "Restart session" : "Rerun session"}
            </button>
          )}
        </div>
        {controller.canRestart && (
          <p>
            Restart and rerun save editor changes and use this session’s captured launch settings,
            including its JDK and arguments.
          </p>
        )}
        {(debugging && (configuration.debuggerMode === "jdi" || isJavaTestDebugOperation(snapshot?.operation))) || snapshot?.debuggerState ? (
          <JavaDebuggerPanel
            key={snapshot?.sessionId}
            state={snapshot?.debuggerState}
            active={debugging}
            commandError={controller.error}
            stepFilterText={controller.stepFilterText}
            onStepFilterTextChange={controller.setStepFilterText}
            action={(action) => void controller.debugAction(action)}
          />
        ) : null}
        {snapshot?.debuggerState && (
          <JavaClassReloadPanel
            key={`class-reload:${snapshot.sessionId}`}
            controller={controller}
          />
        )}
        {debugging && configuration.debuggerMode !== "jdi" && !isJavaTestDebugOperation(snapshot?.operation) && (
          <fieldset className="flex flex-col gap-2">
            <legend>Debugger controls</legend>
            <div className="flex flex-wrap gap-2">
              {[
                ["Continue", "cont"],
                ["Step into", "step"],
                ["Step over", "next"],
                ["Step out", "step up"],
                ["Stack", "where"],
                ["Locals", "locals"],
                ["Threads", "threads"],
              ].map(([label, command]) => (
                <button
                  key={command}
                  className={buttonClass}
                  onClick={() => void controller.debugCommand(command)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              Breakpoint (class:line)
              <input
                className={fieldClass}
                value={breakpoint}
                placeholder="com.example.Main:12"
                onChange={(event) => setBreakpoint(event.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button
                className={buttonClass}
                disabled={!breakpoint.trim()}
                onClick={() => void controller.debugCommand(`stop at ${breakpoint.trim()}`)}
              >
                Set breakpoint
              </button>
              <button
                className={buttonClass}
                disabled={!breakpoint.trim()}
                onClick={() => void controller.debugCommand(`clear ${breakpoint.trim()}`)}
              >
                Clear breakpoint
              </button>
            </div>
            <label>
              Expression
              <input
                className={fieldClass}
                value={expression}
                onChange={(event) => setExpression(event.target.value)}
              />
            </label>
            <button
              className={buttonClass}
              disabled={!expression.trim()}
              onClick={() => void controller.debugCommand(`print ${expression.trim()}`)}
            >
              Evaluate
            </button>
            <p>
              Stack, locals and expression results appear in the debugger console. This is not a
              structured variable inspector.
            </p>
          </fieldset>
        )}
        {controller.error && (
          <p role="alert" className="text-red-500">
            {controller.error}
          </p>
        )}
        {snapshot && (
          <>
            {controller.sessionConfigurationName && (
              <p>Session configuration: {controller.sessionConfigurationName}</p>
            )}
            <p role="status">
              {snapshot.operation === "attach" ? "Debugger connection" :
                snapshot.operation === "prepare-gradle" ? "Gradle dependency preparation" :
                  snapshot.operation === "prepare-maven" ? "Maven project verification" : snapshot.operation}:{" "}
              {snapshot.state}
              {snapshot.exitCode !== null
                ? ` (${snapshot.operation === "attach" ? "helper exit" : "exit"} ${snapshot.exitCode})`
                : ""}
            </p>
            {(snapshot.operation === "prepare-gradle" || snapshot.operation === "prepare-maven") &&
              snapshot.state === "succeeded" && (
              <div>
                <p>{snapshot.operation === "prepare-gradle"
                  ? "Select Evaluate Gradle project in Java Project to synchronize offline."
                  : "Select Synchronize project in Java Project to load Maven metadata."}</p>
                {onOpenJavaProject && (
                  <button type="button" className={buttonClass} onClick={onOpenJavaProject}>
                    Open Java Project
                  </button>
                )}
              </div>
            )}
            {snapshot.profilePath && (
              <>
                <p role="status">
                  {running ? "JFR output on process exit: " : "JFR recording saved to "}
                  {snapshot.profilePath}
                </p>
                {!running &&
                  ["succeeded", "failed"].includes(snapshot.state) &&
                  controller.trusted &&
                  controller.canAnalyzeFlightRecording && (
                    <button
                      className={buttonClass}
                      disabled={controller.pending || controller.flightRecordingAnalysisPending}
                      onClick={() => void controller.analyzeFlightRecording()}
                    >
                      {controller.flightRecordingAnalysisPending
                        ? "Analyzing…"
                        : "Analyze recording"}
                    </button>
                  )}
                {flightRecordingSummary && (
                  <section aria-label="Flight Recorder analysis" className="mt-3 space-y-2">
                    <h3 className="font-semibold">Flight Recorder event summary</h3>
                    <dl className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-[var(--text-muted)]">Recording version</dt>
                        <dd>{flightRecordingSummary.recordingVersion}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-muted)]">Chunks</dt>
                        <dd>{flightRecordingSummary.chunks}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-muted)]">Started</dt>
                        <dd>{flightRecordingSummary.startTime}</dd>
                      </div>
                      <div>
                        <dt className="text-[var(--text-muted)]">Duration</dt>
                        <dd>{flightRecordingSummary.duration}</dd>
                      </div>
                    </dl>
                    <label className="block text-xs">
                      Filter JFR event types
                      <input
                        aria-label="Filter JFR event types"
                        className={fieldClass}
                        onInput={(event) => setJfrEventFilter(event.currentTarget.value)}
                        placeholder="Event type name"
                        type="text"
                        value={jfrEventFilter}
                      />
                    </label>
                    <p role="status" aria-label="JFR event filter status" className="text-xs">
                      Showing {jfrEvents?.length ?? 0} of {flightRecordingSummary.events.length}{" "}
                      event types
                    </p>
                    <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
                      <table
                        aria-label="JFR event type summary"
                        className="w-full text-left text-xs"
                      >
                        <thead className="sticky top-0 bg-[var(--surface-panel)]">
                          <tr>
                            <th scope="col" className="p-2">
                              Event type
                            </th>
                            <th scope="col" className="p-2 text-right">
                              Count
                            </th>
                            <th scope="col" className="p-2 text-right">
                              Size (bytes)
                            </th>
                            <th scope="col" className="p-2">
                              Timeline
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {jfrEvents?.map((event) => (
                            <tr key={event.name}>
                              <th scope="row" className="p-2 font-mono font-normal">
                                {event.name}
                              </th>
                              <td className="p-2 text-right tabular-nums">{event.count}</td>
                              <td className="p-2 text-right tabular-nums">{event.sizeBytes}</td>
                              <td className="p-2">
                                <button
                                  className="underline disabled:opacity-40"
                                  disabled={
                                    !controller.trusted ||
                                    controller.pending ||
                                    controller.flightRecordingAnalysisPending ||
                                    controller.flightRecordingTimelinePending ||
                                    !controller.canReadFlightRecordingTimeline
                                  }
                                  aria-label={`Inspect timeline for ${event.name}`}
                                  onClick={() => {
                                    setSelectedJfrEventType(event.name);
                                    void controller.readFlightRecordingTimeline(event.name);
                                  }}
                                >
                                  Inspect
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {flightRecordingSummary.events.length === 0 && (
                        <p className="p-2" role="status">
                          The recording contains no event types.
                        </p>
                      )}
                      {flightRecordingSummary.events.length > 0 && jfrEvents?.length === 0 && (
                        <p className="p-2" role="status">
                          No event types match this filter.
                        </p>
                      )}
                    </div>
                    {flightRecordingTimeline && (
                      <section aria-label="JFR event timeline" className="space-y-2">
                        <h4 className="font-semibold">
                          Timeline: {flightRecordingTimeline.eventType}
                        </h4>
                        <p role="status">
                          Showing {flightRecordingTimeline.events.length} of{" "}
                          {flightRecordingTimeline.eventCount} events
                          {flightRecordingTimeline.truncated ? " (bounded)" : ""}.
                        </p>
                        {flightRecordingTimeline.events.length > 0 ? (
                          <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
                            <table
                              aria-label="JFR events ordered by recorded timestamp"
                              className="w-full text-left text-xs"
                            >
                              <caption>JFR events ordered by recorded timestamp</caption>
                              <thead className="sticky top-0 bg-[var(--surface-panel)]">
                                <tr>
                                  <th scope="col" className="p-2">
                                    Start time
                                  </th>
                                  <th scope="col" className="p-2">
                                    Duration
                                  </th>
                                  <th scope="col" className="p-2">
                                    Thread
                                  </th>
                                  <th scope="col" className="p-2">
                                    Event fields
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {flightRecordingTimeline.events.map((event, index) => (
                                  <tr key={`${event.startTime}-${index}`}>
                                    <td className="p-2 font-mono">{event.startTime}</td>
                                    <td className="p-2 font-mono">{event.duration ?? "—"}</td>
                                    <td className="p-2">{event.threadName ?? "—"}</td>
                                    <td className="p-2">
                                      {event.payload.length > 0 || event.stackFrames.length > 0 ? (
                                        <div className="space-y-2">
                                          {event.payload.length > 0 && (
                                            <details>
                                              <summary className="cursor-pointer underline">
                                                Inspect {event.payload.length} fields
                                              </summary>
                                              <dl className="mt-2 space-y-1">
                                                {event.payload.map((field) => (
                                                  <div key={field.name}>
                                                    <dt className="font-semibold">{field.name}</dt>
                                                    <dd className="break-all font-mono">
                                                      {field.value}
                                                    </dd>
                                                  </div>
                                                ))}
                                              </dl>
                                              {event.payloadTruncated && (
                                                <p role="status" className="mt-2">
                                                  Some event fields were shortened or omitted to
                                                  keep this view bounded.
                                                </p>
                                              )}
                                            </details>
                                          )}
                                          {event.stackFrames.length > 0 && (
                                            <details>
                                              <summary
                                                aria-label={`Inspect stack trace for event ${index + 1}`}
                                                className="cursor-pointer underline"
                                              >
                                                Inspect stack trace ({event.stackFrames.length}{" "}
                                                {event.stackFrames.length === 1
                                                  ? "frame"
                                                  : "frames"}
                                                )
                                              </summary>
                                              <ol className="mt-2 list-inside list-decimal space-y-1 font-mono">
                                                {event.stackFrames.map((frame, frameIndex) => (
                                                  <li
                                                    key={`${frame.className}-${frame.methodName}-${frameIndex}`}
                                                  >
                                                    {frame.className ?? "<unknown>"}.
                                                    {frame.methodName ?? "<unknown>"}
                                                    {frame.lineNumber !== null &&
                                                      `:${frame.lineNumber}`}
                                                    {frame.frameType && ` (${frame.frameType})`}
                                                  </li>
                                                ))}
                                              </ol>
                                              {event.stackTraceTruncated && (
                                                <p role="status" className="mt-2">
                                                  The recorded stack trace was shortened to keep
                                                  this view bounded.
                                                </p>
                                              )}
                                            </details>
                                          )}
                                        </div>
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p role="status">No events of this type were recorded.</p>
                        )}
                      </section>
                    )}
                  </section>
                )}
              </>
            )}
            {snapshot.testJvmOptionsError && (
              <p role="alert" className="text-red-500">
                {snapshot.testJvmOptionsError}
              </p>
            )}
            {snapshot.testDiscovery && (
              <JavaTestDiscoveryPanel
                key={snapshot.sessionId}
                discovery={snapshot.testDiscovery}
                openTestSource={onOpenTestSource}
                disabled={!controller.trusted || running || controller.pending}
                run={(id) => void controller.runDiscovered(id)}
                debug={capabilities?.debugTests === true ? (id) => void controller.runDiscovered(id, false, true) : undefined}
                cover={
                  snapshot.testDiscovery.buildTool === "jdk" ? undefined : (id) => void controller.runDiscovered(id, true)
                }
              />
            )}
            {snapshot.outputTruncated && (
              <p role="status">
                Earlier output was truncated; the console shows the most recent 64 KiB.
              </p>
            )}
            {snapshot.coverage && (
              <>
                {snapshot.operation === "integration-coverage" && (
                  <p role="status">
                    Coverage includes Maven&apos;s full verify lifecycle, including earlier Surefire
                    tests and Failsafe integration tests.
                  </p>
                )}
                <JavaCoveragePanel
                  key={snapshot.sessionId}
                  results={snapshot.coverage}
                  sourcePaths={coverageSourcePaths}
                  onOpenSource={onOpenCoverageSource}
                />
              </>
            )}
            {(["test", "integration-test", "integration-coverage", "coverage"].includes(
              snapshot.operation,
            ) || isJavaTestDebugOperation(snapshot.operation)) &&
              (snapshot.testResults ? (
                <JavaTestResultsPanel
                  key={snapshot.sessionId}
                  results={snapshot.testResults}
                  canRerun={availability.canRerunFailed}
                  rerun={() => void controller.rerunFailed()}
                  canDebugFailed={availability.canDebugFailed}
                  debugFailed={() => void controller.rerunFailed(true)}
                  openTestSource={onOpenTestSource}
                />
              ) : (
                <p role="status">
                  Structured test reports are unavailable from this provider. Check the console
                  output.
                </p>
              ))}
            {snapshot.compilerDiagnostics && (
              <section aria-label="Reported compiler locations" className="space-y-2 text-xs">
                <h3 className="font-semibold">Reported compiler locations</h3>
                <p>Positions come from tool output. Current editor changes may differ. Open a location to view its source line.</p>
                {snapshot.compilerDiagnostics.truncated && <p role="status">Some output locations may be omitted because collection limits were reached.</p>}
                <ul className="max-h-60 space-y-2 overflow-auto">
                  {snapshot.compilerDiagnostics.items.map((item, index) => (
                    <li key={index}>
                      <button type="button" className="text-left underline disabled:opacity-50"
                        disabled={!onOpenCompilerSource || running || controller.pending}
                        onClick={() => onOpenCompilerSource?.(item)}>
                        {item.path}:{item.line} · {item.severity}
                      </button>
                      {item.reportedColumn !== null && <span> · Tool column {item.reportedColumn}</span>}
                      <p className="whitespace-pre-wrap break-words">{item.message}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <pre
              aria-label="Java console output"
              className="min-h-40 flex-1 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-editor)] p-2 font-mono text-xs"
            >
              {snapshot.output || "Waiting for tool output…"}
            </pre>
            <JavaApplicationInputPanel input={controller.applicationInput} />
          </>
        )}
        {controller.coverageHistoryError && <p role="alert">{controller.coverageHistoryError}</p>}
        {(controller.coverageHistory.length > 0 || controller.coverageHistoryError) && (
          <JavaCoverageHistoryPanel
            entries={controller.coverageHistory}
            onClear={controller.clearCoverageHistory}
          />
        )}
      </section>
    </React.Fragment>
  );
}
