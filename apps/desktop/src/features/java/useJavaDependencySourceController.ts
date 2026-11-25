import { captureJavaProjectOperationContext } from "@ide/contracts";
import type {
  EditorPoint,
  JavaDependencySourceAssociation,
  JavaDependencySourceRequest,
  JavaDependencySourceResult,
  JavaDependencySourceDeclarationResult,
  JavaPlatformSourceAssociation,
  JavaPlatformSourceDeclarationRequest,
  JavaPlatformSourceDeclarationResult,
  JavaPlatformSourceReadRequest,
  JavaPlatformSourceRequest,
  JavaPlatformSourceResult,
  JavaLibraryDefinition,
  LanguageRange,
  JavaEffectiveProjectContext,
  JavaNavigationRequest,
  JavaNavigationResult,
  JavaProjectContextSettings,
  JavaProjectOperationContext,
} from "@ide/contracts";
import type {
  EditorViewModel,
  JavaDependencySourcePort,
  JavaPlatformSourcePort,
} from "@ide/web-core";
import type { EditorRevealRequest } from "@ide/ui";
import { useCallback, useEffect, useRef, useState } from "react";

interface Dependencies {
  port: JavaDependencySourcePort;
  platformPort: JavaPlatformSourcePort;
  workspaceId: string | null;
  generation: number;
  onNavigate?(location: { filePath: string; point: EditorPoint }): void;
  getContext(): { workspaceId: string | null; generation: number; isSwitching: boolean };
  getEditorState(): { activeFilePath: string | null; contents: Record<string, string> };
  getProjectContext(): {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
  };
  editor: Pick<EditorViewModel, "captureEditorBuffers" | "bufferLifetime">;
}

interface DefinitionOperation {
  cancelled: boolean;
}

function recordDefinitionEvidence(entry: Record<string, unknown>): void {
  if (typeof document === "undefined") return;
  const body = document.body;
  if (!body?.hasAttribute("data-native-java-navigation-diagnostics")) return;
  let history: Array<Record<string, unknown>> = [];
  try {
    const value = JSON.parse(body.getAttribute("data-java-dependency-definition-history") ?? "[]");
    if (Array.isArray(value)) history = value;
  } catch {
    history = [];
  }
  history.push(entry);
  body.setAttribute("data-java-dependency-definition-history", JSON.stringify(history.slice(-12)));
}

export interface JavaLibraryDocument {
  uri: string;
  title: string;
  content: string;
  association: JavaDependencySourceAssociation | JavaPlatformSourceAssociation;
  scope: string;
}

function authority(dependencies: Dependencies): JavaProjectOperationContext {
  const { settings, context } = dependencies.getProjectContext();
  if (!settings.sdkHome.trim() || context?.status !== "available")
    throw new Error(
      "Select a project JDK and synchronize the Java project before opening dependency sources.",
    );
  const captured = captureJavaProjectOperationContext({ settings, context });
  if (!captured)
    throw new Error(
      "Select a project JDK and synchronize the Java project before opening dependency sources.",
    );
  return captured;
}

function scope(dependencies: Dependencies): string {
  const current = dependencies.getContext();
  let project: JavaProjectOperationContext | null = null;
  try {
    project = authority(dependencies);
  } catch {
    /* Unavailable contexts retire all library views. */
  }
  return JSON.stringify([current.workspaceId, current.generation, current.isSwitching, project]);
}

function available<T extends JavaDependencySourceResult | JavaDependencySourceDeclarationResult>(
  result: T,
  request: JavaDependencySourceRequest,
  operation: T["operation"],
): asserts result is Extract<T, { status: "available" }> {
  if (
    result.workspaceId !== request.workspaceId ||
    result.generation !== request.generation ||
    result.requestId !== request.requestId ||
    result.documentPath !== request.document.path ||
    result.documentVersion !== request.document.version ||
    result.operation !== operation
  )
    throw new Error("The dependency source response belongs to another request.");
  if (result.status !== "available") throw new Error(result.reason.message);
  if (
    result.schemaVersion !==
      (operation === "declaration"
        ? request.editorOverlay
          ? "java-editor-dependency-source-declaration-v1"
          : "java-dependency-source-declaration-v1"
        : request.editorOverlay
          ? "java-editor-dependency-source-v1"
          : "java-dependency-source-v1") ||
    result.snapshotHash !== request.projectContext.snapshotHash ||
    result.contextHash !== request.projectContext.contextHash ||
    JSON.stringify(result.sdkIdentities.map((sdk) => sdk.identitySha256)) !==
      JSON.stringify(request.projectContext.platformIdentities) ||
    result.association.readOnly !== true ||
    !result.association.resourceUri.startsWith("refactorkit-java-source://")
  )
    throw new Error("The dependency source response does not match the selected Java project.");
  if (request.editorOverlay) {
    const proof = result.editorOverlay;
    if (
      !proof ||
      proof.baseSnapshotHash !== request.projectContext.snapshotHash ||
      proof.overlayHash !== request.editorOverlay.expectedOverlayHash ||
      !/^[a-f0-9]{64}$/.test(proof.providerSnapshotHash) ||
      proof.documents.length !== request.editorOverlay.documents.length ||
      request.editorOverlay.documents.some(
        (document) =>
          proof.documents.filter(
            (actual) =>
              actual.path === document.path &&
              actual.version === document.version &&
              /^[a-f0-9]{64}$/.test(actual.contentSha256),
          ).length !== 1,
      )
    )
      throw new Error("The dependency source does not attest the selected Java editor frame.");
  } else if (result.editorOverlay) throw new Error("Unexpected Java editor overlay authority.");
}

function platformAvailable<
  T extends JavaPlatformSourceResult | JavaPlatformSourceDeclarationResult,
>(
  result: T,
  request:
    | JavaPlatformSourceRequest
    | JavaPlatformSourceReadRequest
    | JavaPlatformSourceDeclarationRequest,
  operation: T["operation"],
): asserts result is Extract<T, { status: "available" }> {
  if (
    result.workspaceId !== request.workspaceId ||
    result.generation !== request.generation ||
    result.requestId !== request.requestId ||
    result.documentPath !== request.document.path ||
    result.documentVersion !== request.document.version ||
    result.operation !== operation
  )
    throw new Error("The SDK source response belongs to another request.");
  if (result.status !== "available") throw new Error(result.reason.message);
  if (
    result.schemaVersion !==
      (operation === "declaration"
        ? "java-platform-source-declaration-v1"
        : "java-platform-source-v1") ||
    result.snapshotHash !== request.projectContext.snapshotHash ||
    result.contextHash !== request.projectContext.contextHash ||
    JSON.stringify(result.sdkIdentities.map((sdk) => sdk.identitySha256)) !==
      JSON.stringify(request.projectContext.platformIdentities) ||
    result.association.readOnly !== true ||
    result.association.resourceKind !== "java-platform-source" ||
    !result.association.resourceUri.startsWith("refactorkit-java-platform-source://") ||
    result.association.platformIdentitySha256 !== request.expectedPlatformIdentitySha256 ||
    ("expectedAssociationHash" in request &&
      request.expectedAssociationHash !== undefined &&
      result.association.associationHash !== request.expectedAssociationHash)
  )
    throw new Error("The SDK source response does not match the selected Java project.");
  if (request.editorOverlay) {
    const proof = result.editorOverlay;
    if (
      !proof ||
      proof.baseSnapshotHash !== request.projectContext.snapshotHash ||
      proof.overlayHash !== request.editorOverlay.expectedOverlayHash ||
      !/^[a-f0-9]{64}$/.test(proof.providerSnapshotHash) ||
      proof.documents.length !== request.editorOverlay.documents.length ||
      request.editorOverlay.documents.some(
        (document) =>
          proof.documents.filter(
            (actual) =>
              actual.path === document.path &&
              actual.version === document.version &&
              /^[a-f0-9]{64}$/.test(actual.contentSha256),
          ).length !== 1,
      )
    )
      throw new Error("The SDK source does not attest the selected Java editor frame.");
  } else if (result.editorOverlay) throw new Error("Unexpected Java editor overlay authority.");
}

function platformRequest(
  dependencies: Dependencies,
  request: JavaDependencySourceRequest,
): JavaPlatformSourceRequest {
  const { settings, context } = dependencies.getProjectContext();
  if (context?.status !== "available")
    throw new Error("Synchronize the Java project before opening JDK sources.");
  const selected = context.sdk.filter(
    (sdk) =>
      sdk.home === settings.sdkHome &&
      sdk.sourceRelease === sdk.platformRelease &&
      request.projectContext.platformIdentities.includes(sdk.identitySha256),
  );
  if (selected.length !== 1)
    throw new Error("The selected project JDK has no unique current platform identity.");
  return {
    ...request,
    expectedPlatformIdentitySha256: selected[0].identitySha256,
  };
}

function validTextRange(content: string, range: LanguageRange, empty = false): boolean {
  const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
  return (
    [range.start, range.end].every((p) => {
      const line = lines[p.line];
      return (
        Number.isSafeInteger(p.line) &&
        p.line >= 0 &&
        Number.isSafeInteger(p.character) &&
        p.character >= 0 &&
        line !== undefined &&
        p.character <= line.length &&
        !(
          p.character > 0 &&
          /[\uD800-\uDBFF]/.test(line[p.character - 1]) &&
          /[\uDC00-\uDFFF]/.test(line[p.character] ?? "")
        )
      );
    }) &&
    (range.end.line > range.start.line ||
      (range.end.line === range.start.line &&
        (empty
          ? range.end.character >= range.start.character
          : range.end.character > range.start.character)))
  );
}

/** Immutable provider documents stay outside writable workspace buffers and recovery storage. */
export function useJavaDependencySourceController(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const currentScope = scope(dependencies);
  const sequence = useRef(0);
  const openingRequest = useRef<number | null>(null);
  const approved = useRef(
    new Map<
      string,
      {
        definition: JavaLibraryDefinition;
        document: JavaLibraryDocument;
        request: JavaDependencySourceRequest;
        platformRequest?: JavaPlatformSourceRequest;
        guard(): void;
        ownsRequest(): boolean;
      }
    >(),
  );
  const definitionOperations = useRef(new Map<string, DefinitionOperation>());
  const pendingDefinitions = useRef(new Map<string, DefinitionOperation>());
  const invalidateDefinitionRequests = useCallback(() => {
    for (const operation of definitionOperations.current.values()) operation.cancelled = true;
    definitionOperations.current.clear();
    pendingDefinitions.current.clear();
    approved.current.clear();
  }, []);
  const [documents, setDocuments] = useState<JavaLibraryDocument[]>([]);
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revealRequest, setRevealRequest] = useState<EditorRevealRequest | null>(null);
  useEffect(() => {
    sequence.current += 1;
    invalidateDefinitionRequests();
    setDocuments([]);
    setActiveUri(null);
    setBusy(false);
    setMessage(null);
    setRevealRequest(null);
    return () => {
      sequence.current += 1;
      invalidateDefinitionRequests();
    };
  }, [currentScope, invalidateDefinitionRequests]);

  const showWorkspace = useCallback(() => {
    sequence.current += 1;
    setActiveUri(null);
    setBusy(false);
    invalidateDefinitionRequests();
  }, [invalidateDefinitionRequests]);
  const select = useCallback(
    (uri: string, point?: EditorPoint): boolean => {
      const current = latest.current.getContext();
      if (current.workspaceId !== latest.current.workspaceId || current.generation !== latest.current.generation ||
        current.isSwitching || scope(latest.current) !== currentScope ||
        !documents.some(document => document.uri === uri && document.scope === currentScope)) return false;
      sequence.current += 1;
      setActiveUri(uri);
      if (point) setRevealRequest({ filePath: uri, line: Math.max(1, point.lineNumber), column: Math.max(1, point.column), requestId: `library-history-${sequence.current}` });
      setBusy(false);
      invalidateDefinitionRequests();
      return true;
    },
    [documents, currentScope, invalidateDefinitionRequests],
  );
  const close = useCallback(
    (uri: string) => {
      sequence.current += 1;
      setDocuments((items) => items.filter((item) => item.uri !== uri));
      setActiveUri((active) => (active === uri ? null : active));
      setBusy(false);
      invalidateDefinitionRequests();
    },
    [invalidateDefinitionRequests],
  );

  const captureCursor = useCallback(
    (
      cursor: JavaNavigationRequest,
      id: number,
      selectedScope: string,
      allowDraft = false,
      ownsOperation?: () => boolean,
    ) => {
      const current = latest.current.getContext();
      if (
        current.isSwitching ||
        current.workspaceId !== cursor.workspaceId ||
        current.generation !== cursor.generation
      )
        throw new Error("The workspace changed; repeat source navigation.");
      const request: JavaDependencySourceRequest = {
        workspaceId: cursor.workspaceId,
        generation: cursor.generation,
        requestId: `${cursor.requestId}-source`,
        document: structuredClone(cursor.document),
        position: structuredClone(cursor.position),
        projectContext: authority(latest.current),
      };
      const capture = latest.current.editor.captureEditorBuffers();
      const saved = capture.documents.find((document) => document.path === request.document.path);
      if (!saved || (!allowDraft && saved.isDirty) || saved.text !== request.document.text)
        throw new Error(
          "The Java cursor changed or its editor frame is unavailable. Resolve the definition again; your drafts are preserved.",
        );
      const lifetime = latest.current.editor.bufferLifetime(request.document.path);
      const ownsRequest = () =>
        (ownsOperation?.() ?? id === sequence.current) && scope(latest.current) === selectedScope;
      const guard = () => {
        if (
          !ownsRequest() ||
          latest.current.getEditorState().activeFilePath !== request.document.path ||
          latest.current.editor.bufferLifetime(request.document.path) !== lifetime
        )
          throw new Error("The source navigation is no longer current.");
        capture.verify();
      };
      guard();
      return { request, guard, ownsRequest, documents: capture.documents };
    },
    [],
  );

  const publish = useCallback((document: JavaLibraryDocument, selection?: LanguageRange) => {
    latest.current.onNavigate?.({ filePath: document.uri, point: { lineNumber: (selection?.start.line ?? 0) + 1, column: (selection?.start.character ?? 0) + 1 } });
    setDocuments((items) => [
      ...items.filter((item) => item.uri !== document.uri).slice(-7),
      document,
    ]);
    setActiveUri(document.uri);
    setRevealRequest(
      selection
        ? {
            filePath: document.uri,
            line: selection.start.line + 1,
            column: selection.start.character + 1,
            requestId: `library-reveal-${sequence.current}`,
            selection: structuredClone(selection),
          }
        : null,
    );
  }, []);

  const captureSelectedCursor = useCallback(
    (
      cursor: JavaNavigationRequest,
      id: number,
      selectedScope: string,
      selection?: JavaNavigationResult,
      allowUnavailableSelection = false,
      ownsOperation?: () => boolean,
    ) => {
      if (
        selection &&
        selection.status !== "ready" &&
        !(allowUnavailableSelection && selection.status === "unavailable")
      )
        throw new Error(selection.message);
      if (
        selection &&
        (selection.workspaceId !== cursor.workspaceId ||
          selection.generation !== cursor.generation ||
          selection.requestId !== cursor.requestId ||
          selection.kind !== "definition" ||
          selection.documentPath !== cursor.document.path ||
          selection.documentVersion !== cursor.document.version)
      )
        throw new Error("The library selection belongs to another Java editor request.");
      const selectedOverlay = selection?.status === "ready" ? selection.editorOverlay : undefined;
      const { request, guard, documents } = captureCursor(
        cursor,
        id,
        selectedScope,
        !!selectedOverlay,
        ownsOperation,
      );
      const javaDocuments = documents.filter(
        (document) =>
          document.path.endsWith(".java") &&
          (!request.projectContext.projectPath ||
            document.path.startsWith(`${request.projectContext.projectPath}/`)),
      );
      if (
        selection?.status === "ready" &&
        (selection.snapshotHash !== request.projectContext.snapshotHash ||
          selection.projectContext?.contextHash !== request.projectContext.contextHash ||
          JSON.stringify(selection.projectContext.platformIdentities) !==
            JSON.stringify(request.projectContext.platformIdentities))
      )
        throw new Error(
          "The Java project changed after the definition selection. Resolve it again.",
        );
      if (selectedOverlay) {
        if (
          selectedOverlay.baseSnapshotHash !== request.projectContext.snapshotHash ||
          selectedOverlay.documents.length !== javaDocuments.length ||
          javaDocuments.some(
            (document) =>
              selectedOverlay.documents.filter(
                (actual) => actual.path === document.path && actual.version === document.version,
              ).length !== 1,
          )
        )
          throw new Error(
            "Java editor buffers changed after the definition selection. Resolve it again.",
          );
        request.editorOverlay = {
          expectedOverlayHash: selectedOverlay.overlayHash,
          documents: javaDocuments.map(({ path, text, version }) => ({ path, text, version })),
        };
      } else if (javaDocuments.some((document) => document.isDirty))
        throw new Error(
          "Resolve the definition again from the current Java editor frame. Your drafts are preserved.",
        );
      return { request, guard };
    },
    [captureCursor],
  );

  const openAtCursor = useCallback(
    async (cursor: JavaNavigationRequest, selection?: JavaNavigationResult): Promise<void> => {
      const id = ++sequence.current;
      openingRequest.current = id;
      invalidateDefinitionRequests();
      const selectedScope = scope(latest.current);
      const ownsRequest = () => id === sequence.current && scope(latest.current) === selectedScope;
      setMessage(null);
      setBusy(true);
      try {
        const { request, guard: requireCurrent } = captureSelectedCursor(
          cursor,
          id,
          selectedScope,
          selection,
        );
        requireCurrent();
        const lookup = await latest.current.port.lookup(request);
        requireCurrent();
        let association: JavaLibraryDocument["association"];
        let content: string;
        if (lookup.status === "available") {
          available(lookup, request, "lookup");
          const readRequest = {
            ...request,
            requestId: `${request.requestId}-read`,
            expectedAssociationHash: lookup.association.associationHash,
          };
          const read = await latest.current.port.read(readRequest);
          requireCurrent();
          available(read, readRequest, "read");
          if (
            JSON.stringify(read.association) !== JSON.stringify(lookup.association) ||
            typeof read.content !== "string" ||
            new TextEncoder().encode(read.content).length > 131072
          )
            throw new Error(
              "The dependency attachment changed between lookup and read; repeat source navigation.",
            );
          association = structuredClone(read.association);
          content = read.content;
        } else if (lookup.status === "unavailable") {
          const sdkRequest = platformRequest(latest.current, request);
          const sdkLookup = await latest.current.platformPort.lookup(sdkRequest);
          requireCurrent();
          platformAvailable(sdkLookup, sdkRequest, "lookup");
          const sdkReadRequest: JavaPlatformSourceReadRequest = {
            ...sdkRequest,
            requestId: `${sdkRequest.requestId}-read`,
            expectedAssociationHash: sdkLookup.association.associationHash,
          };
          const sdkRead = await latest.current.platformPort.read(sdkReadRequest);
          requireCurrent();
          platformAvailable(sdkRead, sdkReadRequest, "read");
          if (
            JSON.stringify(sdkRead.association) !== JSON.stringify(sdkLookup.association) ||
            typeof sdkRead.content !== "string" ||
            new TextEncoder().encode(sdkRead.content).length > 524288
          )
            throw new Error("The selected JDK source changed during its guarded read.");
          association = structuredClone(sdkRead.association);
          content = sdkRead.content;
        } else {
          available(lookup, request, "lookup");
          throw new Error("The dependency source is unavailable.");
        }
        const document: JavaLibraryDocument = {
          uri: association.resourceUri,
          title: association.sourceEntry.split("/").at(-1)!,
          content,
          association,
          scope: selectedScope,
        };
        publish(document);
      } catch (error) {
        if (ownsRequest())
          setMessage(
            `${error instanceof Error ? error.message : "Dependency sources are unavailable."} (Cursor ${cursor.position.line + 1}:${cursor.position.character + 1}.)`,
          );
      } finally {
        if (openingRequest.current === id) openingRequest.current = null;
        if (ownsRequest()) setBusy(false);
      }
    },
    [captureSelectedCursor, invalidateDefinitionRequests, publish],
  );

  const queryDefinition = useCallback(
    async (
      cursor: JavaNavigationRequest,
      selection?: JavaNavigationResult,
    ): Promise<JavaLibraryDefinition | null> => {
      // Monaco can ask for a hover definition while an explicit source action is pending.
      // That preview must not revoke the person's guarded lookup/read operation.
      if (openingRequest.current === sequence.current) return null;
      const id = sequence.current;
      const selectedScope = scope(latest.current);
      const previous = definitionOperations.current.get(cursor.requestId);
      if (previous) previous.cancelled = true;
      const operation: DefinitionOperation = { cancelled: false };
      definitionOperations.current.set(cursor.requestId, operation);
      pendingDefinitions.current.set(cursor.requestId, operation);
      let stage = "capture";
      let providerStatus: string | undefined;
      let providerReasonCode: string | undefined;
      const ownsRequest = () =>
        !operation.cancelled &&
        id === sequence.current &&
        selectedScope === scope(latest.current) &&
        definitionOperations.current.get(cursor.requestId) === operation;
      approved.current.delete(cursor.requestId);
      setMessage(null);
      setBusy(true);
      try {
        const { request, guard } = captureSelectedCursor(
          cursor,
          id,
          selectedScope,
          selection,
          true,
          ownsRequest,
        );
        stage = "dependency-declaration";
        const result = await latest.current.port.declaration(request);
        providerStatus = result.status;
        providerReasonCode = "reason" in result ? result.reason.code : undefined;
        recordDefinitionEvidence({
          event: "provider-result",
          requestId: cursor.requestId,
          status: providerStatus,
          ...(providerReasonCode ? { reasonCode: providerReasonCode } : {}),
          editorOverlay: !!request.editorOverlay,
        });
        stage = "request-authority-check";
        guard();
        stage = "dependency-declaration-validation";
        let association: JavaLibraryDocument["association"];
        let content: string;
        let declaration: JavaLibraryDefinition["range"];
        let declarationRange: JavaLibraryDefinition["declarationRange"];
        let sdkRequest: JavaPlatformSourceRequest | undefined;
        if (result.status === "available") {
          available(result, request, "declaration");
          stage = "dependency-source-read";
          const readRequest = {
            ...request,
            requestId: `${request.requestId}-read`,
            expectedAssociationHash: result.association.associationHash,
          };
          const read = await latest.current.port.read(readRequest);
          stage = "dependency-source-read-validation";
          guard();
          available(read, readRequest, "read");
          if (
            JSON.stringify(read.association) !== JSON.stringify(result.association) ||
            typeof read.content !== "string" ||
            new TextEncoder().encode(read.content).length > 131072 ||
            result.declaration.evidence !== "JDT_SOURCE_BINDING" ||
            !validTextRange(read.content, result.declaration.nameRange) ||
            !validTextRange(read.content, result.declaration.declarationRange)
          )
            throw new Error(
              "The dependency declaration does not match its guarded source content.",
            );
          association = structuredClone(read.association);
          content = read.content;
          declaration = structuredClone(result.declaration.nameRange);
          declarationRange = structuredClone(result.declaration.declarationRange);
        } else if (result.status === "unavailable") {
          stage = "selected-jdk-declaration";
          sdkRequest = platformRequest(latest.current, request);
          const sdkResult: JavaPlatformSourceDeclarationResult =
            await latest.current.platformPort.declaration(sdkRequest);
          stage = "selected-jdk-declaration-validation";
          guard();
          platformAvailable(sdkResult, sdkRequest, "declaration");
          const sdkReadRequest: JavaPlatformSourceReadRequest = {
            ...sdkRequest,
            requestId: `${sdkRequest.requestId}-read`,
            expectedAssociationHash: sdkResult.association.associationHash,
          };
          const sdkRead: JavaPlatformSourceResult =
            await latest.current.platformPort.read(sdkReadRequest);
          stage = "selected-jdk-source-read-validation";
          guard();
          platformAvailable(sdkRead, sdkReadRequest, "read");
          if (
            JSON.stringify(sdkRead.association) !== JSON.stringify(sdkResult.association) ||
            typeof sdkRead.content !== "string" ||
            new TextEncoder().encode(sdkRead.content).length > 524288 ||
            sdkResult.declaration.evidence !== "JDT_SOURCE_BINDING" ||
            !validTextRange(sdkRead.content, sdkResult.declaration.nameRange) ||
            !validTextRange(sdkRead.content, sdkResult.declaration.declarationRange)
          )
            throw new Error("The JDK declaration does not match its guarded source content.");
          association = structuredClone(sdkRead.association);
          content = sdkRead.content;
          declaration = structuredClone(sdkResult.declaration.nameRange);
          declarationRange = structuredClone(sdkResult.declaration.declarationRange);
        } else {
          available(result, request, "declaration");
          throw new Error("The dependency declaration is unavailable.");
        }
        const definition: JavaLibraryDefinition = {
          requestId: cursor.requestId,
          resourceUri: association.resourceUri,
          title: association.sourceEntry.split("/").at(-1)!,
          content,
          range: declaration,
          declarationRange,
        };
        const document: JavaLibraryDocument = {
          uri: definition.resourceUri,
          title: definition.title,
          content: definition.content,
          association,
          scope: selectedScope,
        };
        approved.current.set(cursor.requestId, {
          definition,
          document,
          request,
          ...(sdkRequest ? { platformRequest: sdkRequest } : {}),
          guard,
          ownsRequest,
        });
        return structuredClone(definition);
      } catch (error) {
        recordDefinitionEvidence({
          event: "failure",
          requestId: cursor.requestId,
          stage,
          ...(providerStatus ? { providerStatus } : {}),
          ...(providerReasonCode ? { providerReasonCode } : {}),
        });
        if (ownsRequest())
          setMessage(
            error instanceof Error ? error.message : "Dependency declarations are unavailable.",
          );
        return null;
      } finally {
        if (pendingDefinitions.current.get(cursor.requestId) === operation)
          pendingDefinitions.current.delete(cursor.requestId);
        if (
          definitionOperations.current.get(cursor.requestId) === operation &&
          !approved.current.has(cursor.requestId)
        )
          definitionOperations.current.delete(cursor.requestId);
        if (id === sequence.current && selectedScope === scope(latest.current))
          setBusy(pendingDefinitions.current.size > 0);
      }
    },
    [captureSelectedCursor],
  );

  const openDefinition = useCallback(
    async (requestId: string, range: LanguageRange): Promise<boolean> => {
      const prepared = approved.current.get(requestId);
      if (!prepared) return false;
      try {
        prepared.guard();
        if (!validTextRange(prepared.document.content, range, true))
          throw new Error(
            "The requested source selection is outside the captured library document.",
          );
        if (prepared.platformRequest) {
          const request: JavaPlatformSourceReadRequest = {
            ...prepared.platformRequest,
            requestId: `${prepared.platformRequest.requestId}-open`,
            expectedAssociationHash: prepared.document.association.associationHash,
          };
          const read = await latest.current.platformPort.read(request);
          prepared.guard();
          platformAvailable(read, request, "read");
          if (
            read.content !== prepared.document.content ||
            JSON.stringify(read.association) !== JSON.stringify(prepared.document.association)
          )
            throw new Error("The JDK source changed before its declaration could be opened.");
        } else {
          const request = {
            ...prepared.request,
            requestId: `${prepared.request.requestId}-open`,
            expectedAssociationHash: prepared.document.association.associationHash,
          };
          const read = await latest.current.port.read(request);
          prepared.guard();
          available(read, request, "read");
          if (
            read.content !== prepared.document.content ||
            JSON.stringify(read.association) !== JSON.stringify(prepared.document.association)
          )
            throw new Error(
              "The dependency attachment changed before its declaration could be opened.",
            );
        }
        publish(prepared.document, range);
        approved.current.delete(requestId);
        const operation = definitionOperations.current.get(requestId);
        if (operation) operation.cancelled = true;
        definitionOperations.current.delete(requestId);
        return true;
      } catch (error) {
        if (prepared.ownsRequest())
          setMessage(
            error instanceof Error
              ? error.message
              : "The dependency declaration could not be opened.",
          );
        approved.current.delete(requestId);
        const operation = definitionOperations.current.get(requestId);
        if (operation) operation.cancelled = true;
        definitionOperations.current.delete(requestId);
        return false;
      }
    },
    [publish],
  );

  const cancelDefinition = useCallback((requestId: string) => {
    approved.current.delete(requestId);
    const operation = definitionOperations.current.get(requestId);
    if (operation) operation.cancelled = true;
    definitionOperations.current.delete(requestId);
    const wasPending = pendingDefinitions.current.has(requestId);
    pendingDefinitions.current.delete(requestId);
    if (operation || wasPending) setBusy(pendingDefinitions.current.size > 0);
  }, []);

  const visibleDocuments = documents.filter((document) => document.scope === currentScope);
  const activeDocument = visibleDocuments.find((document) => document.uri === activeUri) ?? null;
  return {
    documents: visibleDocuments,
    activeDocument,
    busy,
    message,
    openAtCursor,
    showWorkspace,
    select,
    close,
    queryDefinition,
    openDefinition,
    cancelDefinition,
    revealRequest:
      activeDocument && revealRequest?.filePath === activeDocument.uri ? revealRequest : null,
  };
}
