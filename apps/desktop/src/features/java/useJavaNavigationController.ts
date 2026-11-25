import {
  javaNavigationRefusal,
  type JavaNavigationLocation,
  type JavaNavigationRequest,
  type JavaNavigationResult,
  type JavaEffectiveProjectContext,
  type JavaProjectOperationContext,
  type JavaProjectContextSettings,
} from "@ide/contracts";
import type { EditorViewModel, JavaNavigationPort } from "@ide/web-core";
import type { JavaEditorNavigation } from "@ide/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Dependencies {
  port: JavaNavigationPort;
  workspaceId: string | null;
  generation: number;
  getContext(): { workspaceId: string | null; generation: number; isSwitching: boolean };
  getEditorState(): { contents: Record<string, string> };
  getProjectContext?(): {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
  };
  onProjectContextRetired?(message: string): void;
  editor: Pick<EditorViewModel, "reviewSavedBuffers" | "captureEditorBuffers" | "bufferLifetime">;
  navigate(
    location: JavaNavigationLocation,
    canReveal: (afterOpen: boolean) => boolean,
  ): Promise<boolean>;
}

function projectAuthority(dependencies: Dependencies): JavaProjectOperationContext | undefined {
  const selected = dependencies.getProjectContext?.();
  if (!selected?.settings.sdkHome.trim()) return undefined;
  if (!selected.context || selected.context.status !== "available")
    throw new Error(
      "Synchronize an effective Java project context before navigating with the selected project JDK.",
    );
  return {
    ...structuredClone(selected.settings),
    contextSchemaVersion: selected.context.schemaVersion,
    snapshotHash: selected.context.snapshotHash,
    contextHash: selected.context.contextHash,
    platformIdentities: selected.context.sdk.map((sdk) => sdk.identitySha256),
  };
}

function recordNavigationLifecycleEvidence(entry: Record<string, unknown>): void {
  if (typeof document === "undefined") return;
  const body = document.body;
  if (!body?.hasAttribute("data-native-java-navigation-diagnostics")) return;
  const attribute = "data-java-navigation-lifecycle-history";
  let history: Array<Record<string, unknown>> = [];
  try {
    const value = JSON.parse(body.getAttribute(attribute) ?? "[]");
    if (Array.isArray(value)) history = value;
  } catch {
    history = [];
  }
  history.push(entry);
  body.setAttribute(attribute, JSON.stringify(history.slice(-16)));
}

interface ReviewedNavigation {
  request: JavaNavigationRequest;
  result: Extract<JavaNavigationResult, { status: "ready" }>;
  verifyBuffers(): void;
  sourceLifetime: symbol | undefined;
}

/** SDK queries preserve Java drafts; navigation revokes edited or replaced buffers. */
export function useJavaNavigationController(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const approved = useRef(new Map<string, ReviewedNavigation>());
  const pending = useRef(new Map<string, symbol>());
  const messageRequest = useRef<string | null>(null);
  const lifecycle = useRef(0);
  const [message, setMessage] = useState<string | null>(null);
  const contextMatches = useCallback(
    (request: Pick<JavaNavigationRequest, "workspaceId" | "generation" | "projectContext">) => {
      const context = latest.current.getContext();
      let project: JavaProjectOperationContext | undefined;
      try {
        project = projectAuthority(latest.current);
      } catch {
        return false;
      }
      return (
        !context.isSwitching &&
        context.workspaceId === request.workspaceId &&
        context.generation === request.generation &&
        JSON.stringify(project) === JSON.stringify(request.projectContext)
      );
    },
    [],
  );

  useEffect(() => {
    lifecycle.current += 1;
    approved.current.clear();
    pending.current.clear();
    messageRequest.current = null;
    setMessage(null);
    const { workspaceId, generation, port } = dependencies;
    return () => {
      lifecycle.current += 1;
      approved.current.clear();
      pending.current.clear();
      messageRequest.current = null;
      if (workspaceId) void port.stop({ workspaceId, generation }).catch(() => undefined);
    };
  }, [dependencies.workspaceId, dependencies.generation, dependencies.port]);

  const cancel = useCallback((requestId: string) => {
    const wasPending = pending.current.has(requestId);
    recordNavigationLifecycleEvidence({
      event: "cancel",
      atMs: Math.round(performance.now()),
      requestId,
      wasPending,
    });
    pending.current.delete(requestId);
    if (wasPending) void latest.current.port.cancel(requestId).catch(() => undefined);
    approved.current.delete(requestId);
    if (messageRequest.current === requestId) {
      messageRequest.current = null;
      setMessage(null);
    }
  }, []);

  const query = useCallback(
    async (editorRequest: JavaNavigationRequest): Promise<JavaNavigationResult> => {
      let request: JavaNavigationRequest;
      try {
        const project = projectAuthority(latest.current);
        if (
          project?.projectPath &&
          !editorRequest.document.path.startsWith(`${project.projectPath}/`)
        )
          throw new Error(
            "This Java source is outside the selected project. Select and synchronize its project before navigating.",
          );
        request = { ...editorRequest, projectContext: project };
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "The selected Java project context is unavailable.";
        setMessage(reason);
        return javaNavigationRefusal(editorRequest, "refused", reason);
      }
      const epoch = lifecycle.current;
      const identity = Symbol(request.requestId);
      pending.current.set(request.requestId, identity);
      approved.current.delete(request.requestId);
      recordNavigationLifecycleEvidence({
        event: "request",
        atMs: Math.round(performance.now()),
        requestId: request.requestId,
        kind: request.kind,
        hasProjectContext: !!request.projectContext,
      });
      const current = () =>
        epoch === lifecycle.current &&
        pending.current.get(request.requestId) === identity &&
        contextMatches(request);
      const publish = (value: string | null) => {
        if (current() && messageRequest.current === request.requestId) setMessage(value);
      };
      const refuse = (reason: string) => {
        publish(reason);
        return javaNavigationRefusal(request, "refused", reason);
      };
      try {
        if (!current()) return refuse("The Java workspace changed; retry from the current editor.");
        messageRequest.current = request.requestId;
        if (
          latest.current.getEditorState().contents[request.document.path] !== request.document.text
        )
          return refuse("The Java editor changed; retry from the current cursor.");
        let verifyBuffers: () => void;
        try {
          const capture = request.projectContext
            ? latest.current.editor.captureEditorBuffers()
            : undefined;
          const documents = capture?.documents.filter(
            (document) =>
              document.path.endsWith(".java") &&
              (!request.projectContext?.projectPath ||
                document.path.startsWith(`${request.projectContext.projectPath}/`)),
          );
          if (capture) {
            if (documents?.some((document) => document.isDirty))
              request.editorOverlay = {
                documents: documents.map(({ path, text, version }) => ({ path, text, version })),
              };
            verifyBuffers = capture.verify;
          } else verifyBuffers = latest.current.editor.reviewSavedBuffers();
        } catch {
          return refuse(
            "Save all editor buffers and wait for file operations before Java binding navigation.",
          );
        }
        const operation = {
          definition: "definition",
          references: "references",
          typeDefinition: "type definition",
          typeHierarchy: "type hierarchy",
          callHierarchy: "call hierarchy",
          implementations: "implementations",
        }[request.kind];
        publish(`Resolving Java ${operation}…`);
        let result: JavaNavigationResult;
        const portStarted = performance.now();
        recordNavigationLifecycleEvidence({
          event: "port-query-start",
          atMs: Math.round(portStarted),
          requestId: request.requestId,
        });
        try {
          result = await latest.current.port.query(request);
          recordNavigationLifecycleEvidence({
            event: "port-query-resolved",
            atMs: Math.round(performance.now()),
            requestId: request.requestId,
            elapsedMs: Math.round(performance.now() - portStarted),
            status: result.status,
          });
        } catch (error) {
          recordNavigationLifecycleEvidence({
            event: "port-query-rejected",
            atMs: Math.round(performance.now()),
            requestId: request.requestId,
            elapsedMs: Math.round(performance.now() - portStarted),
            error:
              error instanceof Error
                ? `${error.name}: ${error.message}`.slice(0, 512)
                : String(error).slice(0, 512),
          });
          return refuse(
            "The RefactorKit Java navigation provider is unavailable or returned invalid evidence.",
          );
        }
        if (!current()) {
          recordNavigationLifecycleEvidence({
            event: "request-not-current",
            atMs: Math.round(performance.now()),
            requestId: request.requestId,
            lifecycleCurrent: epoch === lifecycle.current,
            pendingRequestCurrent: pending.current.get(request.requestId) === identity,
            contextCurrent: contextMatches(request),
          });
          return refuse("The Java navigation request is no longer current.");
        }
        if (
          result.requestId !== request.requestId ||
          result.workspaceId !== request.workspaceId ||
          result.generation !== request.generation ||
          result.kind !== request.kind ||
          result.documentPath !== request.document.path ||
          result.documentVersion !== request.document.version
        )
          return refuse("RefactorKit returned a Java location for another editor request.");
        if (result.status !== "ready") {
          publish(result.message);
          if (result.projectContextRetired && request.projectContext)
            latest.current.onProjectContextRetired?.(result.message);
          return result;
        }
        try {
          verifyBuffers();
        } catch {
          return refuse("Editor buffers changed during Java navigation; retry after saving.");
        }
        if (
          request.projectContext &&
          (result.snapshotHash !== request.projectContext.snapshotHash ||
            result.projectContext?.projectPath !== request.projectContext.projectPath ||
            result.projectContext?.contextHash !== request.projectContext.contextHash ||
            result.projectContext?.contextSchemaVersion !==
              (request.projectContext.contextSchemaVersion ?? "java-project-context-v1") ||
            JSON.stringify(result.projectContext?.platformIdentities) !==
              JSON.stringify(request.projectContext.platformIdentities))
        )
          return refuse("RefactorKit did not attest the selected Java project and SDK context.");
        if (
          request.editorOverlay &&
          (!result.editorOverlay ||
            result.editorOverlay.baseSnapshotHash !== request.projectContext?.snapshotHash ||
            result.editorOverlay.documents.length !== request.editorOverlay.documents.length ||
            request.editorOverlay.documents.some(
              (document) =>
                !result.editorOverlay!.documents.some(
                  (actual) => actual.path === document.path && actual.version === document.version,
                ),
            ))
        )
          return refuse("RefactorKit did not attest the immutable Java editor buffers.");
        approved.current.set(request.requestId, {
          request,
          result,
          verifyBuffers,
          sourceLifetime: latest.current.editor.bufferLifetime(request.document.path),
        });
        while (approved.current.size > 2)
          approved.current.delete(approved.current.keys().next().value!);
        if (result.truncated || !result.complete || result.warningCount > 0)
          publish(
            `RefactorKit returned ${result.returned} of ${result.total} ${
              {
                definition: "definitions",
                references: "references",
                typeDefinition: "type definitions",
                typeHierarchy: "Java type hierarchy entries",
                callHierarchy: "Java call hierarchy entries",
                implementations: "Java implementations",
              }[request.kind]
            }${result.warningCount ? ` with ${result.warningCount} analysis warnings` : ""}. Additional results or incomplete analysis may remain.`,
          );
        else if (result.locations.length === 0)
          publish(`No Java ${operation} found at this position.`);
        else publish(null);
        return result;
      } finally {
        if (pending.current.get(request.requestId) === identity)
          pending.current.delete(request.requestId);
      }
    },
    [contextMatches],
  );

  const openLocation = useCallback(
    async (requestId: string, location: JavaNavigationLocation): Promise<boolean> => {
      const review = approved.current.get(requestId);
      if (!review || !contextMatches(review.request)) return false;
      const target = review.result.sourceFiles.find((file) => file.path === location.path);
      if (!target) return false;
      let verifyExistingBuffers: () => void;
      try {
        review.verifyBuffers();
        verifyExistingBuffers = review.request.projectContext
          ? latest.current.editor.captureEditorBuffers({ allowNewBuffers: true }).verify
          : latest.current.editor.reviewSavedBuffers({ allowNewBuffers: true });
      } catch {
        setMessage("Editor buffers changed after Java navigation; resolve the location again.");
        return false;
      }
      const canReveal = (afterOpen: boolean) => {
        try {
          verifyExistingBuffers();
        } catch {
          return false;
        }
        return (
          approved.current.get(requestId) === review &&
          contextMatches(review.request) &&
          latest.current.editor.bufferLifetime(review.request.document.path) ===
            review.sourceLifetime &&
          latest.current.getEditorState().contents[review.request.document.path] ===
            review.request.document.text &&
          ((!afterOpen &&
            !Object.hasOwn(latest.current.getEditorState().contents, location.path)) ||
            latest.current.getEditorState().contents[location.path] === target.text)
        );
      };
      let opened = false;
      try {
        opened = await latest.current.navigate(location, canReveal);
      } catch {
        /* An opener failure cannot authorize a reveal. */
      }
      if (!opened && approved.current.get(requestId) === review && contextMatches(review.request))
        setMessage(
          "The Java target changed or could not be opened. Compare open buffers with disk, then resolve the location again.",
        );
      return opened;
    },
    [contextMatches],
  );

  const navigation = useMemo<JavaEditorNavigation | undefined>(
    () =>
      dependencies.workspaceId
        ? {
            context: { workspaceId: dependencies.workspaceId, generation: dependencies.generation },
            query,
            cancel,
            openLocation,
          }
        : undefined,
    [dependencies.workspaceId, dependencies.generation, query, cancel, openLocation],
  );
  return { navigation, message };
}
