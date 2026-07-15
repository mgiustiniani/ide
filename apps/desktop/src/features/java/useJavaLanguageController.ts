import type {
  JavaCompletionRequest,
  JavaCompletionResponse,
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
  codeActions: false,
  formatting: false,
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
  workspaceInfo: WorkspaceInfo | null;
  workspaceGeneration: number;
  getEditorState: () => JavaLanguageEditorState;
  /** Only a document accepted as ready by the editor-open controller may receive semantics. */
  readyActiveDocument: ReadyJavaEditorDocument | null;
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
  notifySaved(path: string): Promise<void>;
  closeDocument(path: string): Promise<void>;
  activeDiagnostics: readonly LanguageDiagnostic[];
  activeDiagnosticDocument: LanguageServiceDiagnosticsEvent["document"] | undefined;
  activeDiagnosticOwner: string;
  problemItems: readonly ProblemItem[];
  javaSemantics: JavaEditorSemantics | undefined;
  hasJavaContext: boolean;
  capabilities: LanguageServiceCapabilities;
}

function isJavaPath(path: string | null | undefined): path is string {
  return Boolean(path && path.toLowerCase().endsWith(".java"));
}

function createWorkspaceFileUri(rootPath: string, relativePath: string): string {
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
    capabilities: EMPTY_CAPABILITIES,
    lastError: message,
    checkedAt: new Date().toISOString(),
  };
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
  const diagnosticsRef = useRef<Map<string, LanguageServiceDiagnosticsEvent>>(new Map());
  const documentsRef = useRef<Map<string, SynchronizedJavaDocument>>(new Map());
  const startupsRef = useRef<Map<string, JavaDocumentStartup>>(new Map());
  const syncEpochRef = useRef(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);

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
    for (const document of documentsRef.current.values()) {
      if (document.changeTimer) clearTimeout(document.changeTimer);
      document.open = false;
    }
    syncEpochRef.current += 1;
    documentsRef.current.clear();
    startupsRef.current.clear();
    publishSemanticRevision();
    clearDiagnostics();
  }, [clearDiagnostics, publishSemanticRevision]);

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
    // Invalidate unresolved status/start/didOpen work before taking the cleanup snapshot. A stale
    // didOpen completion performs its own best-effort close and cannot repopulate this map.
    syncEpochRef.current += 1;
    startupsRef.current.clear();
    publishSemanticRevision();
    const paths = [...documentsRef.current.keys()];
    await Promise.all(paths.map(closeCurrentDocument));
    clearDiagnostics();
  }, [clearDiagnostics, closeCurrentDocument, publishSemanticRevision]);

  const applyStatus = useCallback(
    (next: LanguageServiceStatus, workspaceId: string, workspaceGeneration: number): boolean => {
      if (
        workspaceIdRef.current !== workspaceId ||
        workspaceGenerationRef.current !== workspaceGeneration ||
        next.workspaceId !== workspaceId
      ) {
        return false;
      }

      const current = statusRef.current;
      if (current?.workspaceId === workspaceId && next.generation < current.generation)
        return false;
      if (
        current?.workspaceId === workspaceId &&
        (next.generation !== current.generation ||
          next.state === "stopped" ||
          next.state === "unavailable")
      ) {
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
            event.document.uri !== document.uri
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
        return;
      }
      const startupKey = JSON.stringify([workspace.id, initialSessionGeneration, path, syncEpoch]);
      const pending = startupsRef.current.get(startupKey);
      if (pending) return pending.promise;

      let sessionGeneration = initialSessionGeneration;
      const tokenIsCurrent = (): boolean =>
        workspaceGenerationRef.current === workspaceGeneration &&
        workspaceIdRef.current === workspace.id &&
        syncEpochRef.current === syncEpoch &&
        (sessionGeneration === 0 || statusRef.current?.generation === sessionGeneration);

      const startupPromise = (async () => {
        let nextStatus = await dependenciesRef.current.languageSession.getStatus({
          workspaceId: workspace.id,
        });
        if (!tokenIsCurrent()) return;
        if (!applyStatus(nextStatus, workspace.id, workspaceGeneration)) return;
        sessionGeneration = nextStatus.generation;
        syncEpoch = syncEpochRef.current;
        if (!tokenIsCurrent()) return;
        if (nextStatus.state === "stopped") {
          const requestId = ++lifecycleRequestRef.current;
          nextStatus = await dependenciesRef.current.languageSession.start({
            workspaceId: workspace.id,
            requestId: `desktop-java-activation-${requestId}`,
          });
          if (!tokenIsCurrent()) return;
          if (!applyStatus(nextStatus, workspace.id, workspaceGeneration)) return;
          sessionGeneration = nextStatus.generation;
          syncEpoch = syncEpochRef.current;
          if (!tokenIsCurrent()) return;
        }
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

        const document: SynchronizedJavaDocument = {
          workspaceId: workspace.id,
          generation: nextStatus.generation,
          syncEpoch: documentEpoch,
          path,
          uri: createWorkspaceFileUri(workspace.rootPath, path),
          version: INITIAL_DOCUMENT_VERSION,
          text,
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
              text,
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
      })();

      const startup: JavaDocumentStartup = {
        workspaceId: workspace.id,
        path,
        syncEpoch,
        promise: startupPromise,
      };
      startupsRef.current.set(startupKey, startup);
      try {
        await startupPromise;
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
    [flushCurrentDocument, publishSemanticRevision],
  );

  const notifySaved = useCallback(
    async (path: string): Promise<void> => {
      if (!isJavaPath(path)) return;
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
        const next =
          action === "start"
            ? await dependenciesRef.current.languageSession.start({
                workspaceId,
                requestId: `desktop-${requestId}`,
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
                });
        if (lifecycleRequestRef.current !== requestId) return;
        if (!applyStatus(next, workspaceId, workspaceGeneration)) return;
        await load(workspaceId, workspaceGeneration);
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
    [applyStatus, closeAll, load],
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
    (request: JavaCompletionRequest | JavaHoverRequest | JavaSignatureHelpRequest): boolean => {
      const current = documentsRef.current.get(request.document.path);
      const editor = dependenciesRef.current.getEditorState();
      const ready = dependenciesRef.current.readyActiveDocument;
      return Boolean(
        current &&
        current.open &&
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
      request: JavaCompletionRequest | JavaHoverRequest | JavaSignatureHelpRequest,
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

  const readyActiveDocument = dependencies.readyActiveDocument;
  const hasJavaContext = isJavaPath(readyActiveDocument?.path);
  const capabilities = status?.capabilities ?? EMPTY_CAPABILITIES;
  const semanticDocument = readyActiveDocument
    ? documentsRef.current.get(readyActiveDocument.path)
    : undefined;
  const semanticSessionReady = Boolean(
    status &&
    READY_SESSION_STATES.has(status.state) &&
    status.workspaceId === dependencies.workspaceInfo?.id,
  );
  const hasSemanticCapability =
    capabilities.completion || capabilities.hover || capabilities.signature;

  // The revision makes ref-only version/open/close transitions observable without exposing refs.
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
    return {
      context,
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
      cancel(cancellationId): void {
        void dependenciesRef.current.javaIntelligence.cancel(cancellationId).catch(() => undefined);
      },
    };
  }, [
    capabilities.completion,
    capabilities.hover,
    capabilities.signature,
    currentDocumentMatches,
    dependencies.workspaceInfo?.id,
    hasJavaContext,
    hasSemanticCapability,
    prepareSemanticRequest,
    readyActiveDocument,
    semanticDocument,
    semanticRevision,
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

  const refresh = useCallback(() => load(), [load]);
  const start = useCallback(() => runLifecycle("start"), [runLifecycle]);
  const stop = useCallback(() => runLifecycle("stop"), [runLifecycle]);
  const restart = useCallback(() => runLifecycle("restart"), [runLifecycle]);

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
      notifySaved,
      closeDocument,
      activeDiagnostics: diagnostics.activeDiagnostics,
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
    ],
  );
}
