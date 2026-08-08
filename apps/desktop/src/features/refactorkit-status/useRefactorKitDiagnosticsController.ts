import {
  decideTypeScriptDiagnosticsRequest,
  type RefactorKitCapabilities,
  type RefactorKitStatus,
  type SavedSnapshotSemanticSessionStartResult,
  type TypeScriptDiagnosticsSemanticSession,
  type TypeScriptDiagnosticsSourceAuthorityRequest,
  type TypeScriptDiagnosticsResponse,
  type WorkspaceInfo,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core/ports";
import type {
  LanguageDiagnostic,
  LanguageDocumentIdentity,
  LanguageToolingDiagnosticsPresentation,
  ProblemItem,
} from "@ide/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DIAGNOSTIC_OWNER = "refactorkit-typescript-compiler";
const MAX_PRESENTATION_MESSAGE_LENGTH = 180;
const UNAVAILABLE_MESSAGE =
  "Compiler diagnostics require a current authorized TypeScript snapshot and qualified semantic session.";
const FAILED_MESSAGE =
  "Compiler diagnostics could not be completed for the current source snapshot.";
const STALE_MESSAGE = "The source authority changed. Request compiler diagnostics again.";

export interface TypeScriptDiagnosticsEditorDocument {
  readonly path: string;
  readonly version: number;
  readonly content: string;
}

export interface TypeScriptDiagnosticsWorkspaceContext {
  readonly generation: number;
  readonly workspaceId: string | null;
  readonly isSwitching: boolean;
  readonly isMetadataLoading: boolean;
}

export interface UseRefactorKitDiagnosticsControllerDependencies {
  readonly refactorKit: RefactorKitPort;
  readonly status: RefactorKitStatus | null;
  readonly capabilities: RefactorKitCapabilities | null;
  readonly isCheckingCapabilities: boolean;
  readonly workspaceInfo: WorkspaceInfo | null;
  readonly workspaceGeneration: number;
  readonly acceptedSession: Readonly<SavedSnapshotSemanticSessionStartResult> | null;
  getWorkspaceContext(): TypeScriptDiagnosticsWorkspaceContext;
  getCurrentDocument(): Readonly<TypeScriptDiagnosticsEditorDocument> | null;
}

interface DiagnosticsProjection {
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly document: Readonly<LanguageDocumentIdentity>;
  readonly diagnostics: readonly Readonly<LanguageDiagnostic>[];
  readonly problemItems: readonly Readonly<ProblemItem>[];
}

interface DiagnosticsControllerState {
  readonly presentation: LanguageToolingDiagnosticsPresentation | null;
  readonly projection: DiagnosticsProjection | null;
}

export interface RefactorKitDiagnosticsController {
  readonly presentation: LanguageToolingDiagnosticsPresentation | null;
  readonly activeDiagnostics: readonly Readonly<LanguageDiagnostic>[];
  readonly activeDiagnosticDocument: Readonly<LanguageDocumentIdentity> | undefined;
  readonly activeDiagnosticOwner: string;
  readonly problemItems: readonly Readonly<ProblemItem>[];
  request(): Promise<void>;
}

interface RequestAuthority {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly workspaceGeneration: number;
  readonly status: RefactorKitStatus;
  readonly sessionId: string;
  readonly semanticLease: string;
  readonly snapshotHash: string;
  readonly capabilities: RefactorKitCapabilities;
  readonly document: Readonly<TypeScriptDiagnosticsEditorDocument>;
}

function extensionOf(path: string): string {
  const leaf = path.replaceAll("\\", "/").split("/").pop() ?? "";
  const separator = leaf.lastIndexOf(".");
  return separator > 0 && separator < leaf.length - 1
    ? leaf.slice(separator + 1).toLowerCase()
    : "";
}

function createWorkspaceFileUri(rootPath: string, relativePath: string): string {
  const normalizedRoot = rootPath.replaceAll("\\", "/").replace(/\/$/u, "");
  const normalizedRelative = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  const absolutePath = `${normalizedRoot}/${normalizedRelative}`;
  return `file://${absolutePath.startsWith("/") ? "" : "/"}${absolutePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function boundedSafeMessage(message: string | null | undefined, fallback: string): string {
  const sanitized = (message ?? "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\b(?:file|https?):\/\/\S+/giu, "[redacted resource]")
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s/\\]+[/\\])+[^\s,;)]*/gu, "[redacted path]")
    .replace(/\b[a-f0-9]{64}\b/giu, "[redacted identifier]")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const text = sanitized || fallback;
  const characters = Array.from(text);
  return characters.length <= MAX_PRESENTATION_MESSAGE_LENGTH
    ? text
    : `${characters.slice(0, MAX_PRESENTATION_MESSAGE_LENGTH - 1).join("")}…`;
}

function refusalMessage(reason: string): string {
  switch (reason) {
    case "invalid-language-id":
    case "capability-extensions-unauthorized":
      return "Open a supported TypeScript source document before requesting compiler diagnostics.";
    case "workspace-generation-stale":
    case "workspace-unauthorized":
    case "semantic-session-authority-mismatch":
      return "The current workspace authority changed. Request compiler diagnostics again.";
    case "source-authority-invalid":
    case "source-authority-bounds-exceeded":
      return "The current editor snapshot cannot be submitted within the advertised diagnostics bounds.";
    case "semantic-session-hash-unbound":
    case "semantic-session-snapshot-mismatch":
    case "semantic-session-lease-invalid":
      return "The current semantic session is not bound to this source snapshot.";
    default:
      return UNAVAILABLE_MESSAGE;
  }
}

function diagnosticsSession(
  capabilities: RefactorKitCapabilities,
  session: Readonly<SavedSnapshotSemanticSessionStartResult>,
): TypeScriptDiagnosticsSemanticSession {
  const kernel = capabilities.languageKernel;
  const candidates = kernel?.available
    ? kernel.schema.adapters.flatMap((adapter) =>
        adapter.languageId === "typescript"
          ? adapter.capabilities.filter(({ operation }) => operation === "diagnostics")
          : [],
      )
    : [];
  const capability = candidates.length === 1 ? candidates[0] : undefined;
  if (!capability) return { state: "unavailable", reason: "qualified diagnostics unavailable" };

  return {
    state: "ready",
    qualification: "qualified",
    languageId: session.languageId,
    workspaceId: session.workspaceId,
    workspaceGeneration: session.workspaceGeneration,
    sessionId: session.sessionId,
    semanticLease: session.semanticLease,
    snapshotHash: session.startSnapshotHash,
    providerVersion: session.providerVersion,
    toolchain: {
      evidence: capability.evidence,
      backend: capability.backend,
      runtime: {
        ...capability.runtime,
        limits: { ...capability.runtime.limits },
      },
      extensions: [...capability.extensions],
    },
  };
}

function sameDocument(
  left: Readonly<TypeScriptDiagnosticsEditorDocument> | null,
  right: Readonly<TypeScriptDiagnosticsEditorDocument> | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.path === right.path && left.version === right.version && left.content === right.content
  );
}

function responseCorrelates(
  response: Readonly<TypeScriptDiagnosticsResponse>,
  request: Readonly<{
    requestId: string;
    workspaceId: string;
    workspaceGeneration: number;
    sessionId: string;
    expectedSnapshotHash: string;
    semanticLease: string;
  }>,
): boolean {
  return (
    response.schemaVersion === 2 &&
    response.operation === "diagnostics.v2" &&
    response.requestId === request.requestId &&
    response.workspaceId === request.workspaceId &&
    response.workspaceGeneration === request.workspaceGeneration &&
    response.sessionId === request.sessionId &&
    response.projectSnapshotHash === request.expectedSnapshotHash &&
    response.semanticLease === request.semanticLease
  );
}

function mapProjection(
  response: Extract<TypeScriptDiagnosticsResponse, { status: "ready" }>,
  workspace: WorkspaceInfo,
): DiagnosticsProjection {
  const diagnostics: readonly Readonly<LanguageDiagnostic>[] = Object.freeze(
    response.diagnostics.map((diagnostic) =>
      Object.freeze({
        range: Object.freeze({
          start: Object.freeze({ ...diagnostic.location.range.start }),
          end: Object.freeze({ ...diagnostic.location.range.end }),
        }),
        severity: diagnostic.severity,
        message: diagnostic.message,
        code: diagnostic.code,
        source: diagnostic.evidence,
      }),
    ),
  );
  const problemItems: readonly Readonly<ProblemItem>[] = Object.freeze(
    response.diagnostics.map((diagnostic, index) =>
      Object.freeze({
        id: `${DIAGNOSTIC_OWNER}:${response.requestId}:${index}`,
        provider: response.provider.name,
        filePath: diagnostic.location.path,
        severity: diagnostic.severity,
        range: Object.freeze({
          start: Object.freeze({ ...diagnostic.location.range.start }),
          end: Object.freeze({ ...diagnostic.location.range.end }),
        }),
        message: diagnostic.message,
        code: diagnostic.code,
        source: diagnostic.evidence,
      }),
    ),
  );
  const path = response.sourceAuthority.documents[0]?.path;
  if (!path) throw new TypeError("Accepted diagnostics response has no source authority");
  return Object.freeze({
    workspaceId: response.workspaceId,
    workspaceGeneration: response.workspaceGeneration,
    document: Object.freeze({
      workspaceId: response.workspaceId,
      path,
      uri: createWorkspaceFileUri(workspace.rootPath, path),
    }),
    diagnostics,
    problemItems,
  });
}

/** Desktop-only orchestration for qualified, current-snapshot RefactorKit diagnostics. */
export function useRefactorKitDiagnosticsController(
  dependencies: UseRefactorKitDiagnosticsControllerDependencies,
): RefactorKitDiagnosticsController {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const previousWorkspaceRef = useRef({
    workspaceId: dependencies.getWorkspaceContext().workspaceId,
    generation: dependencies.getWorkspaceContext().generation,
  });
  const authorityTokenRef = useRef({
    status: dependencies.status,
    checking: dependencies.isCheckingCapabilities,
    session: dependencies.acceptedSession,
    capabilities: dependencies.capabilities,
    document: dependencies.getCurrentDocument(),
  });
  const [state, setState] = useState<DiagnosticsControllerState>({
    presentation: null,
    projection: null,
  });

  const isCurrent = useCallback((requestId: number, authority: RequestAuthority): boolean => {
    const current = dependenciesRef.current;
    const context = current.getWorkspaceContext();
    const session = current.acceptedSession;
    return (
      mountedRef.current &&
      requestRef.current === requestId &&
      !context.isSwitching &&
      !context.isMetadataLoading &&
      context.workspaceId === authority.workspaceId &&
      context.generation === authority.workspaceGeneration &&
      current.workspaceInfo?.id === authority.workspaceId &&
      current.workspaceInfo.rootPath === authority.workspaceRoot &&
      current.workspaceGeneration === authority.workspaceGeneration &&
      current.status === authority.status &&
      current.status.available &&
      !current.isCheckingCapabilities &&
      current.capabilities === authority.capabilities &&
      session?.sessionId === authority.sessionId &&
      session.semanticLease === authority.semanticLease &&
      session.startSnapshotHash === authority.snapshotHash &&
      sameDocument(current.getCurrentDocument(), authority.document)
    );
  }, []);

  const request = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ ...current, presentation: { state: "checking" } }));

    const current = dependenciesRef.current;
    const context = current.getWorkspaceContext();
    const workspace = current.workspaceInfo;
    const capabilities = current.capabilities;
    const session = current.acceptedSession;
    const document = current.getCurrentDocument();
    if (
      current.isCheckingCapabilities ||
      !current.status?.available ||
      !workspace ||
      !capabilities ||
      !session ||
      !document ||
      context.isSwitching ||
      context.isMetadataLoading ||
      context.workspaceId !== workspace.id ||
      context.generation !== current.workspaceGeneration
    ) {
      if (mountedRef.current && requestRef.current === requestId) {
        setState((previous) => ({
          ...previous,
          presentation: { state: "refused", message: UNAVAILABLE_MESSAGE },
        }));
      }
      return;
    }

    const semanticSession = diagnosticsSession(capabilities, session);
    const sourceAuthority: TypeScriptDiagnosticsSourceAuthorityRequest = {
      kind: "immutable-editor-overlay",
      documents: [{ path: document.path, version: document.version, content: document.content }],
    };
    const decision = decideTypeScriptDiagnosticsRequest({
      languageId: "typescript",
      sourceExtension: extensionOf(document.path),
      requestId: `desktop-diagnostics:${context.generation}:${requestId}`,
      workspaceId: workspace.id,
      workspaceGeneration: context.generation,
      authorizedWorkspaceId: workspace.id,
      authorizedWorkspaceGeneration: current.workspaceGeneration,
      snapshotHash: session.startSnapshotHash,
      sourceAuthority,
      capabilities,
      semanticSession,
    });
    if (decision.kind !== "ready") {
      if (mountedRef.current && requestRef.current === requestId) {
        setState((previous) => ({
          ...previous,
          presentation: {
            state: "refused",
            message: boundedSafeMessage(refusalMessage(decision.reason), UNAVAILABLE_MESSAGE),
          },
        }));
      }
      return;
    }

    const authority: RequestAuthority = {
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
      workspaceGeneration: context.generation,
      status: current.status,
      sessionId: session.sessionId,
      semanticLease: session.semanticLease,
      snapshotHash: session.startSnapshotHash,
      capabilities,
      document: { ...document },
    };

    try {
      const response = await current.refactorKit.diagnostics(decision.request);
      if (!isCurrent(requestId, authority)) return;
      if (!responseCorrelates(response, decision.request)) {
        setState((previous) => ({
          ...previous,
          presentation: { state: "error", message: FAILED_MESSAGE },
        }));
        return;
      }
      if (response.status === "ready") {
        const projection = mapProjection(response, workspace);
        setState({
          presentation: { state: "ready", diagnosticCount: projection.problemItems.length },
          projection,
        });
        return;
      }
      setState((previous) => ({
        ...previous,
        presentation: {
          state: response.status,
          message: boundedSafeMessage(response.failure.message, FAILED_MESSAGE),
        },
      }));
    } catch {
      if (!isCurrent(requestId, authority)) return;
      setState((previous) => ({
        ...previous,
        presentation: { state: "error", message: FAILED_MESSAGE },
      }));
    }
  }, [isCurrent]);

  const renderedContext = dependencies.getWorkspaceContext();
  const renderedDocument = dependencies.getCurrentDocument();
  useEffect(() => {
    const previousWorkspace = previousWorkspaceRef.current;
    const workspaceChanged =
      previousWorkspace.workspaceId !== renderedContext.workspaceId ||
      previousWorkspace.generation !== renderedContext.generation;
    previousWorkspaceRef.current = {
      workspaceId: renderedContext.workspaceId,
      generation: renderedContext.generation,
    };

    const previousAuthority = authorityTokenRef.current;
    const authorityChanged =
      previousAuthority.status !== dependencies.status ||
      previousAuthority.checking !== dependencies.isCheckingCapabilities ||
      previousAuthority.session !== dependencies.acceptedSession ||
      previousAuthority.capabilities !== dependencies.capabilities ||
      !sameDocument(previousAuthority.document, renderedDocument);
    authorityTokenRef.current = {
      status: dependencies.status,
      checking: dependencies.isCheckingCapabilities,
      session: dependencies.acceptedSession,
      capabilities: dependencies.capabilities,
      document: renderedDocument,
    };

    if (!workspaceChanged && !authorityChanged) return;
    requestRef.current += 1;
    setState((current) =>
      workspaceChanged
        ? { presentation: null, projection: null }
        : current.presentation?.state === "checking"
          ? { ...current, presentation: { state: "refused", message: STALE_MESSAGE } }
          : current,
    );
  }, [
    dependencies.acceptedSession,
    dependencies.capabilities,
    dependencies.isCheckingCapabilities,
    dependencies.status,
    renderedContext.generation,
    renderedContext.workspaceId,
    renderedDocument?.content,
    renderedDocument?.path,
    renderedDocument?.version,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  return useMemo(
    () => ({
      presentation: state.presentation,
      activeDiagnostics: state.projection?.diagnostics ?? [],
      activeDiagnosticDocument: state.projection?.document,
      activeDiagnosticOwner: DIAGNOSTIC_OWNER,
      problemItems: state.projection?.problemItems ?? [],
      request,
    }),
    [request, state],
  );
}
