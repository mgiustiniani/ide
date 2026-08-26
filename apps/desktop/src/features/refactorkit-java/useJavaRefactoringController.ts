import type {
  RefactorApplyRequest,
  RefactorApplyResult,
  RefactorKitCapabilities,
  RefactorPreviewRequest,
  RefactorPreviewResult,
  RefactorRollbackRequest,
  RefactorRollbackResult,
  RefactoringOperation,
  RefactoringTarget,
} from "@ide/contracts";
import type { RefactorKitPort } from "@ide/web-core";
import { useCallback, useEffect, useRef, useState } from "react";

export type JavaRefactoringDialogStatus =
  | "idle"
  | "loading"
  | "unavailable"
  | "refused"
  | "preview"
  | "applying"
  | "applied"
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

/** Internal workspace/request context carried by every live Java refactoring dialog. */
export interface JavaRefactoringSelection {
  operation: RefactoringOperation;
  target: RefactoringTarget;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
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
  message?: string;
}

export interface UseJavaRefactoringControllerDependencies {
  refactorKit: RefactorKitPort;
  /** Authoritative capability advertisement from the shared RefactorKit status controller. */
  capabilities: RefactorKitCapabilities | null;
  workspaceId: string | null;
  /** Uses the application workspace authority when supplied; standalone consumers keep a local generation. */
  getWorkspaceGeneration?: () => number;
}

export interface JavaRefactoringController {
  dialog: JavaRefactoringDialogState | null;
  successMessage: string | null;
  open(operation: RefactoringOperation, target: RefactoringTarget): void;
  setOperation(operation: RefactoringOperation): void;
  setTarget(target: RefactoringTarget): void;
  /** Capability-before-offer: refuses before any native call when the capability is not advertised. */
  preview(): Promise<void>;
  /** Applies only the exact reviewed plan under explicit authority bound to that plan. */
  applyDisplayedPlan(plan: RefactorPreviewResult): Promise<void>;
  /** Rolls back only when rollback is advertised AND the result carries a correlated transaction. */
  rollback(result: RefactorApplyResult): Promise<void>;
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
  };
}

function discardRequest(
  plan: RefactorPreviewResult,
): { planId: string; requestId: string; selectionGeneration: number } & {
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
  const dialogRef = useRef<JavaRefactoringDialogState | null>(null);
  dialogRef.current = dialog;

  /** Discards any retained/in-flight backend plan and optionally closes the dialog. */
  const invalidate = useCallback(
    (closeDialog: boolean): void => {
      operationRef.current += 1;
      const current = dialogRef.current;
      if (closeDialog) setDialog(null);
      if (
        current?.plan?.planId &&
        current.status !== "applied" &&
        current.status !== "rolled-back"
      ) {
        void dependencies.refactorKit
          .discardRefactoring(discardRequest(current.plan))
          .catch(() => undefined);
      }
    },
    [dependencies.refactorKit],
  );

  const open = useCallback(
    (operation: RefactoringOperation, target: RefactoringTarget): void => {
      invalidate(true);
      setSuccessMessage(null);
      setDialog({
        status: "idle",
        operation,
        target,
        selection: null,
        plan: null,
        result: null,
        rollback: null,
      });
    },
    [invalidate],
  );

  const setOperation = useCallback((operation: RefactoringOperation): void => {
    setDialog((current) => {
      if (!current || current.status !== "idle") return current;
      return { ...current, operation };
    });
  }, []);

  const setTarget = useCallback((target: RefactoringTarget): void => {
    setDialog((current) => {
      if (!current || current.status !== "idle") return current;
      return { ...current, target };
    });
  }, []);

  const preview = useCallback(async (): Promise<void> => {
    const current = dialogRef.current;
    if (!current || current.status !== "idle") return;
    const workspaceId = workspaceIdRef.current;
    if (!workspaceId) return;

    const selection: JavaRefactoringSelection = {
      operation: current.operation,
      target: current.target,
      workspaceId,
      workspaceGeneration: currentWorkspaceGeneration(),
      selectionGeneration: selectionGenerationRef.current + 1,
      requestId: `desktop-java-refactor-${++requestSequenceRef.current}`,
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
    if (!capabilities || !general?.supported || !general.preview) {
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
            ? JAVA_REFACTORING_UNAVAILABLE
            : JAVA_REFACTORING_CAPABILITIES_UNKNOWN,
        });
      }
      return;
    }
    if (!general.operations.includes(selection.operation)) {
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
    try {
      state = await dependencies.refactorKit.previewRefactoring(previewRequest(selection));
    } catch (error) {
      if (operationRef.current === operation) {
        setDialog({
          status: "error",
          operation: selection.operation,
          target: selection.target,
          selection,
          plan: null,
          result: null,
          rollback: null,
          message: errorMessage(error),
        });
      }
      return;
    }

    const workspaceGenerationChanged =
      currentWorkspaceGeneration() !== selection.workspaceGeneration;
    if (
      operationRef.current !== operation ||
      selectionGenerationRef.current !== selection.selectionGeneration ||
      workspaceGenerationChanged
    ) {
      if (operationRef.current === operation && workspaceGenerationChanged) {
        invalidate(true);
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
      state.operation !== selection.operation
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
      void dependencies.refactorKit.discardRefactoring(discardRequest(state)).catch(() => undefined);
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
        void dependencies.refactorKit.discardRefactoring(discardRequest(state)).catch(
          () => undefined,
        );
      }
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
  }, [currentWorkspaceGeneration, dependencies.refactorKit, invalidate]);

  const applyDisplayedPlan = useCallback(
    async (plan: RefactorPreviewResult): Promise<void> => {
      const current = dialogRef.current;
      if (
        !current ||
        current.status !== "preview" ||
        !current.plan ||
        current.plan.status !== "ready" ||
        plan.planId !== current.plan.planId ||
        currentWorkspaceGeneration() !== current.selection!.workspaceGeneration
      ) {
        return;
      }
      const selection = current.selection!;

      const operation = ++operationRef.current;
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
        approval: {
          approvalId: `desktop-java-refactor-approval-${selection.requestId}`,
          approvedPlanId: plan.planId,
          approvedAt: new Date().toISOString(),
        },
      };

      let state: RefactorApplyResult;
      try {
        state = await dependencies.refactorKit.applyRefactoring(request);
      } catch (error) {
        if (operationRef.current === operation) {
          setDialog({
            ...current,
            status: "error",
            message: errorMessage(error),
          });
        }
        return;
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

      if (state.outcome === "applied") {
        setDialog({ ...current, status: "applied", result: state });
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
    [currentWorkspaceGeneration, dependencies.refactorKit, invalidate],
  );

  const rollback = useCallback(
    async (result: RefactorApplyResult): Promise<void> => {
      const current = dialogRef.current;
      if (!current || current.status !== "applied" || !current.selection) return;
      const capabilities = capabilitiesRef.current;
      const general = capabilities?.generalRefactoring;
      // Rollback is exposed only when the provider advertises the transaction class
      // AND the applied result carries a correlated transaction identity.
      if (!general?.rollback || !result.transactionId) {
        if (current.status === "applied") {
          setDialog({
            ...current,
            status: "error",
            message: JAVA_REFACTORING_ROLLBACK_NOT_OFFERED,
          });
        }
        return;
      }
      const selection = current.selection;

      const operation = ++operationRef.current;
      setDialog({ ...current, status: "loading", result: current.result });

      const request: RefactorRollbackRequest = {
        transactionId: result.transactionId,
        operation: selection.operation,
        authority: {
          workspaceId: selection.workspaceId,
          workspaceGeneration: selection.workspaceGeneration,
        },
        requestId: `desktop-java-refactor-rollback-${++requestSequenceRef.current}`,
      };

      let state: RefactorRollbackResult;
      try {
        state = await dependencies.refactorKit.rollbackRefactoring(request);
      } catch (error) {
        if (operationRef.current === operation) {
          setDialog({
            ...current,
            status: "error",
            result: current.result,
            message: errorMessage(error),
          });
        }
        return;
      }

      if (operationRef.current !== operation) return;

      setDialog({
        ...current,
        status: "rolled-back",
        result: current.result,
        rollback: state,
      });
      setSuccessMessage(
        `Java refactoring rolled back. Transaction ${state.transactionId}.`,
      );
    },
    [dependencies.refactorKit, requestSequenceRef],
  );

  const discardDisplayedPlan = useCallback(() => invalidate(true), [invalidate]);

  const cancel = useCallback(() => invalidate(true), [invalidate]);

  const resetWorkspace = useCallback(() => {
    invalidate(true);
    if (!workspaceGenerationAuthorityRef.current) {
      localWorkspaceGenerationRef.current += 1;
    }
    selectionGenerationRef.current += 1;
    setSuccessMessage(null);
  }, [invalidate]);

  useEffect(
    () => () => {
      invalidate(false);
    },
    [invalidate],
  );

  return {
    dialog,
    successMessage,
    open,
    setOperation,
    setTarget,
    preview,
    applyDisplayedPlan,
    rollback,
    discardDisplayedPlan,
    cancel,
    resetWorkspace,
  };
}
