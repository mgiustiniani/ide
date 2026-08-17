// ---------------------------------------------------------------------------
// @ide/ui – Public API
// ---------------------------------------------------------------------------
// Re‑export all UI components and types from a single entry point.

// UI primitives
export * from "./components/ui";

// Domain components
export * from "./components/FileTree";
export * from "./components/ExternalJavaImportPreviewDialog";
export * from "./components/Editor";
export * from "./components/Terminal";
export * from "./components/SettingsPanel";
export * from "./components/AiAgentPanel";
export * from "./components/AiAgentResponsePanel";
export * from "./components/PiWorkspaceAgentScreen";
export * from "./components/DocumentPreviewPanel";
export * from "./components/DocumentSplitPane/DocumentSplitPane";
export * from "./components/Editor/documentLanguages";
export * from "./components/JavaIntelligencePanel";
export * from "./components/RefactorKitLanguageLab";
export * from "./components/ProblemsPanel";
export * from "./components/Xcom2SetupPanel";
export * from "./components/Xcom2ModuleConfigurationDiagnosticAlert";
export * from "./components/Xcom2ProjectRecognitionPanel";
export * from "./components/Xcom2ProjectFoundryDialog";
export * from "./components/WorkspaceExplorer";
export * from "./components/SemanticSymbolSearchPanel";
export type { WorkspaceInfo, WorkspaceRegistry } from "@ide/contracts";

// WelcomePage – re-export explicitly
// (exported from Editor index)
export { WelcomePage } from "./components/Editor";
export type { WelcomePageProps } from "./components/Editor";

// PanelLayout – re-export explicitly to avoid StatusBar name conflict
export {
  PanelLayout,
  LeftSidebar,
  BottomPanel,
  StatusBar as PanelStatusBar,
} from "./components/PanelLayout";
export type {
  PanelLayoutActivity,
  PanelLayoutActivityContribution,
  PanelLayoutProps,
  LeftSidebarProps,
  BottomPanelBadgeMetadata,
  BottomPanelProps,
  BottomPanelTab,
  StatusBarProps as PanelStatusBarProps,
} from "./components/PanelLayout";

// Styles
import "./styles/globals.css";
