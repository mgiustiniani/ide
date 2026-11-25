import { useCallback, useEffect, useRef, useState } from "react";
import type {
  JavaEditorDiagnosticsRequest,
  JavaEditorDiagnosticsResult,
  JavaEffectiveProjectContext,
  JavaProjectContextSettings,
  LanguageDiagnostic,
} from "@ide/contracts";
import type { EditorViewModel, JavaEditorDiagnosticsPort } from "@ide/web-core";
import type { ProblemItem } from "@ide/ui";

interface Dependencies {
  port: JavaEditorDiagnosticsPort;
  workspaceId: string | null;
  generation: number;
  activeDocument: { path: string; text: string } | null;
  getEditorState(): { contents: Record<string, string> };
  navigate(
    location: { path: string; range: LanguageDiagnostic["range"] },
    canReveal: (afterOpen: boolean) => boolean,
  ): Promise<boolean>;
  getContext(): { workspaceId: string | null; generation: number; isSwitching: boolean };
  getProjectContext(): {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
  };
  editor: Pick<EditorViewModel, "captureEditorBuffers">;
  subscribeEditor(listener: () => void): () => void;
  onProjectContextRetired(message: string): void;
}
const SOURCE_ANALYSIS_UNAVAILABLE =
  "RefactorKit cannot analyze Java source for this project. Project build settings remain available.";
type Ready = Extract<JavaEditorDiagnosticsResult, { status: "ready" }>;
interface Frame {
  port: JavaEditorDiagnosticsPort;
  request: JavaEditorDiagnosticsRequest;
  verify(): void;
  contextKey: string;
}
function projectKey(dependencies: Dependencies): string {
  const { settings, context } = dependencies.getProjectContext();
  return JSON.stringify({
    settings,
    status: context?.status,
    schema: context?.schemaVersion,
    snapshot: context?.snapshotHash,
    hash: context?.contextHash,
    sdk: context?.sdk,
    semanticAnalysis: context?.semanticAnalysis,
  });
}

/** Compiler checks preserve drafts and expire with their complete editor frame. */
export function useJavaEditorDiagnosticsController(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const pending = useRef<Frame | null>(null);
  const accepted = useRef<(Frame & { result: Ready }) | null>(null);
  const mounted = useRef(true);
  const navigation = useRef<symbol | null>(null);
  const resumeAutomatic = useRef<(() => void) | null>(null);
  const scheduled = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [automatic, setAutomatic] = useState(false);
  const clearScheduled = useCallback(() => {
    if (scheduled.current !== null) clearTimeout(scheduled.current);
    scheduled.current = null;
  }, []);
  const [state, setState] = useState<{
    busy: boolean;
    message: string | null;
    result: Ready | null;
  }>({ busy: false, message: null, result: null });
  const key = projectKey(dependencies);
  const current = useCallback((frame: Frame) => {
    const context = latest.current.getContext();
    if (
      !mounted.current ||
      context.isSwitching ||
      context.workspaceId !== frame.request.workspaceId ||
      context.generation !== frame.request.generation ||
      projectKey(latest.current) !== frame.contextKey
    )
      return false;
    try {
      frame.verify();
      return true;
    } catch {
      return false;
    }
  }, []);
  const invalidate = useCallback((message: string | null = null, preserveNavigation = false) => {
    if (!preserveNavigation) navigation.current = null;
    const frame = pending.current;
    pending.current = null;
    accepted.current = null;
    if (frame) void frame.port.cancel(frame.request.requestId).catch(() => undefined);
    if (mounted.current) setState({ busy: false, result: null, message });
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [invalidate]);
  useEffect(() => {
    invalidate();
  }, [dependencies.workspaceId, dependencies.generation, dependencies.port, key, invalidate]);
  useEffect(
    () =>
      dependencies.subscribeEditor(() => {
        const frame = pending.current ?? accepted.current;
        if (frame && !current(frame))
          invalidate("Java buffers changed; run the compiler check again.", true);
      }),
    [dependencies.subscribeEditor, current, invalidate],
  );

  const check = useCallback(async () => {
    clearScheduled();
    invalidate();
    const d = latest.current,
      workspace = d.getContext(),
      selected = d.getProjectContext();
    const active = d.activeDocument;
    if (
      !workspace.workspaceId ||
      workspace.isSwitching ||
      !active?.path.endsWith(".java") ||
      !selected.settings.sdkHome.trim() ||
      selected.context?.status !== "available"
    ) {
      setState({
        busy: false,
        result: null,
        message:
          "Open a Java source and synchronize its project with a selected JDK before checking compiler errors.",
      });
      return;
    }
    if (selected.context.semanticAnalysis?.availability === "unqualified") {
      setState({ busy: false, result: null, message: SOURCE_ANALYSIS_UNAVAILABLE });
      return;
    }
    let frame: Frame;
    try {
      const capture = d.editor.captureEditorBuffers();
      const projectPath = selected.settings.projectPath;
      const legacyPaths =
        selected.context.schemaVersion === "java-project-context-v1" ||
        selected.context.schemaVersion === "java-project-context-v2";
      const buildInputs = new Set(
        selected.context.buildEvidence.map(({ path }) =>
          legacyPaths ? [projectPath, path].filter(Boolean).join("/") : path,
        ),
      );
      const dirtyBuildInput = capture.documents.find(
        (document) => (document.isDirty || document.isNew) && buildInputs.has(document.path),
      );
      if (dirtyBuildInput)
        throw new Error(
          `Build input ${dirtyBuildInput.path} has unsaved changes; save or discard them and synchronize the project before checking Java compiler errors.`,
        );
      const documents = capture.documents.filter(
        (document) =>
          document.path.endsWith(".java") &&
          (!projectPath || document.path.startsWith(`${projectPath}/`)),
      );
      const document = documents.find(
        (document) => document.path === active.path && document.text === active.text,
      );
      if (!document)
        throw new Error(
          "The active source is outside the synchronized project or its editor is changing.",
        );
      frame = {
        port: d.port,
        verify: capture.verify,
        contextKey: projectKey(d),
        request: {
          workspaceId: workspace.workspaceId,
          generation: workspace.generation,
          requestId: `java-errors-${crypto.randomUUID()}`,
          projectContext: {
            ...structuredClone(selected.settings),
            contextSchemaVersion: selected.context.schemaVersion,
            snapshotHash: selected.context.snapshotHash,
            contextHash: selected.context.contextHash,
            platformIdentities: selected.context.sdk.map((sdk) => sdk.identitySha256),
          },
          document: { path: document.path, text: document.text, version: document.version },
          editorOverlay: {
            documents: documents.map(({ path, text, version }) => ({ path, text, version })),
          },
          limit: 500,
        },
      };
      if (!current(frame)) throw new Error("The Java editor changed before the compiler check.");
    } catch (error) {
      setState({
        busy: false,
        result: null,
        message:
          error instanceof Error
            ? error.message
            : "Wait for editor file operations before checking Java compiler errors.",
      });
      return;
    }
    pending.current = frame;
    setState({ busy: true, result: null, message: "Checking Java compiler errors…" });
    try {
      const result = await frame.port.query(frame.request);
      if (pending.current !== frame) return;
      if (!current(frame)) {
        invalidate("Java buffers or project context changed; run the compiler check again.");
        return;
      }
      if (result.status !== "ready") {
        pending.current = null;
        setState({ busy: false, result: null, message: result.message });
        if (result.projectContextRetired) d.onProjectContextRetired(result.message);
        return;
      }
      if (
        result.workspaceId !== frame.request.workspaceId ||
        result.generation !== frame.request.generation ||
        result.requestId !== frame.request.requestId ||
        result.snapshotHash !== frame.request.projectContext.snapshotHash ||
        result.projectContext.contextHash !== frame.request.projectContext.contextHash ||
        !result.complete ||
        result.editorOverlay.documents.length !== frame.request.editorOverlay.documents.length ||
        frame.request.editorOverlay.documents.some(
          (document) =>
            !result.editorOverlay.documents.some(
              (actual) => actual.path === document.path && actual.version === document.version,
            ),
        )
      )
        throw new Error("Uncorrelated Java compiler errors.");
      pending.current = null;
      accepted.current = { ...frame, result };
      setState({
        busy: false,
        result,
        message: `${result.total} Java compiler ${result.total === 1 ? "error" : "errors"} in ${result.analyzedSourceCount} analyzed ${result.analyzedSourceCount === 1 ? "source" : "sources"}.`,
      });
    } catch {
      if (pending.current === frame)
        invalidate("Java compiler errors are unavailable; no compiler-check result was accepted.");
    }
  }, [clearScheduled, current, invalidate]);
  useEffect(() => {
    if (!automatic) return;
    let lastSignature: string | null = null;
    const schedule = () => {
      const d = latest.current;
      const workspace = d.getContext();
      const selected = d.getProjectContext();
      if (
        navigation.current !== null ||
        !workspace.workspaceId ||
        workspace.isSwitching ||
        !d.activeDocument?.path.endsWith(".java") ||
        !selected.settings.sdkHome.trim() ||
        selected.context?.status !== "available"
      ) {
        clearScheduled();
        lastSignature = null;
        return;
      }
      if (selected.context.semanticAnalysis?.availability === "unqualified") {
        clearScheduled();
        lastSignature = null;
        setState({ busy: false, result: null, message: SOURCE_ANALYSIS_UNAVAILABLE });
        return;
      }
      let signature: string;
      try {
        signature = JSON.stringify(
          d.editor.captureEditorBuffers().documents.map(({ path, version, isDirty, isNew }) => ({
            path,
            version,
            isDirty,
            isNew,
          })),
        );
      } catch {
        clearScheduled();
        lastSignature = null;
        return;
      }
      if (signature === lastSignature) return;
      lastSignature = signature;
      clearScheduled();
      const frame = pending.current ?? accepted.current;
      if (frame && current(frame)) return;
      scheduled.current = setTimeout(() => {
        scheduled.current = null;
        if (navigation.current !== null) {
          lastSignature = null;
          return;
        }
        void check();
      }, 750);
    };
    resumeAutomatic.current = schedule;
    schedule();
    const unsubscribe = dependencies.subscribeEditor(schedule);
    return () => {
      unsubscribe();
      if (resumeAutomatic.current === schedule) resumeAutomatic.current = null;
      clearScheduled();
    };
  }, [
    automatic,
    dependencies.workspaceId,
    dependencies.generation,
    dependencies.port,
    dependencies.activeDocument?.path,
    dependencies.activeDocument?.text,
    dependencies.subscribeEditor,
    key,
    check,
    clearScheduled,
    current,
  ]);
  const setAutomaticChecks = useCallback(
    (enabled: boolean) => {
      clearScheduled();
      setAutomatic(enabled);
      if (!enabled && pending.current) invalidate("Automatic Java compiler checks paused.");
    },
    [clearScheduled, invalidate],
  );
  const openProblem = useCallback(
    async (problemId: string): Promise<boolean> => {
      const frame = accepted.current;
      if (!frame || !current(frame)) return false;
      const index = frame.result.items.findIndex(
        (_, index) => problemId === `${frame.result.requestId}-${index}`,
      );
      const item = frame.result.items[index];
      const target =
        item && frame.result.sourceFiles.find((file) => file.path === item.location.path);
      if (!item || !target) return false;
      let verifyExistingBuffers: () => void;
      try {
        verifyExistingBuffers = latest.current.editor.captureEditorBuffers({
          allowNewBuffers: true,
        }).verify;
      } catch {
        return false;
      }
      const token = Symbol(problemId);
      navigation.current = token;
      const canReveal = (afterOpen: boolean) => {
        const d = latest.current,
          context = d.getContext();
        if (
          !mounted.current ||
          navigation.current !== token ||
          context.isSwitching ||
          context.workspaceId !== frame.request.workspaceId ||
          context.generation !== frame.request.generation ||
          projectKey(d) !== frame.contextKey
        )
          return false;
        try {
          verifyExistingBuffers();
        } catch {
          return false;
        }
        const contents = d.getEditorState().contents;
        return (
          (!afterOpen && !Object.hasOwn(contents, target.path)) ||
          contents[target.path] === target.text
        );
      };
      let opened = false;
      try {
        opened = await latest.current.navigate(item.location, canReveal);
      } catch {
        /* No reveal after an opener failure. */
      }
      if (navigation.current === token) {
        navigation.current = null;
        if (!opened && mounted.current)
          invalidate(
            "The Java diagnostic source changed or could not be opened; run the compiler check again.",
          );
      }
      resumeAutomatic.current?.();
      return opened;
    },
    [current, invalidate],
  );

  // Verify again during render so an unobserved workspace/context change cannot expose markers.
  const frame = accepted.current;
  const result = state.result && frame && current(frame) ? state.result : null;
  const active = dependencies.activeDocument;
  const document =
    result && active
      ? frame?.request.editorOverlay.documents.find(
          (document) => document.path === active.path && document.text === active.text,
        )
      : undefined;
  const activeDiagnostics: LanguageDiagnostic[] =
    result && document
      ? result.items
          .filter((item) => item.location.path === document.path)
          .map((item) => ({
            severity: "error",
            code: item.code,
            message: item.message,
            range: item.location.range,
            source: "RefactorKit Java compiler",
          }))
      : [];
  const problemItems: ProblemItem[] = result
    ? result.items.map((item, index) => ({
        id: `${result.requestId}-${index}`,
        provider: "RefactorKit Java compiler",
        filePath: item.location.path,
        severity: item.severity,
        range: item.location.range,
        code: item.code,
        message: item.message,
      }))
    : [];
  return {
    check,
    automatic,
    setAutomaticChecks,
    openProblem,
    cancel: () => invalidate("Java compiler check canceled."),
    busy: state.busy,
    message: state.result && !result ? null : state.message,
    result,
    checkedProjectPath: result ? frame!.request.projectContext.projectPath : undefined,
    activeDiagnostics,
    activeDiagnosticDocument: document
      ? { path: document.path, version: document.version }
      : undefined,
    activeDiagnosticOwner: "refactorkit-java-compiler",
    problemItems,
  };
}
