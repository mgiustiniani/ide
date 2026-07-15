import type {
  ApplyRefactorKitPlanResult,
  DiscardRefactorKitPlanRequest,
  RefactorKitApprovalEvidence,
  RefactorKitPatchPlan,
} from "@ide/contracts";
import type { ClipboardPort, RefactorKitPort } from "./ports";

export interface PasteExternalJavaClassSelection {
  targetDirectory: string;
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
}

export interface PasteExternalJavaClassApproval {
  workspaceId: string;
  workspaceGeneration: number;
  selectionGeneration: number;
  requestId: string;
  approval: RefactorKitApprovalEvidence;
}

export type PasteExternalJavaClassRefusalKind =
  | "empty-clipboard"
  | "clipboard-too-large"
  | "invalid-target"
  | "plan-refused"
  | "plan-stale"
  | "plan-error"
  | "not-ready"
  | "approval-mismatch";

export type PasteExternalJavaClassState =
  | { status: "idle" }
  | { status: "reading-clipboard" }
  | { status: "checking-capability" }
  | { status: "previewing" }
  | { status: "applying"; planId: string }
  | { status: "unavailable"; message: string }
  | {
      status: "refused";
      kind: PasteExternalJavaClassRefusalKind;
      reasons: string[];
      /** Complete backend evidence when RefactorKit returned a correlated non-ready plan. */
      plan?: RefactorKitPatchPlan;
    }
  | { status: "preview"; plan: RefactorKitPatchPlan }
  | { status: "applied"; result: ApplyRefactorKitPlanResult };

export interface PasteExternalJavaClassOptions {
  /** Clipboard bound measured in JavaScript UTF-16 code units. */
  maxClipboardLength?: number;
}

const DEFAULT_MAX_CLIPBOARD_LENGTH = 1_048_576;
const CAPABILITY_UNAVAILABLE_MESSAGE =
  "Paste Java Class is unavailable because RefactorKit does not advertise java.importExternalClass with targetDirectory preview and apply support.";

/**
 * Coordinates an explicit clipboard paste without inspecting Java source or writing files.
 * RefactorKit is the sole authority for Java placement and patch construction.
 */
export class PasteExternalJavaClass {
  private stateValue: PasteExternalJavaClassState = { status: "idle" };
  private operationGeneration = 0;
  private readonly maxClipboardLength: number;

  constructor(
    private readonly clipboard: ClipboardPort,
    private readonly refactorKit: RefactorKitPort,
    options: PasteExternalJavaClassOptions = {},
  ) {
    this.maxClipboardLength = options.maxClipboardLength ?? DEFAULT_MAX_CLIPBOARD_LENGTH;
  }

  get state(): PasteExternalJavaClassState {
    return this.stateValue;
  }

  async preview(selection: PasteExternalJavaClassSelection): Promise<PasteExternalJavaClassState> {
    const operation = ++this.operationGeneration;
    let code = "";

    // Discard any older retained plan before replacing it, without blocking
    // privacy/state invalidation (fire-and-forget).
    const retained = this.planFromState(this.stateValue);
    if (retained !== undefined) {
      this.discardPlanIfNeeded(retained);
    }

    if (selection.targetDirectory.trim().length === 0) {
      return this.setIfCurrent(operation, {
        status: "refused",
        kind: "invalid-target",
        reasons: ["A target directory must be selected."],
      });
    }

    this.stateValue = { status: "checking-capability" };
    try {
      const capabilities = await this.refactorKit.getCapabilities();
      if (!this.isCurrent(operation)) return this.stateValue;

      const capability = capabilities.javaImportExternalClass;
      if (
        !capability.supported ||
        !capability.targetDirectory ||
        !capability.preview ||
        !capability.apply
      ) {
        return this.setIfCurrent(operation, {
          status: "unavailable",
          message: CAPABILITY_UNAVAILABLE_MESSAGE,
        });
      }

      this.stateValue = { status: "reading-clipboard" };
      code = await this.clipboard.readText();
      if (!this.isCurrent(operation)) return this.stateValue;

      if (code.trim().length === 0) {
        return this.setIfCurrent(operation, {
          status: "refused",
          kind: "empty-clipboard",
          reasons: ["The clipboard does not contain text."],
        });
      }
      if (code.length > this.maxClipboardLength) {
        return this.setIfCurrent(operation, {
          status: "refused",
          kind: "clipboard-too-large",
          reasons: [`Clipboard text exceeds the ${this.maxClipboardLength} character limit.`],
        });
      }

      this.stateValue = { status: "previewing" };
      const plan = await this.refactorKit.previewExternalJavaImport({
        code,
        targetDirectory: selection.targetDirectory,
        sourceKind: "clipboard",
        sourceUrl: null,
        licensePolicy: "warn",
        workspaceId: selection.workspaceId,
        workspaceGeneration: selection.workspaceGeneration,
        selectionGeneration: selection.selectionGeneration,
        requestId: selection.requestId,
      });
      if (!this.isCurrent(operation)) {
        // Late plan after cancellation — discard asynchronously.
        if (plan.planId) {
          this.discardPlanIfNeeded(plan);
        }
        return this.stateValue;
      }

      if (
        plan.workspaceId !== selection.workspaceId ||
        plan.workspaceGeneration !== selection.workspaceGeneration ||
        plan.selectionGeneration !== selection.selectionGeneration ||
        plan.requestId !== selection.requestId
      ) {
        return this.setIfCurrent(operation, {
          status: "refused",
          kind: "plan-stale",
          reasons: ["RefactorKit returned a plan for a stale workspace selection."],
        });
      }

      if (plan.status !== "ready") {
        const kind =
          plan.status === "stale"
            ? "plan-stale"
            : plan.status === "error"
              ? "plan-error"
              : "plan-refused";
        return this.setIfCurrent(operation, {
          status: "refused",
          kind,
          reasons:
            plan.refusalReasons.length > 0
              ? [...plan.refusalReasons]
              : [`RefactorKit returned a ${plan.status} patch plan.`],
          plan,
        });
      }

      return this.setIfCurrent(operation, { status: "preview", plan });
    } catch {
      return this.setIfCurrent(operation, {
        status: "unavailable",
        message: "Paste Java Class is unavailable because the RefactorKit request failed.",
      });
    } finally {
      // Do not retain clipboard source in the use-case object after request completion.
      code = "";
    }
  }

  async apply(approval: PasteExternalJavaClassApproval): Promise<PasteExternalJavaClassState> {
    const current = this.stateValue;
    if (current.status !== "preview" || current.plan.status !== "ready") {
      this.stateValue = {
        status: "refused",
        kind: "not-ready",
        reasons: ["There is no current ready patch plan to apply."],
      };
      return this.stateValue;
    }

    const plan = current.plan;
    const matches =
      plan.applyEligibility.eligible &&
      !plan.staleness.stale &&
      approval.approval.approvedPlanId === plan.planId &&
      approval.workspaceId === plan.workspaceId &&
      approval.workspaceGeneration === plan.workspaceGeneration &&
      approval.selectionGeneration === plan.selectionGeneration;

    if (!matches) {
      this.stateValue = {
        status: "refused",
        kind: "approval-mismatch",
        reasons: ["The plan or workspace selection changed after preview. Preview again."],
      };
      return this.stateValue;
    }

    const operation = ++this.operationGeneration;
    this.stateValue = { status: "applying", planId: plan.planId };
    try {
      const result = await this.refactorKit.applyPlan({
        planId: plan.planId,
        workspaceId: approval.workspaceId,
        workspaceGeneration: approval.workspaceGeneration,
        selectionGeneration: approval.selectionGeneration,
        requestId: approval.requestId,
        approval: approval.approval,
      });
      return this.setIfCurrent(operation, { status: "applied", result });
    } catch {
      return this.setIfCurrent(operation, {
        status: "refused",
        kind: "plan-error",
        reasons: ["RefactorKit could not apply the reviewed patch plan."],
      });
    }
  }

  /** Clears the reviewed plan. A later apply must first obtain a new preview.
   *
   *  - State invalidates synchronously/immediately.
   *  - If a current backend plan exists (ready/refused/stale/error with planId),
   *    asynchronously requests discard exactly once with its workspace/generation/
   *    selection/request tokens.
   *  - Failures are redacted/non-fatal and never restore state.
   *  - Applied plans are NOT discarded.
   *  - No clipboard/source retained.
   */
  cancel(): void {
    this.operationGeneration += 1;

    const plan = this.planFromState(this.stateValue);
    this.stateValue = { status: "idle" };

    if (plan !== undefined) {
      this.discardPlanIfNeeded(plan);
    }
  }

  /** Extract a plan from state for discard purposes. Returns undefined when no
   *  discardable plan is retained (applied plans are excluded here as well). */
  private planFromState(state: PasteExternalJavaClassState): RefactorKitPatchPlan | undefined {
    if (state.status === "preview") return state.plan;
    if (state.status === "refused" && "plan" in state) return state.plan;
    return undefined;
  }

  /** Fire-and-forget: never awaited, never restores state, failures redacted. */
  private discardPlanIfNeeded(plan: RefactorKitPatchPlan): void {
    if (!plan.planId) return;

    const request: DiscardRefactorKitPlanRequest = {
      planId: plan.planId,
      workspaceId: plan.workspaceId,
      workspaceGeneration: plan.workspaceGeneration,
      selectionGeneration: plan.selectionGeneration,
      requestId: plan.requestId,
    };

    try {
      // Runtime compatibility only: older structural test doubles may predate the
      // required port method. Production RefactorKitPort implementations must provide it.
      const discardPlan = this.refactorKit.discardPlan;
      if (typeof discardPlan !== "function") return;

      const pending = discardPlan.call(this.refactorKit, request);
      void Promise.resolve(pending).catch(() => {
        // Discard failures are non-fatal and redacted.
        // The plan may already be invalidated server-side.
      });
    } catch {
      // A legacy or malformed adapter may throw before returning a promise.
      // Cancellation and privacy invalidation must still remain synchronous.
    }
  }

  private isCurrent(operation: number): boolean {
    return operation === this.operationGeneration;
  }

  private setIfCurrent(
    operation: number,
    state: PasteExternalJavaClassState,
  ): PasteExternalJavaClassState {
    if (this.isCurrent(operation)) this.stateValue = state;
    return this.stateValue;
  }
}
