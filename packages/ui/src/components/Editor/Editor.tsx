import type {
  EditorTab as EditorTabType,
  JavaCompletionRequest,
  JavaNavigationRequest,
  JavaNavigationResult,
  JavaNavigationLocation,
  JavaCompletionResponse,
  JavaFormattingRequest,
  JavaRangeFormattingRequest,
  JavaOnTypeFormattingRequest,
  JavaRangeFormattingResponse,
  JavaFormattingResponse,
  JavaCodeActionsRequest,
  JavaCodeActionApplyRequest,
  JavaCodeActionsResponse,
  JavaRenameRequest,
  JavaRenameResponse,
  JavaDocumentSymbolsRequest,
  JavaDocumentSymbolsResponse,
  JavaDocumentHighlightsRequest,
  JavaDocumentHighlightsResponse,
  JavaImplementationsRequest,
  JavaDefinitionsRequest,
  JavaDefinitionsResponse,
  JavaReferenceLocation,
  JavaImplementationsResponse,
  JavaCallHierarchyRequest,
  JavaCallHierarchyResponse,
  JavaReferencesRequest,
  JavaReferencesResponse,
  JavaSemanticTokensRequest,
  JavaSemanticTokensResponse,
  JavaInlayHintsRequest,
  JavaInlayHintsResponse,
  JavaHoverRequest,
  JavaHoverResponse,
  JavaSemanticDocumentTarget,
  JavaSignatureHelpRequest,
  JavaSignatureHelpResponse,
  Language,
  LanguageServiceCancellationId,
  JavaDebuggerSourceView,
  CursorPosition,
  LanguageRange,
  JavaLibraryDefinition,
  JavaCoverageLine,
  WorkspaceEditorPreferences,
  JavaEffectiveProjectContext,
} from "@ide/contracts";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { LanguageDiagnostic, LanguageDocumentIdentity } from "../diagnostics";
import { EditorTab } from "./EditorTab";
import { loadMonacoCodeEditor } from "./lazyMonaco";
import { WelcomePage } from "./WelcomePage";

export interface EditorRevealRequest {
  /** File that should receive focus. Must match the active Editor filePath. */
  filePath: string;
  /** 1-based line number. */
  line: number;
  /** Optional 1-based column number. Defaults to the start of the line. */
  column?: number;
  /** Changes for every navigation, including repeated navigation to one location. */
  requestId: string | number;
  /** Optional zero-based UTF-16 selection in the already validated document. */
  selection?: LanguageRange;
}

export interface JavaEditorSemanticContext {
  readonly workspaceId: string;
  readonly generation: number;
  readonly document: Readonly<JavaSemanticDocumentTarget>;
}

export interface JavaWorkspaceDocumentChange {
  readonly filePath: string;
  readonly before: string;
  readonly after: string;
}

/** Presentation boundary for semantics of the current synchronized Java document. */
export interface JavaEditorSemantics {
  readonly context?: Readonly<JavaEditorSemanticContext>;
  /** Exact buffer represented by context, used to wait for post-typing synchronization. */
  readonly documentText?: string;
  readonly semanticTokensEnabled?: boolean;
  readonly formattingEnabled?: boolean;
  readonly rangeFormattingEnabled?: boolean;
  readonly onTypeFormattingTriggers?: readonly string[];
  inlayHints?(request: JavaInlayHintsRequest): Promise<JavaInlayHintsResponse>;
  completion(request: JavaCompletionRequest): Promise<JavaCompletionResponse>;
  formatDocument?(request: JavaFormattingRequest): Promise<JavaFormattingResponse>;
  formatRange?(request: JavaRangeFormattingRequest): Promise<JavaRangeFormattingResponse>;
  formatOnType?(request: JavaOnTypeFormattingRequest): Promise<JavaFormattingResponse>;
  hover(request: JavaHoverRequest): Promise<JavaHoverResponse>;
  signatureHelp(request: JavaSignatureHelpRequest): Promise<JavaSignatureHelpResponse>;
  codeActions(request: JavaCodeActionsRequest): Promise<JavaCodeActionsResponse>;
  applyCodeAction?(request: JavaCodeActionApplyRequest): Promise<boolean>;
  rename?(request: JavaRenameRequest): Promise<JavaRenameResponse>;
  documentSymbols(request: JavaDocumentSymbolsRequest): Promise<JavaDocumentSymbolsResponse>;
  documentHighlights(
    request: JavaDocumentHighlightsRequest,
  ): Promise<JavaDocumentHighlightsResponse>;
  implementations(request: JavaImplementationsRequest): Promise<JavaImplementationsResponse>;
  definitions?(request: JavaDefinitionsRequest): Promise<JavaDefinitionsResponse>;
  typeDefinitions?(request: JavaDefinitionsRequest): Promise<JavaDefinitionsResponse>;
  callHierarchy?(request: JavaCallHierarchyRequest): Promise<JavaCallHierarchyResponse>;
  references(request: JavaReferencesRequest): Promise<JavaReferencesResponse>;
  semanticTokens(request: JavaSemanticTokensRequest): Promise<JavaSemanticTokensResponse>;
  cancel(cancellationId: LanguageServiceCancellationId): void | Promise<void>;
}

export interface JavaEditorNavigation {
  readonly context: { workspaceId: string; generation: number };
  readonly typeDefinitionAvailable?: boolean;
  /** Read preview text from a current draft or a read-only workspace snapshot. */
  readSource?(filePath: string, isCurrent: () => boolean): Promise<string | null>;
  query(request: JavaNavigationRequest): Promise<JavaNavigationResult>;
  /** Revoke local result presentation; the native RPC retains its bounded timeout. */
  cancel(requestId: string): void;
  openLocation(requestId: string, location: JavaNavigationLocation): Promise<boolean>;
  navigateToImplementation?(
    location: JavaNavigationLocation,
    canReveal: (afterOpen: boolean) => boolean,
  ): Promise<boolean>;
  /** Open the provider-owned source file as an immutable library document. */
  openDependencySource?(request: JavaNavigationRequest): Promise<void>;
  queryDependencyDefinition?(
    request: JavaNavigationRequest,
    selection?: JavaNavigationResult,
  ): Promise<JavaLibraryDefinition | null>;
  openDependencyDefinition?(requestId: string, range: LanguageRange): Promise<boolean>;
}

export interface JavaEditorDebugger {
  readonly context: { workspaceId: string; generation: number; sessionId?: string };
  readonly mode?: "saved" | "live";
  readonly canRunToCursor?: boolean;
  source(document: { path: string; text: string; version: number }): Promise<
    Pick<
      JavaDebuggerSourceView,
      "documentPath" | "documentVersion" | "sourcePath" | "executionLine"
    > & {
      breakpoints: { line: number; verified: boolean; enabled?: boolean }[];
    }
  >;
  toggleBreakpoint(
    document: { path: string; text: string; version: number },
    line: number,
  ): Promise<void>;
  runToCursor(
    document: { path: string; text: string; version: number },
    line: number,
  ): Promise<void>;
}

/** Measured Java line coverage bound to one source path and completed test session. */
export interface JavaEditorCoverage {
  readonly context: { workspaceId: string; generation: number; sessionId: string };
  readonly filePath: string;
  readonly lines: readonly JavaCoverageLine[];
  readonly sourceCurrent: boolean;
}

/** Launch discovery uses provider-owned identities for this exact saved editor frame. */
export interface JavaEditorLaunch {
  readonly context: { workspaceId: string; generation: number };
  readonly available: boolean;
  run(
    document: {
      path: string;
      text: string;
      version: number;
      position?: { line: number; character: number };
    },
    isCurrent: () => boolean,
    operation?: "run" | "debug",
  ): Promise<void>;
}

export interface JavaEditorFileActions {
  readonly context: { workspaceId: string; generation: number };
  readonly operations: readonly (
    | "format-file"
    | "organize-imports"
    | "rename-class"
    | "rename-member"
    | "add-method-parameter"
    | "remove-method-parameter"
    | "change-method-signature"
    | "reorder-method-parameters"
    | "make-static"
    | "make-public"
    | "change-field-type"
    | "change-method-parameter-type"
    | "inline-variable"
    | "inline-method"
    | "introduce-parameter-object"
    | "extract-delegate"
    | "inline-constant"
    | "extract-constant"
    | "extract-variable"
    | "extract-method"
    | "extract-parameter"
    | "extract-field"
    | "extract-interface"
    | "extract-superclass"
    | "pull-up-member"
    | "push-down-member"
    | "move-member"
    | "lsp-change-visibility"
    | "lsp-extract-parameter"
    | "lsp-extract-superclass"
  )[];
  review(
    operation:
      | "format-file"
      | "organize-imports"
      | "rename-class"
      | "rename-member"
      | "add-method-parameter"
      | "remove-method-parameter"
      | "change-method-signature"
      | "reorder-method-parameters"
      | "make-static"
      | "make-public"
      | "change-field-type"
      | "change-method-parameter-type"
      | "inline-variable"
      | "inline-method"
      | "introduce-parameter-object"
      | "extract-delegate"
      | "inline-constant"
      | "extract-constant"
      | "extract-variable"
      | "extract-method"
      | "extract-parameter"
      | "extract-field"
      | "extract-interface"
      | "extract-superclass"
      | "pull-up-member"
      | "push-down-member"
      | "move-member",
    document: { path: string; text: string; version?: number },
    cursor?: CursorPosition,
    selection?: { start: number; end: number },
  ): void;
  reviewLsp?(
    operation: "lsp-change-visibility" | "lsp-extract-parameter" | "lsp-extract-superclass",
    document: { path: string; text: string; version?: number },
    cursor?: CursorPosition,
    selection?: { start: number; end: number },
  ): void;
}

export interface EditorProps {
  onCursorPositionChange?(filePath: string, position: CursorPosition): void;
  /** Opens Java Intelligence and searches JDT LS references from this editor cursor. */
  onFindJavaReferences?(filePath: string, position: CursorPosition): void;
  /** Resolves the current Java editor cursor through JDT LS and opens its workspace definition. */
  onGoToJavaDefinition?(filePath: string, position: CursorPosition): void | Promise<void>;
  /** Opens a correlated JDT LS definition returned as a fallback for RefactorKit navigation. */
  onNavigateJavaDefinition?(
    location: JavaReferenceLocation,
    isCurrent: (afterOpen: boolean) => boolean,
  ): boolean | Promise<boolean>;
  content: string;
  language: Language;
  onChange: (value: string) => void;
  /** Commit a validated multi-file Java edit to the open workspace buffers. */
  onWorkspaceDocumentChanges?: (changes: readonly JavaWorkspaceDocumentChange[]) => boolean;
  /** An empty path means that no document is active. */
  filePath: string;
  /** Acknowledge a reveal only after Monaco has applied it to the active model. */
  onRevealHandled?(requestId: string | number): void;
  isLoading?: boolean;
  /** Prevent typing while an application-owned workspace transformation is running. */
  readOnly?: boolean;
  tabs?: EditorTabType[];
  tabLabels?: Readonly<Record<string, string>>;
  onTabActivate?: (filePath: string) => void;
  onTabClose?: (filePath: string) => void;
  /** Requests creation of a validated basename. Filesystem work remains application-owned. */
  onCreateNewFile?: (name: string) => void | Promise<void>;
  /** Optional destination shown beside the create-file form. */
  createFileTargetLabel?: string;
  onWelcomeOpenRecent?: () => void;
  onWelcomeRecentFileClick?: (path: string) => void;
  welcomeRecentFiles?: { name: string; path: string }[];
  revealRequest?: EditorRevealRequest | null;
  diagnostics?: readonly LanguageDiagnostic[];
  /** URI of the open workspace file, available before the language service starts. */
  modelUri?: string;
  /** Markers require the exact document path; language-service URI metadata is optional. */
  documentIdentity?: Pick<LanguageDocumentIdentity, "path"> & Partial<LanguageDocumentIdentity>;
  diagnosticOwner?: string;
  /** Omit this value, or its context, to disable interactive Java semantics. */
  javaSemantics?: JavaEditorSemantics;
  /** Current RefactorKit context used to offer test templates only for known test source sets. */
  javaTemplateProjectContext?: JavaEffectiveProjectContext;
  /** Workspace-relative project root for context source-root resolution. */
  javaTemplateProjectPath?: string;
  /** Saved-source binding navigation is independent of the JDT LS completion session. */
  javaNavigation?: JavaEditorNavigation;
  javaDebugger?: JavaEditorDebugger;
  javaLaunch?: JavaEditorLaunch;
  javaCoverage?: JavaEditorCoverage;
  javaFileActions?: JavaEditorFileActions;
  /** Workspace indentation supplied to Monaco and Java formatter requests. */
  workspaceEditorPreferences?: WorkspaceEditorPreferences;
}

type MonacoLazyBoundaryProps = {
  attempt: number;
  children: ReactNode;
  onFailure: (reason: string) => void;
};

type MonacoLazyBoundaryState = { failed: boolean };

class MonacoLazyBoundary extends Component<MonacoLazyBoundaryProps, MonacoLazyBoundaryState> {
  state: MonacoLazyBoundaryState = { failed: false };

  static getDerivedStateFromError(): MonacoLazyBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const detail = error.message.trim();
    this.props.onFailure(detail ? `Monaco failed: ${detail}` : "Monaco failed to start.");
  }

  componentDidUpdate(previousProps: MonacoLazyBoundaryProps): void {
    if (previousProps.attempt !== this.props.attempt && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function createLazyMonacoCodeEditor() {
  return lazy(loadMonacoCodeEditor);
}

function activeFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function OpeningEditorPlaceholder({ filePath }: { filePath: string }): JSX.Element {
  return (
    <div
      className="editor-opening-placeholder"
      data-testid="editor-opening-placeholder"
      role="status"
      aria-live="polite"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 2.75h8l4 4V21.25H6z" stroke="currentColor" strokeWidth="1.25" />
        <path d="M14 2.75v4h4" stroke="currentColor" strokeWidth="1.25" />
      </svg>
      <strong>{activeFileName(filePath)}</strong>
      <span>Opening editor…</span>
      <div className="editor-opening-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function MonacoFailurePlaceholder({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div
      className="editor-failure-placeholder"
      data-testid="editor-failure-placeholder"
      role="alert"
    >
      <strong>Editor could not be opened</strong>
      <span>{message}</span>
      <button type="button" onClick={onRetry}>
        Retry Monaco
      </button>
    </div>
  );
}

/** Monaco-only editor with an inert placeholder during loading and layout. */
export function Editor(props: EditorProps): JSX.Element {
  const { content, filePath, isLoading = false, language, onChange, revealRequest, tabs } = props;
  const [readyFilePath, setReadyFilePath] = useState<string | null>(null);
  const [monacoFailure, setMonacoFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [monacoHost, setMonacoHost] = useState({ width: 0, height: 0, renderable: false });
  const [monacoActivated, setMonacoActivated] = useState(false);
  const [monacoLayerElement, setMonacoLayerElement] = useState<HTMLDivElement | null>(null);
  const previousFilePathRef = useRef(filePath);
  const LazyMonacoCodeEditor = useMemo(createLazyMonacoCodeEditor, [attempt]);
  const hasActiveFile = filePath.trim().length > 0;
  const monacoReady = readyFilePath === filePath && hasActiveFile && !isLoading;
  const rendererAvailable = hasActiveFile && !isLoading && !monacoFailure;

  const handleMonacoLayerMount = useCallback((element: HTMLDivElement | null) => {
    setMonacoLayerElement((current) => (current === element ? current : element));
  }, []);

  useLayoutEffect(() => {
    if (!rendererAvailable || !monacoLayerElement) {
      setMonacoHost((current) =>
        current.width === 0 && current.height === 0 && !current.renderable
          ? current
          : { width: 0, height: 0, renderable: false },
      );
      setMonacoActivated(false);
      return;
    }

    const host = monacoLayerElement;
    let measureFrame: number | null = null;
    const hasVisibleLayoutTree = (): boolean => {
      if (!host.isConnected) return false;

      let element: HTMLElement | null = host;
      while (element) {
        const style = typeof getComputedStyle === "function" ? getComputedStyle(element) : null;
        if (style?.display === "none") return false;
        // The host's own visibility is presentation state while Monaco is pending.
        // Ancestor visibility still means the editor area is intentionally hidden.
        if (element !== host && style?.visibility === "hidden") return false;
        element = element.parentElement;
      }
      return true;
    };
    const measure = (): void => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(0, rect.width || host.clientWidth);
      const height = Math.max(0, rect.height || host.clientHeight);
      const intersectsViewport =
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight;
      const documentVisible = document.visibilityState !== "hidden";
      const renderable =
        width > 0 && height > 0 && hasVisibleLayoutTree() && intersectsViewport && documentVisible;

      setMonacoHost((current) =>
        current.width === width && current.height === height && current.renderable === renderable
          ? current
          : { width, height, renderable },
      );
      if (renderable) setMonacoActivated(true);
    };
    const scheduleMeasure = (): void => {
      if (measureFrame !== null) cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => {
        measureFrame = null;
        measure();
      });
    };

    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(host);
    const intersectionObserver =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(scheduleMeasure);
    intersectionObserver?.observe(host);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("pageshow", scheduleMeasure);
    window.addEventListener("focus", scheduleMeasure);
    document.addEventListener("visibilitychange", scheduleMeasure);

    return () => {
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("pageshow", scheduleMeasure);
      window.removeEventListener("focus", scheduleMeasure);
      document.removeEventListener("visibilitychange", scheduleMeasure);
      if (measureFrame !== null) cancelAnimationFrame(measureFrame);
    };
  }, [monacoLayerElement, rendererAvailable]);

  useEffect(() => {
    if (previousFilePathRef.current !== filePath) {
      previousFilePathRef.current = filePath;
      setMonacoFailure(null);
    }
    setReadyFilePath(null);
  }, [filePath, isLoading]);

  const handleMonacoFailure = useCallback((reason: string) => {
    setReadyFilePath(null);
    setMonacoFailure(reason);
  }, []);
  const handleMonacoReady = useCallback(
    (ready: boolean) => {
      setReadyFilePath((current) => (ready ? filePath : current === filePath ? null : current));
    },
    [filePath],
  );
  const retryMonaco = useCallback(() => {
    setMonacoFailure(null);
    setReadyFilePath(null);
    setAttempt((current) => current + 1);
  }, []);

  return (
    <div className="editor-root h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--surface-editor)] flex flex-col">
      {tabs && tabs.length > 0 && (
        <div className="editor-tab-bar" role="tablist" aria-label="Editor tabs">
          {tabs.map((tab) => (
            <EditorTab
              key={tab.filePath}
              tab={tab}
              label={props.tabLabels?.[tab.filePath]}
              onActivate={(path) => props.onTabActivate?.(path)}
              onClose={(path) => props.onTabClose?.(path)}
            />
          ))}
        </div>
      )}

      <div className="editor-content flex-1 min-h-0 min-w-0 overflow-hidden relative">
        {!hasActiveFile ? (
          <WelcomePage
            onCreateNewFile={props.onCreateNewFile}
            createFileTargetLabel={props.createFileTargetLabel}
            onOpenRecent={props.onWelcomeOpenRecent}
            recentFiles={props.welcomeRecentFiles}
            onRecentFileClick={props.onWelcomeRecentFileClick}
          />
        ) : isLoading ? (
          <OpeningEditorPlaceholder filePath={filePath} />
        ) : monacoFailure ? (
          <MonacoFailurePlaceholder message={monacoFailure} onRetry={retryMonaco} />
        ) : (
          <div className="editor-renderer-stack" data-testid="editor-renderer-stack">
            <div
              ref={handleMonacoLayerMount}
              className={`editor-monaco-layer${monacoReady ? " editor-monaco-layer--ready" : ""}`}
              data-testid="editor-monaco-layer"
              aria-hidden={!monacoReady}
            >
              {monacoActivated && (
                <MonacoLazyBoundary attempt={attempt} onFailure={handleMonacoFailure}>
                  <Suspense fallback={null}>
                    <LazyMonacoCodeEditor
                      key={
                        /^(?:refactorkit-java-source|refactorkit-java-platform-source):\/\//.test(
                          filePath,
                        )
                          ? filePath
                          : "workspace"
                      }
                      attempt={attempt}
                      content={content}
                      readOnly={props.readOnly}
                      language={language}
                      onChange={onChange}
                      onWorkspaceDocumentChanges={props.onWorkspaceDocumentChanges}
                      onCursorPositionChange={props.onCursorPositionChange}
                      onFindJavaReferences={props.onFindJavaReferences}
                      onGoToJavaDefinition={props.onGoToJavaDefinition}
                      onNavigateJavaDefinition={props.onNavigateJavaDefinition}
                      onRevealHandled={props.onRevealHandled}
                      filePath={filePath}
                      modelUri={props.modelUri}
                      initialSize={{ width: monacoHost.width, height: monacoHost.height }}
                      isRenderable={monacoHost.renderable}
                      revealRequest={revealRequest}
                      diagnostics={props.diagnostics}
                      documentIdentity={props.documentIdentity}
                      diagnosticOwner={props.diagnosticOwner}
                      javaSemantics={props.javaSemantics}
                      javaTemplateProjectContext={props.javaTemplateProjectContext}
                      javaTemplateProjectPath={props.javaTemplateProjectPath}
                      javaNavigation={props.javaNavigation}
                      javaDebugger={props.javaDebugger}
                      javaLaunch={props.javaLaunch}
                      javaCoverage={props.javaCoverage}
                      javaFileActions={props.javaFileActions}
                      workspaceEditorPreferences={props.workspaceEditorPreferences}
                      onFailure={handleMonacoFailure}
                      onReadyChange={handleMonacoReady}
                    />
                  </Suspense>
                </MonacoLazyBoundary>
              )}
            </div>
            {!monacoReady && <OpeningEditorPlaceholder filePath={filePath} />}
          </div>
        )}
      </div>
    </div>
  );
}
