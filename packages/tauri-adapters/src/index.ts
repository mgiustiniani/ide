// ---------------------------------------------------------------------------
// @ide/tauri-adapters – Public API
// ---------------------------------------------------------------------------
// Re-export all Tauri adapter implementations.
// ---------------------------------------------------------------------------

import { TauriFileTreeAdapter } from "./file-tree-tauri";
export { TauriJavaNavigationAdapter } from "./java-navigation-tauri";
export { TauriGitWorkspaceAdapter } from "./git-workspace-tauri";
export { TauriJavaProjectContextAdapter } from "./java-project-context-tauri";
export { TauriJavaProjectPathPickerAdapter } from "./java-project-path-picker-tauri";
export { TauriJavaProjectTextSearchAdapter } from "./java-project-text-search-tauri";
export { TauriJavaProjectScaffoldAdapter } from "./java-project-scaffold-tauri";
export {
  TauriJavaDatabaseAdapter,
  JAVA_DATABASE_INSPECT_COMMAND,
  JAVA_DATABASE_EXECUTE_COMMAND,
} from "./java-database-tauri";
import { TauriEditorAdapter } from "./editor-tauri";
import { TauriGitWorkspaceAdapter } from "./git-workspace-tauri";
import { TauriTerminalAdapter } from "./terminal-tauri";
import { TauriAiAgentAdapter } from "./ai-agent-tauri";
import { TauriPiWorkspaceAgentAdapter } from "./pi-workspace-agent-tauri";
import { TauriWorkspaceAdapter } from "./workspace-tauri";
import { TauriClipboardAdapter } from "./clipboard-tauri";
import {
  TauriWorkspaceChangesAdapter,
  TauriReadOnlyDiffAdapter,
  TauriEditorOpenRangeAdapter,
} from "./git-diff-review-tauri";
import { TauriRefactorKitAdapter } from "./refactorkit-tauri";
import { TauriLanguageSessionAdapter } from "./language-session-tauri";
import { TauriJavaIntelligenceAdapter } from "./java-intelligence-tauri";
import { TauriJavaLspRefactoringAdapter } from "./java-lsp-refactoring-tauri";
import { TauriXcom2ModuleConfigurationAdapter } from "./xcom2-module-configuration-tauri";
import { TauriXcom2ModuleScannerAdapter } from "./xcom2-module-scanner-tauri";
import { TauriXcom2SetupMonitorAdapter } from "./xcom2-setup-monitor-tauri";
import { TauriXcom2SetupAdapter } from "./xcom2-setup-tauri";
import { TauriXcom2NativeActivationEvidenceAdapter } from "./xcom2-native-activation-evidence-tauri";
import { TauriXcom2ProjectBuildRecipeInspectionAdapter } from "./xcom2-project-build-recipe-inspection-tauri";

export { TauriFileTreeAdapter } from "./file-tree-tauri";
export { TauriEditorAdapter } from "./editor-tauri";
export { TauriTerminalAdapter } from "./terminal-tauri";
export { TauriAiAgentAdapter } from "./ai-agent-tauri";
export {
  TauriPiWorkspaceAgentAdapter,
  PI_WORKSPACE_AGENT_COMMANDS,
  PI_WORKSPACE_AGENT_EVENTS,
} from "./pi-workspace-agent-tauri";
export { TauriWorkspaceAdapter } from "./workspace-tauri";
export { TauriClipboardAdapter, TauriClipboardReadError } from "./clipboard-tauri";
export {
  TauriWorkspaceChangesAdapter,
  TauriReadOnlyDiffAdapter,
  TauriEditorOpenRangeAdapter,
  GIT_DIFF_REVIEW_COMMANDS,
} from "./git-diff-review-tauri";
export {
  TauriRefactorKitAdapter,
  TauriRefactorKitManagedCommandError,
  TauriRefactorKitUpdateRequiredError,
} from "./refactorkit-tauri";
export {
  TauriLanguageSessionAdapter,
  TauriLanguageSessionAdapter as TauriDocumentSyncAdapter,
} from "./language-session-tauri";
export { TauriJavaIntelligenceAdapter } from "./java-intelligence-tauri";
export { TauriXcom2ModuleConfigurationAdapter } from "./xcom2-module-configuration-tauri";
export { TauriXcom2ModuleScannerAdapter } from "./xcom2-module-scanner-tauri";
export { TauriXcom2SetupMonitorAdapter } from "./xcom2-setup-monitor-tauri";
export type { Xcom2SetupMonitorPollOptions } from "./xcom2-setup-monitor-tauri";
export { TauriXcom2SetupAdapter } from "./xcom2-setup-tauri";
export type { Xcom2SetupPollOptions } from "./xcom2-setup-tauri";
export {
  TauriXcom2NativeActivationEvidenceAdapter,
  XCOM2_NATIVE_ACTIVATION_EVIDENCE_COMMANDS,
  createTauriXcom2NativeActivationEvidencePort,
} from "./xcom2-native-activation-evidence-tauri";
export {
  TauriXcom2ProjectBuildRecipeInspectionAdapter,
  XCOM2_PROJECT_BUILD_RECIPE_INSPECTION_COMMAND,
  createTauriXcom2ProjectBuildRecipeInspectionPort,
} from "./xcom2-project-build-recipe-inspection-tauri";
export {
  TauriXcom2ProjectFoundryAdapter,
  TauriProjectFoundryAdapter,
  TauriXcom2ProjectFoundryRendererAdapter,
  TauriProjectFoundryRendererAdapter,
  TauriProjectFoundrySelectionCancelledError,
  XCOM2_PROJECT_FOUNDRY_APPLY_COMMAND,
  XCOM2_PROJECT_FOUNDRY_COMMANDS,
  XCOM2_PROJECT_FOUNDRY_RENDERER_COMMANDS,
  createTauriXcom2ProjectFoundryComposition,
  createTauriProjectFoundryComposition,
  createTauriXcom2ProjectFoundryRendererComposition,
  createTauriProjectFoundryRendererComposition,
} from "./xcom2-project-foundry-tauri";
export type {
  TauriXcom2ProjectFoundryComposition,
  TauriXcom2ProjectFoundryNativeRenderResult,
  TauriXcom2ProjectFoundryRendererComposition,
} from "./xcom2-project-foundry-tauri";
export { TauriAdapterError, toTauriAdapterError } from "./errors";

/**
 * Factory function that returns all Tauri-based adapters.
 * Useful for app composition and tests that inject a complete adapter set.
 */
export function createTauriAdapters(): {
  gitWorkspaceAdapter: TauriGitWorkspaceAdapter;
  fileTreeAdapter: TauriFileTreeAdapter;
  editorAdapter: TauriEditorAdapter;
  terminalAdapter: TauriTerminalAdapter;
  aiAgentAdapter: TauriAiAgentAdapter;
  piWorkspaceAgentAdapter: TauriPiWorkspaceAgentAdapter;
  workspaceAdapter: TauriWorkspaceAdapter;
  workspaceChangesAdapter: TauriWorkspaceChangesAdapter;
  readOnlyDiffAdapter: TauriReadOnlyDiffAdapter;
  editorOpenRangeAdapter: TauriEditorOpenRangeAdapter;
  clipboardAdapter: TauriClipboardAdapter;
  refactorKitAdapter: TauriRefactorKitAdapter;
  languageSessionAdapter: TauriLanguageSessionAdapter;
  documentSyncAdapter: TauriLanguageSessionAdapter;
  javaIntelligenceAdapter: TauriJavaIntelligenceAdapter;
  javaLspRefactoringAdapter: TauriJavaLspRefactoringAdapter;
  xcom2ModuleConfigurationAdapter: TauriXcom2ModuleConfigurationAdapter;
  xcom2ModuleScannerAdapter: TauriXcom2ModuleScannerAdapter;
  xcom2SetupMonitorAdapter: TauriXcom2SetupMonitorAdapter;
  xcom2SetupAdapter: TauriXcom2SetupAdapter;
  xcom2NativeActivationEvidenceAdapter: TauriXcom2NativeActivationEvidenceAdapter;
  xcom2ProjectBuildRecipeInspectionAdapter: TauriXcom2ProjectBuildRecipeInspectionAdapter;
} {
  const languageSessionAdapter = new TauriLanguageSessionAdapter();
  return {
    gitWorkspaceAdapter: new TauriGitWorkspaceAdapter(),
    fileTreeAdapter: new TauriFileTreeAdapter(),
    editorAdapter: new TauriEditorAdapter(),
    terminalAdapter: new TauriTerminalAdapter(),
    aiAgentAdapter: new TauriAiAgentAdapter(),
    piWorkspaceAgentAdapter: new TauriPiWorkspaceAgentAdapter(),
    workspaceAdapter: new TauriWorkspaceAdapter(),
    workspaceChangesAdapter: new TauriWorkspaceChangesAdapter(),
    readOnlyDiffAdapter: new TauriReadOnlyDiffAdapter(),
    editorOpenRangeAdapter: new TauriEditorOpenRangeAdapter(),
    clipboardAdapter: new TauriClipboardAdapter(),
    refactorKitAdapter: new TauriRefactorKitAdapter(),
    languageSessionAdapter,
    documentSyncAdapter: languageSessionAdapter,
    javaIntelligenceAdapter: new TauriJavaIntelligenceAdapter(),
    javaLspRefactoringAdapter: new TauriJavaLspRefactoringAdapter(),
    xcom2ModuleConfigurationAdapter: new TauriXcom2ModuleConfigurationAdapter(),
    xcom2ModuleScannerAdapter: new TauriXcom2ModuleScannerAdapter(),
    xcom2SetupMonitorAdapter: new TauriXcom2SetupMonitorAdapter(),
    xcom2SetupAdapter: new TauriXcom2SetupAdapter(),
    xcom2NativeActivationEvidenceAdapter: new TauriXcom2NativeActivationEvidenceAdapter(),
    xcom2ProjectBuildRecipeInspectionAdapter: new TauriXcom2ProjectBuildRecipeInspectionAdapter(),
  };
}
export { TauriJavaEntryPointAdapter } from "./java-entry-point-tauri";
export { TauriJavaProjectDeclarationAdapter } from "./java-project-declaration-tauri";
export { TauriJavaEditorDiagnosticsAdapter } from "./java-editor-diagnostics-tauri";
