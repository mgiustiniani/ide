import { isJavaDebuggingOperation } from "@ide/contracts";
import type { JavaDebuggerSourceRequest, JavaExecutionSnapshot } from "@ide/contracts";
import type { EditorViewModel, JavaExecutionPort } from "@ide/web-core";
import type { JavaEditorDebugger } from "@ide/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JavaSourceBreakpoints } from "./useJavaSourceBreakpoints";

interface Dependencies {
  port: JavaExecutionPort;
  snapshot: JavaExecutionSnapshot | null;
  workspaceId: string | null;
  generation: number;
  getContext(): { workspaceId: string | null; generation: number; isSwitching: boolean };
  getEditorState(): { activeFilePath: string | null; contents: Record<string, string> };
  editor: Pick<EditorViewModel, "bufferLifetime">;
  breakpoints?: JavaSourceBreakpoints;
}
function signature(snapshot: JavaExecutionSnapshot | null, includeBreakpoints = true): string {
  return JSON.stringify([
    snapshot?.workspaceId,
    snapshot?.generation,
    snapshot?.sessionId,
    snapshot?.operation,
    snapshot?.state,
    snapshot?.debuggerState?.status,
    snapshot?.debuggerState?.stopId,
    snapshot?.debuggerState?.selectedFrameId,
    snapshot?.classReload,
    includeBreakpoints ? snapshot?.debuggerState?.breakpoints : undefined,
  ]);
}
function sourceBinding(deps: Dependencies) {
  return `${signature(deps.snapshot)}:${JSON.stringify(deps.breakpoints?.points)}`;
}
export function useJavaDebugEditorController(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const lifecycle = useRef(0),
    sequence = useRef(0);
  const [message, setMessage] = useState<string | null>(null);
  const binding = sourceBinding(dependencies);
  useEffect(() => {
    ++lifecycle.current;
    setMessage(null);
    return () => {
      ++lifecycle.current;
    };
  }, [dependencies.workspaceId, dependencies.generation, dependencies.port]);
  const debugging = useMemo<JavaEditorDebugger | undefined>(() => {
    const snapshot = latest.current.snapshot;
    const live =
      snapshot &&
      snapshot.workspaceId === dependencies.workspaceId &&
      snapshot.generation === dependencies.generation &&
      isJavaDebuggingOperation(snapshot.operation) &&
      snapshot.classReload === undefined &&
      snapshot.state === "running" &&
      snapshot.debuggerState &&
      snapshot.debuggerState.status !== "terminated";
    if (
      !dependencies.workspaceId ||
      (!live && !dependencies.breakpoints) ||
      (!live &&
        isJavaDebuggingOperation(snapshot?.operation) &&
        ["starting", "running"].includes(snapshot?.state ?? ""))
    )
      return undefined;
    const context = {
      workspaceId: dependencies.workspaceId,
      generation: dependencies.generation,
      ...(live ? { sessionId: snapshot!.sessionId } : {}),
    };
    let approval:
      | {
          document: JavaDebuggerSourceRequest["document"];
          lifetime: symbol;
          breakpoints: { line: number }[];
        }
      | undefined;
    let querySequence = 0;
    const request = (
      document: JavaDebuggerSourceRequest["document"],
    ): JavaDebuggerSourceRequest => ({
      ...context,
      sessionId: snapshot!.sessionId,
      requestId: `java-source-${++sequence.current}`,
      document,
      stopId: snapshot!.debuggerState!.stopId,
      frameId: snapshot!.debuggerState!.selectedFrameId,
    });
    const operation = (
      document: JavaDebuggerSourceRequest["document"],
      changingBreakpoint = false,
    ) => {
      const epoch = lifecycle.current,
        lifetime = latest.current.editor.bufferLifetime(document.path),
        actionBinding = signature(snapshot, false);
      const current = () => {
        const deps = latest.current,
          workspace = deps.getContext(),
          state = deps.getEditorState();
        return (
          lifetime !== undefined &&
          lifecycle.current === epoch &&
          !workspace.isSwitching &&
          workspace.workspaceId === context.workspaceId &&
          workspace.generation === context.generation &&
          (live && changingBreakpoint
            ? signature(deps.snapshot, false) === actionBinding
            : sourceBinding(deps) === binding) &&
          state.activeFilePath === document.path &&
          state.contents[document.path] === document.text &&
          deps.editor.bufferLifetime(document.path) === lifetime
        );
      };
      if (!current()) throw new Error("The debugger editor request is obsolete.");
      return current;
    };
    return {
      context,
      mode: live ? "live" : "saved",
      canRunToCursor: !!(
        live &&
        snapshot!.debuggerState!.status === "suspended" &&
        snapshot!.debuggerState!.stopId
      ),
      async source(document) {
        approval = undefined;
        const operationCurrent = operation(document),
          query = ++querySequence;
        const current = () => query === querySequence && operationCurrent();
        try {
          if (!live) {
            const saved = await latest.current.breakpoints!.inspect(document);
            if (!current()) throw new Error("The saved breakpoint inspection is obsolete.");
            approval = {
              document,
              lifetime: latest.current.editor.bufferLifetime(document.path)!,
              breakpoints: saved.points,
            };
            setMessage(
              saved.changed
                ? "Saved breakpoints refer to changed source. Review and rebind or remove them before Debug."
                : null,
            );
            return {
              documentPath: document.path,
              documentVersion: document.version,
              sourcePath: saved.sourcePath,
              executionLine: null,
              breakpoints: saved.points.map(({ line, enabled }) => ({
                line,
                enabled,
                verified: false,
              })),
            };
          }
          if (!latest.current.port.debugSource)
            throw new Error("Debugger source binding is unavailable from this provider.");
          const view = await latest.current.port.debugSource(request(document));
          if (!current()) throw new Error("The debugger editor request is obsolete.");
          approval = {
            document,
            lifetime: latest.current.editor.bufferLifetime(document.path)!,
            breakpoints: view.breakpoints,
          };
          setMessage(null);
          return view;
        } catch (cause) {
          if (current())
            setMessage(
              cause instanceof Error ? cause.message : "Debugger source binding is unavailable.",
            );
          throw cause;
        }
      },
      async toggleBreakpoint(document, line) {
        if (
          !approval ||
          approval.document.path !== document.path ||
          approval.document.text !== document.text ||
          approval.document.version !== document.version ||
          approval.lifetime !== latest.current.editor.bufferLifetime(document.path)
        )
          throw new Error("The debugger source binding is obsolete; refresh the editor.");
        const current = operation(document, true);
        try {
          const present = !approval.breakpoints.some((point) => point.line === line);
          if (!live) {
            await latest.current.breakpoints!.set(document, line, present, current);
            if (current()) setMessage(null);
            return;
          }
          if (!latest.current.port.toggleSourceBreakpoint)
            throw new Error("Source breakpoints are unavailable from this provider.");
          const saved =
            present && latest.current.breakpoints?.inspect
              ? await latest.current.breakpoints.inspect(document)
              : null;
          const prior = saved?.points.find((point) => point.line === line);
          const options = {
            ...(prior?.condition ? { condition: prior.condition } : {}),
            ...(prior?.hitCount ? { hitCount: prior.hitCount } : {}),
            ...(prior?.logMessage ? { logMessage: prior.logMessage } : {}),
          };
          if (!current()) throw new Error("The debugger source request is obsolete.");
          await latest.current.port.toggleSourceBreakpoint({
            source: request(document),
            line,
            ...options,
          });
          if (current())
            await latest.current.breakpoints?.set(document, line, present, current, true, options);
          if (current()) setMessage(null);
        } catch (cause) {
          if (current())
            setMessage(
              cause instanceof Error
                ? cause.message
                : "The source breakpoint could not be changed.",
            );
          throw cause;
        }
      },
      async runToCursor(document, line) {
        let current: (() => boolean) | undefined;
        try {
          current = operation(document, true);
          if (
            !live ||
            snapshot!.debuggerState!.status !== "suspended" ||
            !snapshot!.debuggerState!.stopId
          )
            throw new Error("Run to Cursor requires a suspended Structured Java debugger session.");
          if (
            !approval ||
            approval.document.path !== document.path ||
            approval.document.text !== document.text ||
            approval.document.version !== document.version ||
            approval.lifetime !== latest.current.editor.bufferLifetime(document.path)
          )
            throw new Error("The debugger source binding is obsolete; refresh the editor.");
          if (
            !Number.isSafeInteger(line) ||
            line < 1 ||
            line > document.text.split(/\r\n|\n|\r/).length
          )
            throw new Error("Choose an existing Java source line for Run to Cursor.");
          if (approval.breakpoints.some((point) => point.line === line))
            throw new Error(
              "A breakpoint already exists on this line; remove it before Run to Cursor.",
            );
          if (!latest.current.port.runToCursor)
            throw new Error("Run to Cursor is unavailable from this debugger provider.");
          await latest.current.port.runToCursor({ source: request(document), line });
          if (current()) setMessage(null);
        } catch (cause) {
          if (current?.())
            setMessage(
              cause instanceof Error ? cause.message : "Run to Cursor could not be started.",
            );
          throw cause;
        }
      },
    };
  }, [
    dependencies.port,
    dependencies.workspaceId,
    dependencies.generation,
    dependencies.breakpoints?.points,
    binding,
  ]);
  return { debugging, message: debugging ? message : null };
}
