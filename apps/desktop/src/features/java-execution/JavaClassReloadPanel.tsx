import { useState } from "react";
import type { JavaExecutionController } from "./useJavaExecutionController";
import { javaClassFileSuggestions } from "./javaClassFileSuggestions";

type ClassFileSelection = {
  className: string;
  classFile: string;
  suggestedClassFile: string;
  expectedSha256?: string;
  reviewedStopId?: string;
};

export function JavaClassReloadPanel({ controller }: { controller: JavaExecutionController }) {
  const [classes, setClasses] = useState<ClassFileSelection[]>([
    { className: "", classFile: "", suggestedClassFile: "" },
  ]);
  const snapshot = controller.snapshot;
  const disabled =
    !controller.trusted ||
    !controller.running ||
    !["debug", "attach"].includes(snapshot?.operation ?? "") ||
    snapshot?.debuggerState?.canReloadClasses !== true ||
    controller.classReloadPending ||
    snapshot.classReload?.status === "queued";
  const buttonClass = "rounded border border-[var(--border-default)] px-2 py-1 disabled:opacity-40";
  const fieldClass =
    "w-full rounded border border-[var(--border-default)] bg-[var(--surface-editor)] p-1 font-mono";
  const projectPath = controller.projectContext?.settings?.projectPath ?? "";
  const loadedClasses = snapshot?.debuggerState?.loadedClasses ?? [];
  const canListLoadedClasses =
    controller.trusted &&
    controller.running &&
    ["debug", "attach"].includes(snapshot?.operation ?? "") &&
    typeof controller.debugAction === "function";
  const outputSuggestions = classes.map((item) =>
    javaClassFileSuggestions(
      controller.projectContext?.context,
      controller.configuration?.projectModule,
      item.className,
      projectPath,
    ),
  );
  const ambiguousLoadedClass = classes.some((item) =>
    loadedClasses.some(
      (loadedClass) => loadedClass.className === item.className && loadedClass.classLoaderCount > 1,
    ),
  );
  const result = snapshot?.classReload;
  const selectionStale = classes.some(
    (item) =>
      item.reviewedStopId !== undefined && item.reviewedStopId !== snapshot?.debuggerState?.stopId,
  );
  const build = controller.classReloadBuild;
  const changes =
    build &&
    snapshot &&
    build.workspaceId === snapshot.workspaceId &&
    build.generation === snapshot.generation &&
    build.sessionId === snapshot.sessionId
      ? build.classChanges
      : undefined;
  const canUseChanges =
    !disabled &&
    changes?.status === "ready" &&
    changes.classes.length > 0 &&
    changes.stopId === snapshot?.debuggerState?.stopId;
  const updateClassName = (index: number, className: string) => {
    const item = classes[index];
    if (!item) return;
    const suggestions = javaClassFileSuggestions(
      controller.projectContext?.context,
      controller.configuration?.projectModule,
      className,
      projectPath,
    );
    const previousSuggestions = javaClassFileSuggestions(
      controller.projectContext?.context,
      controller.configuration?.projectModule,
      item.className,
      projectPath,
    );
    const suggestedClassFile = suggestions.paths.length === 1 ? suggestions.paths[0] : "";
    setClasses((current) =>
      current.map((row, position) => {
        if (position !== index) return row;
        const canReplaceFile =
          !row.classFile ||
          row.classFile === row.suggestedClassFile ||
          previousSuggestions.paths.includes(row.classFile);
        return {
          ...row,
          className,
          expectedSha256: undefined,
          reviewedStopId: undefined,
          classFile: canReplaceFile ? suggestedClassFile : row.classFile,
          suggestedClassFile: canReplaceFile ? suggestedClassFile : "",
        };
      }),
    );
  };
  return (
    <section aria-label="Java class reload" className="flex flex-col gap-2">
      <h3>HotSwap compiled classes</h3>
      <p>
        Build and reload saves dirty editor buffers, compiles with the selected build tool or JDK
        while the JDI session stays connected, then asks the JVM to apply the selected classes. The
        JVM decides whether each change is supported.
      </p>
      <p>Reload compiled classes uses existing outputs and does not save editor drafts.</p>
      <p>
        New calls use reloaded methods. Active obsolete frames retain their old code. Reload retires
        local source binding and affected runtime breakpoints; review breakpoints before continuing.
      </p>
      <div className="flex flex-col gap-1">
        <button
          className={buttonClass}
          disabled={!canListLoadedClasses}
          onClick={() => void controller.debugAction({ type: "listLoadedClasses" })}
        >
          Refresh loaded JVM classes
        </button>
        {loadedClasses.length > 0 && (
          <p role="status">
            {loadedClasses.length} prepared class names were read from this JVM. They suggest a name
            only; choose a prepared class below and verify its compiled file before reloading.
            {snapshot?.debuggerState?.loadedClassesTruncated ? " The list is truncated." : ""}
          </p>
        )}
        {snapshot?.debuggerState?.loadedClassesTruncated && loadedClasses.length === 0 && (
          <p role="status">The JVM class list is truncated; enter another class name manually.</p>
        )}
      </div>
      <fieldset disabled={disabled} className="flex flex-col gap-2">
        <legend>Compiled classes</legend>
        <button
          className={buttonClass}
          disabled={
            typeof controller.buildAndReviewClasses !== "function" ||
            !loadedClasses.length ||
            snapshot?.operation !== "debug" ||
            snapshot.debuggerState?.status !== "suspended"
          }
          onClick={() => void controller.buildAndReviewClasses()}
        >
          Build and review changed classes
        </button>
        <p>
          Pause the JVM and refresh its class list first. Review compares existing files for the
          listed names around a build; it does not reload them. Classes absent from that list or
          without one local output require manual selection.
        </p>
        {changes && (
          <section aria-label="Changed compiled classes">
            <p role="status">{changes.message}</p>
            {changes.status === "ready" && changes.classes.length === 0 && (
              <p>No compared compiled files changed.</p>
            )}
            <ul>
              {changes.classes.map((item) => (
                <li key={item.className}>
                  {item.className} · {item.classFile}
                </li>
              ))}
            </ul>
            <button
              className={buttonClass}
              disabled={!canUseChanges}
              onClick={() => {
                if (!canUseChanges || !changes?.stopId) return;
                setClasses(
                  changes.classes.map((item) => ({
                    ...item,
                    suggestedClassFile: "",
                    reviewedStopId: changes.stopId!,
                  })),
                );
              }}
            >
              Use changed classes
            </button>
          </section>
        )}
        {selectionStale && (
          <p role="status">
            The suspension changed after this selection was reviewed. Build and review again or
            choose files manually.
          </p>
        )}
        {classes.map((item, index) => (
          <div key={index} className="flex flex-col gap-1">
            {loadedClasses.length > 0 && (
              <label>
                Prepared JVM class {index + 1}
                <select
                  aria-label={`Prepared JVM class ${index + 1}`}
                  className={fieldClass}
                  value={
                    loadedClasses.some((loadedClass) => loadedClass.className === item.className)
                      ? item.className
                      : ""
                  }
                  onChange={(event) => updateClassName(index, event.target.value)}
                >
                  <option value="">Choose a prepared class…</option>
                  {loadedClasses.map((loadedClass) => (
                    <option key={loadedClass.className} value={loadedClass.className}>
                      {loadedClass.className}
                      {loadedClass.classLoaderCount > 1
                        ? ` (${loadedClass.classLoaderCount} class loaders)`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Class name {index + 1}
              <input
                className={fieldClass}
                value={item.className}
                maxLength={512}
                placeholder="example.Main"
                onChange={(event) => updateClassName(index, event.target.value)}
              />
            </label>
            {(loadedClasses.find((loadedClass) => loadedClass.className === item.className)
              ?.classLoaderCount ?? 0) > 1 && (
              <p role="status">
                This class name is loaded by multiple class loaders. The JVM refuses HotSwap when it
                cannot identify one loaded definition.
              </p>
            )}
            <label>
              Compiled file {index + 1}
              <input
                className={fieldClass}
                value={item.classFile}
                maxLength={1024}
                placeholder="target/classes/example/Main.class"
                list={`java-class-output-${index}`}
                onChange={(event) => {
                  const classFile = event.target.value;
                  setClasses((current) =>
                    current.map((row, position) =>
                      position === index
                        ? {
                            ...row,
                            classFile,
                            expectedSha256: undefined,
                            reviewedStopId: undefined,
                            suggestedClassFile:
                              classFile === row.suggestedClassFile ? row.suggestedClassFile : "",
                          }
                        : row,
                    ),
                  );
                }}
              />
              <datalist id={`java-class-output-${index}`}>
                {outputSuggestions[index].paths.map((path) => (
                  <option key={path} value={path} />
                ))}
              </datalist>
            </label>
            {outputSuggestions[index].paths.length > 0 && (
              <p>
                Suggestions come from the synchronized project outputs. A project-launched session
                accepts files only beneath materialized workspace directories on its captured
                runtime classpath; this still cannot prove which bytes the JVM loaded. When
                attaching manually, verify the selected path against the external JVM's classpath.
              </p>
            )}
            {outputSuggestions[index].truncated && (
              <p role="status">
                Output suggestions were limited; enter another workspace-relative path if needed.
              </p>
            )}
            <button
              className={buttonClass}
              disabled={classes.length === 1}
              onClick={() => setClasses(classes.filter((_, position) => position !== index))}
            >
              Remove class {index + 1}
            </button>
          </div>
        ))}
        <button
          className={buttonClass}
          disabled={classes.length >= 32}
          onClick={() =>
            setClasses([...classes, { className: "", classFile: "", suggestedClassFile: "" }])
          }
        >
          Add class
        </button>
        <button
          className={buttonClass}
          disabled={
            selectionStale ||
            ambiguousLoadedClass ||
            classes.some((item) => !item.className || !item.classFile)
          }
          onClick={() =>
            void controller.buildAndReloadClasses(
              classes.map(({ className, classFile, expectedSha256 }) => ({
                className,
                classFile,
                ...(expectedSha256 ? { expectedSha256 } : {}),
              })),
            )
          }
        >
          Build and reload classes
        </button>
        <button
          className={buttonClass}
          disabled={
            selectionStale ||
            ambiguousLoadedClass ||
            classes.some((item) => !item.className || !item.classFile)
          }
          onClick={() =>
            void controller.reloadClasses(
              classes.map(({ className, classFile, expectedSha256 }) => ({
                className,
                classFile,
                ...(expectedSha256 ? { expectedSha256 } : {}),
              })),
            )
          }
        >
          Reload compiled classes
        </button>
      </fieldset>
      {controller.classReloadPending && <p role="status">Building and preparing classes…</p>}
      {controller.classReloadBuild && (
        <p role={controller.classReloadBuild.state === "failed" ? "alert" : "status"}>
          Build for HotSwap: {controller.classReloadBuild.state} (exit code{" "}
          {controller.classReloadBuild.exitCode})
          {controller.classReloadBuild.outputTruncated ? " — earlier output omitted" : ""}
        </p>
      )}
      {controller.classReloadBuild?.output && (
        <details>
          <summary>Build output</summary>
          <pre
            aria-label="Build for HotSwap output"
            className="max-h-48 overflow-auto whitespace-pre-wrap"
          >
            {controller.classReloadBuild.output}
          </pre>
        </details>
      )}
      {result && (
        <p
          role={result.status === "failed" ? "alert" : "status"}
          aria-label="Java class reload result"
          data-request-id={result.requestId}
        >
          Class reload: {result.status} ({result.classes.join(", ")})
          {result.error ? ` — ${result.error}` : ""}
        </p>
      )}
    </section>
  );
}
