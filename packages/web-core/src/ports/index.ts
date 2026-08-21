// ---------------------------------------------------------------------------
// @ide/web-core – Ports Public API
// ---------------------------------------------------------------------------

export type { FileTreePort } from "./file-tree-port";
export type { EditorPort } from "./editor-port";
export type { TerminalPort } from "./terminal-port";
export type { WorkspacePort } from "./workspace-port";
export type { AiAgentPort } from "./ai-agent-port";
export type { PiWorkspaceAgentPort, PiWorkspaceAgentUnsubscribe } from "./pi-workspace-agent-port";
export type { ClipboardPort } from "./clipboard-port";
export type { RefactorKitPort } from "./refactorkit-port";
export type { LanguageSessionPort } from "./language-session-port";
export type { DocumentSyncPort } from "./document-sync-port";
export type { JavaIntelligencePort } from "./java-intelligence-port";
export type { Xcom2ModuleConfigurationPort } from "./xcom2-module-configuration-port";
export type { Xcom2ModuleScannerPort } from "./xcom2-module-scanner-port";
export type {
  Xcom2NativeActivationEvidenceBeginRequest,
  Xcom2NativeActivationEvidencePort,
} from "./xcom2-native-activation-evidence-port";
export type {
  Xcom2ProjectBuildRecipeInspectionPort,
  Xcom2ProjectBuildRecipeInspectionRequest,
} from "./xcom2-project-build-recipe-inspection-port";
export type { Xcom2SetupMonitorPort } from "./xcom2-setup-monitor-port";
export type { Xcom2SetupPort, Xcom2SetupSubscription } from "./xcom2-setup-port";
export type {
  DiffHunk,
  DiffRange,
  DiffReviewOutcome,
  HunkLevelDiff,
  WorkspaceChangesPort,
} from "./workspace-changes-port";
export type { ReadOnlyDiffPort } from "./read-only-diff-port";
export type {
  EditorOpenRangeDriver,
  EditorOpenRangePort,
  RangeOpenOutcome,
} from "./editor-open-range-port";
export { DefaultEditorOpenRangePort } from "./editor-open-range-port";
