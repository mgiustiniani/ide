// ---------------------------------------------------------------------------
// apps/desktop/src/App.tsx
// Desktop app shell for the IDE. Creates store instances, view models,
// and Tauri adapters; wires them together; renders PanelLayout with
// FileTree, Editor, and Terminal.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from "react";
import type { BottomPanelTab, PanelLayoutActivity } from "@ide/ui";

// ── Store creation ──────────────────────────────────────────────────────
import { createFileTreeStore } from "@ide/web-core/state";
import { createEditorStore } from "@ide/web-core/state";
import { createTerminalStore } from "@ide/web-core/state";
import { createPanelStore } from "@ide/web-core/state";

// ── View models ─────────────────────────────────────────────────────────
import { FileTreeViewModel } from "@ide/web-core/view-models";
import { EditorViewModel } from "@ide/web-core/view-models";
import { TerminalViewModel } from "@ide/web-core/view-models";

// ── Adapters ─────────────────────────────────────────────────────────────
// Tauri adapter factory (desktop-only bridge to Rust commands).
import { createTauriAdapters } from "./adapters";
import { useDesktopEditorController } from "./features/editor/useDesktopEditorController";
import { useEditorCommandController } from "./features/editor/useEditorCommandController";
import { useFileExplorerController } from "./features/editor/useFileExplorerController";
import { useDocumentNavigationController } from "./features/document/useDocumentNavigationController";
import { useDesktopShellController } from "./features/shell/useDesktopShellController";
import {
  useSettingsController,
  useSettingsOpenCoordinator,
} from "./features/shell/useSettingsController";
import { useTerminalController } from "./features/terminal/useTerminalController";
import { useJavaLanguageController } from "./features/java/useJavaLanguageController";
import { useAiAgentController } from "./features/ai-agent/useAiAgentController";
import {
  REFACTOR_KIT_IMPORT_UNAVAILABLE,
  useRefactorKitImportController,
} from "./features/refactorkit-import/useRefactorKitImportController";
import { useRefactorKitStatusController } from "./features/refactorkit-status/useRefactorKitStatusController";
import { useRefactorKitSymbolNavigationController } from "./features/refactorkit-symbol-navigation/useRefactorKitSymbolNavigationController";
import {
  useWorkspaceController,
  type WorkspaceControllerCollaborators,
} from "./features/workspace/useWorkspaceController";
import {
  useXcom2SetupController,
  type Xcom2SetupEventSources,
} from "./features/xcom2-setup/useXcom2SetupController";

// ── UI Components ────────────────────────────────────────────────────────
import { PanelLayout } from "@ide/ui";
import { LeftSidebar } from "@ide/ui";
import { BottomPanel } from "@ide/ui";
import { FileTree } from "@ide/ui";
import { WorkspaceExplorer } from "@ide/ui";
import { Editor } from "@ide/ui";
import { DocumentPreviewPanel } from "@ide/ui";
import { Terminal } from "@ide/ui";
import { SettingsPanel } from "@ide/ui";
import { AiAgentPanel } from "@ide/ui";
import { AiAgentResponsePanel } from "@ide/ui";
import { Icon } from "@ide/ui";
import { ProblemsPanel } from "@ide/ui";
import { ExternalJavaImportPreviewDialog } from "@ide/ui";
import { SemanticSymbolSearchPanel } from "@ide/ui";

// ── Store hooks ──────────────────────────────────────────────────────────
// Zustand stores are created once and exposed as singletons for the app.
// Components subscribe via the generated hook selectors below.

// Create singleton stores (called once at module scope).
const fileTreeStore = createFileTreeStore();
const editorStore = createEditorStore();
const terminalStore = createTerminalStore();
const panelStore = createPanelStore();

// Create singleton adapters.
const {
  fileTreeAdapter,
  editorAdapter,
  terminalAdapter,
  aiAgentAdapter,
  workspaceAdapter,
  clipboardAdapter,
  refactorKitAdapter,
  languageSessionAdapter,
  documentSyncAdapter,
  javaIntelligenceAdapter,
  xcom2SetupAdapter,
  xcom2SetupMonitorAdapter,
} = createTauriAdapters();

const xcom2SetupEventSources: Xcom2SetupEventSources = {
  subscribeMonitor: (listener) => xcom2SetupMonitorAdapter.subscribe(listener),
  subscribeTransactions: (listener) => xcom2SetupAdapter.subscribe({}, listener),
};

// Create singleton view models.
const fileTreeViewModel = new FileTreeViewModel(fileTreeStore.getState, fileTreeAdapter);
const editorViewModel = new EditorViewModel(editorStore.getState, editorAdapter);
const terminalViewModel = new TerminalViewModel(terminalStore.getState, terminalAdapter);

// ── Hook wrappers ────────────────────────────────────────────────────────

/**
 * Hook that subscribes to file-tree store state.
 * Re-renders the component when relevant state changes.
 */
function useFileTreeState() {
  const rootNodes = fileTreeStore((s) => s.rootNodes);
  const expandedPaths = fileTreeStore((s) => s.expandedPaths);
  const selectedFilePath = fileTreeStore((s) => s.selectedFilePath);
  const isLoading = fileTreeStore((s) => s.isLoading);

  return { rootNodes, expandedPaths, selectedFilePath, isLoading };
}

/**
 * Hook that subscribes to editor store state.
 */
function useEditorState() {
  const activeFilePath = editorStore((s) => s.activeFilePath);
  const tabs = editorStore((s) => s.tabs);
  const contents = editorStore((s) => s.contents);
  const openFiles = editorStore((s) => s.openFiles);

  return { activeFilePath, tabs, contents, openFiles };
}

/**
 * Hook that subscribes to terminal store state.
 */
function useTerminalState() {
  const output = terminalStore((s) => s.output);
  const commandHistory = terminalStore((s) => s.commandHistory);
  const isSessionActive = terminalStore((s) => s.isSessionActive);
  const isLoading = terminalStore((s) => s.isLoading);
  const currentInput = terminalStore((s) => s.currentInput);
  const cols = terminalStore((s) => s.cols);
  const rows = terminalStore((s) => s.rows);

  return {
    output,
    commandHistory,
    isSessionActive,
    isLoading,
    currentInput,
    cols,
    rows,
  };
}

/**
 * Hook that subscribes to panel layout store state.
 */
function usePanelState() {
  const layout = panelStore((s) => s.layout);
  return { layout };
}

// ── App Component ────────────────────────────────────────────────────────

export function App(): JSX.Element {
  // Subscribe to stores.
  const fileTreeState = useFileTreeState();
  const editorState = useEditorState();
  const terminalState = useTerminalState();
  const panelState = usePanelState();
  const workspaceCollaboratorsRef = useRef<WorkspaceControllerCollaborators | null>(null);
  const [activeActivity, setActiveActivity] = useState<PanelLayoutActivity>("explorer");
  const settings = useSettingsController();

  const refactorKitStatus = useRefactorKitStatusController({
    refactorKit: refactorKitAdapter,
    deferWorkspaceActivation: true,
  });
  const workspace = useWorkspaceController({
    workspace: workspaceAdapter,
    collaboratorsRef: workspaceCollaboratorsRef,
  });
  const {
    workspaceInfo,
    workspaceRegistry,
    isLoading: isWorkspaceLoading,
    switchingWorkspaceId,
    error: workspaceError,
    refresh: loadWorkspaceMetadata,
    switchWorkspace: handleSwitchWorkspace,
  } = workspace;

  const aiAgent = useAiAgentController({
    aiAgent: aiAgentAdapter,
    workspaceInfo,
    isWorkspaceLoading,
    deferWorkspaceActivation: true,
  });
  const {
    settings: aiAgentSettings,
    status: aiAgentStatus,
    commands: aiAgentCommands,
    isCommandsLoading: isAiAgentCommandsLoading,
    commandsError: aiAgentCommandsError,
    messages: aiAgentMessages,
    panelMessages: aiAgentPanelMessages,
    latestResponse: aiAgentLatestResponse,
    activities: aiAgentActivities,
    isResponsePanelVisible: isAiAgentResponsePanelVisible,
    isSending: isAiAgentSending,
    sendError: aiAgentSendError,
    isInitialLoading: aiAgentInitialLoading,
    initialError: aiAgentInitialError,
    panelError: aiAgentPanelError,
    isEnabled: isAiAgentEnabled,
    isAvailable: isAiAgentAvailable,
    workspaceCollaborator: aiAgentWorkspaceCollaborator,
    loadConfiguration: loadAiAgentConfiguration,
    loadCommands: loadAiAgentCommands,
    refreshStatus: handleRefreshAiAgentStatus,
    saveSettings: handleSaveAiAgentSettings,
    installPiAgent: handleInstallPiAgent,
    sendPrompt: handleSendAiAgentPrompt,
    closeResponsePanel: handleCloseAiAgentResponsePanel,
  } = aiAgent;

  const desktopEditorController = useDesktopEditorController({
    editorViewModel,
    fileTreeViewModel,
    editorState,
    getEditorState: editorStore.getState,
    getWorkspaceContext: workspace.getContext,
    clearFileTreeSelection: () => fileTreeStore.getState().setSelectedFilePath(null),
    resetEditorBuffers: () => {
      for (const openFile of [...editorStore.getState().openFiles]) {
        editorStore.getState().closeFile(openFile.filePath);
      }
    },
    deferSessionRestore: true,
  });

  /** Ready/opening/error presentation comes from the desktop editor controller. */
  const {
    diagnostic: editorDiagnostic,
    readyActiveFilePath: activeFilePath,
    activeContent,
    activeLanguage,
    editorFilePath,
    isEditorLoading: isEditorOpening,
  } = desktopEditorController;

  const readyActiveDocument = useMemo(
    () => (activeFilePath ? { path: activeFilePath, text: activeContent } : null),
    [activeContent, activeFilePath],
  );
  const javaLanguage = useJavaLanguageController({
    languageSession: languageSessionAdapter,
    documentSync: documentSyncAdapter,
    javaIntelligence: javaIntelligenceAdapter,
    workspaceInfo,
    workspaceGeneration: workspace.generation,
    getEditorState: editorStore.getState,
    readyActiveDocument,
  });

  const refactorKitImport = useRefactorKitImportController({
    clipboard: clipboardAdapter,
    refactorKit: refactorKitAdapter,
    fileTree: fileTreeViewModel,
    workspaceId: workspace.currentWorkspaceId,
    getWorkspaceGeneration: workspace.getGeneration,
    openResultFile: desktopEditorController.openFileProgrammatically,
  });

  const xcom2Setup = useXcom2SetupController({
    monitor: xcom2SetupMonitorAdapter,
    transactions: xcom2SetupAdapter,
    events: xcom2SetupEventSources,
    currentWorkspaceId: workspace.currentWorkspaceId,
    isHistoryVisible: settings.isOpen,
    deferWorkspaceActivation: true,
  });
  const {
    snapshot: xcom2SetupSnapshot,
    plan: xcom2SetupPlan,
    isLoading: isXcom2SetupLoading,
    error: xcom2SetupError,
    isStale: isXcom2SetupStale,
    transaction: xcom2SetupTransaction,
    transactions: xcom2SetupTransactions,
    isTransactionLoading: isXcom2SetupTransactionLoading,
    transactionError: xcom2SetupTransactionError,
    transactionProgressEvent: xcom2SetupTransactionProgressEvent,
    workspaceCollaborator: xcom2SetupWorkspaceCollaborator,
    refresh: handleRefreshXcom2Setup,
    planSetup: handlePlanXcom2Setup,
    prepare: handlePrepareXcom2Setup,
    apply: handleApplyXcom2Setup,
    cancel: handleCancelXcom2Setup,
    rollback: handleRollbackXcom2Setup,
    recover: handleRecoverXcom2Setup,
    refreshHistory: loadXcom2SetupTransactions,
  } = xcom2Setup;

  const {
    activeDiagnostics,
    activeDiagnosticDocument,
    activeDiagnosticOwner,
    problemItems,
    hasJavaContext,
    javaSemantics,
  } = javaLanguage;

  const terminal = useTerminalController({
    viewModel: terminalViewModel,
    session: terminalAdapter,
    getStore: terminalStore.getState,
  });
  const fileExplorer = useFileExplorerController({
    fileTree: fileTreeViewModel,
    editor: desktopEditorController,
    getSelectedDirectoryPath: refactorKitImport.getSelectedDirectoryPath,
  });
  const documentNavigation = useDocumentNavigationController({
    displayedFilePath: activeFilePath,
    openFileProgrammatically: desktopEditorController.openFileProgrammatically,
  });
  const refactorKitSymbolNavigation = useRefactorKitSymbolNavigationController({
    refactorKit: refactorKitAdapter,
    status: refactorKitStatus.status,
    capabilities: refactorKitStatus.capabilities,
    isCheckingCapabilities: refactorKitStatus.isChecking,
    workspaceInfo,
    workspaceGeneration: workspace.generation,
    getWorkspaceContext: workspace.getContext,
    getRelevantBuffers: () => {
      const state = editorStore.getState();
      return state.openFiles
        .filter(({ filePath, language }) => {
          const normalizedLanguage = language.toLowerCase();
          return (
            normalizedLanguage === "typescript" ||
            normalizedLanguage === "javascript" ||
            /\.(?:[cm]?[jt]sx?)$/iu.test(filePath)
          );
        })
        .map(({ filePath, language }) => ({
          path: filePath,
          languageId:
            language.toLowerCase() === "javascript" || /\.(?:cjs|mjs|jsx|js)$/iu.test(filePath)
              ? ("javascript" as const)
              : ("typescript" as const),
          savedState: "saved" as const,
          dirty: state.tabs.find((tab) => tab.filePath === filePath)?.isDirty ?? false,
        }));
    },
    navigateToPoint: (filePath, point) =>
      documentNavigation.navigateToLocation(filePath, { kind: "point", point }),
  });
  const editorCommands = useEditorCommandController({
    activeFilePath: editorState.activeFilePath,
    activeContent,
    hasJavaContext,
    workspaceId: workspaceInfo?.id ?? null,
    getEditorState: editorStore.getState,
    editor: editorViewModel,
    desktopEditor: desktopEditorController,
    documents: javaLanguage,
  });
  const shell = useDesktopShellController({
    getPanelActions: panelStore.getState,
    loadAiAgentCommands,
    hasJavaContext,
    problemItems,
  });
  const handleOpenSettings = useSettingsOpenCoordinator({
    open: settings.open,
    loadAiAgentConfiguration,
    loadAiAgentCommands,
    loadWorkspaceMetadata,
    refreshJavaLanguage: javaLanguage.refresh,
    refreshRefactorKitStatus: refactorKitStatus.refresh,
    refreshXcom2Setup: handleRefreshXcom2Setup,
  });

  workspaceCollaboratorsRef.current = {
    editor: {
      resetWorkspace: desktopEditorController.resetWorkspace,
      restoreWorkspace: desktopEditorController.restoreWorkspace,
    },
    java: {
      detach: javaLanguage.detach,
      attach: javaLanguage.attach,
      load: (workspaceId, workspaceGeneration) =>
        javaLanguage.load(workspaceId, workspaceGeneration),
    },
    refactorKitImport: {
      resetWorkspace: refactorKitImport.resetWorkspace,
    },
    refactorKitStatus: refactorKitStatus.workspaceCollaborator,
    semanticSymbols: refactorKitSymbolNavigation.workspaceCollaborator,
    xcom: xcom2SetupWorkspaceCollaborator,
    ai: aiAgentWorkspaceCollaborator,
    shell: {
      clearClosedPreviews: documentNavigation.clearClosedPreviews,
      resetTerminal: terminal.resetWorkspace,
      loadFileTree: () => fileTreeViewModel.loadRoot(),
    },
  };

  // ── Derived values ──────────────────────────────────────────────────

  /** Bottom panel tabs configuration. */
  const bottomTabs: BottomPanelTab[] = [
    {
      id: "terminal",
      label: "Terminal",
      icon: <Icon type="terminal" size={14} />,
      title: "Integrated terminal",
      scope: "core",
      isActive: shell.activeBottomTab === "terminal",
    },
    {
      id: "ai-agent",
      label: "AI Agent",
      icon: <Icon type="circle-filled" size={10} />,
      title: "AI coding agent",
      scope: "core",
      isActive: shell.activeBottomTab === "ai-agent",
    },
    ...(shell.shouldShowProblems
      ? [
          {
            id: "problems",
            label: "Problems",
            icon: <Icon type="circle-filled" size={10} />,
            title: "Java problems in the current project",
            scope: "project" as const,
            isActive: shell.activeBottomTab === "problems",
            badge: {
              count: problemItems.length,
              severity: shell.problemSeverity,
              ariaLabel: `${problemItems.length} ${problemItems.length === 1 ? "problem" : "problems"}`,
            },
          },
        ]
      : []),
  ];
  const currentWorkspaceId = workspaceInfo?.id ?? workspaceRegistry?.currentWorkspaceId ?? null;
  const displayedLanguageServiceStatus = javaLanguage.status;
  const workspaceHeaderLabel = isWorkspaceLoading
    ? "Workspace: loading…"
    : workspaceInfo
      ? `Workspace: ${workspaceInfo.name}`
      : null;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div
      className="h-full w-full dark flex flex-col"
      style={{ background: "var(--surface-background)" }}
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-header)] px-3 text-sm text-[var(--text-primary)]">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-wide">IDE</span>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
            onClick={handleOpenSettings}
          >
            Settings
          </button>
        </div>
        <div
          className="flex min-w-0 items-center gap-3 text-xs text-[var(--text-muted)]"
          aria-live="polite"
        >
          {workspaceHeaderLabel ? (
            <span className="max-w-[18rem] truncate" title={workspaceInfo?.rootPath}>
              {workspaceHeaderLabel}
            </span>
          ) : null}
          {aiAgentInitialLoading ? (
            <span role="status">Loading Pi Agent…</span>
          ) : aiAgentInitialError ? (
            <span role="alert" className="text-red-300">
              Pi Agent: {aiAgentInitialError}
            </span>
          ) : (
            <span>Pi Agent: {aiAgentStatus?.availability ?? "not checked"}</span>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <PanelLayout
          layout={panelState.layout}
          activeActivity={activeActivity}
          onActivityChange={setActiveActivity}
          searchActivityContent={
            <SemanticSymbolSearchPanel
              language={refactorKitSymbolNavigation.language}
              query={refactorKitSymbolNavigation.query}
              toolchainPaths={refactorKitSymbolNavigation.toolchainPaths}
              approvedForSession={refactorKitSymbolNavigation.approvedForSession}
              snapshotState={refactorKitSymbolNavigation.snapshotState}
              evidenceState={refactorKitSymbolNavigation.evidenceState}
              availability={refactorKitSymbolNavigation.availability}
              availabilityReason={refactorKitSymbolNavigation.availabilityReason}
              results={refactorKitSymbolNavigation.results}
              resultLimit={refactorKitSymbolNavigation.resultLimit}
              isBusy={refactorKitSymbolNavigation.isBusy}
              canSubmit={refactorKitSymbolNavigation.canSubmit}
              error={refactorKitSymbolNavigation.error}
              refusal={refactorKitSymbolNavigation.refusal}
              onLanguageChange={refactorKitSymbolNavigation.setLanguage}
              onQueryChange={refactorKitSymbolNavigation.setQuery}
              onToolchainPathChange={refactorKitSymbolNavigation.setToolchainPath}
              onApprovalChange={refactorKitSymbolNavigation.setApprovedForSession}
              onSubmit={refactorKitSymbolNavigation.submit}
              onCancel={refactorKitSymbolNavigation.cancel}
              onStop={refactorKitSymbolNavigation.stop}
              onResultSelect={refactorKitSymbolNavigation.selectResult}
            />
          }
          onResizeLeft={shell.resizeLeft}
          onResizeBottom={shell.resizeBottom}
          leftSidebar={
            <LeftSidebar
              title="Explorer"
              isVisible={panelState.layout.visibility.leftSidebar.visible}
              onToggle={shell.toggleLeftSidebar}
              workspaceContent={
                <WorkspaceExplorer
                  registry={workspaceRegistry}
                  currentWorkspaceId={currentWorkspaceId}
                  currentWorkspace={workspaceInfo}
                  onSwitchWorkspace={(workspaceId) => {
                    void handleSwitchWorkspace(workspaceId).catch(() => undefined);
                  }}
                  onRefresh={loadWorkspaceMetadata}
                  isLoading={isWorkspaceLoading}
                  isSwitching={switchingWorkspaceId !== null}
                  switchingWorkspaceId={switchingWorkspaceId}
                  error={workspaceError}
                />
              }
            >
              <FileTree
                nodes={fileTreeState.rootNodes}
                expandedPaths={fileTreeState.expandedPaths}
                selectedFilePath={fileTreeState.selectedFilePath}
                onSelect={desktopEditorController.selectTreeFile}
                onToggle={fileExplorer.toggleFolder}
                selectedDirectoryPath={refactorKitImport.selectedDirectoryPath}
                focusedDirectoryPath={refactorKitImport.focusedDirectoryPath}
                onSelectDirectory={refactorKitImport.selectDirectory}
                onFocusDirectory={refactorKitImport.focusDirectory}
                onPasteJavaClass={(node) => {
                  void refactorKitImport.previewFromClipboard(node);
                }}
              />
            </LeftSidebar>
          }
          mainContent={
            <div className="h-full min-h-0 flex flex-col">
              {refactorKitImport.successMessage ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="border-b border-green-500/40 bg-green-950/40 px-3 py-2 text-sm text-green-100"
                >
                  {refactorKitImport.successMessage}
                </div>
              ) : null}
              {editorDiagnostic ? (
                <div
                  role="alert"
                  className="border-b border-red-500/40 bg-red-950/40 px-3 py-2 text-sm text-red-100"
                >
                  <strong>Problema apertura file:</strong> {editorDiagnostic.filePath} —{" "}
                  {editorDiagnostic.message}
                </div>
              ) : null}
              <div className="min-h-0 flex flex-1 overflow-hidden">
                <div className="min-w-0 flex-1">
                  <Editor
                    content={activeContent}
                    language={activeLanguage}
                    onChange={editorCommands.changeContent}
                    filePath={editorFilePath}
                    isLoading={isEditorOpening}
                    tabs={editorState.tabs}
                    onTabActivate={editorCommands.activateTab}
                    onTabClose={editorCommands.closeTab}
                    revealRequest={documentNavigation.editorRevealRequest}
                    diagnostics={activeDiagnostics}
                    documentIdentity={activeDiagnosticDocument}
                    diagnosticOwner={activeDiagnosticOwner}
                    javaSemantics={javaSemantics}
                    onCreateNewFile={fileExplorer.createFile}
                    createFileTargetLabel={
                      refactorKitImport.selectedDirectoryPath ?? "Workspace root"
                    }
                  />
                </div>
                {documentNavigation.preview.isVisible && documentNavigation.preview.filePath ? (
                  <div className="min-h-0 w-[38%] min-w-[320px] max-w-[560px] shrink-0 border-l border-[var(--border-default)]">
                    <DocumentPreviewPanel
                      content={activeContent}
                      kind={documentNavigation.preview.kind}
                      filePath={documentNavigation.preview.filePath}
                      onClose={documentNavigation.closeDisplayedPreview}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          }
          rightSidebarAriaLabel="AI Agent response panel"
          rightSidebarContent={
            isAiAgentResponsePanelVisible ? (
              <AiAgentResponsePanel
                latestResponse={aiAgentLatestResponse}
                messages={aiAgentMessages}
                activities={aiAgentActivities}
                isSending={isAiAgentSending}
                error={aiAgentSendError}
                onClose={handleCloseAiAgentResponsePanel}
              />
            ) : undefined
          }
          bottomContent={
            <BottomPanel tabs={bottomTabs} onTabActivate={shell.activateBottomTab}>
              {shell.activeBottomTab === "terminal" ? (
                <Terminal
                  output={terminalState.output}
                  onCommand={terminal.executeCommand}
                  isSessionActive={terminalState.isSessionActive}
                  currentInput={terminalState.currentInput}
                  onInputChange={terminal.updateInput}
                  isLoading={terminalState.isLoading}
                  cols={terminalState.cols}
                  rows={terminalState.rows}
                  commandHistory={terminalState.commandHistory}
                  onClear={terminal.clear}
                />
              ) : shell.activeBottomTab === "problems" ? (
                <ProblemsPanel
                  items={problemItems}
                  onNavigate={documentNavigation.navigateToProblem}
                  emptyMessage="No Java problems detected in this project."
                />
              ) : (
                <AiAgentPanel
                  messages={aiAgentPanelMessages}
                  isEnabled={isAiAgentEnabled}
                  isAvailable={isAiAgentAvailable}
                  isSending={isAiAgentSending}
                  error={aiAgentPanelError}
                  commands={aiAgentCommands}
                  isLoadingCommands={isAiAgentCommandsLoading}
                  commandsError={aiAgentCommandsError}
                  onRefreshCommands={loadAiAgentCommands}
                  onSendPrompt={handleSendAiAgentPrompt}
                  onOpenSettings={handleOpenSettings}
                />
              )}
            </BottomPanel>
          }
        />
      </div>
      {refactorKitImport.dialog ? (
        <ExternalJavaImportPreviewDialog
          status={refactorKitImport.dialog.status}
          selectedTargetDirectory={refactorKitImport.dialog.targetDirectory}
          plan={refactorKitImport.dialog.plan}
          result={refactorKitImport.dialog.result}
          unavailableReason={
            refactorKitImport.dialog.status === "unavailable"
              ? REFACTOR_KIT_IMPORT_UNAVAILABLE
              : undefined
          }
          errorMessage={refactorKitImport.dialog.message}
          onCancel={refactorKitImport.cancel}
          onApply={(plan) => {
            void refactorKitImport.applyDisplayedPlan(plan);
          }}
        />
      ) : null}
      <SettingsPanel
        isOpen={settings.isOpen}
        aiAgentSettings={aiAgentSettings}
        aiAgentStatus={aiAgentStatus}
        workspaceInfo={workspaceInfo}
        workspaceRegistry={workspaceRegistry}
        workspaceError={workspaceError}
        javaLanguageServiceStatus={displayedLanguageServiceStatus}
        isJavaLanguageServiceRefreshing={javaLanguage.refreshing}
        javaRefactorKitStatus={refactorKitStatus.status}
        javaRefactorKitCapabilities={refactorKitStatus.capabilities}
        isJavaRefactorKitChecking={refactorKitStatus.isChecking}
        javaRefactorKitError={refactorKitStatus.error}
        xcom2SetupSnapshot={xcom2SetupSnapshot}
        xcom2SetupPlan={xcom2SetupPlan}
        isXcom2SetupLoading={isXcom2SetupLoading}
        xcom2SetupError={xcom2SetupError}
        isXcom2SetupStale={isXcom2SetupStale}
        xcom2SetupTransaction={xcom2SetupTransaction}
        xcom2SetupTransactions={xcom2SetupTransactions}
        isXcom2SetupTransactionLoading={isXcom2SetupTransactionLoading}
        xcom2SetupTransactionError={xcom2SetupTransactionError}
        xcom2SetupTransactionProgressEvent={xcom2SetupTransactionProgressEvent}
        onClose={settings.close}
        onRefreshStatus={handleRefreshAiAgentStatus}
        onRefreshWorkspace={loadWorkspaceMetadata}
        onSwitchWorkspace={handleSwitchWorkspace}
        onStartJavaLanguageService={javaLanguage.start}
        onStopJavaLanguageService={javaLanguage.stop}
        onRestartJavaLanguageService={javaLanguage.restart}
        onRefreshJavaLanguageService={javaLanguage.refresh}
        onRefreshJavaRefactorKit={refactorKitStatus.refresh}
        onRefreshXcom2Setup={handleRefreshXcom2Setup}
        onPlanXcom2Setup={handlePlanXcom2Setup}
        onPrepareXcom2Setup={handlePrepareXcom2Setup}
        onApplyXcom2Setup={handleApplyXcom2Setup}
        onCancelXcom2Setup={handleCancelXcom2Setup}
        onRollbackXcom2Setup={handleRollbackXcom2Setup}
        onRecoverXcom2Setup={handleRecoverXcom2Setup}
        onRefreshXcom2SetupHistory={loadXcom2SetupTransactions}
        onSaveAiAgentSettings={handleSaveAiAgentSettings}
        onInstallPiAgent={handleInstallPiAgent}
      />
    </div>
  );
}
