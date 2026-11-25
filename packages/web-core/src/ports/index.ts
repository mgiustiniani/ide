// ---------------------------------------------------------------------------
// @ide/web-core – Ports Public API
// ---------------------------------------------------------------------------

export type { FileTreePort } from "./file-tree-port";
export type { WorkspaceFileSearchPort } from "./workspace-file-search-port";
export type { EditorPort } from "./editor-port";
export type { EditorRecoveryPort } from "./editor-recovery-port";
export type { TerminalPort } from "./terminal-port";
export type { WorkspacePort } from "./workspace-port";
export type { AiAgentPort } from "./ai-agent-port";
export type { PiWorkspaceAgentPort, PiWorkspaceAgentUnsubscribe } from "./pi-workspace-agent-port";
export type { ClipboardPort } from "./clipboard-port";
export type { RefactorKitPort } from "./refactorkit-port";
export { RefactorRollbackNotStartedError } from "./refactorkit-port";
export type { LanguageSessionPort } from "./language-session-port";
export type { DocumentSyncPort } from "./document-sync-port";
export type { JavaIntelligencePort } from "./java-intelligence-port";
export type { JavaLspRefactoringPort } from "./java-lsp-refactoring-port";
export type { JavaExecutionPort } from "./java-execution-port";
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
export type { JavaNavigationPort } from "./java-navigation-port";
export type { JavaEditorDiagnosticsPort } from "./java-editor-diagnostics-port";
export type { JavaDependencySourcePort } from "./java-dependency-source-port";
export type { JavaPlatformSourcePort } from "./java-platform-source-port";
export type {
  JavaProjectContextChangeEvent,
  JavaProjectContextPort,
} from "./java-project-context-port";
export type { JavaProjectScaffoldPort } from "./java-project-scaffold-port";
export type { JavaProjectPathPickerPort } from "./java-project-path-picker-port";
export type { JavaProjectTextSearchPort } from "./java-project-text-search-port";
export type {
  EditorOpenRangeDriver,
  EditorOpenRangePort,
  RangeOpenOutcome,
} from "./editor-open-range-port";
export { DefaultEditorOpenRangePort } from "./editor-open-range-port";
export type { WorkspaceTerminalPort } from "./workspace-terminal-port";
export type { HttpClientPort } from "./http-client-port";
export type { JavaDatabasePort } from "./java-database-port";
export type { GitWorkspacePort } from "./git-workspace-port";

export { JavaProjectContextRetiredError } from "./java-project-context-port";
export type { JavaEntryPointPort } from "./java-entry-point-port";
export type { JavaProjectDeclarationPort } from "./java-project-declaration-port";
