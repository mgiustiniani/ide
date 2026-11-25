import type {
  RefactorApplyRequest,
  RefactorApplyResult,
  RefactorKitCapabilities,
  RefactorKitChangeIntent,
  RefactorKitAffectedFile,
  RefactorKitTypedReferenceLocation,
  RefactorPreviewRequest,
  RefactorPreviewResult,
  RefactorRollbackRequest,
  RefactorRollbackResult,
  RefactoringOperation,
  RefactoringTarget,
  JavaProjectOperationContext,
  JavaProjectContextSettings,
  JavaEffectiveProjectContext,
  JavaEditorTransaction,
  JavaFormatterProfile,
} from "@ide/contracts";
import {
  validateRefactorChangeIntent,
  javaRefactoringFormatsFiles,
  captureJavaProjectOperationContext,
  sameJavaProjectOperationContext,
  sameJavaProjectContextSettings,
  javaProjectContextAttestationMatches,
  javaContextRefactoringOffered,
  javaSafeDeleteReferenceAnalysisQualified,
  javaRefactoringMutationAuthorized,
  javaEditorRefactoringPreviewOffered,
  javaEditorMutationOffered,
  javaMutationSelectionOffered,
} from "@ide/contracts";
import type { RefactorKitPort, EditorViewModel, JavaEditorRefactoringOutcome } from "@ide/web-core";
import {
  executeJavaEditorRefactoring,
  JavaEditorTransactionError,
  JavaProjectContextRetiredError,
  RefactorRollbackNotStartedError,
} from "@ide/web-core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  javaRefactoringTargetKind,
  supportsJavaRefactoringTarget,
} from "./javaRefactoringAvailability";

export type JavaRefactoringDialogStatus =
  | "idle"
  | "loading"
  | "unavailable"
  | "refused"
  | "preview"
  | "applying"
  | "applied"
  | "rollback-refused"
  | "undone"
  | "rolled-back"
  | "error";

export const JAVA_REFACTORING_UNAVAILABLE =
  "Update RefactorKit to a version that advertises general Java refactoring.";
export const JAVA_REFACTORING_CAPABILITIES_UNKNOWN =
  "Unable to determine RefactorKit capability discovery.";
export const JAVA_REFACTORING_OPERATION_NOT_OFFERED =
  "RefactorKit does not advertise this Java refactoring operation.";
export const JAVA_REFACTORING_ROLLBACK_NOT_OFFERED =
  "RefactorKit does not advertise rollback for this transaction class.";
export const JAVA_REFACTORING_STALE_SELECTION =
  "RefactorKit returned a plan for a stale workspace selection.";
export const JAVA_REFACTORING_STALE_CONTEXT =
  "The selected Java project context changed. Synchronize the project and preview again.";
export const JAVA_SAFE_DELETE_REFERENCE_ANALYSIS_UNAVAILABLE =
  "Apply is unavailable because RefactorKit has not qualified complete project-wide reference analysis for safe delete, including build and resource files.";

/** Internal workspace/request context carried by every live Java refactoring dialog. */
export interface JavaRefactoringSelection {
  editorMutationMode?: "durable-editor-owned";
  editorDirtyPaths?: string[];
  editorOverlay?: RefactorPreviewRequest["editorOverlay"];
  projectContext?: JavaProjectOperationContext;
  formatterProfile?: JavaFormatterProfile;
  operation: RefactoringOperation;
  target: RefactoringTarget;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
  changeIntent?: RefactorKitChangeIntent;
}

export interface JavaRefactoringDialogState {
  status: JavaRefactoringDialogStatus;
  operation: RefactoringOperation;
  target: RefactoringTarget;
  selection: JavaRefactoringSelection | null;
  /** Backend-produced immutable preview plan; presented read-only with no apply authority. */
  plan: RefactorPreviewResult | null;
  result: RefactorApplyResult | null;
  rollback: RefactorRollbackResult | null;
  editorTransaction?: JavaEditorTransaction;
  changeIntent?: RefactorKitChangeIntent;
  /** Exact cursor captured when an editor action opened the dialog. */
  editorCursor?: { path: string; line: number; column: number };
  /** Saved editor text captured when a selection-bound review action is invoked. */
  editorSelectionSnapshot?: { path: string; text: string };
  message?: string;
}

export interface UseJavaRefactoringControllerDependencies {
  refactorKit: RefactorKitPort;
  /** Authoritative capability advertisement from the shared RefactorKit status controller. */
  capabilities: RefactorKitCapabilities | null;
  workspaceId: string | null;
  /** Uses the application workspace authority when supplied; standalone consumers keep a local generation. */
  getWorkspaceGeneration?: () => number;
  getProjectContext?(): {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
  };
  /** Current workspace formatter selection; native code reads the XML itself. */
  getJavaFormatterProfile?(): JavaFormatterProfile | undefined;
  /** Capture clean editor buffers; the returned check rejects edits and tab replacement. */
  reviewSavedBuffers?(options?: { allowNewBuffers?: boolean }): () => void;
  captureEditorBuffers?(): {
    documents: { path: string; text: string; version: number; isDirty: boolean }[];
    verify(): void;
  };
  getCursorPosition?(path: string): { line: number; column: number } | null;
  /** Prevent source saves and buffer replacement until the provider write has finished. */
  beginWorkspaceWrite?(): () => void;
  beginEditorTransaction?(): ReturnType<EditorViewModel["beginEditorTransaction"]>;
  onEditorSourceChanged?(): void;
  reconcileEditorBuffers?(
    changes: JavaEditorRefactoringOutcome["changes"],
    isCurrent: () => boolean,
  ): Promise<string | undefined>;
  /** Retire saved context after a confirmed write or an unknown write outcome. */
  onSourceChanged?(): void;
  /** Retire the displayed project context when the provider proves its snapshot stale. */
  onProjectContextStale?(): void;
  /** Refresh affected clean buffers and language documents while the write guard is held. */
  reconcileChanges?(
    changes: readonly RefactorKitAffectedFile[],
    isCurrent: () => boolean,
  ): Promise<string | undefined>;
}

export interface JavaRefactoringController {
  dialog: JavaRefactoringDialogState | null;
  successMessage: string | null;
  isWriting: boolean;
  canReopenApplied: boolean;
  /** Reopens the last closed saved-source result; it grants no new mutation authority. */
  reopenApplied(): boolean;
  open(
    operation: RefactoringOperation,
    target: RefactoringTarget,
    editorCursor?: { path: string; line: number; column: number },
    changeIntent?: RefactorKitChangeIntent,
    editorSelectionSnapshot?: { path: string; text: string },
  ): void;
  setOperation(operation: RefactoringOperation): void;
  setTarget(target: RefactoringTarget): void;
  setChangeIntent(intent: RefactorKitChangeIntent | undefined): void;
  /** Capability-before-offer: refuses before any native call when the capability is not advertised. */
  preview(): Promise<void>;
  openPreviewReference(
    plan: RefactorPreviewResult,
    location: RefactorKitTypedReferenceLocation,
    navigate: (
      location: RefactorKitTypedReferenceLocation,
      isCurrent: () => boolean,
    ) => Promise<boolean>,
  ): Promise<void>;
  /** Applies only the exact reviewed plan under explicit authority bound to that plan. */
  applyDisplayedPlan(plan: RefactorPreviewResult): Promise<void>;
  /** Rolls back only when rollback is advertised AND the result carries a correlated transaction. */
  rollback(result: RefactorApplyResult): Promise<void>;
  undoEditorTransaction(): Promise<void>;
  recoverEditorTransaction(): Promise<void>;
  /** Discards the retained backend plan without applying it. */
  discardDisplayedPlan(): void;
  cancel(): void;
  resetWorkspace(): void;
}

function previewRequest(selection: JavaRefactoringSelection): RefactorPreviewRequest {
  return {
    operation: selection.operation,
    target: selection.target,
    authority: {
      workspaceId: selection.workspaceId,
      workspaceGeneration: selection.workspaceGeneration,
    },
    selectionGeneration: selection.selectionGeneration,
    requestId: selection.requestId,
    ...(selection.changeIntent ? { changeIntent: structuredClone(selection.changeIntent) } : {}),
    ...(selection.projectContext ? { projectContext: selection.projectContext } : {}),
    ...(selection.formatterProfile ? { formatterProfile: selection.formatterProfile } : {}),
    ...(selection.editorOverlay ? { editorOverlay: selection.editorOverlay } : {}),
    ...(selection.editorMutationMode ? { editorMutationMode: selection.editorMutationMode } : {}),
  };
}

function discardRequest(plan: RefactorPreviewResult): {
  planId: string;
  requestId: string;
  selectionGeneration: number;
} & {
  workspaceId: string;
  workspaceGeneration: number;
} {
  return {
    planId: plan.planId,
    workspaceId: plan.authority.workspaceId,
    workspaceGeneration: plan.authority.workspaceGeneration,
    selectionGeneration: plan.selectionGeneration,
    requestId: plan.requestId,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "RefactorKit operation failed.";
}

function isFileLocalOperation(operation: RefactoringOperation): boolean {
  return operation === "format-file" || operation === "organize-imports";
}

function captureOperationProjectContext(
  operation: RefactoringOperation,
  capabilities: RefactorKitCapabilities | null,
  selected:
    | {
        settings: JavaProjectContextSettings;
        context: JavaEffectiveProjectContext | null;
      }
    | undefined,
): JavaProjectOperationContext | undefined {
  const allowPartialMavenContext =
    operation === "create-maven-module" &&
    selected?.context?.status === "partial" &&
    selected.context.modules.some((module) => module.providerId === "maven-effective-v1");
  const allowPartialGradleContext =
    (operation === "create-gradle-module" || operation === "rename-gradle-module") &&
    selected?.context?.status === "partial" &&
    selected.context.modules.some((module) => module.providerId === "gradle-effective-v1");
  if (
    isFileLocalOperation(operation) &&
    selected?.settings.sdkHome.trim() &&
    (selected.context?.status !== "available" ||
      !javaContextRefactoringOffered(capabilities, operation, "preview"))
  )
    return undefined;
  if (
    (operation === "extract-method" ||
      operation === "extract-interface" ||
      operation === "extract-superclass" ||
      operation === "pull-up-member" ||
      operation === "push-down-member" ||
      operation === "move-member" ||
      operation === "inline-method" ||
      operation === "introduce-parameter-object" ||
      operation === "extract-delegate" ||
      operation === "inline-variable" ||
      operation === "inline-constant") &&
    (!selected?.settings.sdkHome.trim() ||
      selected.context?.status !== "available" ||
      !javaContextRefactoringOffered(capabilities, operation, "preview"))
  )
    return undefined;
  return captureJavaProjectOperationContext(selected, {
    allowPartialContext: allowPartialMavenContext || allowPartialGradleContext,
  });
}

/**
 * Desktop application orchestration for the capability-gated general Java
 * refactoring flow (rename / move / change-method-signature / safe-delete).
 * Preview is read-only and grants no apply authority; Apply binds to the exact
 * reviewed plan under explicit authority; Rollback is exposed only when the
 * provider advertises the transaction class and the result carries a correlated
 * transaction. No native API is imported here; native access is injected via the
 * RefactorKitPort adapter.
 */
export function useJavaRefactoringController(
  dependencies: UseJavaRefactoringControllerDependencies,
): JavaRefactoringController {
  const workspaceIdRef = useRef(dependencies.workspaceId);
  workspaceIdRef.current = dependencies.workspaceId;
  const capabilitiesRef = useRef(dependencies.capabilities);
  capabilitiesRef.current = dependencies.capabilities;
  const workspaceGenerationAuthorityRef = useRef(dependencies.getWorkspaceGeneration);
  workspaceGenerationAuthorityRef.current = dependencies.getWorkspaceGeneration;

  const localWorkspaceGenerationRef = useRef(1);
  const currentWorkspaceGeneration = useCallback(
    () => workspaceGenerationAuthorityRef.current?.() ?? localWorkspaceGenerationRef.current,
    [],
  );
  const selectionGenerationRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const operationRef = useRef(0);

  const [dialog, setDialog] = useState<JavaRefactoringDialogState | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isWriting, setIsWriting] = useState(false);
  const writeInFlightRef = useRef(false);
  const editorReviewRef = useRef<(() => void) | null>(null);
  const editorDependenciesRef = useRef(dependencies);
  editorDependenciesRef.current = dependencies;
  const dialogRef = useRef<JavaRefactoringDialogState | null>(null);
  dialogRef.current = dialog;
  const dialogProviderRef = useRef(dependencies.refactorKit);
  const mountedRef = useRef(true);
  const retainedAppliedRef = useRef<{
    state: JavaRefactoringDialogState;
    provider: RefactorKitPort;
  } | null>(null);
  const retainedIsCurrent = useCallback(() => {
    const retained = retainedAppliedRef.current;
    return Boolean(
      mountedRef.current &&
      retained?.state.selection &&
      retained.provider === editorDependenciesRef.current.refactorKit &&
      retained.state.selection.workspaceId === workspaceIdRef.current &&
      retained.state.selection.workspaceGeneration === currentWorkspaceGeneration(),
    );
  }, [currentWorkspaceGeneration]);
  const projectMatches = useCallback((selection: JavaRefactoringSelection): boolean => {
    try {
      if (
        javaRefactoringFormatsFiles(selection.operation, selection.changeIntent) &&
        JSON.stringify(selection.formatterProfile) !==
          JSON.stringify(editorDependenciesRef.current.getJavaFormatterProfile?.())
      )
        return false;
      return sameJavaProjectOperationContext(
        selection.projectContext,
        captureOperationProjectContext(
          selection.operation,
          capabilitiesRef.current,
          editorDependenciesRef.current.getProjectContext?.(),
        ),
      );
    } catch {
      return false;
    }
  }, []);

  /** Discards any retained/in-flight backend plan and optionally closes the dialog. */
  const invalidate = useCallback(
    (closeDialog: boolean): void => {
      operationRef.current += 1;
      editorReviewRef.current = null;
      const current = dialogRef.current;
      if (
        closeDialog &&
        !writeInFlightRef.current &&
        current?.selection &&
        current.result?.transactionId &&
        !current.editorTransaction &&
        (current.status === "applied" || current.status === "rollback-refused") &&
        dialogProviderRef.current === editorDependenciesRef.current.refactorKit &&
        current.selection.workspaceId === workspaceIdRef.current &&
        current.selection.workspaceGeneration === currentWorkspaceGeneration()
      ) {
        retainedAppliedRef.current = {
          state: structuredClone(current),
          provider: dialogProviderRef.current,
        };
      }
      if (closeDialog) setDialog(null);
      if (
        current?.plan?.planId &&
        current.status !== "applied" &&
        current.status !== "rollback-refused" &&
        current.status !== "rolled-back"
      ) {
        void dependencies.refactorKit
          .discardRefactoring(discardRequest(current.plan))
          .catch(() => undefined);
      }
    },
    [dependencies.refactorKit, currentWorkspaceGeneration],
  );

  const retainedGeneration = currentWorkspaceGeneration();
  useEffect(() => {
    if (!retainedIsCurrent()) retainedAppliedRef.current = null;
  }, [dependencies.workspaceId, dependencies.refactorKit, retainedGeneration, retainedIsCurrent]);
  const reopenApplied = useCallback(() => {
    if (writeInFlightRef.current || dialogRef.current || !retainedIsCurrent()) return false;
    const retained = retainedAppliedRef.current!;
    retainedAppliedRef.current = null;
    dialogProviderRef.current = retained.provider;
    setDialog(structuredClone(retained.state));
    return true;
  }, [retainedIsCurrent]);

  const formatterProfileKey = JSON.stringify(
    editorDependenciesRef.current.getJavaFormatterProfile?.() ?? null,
  );
  useEffect(() => {
    const selection = dialogRef.current?.selection;
    if (
      selection && javaRefactoringFormatsFiles(selection.operation, selection.changeIntent) &&
      JSON.stringify(selection.formatterProfile ?? null) !== formatterProfileKey
    )
      invalidate(true);
  }, [formatterProfileKey, invalidate]);

  const open = useCallback(
    (
      operation: RefactoringOperation,
      target: RefactoringTarget,
      editorCursor?: { path: string; line: number; column: number },
      changeIntent?: RefactorKitChangeIntent,
      editorSelectionSnapshot?: { path: string; text: string },
    ): void => {
      invalidate(true);
      dialogProviderRef.current = editorDependenciesRef.current.refactorKit;
      setSuccessMessage(null);
      setDialog({
        status: "idle",
        operation,
        target,
        ...(changeIntent ? { changeIntent: structuredClone(changeIntent) } : {}),
        selection: null,
        plan: null,
        result: null,
        rollback: null,
        ...(editorSelectionSnapshot ? { editorSelectionSnapshot } : {}),
        ...(editorCursor && editorCursor.path === target.path ? { editorCursor } : {}),
      });
    },
    [invalidate],
  );

  const setOperation = useCallback((operation: RefactoringOperation): void => {
    setDialog((current) => {
      if (!current || current.status !== "idle") return current;
      const targetKind = javaRefactoringTargetKind(operation);
      const isCursorRename =
        current.target.identity === "@cursor" &&
        (operation === "rename-class" ||
          operation === "rename-member" ||
          operation === "add-method-parameter" ||
          operation === "remove-method-parameter" ||
          operation === "change-method-signature" ||
          operation === "change-method-parameter-type" ||
          operation === "reorder-method-parameters" ||
          operation === "make-static" ||
          operation === "make-public" ||
          operation === "change-field-type" ||
          operation === "inline-method" ||
          operation === "introduce-parameter-object" ||
          operation === "extract-delegate" ||
          operation === "pull-up-member" ||
          operation === "push-down-member" ||
          operation === "move-member");
      const target: RefactoringTarget =
        current.target.kind === targetKind
          ? current.target
          : isCursorRename
            ? { ...current.target, kind: targetKind }
            : targetKind === "file" || targetKind === "source-root"
              ? { kind: targetKind, path: current.target.path, identity: current.target.path }
              : { kind: targetKind, path: current.target.path, identity: "" };
      return {
        ...current,
        operation,
        target,
        changeIntent: undefined,
        message: undefined,
      };
    });
  }, []);

  const setTarget = useCallback((target: RefactoringTarget): void => {
    setDialog((current) => {
      if (!current || current.status !== "idle") return current;
      if (!supportsJavaRefactoringTarget(current.operation, target.kind)) return current;
      return { ...current, target, message: undefined };
    });
  }, []);

  const setChangeIntent = useCallback((intent: RefactorKitChangeIntent | undefined): void => {
    setDialog((current) => {
      if (!current || current.status !== "idle") return current;
      return {
        ...current,
        changeIntent: intent ? structuredClone(intent) : undefined,
        message: undefined,
      };
    });
  }, []);

  const preview = useCallback(async (): Promise<void> => {
    const current = dialogRef.current;
    if (!current || current.status !== "idle") return;
    if (!supportsJavaRefactoringTarget(current.operation, current.target.kind)) {
      setDialog({
        ...current,
        status: "refused",
        message: `This refactoring requires a ${javaRefactoringTargetKind(current.operation)} target.`,
      });
      return;
    }
    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) return;

    let projectContext: JavaProjectOperationContext | undefined;
    try {
      projectContext = captureOperationProjectContext(
        current.operation,
        capabilitiesRef.current,
        editorDependenciesRef.current.getProjectContext?.(),
      );
      if (
        [
          "batch-cleanup",
          "extract-constant",
          "extract-variable",
          "inline-variable",
          "inline-method",
          "introduce-parameter-object",
          "extract-delegate",
          "inline-constant",
          "extract-method",
          "extract-interface",
          "extract-superclass",
          "pull-up-member",
          "push-down-member",
          "move-member",
          "extract-parameter",
          "extract-field",
          "encapsulate-field",
          "change-field-type",
        ].includes(current.operation) &&
        !projectContext
      )
        throw new Error(
          `${current.operation} requires a synchronized Java project and selected JDK.`,
        );
      if (
        current.operation !== "create-gradle-module" &&
        current.operation !== "rename-gradle-module" &&
        projectContext?.projectPath &&
        !current.target.path.startsWith(`${projectContext.projectPath}/`)
      )
        throw new Error(
          "This Java source is outside the selected project. Select and synchronize its project before refactoring.",
        );
    } catch (error) {
      setDialog({ ...current, status: "refused", message: errorMessage(error) });
      return;
    }

    let editorOverlay: RefactorPreviewRequest["editorOverlay"];
    let capturedReview: (() => void) | undefined;
    let editorDirtyPaths: string[] | undefined;
    const formatterProfile = projectContext && javaRefactoringFormatsFiles(current.operation, current.changeIntent)
      ? editorDependenciesRef.current.getJavaFormatterProfile?.()
      : undefined;
    try {
      const capture = projectContext
        ? editorDependenciesRef.current.captureEditorBuffers?.()
        : undefined;
      const documents = capture?.documents.filter(
        (d) =>
          d.path.endsWith(".java") &&
          (!projectContext?.projectPath || d.path.startsWith(`${projectContext.projectPath}/`)),
      );
      const cursorSelection = current.target.identity === "@cursor";
      const savedMemberRename =
        current.operation === "rename-member" &&
        cursorSelection &&
        current.target.selection !== undefined &&
        capture !== undefined &&
        !capture.documents.some((document) => document.isDirty) &&
        javaMutationSelectionOffered(capabilitiesRef.current) &&
        javaContextRefactoringOffered(capabilitiesRef.current, "rename-member", "preview");
      const savedCursorMutation =
        savedMemberRename ||
        current.operation === "add-method-parameter" ||
        current.operation === "remove-method-parameter" ||
        (current.operation === "change-method-signature" &&
          current.target.identity === "@cursor") ||
        current.operation === "change-method-parameter-type" ||
        current.operation === "make-static" ||
        current.operation === "make-public" ||
        current.operation === "change-field-type" ||
        current.operation === "inline-method" ||
        current.operation === "introduce-parameter-object" ||
        current.operation === "extract-delegate" ||
        current.operation === "extract-interface" ||
        current.operation === "extract-superclass" ||
        current.operation === "pull-up-member" ||
        current.operation === "push-down-member" ||
        current.operation === "move-member" ||
        (current.operation === "reorder-method-parameters" &&
          current.target.identity === "@cursor");
      if (current.operation === "batch-cleanup") {
        if (!capture) throw new Error("The IDE cannot verify editor buffers before Java cleanup.");
        if (capture.documents.some((document) => document.isDirty))
          throw new Error("Save or discard open changes before reviewing Java cleanup.");
        const capabilities = capabilitiesRef.current?.javaContextRefactoring?.operationCapabilities
          ?.filter((entry) => entry.operation === "batchCleanup");
        if (formatterProfile && (capabilities?.length !== 1 || capabilities[0].features?.formatterProfile !== true))
          throw new Error(
            "This RefactorKit runtime does not support Java Cleanup with the selected Eclipse formatter profile. Review individual file formatting instead.",
          );
        capturedReview = capture.verify;
      } else if (
        current.operation === "create-maven-module" ||
        current.operation === "create-gradle-module" ||
        current.operation === "rename-gradle-module"
      ) {
        if (!projectContext || !capture)
          throw new Error("The IDE cannot verify editor buffers before a Java module change.");
        capturedReview = capture.verify;
        editorDirtyPaths = capture.documents
          .filter((document) => document.isDirty)
          .map(({ path }) => path);
      } else if (savedCursorMutation) {
        const snapshot = capture?.documents.find(
          (document) => document.path === current.target.path,
        );
        const capturedCursor = current.editorCursor;
        const liveCursor = editorDependenciesRef.current.getCursorPosition?.(current.target.path);
        if (
          !projectContext ||
          !capture ||
          current.target.identity !== "@cursor" ||
          !current.target.selection ||
          current.target.selection.start !== current.target.selection.end ||
          !snapshot ||
          snapshot.isDirty ||
          capture.documents.some((document) => document.isDirty) ||
          !capturedCursor ||
          capturedCursor.path !== current.target.path ||
          !liveCursor ||
          liveCursor.line !== capturedCursor.line ||
          liveCursor.column !== capturedCursor.column
        )
          throw new Error(savedMemberRename
            ? "Keep the cursor on the saved Java member and review the rename again."
            : current.operation === "introduce-parameter-object"
              ? "Save open changes and keep the cursor on the Java method before introducing a parameter object."
            : current.operation === "extract-delegate"
              ? "Save open changes and place the cursor on a method to extract into the delegate."
            :
            `Save all open Java changes and place the cursor on the ${current.operation === "change-field-type" ? "field before changing its type" : current.operation === "extract-interface" ? "class before extracting its interface" : current.operation === "extract-superclass" ? "class before extracting its superclass" : "method before " + (current.operation === "add-method-parameter" ? "adding a parameter" : current.operation === "remove-method-parameter" ? "removing a parameter" : current.operation === "change-method-signature" ? "renaming a parameter" : current.operation === "change-method-parameter-type" ? "changing a parameter type" : current.operation === "reorder-method-parameters" ? "reordering parameters" : current.operation === "pull-up-member" ? "pulling it up" : current.operation === "push-down-member" ? "pushing it down" : current.operation === "inline-method" ? "inlining it" : current.operation === "make-public" ? "making it public" : "making it static")}.`,
          );
        capturedReview = capture.verify;
      } else if (current.operation === "encapsulate-field") {
        if (
          !projectContext ||
          !capture ||
          !documents ||
          documents.some((document) => document.isDirty)
        )
          throw new Error(
            "Save open Java files in the selected project before reviewing field encapsulation.",
          );
        capturedReview = capture.verify;
      } else if (
        current.operation === "extract-constant" ||
        current.operation === "extract-variable" ||
        current.operation === "inline-variable" ||
        current.operation === "inline-constant" ||
        current.operation === "extract-method" ||
        current.operation === "extract-parameter" ||
        current.operation === "extract-field"
      ) {
        const snapshot = current.editorSelectionSnapshot;
        const source =
          snapshot && capture?.documents.find((document) => document.path === snapshot.path);
        if (
          !projectContext ||
          !current.target.selection ||
          current.target.selection.end <= current.target.selection.start ||
          !snapshot ||
          !source ||
          source.isDirty ||
          source.text !== snapshot.text ||
          capture?.documents.some((document) => document.isDirty)
        )
          throw new Error(
            `Save all open Java changes and select the expression again before reviewing ${current.operation}.`,
          );
        capturedReview = capture!.verify;
      } else if (
        !savedCursorMutation &&
        capture &&
        (documents?.some((d) => d.isDirty) || cursorSelection)
      ) {
        if (!documents) throw new Error("Open a Java source in the editor before previewing it.");
        const fileOperation =
          current.operation === "format-file" || current.operation === "organize-imports";
        const cursor =
          current.editorCursor?.path === current.target.path
            ? { line: current.editorCursor.line, column: current.editorCursor.column }
            : editorDependenciesRef.current.getCursorPosition?.(current.target.path);
        if (!fileOperation && !cursor)
          throw new Error("Place the cursor on the Java element before reviewing its draft.");
        if (cursorSelection && !documents.some((document) => document.path === current.target.path))
          throw new Error("Open the Java source in the editor before reviewing a cursor action.");
        editorOverlay = {
          documents: documents.map(({ path, text, version }) => ({ path, text, version })),
          position: cursor
            ? { line: cursor.line - 1, character: cursor.column - 1 }
            : { line: 0, character: 0 },
        };
        capturedReview = capture.verify;
        editorDirtyPaths = documents.filter((d) => d.isDirty).map((d) => d.path);
      }
    } catch (error) {
      setDialog({ ...current, message: errorMessage(error) });
      return;
    }
    const selection: JavaRefactoringSelection = {
      ...(editorOverlay &&
      editorDependenciesRef.current.beginEditorTransaction &&
      dependencies.refactorKit.editorTransaction &&
      javaEditorMutationOffered(capabilitiesRef.current, current.operation)
        ? { editorMutationMode: "durable-editor-owned" as const }
        : {}),
      editorOverlay,
      editorDirtyPaths,
      projectContext,
      ...(formatterProfile ? { formatterProfile: { ...formatterProfile } } : {}),
      operation: current.operation,
      target:
        editorOverlay && !current.target.identity
          ? { ...current.target, identity: "@cursor" }
          : current.target,
      workspaceId,
      workspaceGeneration: currentWorkspaceGeneration(),
      selectionGeneration: selectionGenerationRef.current + 1,
      requestId: `desktop-java-refactor-${++requestSequenceRef.current}`,
      changeIntent: current.changeIntent ? structuredClone(current.changeIntent) : undefined,
    };
    selectionGenerationRef.current = selection.selectionGeneration;

    const operation = ++operationRef.current;
    setSuccessMessage(null);
    setDialog({
      status: "loading",
      operation: selection.operation,
      target: selection.target,
      selection,
      plan: null,
      result: null,
      rollback: null,
    });

    // Capability-before-offer: the authoritative capability advertisement gates
    // the offer before any native refactoring command is invoked.
    const capabilities = capabilitiesRef.current;
    const general = capabilities?.generalRefactoring;
    if (
      !capabilities ||
      (selection.projectContext
        ? selection.editorOverlay
          ? !javaEditorRefactoringPreviewOffered(capabilities, selection.operation)
          : !javaContextRefactoringOffered(capabilities, selection.operation, "preview") ||
            ((selection.operation === "add-method-parameter" ||
              selection.operation === "remove-method-parameter" ||
              (selection.operation === "change-method-signature" &&
                selection.target.identity === "@cursor") ||
              selection.operation === "change-method-parameter-type" ||
              (selection.operation === "reorder-method-parameters" &&
                selection.target.identity === "@cursor") ||
              selection.operation === "make-static" ||
              selection.operation === "make-public" ||
              selection.operation === "change-field-type" ||
              selection.operation === "inline-method" ||
              selection.operation === "introduce-parameter-object" ||
              selection.operation === "extract-delegate" ||
              selection.operation === "extract-interface" ||
              selection.operation === "extract-superclass" ||
              selection.operation === "pull-up-member" ||
              selection.operation === "push-down-member" ||
              selection.operation === "move-member") &&
              !javaMutationSelectionOffered(capabilities))
        : !general?.supported || !general.preview)
    ) {
      if (operationRef.current === operation) {
        setDialog({
          status: "unavailable",
          operation: selection.operation,
          target: selection.target,
          selection,
          plan: null,
          result: null,
          rollback: null,
          message: capabilities
            ? selection.editorOverlay
              ? "Update RefactorKit to a version that advertises Java draft selection and preview."
              : JAVA_REFACTORING_UNAVAILABLE
            : JAVA_REFACTORING_CAPABILITIES_UNKNOWN,
        });
      }
      return;
    }
    if (!selection.projectContext && !general!.operations.includes(selection.operation)) {
      if (operationRef.current === operation) {
        setDialog({
          status: "refused",
          operation: selection.operation,
          target: selection.target,
          selection,
          plan: null,
          result: null,
          rollback: null,
          message: JAVA_REFACTORING_OPERATION_NOT_OFFERED,
        });
      }
      return;
    }

    let state: RefactorPreviewResult;
    const intentError = validateRefactorChangeIntent(selection.operation, selection.changeIntent);
    if (intentError) {
      setDialog({ ...current, message: intentError });
      return;
    }
    try {
      editorReviewRef.current =
        capturedReview ?? editorDependenciesRef.current.reviewSavedBuffers?.() ?? null;
    } catch (error) {
      setDialog({ ...current, message: errorMessage(error) });
      return;
    }
    try {
      state = await dependencies.refactorKit.previewRefactoring(previewRequest(selection));
    } catch (error) {
      const message = errorMessage(error);
      if (operationRef.current === operation) {
        const currentSelection =
          workspaceIdRef.current === selection.workspaceId &&
          currentWorkspaceGeneration() === selection.workspaceGeneration &&
          projectMatches(selection);
        if (
          currentSelection &&
          Boolean(selection.projectContext) &&
          (error instanceof JavaProjectContextRetiredError ||
            /project inputs changed|selected Java project context changed|snapshot (?:changed|is stale)/i.test(
              message,
            ))
        )
          editorDependenciesRef.current.onProjectContextStale?.();
        setDialog({
          status: message.includes("RefactorKit refused") ? "refused" : "error",
          operation: selection.operation,
          target: selection.target,
          selection,
          plan: null,
          result: null,
          rollback: null,
          message,
        });
      }
      return;
    }

    const workspaceGenerationChanged =
      currentWorkspaceGeneration() !== selection.workspaceGeneration;
    if (
      operationRef.current !== operation ||
      selectionGenerationRef.current !== selection.selectionGeneration ||
      workspaceGenerationChanged ||
      !projectMatches(selection)
    ) {
      if (operationRef.current === operation && workspaceGenerationChanged) {
        invalidate(true);
      } else if (operationRef.current === operation && !projectMatches(selection)) {
        setDialog({ ...current, status: "refused", message: JAVA_REFACTORING_STALE_CONTEXT });
      }
      // The returned plan belongs to a superseded request; discard it rather than
      // retain a plan the user can never review or apply.
      void dependencies.refactorKit
        .discardRefactoring(discardRequest(state))
        .catch(() => undefined);
      return;
    }

    // The returned plan must be correlated to the exact request/workspace authority.
    if (
      state.authority.workspaceId !== selection.workspaceId ||
      state.authority.workspaceGeneration !== selection.workspaceGeneration ||
      state.selectionGeneration !== selection.selectionGeneration ||
      state.requestId !== selection.requestId ||
      state.operation !== selection.operation ||
      state.target.kind !== selection.target.kind ||
      state.target.path !== selection.target.path ||
      state.target.identity !== selection.target.identity ||
      state.target.selection?.start !== selection.target.selection?.start ||
      state.target.selection?.end !== selection.target.selection?.end ||
      !javaProjectContextAttestationMatches(selection.projectContext, state.projectContext) ||
      (selection.editorOverlay &&
        (!state.editorPreview ||
          (state.applyEligibility.eligible &&
            selection.editorMutationMode !== "durable-editor-owned") ||
          state.editorPreview.mutationMode !== selection.editorMutationMode ||
          state.editorPreview.baseSnapshotHash !== selection.projectContext?.snapshotHash ||
          state.editorPreview.documents.length !== selection.editorOverlay.documents.length ||
          selection.editorOverlay.documents.some(
            (d) =>
              !state.editorPreview!.documents.some(
                (r) => r.path === d.path && r.version === d.version,
              ),
          ))) ||
      (!selection.editorOverlay && state.editorPreview !== undefined) ||
      (selection.projectContext &&
        (typeof state.diffTruncated !== "boolean" ||
          (state.diffTruncated && state.applyEligibility.eligible)))
    ) {
      if (operationRef.current === operation) {
        setDialog({
          status: "refused",
          operation: selection.operation,
          target: selection.target,
          selection,
          plan: null,
          result: null,
          rollback: null,
          message: JAVA_REFACTORING_STALE_SELECTION,
        });
      }
      void dependencies.refactorKit
        .discardRefactoring(discardRequest(state))
        .catch(() => undefined);
      return;
    }

    if (state.status !== "ready") {
      const refused = state.status !== "error";
      if (operationRef.current === operation) {
        setDialog({
          status: refused ? "refused" : "error",
          operation: selection.operation,
          target: selection.target,
          selection,
          plan: state.status === "error" ? null : state,
          result: null,
          rollback: null,
          message: refused
            ? state.status === "stale"
              ? JAVA_REFACTORING_STALE_SELECTION
              : state.refusalReasons.join(" ")
            : errorMessage(state.summary),
        });
      }
      if (state.status === "stale") {
        void dependencies.refactorKit
          .discardRefactoring(discardRequest(state))
          .catch(() => undefined);
      }
      return;
    }

    try {
      editorReviewRef.current?.();
    } catch (error) {
      if (operationRef.current === operation) {
        setDialog({ ...current, status: "refused", selection, message: errorMessage(error) });
      }
      void dependencies.refactorKit
        .discardRefactoring(discardRequest(state))
        .catch(() => undefined);
      return;
    }

    if (operationRef.current === operation) {
      setDialog({
        status: "preview",
        operation: selection.operation,
        target: selection.target,
        selection,
        plan: state,
        result: null,
        rollback: null,
      });
    }
  }, [currentWorkspaceGeneration, dependencies.refactorKit, invalidate, projectMatches]);

  const openPreviewReference = useCallback<JavaRefactoringController["openPreviewReference"]>(
    async (plan, location, navigate) => {
      const current = dialogRef.current;
      const selection = current?.selection;
      if (
        !selection ||
        current.status !== "preview" ||
        current.plan !== plan ||
        plan.editorPreview ||
        plan.staleness.stale ||
        plan.referenceAnalysis?.schemaVersion !== "refactorkit-reference-analysis-v1" ||
        !plan.referenceAnalysis.references.some((reference) => reference.location === location)
      ) {
        return;
      }

      const operation = operationRef.current;
      const dialogIsCurrent = () =>
        mountedRef.current &&
        !writeInFlightRef.current &&
        operationRef.current === operation &&
        dialogRef.current === current;
      const contextIsCurrent = () =>
        dialogIsCurrent() &&
        dialogProviderRef.current === editorDependenciesRef.current.refactorKit &&
        workspaceIdRef.current === selection.workspaceId &&
        currentWorkspaceGeneration() === selection.workspaceGeneration &&
        projectMatches(selection);
      if (!contextIsCurrent()) {
        if (dialogIsCurrent()) setDialog({ ...current, message: JAVA_REFACTORING_STALE_CONTEXT });
        return;
      }

      try {
        editorReviewRef.current?.();
        const verifyBuffers = editorDependenciesRef.current.reviewSavedBuffers?.({
          allowNewBuffers: true,
        });
        const canReveal = () => {
          if (!contextIsCurrent()) return false;
          verifyBuffers?.();
          return true;
        };
        if ((await navigate(location, canReveal)) && canReveal()) {
          invalidate(true);
        } else if (dialogIsCurrent()) {
          setDialog({
            ...current,
            message: "The reference could not be opened. Review the current saved sources and preview again.",
          });
        }
      } catch (error) {
        if (dialogIsCurrent()) setDialog({ ...current, message: errorMessage(error) });
      }
    },
    [currentWorkspaceGeneration, invalidate, projectMatches],
  );

  const performEditorTransaction = useCallback(
    async (
      action: "apply" | "undo" | "recover",
      current: JavaRefactoringDialogState,
    ): Promise<void> => {
      const selection = current.selection,
        plan = current.plan;
      if (
        writeInFlightRef.current ||
        !selection?.projectContext ||
        !plan?.editorPreview ||
        plan.editorPreview.mutationMode !== "durable-editor-owned"
      )
        return;
      const beginBuffers = editorDependenciesRef.current.beginEditorTransaction;
      if (
        !beginBuffers ||
        !dependencies.refactorKit.editorTransaction ||
        !javaEditorMutationOffered(capabilitiesRef.current, selection.operation)
      ) {
        setDialog({
          ...current,
          status: "unavailable",
          message: "Durable Java editor transactions are unavailable.",
        });
        return;
      }
      if (action !== "apply" && !current.editorTransaction) return;
      const assertCurrent = () => {
        const settings = editorDependenciesRef.current.getProjectContext?.().settings;
        if (
          workspaceIdRef.current !== selection.workspaceId ||
          currentWorkspaceGeneration() !== selection.workspaceGeneration ||
          !settings ||
          !sameJavaProjectContextSettings(selection.projectContext!, settings)
        )
          throw new Error(JAVA_REFACTORING_STALE_CONTEXT);
      };
      try {
        assertCurrent();
        if (action === "apply") editorReviewRef.current?.();
      } catch (error) {
        setDialog({
          ...current,
          status: action === "apply" ? "refused" : current.status,
          message: errorMessage(error),
        });
        return;
      }
      const operation = ++operationRef.current;
      writeInFlightRef.current = true;
      setIsWriting(true);
      setDialog({ ...current, status: "applying", message: undefined });
      try {
        const outcome = await executeJavaEditorRefactoring({
          action,
          authority: {
            workspaceId: selection.workspaceId,
            generation: selection.workspaceGeneration,
            projectContext: selection.projectContext,
            planId: plan.planId,
            approvedPlanHash: plan.editorPreview.planHash,
            ...(action === "apply" && selection.formatterProfile && plan.formatterProfileSha256
              ? {
                  formatterProfile: selection.formatterProfile,
                  formatterProfileSha256: plan.formatterProfileSha256,
                }
              : {}),
            ...(current.editorTransaction
              ? { transactionId: current.editorTransaction.transactionId }
              : {}),
          },
          port: dependencies.refactorKit,
          beginBuffers,
          assertCurrent,
          documentLineage: selection.editorOverlay?.documents.map((d) => ({
            originalPath: d.path,
            finalPath: plan.affectedFiles.find((f) => f.previousPath === d.path)?.path ?? d.path,
          })),
          restoredBuffers: selection.editorOverlay?.documents.map((d) => ({
            path: d.path,
            text: d.text,
            isDirty: selection.editorDirtyPaths?.includes(d.path) ?? true,
          })),
        });
        if (outcome.changes.some((c) => c.oldPath !== c.path))
          editorDependenciesRef.current.onEditorSourceChanged?.();
        let message: string | undefined;
        try {
          message = await editorDependenciesRef.current.reconcileEditorBuffers?.(
            outcome.changes,
            () =>
              workspaceIdRef.current === selection.workspaceId &&
              currentWorkspaceGeneration() === selection.workspaceGeneration,
          );
        } catch {
          message =
            "The draft transformation completed, but some views could not be refreshed. Reactivate the affected tabs.";
        }
        if (operationRef.current === operation) {
          setDialog({
            ...current,
            status: action === "apply" ? "applied" : "undone",
            editorTransaction: outcome.transaction,
            message,
          });
          setSuccessMessage(
            action === "apply"
              ? "Java drafts transformed without saving source content."
              : "Original Java drafts restored without saving source content.",
          );
        }
      } catch (error) {
        if (
          workspaceIdRef.current === selection.workspaceId &&
          currentWorkspaceGeneration() === selection.workspaceGeneration &&
          plan.affectedFiles.some((f) => f.previousPath)
        )
          editorDependenciesRef.current.onEditorSourceChanged?.();
        if (error instanceof JavaEditorTransactionError && error.buffersCommitted) {
          try {
            await editorDependenciesRef.current.reconcileEditorBuffers?.(
              error.changes,
              () =>
                workspaceIdRef.current === selection.workspaceId &&
                currentWorkspaceGeneration() === selection.workspaceGeneration,
            );
          } catch {
            // The original transaction error remains authoritative; refreshing views cannot confirm it.
          }
        }
        if (operationRef.current === operation)
          setDialog({
            ...current,
            status: "error",
            editorTransaction:
              error instanceof JavaEditorTransactionError
                ? (error.transaction ?? current.editorTransaction)
                : current.editorTransaction,
            message: `${errorMessage(error)} Inspect Java transaction recovery before retrying.`,
          });
      } finally {
        writeInFlightRef.current = false;
        setIsWriting(false);
      }
    },
    [currentWorkspaceGeneration, dependencies.refactorKit],
  );

  const undoEditorTransaction = useCallback(async () => {
    const current = dialogRef.current;
    if (current?.status === "applied" && current.editorTransaction?.status === "applied")
      await performEditorTransaction("undo", current);
  }, [performEditorTransaction]);
  const recoverEditorTransaction = useCallback(async () => {
    const current = dialogRef.current;
    if (current?.status === "error" && current.editorTransaction)
      await performEditorTransaction("recover", current);
  }, [performEditorTransaction]);

  const applyDisplayedPlan = useCallback(
    async (plan: RefactorPreviewResult): Promise<void> => {
      const current = dialogRef.current;
      if (
        !current ||
        writeInFlightRef.current ||
        current.status !== "preview" ||
        !current.plan ||
        current.plan.status !== "ready" ||
        plan !== current.plan ||
        !plan.applyEligibility.eligible ||
        (plan.editorPreview !== undefined &&
          plan.editorPreview.mutationMode !== "durable-editor-owned") ||
        plan.diffTruncated === true ||
        plan.applyEligibility.blockers.length > 0 ||
        plan.staleness.stale ||
        currentWorkspaceGeneration() !== current.selection!.workspaceGeneration
      ) {
        return;
      }
      const selection = current.selection!;
      if (
        !projectMatches(selection) ||
        !javaProjectContextAttestationMatches(selection.projectContext, plan.projectContext)
      ) {
        setDialog({ ...current, status: "refused", message: JAVA_REFACTORING_STALE_CONTEXT });
        void dependencies.refactorKit
          .discardRefactoring(discardRequest(plan))
          .catch(() => undefined);
        return;
      }
      if (
        (selection.operation === "create-maven-module" ||
          selection.operation === "create-gradle-module" ||
          selection.operation === "rename-gradle-module") &&
        (selection.editorDirtyPaths?.length ?? 0) > 0
      ) {
        setDialog({
          ...current,
          status: "refused",
          message: "Save or discard all open editor changes before applying a module change.",
        });
        return;
      }
      if (
        selection.operation === "safe-delete" &&
        !javaSafeDeleteReferenceAnalysisQualified(capabilitiesRef.current)
      ) {
        setDialog({
          ...current,
          status: "unavailable",
          message: JAVA_SAFE_DELETE_REFERENCE_ANALYSIS_UNAVAILABLE,
        });
        return;
      }
      if (plan.editorPreview) {
        await performEditorTransaction("apply", current);
        return;
      }
      const capability = capabilitiesRef.current?.generalRefactoring;
      if (
        selection.projectContext
          ? !javaContextRefactoringOffered(capabilitiesRef.current, plan.operation, "apply")
          : !capability?.supported ||
            !capability.apply ||
            !capability.operations.includes(plan.operation) ||
            !javaRefactoringMutationAuthorized(capabilitiesRef.current, plan.operation)
      ) {
        setDialog({
          ...current,
          status: "unavailable",
          message:
            "RefactorKit no longer advertises Apply for this operation. Refresh capabilities and create a new preview.",
        });
        return;
      }

      let release: (() => void) | undefined;
      try {
        editorReviewRef.current?.();
        release = editorDependenciesRef.current.beginWorkspaceWrite?.();
      } catch (error) {
        setDialog({ ...current, status: "refused", message: errorMessage(error) });
        return;
      }

      const operation = ++operationRef.current;
      writeInFlightRef.current = true;
      setIsWriting(true);
      setDialog({ ...current, status: "applying" });

      const request: RefactorApplyRequest = {
        planId: plan.planId,
        operation: plan.operation,
        target: plan.target,
        authority: {
          workspaceId: selection.workspaceId,
          workspaceGeneration: selection.workspaceGeneration,
        },
        selectionGeneration: selection.selectionGeneration,
        requestId: selection.requestId,
        ...(selection.changeIntent
          ? { changeIntent: structuredClone(selection.changeIntent) }
          : {}),
        ...(selection.projectContext ? { projectContext: selection.projectContext } : {}),
        ...(selection.formatterProfile && plan.formatterProfileSha256
          ? {
              formatterProfile: selection.formatterProfile,
              formatterProfileSha256: plan.formatterProfileSha256,
            }
          : {}),
        approval: {
          approvalId: `desktop-java-refactor-approval-${selection.requestId}`,
          approvedPlanId: plan.planId,
          approvedAt: new Date().toISOString(),
        },
      };

      let state: RefactorApplyResult;
      let reconciliationMessage: string | undefined;
      const matchesWorkspace = () =>
        workspaceIdRef.current === selection.workspaceId &&
        currentWorkspaceGeneration() === selection.workspaceGeneration;
      try {
        state = await dependencies.refactorKit.applyRefactoring(request);
        if (
          matchesWorkspace() &&
          state.planId === plan.planId &&
          state.operation === selection.operation &&
          state.outcome === "applied" &&
          (!selection.projectContext ||
            state.appliedContextHash === selection.projectContext.contextHash)
        ) {
          try {
            reconciliationMessage = await editorDependenciesRef.current.reconcileChanges?.(
              state.changedFiles,
              matchesWorkspace,
            );
          } catch {
            reconciliationMessage =
              "The refactoring was applied, but some editor views could not be refreshed. Compare open buffers with disk before saving.";
          }
        }
        if (state.outcome === "applied" || state.outcome === "indeterminate") {
          editorDependenciesRef.current.onSourceChanged?.();
        }
      } catch (error) {
        editorDependenciesRef.current.onSourceChanged?.();
        if (operationRef.current === operation) {
          setDialog({
            ...current,
            status: "error",
            message: errorMessage(error),
          });
        }
        return;
      } finally {
        release?.();
        writeInFlightRef.current = false;
        setIsWriting(false);
      }

      const workspaceGenerationChanged =
        currentWorkspaceGeneration() !== selection.workspaceGeneration;
      if (operationRef.current !== operation || workspaceGenerationChanged) {
        if (operationRef.current === operation && workspaceGenerationChanged) {
          invalidate(true);
        }
        return;
      }

      if (operationRef.current !== operation) return;

      if (
        state.planId !== plan.planId ||
        state.operation !== selection.operation ||
        (state.outcome === "applied" &&
          selection.projectContext &&
          state.appliedContextHash !== selection.projectContext.contextHash)
      ) {
        setDialog({
          ...current,
          status: "error",
          message: "RefactorKit returned an uncorrelated apply result; the outcome is unknown.",
        });
        return;
      }

      if (state.outcome === "applied") {
        setDialog({ ...current, status: "applied", result: state, message: reconciliationMessage });
        setSuccessMessage(
          `Java refactoring ${state.operation} applied successfully.${
            state.transactionId ? ` Transaction ${state.transactionId}.` : ""
          }`,
        );
        return;
      }

      if (state.outcome === "refused") {
        setDialog({
          ...current,
          status: "refused",
          result: state,
          message: "RefactorKit refused to apply this plan.",
        });
        return;
      }

      if (state.outcome === "stale") {
        setDialog({
          ...current,
          status: "refused",
          result: state,
          message: "RefactorKit rejected a stale plan; preview again.",
        });
        return;
      }

      if (state.outcome === "failed") {
        setDialog({
          ...current,
          status: "error",
          result: state,
          message: "RefactorKit failed to apply this plan.",
        });
        return;
      }

      // indeterminate
      setDialog({
        ...current,
        status: "error",
        result: state,
        message: "RefactorKit apply outcome is indeterminate.",
      });
    },
    [
      currentWorkspaceGeneration,
      dependencies.refactorKit,
      invalidate,
      projectMatches,
      performEditorTransaction,
    ],
  );

  const rollback = useCallback(
    async (result: RefactorApplyResult): Promise<void> => {
      const current = dialogRef.current;
      if (
        !current ||
        writeInFlightRef.current ||
        (current.status !== "applied" && current.status !== "rollback-refused") ||
        !current.selection ||
        result !== current.result ||
        currentWorkspaceGeneration() !== current.selection.workspaceGeneration
      )
        return;

      const capabilities = capabilitiesRef.current;
      const general = capabilities?.generalRefactoring;
      // Rollback is exposed only when the provider advertises the transaction class
      // AND the applied result carries a correlated transaction identity.
      if (
        !(current.selection.projectContext
          ? javaContextRefactoringOffered(capabilities, current.selection.operation, "rollback") &&
            result.appliedSnapshotHash
          : general?.supported && general.rollback) ||
        !result.transactionId
      ) {
        if (current.status === "applied" || current.status === "rollback-refused") {
          setDialog({
            ...current,
            status: "error",
            message: JAVA_REFACTORING_ROLLBACK_NOT_OFFERED,
          });
        }
        return;
      }
      const selection = current.selection;
      if (selection.projectContext) {
        const settings = editorDependenciesRef.current.getProjectContext?.().settings;
        if (!settings || !sameJavaProjectContextSettings(selection.projectContext, settings)) {
          setDialog({ ...current, message: JAVA_REFACTORING_STALE_CONTEXT });
          return;
        }
      }

      let release: (() => void) | undefined;
      try {
        release = editorDependenciesRef.current.beginWorkspaceWrite?.();
      } catch (error) {
        setDialog({ ...current, message: errorMessage(error) });
        return;
      }

      const operation = ++operationRef.current;
      writeInFlightRef.current = true;
      setIsWriting(true);
      setDialog({ ...current, status: "loading", result: current.result });

      const request: RefactorRollbackRequest = {
        ...(selection.projectContext
          ? {
              projectContext: selection.projectContext,
              expectedSnapshotHash: result.appliedSnapshotHash,
            }
          : {}),
        transactionId: result.transactionId,
        operation: selection.operation,
        authority: {
          workspaceId: selection.workspaceId,
          workspaceGeneration: selection.workspaceGeneration,
        },
        requestId: `desktop-java-refactor-rollback-${++requestSequenceRef.current}`,
      };

      let state: RefactorRollbackResult;
      let reconciliationMessage: string | undefined;
      const matchesWorkspace = () =>
        workspaceIdRef.current === selection.workspaceId &&
        currentWorkspaceGeneration() === selection.workspaceGeneration;
      try {
        state = await dependencies.refactorKit.rollbackRefactoring(request);
        if (
          selection.projectContext &&
          state.rolledBack &&
          (state.rolledBackContextHash !== selection.projectContext.contextHash ||
            state.restoredSnapshotHash !== selection.projectContext.snapshotHash)
        )
          throw new Error(
            "Rollback write outcome is unknown: the original Java authority was not confirmed.",
          );
        if (
          matchesWorkspace() &&
          state.transactionId === result.transactionId &&
          state.rolledBack
        ) {
          editorDependenciesRef.current.onSourceChanged?.();
          try {
            reconciliationMessage = await editorDependenciesRef.current.reconcileChanges?.(
              state.changedFiles,
              matchesWorkspace,
            );
          } catch {
            reconciliationMessage =
              "Rollback completed, but some editor views could not be refreshed. Compare open buffers with disk before saving.";
          }
        }
      } catch (error) {
        if (matchesWorkspace()) editorDependenciesRef.current.onSourceChanged?.();
        if (operationRef.current === operation) {
          setDialog({
            ...current,
            status: error instanceof RefactorRollbackNotStartedError ? "rollback-refused" : "error",
            result: current.result,
            message: errorMessage(error),
          });
        }
        return;
      } finally {
        release?.();
        writeInFlightRef.current = false;
        setIsWriting(false);
      }

      if (
        operationRef.current !== operation ||
        currentWorkspaceGeneration() !== selection.workspaceGeneration
      )
        return;

      if (state.transactionId !== result.transactionId || !state.rolledBack) {
        setDialog({
          ...current,
          status: "error",
          rollback: state,
          message: "RefactorKit did not confirm rollback of this transaction.",
        });
        return;
      }
      setDialog({
        ...current,
        status: "rolled-back",
        result: current.result,
        rollback: state,
        message: reconciliationMessage,
      });
      setSuccessMessage(`Java refactoring rolled back. Transaction ${state.transactionId}.`);
    },
    [currentWorkspaceGeneration, dependencies.refactorKit, requestSequenceRef],
  );

  const discardDisplayedPlan = useCallback(() => invalidate(true), [invalidate]);

  const cancel = useCallback(() => invalidate(true), [invalidate]);

  const resetWorkspace = useCallback(() => {
    invalidate(true);
    retainedAppliedRef.current = null;
    if (!workspaceGenerationAuthorityRef.current) {
      localWorkspaceGenerationRef.current += 1;
    }
    selectionGenerationRef.current += 1;
    setSuccessMessage(null);
  }, [invalidate]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      retainedAppliedRef.current = null;
      invalidate(false);
    };
  }, [invalidate]);

  return {
    dialog,
    successMessage,
    isWriting,
    canReopenApplied: dialog === null && !isWriting && retainedIsCurrent(),
    reopenApplied,
    open,
    setOperation,
    setTarget,
    setChangeIntent,
    preview,
    openPreviewReference,
    applyDisplayedPlan,
    rollback,
    undoEditorTransaction,
    recoverEditorTransaction,
    discardDisplayedPlan,
    cancel,
    resetWorkspace,
  };
}
