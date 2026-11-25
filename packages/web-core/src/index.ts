// ---------------------------------------------------------------------------
// @ide/web-core – Public API
// ---------------------------------------------------------------------------

export * from "./ports";
export { ChangesReviewService } from "./services/changes-review-service";
export {
  executeJavaEditorRefactoring,
  JavaEditorTransactionError,
} from "./services/java-editor-refactoring";
export type { JavaEditorRefactoringOutcome } from "./services/java-editor-refactoring";
export {
  reviewJavaEditorRecovery,
  restoreJavaEditorRecovery,
} from "./services/java-editor-recovery";
export type { JavaEditorRecoveryReview } from "./services/java-editor-recovery";
export * from "./state";
export * from "./view-models";
export * from "./xcom2";
export * from "./paste-external-java-class";
export * from "./editor-open-coordinator";
export * from "@ide/contracts";
