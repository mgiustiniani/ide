import {
  decideSavedSnapshotDefinitionRequest,
  decideSavedSnapshotSemanticSessionStartRequest,
  decideSavedSnapshotSemanticSessionStopRequest,
  decideSavedSnapshotSymbolSearchRequest,
  normalizeProviderPoint,
  normalizeSavedSnapshotDefinitionResult,
  normalizeSavedSnapshotSemanticSessionStartResult,
  normalizeSavedSnapshotSemanticSessionStopResult,
  normalizeSavedSnapshotSymbolSearchResult,
  type EditorPoint,
  type RefactorKitCapabilities,
  type RefactorKitCommandResult,
  type RefactorKitLocation,
  type RefactorKitStatus,
  type RelevantTypeScriptJavaScriptBuffer,
  type SavedSnapshotDefinitionResult,
  type SavedSnapshotExternalToolchainApproval,
  type SavedSnapshotSemanticSessionStartResult,
  type SavedSnapshotSymbolSearchPolicyInput,
  type SavedSnapshotSymbolSearchResult,
  type TypeScriptJavaScriptLanguageId,
  type TypeScriptJavaScriptSemanticSession,
  type WorkspaceInfo,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import type {
  SemanticSearchAvailability,
  SemanticSearchEvidenceState,
  SemanticSearchSnapshotState,
  SemanticSearchToolchainPathField,
  SemanticSearchToolchainPaths,
  SemanticSymbolSearchResult,
} from "@ide/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_VISIBLE_RESULTS = 100;
const MAX_SAFE_MESSAGE_LENGTH = 180;
const SEARCH_ERROR = "Semantic symbol search could not be completed.";
const DEFINITION_ERROR = "The semantic definition could not be opened.";
const UNAUTHORIZED_REASON = "Authorize a desktop workspace before using semantic search.";
const CAPABILITY_REASON = "Accepted experimental language-server evidence is unavailable.";
const JAVA_DEFINITION_ERROR = "The Java definition could not be resolved.";
const JAVA_REFERENCES_ERROR = "The Java references could not be resolved.";
const JAVA_DEFINITION_OPEN_ERROR =
  "The resolved Java definition could not be opened in the editor.";
const JAVA_REFERENCE_OPEN_ERROR = "The selected Java reference could not be opened in the editor.";
const JAVA_UNAVAILABLE_REASON =
  "Java symbol navigation is unavailable: the provider does not advertise the Java definition/references capability.";
const JAVA_SOURCE_ANALYSIS_UNAVAILABLE_REASON =
  "Java symbol navigation is unavailable because source analysis is not qualified for this project context.";

export interface SemanticNavigationWorkspaceContext {
  generation: number;
  workspaceId: string | null;
  isSwitching: boolean;
  isMetadataLoading: boolean;
}

export interface SemanticNavigationEditorBuffer extends RelevantTypeScriptJavaScriptBuffer {
  languageId?: TypeScriptJavaScriptLanguageId;
}

export type JavaNavigationAvailability = "available" | "unavailable" | "error";
export type JavaNavigationOperation = "definition" | "references";

/** A resolved Java location presented for navigation. */
export interface JavaSymbolLocation {
  readonly filePath: string;
  readonly point: Readonly<EditorPoint>;
}

export interface RefactorKitSymbolNavigationWorkspaceCollaborator {
  /** Invalidates work immediately and waits for any authorized session to stop. */
  resetWorkspace(nextWorkspaceGeneration: number): Promise<void>;
}

export interface UseRefactorKitSymbolNavigationControllerDependencies {
  refactorKit: RefactorKitPort;
  status: RefactorKitStatus | null;
  capabilities: RefactorKitCapabilities | null;
  javaSourceAnalysisAvailable?: boolean;
  isCheckingCapabilities: boolean;
  workspaceInfo: WorkspaceInfo | null;
  workspaceGeneration: number;
  getWorkspaceContext(): SemanticNavigationWorkspaceContext;
  getRelevantBuffers(): readonly SemanticNavigationEditorBuffer[];
  navigateToPoint(filePath: string, point: EditorPoint): Promise<boolean>;
}

export interface RefactorKitSymbolNavigationController {
  language: TypeScriptJavaScriptLanguageId;
  query: string;
  toolchainPaths: SemanticSearchToolchainPaths;
  approvedForSession: boolean;
  snapshotState: SemanticSearchSnapshotState;
  evidenceState: SemanticSearchEvidenceState;
  availability: SemanticSearchAvailability;
  availabilityReason: string | null;
  results: readonly SemanticSymbolSearchResult[];
  resultLimit: number;
  isBusy: boolean;
  canSubmit: boolean;
  error: string | null;
  refusal: string | null;
  hasActiveSession: boolean;
  /** Current normalized session authority; consumed only by desktop diagnostics orchestration. */
  acceptedSession: Readonly<SavedSnapshotSemanticSessionStartResult> | null;
  setLanguage(language: TypeScriptJavaScriptLanguageId): void;
  setQuery(query: string): void;
  setToolchainPath(field: SemanticSearchToolchainPathField, value: string): void;
  setApprovedForSession(approved: boolean): void;
  submit(): Promise<void>;
  selectResult(result: SemanticSymbolSearchResult): Promise<void>;
  cancel(): void;
  stop(): Promise<void>;
  /** Java symbol navigation surface (desktop composition). */
  javaSymbol: string;
  javaAvailability: JavaNavigationAvailability;
  javaAvailabilityReason: string | null;
  javaError: string | null;
  javaResult: RefactorKitCommandResult | null;
  javaLatestOperation: JavaNavigationOperation | null;
  isJavaBusy: boolean;
  setJavaSymbol(symbol: string): void;
  resolveJavaDefinition(symbol: string): Promise<void>;
  resolveJavaReferences(symbol: string): Promise<void>;
  selectJavaReference(location: JavaSymbolLocation): Promise<boolean>;
  workspaceCollaborator: RefactorKitSymbolNavigationWorkspaceCollaborator;
}

type SessionOperation = () => Promise<void>;

function boundedMessage(message: string): string {
  return message.slice(0, MAX_SAFE_MESSAGE_LENGTH);
}

function refusalMessage(reason: string): string {
  switch (reason) {
    case "query-empty":
      return "Enter a symbol query.";
    case "query-too-long":
    case "query-invalid":
      return "The symbol query is not valid.";
    case "toolchain-unapproved":
      return "Explicitly approve the external toolchain paths for this session.";
    case "toolchain-path-invalid":
    case "toolchain-not-external":
    case "toolchain-discovery-enabled":
      return "Use valid external toolchain paths; PATH and workspace-local discovery stay disabled.";
    case "relevant-buffer-unsaved":
      return "Semantic search is refused while a participating buffer has never been saved.";
    case "relevant-buffer-dirty":
      return "Semantic search is refused while a participating buffer is dirty.";
    case "javascript-incompleteness-disclosure-required":
      return "Acknowledge that dynamic or mixed JavaScript results may be incomplete.";
    case "workspace-unauthorized":
    case "workspace-generation-stale":
    case "semantic-session-authority-mismatch":
    case "semantic-session-stop-authority-mismatch":
      return UNAUTHORIZED_REASON;
    case "symbol-not-in-current-result":
    case "stale-search-selection":
    case "search-result-authority-mismatch":
    case "search-result-session-mismatch":
    case "search-result-snapshot-mismatch":
      return "The selected result is stale. Run the search again.";
    default:
      return CAPABILITY_REASON;
  }
}

function javaNavigationAdvertised(
  capabilities: RefactorKitCapabilities | null,
  operation: JavaNavigationOperation,
): boolean {
  if (!capabilities) return false;
  const engine = capabilities as RefactorKitCapabilities & {
    operationalSurface?: readonly string[];
    javaNavigation?: { readonly supported: boolean; readonly operations: readonly string[] };
  };
  const navigation = engine.javaNavigation;
  if (navigation) {
    return navigation.supported && navigation.operations.includes(operation);
  }
  return (engine.operationalSurface ?? []).includes(operation);
}

function javaLocationFrom(location: RefactorKitLocation): JavaSymbolLocation {
  return {
    filePath: location.path,
    point: { lineNumber: location.line, column: location.column ?? 1 },
  };
}

function extensionOf(path: string): string | null {
  const leaf = path.replaceAll("\\", "/").split("/").pop() ?? "";
  const separator = leaf.lastIndexOf(".");
  if (separator <= 0 || separator === leaf.length - 1) return null;
  return leaf.slice(separator + 1).toLowerCase();
}

function languageForExtension(extension: string | null): TypeScriptJavaScriptLanguageId | null {
  if (extension === "ts" || extension === "tsx" || extension === "mts" || extension === "cts") {
    return "typescript";
  }
  if (extension === "js" || extension === "jsx" || extension === "mjs" || extension === "cjs") {
    return "javascript";
  }
  return null;
}

function isAbsolutePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    /^\/\/[^/]+\/[^/]+/u.test(normalized)
  );
}

function absoluteBufferPath(workspaceRoot: string, path: string): string {
  if (isAbsolutePath(path)) return path;
  return `${workspaceRoot.replace(/[\\/]+$/u, "")}/${path}`;
}

function safeBuffers(
  getRelevantBuffers: () => readonly SemanticNavigationEditorBuffer[],
): readonly SemanticNavigationEditorBuffer[] {
  try {
    return getRelevantBuffers().map((buffer) => ({ ...buffer }));
  } catch {
    return [{ path: "", savedState: "never-saved", dirty: false }];
  }
}

function snapshotStateOf(
  buffers: readonly SemanticNavigationEditorBuffer[],
): SemanticSearchSnapshotState {
  if (buffers.some(({ savedState }) => savedState !== "saved")) return "never-saved";
  if (buffers.some(({ dirty }) => dirty)) return "dirty";
  return "saved";
}

function sourceExtension(
  language: TypeScriptJavaScriptLanguageId,
  buffers: readonly SemanticNavigationEditorBuffer[],
): string {
  const matching = buffers.find((buffer) => {
    const extension = extensionOf(buffer.path);
    return buffer.languageId === language || languageForExtension(extension) === language;
  });
  return extensionOf(matching?.path ?? "") ?? (language === "typescript" ? "ts" : "js");
}

function operationBackend(
  capabilities: RefactorKitCapabilities,
  language: TypeScriptJavaScriptLanguageId,
): string {
  const kernel = capabilities.languageKernel;
  if (!kernel?.available) return "";
  const operations = kernel.schema.adapters
    .filter(({ languageId }) => languageId === language)
    .flatMap(({ capabilities: adapterCapabilities }) => adapterCapabilities);
  return operations.find(({ operation }) => operation === "workspaceSymbols")?.backend ?? "";
}

function hasAcceptedEvidence(
  capabilities: RefactorKitCapabilities | null,
  language: TypeScriptJavaScriptLanguageId,
): boolean {
  const kernel = capabilities?.languageKernel;
  if (!kernel?.available || !capabilities?.providerVersion) return false;
  const adapters = kernel.schema.adapters.filter(({ languageId }) => languageId === language);
  const symbols = adapters.flatMap((adapter) =>
    adapter.capabilities
      .filter(({ operation }) => operation === "workspaceSymbols")
      .map((operation) => ({ adapter, operation })),
  );
  const definitions = adapters.flatMap((adapter) =>
    adapter.capabilities
      .filter(({ operation }) => operation === "definition")
      .map((operation) => ({ adapter, operation })),
  );
  if (
    symbols.length !== 1 ||
    definitions.length !== 1 ||
    symbols[0]!.adapter !== definitions[0]!.adapter
  ) {
    return false;
  }
  const operations = [symbols[0]!.operation, definitions[0]!.operation];
  const [symbolOperation, definitionOperation] = operations;
  return (
    operations.every(
      (operation) =>
        operation.stability === "experimental" &&
        operation.evidence === "language-server" &&
        operation.mutationAuthority === "none" &&
        operation.runtime.executionMode === "external-process" &&
        operation.runtime.supportsTimeout &&
        operation.runtime.supportsCancellation &&
        operation.runtime.usesWorkspaceOverlay &&
        operation.runtime.recordsProcessProvenance,
    ) &&
    symbolOperation!.backend === definitionOperation!.backend &&
    JSON.stringify(symbolOperation!.runtime) === JSON.stringify(definitionOperation!.runtime) &&
    [...symbolOperation!.extensions].sort().join("\u0000") ===
      [...definitionOperation!.extensions].sort().join("\u0000")
  );
}

function toolchainApproval(
  paths: SemanticSearchToolchainPaths,
  approvedForSession: boolean,
): SavedSnapshotExternalToolchainApproval {
  return {
    ...paths,
    userApproved: approvedForSession,
    allowPathNodeDiscovery: false,
    allowWorkspaceLocalToolchain: false,
  };
}

function sessionFromStart(
  result: Readonly<SavedSnapshotSemanticSessionStartResult>,
): Extract<TypeScriptJavaScriptSemanticSession, { state: "active" }> {
  return {
    state: "active",
    languageId: result.languageId,
    workspaceId: result.workspaceId,
    workspaceGeneration: result.workspaceGeneration,
    sessionId: result.sessionId,
    semanticLease: result.semanticLease,
    startSnapshotHash: result.startSnapshotHash,
    snapshot: { state: "saved", identity: result.providerProjectSnapshotIdentity },
    providerVersion: result.providerVersion,
    toolchain: {
      backend: result.toolchain.backend,
      runtime: {
        ...result.toolchain.runtime,
        limits: { ...result.toolchain.runtime.limits },
      },
      extensions: [...result.toolchain.extensions],
      nodeExecutable: result.toolchain.nodeExecutable,
      languageServerPackageRoot: result.toolchain.languageServerPackageRoot,
      typeScriptPackageRoot: result.toolchain.typeScriptPackageRoot,
    },
  };
}

function cloneStartCandidate(result: Readonly<SavedSnapshotSemanticSessionStartResult>) {
  return {
    ...result,
    toolchain: {
      ...result.toolchain,
      runtime: { ...result.toolchain.runtime, limits: { ...result.toolchain.runtime.limits } },
      extensions: [...result.toolchain.extensions],
    },
    processProvenance: { ...result.processProvenance },
  };
}

function cloneSearchCandidate(result: Readonly<SavedSnapshotSymbolSearchResult>) {
  return {
    ...result,
    completeness: { ...result.completeness },
    symbols: result.symbols.map((symbol) => ({ ...symbol })),
  };
}

function cloneDefinitionCandidate(result: Readonly<SavedSnapshotDefinitionResult>) {
  return {
    ...result,
    selectedSymbol: { ...result.selectedSymbol },
    point: { ...result.point },
  };
}

/**
 * Desktop-only composition for one transient saved-snapshot semantic session.
 * It stores no path or opaque identity outside this mounted controller and emits no logs.
 */
export function useRefactorKitSymbolNavigationController(
  dependencies: UseRefactorKitSymbolNavigationControllerDependencies,
): RefactorKitSymbolNavigationController {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeSessionRef = useRef<Readonly<SavedSnapshotSemanticSessionStartResult> | null>(null);
  const currentSearchRef = useRef<Readonly<SavedSnapshotSymbolSearchResult> | null>(null);

  const [language, setLanguageState] = useState<TypeScriptJavaScriptLanguageId>("typescript");
  const [query, setQueryState] = useState("");
  const [toolchainPaths, setToolchainPaths] = useState<SemanticSearchToolchainPaths>({
    nodeExecutable: "",
    languageServerPackageRoot: "",
    typeScriptPackageRoot: "",
  });
  const [approvedForSession, setApprovedForSessionState] = useState(false);
  const [results, setResults] = useState<readonly SemanticSymbolSearchResult[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [acceptedSession, setAcceptedSession] =
    useState<Readonly<SavedSnapshotSemanticSessionStartResult> | null>(null);
  const [javaSymbol, setJavaSymbolState] = useState("");
  const [javaError, setJavaError] = useState<string | null>(null);
  const [javaResult, setJavaResult] = useState<RefactorKitCommandResult | null>(null);
  const [javaLatestOperation, setJavaLatestOperation] = useState<JavaNavigationOperation | null>(
    null,
  );
  const [isJavaBusy, setIsJavaBusy] = useState(false);

  const enqueue = useCallback((operation: SessionOperation): Promise<void> => {
    const queued = operationQueueRef.current.then(operation, operation);
    operationQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, []);

  const clearSearch = useCallback((): void => {
    currentSearchRef.current = null;
    setResults([]);
  }, []);

  const stopExactSession = useCallback(
    async (session: Readonly<SavedSnapshotSemanticSessionStartResult>): Promise<void> => {
      const decision = decideSavedSnapshotSemanticSessionStopRequest({
        session,
        currentWorkspaceId: session.workspaceId,
        currentWorkspaceGeneration: session.workspaceGeneration,
      });
      if (decision.kind !== "ready") return;
      try {
        const candidate =
          await dependenciesRef.current.refactorKit.stopSavedSnapshotSemanticSession(
            decision.request,
          );
        normalizeSavedSnapshotSemanticSessionStopResult({
          request: decision.request,
          candidate: { ...candidate },
        });
      } catch {
        // Cleanup is best-effort and intentionally emits neither provider details nor logs.
      }
    },
    [],
  );

  const detachActiveSession = useCallback(async (): Promise<void> => {
    const session = activeSessionRef.current;
    activeSessionRef.current = null;
    currentSearchRef.current = null;
    if (mountedRef.current) {
      setHasActiveSession(false);
      setAcceptedSession(null);
      setResults([]);
    }
    if (session) await stopExactSession(session);
  }, [stopExactSession]);

  const invalidate = useCallback((): number => {
    requestRef.current += 1;
    setIsBusy(false);
    setError(null);
    setRefusal(null);
    clearSearch();
    return requestRef.current;
  }, [clearSearch]);

  const replaceConfiguration = useCallback((): void => {
    invalidate();
    void enqueue(detachActiveSession);
  }, [detachActiveSession, enqueue, invalidate]);

  const setLanguage = useCallback(
    (nextLanguage: TypeScriptJavaScriptLanguageId): void => {
      if (
        (nextLanguage !== "typescript" && nextLanguage !== "javascript") ||
        nextLanguage === language
      ) {
        return;
      }
      replaceConfiguration();
      setApprovedForSessionState(false);
      setLanguageState(nextLanguage);
    },
    [language, replaceConfiguration],
  );

  const setQuery = useCallback(
    (nextQuery: string): void => {
      requestRef.current += 1;
      setQueryState(nextQuery);
      setIsBusy(false);
      setError(null);
      setRefusal(null);
      clearSearch();
      void enqueue(detachActiveSession);
    },
    [clearSearch, detachActiveSession, enqueue],
  );

  const setToolchainPath = useCallback(
    (field: SemanticSearchToolchainPathField, value: string): void => {
      replaceConfiguration();
      setApprovedForSessionState(false);
      setToolchainPaths((current) => ({ ...current, [field]: value }));
    },
    [replaceConfiguration],
  );

  const setApprovedForSession = useCallback(
    (approved: boolean): void => {
      if (!approved) replaceConfiguration();
      setApprovedForSessionState(approved);
      setError(null);
      setRefusal(null);
    },
    [replaceConfiguration],
  );

  const setJavaSymbol = useCallback((nextSymbol: string): void => {
    requestRef.current += 1;
    setJavaSymbolState(nextSymbol);
    setJavaError(null);
    setJavaResult(null);
    setIsJavaBusy(false);
  }, []);

  const isRequestCurrent = useCallback(
    (
      requestId: number,
      workspaceId: string,
      workspaceGeneration: number,
      session?: Readonly<SavedSnapshotSemanticSessionStartResult>,
      snapshotIdentity?: string,
    ): boolean => {
      const current = dependenciesRef.current.getWorkspaceContext();
      return (
        mountedRef.current &&
        requestRef.current === requestId &&
        !current.isSwitching &&
        !current.isMetadataLoading &&
        current.workspaceId === workspaceId &&
        current.generation === workspaceGeneration &&
        (!session || activeSessionRef.current?.sessionId === session.sessionId) &&
        (!snapshotIdentity ||
          activeSessionRef.current?.providerProjectSnapshotIdentity === snapshotIdentity)
      );
    },
    [],
  );

  const isCleanRequestCurrent = useCallback(
    (
      requestId: number,
      workspaceId: string,
      workspaceGeneration: number,
      session?: Readonly<SavedSnapshotSemanticSessionStartResult>,
      snapshotIdentity?: string,
    ): boolean =>
      isRequestCurrent(requestId, workspaceId, workspaceGeneration, session, snapshotIdentity) &&
      snapshotStateOf(safeBuffers(dependenciesRef.current.getRelevantBuffers)) === "saved",
    [isRequestCurrent],
  );

  const buildSearchAuthorization = useCallback(
    (
      selectedLanguage: TypeScriptJavaScriptLanguageId,
      selectedQuery: string,
      paths: SemanticSearchToolchainPaths,
      approved: boolean,
      workspace: WorkspaceInfo,
      generation: number,
      capabilities: RefactorKitCapabilities,
      session: Readonly<SavedSnapshotSemanticSessionStartResult>,
      buffers: readonly SemanticNavigationEditorBuffer[],
    ): SavedSnapshotSymbolSearchPolicyInput => ({
      languageId: selectedLanguage,
      sourceExtension: sourceExtension(selectedLanguage, buffers),
      workspaceRoot: workspace.rootPath,
      workspaceId: workspace.id,
      workspaceGeneration: generation,
      authorizedWorkspaceId: workspace.id,
      authorizedWorkspaceGeneration: generation,
      currentSavedSnapshotIdentity: session.providerProjectSnapshotIdentity,
      query: selectedQuery,
      capabilities,
      semanticSession: sessionFromStart(session),
      approvedToolchain: toolchainApproval(paths, approved),
      relevantBuffers: buffers.map((buffer) => ({
        path: absoluteBufferPath(workspace.rootPath, buffer.path),
        savedState: buffer.savedState,
        dirty: buffer.dirty,
      })),
      javascriptCompatibility: {
        semantics: selectedLanguage === "javascript" ? "dynamic-or-mixed" : "not-dynamic-or-mixed",
        incompletenessDisclosure: selectedLanguage === "javascript" ? "shown" : "not-shown",
      },
      fallback: "none",
    }),
    [],
  );

  const submit = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const selectedLanguage = language;
    const selectedQuery = query;
    const selectedPaths = { ...toolchainPaths };
    const selectedApproval = approvedForSession;
    setIsBusy(true);
    setError(null);
    setRefusal(null);
    clearSearch();

    await enqueue(async () => {
      await detachActiveSession();
      if (!mountedRef.current || requestRef.current !== requestId) return;

      const currentDependencies = dependenciesRef.current;
      const workspace = currentDependencies.workspaceInfo;
      const context = currentDependencies.getWorkspaceContext();
      const capabilities = currentDependencies.capabilities;
      if (
        !workspace ||
        !capabilities ||
        context.isSwitching ||
        context.isMetadataLoading ||
        context.workspaceId !== workspace.id ||
        context.generation !== currentDependencies.workspaceGeneration
      ) {
        if (mountedRef.current && requestRef.current === requestId) {
          setRefusal(boundedMessage(!workspace ? UNAUTHORIZED_REASON : CAPABILITY_REASON));
          setIsBusy(false);
        }
        return;
      }

      const buffers = safeBuffers(currentDependencies.getRelevantBuffers);
      const startDecision = decideSavedSnapshotSemanticSessionStartRequest({
        languageId: selectedLanguage,
        sourceExtension: sourceExtension(selectedLanguage, buffers),
        workspaceRoot: workspace.rootPath,
        workspaceId: workspace.id,
        workspaceGeneration: context.generation,
        authorizedWorkspaceRoot: workspace.rootPath,
        authorizedWorkspaceId: workspace.id,
        currentWorkspaceGeneration: context.generation,
        providerVersion: capabilities.providerVersion ?? "",
        backend: operationBackend(capabilities, selectedLanguage),
        capabilities,
        approvedToolchain: toolchainApproval(selectedPaths, selectedApproval),
        relevantBuffers: buffers.map((buffer) => ({
          path: absoluteBufferPath(workspace.rootPath, buffer.path),
          savedState: buffer.savedState,
          dirty: buffer.dirty,
        })),
        javascriptCompatibility: {
          semantics:
            selectedLanguage === "javascript" ? "dynamic-or-mixed" : "not-dynamic-or-mixed",
          incompletenessDisclosure: selectedLanguage === "javascript" ? "shown" : "not-shown",
        },
      });
      if (startDecision.kind !== "ready") {
        if (isRequestCurrent(requestId, workspace.id, context.generation)) {
          setRefusal(boundedMessage(refusalMessage(startDecision.reason)));
          setIsBusy(false);
        }
        return;
      }

      let started: Readonly<SavedSnapshotSemanticSessionStartResult>;
      try {
        const candidate = await currentDependencies.refactorKit.startSavedSnapshotSemanticSession(
          startDecision.request,
        );
        const normalized = normalizeSavedSnapshotSemanticSessionStartResult({
          request: startDecision.request,
          candidate: cloneStartCandidate(candidate),
        });
        if (normalized.kind !== "ready") {
          if (isCleanRequestCurrent(requestId, workspace.id, context.generation)) {
            setRefusal(boundedMessage(refusalMessage(normalized.reason)));
            setIsBusy(false);
          }
          return;
        }
        started = normalized.result;
      } catch {
        if (isCleanRequestCurrent(requestId, workspace.id, context.generation)) {
          setError(SEARCH_ERROR);
          setIsBusy(false);
        }
        return;
      }

      if (!isCleanRequestCurrent(requestId, workspace.id, context.generation)) {
        await stopExactSession(started);
        return;
      }
      activeSessionRef.current = started;
      setAcceptedSession(started);
      setHasActiveSession(true);

      const authorization = buildSearchAuthorization(
        selectedLanguage,
        selectedQuery,
        selectedPaths,
        selectedApproval,
        workspace,
        context.generation,
        capabilities,
        started,
        buffers,
      );
      const searchDecision = decideSavedSnapshotSymbolSearchRequest(authorization);
      if (searchDecision.kind !== "ready") {
        setRefusal(boundedMessage(refusalMessage(searchDecision.reason)));
        setIsBusy(false);
        return;
      }

      try {
        const candidate = await currentDependencies.refactorKit.searchSavedSnapshotSymbols(
          searchDecision.request,
        );
        const normalized = normalizeSavedSnapshotSymbolSearchResult({
          request: searchDecision.request,
          candidate: cloneSearchCandidate(candidate),
        });
        if (normalized.kind !== "ready") {
          if (
            isCleanRequestCurrent(
              requestId,
              workspace.id,
              context.generation,
              started,
              started.providerProjectSnapshotIdentity,
            )
          ) {
            setRefusal(boundedMessage(refusalMessage(normalized.reason)));
            setIsBusy(false);
          }
          return;
        }
        if (
          !isCleanRequestCurrent(
            requestId,
            workspace.id,
            context.generation,
            started,
            started.providerProjectSnapshotIdentity,
          )
        ) {
          return;
        }
        currentSearchRef.current = normalized.result;
        setResults(
          normalized.result.symbols.slice(0, MAX_VISIBLE_RESULTS).map((symbol) => ({
            opaqueSymbolId: symbol.id,
            name: symbol.name,
            kind: symbol.kind,
          })),
        );
        setIsBusy(false);
      } catch {
        if (
          isCleanRequestCurrent(
            requestId,
            workspace.id,
            context.generation,
            started,
            started.providerProjectSnapshotIdentity,
          )
        ) {
          setError(SEARCH_ERROR);
          setIsBusy(false);
        }
      }
    });
  }, [
    approvedForSession,
    buildSearchAuthorization,
    clearSearch,
    detachActiveSession,
    enqueue,
    isCleanRequestCurrent,
    isRequestCurrent,
    language,
    query,
    stopExactSession,
    toolchainPaths,
  ]);

  const selectResult = useCallback(
    async (selected: SemanticSymbolSearchResult): Promise<void> => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      const selectedLanguage = language;
      const selectedQuery = query;
      const selectedPaths = { ...toolchainPaths };
      const selectedApproval = approvedForSession;
      setIsBusy(true);
      setError(null);
      setRefusal(null);

      await enqueue(async () => {
        const currentDependencies = dependenciesRef.current;
        const workspace = currentDependencies.workspaceInfo;
        const context = currentDependencies.getWorkspaceContext();
        const capabilities = currentDependencies.capabilities;
        const session = activeSessionRef.current;
        const searchResult = currentSearchRef.current;
        if (
          !workspace ||
          !capabilities ||
          !session ||
          !searchResult ||
          context.isSwitching ||
          context.isMetadataLoading ||
          context.workspaceId !== workspace.id ||
          context.generation !== session.workspaceGeneration
        ) {
          if (mountedRef.current && requestRef.current === requestId) {
            setRefusal("The selected result is stale. Run the search again.");
            setIsBusy(false);
          }
          return;
        }

        const buffers = safeBuffers(currentDependencies.getRelevantBuffers);
        const authorization = buildSearchAuthorization(
          selectedLanguage,
          selectedQuery,
          selectedPaths,
          selectedApproval,
          workspace,
          context.generation,
          capabilities,
          session,
          buffers,
        );
        const definitionDecision = decideSavedSnapshotDefinitionRequest({
          authorization,
          currentSearchResult: searchResult,
          selectedSymbolId: selected.opaqueSymbolId,
        });
        if (definitionDecision.kind !== "ready") {
          if (isRequestCurrent(requestId, workspace.id, context.generation, session)) {
            setRefusal(boundedMessage(refusalMessage(definitionDecision.reason)));
            setIsBusy(false);
          }
          return;
        }

        const selectedSymbol = searchResult.symbols.find(
          ({ id }) => id === selected.opaqueSymbolId,
        );
        if (!selectedSymbol) {
          setRefusal("The selected result is stale. Run the search again.");
          setIsBusy(false);
          return;
        }

        try {
          const candidate = await currentDependencies.refactorKit.resolveSavedSnapshotDefinition(
            definitionDecision.request,
          );
          const normalized = normalizeSavedSnapshotDefinitionResult({
            request: definitionDecision.request,
            currentSearchResult: searchResult,
            selectedSymbol,
            candidate: cloneDefinitionCandidate(candidate),
          });
          if (normalized.kind !== "ready") {
            if (isCleanRequestCurrent(requestId, workspace.id, context.generation, session)) {
              setRefusal(boundedMessage(refusalMessage(normalized.reason)));
              setIsBusy(false);
            }
            return;
          }
          if (
            !isCleanRequestCurrent(
              requestId,
              workspace.id,
              context.generation,
              session,
              session.providerProjectSnapshotIdentity,
            ) ||
            currentSearchRef.current !== searchResult
          ) {
            return;
          }
          const point = normalizeProviderPoint(normalized.result.point);
          if (point.kind !== "ready") {
            setRefusal(boundedMessage(refusalMessage(point.reason)));
            setIsBusy(false);
            return;
          }
          await currentDependencies.navigateToPoint(normalized.result.file, point.point);
          if (isCleanRequestCurrent(requestId, workspace.id, context.generation, session)) {
            setIsBusy(false);
          }
        } catch {
          if (isCleanRequestCurrent(requestId, workspace.id, context.generation, session)) {
            setError(DEFINITION_ERROR);
            setIsBusy(false);
          }
        }
      });
    },
    [
      approvedForSession,
      buildSearchAuthorization,
      enqueue,
      isCleanRequestCurrent,
      isRequestCurrent,
      language,
      query,
      toolchainPaths,
    ],
  );

  const resolveJavaDefinition = useCallback(
    async (symbol: string): Promise<void> => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      const selectedSymbol = symbol.trim();
      setIsJavaBusy(true);
      setJavaError(null);
      setJavaResult(null);
      setJavaLatestOperation("definition");

      await enqueue(async () => {
        const currentDependencies = dependenciesRef.current;
        const workspace = currentDependencies.workspaceInfo;
        const context = currentDependencies.getWorkspaceContext();
        const capabilities = currentDependencies.capabilities;
        if (
          !workspace ||
          !capabilities ||
          context.isSwitching ||
          context.isMetadataLoading ||
          context.workspaceId !== workspace.id ||
          context.generation !== currentDependencies.workspaceGeneration
        ) {
          if (mountedRef.current && requestRef.current === requestId) {
            setJavaError(
              boundedMessage(!workspace ? UNAUTHORIZED_REASON : JAVA_UNAVAILABLE_REASON),
            );
            setIsJavaBusy(false);
          }
          return;
        }
        if (
          currentDependencies.javaSourceAnalysisAvailable === false ||
          !javaNavigationAdvertised(capabilities, "definition")
        ) {
          if (mountedRef.current && requestRef.current === requestId) {
            setJavaError(
              currentDependencies.javaSourceAnalysisAvailable === false
                ? JAVA_SOURCE_ANALYSIS_UNAVAILABLE_REASON
                : JAVA_UNAVAILABLE_REASON,
            );
            setIsJavaBusy(false);
          }
          return;
        }
        try {
          const result = await currentDependencies.refactorKit.definition(selectedSymbol);
          if (!isRequestCurrent(requestId, workspace.id, context.generation)) return;
          if (!result.success || result.locations.length === 0) {
            setJavaResult(result);
            setJavaError("The Java symbol could not be resolved.");
            setIsJavaBusy(false);
            return;
          }
          const location = javaLocationFrom(result.locations[0]!);
          let opened: boolean;
          try {
            opened = await currentDependencies.navigateToPoint(location.filePath, location.point);
          } catch {
            if (isRequestCurrent(requestId, workspace.id, context.generation)) {
              setJavaError(JAVA_DEFINITION_OPEN_ERROR);
              setIsJavaBusy(false);
            }
            return;
          }
          if (isRequestCurrent(requestId, workspace.id, context.generation)) {
            if (!opened) setJavaError(JAVA_DEFINITION_OPEN_ERROR);
            setIsJavaBusy(false);
          }
        } catch {
          if (isRequestCurrent(requestId, workspace.id, context.generation)) {
            setJavaError(JAVA_DEFINITION_ERROR);
            setIsJavaBusy(false);
          }
        }
      });
    },
    [enqueue, isRequestCurrent],
  );

  const resolveJavaReferences = useCallback(
    async (symbol: string): Promise<void> => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      const selectedSymbol = symbol.trim();
      setIsJavaBusy(true);
      setJavaError(null);
      setJavaResult(null);
      setJavaLatestOperation("references");

      await enqueue(async () => {
        const currentDependencies = dependenciesRef.current;
        const workspace = currentDependencies.workspaceInfo;
        const context = currentDependencies.getWorkspaceContext();
        const capabilities = currentDependencies.capabilities;
        if (
          !workspace ||
          !capabilities ||
          context.isSwitching ||
          context.isMetadataLoading ||
          context.workspaceId !== workspace.id ||
          context.generation !== currentDependencies.workspaceGeneration
        ) {
          if (mountedRef.current && requestRef.current === requestId) {
            setJavaError(
              boundedMessage(!workspace ? UNAUTHORIZED_REASON : JAVA_UNAVAILABLE_REASON),
            );
            setIsJavaBusy(false);
          }
          return;
        }
        if (
          currentDependencies.javaSourceAnalysisAvailable === false ||
          !javaNavigationAdvertised(capabilities, "references")
        ) {
          if (mountedRef.current && requestRef.current === requestId) {
            setJavaError(
              currentDependencies.javaSourceAnalysisAvailable === false
                ? JAVA_SOURCE_ANALYSIS_UNAVAILABLE_REASON
                : JAVA_UNAVAILABLE_REASON,
            );
            setIsJavaBusy(false);
          }
          return;
        }
        try {
          const result = await currentDependencies.refactorKit.references(selectedSymbol);
          if (!isRequestCurrent(requestId, workspace.id, context.generation)) return;
          setJavaResult(result);
          if (!result.success) {
            setJavaError(JAVA_REFERENCES_ERROR);
          }
          setIsJavaBusy(false);
        } catch {
          if (isRequestCurrent(requestId, workspace.id, context.generation)) {
            setJavaError(JAVA_REFERENCES_ERROR);
            setIsJavaBusy(false);
          }
        }
      });
    },
    [enqueue, isRequestCurrent],
  );

  const selectJavaReference = useCallback(
    async (location: JavaSymbolLocation): Promise<boolean> => {
      const currentDependencies = dependenciesRef.current;
      const workspace = currentDependencies.workspaceInfo;
      const context = currentDependencies.getWorkspaceContext();
      if (
        !workspace ||
        context.isSwitching ||
        context.isMetadataLoading ||
        context.workspaceId !== workspace.id ||
        context.generation !== currentDependencies.workspaceGeneration
      ) {
        return false;
      }
      try {
        const opened = await currentDependencies.navigateToPoint(location.filePath, location.point);
        const latestDependencies = dependenciesRef.current;
        const latestContext = latestDependencies.getWorkspaceContext();
        if (
          latestDependencies.workspaceInfo?.id !== workspace.id ||
          latestDependencies.workspaceGeneration !== context.generation ||
          latestContext.workspaceId !== workspace.id ||
          latestContext.generation !== context.generation ||
          latestContext.isSwitching ||
          latestContext.isMetadataLoading
        ) {
          return false;
        }
        if (!opened) setJavaError(JAVA_REFERENCE_OPEN_ERROR);
        return opened;
      } catch {
        const latestDependencies = dependenciesRef.current;
        const latestContext = latestDependencies.getWorkspaceContext();
        if (
          latestDependencies.workspaceInfo?.id === workspace.id &&
          latestDependencies.workspaceGeneration === context.generation &&
          latestContext.workspaceId === workspace.id &&
          latestContext.generation === context.generation &&
          !latestContext.isSwitching &&
          !latestContext.isMetadataLoading
        ) {
          setJavaError(JAVA_REFERENCE_OPEN_ERROR);
        }
        return false;
      }
    },
    [],
  );

  const resetSessionState = useCallback((): void => {
    requestRef.current += 1;
    setQueryState("");
    setToolchainPaths({
      nodeExecutable: "",
      languageServerPackageRoot: "",
      typeScriptPackageRoot: "",
    });
    setApprovedForSessionState(false);
    setIsBusy(false);
    setError(null);
    setRefusal(null);
    clearSearch();
  }, [clearSearch]);

  const stop = useCallback(async (): Promise<void> => {
    resetSessionState();
    await enqueue(detachActiveSession);
  }, [detachActiveSession, enqueue, resetSessionState]);

  const cancel = useCallback((): void => {
    resetSessionState();
    void enqueue(detachActiveSession);
  }, [detachActiveSession, enqueue, resetSessionState]);

  const resetWorkspace = useCallback(
    async (_nextWorkspaceGeneration: number): Promise<void> => {
      resetSessionState();
      await enqueue(detachActiveSession);
    },
    [detachActiveSession, enqueue, resetSessionState],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      void enqueue(detachActiveSession);
    };
  }, [detachActiveSession, enqueue]);

  const buffers = safeBuffers(dependencies.getRelevantBuffers);
  const snapshotState = snapshotStateOf(buffers);
  const bufferAuthority = buffers
    .map(({ path, savedState, dirty }) => `${path.length}:${path}:${savedState}:${dirty ? 1 : 0}`)
    .join("|");
  const previousBufferAuthorityRef = useRef(bufferAuthority);
  useEffect(() => {
    if (previousBufferAuthorityRef.current === bufferAuthority) return;
    previousBufferAuthorityRef.current = bufferAuthority;
    requestRef.current += 1;
    setIsBusy(false);
    setError(null);
    setRefusal(null);
    clearSearch();
    void enqueue(detachActiveSession);
  }, [bufferAuthority, clearSearch, detachActiveSession, enqueue]);

  const renderedWorkspaceContext = dependencies.getWorkspaceContext();
  const authorized =
    dependencies.workspaceInfo !== null &&
    renderedWorkspaceContext.workspaceId === dependencies.workspaceInfo.id &&
    renderedWorkspaceContext.generation === dependencies.workspaceGeneration &&
    !renderedWorkspaceContext.isSwitching &&
    !renderedWorkspaceContext.isMetadataLoading;
  const acceptedEvidence = hasAcceptedEvidence(dependencies.capabilities, language);
  const evidenceState: SemanticSearchEvidenceState = dependencies.isCheckingCapabilities
    ? "checking"
    : acceptedEvidence
      ? "accepted"
      : "unavailable";
  const availability: SemanticSearchAvailability =
    authorized && dependencies.status?.available && acceptedEvidence ? "available" : "unavailable";
  const availabilityReason = !authorized
    ? UNAUTHORIZED_REASON
    : !dependencies.status?.available || !acceptedEvidence
      ? CAPABILITY_REASON
      : null;
  const canSubmit =
    availability === "available" &&
    snapshotState === "saved" &&
    approvedForSession &&
    query.trim().length > 0 &&
    !isBusy;
  const javaCapabilityAvailable =
    dependencies.javaSourceAnalysisAvailable !== false &&
    javaNavigationAdvertised(dependencies.capabilities, "definition") &&
    javaNavigationAdvertised(dependencies.capabilities, "references");
  const javaAvailability: JavaNavigationAvailability = javaError
    ? "error"
    : authorized && dependencies.status?.available && javaCapabilityAvailable
      ? "available"
      : "unavailable";
  const javaAvailabilityReason = javaError
    ? null
      : !authorized
        ? UNAUTHORIZED_REASON
        : dependencies.javaSourceAnalysisAvailable === false
          ? JAVA_SOURCE_ANALYSIS_UNAVAILABLE_REASON
        : !dependencies.status?.available || !javaCapabilityAvailable
        ? JAVA_UNAVAILABLE_REASON
        : null;

  const workspaceCollaborator = useMemo<RefactorKitSymbolNavigationWorkspaceCollaborator>(
    () => ({ resetWorkspace }),
    [resetWorkspace],
  );

  return useMemo(
    () => ({
      language,
      query,
      toolchainPaths,
      approvedForSession,
      snapshotState,
      evidenceState,
      availability,
      availabilityReason,
      results,
      resultLimit: MAX_VISIBLE_RESULTS,
      isBusy,
      canSubmit,
      error,
      refusal,
      hasActiveSession,
      acceptedSession,
      setLanguage,
      setQuery,
      setToolchainPath,
      setApprovedForSession,
      submit,
      selectResult,
      cancel,
      stop,
      javaSymbol,
      javaAvailability,
      javaAvailabilityReason,
      javaError,
      javaResult,
      javaLatestOperation,
      isJavaBusy,
      setJavaSymbol,
      resolveJavaDefinition,
      resolveJavaReferences,
      selectJavaReference,
      workspaceCollaborator,
    }),
    [
      acceptedSession,
      approvedForSession,
      availability,
      availabilityReason,
      canSubmit,
      cancel,
      error,
      evidenceState,
      hasActiveSession,
      isBusy,
      language,
      query,
      refusal,
      results,
      selectResult,
      setApprovedForSession,
      setLanguage,
      setQuery,
      setToolchainPath,
      snapshotState,
      stop,
      submit,
      toolchainPaths,
      isJavaBusy,
      javaAvailability,
      javaAvailabilityReason,
      javaError,
      javaLatestOperation,
      javaResult,
      javaSymbol,
      resolveJavaDefinition,
      resolveJavaReferences,
      selectJavaReference,
      setJavaSymbol,
      workspaceCollaborator,
    ],
  );
}
