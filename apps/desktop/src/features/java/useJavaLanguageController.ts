import type {
  JavaFormatterProfile,
  JavaGradleSettings,
  JavaCompletionRequest,
  JavaCompletionResponse,
  JavaFormattingRequest,
  JavaFormattingResponse,
  JavaRangeFormattingRequest,
  JavaOnTypeFormattingRequest,
  JavaRangeFormattingResponse,
  JavaCodeActionsRequest,
  JavaCodeActionApplyRequest,
  JavaCodeActionsResponse,
  JavaRenameRequest,
  JavaRenameResponse,
  JavaRenameDocumentEdits,
  JavaDocumentSymbolsResponse,
  JavaDocumentHighlightsRequest,
  JavaDocumentHighlightsResponse,
  JavaDefinitionsRequest,
  JavaDefinitionsResponse,
  JavaImplementationsRequest,
  JavaImplementationsResponse,
  JavaCallHierarchyRequest,
  JavaCallHierarchyResponse,
  JavaReferencesRequest,
  JavaReferencesResponse,
  JavaSemanticTokensRequest,
  JavaSemanticTokensResponse,
  JavaInlayHintsRequest,
  JavaInlayHintsResponse,
  JavaWorkspaceSymbolsRequest,
  JavaWorkspaceSymbolsResponse,
  JavaHoverRequest,
  JavaHoverResponse,
  JavaSignatureHelpRequest,
  JavaSignatureHelpResponse,
  LanguageDiagnostic,
  LanguageServiceCapabilities,
  LanguageServiceDiagnosticsEvent,
  LanguageServiceStatus,
  WorkspaceInfo,
} from "@ide/contracts";
import type { JavaEditorSemantics, ProblemItem } from "@ide/ui";
import type {
  DocumentSyncPort,
  JavaIntelligencePort,
  LanguageSessionPort,
} from "@ide/web-core/ports";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function copyCodeActionsRequest(request: JavaCodeActionsRequest): JavaCodeActionsRequest {
  return {
    workspaceId: request.workspaceId,
    generation: request.generation,
    document: { ...request.document },
    position: { ...request.position },
    range: { start: { ...request.range.start }, end: { ...request.range.end } },
    diagnostics: request.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      range: { start: { ...diagnostic.range.start }, end: { ...diagnostic.range.end } },
    })),
    ...(request.generationSelection
      ? {
          generationSelection: {
            kind: request.generationSelection.kind,
            selectedFieldBindingKeys: [...request.generationSelection.selectedFieldBindingKeys],
            selectedConstructorBindingKeys: [
              ...request.generationSelection.selectedConstructorBindingKeys,
            ],
            selectedOverridableMethodKeys: [
              ...request.generationSelection.selectedOverridableMethodKeys,
            ],
            selectedDelegateMethodKeys: [...request.generationSelection.selectedDelegateMethodKeys],
          },
        }
      : {}),
    requestId: request.requestId,
    cancellationId: request.cancellationId,
  };
}

const JAVA_CHANGE_DEBOUNCE_MS = 200;
const INITIAL_DOCUMENT_VERSION = 1;
const READY_SESSION_STATES = new Set(["ready", "indexing", "degraded"]);
const EMPTY_CAPABILITIES: LanguageServiceCapabilities = Object.freeze({
  documentSync: false,
  diagnostics: false,
  completion: false,
  hover: false,
  signature: false,
  definition: false,
  references: false,
  symbols: false,
  documentSymbols: false,
  documentHighlights: false,
  implementation: false,
  workspaceSymbols: false,
  semanticTokens: false,
  inlayHints: false,
  codeActions: false,
  formatting: false,
  rangeFormatting: false,
  rename: false,
  hierarchy: false,
});

export interface JavaLanguageEditorState {
  activeFilePath: string | null;
  contents: Record<string, string>;
}

export interface ReadyJavaEditorDocument {
  path: string;
  text: string;
}

export interface UseJavaLanguageControllerDependencies {
  languageSession: LanguageSessionPort;
  documentSync: DocumentSyncPort;
  javaIntelligence: JavaIntelligencePort;
  /** Atomically commit validated semantic workspace edits into current draft buffers. */
  applySemanticWorkspaceEdit?(
    edits: readonly JavaRenameDocumentEdits[],
    capturedDocuments: ReadonlyMap<string, { uri: string; version: number; text: string }>,
  ): boolean | Promise<boolean>;
  /** Open an affected file without moving focus or saving any draft. */
  openSemanticDocument?(path: string, isCurrent: () => boolean): Promise<boolean>;
  workspaceInfo: WorkspaceInfo | null;
  workspaceGeneration: number;
  getEditorState: () => JavaLanguageEditorState;
  /** Only a document accepted as ready by the editor-open controller may receive semantics. */
  readyActiveDocument: ReadyJavaEditorDocument | null;
  /** Selected project JDK, independent of the language-server process runtime. */
  projectJdkHome?: string;
  /** Optional global JDK home used to launch JDT LS, independent of the project JDK. */
  serverJdkHome?: string;
  /** Session-only user authorization for the JDT LS Gradle importer. */
  gradleImportEnabled: boolean;
  /** Selected Gradle settings to apply when the importer is explicitly authorized. */
  gradle?: JavaGradleSettings;
  /** Workspace-relative project selected in the Java Project panel. */
  projectPath: string;
  /** Selected Maven local repository used by builds and JDT LS project import. */
  mavenRepository: string;
  /** Maven profiles selected in the current RefactorKit project settings. */
  activeMavenProfiles: string[];
  /** Maven profiles excluded in the current RefactorKit project settings. */
  inactiveMavenProfiles: string[];
  /** Optional workspace Eclipse formatter profile configured in Editor settings. */
  javaFormatterProfile?: JavaFormatterProfile;
}

type SynchronizedJavaDocument = {
  workspaceId: string;
  generation: number;
  syncEpoch: number;
  path: string;
  uri: string;
  /** Optimistic version; it advances when an edit is queued, before native I/O. */
  version: number;
  /** Latest editor text. It is never included in semantic requests or logs. */
  text: string;
  sentVersion: number;
  open: boolean;
  closing?: boolean;
  pendingText?: string;
  pendingVersion?: number;
  changeQueue: Promise<void>;
  changeTimer?: ReturnType<typeof setTimeout>;
};

type JavaDocumentStartup = {
  workspaceId: string;
  path: string;
  syncEpoch: number;
  promise: Promise<void>;
};

export interface JavaLanguageController {
  status: LanguageServiceStatus | null;
  error: string | null;
  refreshing: boolean;
  refresh(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  runLifecycle(action: "start" | "stop" | "restart"): Promise<void>;
  attach(workspace: WorkspaceInfo, workspaceGeneration: number): void;
  detach(nextWorkspaceGeneration: number): Promise<void>;
  load(workspaceId?: string, workspaceGeneration?: number): Promise<void>;
  closeAll(): Promise<void>;
  activate(path: string, text: string): Promise<void>;
  queueChange(path: string, text: string): void;
  flush(path: string): Promise<void>;
  synchronizeEditorDocument(path: string): Promise<void>;
  notifySaved(path: string): Promise<void>;
  closeDocument(path: string): Promise<void>;
  activeDiagnostics: readonly LanguageDiagnostic[];
  diagnosticUnavailableMessage?: string;
  activeDiagnosticDocument: LanguageServiceDiagnosticsEvent["document"] | undefined;
  activeDiagnosticOwner: string;
  problemItems: readonly ProblemItem[];
  javaSemantics: JavaEditorSemantics | undefined;
  hasJavaContext: boolean;
  capabilities: LanguageServiceCapabilities;
  searchWorkspaceSymbols(
    query: string,
    signal?: AbortSignal,
  ): Promise<JavaWorkspaceSymbolsResponse>;
  cancelWorkspaceSymbolSearch(): void;
}

function isJavaPath(path: string | null | undefined): path is string {
  return Boolean(path && path.toLowerCase().endsWith(".java"));
}

export function createWorkspaceFileUri(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedRelative = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolutePath = `${normalizedRoot}/${normalizedRelative}`;
  return `file://${absolutePath.startsWith("/") ? "" : "/"}${absolutePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error";
}

function failedStatus(
  workspaceId: string,
  generation: number,
  message: string,
): LanguageServiceStatus {
  return {
    state: "failed",
    provider: "jdt-ls",
    workspaceId,
    generation,
    gradleImportEnabled: false,
    gradleSettingsConfigured: false,
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
    capabilities: EMPTY_CAPABILITIES,
    lastError: message,
    checkedAt: new Date().toISOString(),
  };
}

function sameMavenProfiles(
  status: LanguageServiceStatus,
  active: readonly string[],
  inactive: readonly string[],
): boolean {
  return (
    JSON.stringify(status.activeMavenProfiles) === JSON.stringify(active) &&
    JSON.stringify(status.inactiveMavenProfiles) === JSON.stringify(inactive)
  );
}

function sameProjectPath(status: LanguageServiceStatus, projectPath: string): boolean {
  return status.projectPath === projectPath;
}

function sameMavenRepository(status: LanguageServiceStatus, repository: string): boolean {
  return (status.mavenRepository ?? "") === repository;
}

function formatterProfileSignature(profile?: JavaFormatterProfile): string {
  return JSON.stringify(profile ?? null);
}

function sameFormatterProfile(
  status: LanguageServiceStatus,
  profile?: JavaFormatterProfile,
): boolean {
  return (
    formatterProfileSignature(status.javaFormatterProfile) === formatterProfileSignature(profile)
  );
}

function gradleSettingsSignature(settings?: JavaGradleSettings): string {
  if (!settings) return "";
  const projectProperties = Object.fromEntries(
    Object.entries(settings.projectProperties).sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify({
    executable: settings.executable,
    userHome: settings.userHome,
    gradleRuntimeHome: settings.gradleRuntimeHome ?? "",
    projectProperties,
  });
}

function mavenProfileSignature(active: readonly string[], inactive: readonly string[]): string {
  return JSON.stringify([active, inactive]);
}

function staleSemanticFailure(requestId: string) {
  return {
    ok: false as const,
    requestId,
    error: { kind: "stale-version" as const, summary: "Document context changed" },
  };
}

function unavailableSemanticFailure(requestId: string) {
  return {
    ok: false as const,
    requestId,
    error: {
      kind: "unavailable" as const,
      summary: "Java semantics unavailable",
      retryable: true,
    },
  };
}

/**
 * Application-layer owner of the complete Java/JDT LS session and document-sync lifecycle.
 * Ports are injected; no native implementation is imported here.
 */
export function useJavaLanguageController(
  dependencies: UseJavaLanguageControllerDependencies,
): JavaLanguageController {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;

  const mountedRef = useRef(true);
  const statusRequestRef = useRef(0);
  const lifecycleRequestRef = useRef(0);
  const workspaceGenerationRef = useRef(dependencies.workspaceGeneration);
  const workspaceIdRef = useRef<string | null>(null);
  const workspaceInfoRef = useRef<WorkspaceInfo | null>(null);
  const statusRef = useRef<LanguageServiceStatus | null>(null);
  const sessionGradleSettingsSignatureRef = useRef<string | null>(dependencies.gradle ? null : "");
  const diagnosticsRef = useRef<Map<string, LanguageServiceDiagnosticsEvent>>(new Map());
  const documentsRef = useRef<Map<string, SynchronizedJavaDocument>>(new Map());
  const activeWorkspaceEditsRef = useRef(new Map<string, { cancelled: boolean }>());
  const startupsRef = useRef<Map<string, JavaDocumentStartup>>(new Map());
  const syncEpochRef = useRef(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const workspaceSymbolRequestSequenceRef = useRef(0);
  const workspaceSymbolCancellationIdRef = useRef<string | null>(null);

  const cancelWorkspaceSymbolSearch = useCallback((): void => {
    const cancellationId = workspaceSymbolCancellationIdRef.current;
    workspaceSymbolCancellationIdRef.current = null;
    if (cancellationId) {
      void dependenciesRef.current.javaIntelligence.cancel(cancellationId).catch(() => undefined);
    }
  }, []);

  const [status, setStatus] = useState<LanguageServiceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [diagnosticsRevision, setDiagnosticsRevision] = useState(0);
  const [semanticRevision, setSemanticRevision] = useState(0);

  const publishSemanticRevision = useCallback(() => {
    if (mountedRef.current) setSemanticRevision((revision) => revision + 1);
  }, []);

  const clearDiagnostics = useCallback((path?: string): void => {
    if (path) {
      for (const [key, event] of diagnosticsRef.current) {
        if (event.document.path === path) diagnosticsRef.current.delete(key);
      }
    } else {
      diagnosticsRef.current.clear();
    }
    if (mountedRef.current) setDiagnosticsRevision((revision) => revision + 1);
  }, []);

  const invalidateDocuments = useCallback((): void => {
    cancelWorkspaceSymbolSearch();
    for (const document of documentsRef.current.values()) {
      if (document.changeTimer) clearTimeout(document.changeTimer);
      document.open = false;
    }
    syncEpochRef.current += 1;
    documentsRef.current.clear();
    startupsRef.current.clear();
    publishSemanticRevision();
    clearDiagnostics();
  }, [cancelWorkspaceSymbolSearch, clearDiagnostics, publishSemanticRevision]);

  const flushCurrentDocument = useCallback(async (path: string): Promise<void> => {
    const document = documentsRef.current.get(path);
    if (!document?.open) return;
    if (document.changeTimer) clearTimeout(document.changeTimer);
    document.changeTimer = undefined;

    // Drain every optimistic snapshot through one serialized queue. Semantic requests await this
    // function, so they cannot overtake an in-flight didChange.
    while (documentsRef.current.get(path) === document && document.open) {
      if (document.pendingText !== undefined && document.pendingVersion !== undefined) {
        const text = document.pendingText;
        const version = document.pendingVersion;
        document.pendingText = undefined;
        document.pendingVersion = undefined;
        const previous = document.changeQueue;
        const send = previous
          .catch(() => undefined)
          .then(async () => {
            if (documentsRef.current.get(path) !== document || !document.open) return;
            try {
              await dependenciesRef.current.documentSync.didChange({
                document: {
                  workspaceId: document.workspaceId,
                  path: document.path,
                  uri: document.uri,
                  languageId: "java",
                  text,
                  version,
                },
              });
              document.sentVersion = Math.max(document.sentVersion, version);
            } catch (syncError) {
              if (
                documentsRef.current.get(path) === document &&
                document.version === version &&
                document.pendingText === undefined
              ) {
                document.pendingText = text;
                document.pendingVersion = version;
              }
              throw syncError;
            }
            if (
              documentsRef.current.get(path) === document && document.open && !document.closing &&
              document.version === version && document.pendingText === undefined
            ) {
              await dependenciesRef.current.documentSync.revalidate?.({
                document: { workspaceId: document.workspaceId, path: document.path,
                  uri: document.uri, version },
              });
            }
          });
        document.changeQueue = send;
      }

      const pendingQueue = document.changeQueue;
      await pendingQueue;
      if (
        documentsRef.current.get(path) !== document ||
        !document.open ||
        (document.pendingText === undefined && pendingQueue === document.changeQueue)
      ) {
        return;
      }
    }
  }, []);

  const waitForCurrentStartup = useCallback(async (path: string): Promise<void> => {
    const workspaceId = workspaceIdRef.current;
    const syncEpoch = syncEpochRef.current;
    await Promise.all(
      [...startupsRef.current.values()]
        .filter(
          (startup) =>
            startup.path === path &&
            startup.workspaceId === workspaceId &&
            startup.syncEpoch === syncEpoch,
        )
        .map((startup) => startup.promise),
    );
  }, []);

  const flush = useCallback(
    async (path: string): Promise<void> => {
      if (!isJavaPath(path)) return;
      await waitForCurrentStartup(path);
      await flushCurrentDocument(path);
    },
    [flushCurrentDocument, waitForCurrentStartup],
  );

  const searchWorkspaceSymbols = useCallback(
    async (query: string, signal?: AbortSignal): Promise<JavaWorkspaceSymbolsResponse> => {
      cancelWorkspaceSymbolSearch();
      const workspace = workspaceInfoRef.current;
      const status = statusRef.current;
      const normalizedQuery = query.trim();
      if (
        !workspace?.id ||
        !status ||
        status.workspaceId !== workspace.id ||
        !READY_SESSION_STATES.has(status.state) ||
        status.projectJdkHome !== dependenciesRef.current.projectJdkHome ||
        (status.serverJdkHome ?? "") !== (dependenciesRef.current.serverJdkHome ?? "") ||
        status.gradleImportEnabled !== dependenciesRef.current.gradleImportEnabled ||
        status.gradleSettingsConfigured !== Boolean(dependenciesRef.current.gradle) ||
        !sameMavenProfiles(
          status,
          dependenciesRef.current.activeMavenProfiles,
          dependenciesRef.current.inactiveMavenProfiles,
        ) ||
        !sameProjectPath(status, dependenciesRef.current.projectPath) ||
        !sameMavenRepository(status, dependenciesRef.current.mavenRepository) ||
        !sameFormatterProfile(status, dependenciesRef.current.javaFormatterProfile) ||
        sessionGradleSettingsSignatureRef.current !==
          gradleSettingsSignature(dependenciesRef.current.gradle) ||
        !status.capabilities.workspaceSymbols ||
        !normalizedQuery ||
        normalizedQuery.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(query)
      ) {
        return unavailableSemanticFailure(`workspace-symbol-${Date.now().toString(36)}`);
      }

      workspaceSymbolRequestSequenceRef.current += 1;
      const sequence = workspaceSymbolRequestSequenceRef.current;
      const requestId = `desktop-java-workspace-symbols-${Date.now().toString(36)}-${sequence}`;
      const cancellationId = `desktop-java-workspace-symbols-cancel-${Date.now().toString(36)}-${sequence}`;
      const request: JavaWorkspaceSymbolsRequest = {
        workspaceId: workspace.id,
        generation: status.generation,
        query: normalizedQuery,
        requestId,
        cancellationId,
      };
      workspaceSymbolCancellationIdRef.current = cancellationId;
      const workspaceGeneration = workspaceGenerationRef.current;
      const current = () =>
        mountedRef.current &&
        workspaceIdRef.current === workspace.id &&
        workspaceGenerationRef.current === workspaceGeneration &&
        workspaceSymbolCancellationIdRef.current === cancellationId &&
        statusRef.current?.workspaceId === workspace.id &&
        statusRef.current?.generation === status.generation &&
        statusRef.current.projectJdkHome === dependenciesRef.current.projectJdkHome &&
        (statusRef.current.serverJdkHome ?? "") === (dependenciesRef.current.serverJdkHome ?? "") &&
        statusRef.current?.gradleImportEnabled === dependenciesRef.current.gradleImportEnabled &&
        statusRef.current?.gradleSettingsConfigured === Boolean(dependenciesRef.current.gradle) &&
        sameMavenProfiles(
          statusRef.current,
          dependenciesRef.current.activeMavenProfiles,
          dependenciesRef.current.inactiveMavenProfiles,
        ) &&
        sameProjectPath(statusRef.current, dependenciesRef.current.projectPath) &&
        sameMavenRepository(statusRef.current, dependenciesRef.current.mavenRepository) &&
        sameFormatterProfile(statusRef.current, dependenciesRef.current.javaFormatterProfile) &&
        sessionGradleSettingsSignatureRef.current ===
          gradleSettingsSignature(dependenciesRef.current.gradle) &&
        statusRef.current.capabilities.workspaceSymbols === true;

      const cancelIfCurrent = () => {
        if (workspaceSymbolCancellationIdRef.current === cancellationId)
          cancelWorkspaceSymbolSearch();
      };
      signal?.addEventListener("abort", cancelIfCurrent, { once: true });
      if (signal?.aborted) cancelIfCurrent();

      const documentSnapshot = () =>
        [...documentsRef.current.values()]
          .filter(
            (document) =>
              document.open &&
              !document.closing &&
              document.workspaceId === workspace.id &&
              document.generation === status.generation,
          )
          .map((document) => ({
            path: document.path,
            version: document.version,
            syncEpoch: document.syncEpoch,
          }))
          .sort((left, right) => left.path.localeCompare(right.path));

      try {
        if (signal?.aborted) return staleSemanticFailure(requestId);
        let flushedDocuments: ReturnType<typeof documentSnapshot> = [];
        let synchronized = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const beforeFlush = documentSnapshot();
          await Promise.all(beforeFlush.map(({ path }) => flushCurrentDocument(path)));
          if (!current()) return staleSemanticFailure(requestId);
          flushedDocuments = documentSnapshot();
          if (JSON.stringify(beforeFlush) === JSON.stringify(flushedDocuments)) {
            synchronized = true;
            break;
          }
        }
        if (!synchronized) return staleSemanticFailure(requestId);
        const sameDocuments = () =>
          JSON.stringify(documentSnapshot()) === JSON.stringify(flushedDocuments);
        if (!current() || !sameDocuments()) return staleSemanticFailure(requestId);

        const response = await dependenciesRef.current.javaIntelligence.workspaceSymbols(request);
        if (!current() || !sameDocuments()) return staleSemanticFailure(requestId);
        if (response.requestId !== requestId) {
          return {
            ok: false,
            requestId,
            error: {
              kind: "malformed-result",
              summary: "Java workspace-symbol provider returned a mismatched request ID",
            },
          };
        }
        if (
          response.ok &&
          (response.result.workspaceId !== request.workspaceId ||
            response.result.generation !== request.generation)
        ) {
          return {
            ok: false,
            requestId,
            error: {
              kind: "malformed-result",
              summary: "Java workspace-symbol provider returned mismatched workspace metadata",
            },
          };
        }
        return response;
      } catch {
        return current() ? unavailableSemanticFailure(requestId) : staleSemanticFailure(requestId);
      } finally {
        signal?.removeEventListener("abort", cancelIfCurrent);
        if (workspaceSymbolCancellationIdRef.current === cancellationId)
          workspaceSymbolCancellationIdRef.current = null;
      }
    },
    [cancelWorkspaceSymbolSearch, flushCurrentDocument],
  );

  const closeCurrentDocument = useCallback(
    async (path: string): Promise<void> => {
      const document = documentsRef.current.get(path);
      if (!document) {
        clearDiagnostics(path);
        return;
      }
      if (document.changeTimer) clearTimeout(document.changeTimer);
      document.closing = true;
      publishSemanticRevision();
      try {
        try {
          await flushCurrentDocument(path);
        } catch {
          console.warn("[App] Java document change flush failed during cleanup", { path });
        }
        if (document.open) {
          if (document.pendingText !== undefined || document.sentVersion !== document.version)
            await flushCurrentDocument(path);
          document.open = false;
          await dependenciesRef.current.documentSync.didClose({
            document: {
              workspaceId: document.workspaceId,
              path: document.path,
              uri: document.uri,
              version: document.version,
            },
          });
        }
      } catch {
        // The session may already be gone. Never include source text or adapter errors in logs.
        console.warn("[App] Java document cleanup failed", { path });
      } finally {
        if (documentsRef.current.get(path) === document) documentsRef.current.delete(path);
        clearDiagnostics(path);
      }
    },
    [clearDiagnostics, flushCurrentDocument, publishSemanticRevision],
  );

  const closeDocument = useCallback(
    async (path: string): Promise<void> => {
      if (!isJavaPath(path)) return;
      await waitForCurrentStartup(path);
      await closeCurrentDocument(path);
    },
    [closeCurrentDocument, waitForCurrentStartup],
  );

  const closeAll = useCallback(async (): Promise<void> => {
    cancelWorkspaceSymbolSearch();
    // Invalidate unresolved status/start/didOpen work before taking the cleanup snapshot. A stale
    // didOpen completion performs its own best-effort close and cannot repopulate this map.
    syncEpochRef.current += 1;
    startupsRef.current.clear();
    publishSemanticRevision();
    clearDiagnostics();
    const paths = [...documentsRef.current.keys()];
    await Promise.all(paths.map(closeCurrentDocument));
  }, [
    cancelWorkspaceSymbolSearch,
    clearDiagnostics,
    closeCurrentDocument,
    publishSemanticRevision,
  ]);

  const applyStatus = useCallback(
    (next: LanguageServiceStatus, workspaceId: string, workspaceGeneration: number): boolean => {
      if (
        workspaceIdRef.current !== workspaceId ||
        workspaceGenerationRef.current !== workspaceGeneration ||
        next.workspaceId !== workspaceId
      ) {
        return false;
      }
      if (
        READY_SESSION_STATES.has(next.state) &&
        (next.projectJdkHome !== dependenciesRef.current.projectJdkHome ||
          (next.serverJdkHome ?? "") !== (dependenciesRef.current.serverJdkHome ?? "") ||
          next.gradleImportEnabled !== dependenciesRef.current.gradleImportEnabled ||
          next.gradleSettingsConfigured !== Boolean(dependenciesRef.current.gradle) ||
          !sameMavenProfiles(
            next,
            dependenciesRef.current.activeMavenProfiles,
            dependenciesRef.current.inactiveMavenProfiles,
          ) ||
          !sameProjectPath(next, dependenciesRef.current.projectPath) ||
          !sameMavenRepository(next, dependenciesRef.current.mavenRepository) ||
          !sameFormatterProfile(next, dependenciesRef.current.javaFormatterProfile) ||
          sessionGradleSettingsSignatureRef.current !==
            gradleSettingsSignature(dependenciesRef.current.gradle))
      )
        return false;

      const current = statusRef.current;
      if (current?.workspaceId === workspaceId && next.generation < current.generation)
        return false;
      if (
        current?.workspaceId === workspaceId &&
        (next.generation !== current.generation ||
          (next.state !== current.state &&
            (next.state === "stopped" || next.state === "unavailable")))
      ) {
        // Repeated reports of the stopped generation must not cancel its pending startup.
        invalidateDocuments();
      }
      statusRef.current = next;
      if (mountedRef.current) {
        setStatus(next);
        setError(next.lastError ?? null);
      }
      return true;
    },
    [invalidateDocuments],
  );

  const load = useCallback(
    async (workspaceId?: string, workspaceGeneration?: number): Promise<void> => {
      const targetWorkspaceId = workspaceId ?? workspaceIdRef.current;
      const targetGeneration = workspaceGeneration ?? workspaceGenerationRef.current;
      if (!targetWorkspaceId) return;

      const requestId = ++statusRequestRef.current;
      if (mountedRef.current) {
        setRefreshing(true);
        setError(null);
      }
      try {
        const next = await dependenciesRef.current.languageSession.getStatus({
          workspaceId: targetWorkspaceId,
        });
        if (statusRequestRef.current !== requestId) return;
        applyStatus(next, targetWorkspaceId, targetGeneration);
      } catch (loadError) {
        if (
          statusRequestRef.current !== requestId ||
          workspaceIdRef.current !== targetWorkspaceId ||
          workspaceGenerationRef.current !== targetGeneration
        ) {
          return;
        }
        const message = errorMessage(loadError);
        const failed = failedStatus(
          targetWorkspaceId,
          statusRef.current?.workspaceId === targetWorkspaceId ? statusRef.current.generation : 0,
          message,
        );
        statusRef.current = failed;
        if (mountedRef.current) {
          setStatus(failed);
          setError(message);
        }
        console.error("[App] Failed to load language service status:", loadError);
      } finally {
        if (
          mountedRef.current &&
          statusRequestRef.current === requestId &&
          workspaceIdRef.current === targetWorkspaceId &&
          workspaceGenerationRef.current === targetGeneration
        ) {
          setRefreshing(false);
        }
      }
    },
    [applyStatus],
  );

  const attach = useCallback(
    (workspace: WorkspaceInfo, workspaceGeneration: number): void => {
      if (
        workspaceIdRef.current === workspace.id &&
        workspaceGenerationRef.current === workspaceGeneration &&
        unsubscribeRef.current
      ) {
        workspaceInfoRef.current = workspace;
        return;
      }

      statusRequestRef.current += 1;
      lifecycleRequestRef.current += 1;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      workspaceInfoRef.current = workspace;
      workspaceIdRef.current = workspace.id;
      workspaceGenerationRef.current = workspaceGeneration;
      statusRef.current = null;
      diagnosticsRef.current.clear();
      if (mountedRef.current) {
        setStatus(null);
        setError(null);
        setRefreshing(false);
        setDiagnosticsRevision((revision) => revision + 1);
      }

      unsubscribeRef.current = dependenciesRef.current.languageSession.subscribe(
        workspace.id,
        (event) => {
          if (
            workspaceIdRef.current !== workspace.id ||
            workspaceGenerationRef.current !== workspaceGeneration
          ) {
            return;
          }
          if (event.type === "status") {
            applyStatus(event.status, workspace.id, workspaceGeneration);
            return;
          }
          if (event.workspaceId !== workspace.id) return;
          const current = statusRef.current;
          if (!current || event.generation !== current.generation) return;
          if (event.type === "progress") {
            const next = { ...current, progress: event.progress };
            statusRef.current = next;
            if (mountedRef.current) setStatus(next);
            return;
          }

          const document = documentsRef.current.get(event.document.path);
          if (
            !document?.open ||
            document.workspaceId !== workspace.id ||
            document.generation !== event.generation ||
            document.syncEpoch !== syncEpochRef.current ||
            event.document.workspaceId !== document.workspaceId ||
            event.document.path !== document.path ||
            event.document.uri !== document.uri ||
            event.document.version !== document.version
          ) {
            return;
          }
          const key = `${event.provider}\u0000${event.document.path}`;
          const previous = diagnosticsRef.current.get(key);
          // Explicitly reject older evidence. Unversioned provider events are receipt-associated
          // with the synchronized version by the adapter before crossing this port.
          if (previous && event.document.version < previous.document.version) return;
          diagnosticsRef.current.set(key, event);
          if (mountedRef.current) setDiagnosticsRevision((revision) => revision + 1);
        },
      );
    },
    [applyStatus],
  );

  const activate = useCallback(
    async (path: string, text: string): Promise<void> => {
      if (!isJavaPath(path)) return;
      const workspace = workspaceInfoRef.current;
      const workspaceGeneration = workspaceGenerationRef.current;
      let syncEpoch = syncEpochRef.current;
      const initialSessionGeneration = statusRef.current?.generation ?? 0;
      if (!workspace?.id || workspaceIdRef.current !== workspace.id) return;

      const existing = documentsRef.current.get(path);
      if (
        existing?.open &&
        existing.workspaceId === workspace.id &&
        existing.generation === statusRef.current?.generation &&
        existing.syncEpoch === syncEpoch
      ) {
        // Buffer replacement (for example, an explicit discard in the editor) can change
        // the text while the language document remains open. Keep the existing LSP document
        // synchronized instead of treating activation as a no-op.
        if (existing.text !== text) {
          existing.version += 1;
          existing.text = text;
          existing.pendingText = text;
          existing.pendingVersion = existing.version;
          publishSemanticRevision();
          await flushCurrentDocument(path);
        }
        return;
      }
      // A pending open still owns the path after the first session status arrives.
      // Session retirement invalidates the synchronization epoch and clears these entries.
      const startupKey = JSON.stringify([workspace.id, path]);
      const pending = startupsRef.current.get(startupKey);
      if (pending?.syncEpoch === syncEpoch) return pending.promise;

      let sessionGeneration = initialSessionGeneration;
      const tokenIsCurrent = (): boolean =>
        workspaceGenerationRef.current === workspaceGeneration &&
        workspaceIdRef.current === workspace.id &&
        syncEpochRef.current === syncEpoch &&
        (sessionGeneration === 0 || statusRef.current?.generation === sessionGeneration);

      const openDocument = async () => {
        if (!tokenIsCurrent()) return;
        let nextStatus = await dependenciesRef.current.languageSession.getStatus({
          workspaceId: workspace.id,
        });
        if (!tokenIsCurrent()) return;
        if (
          nextStatus.state === "stopped" ||
          (READY_SESSION_STATES.has(nextStatus.state) &&
            (nextStatus.projectJdkHome !== dependenciesRef.current.projectJdkHome ||
              (nextStatus.serverJdkHome ?? "") !== (dependenciesRef.current.serverJdkHome ?? "") ||
              nextStatus.gradleImportEnabled !== dependenciesRef.current.gradleImportEnabled ||
              nextStatus.gradleSettingsConfigured !== Boolean(dependenciesRef.current.gradle) ||
              !sameMavenProfiles(
                nextStatus,
                dependenciesRef.current.activeMavenProfiles,
                dependenciesRef.current.inactiveMavenProfiles,
              ) ||
              !sameProjectPath(nextStatus, dependenciesRef.current.projectPath) ||
              !sameMavenRepository(nextStatus, dependenciesRef.current.mavenRepository) ||
              !sameFormatterProfile(nextStatus, dependenciesRef.current.javaFormatterProfile) ||
              sessionGradleSettingsSignatureRef.current !==
                gradleSettingsSignature(dependenciesRef.current.gradle)))
        ) {
          const requestId = ++lifecycleRequestRef.current;
          const projectJdkHome = dependenciesRef.current.projectJdkHome;
          const serverJdkHome = dependenciesRef.current.serverJdkHome;
          const gradleImportEnabled = dependenciesRef.current.gradleImportEnabled;
          const gradle = dependenciesRef.current.gradle
            ? structuredClone(dependenciesRef.current.gradle)
            : undefined;
          const gradleSignature = gradleSettingsSignature(gradle);
          const projectPath = dependenciesRef.current.projectPath;
          const mavenRepository = dependenciesRef.current.mavenRepository;
          const javaFormatterProfile = dependenciesRef.current.javaFormatterProfile
            ? { ...dependenciesRef.current.javaFormatterProfile }
            : undefined;
          const javaFormatterProfileSignature = formatterProfileSignature(javaFormatterProfile);
          const activeMavenProfiles = [...dependenciesRef.current.activeMavenProfiles];
          const inactiveMavenProfiles = [...dependenciesRef.current.inactiveMavenProfiles];
          nextStatus = await dependenciesRef.current.languageSession.start({
            workspaceId: workspace.id,
            requestId: `desktop-java-activation-${requestId}`,
            ...(projectJdkHome !== undefined ? { projectJdkHome } : {}),
            ...(serverJdkHome ? { serverJdkHome } : {}),
            gradleImportEnabled,
            projectPath,
            mavenRepository,
            activeMavenProfiles,
            inactiveMavenProfiles,
            ...(gradle ? { gradle } : {}),
            ...(javaFormatterProfile ? { javaFormatterProfile } : {}),
          });
          if (
            !tokenIsCurrent() ||
            projectJdkHome !== dependenciesRef.current.projectJdkHome ||
            serverJdkHome !== dependenciesRef.current.serverJdkHome ||
            gradleImportEnabled !== dependenciesRef.current.gradleImportEnabled ||
            gradleSignature !== gradleSettingsSignature(dependenciesRef.current.gradle) ||
            projectPath !== dependenciesRef.current.projectPath ||
            mavenRepository !== dependenciesRef.current.mavenRepository ||
            javaFormatterProfileSignature !==
              formatterProfileSignature(dependenciesRef.current.javaFormatterProfile) ||
            mavenProfileSignature(activeMavenProfiles, inactiveMavenProfiles) !==
              mavenProfileSignature(
                dependenciesRef.current.activeMavenProfiles,
                dependenciesRef.current.inactiveMavenProfiles,
              )
          )
            return;
        }
        sessionGradleSettingsSignatureRef.current = gradleSettingsSignature(
          dependenciesRef.current.gradle,
        );
        if (!applyStatus(nextStatus, workspace.id, workspaceGeneration)) return;
        sessionGeneration = nextStatus.generation;
        syncEpoch = syncEpochRef.current;
        if (!tokenIsCurrent()) return;
        if (!READY_SESSION_STATES.has(nextStatus.state) || !nextStatus.capabilities.documentSync) {
          return;
        }
        const documentEpoch = syncEpochRef.current;
        if (
          workspaceGenerationRef.current !== workspaceGeneration ||
          workspaceIdRef.current !== workspace.id ||
          statusRef.current?.generation !== nextStatus.generation
        ) {
          return;
        }
        if (startup.syncEpoch !== documentEpoch) {
          startup.syncEpoch = documentEpoch;
          startupsRef.current.set(startupKey, startup);
        }

        const currentText = dependenciesRef.current.getEditorState().contents[path] ?? text;
        const document: SynchronizedJavaDocument = {
          workspaceId: workspace.id,
          generation: nextStatus.generation,
          syncEpoch: documentEpoch,
          path,
          uri: createWorkspaceFileUri(workspace.rootPath, path),
          version: INITIAL_DOCUMENT_VERSION,
          text: currentText,
          sentVersion: INITIAL_DOCUMENT_VERSION,
          open: false,
          changeQueue: Promise.resolve(),
        };
        documentsRef.current.set(path, document);
        try {
          await dependenciesRef.current.documentSync.didOpen({
            document: {
              workspaceId: document.workspaceId,
              path: document.path,
              uri: document.uri,
              languageId: "java",
              text: document.text,
              version: document.version,
            },
          });
          const currentAfterOpen =
            workspaceGenerationRef.current === workspaceGeneration &&
            workspaceIdRef.current === workspace.id &&
            statusRef.current?.generation === document.generation &&
            syncEpochRef.current === document.syncEpoch &&
            documentsRef.current.get(path) === document;
          if (!currentAfterOpen) {
            if (documentsRef.current.get(path) === document) documentsRef.current.delete(path);
            if (
              workspaceIdRef.current === document.workspaceId &&
              statusRef.current?.generation === document.generation
            ) {
              try {
                await dependenciesRef.current.documentSync.didClose({
                  document: {
                    workspaceId: document.workspaceId,
                    path: document.path,
                    uri: document.uri,
                    version: document.version,
                  },
                });
              } catch {
                console.warn("[App] Stale Java document cleanup failed", { path });
              }
            }
            return;
          }
          document.open = true;
          publishSemanticRevision();
          try {
            await dependenciesRef.current.documentSync.revalidate?.({
              document: { workspaceId: document.workspaceId, path, uri: document.uri, version: document.sentVersion },
            });
          } catch {
            console.warn("[App] Initial Java document validation failed", { path });
          }
          if (document.pendingText !== undefined) {
            document.changeTimer = setTimeout(() => {
              document.changeTimer = undefined;
              void flushCurrentDocument(path).catch(() => {
                console.warn("[App] Java document change synchronization failed", { path });
              });
            }, JAVA_CHANGE_DEBOUNCE_MS);
          }
        } catch (openError) {
          if (documentsRef.current.get(path) === document) documentsRef.current.delete(path);
          throw openError;
        }
      };

      const startup: JavaDocumentStartup = {
        workspaceId: workspace.id,
        path,
        syncEpoch,
        promise: Promise.resolve().then(openDocument),
      };
      startupsRef.current.set(startupKey, startup);
      try {
        await startup.promise;
      } catch {
        // Activation remains retryable and source text is deliberately redacted.
        console.warn("[App] Java document activation failed", { path });
      } finally {
        if (startupsRef.current.get(startupKey) === startup) startupsRef.current.delete(startupKey);
      }
    },
    [applyStatus, flushCurrentDocument, publishSemanticRevision],
  );

  const queueChange = useCallback(
    (path: string, text: string): void => {
      if (!isJavaPath(path)) return;
      const document = documentsRef.current.get(path);
      if (!document || document.closing) return;
      document.version += 1;
      document.text = text;
      document.pendingText = text;
      document.pendingVersion = document.version;
      clearDiagnostics(path);
      publishSemanticRevision();
      if (!document.open) return;
      if (document.changeTimer) clearTimeout(document.changeTimer);
      document.changeTimer = setTimeout(() => {
        document.changeTimer = undefined;
        void flushCurrentDocument(path).catch(() => {
          console.warn("[App] Java document change synchronization failed", { path });
        });
      }, JAVA_CHANGE_DEBOUNCE_MS);
    },
    [clearDiagnostics, flushCurrentDocument, publishSemanticRevision],
  );

  const synchronizeEditorDocument = useCallback(async (path: string): Promise<void> => {
    if (!isJavaPath(path)) return;
    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) return;
    const workspaceGeneration = workspaceGenerationRef.current;
    const text = dependenciesRef.current.getEditorState().contents[path];
    if (text === undefined) return;
    if (documentsRef.current.get(path)?.text !== text) queueChange(path, text);
    await flush(path);
    if (!mountedRef.current || workspaceIdRef.current !== workspaceId || workspaceGenerationRef.current !== workspaceGeneration)
      return;
    const currentText = dependenciesRef.current.getEditorState().contents[path];
    const currentDocument = documentsRef.current.get(path);
    if (currentText !== undefined && (!currentDocument || (currentDocument.open && !currentDocument.closing)))
      await activate(path, currentText);
  }, [activate, flush, queueChange]);

  const notifySaved = useCallback(
    async (path: string): Promise<void> => {
      if (!isJavaPath(path)) {
        const workspace = workspaceInfoRef.current;
        const current = statusRef.current;
        if (workspace && current?.workspaceId === workspace.id && READY_SESSION_STATES.has(current.state)) {
          try {
            await dependenciesRef.current.documentSync.didSaveWorkspaceFile?.({
              document: { workspaceId: workspace.id, path, uri: createWorkspaceFileUri(workspace.rootPath, path) },
            });
          } catch {
            if (mountedRef.current && workspaceIdRef.current === workspace.id && statusRef.current?.generation === current.generation)
              setError("The file was saved, but its change could not be sent to the Java language service. Refresh or restart the service.");
          }
        }
        return;
      }
      await waitForCurrentStartup(path);
      const document = documentsRef.current.get(path);
      if (!document?.open || document.closing) return;
      const authoritativeText =
        dependenciesRef.current.getEditorState().contents[path] ?? document.text;
      if (authoritativeText !== document.text) queueChange(path, authoritativeText);
      await flushCurrentDocument(path);
      if (documentsRef.current.get(path) !== document || !document.open || document.closing) return;
      document.text = authoritativeText;
      await dependenciesRef.current.documentSync.didSave({
        document: {
          workspaceId: document.workspaceId,
          path: document.path,
          uri: document.uri,
          languageId: "java",
          text: authoritativeText,
          version: document.version,
        },
      });
    },
    [flushCurrentDocument, queueChange, waitForCurrentStartup],
  );

  const runLifecycle = useCallback(
    async (action: "start" | "stop" | "restart"): Promise<void> => {
      const workspaceId = workspaceIdRef.current;
      const workspaceGeneration = workspaceGenerationRef.current;
      if (!workspaceId) return;
      const requestId = ++lifecycleRequestRef.current;
      const projectJdkHome = dependenciesRef.current.projectJdkHome;
      const serverJdkHome = dependenciesRef.current.serverJdkHome;
      const gradleImportEnabled = dependenciesRef.current.gradleImportEnabled;
      const gradle = dependenciesRef.current.gradle
        ? structuredClone(dependenciesRef.current.gradle)
        : undefined;
      const gradleSignature = gradleSettingsSignature(gradle);
      const projectPath = dependenciesRef.current.projectPath;
      const mavenRepository = dependenciesRef.current.mavenRepository;
      const javaFormatterProfile = dependenciesRef.current.javaFormatterProfile
        ? { ...dependenciesRef.current.javaFormatterProfile }
        : undefined;
      const javaFormatterProfileSignature = formatterProfileSignature(javaFormatterProfile);
      const activeMavenProfiles = [...dependenciesRef.current.activeMavenProfiles];
      const inactiveMavenProfiles = [...dependenciesRef.current.inactiveMavenProfiles];
      const profileSignature = mavenProfileSignature(activeMavenProfiles, inactiveMavenProfiles);
      const current = statusRef.current;
      if ((action === "stop" || action === "restart") && !current) return;

      if (current?.workspaceId === workspaceId) {
        const transitional: LanguageServiceStatus = {
          ...current,
          state: action === "stop" ? "stopping" : "starting",
          capabilities: { ...current.capabilities, documentSync: false, diagnostics: false },
          progress: undefined,
          lastError: undefined,
          checkedAt: new Date().toISOString(),
        };
        statusRef.current = transitional;
        if (mountedRef.current) setStatus(transitional);
      }
      if (mountedRef.current) setError(null);

      try {
        if (action === "stop" || action === "restart") await closeAll();
        if (
          lifecycleRequestRef.current !== requestId ||
          workspaceIdRef.current !== workspaceId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          projectJdkHome !== dependenciesRef.current.projectJdkHome ||
          serverJdkHome !== dependenciesRef.current.serverJdkHome ||
          gradleImportEnabled !== dependenciesRef.current.gradleImportEnabled ||
          gradleSignature !== gradleSettingsSignature(dependenciesRef.current.gradle) ||
          projectPath !== dependenciesRef.current.projectPath ||
          mavenRepository !== dependenciesRef.current.mavenRepository ||
          javaFormatterProfileSignature !==
            formatterProfileSignature(dependenciesRef.current.javaFormatterProfile) ||
          profileSignature !==
            mavenProfileSignature(
              dependenciesRef.current.activeMavenProfiles,
              dependenciesRef.current.inactiveMavenProfiles,
            )
        )
          return;
        const next =
          action === "start"
            ? await dependenciesRef.current.languageSession.start({
                workspaceId,
                requestId: `desktop-${requestId}`,
                ...(projectJdkHome !== undefined ? { projectJdkHome } : {}),
                ...(serverJdkHome ? { serverJdkHome } : {}),
                gradleImportEnabled,
                projectPath,
                mavenRepository,
                activeMavenProfiles,
                inactiveMavenProfiles,
                ...(gradle ? { gradle } : {}),
                ...(javaFormatterProfile ? { javaFormatterProfile } : {}),
              })
            : action === "stop"
              ? await dependenciesRef.current.languageSession.stop({
                  workspaceId,
                  generation: current!.generation,
                  requestId: `desktop-${requestId}`,
                })
              : await dependenciesRef.current.languageSession.restart({
                  workspaceId,
                  generation: current!.generation,
                  requestId: `desktop-${requestId}`,
                  ...(projectJdkHome !== undefined ? { projectJdkHome } : {}),
                  ...(serverJdkHome ? { serverJdkHome } : {}),
                  gradleImportEnabled,
                  projectPath,
                  mavenRepository,
                  activeMavenProfiles,
                  inactiveMavenProfiles,
                  ...(gradle ? { gradle } : {}),
                  ...(javaFormatterProfile ? { javaFormatterProfile } : {}),
                });
        if (
          lifecycleRequestRef.current !== requestId ||
          projectJdkHome !== dependenciesRef.current.projectJdkHome ||
          serverJdkHome !== dependenciesRef.current.serverJdkHome ||
          gradleImportEnabled !== dependenciesRef.current.gradleImportEnabled ||
          gradleSignature !== gradleSettingsSignature(dependenciesRef.current.gradle) ||
          projectPath !== dependenciesRef.current.projectPath ||
          mavenRepository !== dependenciesRef.current.mavenRepository ||
          javaFormatterProfileSignature !==
            formatterProfileSignature(dependenciesRef.current.javaFormatterProfile) ||
          profileSignature !==
            mavenProfileSignature(
              dependenciesRef.current.activeMavenProfiles,
              dependenciesRef.current.inactiveMavenProfiles,
            )
        )
          return;
        sessionGradleSettingsSignatureRef.current = action === "stop" ? null : gradleSignature;
        if (!applyStatus(next, workspaceId, workspaceGeneration)) return;
        await load(workspaceId, workspaceGeneration);
        if (action === "start" || action === "restart") {
          const editor = dependenciesRef.current.getEditorState();
          const ready = dependenciesRef.current.readyActiveDocument;
          const paths = new Set(Object.keys(editor.contents).filter(isJavaPath));
          if (ready && isJavaPath(ready.path)) paths.add(ready.path);
          for (const path of paths) {
            const text = editor.contents[path] ?? (ready?.path === path ? ready.text : undefined);
            if (text !== undefined) await activate(path, text);
          }
        }
      } catch (lifecycleError) {
        if (
          lifecycleRequestRef.current !== requestId ||
          workspaceIdRef.current !== workspaceId ||
          workspaceGenerationRef.current !== workspaceGeneration
        ) {
          return;
        }
        const message = errorMessage(lifecycleError);
        const currentStatus = statusRef.current;
        if (currentStatus?.workspaceId === workspaceId) {
          const failed: LanguageServiceStatus = {
            ...currentStatus,
            state: "failed",
            progress: undefined,
            lastError: message,
            checkedAt: new Date().toISOString(),
          };
          statusRef.current = failed;
          if (mountedRef.current) setStatus(failed);
        }
        if (mountedRef.current) setError(message);
        console.error(`[App] Language service ${action} failed:`, lifecycleError);
      }
    },
    [activate, applyStatus, closeAll, load],
  );

  const detach = useCallback(
    async (nextWorkspaceGeneration: number): Promise<void> => {
      const oldWorkspaceId = workspaceIdRef.current;
      const oldStatus = statusRef.current;
      statusRequestRef.current += 1;
      lifecycleRequestRef.current += 1;
      await closeAll();
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      workspaceIdRef.current = null;
      workspaceInfoRef.current = null;
      workspaceGenerationRef.current = nextWorkspaceGeneration;
      statusRef.current = null;
      sessionGradleSettingsSignatureRef.current = dependenciesRef.current.gradle ? null : "";
      diagnosticsRef.current.clear();
      if (mountedRef.current) {
        setStatus(null);
        setError(null);
        setRefreshing(false);
        setDiagnosticsRevision((revision) => revision + 1);
      }

      if (
        oldWorkspaceId &&
        oldStatus &&
        oldStatus.state !== "stopped" &&
        oldStatus.state !== "unavailable"
      ) {
        const stopOldSession = dependenciesRef.current.languageSession
          .stop({
            workspaceId: oldWorkspaceId,
            generation: oldStatus.generation,
            requestId: `desktop-workspace-switch-${nextWorkspaceGeneration}`,
          })
          .catch((stopError) => {
            console.warn(
              "[App] Failed to stop old language service during workspace switch:",
              stopError,
            );
          });
        await Promise.race([
          stopOldSession,
          new Promise<void>((resolve) => setTimeout(resolve, 750)),
        ]);
      }
    },
    [closeAll],
  );

  const currentDocumentMatches = useCallback(
    (
      request:
        | JavaCompletionRequest
        | JavaHoverRequest
        | JavaSignatureHelpRequest
        | JavaFormattingRequest
        | JavaRenameRequest,
    ): boolean => {
      const current = documentsRef.current.get(request.document.path);
      const editor = dependenciesRef.current.getEditorState();
      const ready = dependenciesRef.current.readyActiveDocument;
      return Boolean(
        current &&
        current.open &&
        statusRef.current?.projectJdkHome === dependenciesRef.current.projectJdkHome &&
        (statusRef.current?.serverJdkHome ?? "") ===
          (dependenciesRef.current.serverJdkHome ?? "") &&
        statusRef.current?.gradleImportEnabled === dependenciesRef.current.gradleImportEnabled &&
        statusRef.current &&
        sameMavenProfiles(
          statusRef.current,
          dependenciesRef.current.activeMavenProfiles,
          dependenciesRef.current.inactiveMavenProfiles,
        ) &&
        sameProjectPath(statusRef.current, dependenciesRef.current.projectPath) &&
        sameMavenRepository(statusRef.current, dependenciesRef.current.mavenRepository) &&
        sameFormatterProfile(statusRef.current, dependenciesRef.current.javaFormatterProfile) &&
        sessionGradleSettingsSignatureRef.current ===
          gradleSettingsSignature(dependenciesRef.current.gradle) &&
        !current.closing &&
        ready?.path === request.document.path &&
        ready.text === current.text &&
        editor.activeFilePath === request.document.path &&
        Object.prototype.hasOwnProperty.call(editor.contents, request.document.path) &&
        editor.contents[request.document.path] === current.text &&
        workspaceIdRef.current === request.workspaceId &&
        statusRef.current?.workspaceId === request.workspaceId &&
        statusRef.current?.generation === request.generation &&
        current.workspaceId === request.workspaceId &&
        current.generation === request.generation &&
        current.syncEpoch === syncEpochRef.current &&
        current.path === request.document.path &&
        current.uri === request.document.uri &&
        current.version === request.document.version,
      );
    },
    [],
  );

  const prepareSemanticRequest = useCallback(
    async (
      request:
        JavaCompletionRequest | JavaHoverRequest | JavaSignatureHelpRequest | JavaFormattingRequest,
    ): Promise<"ready" | "stale" | "unavailable"> => {
      if (!currentDocumentMatches(request)) return "stale";
      try {
        await flushCurrentDocument(request.document.path);
      } catch {
        return "unavailable";
      }
      return currentDocumentMatches(request) ? "ready" : "stale";
    },
    [currentDocumentMatches, flushCurrentDocument],
  );

  const prepareSemanticWorkspaceRequest = useCallback(
    async (
      request: JavaRenameRequest | JavaCodeActionsRequest,
    ): Promise<
      | { state: "ready"; documents: Map<string, { uri: string; version: number; text: string }> }
      | { state: "stale" | "unavailable" }
    > => {
      if (!currentDocumentMatches(request)) return { state: "stale" };
      const openDocuments = [...documentsRef.current.values()].filter(
        (document) =>
          document.workspaceId === request.workspaceId &&
          document.generation === request.generation &&
          document.syncEpoch === syncEpochRef.current &&
          !document.closing,
      );
      try {
        await Promise.all(openDocuments.map((document) => flush(document.path)));
      } catch {
        return { state: "unavailable" };
      }
      if (!currentDocumentMatches(request)) return { state: "stale" };
      const editor = dependenciesRef.current.getEditorState();
      const documents = new Map<string, { uri: string; version: number; text: string }>();
      for (const document of documentsRef.current.values()) {
        if (
          document.workspaceId !== request.workspaceId ||
          document.generation !== request.generation ||
          document.syncEpoch !== syncEpochRef.current ||
          document.closing
        )
          continue;
        if (
          !document.open ||
          document.pendingText !== undefined ||
          document.sentVersion !== document.version ||
          !Object.prototype.hasOwnProperty.call(editor.contents, document.path) ||
          editor.contents[document.path] !== document.text
        )
          return { state: "stale" };
        documents.set(document.path, {
          uri: document.uri,
          version: document.version,
          text: document.text,
        });
      }
      return { state: "ready", documents };
    },
    [currentDocumentMatches, flush],
  );

  const semanticWorkspaceFrameMatches = useCallback(
    (
      request: JavaRenameRequest | JavaCodeActionsRequest,
      documents: ReadonlyMap<string, { uri: string; version: number; text: string }>,
    ): boolean => {
      const editor = dependenciesRef.current.getEditorState();
      return (
        currentDocumentMatches(request) &&
        [...documents].every(([path, captured]) => {
          const document = documentsRef.current.get(path);
          return Boolean(
            document?.open &&
            !document.closing &&
            document.workspaceId === request.workspaceId &&
            document.generation === request.generation &&
            document.syncEpoch === syncEpochRef.current &&
            document.uri === captured.uri &&
            document.version === captured.version &&
            document.sentVersion === captured.version &&
            document.pendingText === undefined &&
            document.text === captured.text &&
            editor.contents[path] === captured.text,
          );
        })
      );
    },
    [currentDocumentMatches],
  );

  const synchronizeCommittedDrafts = useCallback(
    async (
      request: JavaRenameRequest | JavaCodeActionsRequest,
      paths: Iterable<string>,
    ): Promise<void> => {
      const epoch = syncEpochRef.current;
      const current = (document: SynchronizedJavaDocument) =>
        document.open &&
        !document.closing &&
        document.workspaceId === request.workspaceId &&
        document.generation === request.generation &&
        document.syncEpoch === epoch &&
        syncEpochRef.current === epoch;
      const changed = [...new Set(paths)];
      try {
        for (const path of changed) {
          const document = documentsRef.current.get(path);
          const text = dependenciesRef.current.getEditorState().contents[path];
          if (document && current(document) && typeof text === "string") queueChange(path, text);
        }
        for (const path of changed) {
          const document = documentsRef.current.get(path);
          if (document && current(document)) await flush(path);
        }
        const port = dependenciesRef.current.documentSync;
        if (!port.revalidate) return;
        for (const document of [...documentsRef.current.values()]) {
          if (
            !current(document) ||
            document.pendingText !== undefined ||
            document.sentVersion !== document.version ||
            dependenciesRef.current.getEditorState().contents[document.path] !== document.text
          )
            continue;
          await port.revalidate({
            document: {
              workspaceId: document.workspaceId,
              path: document.path,
              uri: document.uri,
              version: document.version,
            },
          });
        }
      } catch {
        if (
          mountedRef.current &&
          workspaceIdRef.current === request.workspaceId &&
          syncEpochRef.current === epoch
        )
          setError(
            "Java draft edits were applied, but their diagnostics could not be refreshed. Restart the language service before further semantic edits.",
          );
      }
    },
    [queueChange, flush],
  );

  const readyActiveDocument = dependencies.readyActiveDocument;
  const hasJavaContext = isJavaPath(readyActiveDocument?.path);
  const capabilities = status?.capabilities ?? EMPTY_CAPABILITIES;
  const semanticDocument = readyActiveDocument
    ? documentsRef.current.get(readyActiveDocument.path)
    : undefined;
  const semanticSessionReady = Boolean(
    status &&
    READY_SESSION_STATES.has(status.state) &&
    status.projectJdkHome === dependencies.projectJdkHome &&
    (status.serverJdkHome ?? "") === (dependencies.serverJdkHome ?? "") &&
    status.gradleImportEnabled === dependencies.gradleImportEnabled &&
    sameProjectPath(status, dependencies.projectPath) &&
    sameMavenRepository(status, dependencies.mavenRepository) &&
    sameFormatterProfile(status, dependencies.javaFormatterProfile) &&
    sessionGradleSettingsSignatureRef.current === gradleSettingsSignature(dependencies.gradle) &&
    sameMavenProfiles(
      status,
      dependencies.activeMavenProfiles,
      dependencies.inactiveMavenProfiles,
    ) &&
    status.workspaceId === dependencies.workspaceInfo?.id,
  );
  const hasSemanticCapability = Boolean(
    capabilities.completion ||
    capabilities.hover ||
    capabilities.signature ||
    capabilities.documentSymbols ||
    capabilities.documentHighlights ||
    capabilities.definition ||
    capabilities.typeDefinition ||
    capabilities.implementation ||
    capabilities.callHierarchy ||
    capabilities.semanticTokens ||
    capabilities.inlayHints ||
    capabilities.codeActions ||
    capabilities.formatting ||
    capabilities.onTypeFormattingTriggers?.length ||
    capabilities.rename,
  );

  // Ref-only transitions trigger rendering. Only changes to the active document
  // replace its providers; opening a companion must not cancel an in-flight rename.
  void semanticRevision;
  const javaSemantics = useMemo<JavaEditorSemantics | undefined>(() => {
    if (
      !hasJavaContext ||
      !readyActiveDocument ||
      !semanticSessionReady ||
      !hasSemanticCapability ||
      !semanticDocument?.open ||
      semanticDocument.closing ||
      semanticDocument.workspaceId !== dependencies.workspaceInfo?.id ||
      semanticDocument.generation !== status?.generation ||
      semanticDocument.syncEpoch !== syncEpochRef.current ||
      semanticDocument.text !== readyActiveDocument.text
    ) {
      return undefined;
    }

    const context = {
      workspaceId: semanticDocument.workspaceId,
      generation: semanticDocument.generation,
      document: {
        path: semanticDocument.path,
        uri: semanticDocument.uri,
        version: semanticDocument.version,
      },
    };
    const requestDefinition = async (request: JavaDefinitionsRequest, kind: "definition" | "typeDefinition"): Promise<JavaDefinitionsResponse> => {
      const port = dependenciesRef.current.javaIntelligence;
      const provider = kind === "typeDefinition" ? port.typeDefinitions : port.definitions;
      if (!statusRef.current?.capabilities[kind] || !provider) {
        return unavailableSemanticFailure(request.requestId);
      }
      const prepared = await prepareSemanticRequest(request);
      if (prepared !== "ready") {
        return prepared === "stale"
          ? staleSemanticFailure(request.requestId)
          : unavailableSemanticFailure(request.requestId);
      }
      const response = await provider.call(port, {
        workspaceId: request.workspaceId,
        generation: request.generation,
        document: { ...request.document },
        position: { ...request.position },
        requestId: request.requestId,
        cancellationId: request.cancellationId,
      });
      return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
    };

    return {
      context,
      documentText: semanticDocument.text,
      semanticTokensEnabled: capabilities.semanticTokens === true,
      inlayHints:
        capabilities.inlayHints && dependenciesRef.current.javaIntelligence.inlayHints
          ? async (request: JavaInlayHintsRequest): Promise<JavaInlayHintsResponse> => {
              if (!statusRef.current?.capabilities.inlayHints) {
                return unavailableSemanticFailure(request.requestId);
              }
              const semanticRequest = { ...request, position: request.range.start };
              const prepared = await prepareSemanticRequest(semanticRequest);
              if (prepared !== "ready") {
                return prepared === "stale"
                  ? staleSemanticFailure(request.requestId)
                  : unavailableSemanticFailure(request.requestId);
              }
              const provider = dependenciesRef.current.javaIntelligence.inlayHints;
              if (!provider) return unavailableSemanticFailure(request.requestId);
              const response = await provider.call(dependenciesRef.current.javaIntelligence, {
                workspaceId: request.workspaceId,
                generation: request.generation,
                document: { ...request.document },
                range: { start: { ...request.range.start }, end: { ...request.range.end } },
                requestId: request.requestId,
                cancellationId: request.cancellationId,
              });
              return currentDocumentMatches(semanticRequest)
                ? response
                : staleSemanticFailure(request.requestId);
            }
          : undefined,
      formattingEnabled: capabilities.formatting === true,
      rangeFormattingEnabled: capabilities.rangeFormatting === true,
      onTypeFormattingTriggers: capabilities.onTypeFormattingTriggers ?? [],
      async completion(request): Promise<JavaCompletionResponse> {
        if (!statusRef.current?.capabilities.completion) {
          return unavailableSemanticFailure(request.requestId);
        }
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.completion({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          position: { ...request.position },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
          ...(request.trigger ? { trigger: { ...request.trigger } } : {}),
        });
        return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
      },
      async hover(request): Promise<JavaHoverResponse> {
        if (!statusRef.current?.capabilities.hover) {
          return unavailableSemanticFailure(request.requestId);
        }
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.hover({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          position: { ...request.position },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
      },
      async signatureHelp(request): Promise<JavaSignatureHelpResponse> {
        if (!statusRef.current?.capabilities.signature) {
          return unavailableSemanticFailure(request.requestId);
        }
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.signatureHelp({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          position: { ...request.position },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
      },
      async documentSymbols(request): Promise<JavaDocumentSymbolsResponse> {
        if (!statusRef.current?.capabilities.documentSymbols) {
          return unavailableSemanticFailure(request.requestId);
        }
        const currentRequest = { ...request, position: { line: 0, character: 0 } };
        const prepared = await prepareSemanticRequest(currentRequest);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.documentSymbols({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(currentRequest)
          ? response
          : staleSemanticFailure(request.requestId);
      },
      async documentHighlights(
        request: JavaDocumentHighlightsRequest,
      ): Promise<JavaDocumentHighlightsResponse> {
        if (!statusRef.current?.capabilities.documentHighlights) {
          return unavailableSemanticFailure(request.requestId);
        }
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.documentHighlights({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          position: { ...request.position },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
      },
      definitions: (request) => requestDefinition(request, "definition"),
      ...(capabilities.typeDefinition ? {
        typeDefinitions: (request: JavaDefinitionsRequest) => requestDefinition(request, "typeDefinition"),
      } : {}),
      async implementations(
        request: JavaImplementationsRequest,
      ): Promise<JavaImplementationsResponse> {
        if (!statusRef.current?.capabilities.implementation) {
          return unavailableSemanticFailure(request.requestId);
        }
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.implementations({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          position: { ...request.position },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
      },
      async callHierarchy(request: JavaCallHierarchyRequest): Promise<JavaCallHierarchyResponse> {
        const provider = dependenciesRef.current.javaIntelligence.callHierarchy;
        if (!statusRef.current?.capabilities.callHierarchy || !provider) {
          return unavailableSemanticFailure(request.requestId);
        }
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await provider.call(dependenciesRef.current.javaIntelligence, {
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          position: { ...request.position },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
          direction: request.direction,
        });
        return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
      },
      async references(request: JavaReferencesRequest): Promise<JavaReferencesResponse> {
        if (!statusRef.current?.capabilities.references) {
          return unavailableSemanticFailure(request.requestId);
        }
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.references({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          position: { ...request.position },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
          includeDeclaration: request.includeDeclaration,
        });
        return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
      },
      async semanticTokens(
        request: JavaSemanticTokensRequest,
      ): Promise<JavaSemanticTokensResponse> {
        if (!statusRef.current?.capabilities.semanticTokens) {
          return unavailableSemanticFailure(request.requestId);
        }
        const currentRequest = { ...request, position: { line: 0, character: 0 } };
        const prepared = await prepareSemanticRequest(currentRequest);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.semanticTokens({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(currentRequest)
          ? response
          : staleSemanticFailure(request.requestId);
      },
      async formatDocument(request: JavaFormattingRequest): Promise<JavaFormattingResponse> {
        if (!statusRef.current?.capabilities.formatting) {
          return unavailableSemanticFailure(request.requestId);
        }
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.formatDocument({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          options: { ...request.options },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(request) ? response : staleSemanticFailure(request.requestId);
      },
      async formatRange(request: JavaRangeFormattingRequest): Promise<JavaRangeFormattingResponse> {
        if (!statusRef.current?.capabilities.rangeFormatting) {
          return unavailableSemanticFailure(request.requestId);
        }
        const semanticRequest = { ...request, position: request.range.start };
        const prepared = await prepareSemanticRequest(semanticRequest);
        if (prepared !== "ready") {
          return prepared === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        }
        const response = await dependenciesRef.current.javaIntelligence.formatRange({
          workspaceId: request.workspaceId,
          generation: request.generation,
          document: { ...request.document },
          range: {
            start: { ...request.range.start },
            end: { ...request.range.end },
          },
          options: { ...request.options },
          requestId: request.requestId,
          cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(semanticRequest)
          ? response
          : staleSemanticFailure(request.requestId);
      },
      async formatOnType(request: JavaOnTypeFormattingRequest): Promise<JavaFormattingResponse> {
        const port = dependenciesRef.current.javaIntelligence;
        if (!port.formatOnType || !statusRef.current?.capabilities.onTypeFormattingTriggers?.includes(request.character))
          return unavailableSemanticFailure(request.requestId);
        const prepared = await prepareSemanticRequest(request);
        if (prepared !== "ready") return prepared === "stale"
          ? staleSemanticFailure(request.requestId) : unavailableSemanticFailure(request.requestId);
        if (dependenciesRef.current.javaIntelligence !== port ||
          !statusRef.current?.capabilities.onTypeFormattingTriggers?.includes(request.character))
          return staleSemanticFailure(request.requestId);
        const response = await port.formatOnType({
          workspaceId: request.workspaceId, generation: request.generation,
          document: { ...request.document }, position: { ...request.position },
          character: request.character, options: { ...request.options },
          requestId: request.requestId, cancellationId: request.cancellationId,
        });
        return currentDocumentMatches(request) && statusRef.current?.capabilities.onTypeFormattingTriggers?.includes(request.character)
          ? response : staleSemanticFailure(request.requestId);
      },
      async codeActions(request: JavaCodeActionsRequest): Promise<JavaCodeActionsResponse> {
        if (!statusRef.current?.capabilities.codeActions)
          return unavailableSemanticFailure(request.requestId);
        const prepared = await prepareSemanticWorkspaceRequest(request);
        if (prepared.state !== "ready")
          return prepared.state === "stale"
            ? staleSemanticFailure(request.requestId)
            : unavailableSemanticFailure(request.requestId);
        const response = await dependenciesRef.current.javaIntelligence.codeActions(
          copyCodeActionsRequest(request),
        );
        return semanticWorkspaceFrameMatches(request, prepared.documents)
          ? response
          : staleSemanticFailure(request.requestId);
      },
      async applyCodeAction(request: JavaCodeActionApplyRequest): Promise<boolean> {
        const { action } = request;
        const open = dependenciesRef.current.openSemanticDocument;
        const apply = dependenciesRef.current.applySemanticWorkspaceEdit;
        if (
          !statusRef.current?.capabilities.codeActions ||
          !open ||
          !apply ||
          activeWorkspaceEditsRef.current.has(request.cancellationId) ||
          !action.documentsToOpen?.length ||
          action.documentsToOpen.length > 128 ||
          new Set(action.documentsToOpen).size !== action.documentsToOpen.length ||
          !action.editPlanSha256 ||
          !action.sourceDocuments?.length ||
          action.memberSelection ||
          action.edits.length ||
          action.additionalEdits?.length
        )
          return false;
        const token = { cancelled: false };
        activeWorkspaceEditsRef.current.set(request.cancellationId, token);
        try {
          const initial = await prepareSemanticWorkspaceRequest(request);
          if (initial.state !== "ready") return false;
          const current = () =>
            !token.cancelled && semanticWorkspaceFrameMatches(request, initial.documents);
          for (const path of action.documentsToOpen) {
            if (!current()) return false;
            if (initial.documents.has(path)) continue;
            if (!(await open(path, current)) || !current()) return false;
            const text = dependenciesRef.current.getEditorState().contents[path];
            if (typeof text !== "string") return false;
            await activate(path, text);
            if (!current()) return false;
          }
          const prepared = await prepareSemanticWorkspaceRequest(request);
          if (prepared.state !== "ready" || !current()) return false;
          const response = await dependenciesRef.current.javaIntelligence.codeActions(
            copyCodeActionsRequest(request),
          );
          if (
            !response.ok ||
            !current() ||
            !semanticWorkspaceFrameMatches(request, prepared.documents)
          )
            return false;
          const selected = response.result.actions.find(
            (candidate) =>
              candidate.editPlanSha256 === action.editPlanSha256 &&
              !candidate.documentsToOpen &&
              !candidate.memberSelection,
          );
          if (
            !selected?.sourceDocuments ||
            selected.sourceDocuments.length !== action.sourceDocuments.length ||
            selected.sourceDocuments.some(
              (source) =>
                !action.sourceDocuments!.some(
                  (original) =>
                    original.path === source.path &&
                    original.contentSha256 === source.contentSha256,
                ),
            )
          )
            return false;
          const edits = new Map<string, JavaRenameDocumentEdits>();
          if (selected.edits.length)
            edits.set(request.document.path, { document: request.document, edits: selected.edits });
          for (const additional of selected.additionalEdits ?? []) {
            const captured = prepared.documents.get(additional.document.path);
            if (
              captured?.uri !== additional.document.uri ||
              captured.version !== additional.document.version
            )
              return false;
            const existing = edits.get(additional.document.path);
            if (existing) existing.edits.push(additional.edit);
            else
              edits.set(additional.document.path, {
                document: additional.document,
                edits: [additional.edit],
              });
          }
          if (
            !edits.size ||
            ![...edits.values()].every(({ document }) => {
              const captured = prepared.documents.get(document.path);
              return captured?.uri === document.uri && captured.version === document.version;
            })
          )
            return false;
          const applied = await apply([...edits.values()], prepared.documents);
          if (applied) await synchronizeCommittedDrafts(request, edits.keys());
          return applied;
        } catch {
          return false;
        } finally {
          if (activeWorkspaceEditsRef.current.get(request.cancellationId) === token)
            activeWorkspaceEditsRef.current.delete(request.cancellationId);
        }
      },
      async rename(request: JavaRenameRequest): Promise<JavaRenameResponse> {
        if (
          !statusRef.current?.capabilities.rename ||
          activeWorkspaceEditsRef.current.has(request.cancellationId)
        ) {
          return unavailableSemanticFailure(request.requestId);
        }
        const token = { cancelled: false };
        activeWorkspaceEditsRef.current.set(request.cancellationId, token);
        const current = () => !token.cancelled && currentDocumentMatches(request);
        const frameCurrent = (
          documents: ReadonlyMap<string, { uri: string; version: number; text: string }>,
        ) => !token.cancelled && semanticWorkspaceFrameMatches(request, documents);
        try {
          let prepared = await prepareSemanticWorkspaceRequest(request);
          if (prepared.state !== "ready") {
            return prepared.state === "stale"
              ? staleSemanticFailure(request.requestId)
              : unavailableSemanticFailure(request.requestId);
          }
          const baseline = prepared.documents;
          const opened = new Set<string>();
          for (;;) {
            const documents = prepared.documents;
            if (!frameCurrent(baseline) || !frameCurrent(documents))
              return staleSemanticFailure(request.requestId);
            const response = await dependenciesRef.current.javaIntelligence.rename({
              workspaceId: request.workspaceId,
              generation: request.generation,
              document: { ...request.document },
              position: { ...request.position },
              newName: request.newName,
              requestId: request.requestId,
              cancellationId: request.cancellationId,
            });
            if (!frameCurrent(baseline) || !frameCurrent(documents))
              return staleSemanticFailure(request.requestId);
            if (!response.ok) return response;
            const required = response.result.documentsToOpen;
            if (required !== undefined) {
              const open = dependenciesRef.current.openSemanticDocument;
              if (
                !open ||
                !required.length ||
                response.result.documentEdits.length ||
                required.some((path) => opened.has(path) || documents.has(path)) ||
                new Set(required).size !== required.length ||
                opened.size + required.length > 128
              ) {
                return unavailableSemanticFailure(request.requestId);
              }
              for (const path of required) {
                opened.add(path);
                if (!frameCurrent(baseline) || !current())
                  return staleSemanticFailure(request.requestId);
                if (!(await open(path, () => frameCurrent(baseline))))
                  return staleSemanticFailure(request.requestId);
                if (!frameCurrent(baseline)) return staleSemanticFailure(request.requestId);
                const text = dependenciesRef.current.getEditorState().contents[path];
                if (typeof text !== "string") return unavailableSemanticFailure(request.requestId);
                await activate(path, text);
                if (!frameCurrent(baseline)) return staleSemanticFailure(request.requestId);
              }
              // Discard the first response entirely. Only edits computed after didOpen
              // and a fresh captured document frame may reach the editor transaction.
              prepared = await prepareSemanticWorkspaceRequest(request);
              if (prepared.state !== "ready") return staleSemanticFailure(request.requestId);
              continue;
            }
            if (
              !response.result.documentEdits.every(({ document }) => {
                const captured = documents.get(document.path);
                return captured?.uri === document.uri && captured.version === document.version;
              })
            )
              return staleSemanticFailure(request.requestId);
            const apply = dependenciesRef.current.applySemanticWorkspaceEdit;
            if (apply) {
              if (!(await apply(response.result.documentEdits, documents)))
                return staleSemanticFailure(request.requestId);
              await synchronizeCommittedDrafts(
                request,
                response.result.documentEdits.map((entry) => entry.document.path),
              );
              return { ...response, result: { ...response.result, appliedToEditor: true } };
            }
            return response;
          }
        } catch {
          return unavailableSemanticFailure(request.requestId);
        } finally {
          if (activeWorkspaceEditsRef.current.get(request.cancellationId) === token)
            activeWorkspaceEditsRef.current.delete(request.cancellationId);
        }
      },
      cancel(cancellationId): void {
        const rename = activeWorkspaceEditsRef.current.get(cancellationId);
        if (rename) rename.cancelled = true;
        void dependenciesRef.current.javaIntelligence.cancel(cancellationId).catch(() => undefined);
      },
    };
  }, [
    capabilities.completion,
    capabilities.hover,
    capabilities.signature,
    capabilities.documentSymbols,
    capabilities.documentHighlights,
    capabilities.definition,
    capabilities.typeDefinition,
    capabilities.implementation,
    capabilities.callHierarchy,
    capabilities.semanticTokens,
    capabilities.inlayHints,
    capabilities.codeActions,
    capabilities.formatting,
    capabilities.rangeFormatting,
    capabilities.onTypeFormattingTriggers,
    capabilities.rename,
    currentDocumentMatches,
    dependencies.workspaceInfo?.id,
    hasJavaContext,
    hasSemanticCapability,
    prepareSemanticRequest,
    prepareSemanticWorkspaceRequest,
    semanticWorkspaceFrameMatches,
    synchronizeCommittedDrafts,
    activate,
    readyActiveDocument,
    semanticDocument,
    semanticDocument?.version,
    semanticDocument?.open,
    semanticDocument?.closing,
    semanticDocument?.text,
    semanticDocument?.syncEpoch,
    semanticSessionReady,
    status?.generation,
  ]);

  void diagnosticsRevision;
  const diagnostics = useMemo(() => {
    const currentGeneration = status?.generation;
    const events = [...diagnosticsRef.current.values()].filter(
      (event) =>
        event.workspaceId === dependencies.workspaceInfo?.id &&
        event.generation === currentGeneration,
    );
    const problemItems: ProblemItem[] = events.flatMap((event) =>
      event.diagnostics.map((diagnostic, index) => ({
        id: `${event.provider}-${event.document.path}-${event.document.version}-${index}`,
        provider: event.provider,
        filePath: event.document.path,
        severity: diagnostic.severity,
        range: diagnostic.range,
        message: diagnostic.message,
        code: diagnostic.code,
        source: diagnostic.source,
      })),
    );
    const activeEvents = readyActiveDocument
      ? events.filter((event) => event.document.path === readyActiveDocument.path)
      : [];
    return {
      activeDiagnostics: activeEvents.flatMap((event) => event.diagnostics),
      diagnosticUnavailableMessage: activeEvents.find((event) => event.unavailableReason)?.unavailableReason,
      activeDiagnosticDocument: activeEvents[0]?.document,
      activeDiagnosticOwner:
        activeEvents.length === 1 ? activeEvents[0].provider : "language-services",
      problemItems,
    };
  }, [
    dependencies.workspaceInfo?.id,
    diagnosticsRevision,
    readyActiveDocument?.path,
    status?.generation,
  ]);

  const refresh = useCallback(async () => {
    await load();
    const path = dependenciesRef.current.readyActiveDocument?.path;
    if (!path) return;
    const epoch = syncEpochRef.current;
    try {
      await flushCurrentDocument(path);
      const document = documentsRef.current.get(path);
      if (document?.open && document.generation === statusRef.current?.generation && document.workspaceId === workspaceIdRef.current)
        await dependenciesRef.current.documentSync.revalidate?.({ document: { workspaceId: document.workspaceId, path, uri: document.uri, version: document.sentVersion } });
    } catch {
      if (mountedRef.current && epoch === syncEpochRef.current)
        setError("Java diagnostics could not be refreshed. Check the language service and retry.");
    }
  }, [load, flushCurrentDocument]);
  const start = useCallback(() => runLifecycle("start"), [runLifecycle]);
  const stop = useCallback(() => runLifecycle("stop"), [runLifecycle]);
  const restart = useCallback(() => runLifecycle("restart"), [runLifecycle]);

  const previousSessionConfigurationRef = useRef({
    projectJdkHome: dependencies.projectJdkHome,
    serverJdkHome: dependencies.serverJdkHome,
    gradleImportEnabled: dependencies.gradleImportEnabled,
    gradleSignature: gradleSettingsSignature(dependencies.gradle),
    projectPath: dependencies.projectPath,
    mavenRepository: dependencies.mavenRepository,
    javaFormatterProfileSignature: formatterProfileSignature(dependencies.javaFormatterProfile),
    mavenProfileSignature: mavenProfileSignature(
      dependencies.activeMavenProfiles,
      dependencies.inactiveMavenProfiles,
    ),
  });
  useEffect(() => {
    const activeMavenProfiles = [...dependencies.activeMavenProfiles];
    const inactiveMavenProfiles = [...dependencies.inactiveMavenProfiles];
    const profileSignature = mavenProfileSignature(activeMavenProfiles, inactiveMavenProfiles);
    const gradleSignature = gradleSettingsSignature(dependencies.gradle);
    if (
      previousSessionConfigurationRef.current.projectJdkHome === dependencies.projectJdkHome &&
      previousSessionConfigurationRef.current.serverJdkHome === dependencies.serverJdkHome &&
      previousSessionConfigurationRef.current.gradleImportEnabled ===
        dependencies.gradleImportEnabled &&
      previousSessionConfigurationRef.current.gradleSignature === gradleSignature &&
      previousSessionConfigurationRef.current.projectPath === dependencies.projectPath &&
      previousSessionConfigurationRef.current.mavenRepository === dependencies.mavenRepository &&
      previousSessionConfigurationRef.current.javaFormatterProfileSignature ===
        formatterProfileSignature(dependencies.javaFormatterProfile) &&
      previousSessionConfigurationRef.current.mavenProfileSignature === profileSignature
    )
      return;
    previousSessionConfigurationRef.current = {
      projectJdkHome: dependencies.projectJdkHome,
      serverJdkHome: dependencies.serverJdkHome,
      gradleImportEnabled: dependencies.gradleImportEnabled,
      gradleSignature,
      projectPath: dependencies.projectPath,
      mavenRepository: dependencies.mavenRepository,
      javaFormatterProfileSignature: formatterProfileSignature(dependencies.javaFormatterProfile),
      mavenProfileSignature: profileSignature,
    };
    statusRequestRef.current += 1;
    const scheduledLifecycleRevision = ++lifecycleRequestRef.current;
    const paths = [...documentsRef.current.keys()];
    const workspaceId = workspaceIdRef.current;
    const workspaceGeneration = workspaceGenerationRef.current;
    const projectJdkHome = dependencies.projectJdkHome;
    const serverJdkHome = dependencies.serverJdkHome;
    const gradleImportEnabled = dependencies.gradleImportEnabled;
    const projectPath = dependencies.projectPath;
    const mavenRepository = dependencies.mavenRepository;
    const javaFormatterProfileSignature = formatterProfileSignature(
      dependencies.javaFormatterProfile,
    );
    const closed = closeAll();
    // Java Project fields are editable drafts. Retire old semantics immediately and allow
    // a short pause in typing before validating and applying the replacement JDK.
    const timer = setTimeout(() => {
      void (async () => {
        await closed;
        if (
          lifecycleRequestRef.current !== scheduledLifecycleRevision ||
          !workspaceId ||
          workspaceIdRef.current !== workspaceId ||
          workspaceGenerationRef.current !== workspaceGeneration ||
          dependenciesRef.current.projectJdkHome !== projectJdkHome ||
          dependenciesRef.current.serverJdkHome !== serverJdkHome ||
          dependenciesRef.current.gradleImportEnabled !== gradleImportEnabled ||
          gradleSettingsSignature(dependenciesRef.current.gradle) !== gradleSignature ||
          dependenciesRef.current.projectPath !== projectPath ||
          dependenciesRef.current.mavenRepository !== mavenRepository ||
          formatterProfileSignature(dependenciesRef.current.javaFormatterProfile) !==
            javaFormatterProfileSignature ||
          mavenProfileSignature(
            dependenciesRef.current.activeMavenProfiles,
            dependenciesRef.current.inactiveMavenProfiles,
          ) !== profileSignature
        )
          return;
        const current = statusRef.current;
        if (!current || current.state === "stopped" || current.state === "unavailable") return;
        await runLifecycle("start");
        if (
          dependenciesRef.current.projectJdkHome !== projectJdkHome ||
          dependenciesRef.current.serverJdkHome !== serverJdkHome ||
          dependenciesRef.current.gradleImportEnabled !== gradleImportEnabled ||
          gradleSettingsSignature(dependenciesRef.current.gradle) !== gradleSignature ||
          dependenciesRef.current.projectPath !== projectPath ||
          dependenciesRef.current.mavenRepository !== mavenRepository ||
          formatterProfileSignature(dependenciesRef.current.javaFormatterProfile) !==
            javaFormatterProfileSignature ||
          mavenProfileSignature(
            dependenciesRef.current.activeMavenProfiles,
            dependenciesRef.current.inactiveMavenProfiles,
          ) !== profileSignature ||
          workspaceIdRef.current !== workspaceId ||
          workspaceGenerationRef.current !== workspaceGeneration
        )
          return;
        const ready = dependenciesRef.current.readyActiveDocument;
        if (ready && !paths.includes(ready.path)) paths.push(ready.path);
        for (const path of paths) {
          const text = dependenciesRef.current.getEditorState().contents[path];
          if (text !== undefined) await activate(path, text);
        }
      })().catch((failure) => {
        if (
          mountedRef.current &&
          workspaceIdRef.current === workspaceId &&
          dependenciesRef.current.projectJdkHome === projectJdkHome &&
          dependenciesRef.current.serverJdkHome === serverJdkHome &&
          dependenciesRef.current.gradleImportEnabled === gradleImportEnabled &&
          gradleSettingsSignature(dependenciesRef.current.gradle) === gradleSignature &&
          dependenciesRef.current.projectPath === projectPath &&
          dependenciesRef.current.mavenRepository === mavenRepository &&
          formatterProfileSignature(dependenciesRef.current.javaFormatterProfile) ===
            javaFormatterProfileSignature &&
          mavenProfileSignature(
            dependenciesRef.current.activeMavenProfiles,
            dependenciesRef.current.inactiveMavenProfiles,
          ) === profileSignature
        )
          setError(errorMessage(failure));
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [
    activate,
    closeAll,
    dependencies.gradle,
    dependencies.gradleImportEnabled,
    dependencies.projectJdkHome,
    dependencies.serverJdkHome,
    dependencies.projectPath,
    dependencies.mavenRepository,
    dependencies.javaFormatterProfile,
    dependencies.activeMavenProfiles,
    dependencies.inactiveMavenProfiles,
    runLifecycle,
  ]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      statusRequestRef.current += 1;
      lifecycleRequestRef.current += 1;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      void closeAll();
    };
  }, [closeAll]);

  return useMemo(
    () => ({
      status,
      error,
      refreshing,
      refresh,
      start,
      stop,
      restart,
      runLifecycle,
      attach,
      detach,
      load,
      closeAll,
      activate,
      queueChange,
      flush,
      synchronizeEditorDocument,
      notifySaved,
      closeDocument,
      searchWorkspaceSymbols,
      cancelWorkspaceSymbolSearch,
      activeDiagnostics: diagnostics.activeDiagnostics,
      diagnosticUnavailableMessage: diagnostics.diagnosticUnavailableMessage,
      activeDiagnosticDocument: diagnostics.activeDiagnosticDocument,
      activeDiagnosticOwner: diagnostics.activeDiagnosticOwner,
      problemItems: diagnostics.problemItems,
      javaSemantics,
      hasJavaContext,
      capabilities,
    }),
    [
      activate,
      attach,
      capabilities,
      closeAll,
      closeDocument,
      searchWorkspaceSymbols,
      cancelWorkspaceSymbolSearch,
      detach,
      diagnostics,
      error,
      flush,
      hasJavaContext,
      javaSemantics,
      load,
      notifySaved,
      queueChange,
      refresh,
      refreshing,
      restart,
      runLifecycle,
      start,
      status,
      stop,
      synchronizeEditorDocument,
    ],
  );
}
