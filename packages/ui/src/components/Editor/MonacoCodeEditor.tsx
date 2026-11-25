import { registerJavaLaunch } from "./javaLaunch";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import React, {
  Component,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  JavaCodeActionGenerationSelection,
  JavaCodeActionMemberSelection,
} from "@ide/contracts";
import { configureLocalMonaco } from "../../monaco/bootstrap";
import type { LanguageDiagnostic } from "../diagnostics";
import type { EditorProps, JavaEditorSemantics, JavaEditorNavigation } from "./Editor";
import {
  registerJavaImplementationNavigation,
  registerJavaNavigationProviders,
} from "./javaNavigation";
import { registerJavaDebugger } from "./javaDebugger";
import { registerJavaCoverage } from "./javaCoverage";
import { registerJavaFileActions } from "./javaFileActions";
import { registerJavaReferencesAction } from "./javaReferencesAction";
import { registerJavaDefinitionAction } from "./javaDefinitionAction";
import { registerJavaSemanticProviders, registerJavaOnTypeFormattingProvider } from "./javaSemantics";
import { registerJavaTemplates } from "./javaTemplates";
import { getMonacoLanguage, getMonacoModelPath } from "./monacoLanguage";

export { getMonacoLanguage, getMonacoModelPath } from "./monacoLanguage";

configureLocalMonaco();

type MonacoCodeEditorProps = Pick<
  EditorProps,
  | "content"
  | "diagnosticOwner"
  | "diagnostics"
  | "documentIdentity"
  | "filePath"
  | "modelUri"
  | "javaSemantics"
  | "javaTemplateProjectContext"
  | "javaTemplateProjectPath"
  | "javaNavigation"
  | "javaDebugger"
  | "javaLaunch"
  | "javaCoverage"
  | "javaFileActions"
  | "language"
  | "onChange"
  | "onWorkspaceDocumentChanges"
  | "onCursorPositionChange"
  | "onFindJavaReferences"
  | "onGoToJavaDefinition"
  | "onNavigateJavaDefinition"
  | "onRevealHandled"
  | "revealRequest"
  | "readOnly"
  | "workspaceEditorPreferences"
> & {
  attempt: number;
  initialSize: { width: number; height: number };
  isRenderable: boolean;
  onFailure: (reason: string) => void;
  onReadyChange: (ready: boolean) => void;
};

type ErrorBoundaryProps = {
  children: React.ReactNode;
  onError: (error: Error) => void;
  resetKey: number;
};

type ErrorBoundaryState = { error: Error | null };

class MonacoErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): React.ReactNode {
    return this.state.error ? null : this.props.children;
  }
}

function detectTheme(): "ide-java-dark" | "ide-java-light" {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark"))
    return "ide-java-dark";
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches)
    return "ide-java-dark";
  return "ide-java-light";
}

function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message ? `Monaco failed: ${message}` : "Monaco failed to start.";
}

type MemberSelectionDialogProps = {
  selection: JavaCodeActionMemberSelection;
  onCancel: () => void;
  onConfirm: (selection: JavaCodeActionGenerationSelection) => void;
};

function MemberSelectionDialog({
  selection,
  onCancel,
  onConfirm,
}: MemberSelectionDialogProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(selection.groups.map((group) => [group.id, group.selectedKeys])),
  );
  const selectedKeys = (id: string) => selected[id] ?? [];
  const requiredGroup =
    selection.kind === "constructors"
      ? "constructors"
      : selection.kind === "hashCodeEquals"
        ? "fields"
        : selection.kind === "overrideMethods"
          ? "overridableMethods"
          : "delegateMethods";
  const canGenerate = selectedKeys(requiredGroup).length > 0;

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Tab") {
            const focusable = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
              ) ?? [],
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="border-b border-[var(--border-default)] px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
            {selection.kind === "overrideMethods"
              ? "Select methods to override or implement"
              : selection.kind === "delegateMethods"
                ? "Select methods to delegate"
                : "Select members to generate"}
          </h2>
          <p id={descriptionId} className="mt-1 text-sm text-[var(--text-secondary)]">
            {selection.kind === "overrideMethods"
              ? "Choose inherited methods to add to the current Java type."
              : selection.kind === "delegateMethods"
                ? "Choose methods to forward through the listed fields."
                : "Choose the fields and constructors to include in the generated code."}
          </p>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {selection.groups.map((group) => (
            <fieldset key={group.id} className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-[var(--text-primary)]">
                {group.label}
              </legend>
              {group.members.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No eligible members.</p>
              ) : (
                group.members.map((member) => (
                  <label
                    key={member.selectionKey}
                    className="flex cursor-pointer items-start gap-3 rounded border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2 text-sm"
                  >
                    <input
                      aria-label={`${member.name}${member.detail ? ` ${member.detail}` : ""}`}
                      checked={selectedKeys(group.id).includes(member.selectionKey)}
                      className="mt-0.5"
                      type="checkbox"
                      onChange={(event) =>
                        setSelected((current) => ({
                          ...current,
                          [group.id]: event.target.checked
                            ? [...(current[group.id] ?? []), member.selectionKey]
                            : (current[group.id] ?? []).filter(
                                (key) => key !== member.selectionKey,
                              ),
                        }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-[var(--text-primary)]">
                        {member.name}
                      </span>
                      {member.detail && (
                        <span className="block break-words text-xs text-[var(--text-muted)]">
                          {member.detail}
                        </span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </fieldset>
          ))}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--border-default)] px-5 py-4">
          <button
            className="rounded border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)]"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded bg-[var(--accent-blue)] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canGenerate}
            type="button"
            onClick={() =>
              onConfirm({
                kind: selection.kind,
                selectedFieldBindingKeys: [...selectedKeys("fields")],
                selectedConstructorBindingKeys: [...selectedKeys("constructors")],
                selectedOverridableMethodKeys: [...selectedKeys("overridableMethods")],
                selectedDelegateMethodKeys: [...selectedKeys("delegateMethods")],
              })
            }
          >
            Generate
          </button>
        </footer>
      </div>
    </div>
  );
}

const MONACO_MARKER_SEVERITY = {
  hint: 1,
  info: 2,
  warning: 4,
  information: 2,
  error: 8,
} as const;

type MarkerModel = Pick<Monaco.editor.ITextModel, "getLineCount" | "getLineMaxColumn">;

function safeInteger(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function clampMarkerPosition(
  model: MarkerModel,
  line: number,
  character: number,
): { lineNumber: number; column: number } {
  const lineNumber = Math.min(
    Math.max(safeInteger(line) + 1, 1),
    Math.max(1, model.getLineCount()),
  );
  const column = Math.min(
    Math.max(safeInteger(character) + 1, 1),
    Math.max(1, model.getLineMaxColumn(lineNumber)),
  );
  return { lineNumber, column };
}

/** Converts a zero-based, end-exclusive provider diagnostic to a clamped Monaco marker. */
export function toMonacoMarker(
  model: MarkerModel,
  diagnostic: LanguageDiagnostic,
): Monaco.editor.IMarkerData {
  const start = clampMarkerPosition(
    model,
    diagnostic.range.start.line,
    diagnostic.range.start.character,
  );
  let end = clampMarkerPosition(model, diagnostic.range.end.line, diagnostic.range.end.character);
  if (
    end.lineNumber < start.lineNumber ||
    (end.lineNumber === start.lineNumber && end.column < start.column)
  ) {
    end = start;
  }
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
    severity: MONACO_MARKER_SEVERITY[diagnostic.severity],
    message: diagnostic.message,
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
    ...(diagnostic.code !== undefined ? { code: String(diagnostic.code) } : {}),
  };
}

export function MonacoCodeEditor({
  attempt,
  content,
  filePath,
  modelUri,
  initialSize,
  isRenderable,
  language,
  readOnly = false,
  javaSemantics,
  javaTemplateProjectContext,
  javaTemplateProjectPath,
  javaNavigation,
  javaDebugger,
  javaLaunch,
  javaCoverage,
  javaFileActions,
  onChange,
  onWorkspaceDocumentChanges,
  onCursorPositionChange,
  onFindJavaReferences,
  onGoToJavaDefinition,
  onNavigateJavaDefinition,
  onRevealHandled,
  onFailure,
  onReadyChange,
  revealRequest,
  diagnostics = [],
  documentIdentity,
  diagnosticOwner = "language-diagnostics",
  workspaceEditorPreferences,
}: MonacoCodeEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const syncingExternalContentRef = useRef(false);
  const cursorCallbackRef = useRef(onCursorPositionChange);
  cursorCallbackRef.current = onCursorPositionChange;
  const monacoRef = useRef<typeof Monaco | null>(null);
  const markerRegistrationRef = useRef<{
    model: Monaco.editor.ITextModel;
    owner: string;
    api: typeof Monaco;
  } | null>(null);
  const semanticsRef = useRef<JavaEditorSemantics | undefined>(javaSemantics);
  const navigationRef = useRef<JavaEditorNavigation | undefined>(javaNavigation);
  const navigateJavaDefinitionRef = useRef(onNavigateJavaDefinition);
  navigateJavaDefinitionRef.current = onNavigateJavaDefinition;
  const modelViewStateRef = useRef<{
    filePath: string;
    modelPath: string;
    state: NonNullable<ReturnType<Monaco.editor.IStandaloneCodeEditor["saveViewState"]>>;
  } | null>(null);
  navigationRef.current = javaNavigation;
  const debuggerRef = useRef(javaDebugger);
  const hasJavaLaunch = Boolean(javaLaunch);
  const javaLaunchWorkspaceId = javaLaunch?.context.workspaceId;
  const javaLaunchGeneration = javaLaunch?.context.generation;
  const launchRef = useRef(javaLaunch);
  launchRef.current = javaLaunch;
  const invalidatedCoverageRef = useRef(new Set<string>());
  const sourceRefreshRef = useRef<(() => void) | undefined>(undefined);
  debuggerRef.current = javaDebugger;
  const fileActionsRef = useRef(javaFileActions);
  fileActionsRef.current = javaFileActions;
  const [fileActionStatus, setFileActionStatus] = useState<string | null>(null);
  const [javaNavigationStatus, setJavaNavigationStatus] = useState<string | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const [pendingMemberSelection, setPendingMemberSelection] = useState<{
    id: number;
    selection: JavaCodeActionMemberSelection;
  } | null>(null);
  const memberSelectionDialogIdRef = useRef(0);
  const memberSelectionWasOpenRef = useRef(false);
  const memberSelectionResolverRef = useRef<
    ((selection: JavaCodeActionGenerationSelection | null) => void) | null
  >(null);
  const selectCodeActionMembers = useCallback(
    (selection: JavaCodeActionMemberSelection) =>
      new Promise<JavaCodeActionGenerationSelection | null>((resolve) => {
        memberSelectionResolverRef.current?.(null);
        memberSelectionResolverRef.current = resolve;
        memberSelectionDialogIdRef.current += 1;
        setPendingMemberSelection({ id: memberSelectionDialogIdRef.current, selection });
      }),
    [],
  );
  const finishMemberSelection = useCallback(
    (selection: JavaCodeActionGenerationSelection | null) => {
      const resolve = memberSelectionResolverRef.current;
      memberSelectionResolverRef.current = null;
      setPendingMemberSelection(null);
      resolve?.(selection);
    },
    [],
  );
  const handledRevealRef = useRef<{ filePath: string; requestId: string | number } | null>(null);
  const layoutFrameRef = useRef<number | null>(null);
  const renderableRef = useRef(isRenderable);
  const readyRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [debugSourceStatus, setDebugSourceStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  useEffect(
    () => () => {
      memberSelectionResolverRef.current?.(null);
      memberSelectionResolverRef.current = null;
    },
    [],
  );
  renderableRef.current = isRenderable;
  semanticsRef.current = javaSemantics;
  const semanticContext = javaSemantics?.context;
  const revealFilePath = revealRequest?.filePath;
  const revealLine = revealRequest?.line;
  const revealColumn = revealRequest?.column;
  const revealRequestId = revealRequest?.requestId;
  const revealSelection = revealRequest?.selection;
  const hasDiagnosticDocumentIdentity = Boolean(documentIdentity);
  const diagnosticDocumentPath = documentIdentity?.path;
  const modelPath = useMemo(
    () => modelUri ?? (
      semanticContext?.document.path === filePath
        ? semanticContext.document.uri
        : getMonacoModelPath(filePath)),
    [filePath, modelUri, semanticContext?.document.path, semanticContext?.document.uri],
  );
  const canonicalModelPath = useCallback(
    () => monacoRef.current?.Uri.parse(modelPath).toString() ?? modelPath,
    [modelPath],
  );
  useEffect(() => {
    const host = hostRef.current;
    if (!host?.ownerDocument.body.hasAttribute("data-native-java-navigation-diagnostics")) return;
    host.setAttribute("data-editor-layout-ready", String(layoutReady));
    host.setAttribute("data-editor-mounted", String(mounted));
    host.setAttribute("data-editor-renderable", String(isRenderable));
    host.setAttribute("data-editor-size", `${initialSize.width}x${initialSize.height}`);
    host.setAttribute("data-editor-file-path", filePath);
    host.setAttribute("data-editor-model-path", modelPath);
    host.setAttribute("data-editor-document-identity-path", documentIdentity?.path ?? "");
    host.setAttribute("data-editor-semantic-document-path", semanticContext?.document.path ?? "");
    host.setAttribute("data-editor-semantic-document-uri", semanticContext?.document.uri ?? "");
    host.setAttribute("data-reveal-file-path", revealFilePath ?? "");
  }, [
    documentIdentity?.path,
    filePath,
    initialSize.height,
    initialSize.width,
    isRenderable,
    layoutReady,
    modelPath,
    mounted,
    revealFilePath,
    semanticContext?.document.path,
    semanticContext?.document.uri,
  ]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!mounted || !editor) return;
    const expectedModelPath = canonicalModelPath();
    const synchronizeModel = (): void => {
      const model = editor.getModel();
      if (
        !model ||
        typeof model.getValue !== "function" ||
        model.uri.toString() !== expectedModelPath ||
        model.getValue() === content
      )
        return;

      // A model can be reattached while the server restarts. Reconcile the visible
      // editor with the accepted buffer even if Monaco's controlled-value update
      // ran before that model was ready.
      syncingExternalContentRef.current = true;
      try {
        const edits = [
          { range: model.getFullModelRange(), text: content, forceMoveMarkers: true },
        ];
        if (!editor.executeEdits("editor-buffer-sync", edits)) {
          // The accepted buffer can change while a workspace write keeps the
          // editor read-only. Model edits preserve undo without enabling input.
          model.pushEditOperations(editor.getSelections() ?? [], edits, () => null);
        }
        editor.pushUndoStop();
      } finally {
        syncingExternalContentRef.current = false;
      }
    };
    synchronizeModel();
    const modelChange = editor.onDidChangeModel(synchronizeModel);
    return () => modelChange.dispose();
  }, [canonicalModelPath, content, modelPath, mounted]);
  useEffect(() => {
    if (pendingMemberSelection) {
      memberSelectionWasOpenRef.current = true;
      return;
    }
    if (!memberSelectionWasOpenRef.current) return;
    memberSelectionWasOpenRef.current = false;
    const editor = editorRef.current;
    if (editor?.getModel()?.uri.toString() === canonicalModelPath()) editor.focus();
  }, [canonicalModelPath, pendingMemberSelection]);
  const monacoLanguage = useMemo(() => getMonacoLanguage(language, filePath), [filePath, language]);

  const layoutEditor = useCallback(
    (preferredSize?: { width: number; height: number }): void => {
      const host = hostRef.current;
      const editor = editorRef.current;
      if (!host || !editor || !renderableRef.current) return;

      const rect = host.getBoundingClientRect();
      const width = Math.max(0, rect.width || host.clientWidth || preferredSize?.width || 0);
      const height = Math.max(0, rect.height || host.clientHeight || preferredSize?.height || 0);
      if (width <= 0 || height <= 0) return;

      try {
        editor.layout({ width, height });
        if (!readyRef.current) {
          readyRef.current = true;
          setMounted(true);
          setLayoutReady(true);
          onReadyChange(true);
        }
      } catch (error) {
        onFailure(describeFailure(error));
      }
    },
    [onFailure, onReadyChange],
  );

  const scheduleLayout = useCallback(
    (preferredSize?: { width: number; height: number }): void => {
      if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
      layoutFrameRef.current = requestAnimationFrame(() => {
        layoutFrameRef.current = null;
        layoutEditor(preferredSize);
      });
    },
    [layoutEditor],
  );

  useLayoutEffect(() => {
    // The parent guards readiness by active file. A reused Monaco instance must
    // acknowledge layout again for a new model/readiness callback, not just mount.
    readyRef.current = false;
    setLayoutReady(false);
    const host = hostRef.current;
    if (!host) return;

    const measure = (): void => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(
        0,
        rect.width || host.clientWidth || (isRenderable ? initialSize.width : 0),
      );
      const height = Math.max(
        0,
        rect.height || host.clientHeight || (isRenderable ? initialSize.height : 0),
      );
      if (isRenderable && width > 0 && height > 0) scheduleLayout({ width, height });
    };

    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(host);
    if (!observer) window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", measure);
      if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
      layoutFrameRef.current = null;
    };
  }, [attempt, modelPath, initialSize.height, initialSize.width, isRenderable, scheduleLayout]);

  useEffect(() => {
    const editor = editorRef.current;
    const expectedModelPath = canonicalModelPath();
    const revealHost = hostRef.current;
    const debugReveal = revealHost?.ownerDocument.body.hasAttribute(
      "data-native-java-navigation-diagnostics",
    );
    const recordRevealState = (state: string) => {
      if (debugReveal) revealHost?.setAttribute("data-reveal-debug-state", state);
    };
    const recordRevealModel = (model: Monaco.editor.ITextModel | null) => {
      if (!debugReveal) return;
      revealHost?.setAttribute("data-reveal-attached-model-path", model?.uri.toString() ?? "");
      revealHost?.setAttribute(
        "data-reveal-attached-model-content-match",
        String(Boolean(model && model.getValue() === content)),
      );
    };
    if (!mounted) recordRevealState("editor-not-mounted");
    else if (!layoutReady) recordRevealState("layout-not-ready");
    else if (!editor) recordRevealState("editor-missing");
    else if (revealFilePath !== filePath) recordRevealState("request-file-mismatch");
    else if (revealLine === undefined || revealRequestId === undefined)
      recordRevealState("request-incomplete");
    if (
      !mounted ||
      !layoutReady ||
      !editor ||
      revealFilePath !== filePath ||
      revealLine === undefined ||
      revealRequestId === undefined
    )
      return;
    recordRevealState("eligible");
    recordRevealModel(editor.getModel());
    const requestId = revealRequestId;
    const handled = handledRevealRef.current;
    if (handled?.filePath === filePath && Object.is(handled.requestId, requestId)) return;

    let modelChange: Monaco.IDisposable | undefined;
    let modelContentChange: Monaco.IDisposable | undefined;
    let observedModel: Monaco.editor.ITextModel | null = null;
    let revealFrame: number | undefined;
    let revealAttempts = 0;
    let stableFrames = 0;
    let revealApplied = false;
    let cursorChange: Monaco.IDisposable | undefined;
    const position = (model: Monaco.editor.ITextModel) =>
      model.validatePosition({
        lineNumber: revealLine,
        column: revealColumn ?? 1,
      });
    const observeCurrentModel = (): Monaco.editor.ITextModel | null => {
      const model = editor.getModel();
      if (!model || model.uri.toString() !== expectedModelPath) return null;
      if (observedModel !== model) {
        modelContentChange?.dispose();
        observedModel = model;
        modelContentChange = model.onDidChangeContent(() => {
          if (model.getValue() === content) scheduleReveal();
        });
      }
      return model;
    };
    const modelIsReady = (
      model: Monaco.editor.ITextModel | null,
    ): model is Monaco.editor.ITextModel =>
      Boolean(
        layoutReady &&
        model &&
        model.uri.toString() === expectedModelPath &&
        model.getValue() === content,
      );
    const applyReveal = (): boolean => {
      const model = observeCurrentModel();
      // A file switch updates React props before Monaco has necessarily attached
      // that file's settled buffer. Do not reveal against an old file or text.
      if (!modelIsReady(model)) return false;

      const target = position(model);
      // Focus first so WebKit and Monaco restore the active editor before the
      // requested selection replaces its saved caret.
      editor.focus();
      if (revealSelection)
        editor.setSelection({
          startLineNumber: revealSelection.start.line + 1,
          startColumn: revealSelection.start.character + 1,
          endLineNumber: revealSelection.end.line + 1,
          endColumn: revealSelection.end.character + 1,
        });
      else editor.setPosition(target);
      editor.revealPositionInCenter(target);
      const host = hostRef.current;
      host?.setAttribute("data-reveal-requested-line", String(target.lineNumber));
      return true;
    };
    const positionMatches = (): boolean => {
      const model = observeCurrentModel();
      if (!modelIsReady(model)) return false;
      if (revealSelection) {
        const selection = editor.getSelection();
        return Boolean(
          selection &&
          selection.startLineNumber === revealSelection.start.line + 1 &&
          selection.startColumn === revealSelection.start.character + 1 &&
          selection.endLineNumber === revealSelection.end.line + 1 &&
          selection.endColumn === revealSelection.end.character + 1,
        );
      }
      const current = editor.getPosition();
      const target = position(model);
      return Boolean(
        current && current.lineNumber === target.lineNumber && current.column === target.column,
      );
    };

    const finishReveal = () => {
      const host = hostRef.current;
      const currentPosition = editor!.getPosition();
      if (host) {
        host.setAttribute("data-reveal-handled-request-id", String(requestId));
        if (currentPosition)
          host.setAttribute("data-editor-cursor-line", String(currentPosition.lineNumber));
      }
      recordRevealState("handled");
      handledRevealRef.current = { filePath, requestId };
      onRevealHandled?.(requestId);
      modelChange?.dispose();
      modelChange = undefined;
      modelContentChange?.dispose();
      modelContentChange = undefined;
      cursorChange?.dispose();
      cursorChange = undefined;
    };
    const failReveal = () => {
      hostRef.current?.setAttribute("data-reveal-failed-request-id", String(requestId));
      recordRevealState("failed");
      modelChange?.dispose();
      modelChange = undefined;
      modelContentChange?.dispose();
      modelContentChange = undefined;
      cursorChange?.dispose();
      cursorChange = undefined;
    };
    const verifyReveal = () => {
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
      revealFrame = requestAnimationFrame(() => {
        revealFrame = undefined;
        if (positionMatches()) {
          stableFrames += 1;
          if (stableFrames >= 12) finishReveal();
          else verifyReveal();
          return;
        }
        stableFrames = 0;
        revealAttempts += 1;
        if (revealAttempts < 5) scheduleReveal();
        else failReveal();
      });
    };
    function scheduleReveal() {
      // @monaco-editor/react restores a document's saved caret after changing
      // models. Wait for the controlled buffer to match before applying and
      // confirming the location; content synchronization and saved-view restoration
      // can follow attachment. Keep checking until the position remains stable.
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
      revealFrame = requestAnimationFrame(() => {
        revealFrame = undefined;
        const model = observeCurrentModel();
        if (!modelIsReady(model)) {
          const attached = editor?.getModel();
          recordRevealModel(attached ?? null);
          recordRevealState(
            !attached
              ? "model-missing"
              : attached.uri.toString() !== expectedModelPath
                ? "model-path-mismatch"
                : "model-content-mismatch",
          );
          return;
        }
        recordRevealModel(model);
        if (!applyReveal()) {
          recordRevealState("apply-rejected");
          return;
        }
        recordRevealState("applied");
        revealApplied = true;
        stableFrames = 0;
        verifyReveal();
      });
    }

    cursorChange = editor.onDidChangeCursorPosition((event) => {
      if (event.source === "keyboard" || event.source === "mouse") {
        if (revealApplied) finishReveal();
        return;
      }
      if (revealApplied && !positionMatches()) {
        stableFrames = 0;
        revealAttempts += 1;
        if (revealAttempts < 5) scheduleReveal();
        else failReveal();
      }
    });
    modelChange = editor.onDidChangeModel(() => {
      const model = observeCurrentModel();
      if (modelIsReady(model)) scheduleReveal();
    });
    const model = observeCurrentModel();
    if (modelIsReady(model)) scheduleReveal();
    return () => {
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
      modelChange?.dispose();
      modelContentChange?.dispose();
      cursorChange?.dispose();
    };
  }, [
    filePath,
    content,
    canonicalModelPath,
    layoutReady,
    mounted,
    modelPath,
    revealColumn,
    revealFilePath,
    revealLine,
    revealRequestId,
    revealSelection,
    onRevealHandled,
  ]);

  useEffect(() => {
    const previous = markerRegistrationRef.current;
    if (previous) {
      previous.api.editor.setModelMarkers(previous.model, previous.owner, []);
      markerRegistrationRef.current = null;
    }

    const editor = editorRef.current;
    const api = monacoRef.current;
    const model = editor?.getModel();
    const diagnosticsMatchActiveFile =
      !hasDiagnosticDocumentIdentity || diagnosticDocumentPath === filePath;
    if (!mounted || !api || !model || !diagnosticsMatchActiveFile) return;

    const owner = diagnosticOwner.trim() || "language-diagnostics";
    api.editor.setModelMarkers(
      model,
      owner,
      diagnostics.map((diagnostic) => toMonacoMarker(model, diagnostic)),
    );
    markerRegistrationRef.current = { model, owner, api };

    return () => {
      if (
        markerRegistrationRef.current?.model === model &&
        markerRegistrationRef.current.owner === owner
      ) {
        api.editor.setModelMarkers(model, owner, []);
        markerRegistrationRef.current = null;
      }
    };
  }, [
    diagnosticDocumentPath,
    diagnosticOwner,
    diagnostics,
    filePath,
    hasDiagnosticDocumentIdentity,
    modelPath,
    mounted,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    const api = monacoRef.current;
    if (!mounted || !editor || !api || monacoLanguage !== "java") return;
    let registration: Monaco.IDisposable | undefined;
    const register = () => {
      registration?.dispose();
      registration = undefined;
      const model = editor.getModel();
      if (!model || model.isDisposed()) return;
      registration = registerJavaTemplates({
        api,
        model,
        filePath,
        projectContext: javaTemplateProjectContext,
        projectPath: javaTemplateProjectPath,
      });
    };
    const change = editor.onDidChangeModel(register);
    register();
    return () => {
      change.dispose();
      registration?.dispose();
    };
  }, [
    filePath,
    javaTemplateProjectContext,
    javaTemplateProjectPath,
    modelPath,
    monacoLanguage,
    mounted,
  ]);

  useEffect(() => {
    const editor = editorRef.current;
    const api = monacoRef.current;
    const model = editor?.getModel();
    if (
      !mounted ||
      !editor ||
      !api ||
      !model ||
      monacoLanguage !== "java" ||
      !javaSemantics?.context
    )
      return;

    return registerJavaSemanticProviders({
      api,
      editor,
      model,
      filePath,
      semantics: javaSemantics,
      getCurrentSemantics: () => semanticsRef.current,
      selectCodeActionMembers,
      onWorkspaceDocumentChanges,
    }).dispose;
  }, [
    filePath,
    javaSemantics,
    javaSemantics?.context?.document.path,
    javaSemantics?.context?.document.uri,
    javaSemantics?.context?.document.version,
    javaSemantics?.context?.generation,
    javaSemantics?.context?.workspaceId,
    modelPath,
    monacoLanguage,
    mounted,
    selectCodeActionMembers,
    onWorkspaceDocumentChanges,
  ]);

  useEffect(
    () => () => {
      const markers = markerRegistrationRef.current;
      if (markers) markers.api.editor.setModelMarkers(markers.model, markers.owner, []);
      markerRegistrationRef.current = null;
      editorRef.current = null;
      monacoRef.current = null;
      if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
      layoutFrameRef.current = null;
      readyRef.current = false;
    },
    [],
  );

  const onTypeBinding = useRef<{
    filePath: string;
    modelPath: string;
    scope: NonNullable<JavaEditorSemantics["context"]>;
    triggers: readonly string[];
  } | null>(null);
  if (javaSemantics?.context) {
    onTypeBinding.current = javaSemantics.onTypeFormattingTriggers?.length ? {
      filePath, modelPath, scope: javaSemantics.context,
      triggers: javaSemantics.onTypeFormattingTriggers,
    } : null;
  }
  const typingBinding = onTypeBinding.current;
  const canFormatOnType = Boolean(typingBinding && typingBinding.filePath === filePath &&
    typingBinding.modelPath === modelPath && (!documentIdentity?.workspaceId ||
      typingBinding.scope.workspaceId === documentIdentity.workspaceId));
  const onTypeTriggers = JSON.stringify(canFormatOnType ? typingBinding!.triggers : []);
  const onTypeWorkspace = canFormatOnType ? typingBinding!.scope.workspaceId : undefined;
  const onTypeGeneration = canFormatOnType ? typingBinding!.scope.generation : undefined;
  useEffect(() => {
    const editor = editorRef.current, api = monacoRef.current, model = editor?.getModel();
    const current = onTypeBinding.current;
    if (!mounted || !editor || !api || !model || readOnly || monacoLanguage !== "java" ||
      workspaceEditorPreferences?.formatJavaOnType !== true || !current ||
      current.filePath !== filePath || current.modelPath !== modelPath ||
      (documentIdentity?.workspaceId && current.scope.workspaceId !== documentIdentity.workspaceId)) return;
    return registerJavaOnTypeFormattingProvider({ api, editor, model, filePath,
      scope: current.scope, triggerCharacters: current.triggers,
      getCurrentSemantics: () => semanticsRef.current,
    }).dispose;
  }, [mounted, modelPath, monacoLanguage, filePath, readOnly, workspaceEditorPreferences?.formatJavaOnType,
    onTypeTriggers, onTypeWorkspace, onTypeGeneration, documentIdentity?.workspaceId]);
  const hasJavaSemantics = javaSemantics !== undefined;
  const navigationWorkspace = javaNavigation?.context.workspaceId;
  const navigationGeneration = javaNavigation?.context.generation;
  const hasDependencySource = Boolean(javaNavigation?.openDependencySource);
  const hasTypeDefinition = javaNavigation?.typeDefinitionAvailable === true || Boolean(javaSemantics?.typeDefinitions);
  useEffect(() => {
    setJavaNavigationStatus(null);
    const api = monacoRef.current;
    const editor = editorRef.current;
    const navigation = navigationRef.current;
    if (!mounted || !api || !editor || !navigation || monacoLanguage !== "java") return;
    let registration: Monaco.IDisposable | undefined;
    const register = () => {
      registration?.dispose();
      registration = undefined;
      const model = editor.getModel();
      if (!model || model.uri.toString() !== api.Uri.parse(modelPath).toString()) return;
      registration = registerJavaNavigationProviders({
        api,
        editor,
        model,
        filePath,
        navigation,
        getCurrentNavigation: () => navigationRef.current,
        getCurrentSemantics: () => semanticsRef.current,
        onNavigationStatus: setJavaNavigationStatus,
        getNavigateJavaDefinition: () => navigateJavaDefinitionRef.current,
      });
    };
    const change = editor.onDidChangeModel(register);
    register();
    return () => {
      change.dispose();
      registration?.dispose();
    };
  }, [mounted, filePath, navigationWorkspace, navigationGeneration, hasDependencySource, hasTypeDefinition, monacoLanguage, modelPath]);

  useEffect(() => {
    const api = monacoRef.current;
    const editor = editorRef.current;
    const navigation = navigationRef.current;
    if (
      !hasJavaSemantics ||
      !mounted ||
      !api ||
      !editor ||
      !navigation ||
      monacoLanguage !== "java"
    )
      return;
    const model = editor.getModel();
    if (!model || model.uri.toString() !== api.Uri.parse(modelPath).toString()) return;
    const registration = registerJavaImplementationNavigation({
      api,
      model,
      filePath,
      navigation,
      getCurrentNavigation: () => navigationRef.current,
      getCurrentSemantics: () => semanticsRef.current,
    });
    return () => registration.dispose();
  }, [mounted, filePath, navigationWorkspace, navigationGeneration, hasJavaSemantics, monacoLanguage, modelPath]);

  useEffect(() => {
    const api=monacoRef.current, editor=editorRef.current;
    const launch = launchRef.current;
    if(!mounted || !api || !editor || !launch || monacoLanguage!=="java" || readOnly) return;
    const model=editor.getModel();
    if(!model || model.uri.toString()!==api.Uri.parse(modelPath).toString()) return;
    const registration=registerJavaLaunch({editor,model,filePath,launch,getCurrentLaunch:()=>launchRef.current,onStatus:setFileActionStatus});
    return ()=>registration.dispose();
  },[mounted,filePath,hasJavaLaunch,javaLaunchWorkspaceId,javaLaunchGeneration,monacoLanguage,modelPath,readOnly]);

  useEffect(() => {
    const api = monacoRef.current,
      editor = editorRef.current;
    if (!mounted || !api || !editor || !javaDebugger || monacoLanguage !== "java") return;
    let registration: Monaco.IDisposable | undefined;
    const register = () => {
      registration?.dispose();
      registration = undefined;
      sourceRefreshRef.current = undefined;
      const model = editor.getModel();
      if (model && model.uri.toString() === api.Uri.parse(modelPath).toString()) {
        const sourceRegistration = registerJavaDebugger({
          api,
          editor,
          model,
          filePath,
          debugger: javaDebugger,
          getCurrentDebugger: () => debuggerRef.current,
          onStatus: setDebugSourceStatus,
        });
        registration = sourceRegistration;
        sourceRefreshRef.current = sourceRegistration.refresh;
      }
    };
    const change = editor.onDidChangeModel(register);
    register();
    return () => {
      change.dispose();
      registration?.dispose();
      sourceRefreshRef.current = undefined;
    };
  }, [mounted, filePath, javaDebugger, monacoLanguage, modelPath]);

  useEffect(() => {
    const api = monacoRef.current,
      editor = editorRef.current;
    if (!mounted || !api || !editor || !javaCoverage || monacoLanguage !== "java") return;
    let registration: Monaco.IDisposable | undefined;
    const register = () => {
      registration?.dispose();
      registration = undefined;
      const model = editor.getModel();
      if (
        javaCoverage.filePath === filePath &&
        model &&
        model.uri.toString() === api.Uri.parse(modelPath).toString()
      )
        registration = registerJavaCoverage({
          api,
          editor,
          model,
          filePath,
          coverage: javaCoverage,
          invalidated: invalidatedCoverageRef.current,
        });
    };
    const change = editor.onDidChangeModel(register);
    register();
    return () => {
      change.dispose();
      registration?.dispose();
    };
  }, [mounted, filePath, javaCoverage, monacoLanguage, modelPath]);

  useEffect(() => {
    setFileActionStatus(null);
    const api = monacoRef.current,
      editor = editorRef.current;
    if (!mounted || !api || !editor || !javaFileActions || monacoLanguage !== "java") return;
    let registration: Monaco.IDisposable | undefined;
    const register = () => {
      registration?.dispose();
      registration = undefined;
      const model = editor.getModel();
      if (model && model.uri.toString() === api.Uri.parse(modelPath).toString())
        registration = registerJavaFileActions({
          api,
          editor,
          model,
          filePath,
          actions: javaFileActions,
          getCurrentActions: () => fileActionsRef.current,
          onStatus: setFileActionStatus,
        });
    };
    const change = editor.onDidChangeModel(register);
    register();
    return () => {
      change.dispose();
      registration?.dispose();
    };
  }, [mounted, filePath, javaFileActions, monacoLanguage, modelPath]);

  useEffect(() => {
    const api = monacoRef.current,
      editor = editorRef.current;
    if (!mounted || !api || !editor || !onFindJavaReferences || monacoLanguage !== "java") return;
    let registration: Monaco.IDisposable | undefined;
    const register = () => {
      registration?.dispose();
      registration = undefined;
      const model = editor.getModel();
      if (model && model.uri.toString() === api.Uri.parse(modelPath).toString()) {
        registration = registerJavaReferencesAction({
          api,
          editor,
          model,
          filePath,
          onFindReferences: onFindJavaReferences,
        });
      }
    };
    const change = editor.onDidChangeModel(register);
    register();
    return () => {
      change.dispose();
      registration?.dispose();
    };
  }, [mounted, filePath, monacoLanguage, modelPath, onFindJavaReferences]);

  useEffect(() => {
    const api = monacoRef.current,
      editor = editorRef.current;
    if (!mounted || !api || !editor || !onGoToJavaDefinition || monacoLanguage !== "java") return;
    let registration: Monaco.IDisposable | undefined;
    const register = () => {
      registration?.dispose();
      registration = undefined;
      const model = editor.getModel();
      if (model && model.uri.toString() === api.Uri.parse(modelPath).toString()) {
        registration = registerJavaDefinitionAction({
          api,
          editor,
          model,
          filePath,
          onGoToDefinition: onGoToJavaDefinition,
        });
      }
    };
    const change = editor.onDidChangeModel(register);
    register();
    return () => {
      change.dispose();
      registration?.dispose();
    };
  }, [mounted, filePath, monacoLanguage, modelPath, onGoToJavaDefinition]);

  useEffect(() => {
    const editor = editorRef.current;
    const api = monacoRef.current;
    if (!mounted || !editor || !api) return;
    const expectedModelPath = api.Uri.parse(modelPath).toString();
    const captureViewState = (): void => {
      const model = editor.getModel();
      if (!model || model.isDisposed?.() || model.uri.toString() !== expectedModelPath) return;
      const state = editor.saveViewState();
      if (state) modelViewStateRef.current = { filePath, modelPath: expectedModelPath, state };
    };
    const publish = () => {
      const model = editor.getModel(),
        position = editor.getPosition();
      if (
        position &&
        model &&
        !model.isDisposed?.() &&
        model.uri.toString() === expectedModelPath
      ) {
        captureViewState();
        hostRef.current?.setAttribute("data-editor-cursor-line", String(position.lineNumber));
        cursorCallbackRef.current?.(filePath, {
          line: position.lineNumber,
          column: position.column,
        });
      }
    };
    const synchronizeViewState = (): void => {
      const model = editor.getModel();
      if (!model || model.isDisposed?.() || model.uri.toString() !== expectedModelPath) return;
      const previous = modelViewStateRef.current;
      if (previous?.filePath === filePath && previous.modelPath !== expectedModelPath)
        editor.restoreViewState(previous.state);
      captureViewState();
      publish();
    };
    const cursor = editor.onDidChangeCursorPosition((event) => {
      if (event.source !== "model") captureViewState();
      publish();
    });
    const model = editor.onDidChangeModel(synchronizeViewState);
    const scroll = editor.onDidScrollChange(captureViewState);
    synchronizeViewState();
    return () => {
      cursor.dispose();
      model.dispose();
      scroll.dispose();
    };
  }, [mounted, filePath, modelPath]);

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      layoutEditor(initialSize);
    },
    [initialSize, layoutEditor],
  );

  const handleBoundaryError = useCallback(
    (error: Error) => onFailure(describeFailure(error)),
    [onFailure],
  );
  const memberSelectionDialog = pendingMemberSelection ? (
    <MemberSelectionDialog
      key={pendingMemberSelection.id}
      selection={pendingMemberSelection.selection}
      onCancel={() => finishMemberSelection(null)}
      onConfirm={(selection) => finishMemberSelection(selection)}
    />
  ) : null;

  return (
    <div
      ref={hostRef}
      className="monaco-code-editor-host"
      data-testid="monaco-code-editor-host"
      data-java-implementation-provider-ready={javaSemantics ? "true" : "false"}
      data-java-on-type-formatting-supported={canFormatOnType ? "true" : "false"}
      data-java-on-type-formatting-triggers={onTypeTriggers}
      data-java-template-project-context-status={
        javaTemplateProjectContext?.status ?? "unavailable"
      }
      data-reveal-request-id={revealRequestId === undefined ? undefined : String(revealRequestId)}
      data-reveal-requested-selection={
        revealSelection
          ? `${revealSelection.start.line}:${revealSelection.start.character}-${revealSelection.end.line}:${revealSelection.end.character}`
          : undefined
      }
    >
      {fileActionStatus && (
        <div
          role="alert"
          aria-label="Java file action status"
          className="absolute bottom-1 left-2 z-10 rounded bg-[var(--surface-editor)] p-2 text-xs"
        >
          {fileActionStatus}
        </div>
      )}
      {javaNavigationStatus && (
        <div
          role="status"
          aria-label="Java navigation status"
          aria-live="polite"
          className="pointer-events-none absolute bottom-12 left-2 z-10 max-w-[calc(100%-1rem)] whitespace-normal rounded bg-[var(--surface-editor)] p-2 text-xs"
        >
          {javaNavigationStatus}
        </div>
      )}
      {javaDebugger && (
        <span
          aria-label="Java source debugger"
          className="pointer-events-none absolute right-6 top-1 z-10 rounded bg-[var(--surface-editor)] px-2 text-xs text-[var(--text-secondary)]"
        >
          {debugSourceStatus === "ready"
            ? javaDebugger.mode === "saved"
              ? "Saved source breakpoints"
              : "Source debugging: ready"
            : debugSourceStatus === "loading"
              ? "Checking debugger source…"
              : "Source debugging unavailable"}
          {debugSourceStatus === "unavailable" && (
            <button
              type="button"
              className="pointer-events-auto ml-2 underline"
              onClick={() => sourceRefreshRef.current?.()}
            >
              Retry source binding
            </button>
          )}
        </span>
      )}
      <MonacoErrorBoundary onError={handleBoundaryError} resetKey={attempt}>
        <MonacoEditor
          key={attempt}
          height="100%"
          width="100%"
          path={modelPath}
          language={monacoLanguage}
          value={content}
          theme={detectTheme()}
          saveViewState
          keepCurrentModel={
            !/^(?:refactorkit-java-source|refactorkit-java-platform-source):\/\//.test(filePath)
          }
          onMount={handleMount}
          onChange={(value) => {
            const nextValue = value ?? "";
            if (!syncingExternalContentRef.current && !readOnly && nextValue !== content)
              onChange(nextValue);
          }}
          options={{
            readOnly,
            domReadOnly: readOnly,
            "semanticHighlighting.enabled": true,
            ariaLabel: `Code editor for ${filePath || "untitled file"}`,
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            codeLens: true,
            colorDecorators: true,
            cursorBlinking: "smooth",
            folding: true,
            fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
            fontLigatures: true,
            fontSize: 14,
            formatOnPaste: false,
            glyphMargin: true,
            lineHeight: 21,
            lineNumbers: "on",
            matchBrackets: "always",
            minimap: { enabled: true, showSlider: "mouseover" },
            multiCursorModifier: "alt",
            padding: { top: 12, bottom: 12 },
            parameterHints: { enabled: true, cycle: true },
            quickSuggestions: { other: true, comments: false, strings: true },
            stickyScroll: { enabled: true },
            suggestOnTriggerCharacters: true,
            tabSize: workspaceEditorPreferences?.tabSize ?? 2,
            insertSpaces: workspaceEditorPreferences?.insertSpaces ?? true,
            formatOnType: !readOnly && monacoLanguage === "java" && workspaceEditorPreferences?.formatJavaOnType === true &&
              canFormatOnType,
            wordWrap: "off",
          }}
        />
      </MonacoErrorBoundary>
      {pendingMemberSelection &&
        (pendingMemberSelection.selection.kind === "delegateMethods"
          ? typeof document !== "undefined" && createPortal(memberSelectionDialog, document.body)
          : memberSelectionDialog)}
    </div>
  );
}
