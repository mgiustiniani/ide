import { openSavedBlameLocation } from "./features/git-workspace/openSavedBlameLocation";
import type { EditorPoint } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { useNavigationHistoryShortcuts } from "./features/document/useNavigationHistoryShortcuts";
// ---------------------------------------------------------------------------
// apps/desktop/src/App.tsx
// Desktop app shell for the IDE. Creates store instances, view models,
// and Tauri adapters; wires them together; renders PanelLayout with
// FileTree, Editor, and Terminal.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BottomPanelTab, PanelLayoutActivity, PanelLayoutActivityContribution } from "@ide/ui";

// ── Contracts ────────────────────────────────────────────────────────────
import {
  nextDocumentViewMode,
  javaContextRefactoringOffered,
  javaMoveClassTargetModuleSelectionOffered,
  javaEditorMutationOffered,
  javaRefactoringMutationAuthorized,
  type JavaNavigationLocation,
  type JavaNavigationRequest,
  type JavaNavigationResult,
  type JavaReferenceLocation,
  type JavaReferencesResponse,
  type JavaDefinitionsResponse,
  type JavaCallHierarchyRequest,
  type JavaCallHierarchyResponse,
  type JavaRenameDocumentEdits,
  type JavaEditorWorkspaceEdit,
  type JavaLspRefactoringCapabilities,
  type JavaWorkspaceSymbol,
  type RefactorKitAffectedFile,
  type JavaSavedSourceRecoveryRequest,
  type RefactorKitStatus,
} from "@ide/contracts";

// ── Store creation ──────────────────────────────────────────────────────
import { createFileTreeStore } from "@ide/web-core/state";
import { createEditorStore } from "@ide/web-core/state";
import { createPanelStore } from "@ide/web-core/state";
import { mapXcom2ModuleConfigurationDiagnosticPresentation } from "@ide/web-core";

// ── View models ─────────────────────────────────────────────────────────
import { FileTreeViewModel } from "@ide/web-core/view-models";
import { EditorViewModel } from "@ide/web-core/view-models";

// ── Adapters ─────────────────────────────────────────────────────────────
// Tauri adapter factory (desktop-only bridge to Rust commands).
import { createTauriAdapters } from "./adapters";
import { TauriEditorOpenRangeAdapter } from "@ide/tauri-adapters";
import { TauriJavaExecutionAdapter } from "@ide/tauri-adapters/java-execution-tauri";
import { TauriJavaNavigationAdapter } from "@ide/tauri-adapters/java-navigation-tauri";
import { TauriJavaEditorDiagnosticsAdapter } from "@ide/tauri-adapters/java-editor-diagnostics-tauri";
import { TauriJavaDependencySourceAdapter } from "@ide/tauri-adapters/java-dependency-source-tauri";
import { TauriJavaPlatformSourceAdapter } from "@ide/tauri-adapters/java-platform-source-tauri";
import { TauriJavaProjectDeclarationAdapter } from "@ide/tauri-adapters/java-project-declaration-tauri";
import { TauriJavaProjectContextAdapter } from "@ide/tauri-adapters/java-project-context-tauri";
import { TauriJavaEntryPointAdapter } from "@ide/tauri-adapters/java-entry-point-tauri";
import { javaMoveClassSourceSelection } from "./features/refactorkit-java/javaMoveClassTargetModules";
import { TauriJavaProjectPathPickerAdapter } from "@ide/tauri-adapters/java-project-path-picker-tauri";
import { TauriJavaProjectScaffoldAdapter } from "@ide/tauri-adapters/java-project-scaffold-tauri";
import { TauriJavaProjectTextSearchAdapter } from "@ide/tauri-adapters/java-project-text-search-tauri";
import { useJavaNavigationController } from "./features/java/useJavaNavigationController";
import { useJavaEditorDiagnosticsController } from "./features/java/useJavaEditorDiagnosticsController";
import { readJavaNavigationSource } from "./features/java/javaNavigationSource";
import { useJavaDependencySourceController } from "./features/java/useJavaDependencySourceController";
import { useJavaExecutionController } from "./features/java-execution/useJavaExecutionController";
import { useJavaDebugEditorController } from "./features/java-execution/useJavaDebugEditorController";
import { useJavaSourceBreakpoints } from "./features/java-execution/useJavaSourceBreakpoints";
import { JavaExecutionPanel } from "./features/java-execution/JavaExecutionPanel";
import { javaExecutionCommands } from "./features/java-execution/javaExecutionCommands";
import { useJavaExecutionShortcuts } from "./features/java-execution/useJavaExecutionShortcuts";
import {
  resolveJavaTestClassSymbol,
  resolveJavaTestFailureLine,
  resolveJavaTestReportScope,
} from "./features/java-execution/javaTestSourceNavigation";
import { useJavaTestMethodNavigation } from "./features/java-execution/useJavaTestMethodNavigation";
import { JavaStructurePanel } from "./features/java/JavaStructurePanel";
import { GitWorkspacePanel } from "./features/git-workspace/GitWorkspacePanel";
import { useGitWorkspaceController } from "./features/git-workspace/useGitWorkspaceController";
import { useJavaTestSourceAction, type OpenJavaTestSource } from "./features/java-execution/useJavaTestSourceAction";
import {
  resolveJavaTestRuntimeOwner, resolveJavaTestDeclaringOwner, javaTestSourceBelongsToOwner,
  type JavaTestSourceOwner,
} from "./features/java-execution/javaTestSourceOwnership";
import { javaCoverageSourcePaths } from "./features/java-execution/javaCoverageSourcePaths";
import { useDesktopEditorController } from "./features/editor/useDesktopEditorController";
import { useEditorCommandController } from "./features/editor/useEditorCommandController";
import { useEditorCloseGuard } from "./features/editor/useEditorCloseGuard";
import { useEditorDiskComparisonController } from "./features/editor/useEditorDiskComparisonController";
import { EditorDiskComparisonDialog } from "./features/editor/EditorDiskComparisonDialog";
import { TauriEditorRecoveryAdapter } from "@ide/tauri-adapters/editor-recovery-tauri";
import { useEditorRecoveryController } from "./features/editor/useEditorRecoveryController";
import { EditorRecoveryPanel } from "./features/editor/EditorRecoveryPanel";
import { useEditorExternalChangeMonitor } from "./features/editor/useEditorExternalChangeMonitor";
import { EditorBackgroundDiskChanges } from "./features/editor/EditorBackgroundDiskChanges";
import { useFileExplorerController } from "./features/editor/useFileExplorerController";
import { useDocumentNavigationController } from "./features/document/useDocumentNavigationController";
import { useDesktopShellController } from "./features/shell/useDesktopShellController";
import {
  useSettingsController,
  useSettingsOpenCoordinator,
} from "./features/shell/useSettingsController";
import { useWorkspaceEditorPreferences } from "./features/shell/useWorkspaceEditorPreferences";
import { useTerminalController } from "./features/terminal/useTerminalController";
import { workspaceTerminalCommands } from "./features/terminal/workspaceTerminalCommands";
import { createWorkspaceFileUri, useJavaLanguageController } from "./features/java/useJavaLanguageController";
import { useJavaLanguageServerRuntimePreference } from "./features/java/useJavaLanguageServerRuntimePreference";
import {
  useJavaProjectTextSearchShortcut,
  useJavaWorkspaceSymbolSearchShortcut,
} from "./features/java/useJavaWorkspaceSymbolSearchShortcut";
import { useAiAgentController } from "./features/ai-agent/useAiAgentController";
import { PiWorkspaceAgentActivity } from "./features/pi-workspace-agent/PiWorkspaceAgentActivity";
import {
  REFACTOR_KIT_IMPORT_UNAVAILABLE,
  useRefactorKitImportController,
} from "./features/refactorkit-import/useRefactorKitImportController";
import {
  JAVA_REFACTORING_STALE_CONTEXT,
  useJavaRefactoringController,
} from "./features/refactorkit-java/useJavaRefactoringController";
import { useJavaFileActions } from "./features/refactorkit-java/useJavaFileActions";
import { JavaRefactoringPreviewDialog } from "./features/refactorkit-java/JavaRefactoringPreviewDialog";
import {
  JavaLspRefactoringDialog,
  type JavaLspRefactoringIntent,
} from "./features/refactorkit-java/JavaLspRefactoringDialog";
import {
  applicableJavaRefactoringOperations,
  availableJavaRefactoringOperations,
} from "./features/refactorkit-java/javaRefactoringAvailability";
import { useJavaTransactionRecoveryController } from "./features/refactorkit-java/useJavaTransactionRecoveryController";
import { JavaTransactionRecoveryDialog } from "./features/refactorkit-java/JavaTransactionRecoveryDialog";
import { reconcileRefactoringEditor } from "./features/editor/reconcileRefactoringEditor";
import { reconcileEditorRefactoring } from "./features/editor/reconcileEditorRefactoring";
import { useRefactorKitStatusController } from "./features/refactorkit-status/useRefactorKitStatusController";
import {
  useRefactorKitDiagnosticsController,
  type TypeScriptDiagnosticsEditorDocument,
} from "./features/refactorkit-status/useRefactorKitDiagnosticsController";
import { useRefactorKitSymbolNavigationController } from "./features/refactorkit-symbol-navigation/useRefactorKitSymbolNavigationController";
import { useJavaProjectModelController } from "./features/refactorkit-java-project-model/useJavaProjectModelController";
import {
  JavaProjectModelPanel,
  type JavaProjectModelTypeOperation,
} from "./features/refactorkit-java-project-model/JavaProjectModelPanel";
import type { MavenModuleRenameTransaction } from "./features/refactorkit-java-project-model/MavenModuleRenamePreview";
import { javaPackageMoveCommandForActiveFile } from "./features/refactorkit-java-project-model/javaPackageMoveCommand";
import { javaClassMoveCommandsForActiveFile } from "./features/refactorkit-java-project-model/javaClassMoveCommands";
import type {
  JavaProjectModelClass,
  JavaProjectModelPackage,
  JavaProjectModelSymbol,
} from "./features/refactorkit-java-project-model/useJavaProjectModelController";
import { useJavaProjectContextController } from "./features/refactorkit-java-project-model/useJavaProjectContextController";
import { javaProjectContextCommands } from "./features/refactorkit-java-project-model/javaProjectContextCommands";
import { javaSourceRootTargetPath } from "./features/refactorkit-java-project-model/javaSourceRootTargetPath";
import {
  javaSourceRootWorkspacePath,
  javaTypeProjectContextForDirectory,
} from "./features/refactorkit-java-project-model/javaTypeProjectContext";
import { useJavaProjectTextSearchController } from "./features/refactorkit-java-project-model/useJavaProjectTextSearchController";
import {
  useWorkspaceController,
  type WorkspaceControllerCollaborators,
} from "./features/workspace/useWorkspaceController";
import { WorkspaceFileQuickOpenDialog } from "./features/workspace/WorkspaceFileQuickOpenDialog";
import {
  SearchEverywhereDialog,
  type SearchEverywhereTarget,
} from "./features/workspace/SearchEverywhereDialog";
import { useXcom2ModuleActivationController } from "./features/xcom2-module-activation/useXcom2ModuleActivationController";
import { useXcom2ProjectBuildRecipeController } from "./features/xcom2-project-build-recipe/useXcom2ProjectBuildRecipeController";
import {
  useXcom2SetupController,
  type Xcom2SetupEventSources,
} from "./features/xcom2-setup/useXcom2SetupController";
import {
  useXcom2ProjectFoundryController,
  type ProjectFoundryComposition,
} from "./features/xcom2-project-foundry/useXcom2ProjectFoundryController";

// ── UI Components ────────────────────────────────────────────────────────
import { PanelLayout } from "@ide/ui";
import { CommandPalette, type CommandPaletteCommand } from "@ide/ui";
import { LeftSidebar } from "@ide/ui";
import { BottomPanel } from "@ide/ui";
import { FileTree } from "@ide/ui";
import { WorkspaceExplorer } from "@ide/ui";
import { Editor } from "@ide/ui";
import { DocumentPreviewPanel } from "@ide/ui";
import { WorkspaceTerminalPanel } from "./features/terminal/WorkspaceTerminalPanel";
import { HttpClientFeature } from "./features/http-client/HttpClientFeature";
import { TauriHttpClientAdapter } from "@ide/tauri-adapters/http-client-tauri";
import { JavaDatabaseFeature } from "./features/java-database/JavaDatabaseFeature";
import { TauriJavaDatabaseAdapter } from "@ide/tauri-adapters/java-database-tauri";
import { SettingsPanel } from "@ide/ui";
import { Icon } from "@ide/ui";
import { ProblemsPanel } from "@ide/ui";
import { ExternalJavaImportPreviewDialog } from "@ide/ui";
import { JavaIntelligencePanel } from "@ide/ui";
import { SemanticSymbolSearchPanel } from "@ide/ui";
import { Xcom2ProjectRecognitionPanel } from "@ide/ui";
import { Xcom2ProjectFoundryDialog } from "@ide/ui";

// ── Store hooks ──────────────────────────────────────────────────────────
// Zustand stores are created once and exposed as singletons for the app.
// Components subscribe via the generated hook selectors below.

// Create singleton stores (called once at module scope).
const fileTreeStore = createFileTreeStore();
const editorStore = createEditorStore();
const panelStore = createPanelStore();

const NO_ACTIVITY_CONTRIBUTIONS = Object.freeze(
  [] as readonly Readonly<PanelLayoutActivityContribution>[],
);

// Create singleton adapters.
const {
  gitWorkspaceAdapter,
  fileTreeAdapter,
  editorAdapter,
  terminalAdapter,
  aiAgentAdapter,
  piWorkspaceAgentAdapter,
  workspaceAdapter,
  clipboardAdapter,
  refactorKitAdapter,
  languageSessionAdapter,
  documentSyncAdapter,
  javaIntelligenceAdapter,
  javaLspRefactoringAdapter,
  xcom2SetupAdapter,
  xcom2SetupMonitorAdapter,
  xcom2NativeActivationEvidenceAdapter,
  xcom2ProjectBuildRecipeInspectionAdapter,
} = createTauriAdapters();

const xcom2SetupEventSources: Xcom2SetupEventSources = {
  subscribeMonitor: (listener) => xcom2SetupMonitorAdapter.subscribe(listener),
  subscribeTransactions: (listener) => xcom2SetupAdapter.subscribe({}, listener),
};

// Create singleton view models.
const fileTreeViewModel = new FileTreeViewModel(fileTreeStore.getState, fileTreeAdapter);
const editorViewModel = new EditorViewModel(editorStore.getState, editorAdapter);
const javaExecutionAdapter = new TauriJavaExecutionAdapter();
const javaNavigationAdapter = new TauriJavaNavigationAdapter();
const javaEditorDiagnosticsAdapter = new TauriJavaEditorDiagnosticsAdapter();
const javaDependencySourceAdapter = new TauriJavaDependencySourceAdapter();
const javaPlatformSourceAdapter = new TauriJavaPlatformSourceAdapter();
const javaEntryPointAdapter = new TauriJavaEntryPointAdapter();
const javaProjectDeclarationAdapter = new TauriJavaProjectDeclarationAdapter();
const javaProjectContextAdapter = new TauriJavaProjectContextAdapter();
const javaProjectPathPickerAdapter = new TauriJavaProjectPathPickerAdapter();
const javaProjectScaffoldAdapter = new TauriJavaProjectScaffoldAdapter();
const javaProjectTextSearchAdapter = new TauriJavaProjectTextSearchAdapter();
const httpClientAdapter = new TauriHttpClientAdapter();
const javaDatabaseAdapter = new TauriJavaDatabaseAdapter();
const editorRecoveryAdapter = new TauriEditorRecoveryAdapter();

function applyJavaSemanticEditsToOpenBuffers(
  edits: readonly JavaRenameDocumentEdits[],
  capturedDocuments: ReadonlyMap<string, { uri: string; version: number; text: string }>,
): boolean {
  if (!edits.length) return true;
  const buffers = editorViewModel.beginEditorTransaction();
  try {
    const currentDocuments = new Map(
      buffers.documents.map((document) => [document.path, document]),
    );
    const documentChanges: JavaEditorWorkspaceEdit["documentChanges"] = [];
    for (const entry of edits) {
      const captured = capturedDocuments.get(entry.document.path);
      const current = currentDocuments.get(entry.document.path);
      if (
        !captured ||
        !current ||
        captured.uri !== entry.document.uri ||
        captured.version !== entry.document.version ||
        current.text !== captured.text
      )
        return false;
      documentChanges.push({
        kind: "edit",
        path: current.path,
        version: current.version,
        edits: entry.edits,
      });
    }
    const staged = buffers.stage({ documentChanges });
    buffers.commit(staged);
    return true;
  } finally {
    buffers.release();
  }
}

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
 * Hook that subscribes to panel layout store state.
 */
function usePanelState() {
  const layout = panelStore((s) => s.layout);
  return { layout };
}

function useTypeScriptDiagnosticsDocument(
  filePath: string | null,
  language: string,
  content: string,
): Readonly<TypeScriptDiagnosticsEditorDocument> | null {
  const versionsRef = useRef(
    new Map<string, { readonly content: string; readonly version: number }>(),
  );
  return useMemo(() => {
    if (
      !filePath ||
      (language.toLowerCase() !== "typescript" && !/\.(?:cts|mts|tsx?)$/iu.test(filePath))
    ) {
      return null;
    }
    const previous = versionsRef.current.get(filePath);
    const version = previous ? previous.version + (previous.content === content ? 0 : 1) : 1;
    versionsRef.current.set(filePath, { content, version });
    return Object.freeze({ path: filePath, version, content });
  }, [content, filePath, language]);
}

// ── App Component ────────────────────────────────────────────────────────

export interface AppProps {
  readonly projectFoundry?: ProjectFoundryComposition;
}

export type { ProjectFoundryComposition } from "./features/xcom2-project-foundry/useXcom2ProjectFoundryController";

export function App({ projectFoundry }: AppProps = {}): JSX.Element {
  // Subscribe to stores.
  const fileTreeState = useFileTreeState();
  const editorState = useEditorState();
  const activeCursorPosition = editorStore((state) =>
    editorState.activeFilePath
      ? (state.cursorPositions?.[editorState.activeFilePath] ?? null)
      : null,
  );
  const panelState = usePanelState();
  const databaseTransitionBlockReasonRef = useRef<string | null>(null);
  const gitTransitionBlockReasonRef = useRef<string | null>(null);
  const onGitTransitionBlockReason = useCallback((reason: string | null) => { gitTransitionBlockReasonRef.current = reason; }, []);
  const onDatabaseTransitionBlockReason = useCallback((reason: string | null) => {
    databaseTransitionBlockReasonRef.current = reason;
  }, []);
  const workspaceCollaboratorsRef = useRef<WorkspaceControllerCollaborators | null>(null);
  const [activeActivity, setActiveActivity] = useState<PanelLayoutActivity>("explorer");
  const [directoryToReveal, setDirectoryToReveal] = useState<{
    path: string; workspaceId: string; generation: number;
  } | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [workspaceFileQuickOpen, setWorkspaceFileQuickOpen] = useState(false);
  const [searchEverywhereOpen, setSearchEverywhereOpen] = useState(false);
  const [javaWorkspaceSymbolSearchFocus, setJavaWorkspaceSymbolSearchFocus] = useState(0);
  const [javaProjectTextSearchFocus, setJavaProjectTextSearchFocus] = useState(0);
  const [javaReferencesQueryFocus, setJavaReferencesQueryFocus] = useState(0);
  const [javaProjectNavigationStatus, setJavaProjectNavigationStatus] = useState<string | null>(
    null,
  );
  const [javaLspCapabilities, setJavaLspCapabilities] =
    useState<JavaLspRefactoringCapabilities | null>(null);
  const [javaLspIntent, setJavaLspIntent] = useState<JavaLspRefactoringIntent | null>(null);
  const [javaProjectWriting, setJavaProjectWriting] = useState(false);
  const [gitSourceWriting, setGitSourceWriting] = useState(false);
  const [documentViewMode, setDocumentViewMode] = useState<
    "split" | "preview-only" | "editor-only"
  >("split");
  const javaPositionRequestSequence = useRef(0);
  const javaDefinitionsCancellationRef = useRef<string | null>(null);
  const javaDefinitionSourceGuard = useRef<((afterOpen: boolean) => boolean) | null>(null);
  const javaCallHierarchyCancellationRef = useRef<string | null>(null);
  const settings = useSettingsController();
  const projectFoundryController = useXcom2ProjectFoundryController(projectFoundry);

  const openJavaWorkspaceSymbolSearch = useCallback(() => {
    panelStore.getState().setVisibility("leftSidebar", true);
    setActiveActivity("java-intelligence");
    setJavaWorkspaceSymbolSearchFocus((request) => request + 1);
  }, []);
  const openJavaProjectTextSearch = useCallback(() => {
    panelStore.getState().setVisibility("leftSidebar", true);
    setActiveActivity("java-project-model");
    setJavaProjectTextSearchFocus((request) => request + 1);
  }, []);
  const openJavaExecution = () => {
    panelStore.getState().setVisibility("leftSidebar", true);
    setActiveActivity("java-execution");
  };
  const openSearchEverywhere = useCallback(() => setSearchEverywhereOpen(true), []);
  useJavaWorkspaceSymbolSearchShortcut(openJavaWorkspaceSymbolSearch);
  useJavaProjectTextSearchShortcut(openJavaProjectTextSearch);
  const handleJavaProjectTextSearchFocusHandled = useCallback((request: number) => {
    setJavaProjectTextSearchFocus((current) => (current === request ? 0 : current));
  }, []);

  const refactorKitStatus = useRefactorKitStatusController({
    refactorKit: refactorKitAdapter,
    deferWorkspaceActivation: true,
  });
  const xcom2ModuleActivation = useXcom2ModuleActivationController({
    nativeEvidence: xcom2NativeActivationEvidenceAdapter,
  });
  const xcom2BuildRecipeCurrentModule = useMemo(() => {
    const project = xcom2ModuleActivation.projectSnapshot;
    const [currentModule] = xcom2ModuleActivation.activeProjectDecisions;
    if (!project || !currentModule || xcom2ModuleActivation.activeProjectDecisions.length !== 1) {
      return null;
    }
    return Object.freeze({
      workspaceId: project.workspaceId,
      workspaceGeneration: project.workspaceGeneration,
      moduleRoot: currentModule.moduleRoot,
    });
  }, [xcom2ModuleActivation.activeProjectDecisions, xcom2ModuleActivation.projectSnapshot]);
  const xcom2ProjectBuildRecipe = useXcom2ProjectBuildRecipeController({
    inspection: xcom2ProjectBuildRecipeInspectionAdapter,
    currentModule: xcom2BuildRecipeCurrentModule,
    authorizeInspection: xcom2ModuleActivation.authorizeBuildRecipeInspection,
  });
  const workspace = useWorkspaceController({
    workspace: workspaceAdapter,
    collaboratorsRef: workspaceCollaboratorsRef,
  });
  const workspaceStateRef = useRef(workspace);
  workspaceStateRef.current = workspace;
  const {
    workspaceInfo,
    workspaceRegistry,
    isLoading: isWorkspaceLoading,
    switchingWorkspaceId,
    error: workspaceError,
    refresh: loadWorkspaceMetadata,
    refreshWorkspace: handleRefreshWorkspace,
    switchWorkspace: handleSwitchWorkspace,
  } = workspace;
  const workspaceEditorPreferences = useWorkspaceEditorPreferences(workspace.currentWorkspaceId);
  const javaLanguageServerRuntimePreference = useJavaLanguageServerRuntimePreference();

  const aiAgent = useAiAgentController({
    aiAgent: aiAgentAdapter,
    workspaceInfo,
    isWorkspaceLoading,
    deferWorkspaceActivation: true,
    projectSessionMessages: false,
    projectRunTraceActivities: false,
  });
  const {
    settings: aiAgentSettings,
    status: aiAgentStatus,
    workspaceCollaborator: aiAgentWorkspaceCollaborator,
    loadConfiguration: loadAiAgentConfiguration,
    loadCommands: loadAiAgentCommands,
    refreshStatus: handleRefreshAiAgentStatus,
    saveSettings: handleSaveAiAgentSettings,
    installPiAgent: handleInstallPiAgent,
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
  const getWorkspaceContext = workspace.getContext;
  const openFileProgrammatically = desktopEditorController.openFileProgrammatically;
  const searchWorkspaceFiles = useCallback(
    async (query: string, generation: number) => {
      const before = getWorkspaceContext();
      if (!before.workspaceId || before.generation !== generation || before.isSwitching) {
        throw new Error("The workspace changed before file search.");
      }
      const result = await fileTreeAdapter.searchFiles(query);
      const after = getWorkspaceContext();
      if (
        !after.workspaceId ||
        after.generation !== generation ||
        after.isSwitching ||
        after.workspaceId !== before.workspaceId
      )
        throw new Error("The workspace changed while searching files. Try again.");
      return result;
    },
    [getWorkspaceContext],
  );
  const openWorkspaceQuickOpenFile = useCallback(
    async (path: string, generation: number) => {
      const current = getWorkspaceContext();
      if (!current.workspaceId || current.generation !== generation || current.isSwitching) {
        throw new Error("The workspace changed before the file could be opened.");
      }
      const opened = await openFileProgrammatically(
        {
          id: `quick-open-${path}`,
          path,
          name: path.split("/").at(-1) ?? path,
          type: "file",
        },
        true,
      );
      if (!opened) throw new Error("The selected workspace file could not be opened.");
      const after = getWorkspaceContext();
      if (after.generation !== generation || after.workspaceId !== current.workspaceId) {
        throw new Error("The workspace changed while opening the file.");
      }
      fileTreeStore.getState().setSelectedFilePath(path);
    },
    [getWorkspaceContext, openFileProgrammatically],
  );

  const documentNavigationRef = useRef<ReturnType<typeof useDocumentNavigationController> | null>(null);
  /** Ready/opening/error presentation comes from the desktop editor controller. */
  const {
    diagnostic: editorDiagnostic,
    reconcileBufferRenames: reconcileOpenedBufferRenames,
    readyActiveFilePath: activeFilePath,
    activeContent,
    activeLanguage,
    editorFilePath,
    isEditorLoading: isEditorOpening,
  } = desktopEditorController;
  const reconcileBufferRenames = useCallback((changes: readonly { oldPath: string; path: string }[]) => {
    reconcileOpenedBufferRenames(changes);
    documentNavigationRef.current?.reconcileHistoryRenames(changes);
  }, [reconcileOpenedBufferRenames]);

  const readyActiveDocument = useMemo(
    () => (activeFilePath ? { path: activeFilePath, text: activeContent } : null),
    [activeContent, activeFilePath],
  );
  const typeScriptDiagnosticsDocument = useTypeScriptDiagnosticsDocument(
    activeFilePath,
    activeLanguage,
    activeContent,
  );
  const javaProjectContext = useJavaProjectContextController({
    port: javaProjectContextAdapter,
    workspaceId: workspace.currentWorkspaceId,
    generation: workspace.generation,
    supportsProviderQualifiedSourceAssociation:
      refactorKitStatus.capabilities?.methods?.some(
        (method) =>
          method.requiresProject &&
          !method.writesWorkspace &&
          method.features?.providerQualifiedSourceAssociation === true &&
          ((method.name === "project.context" && method.features.typedSchemaV3 === true) ||
            (method.name === "project.context.v5" && method.features.typedSchemaV5 === true) ||
            (method.name === "project.context.v6" && method.features.typedSchemaV6 === true) ||
            (method.name === "project.context.v7" && method.features.typedSchemaV7 === true)),
      ) ?? false,
    supportsJavaProjectContextV7:
      refactorKitStatus.capabilities?.methods?.some(
        (method) =>
          method.name === "project.context.v7" &&
          method.requiresProject &&
          !method.writesWorkspace &&
          method.features?.typedSchemaV7 === true &&
          method.features.providerQualifiedSourceAssociation === true,
      ) ?? false,
    supportsAggregateGradleCompositeIdentity:
      refactorKitStatus.capabilities?.methods?.some(
        (method) =>
          method.name === "project.context.aggregate" &&
          method.requiresProject &&
          !method.writesWorkspace &&
          method.features?.typedSchemaV3 === true &&
          method.features.aggregateGradleCompositeBuildIdentity === true &&
          method.features.requiresExplicitGradleSync === true &&
          method.features.snapshotBound === true &&
          method.features.readOnly === true,
      ) ?? false,
    getWorkspaceContext: workspace.getContext,
    canRefreshSourceContext: () => {
      if (javaWritesInProgressRef.current) return false;
      try { editorViewModel.captureEditorBuffers(); return true; } catch { return false; }
    },
    storage: globalThis.localStorage,
  });
  const javaProjectTextSearch = useJavaProjectTextSearchController({
    port: javaProjectTextSearchAdapter,
    workspaceId: workspace.currentWorkspaceId,
    generation: workspace.generation,
    getWorkspaceContext: workspace.getContext,
    getOpenTextDrafts: () => {
      const state = editorStore.getState();
      return state.tabs.flatMap((tab) => {
        if (!tab.isDirty) return [];
        const content = state.contents[tab.filePath];
        const lifetime = state.bufferLifetimes.get(tab.filePath);
        return typeof content === "string" && lifetime
          ? [{ path: tab.filePath, content, lifetime }]
          : [];
      });
    },
  });
  const getSearchWorkspaceContext = workspace.getContext;
  const searchProjectTextSnapshot = javaProjectTextSearch.searchAndGetSnapshot;
  const selectedJavaProjectPath = javaProjectContext.settings.projectPath;
  const searchProjectTextEverywhere = useCallback(
    async (query: string, generation: number) => {
      const before = getSearchWorkspaceContext();
      if (
        !before.workspaceId ||
        before.generation !== generation ||
        before.isSwitching ||
        before.isMetadataLoading
      )
        return null;
      const snapshot = await searchProjectTextSnapshot(query, false, selectedJavaProjectPath);
      const after = getSearchWorkspaceContext();
      if (
        after.workspaceId !== before.workspaceId ||
        after.generation !== generation ||
        after.isSwitching ||
        after.isMetadataLoading
      )
        return null;
      return snapshot;
    },
    [getSearchWorkspaceContext, searchProjectTextSnapshot, selectedJavaProjectPath],
  );
  const gradleImportScope = JSON.stringify([
    workspace.currentWorkspaceId,
    workspace.generation,
    javaProjectContext.settings.projectPath,
  ]);
  const [authorizedGradleImportScope, setAuthorizedGradleImportScope] = useState<string | null>(
    null,
  );
  const gradleImportEnabled = authorizedGradleImportScope === gradleImportScope;
  useEffect(() => {
    setAuthorizedGradleImportScope(null);
  }, [gradleImportScope]);

  const libraryCursorPositions = useRef(new Map<string, EditorPoint>());
  const javaLibrary = useJavaDependencySourceController({
    port: javaDependencySourceAdapter,
    platformPort: javaPlatformSourceAdapter,
    onNavigate: location => documentNavigationRef.current?.recordExternalNavigation(location),
    workspaceId: workspace.currentWorkspaceId,
    generation: workspace.generation,
    getContext: workspace.getContext,
    getEditorState: editorStore.getState,
    getProjectContext: () => ({
      settings: javaProjectContext.settings,
      context: javaProjectContext.context,
    }),
    editor: editorViewModel,
  });
  const libraryDocument = javaLibrary.activeDocument;
  useEffect(() => {
    const retained = new Set(javaLibrary.documents.map(document => document.uri));
    for (const uri of libraryCursorPositions.current.keys()) if (!retained.has(uri)) libraryCursorPositions.current.delete(uri);
  }, [javaLibrary.documents]);
  const showWorkspaceEditor = javaLibrary.showWorkspace;
  const workspaceOpenIntent =
    "intentId" in desktopEditorController.openState
      ? desktopEditorController.openState.intentId
      : 0;
  useLayoutEffect(() => {
    showWorkspaceEditor();
  }, [workspaceOpenIntent, showWorkspaceEditor]);
  useLayoutEffect(() => {
    if (libraryDocument) setDocumentViewMode("editor-only");
  }, [libraryDocument]);

  const javaLanguage = useJavaLanguageController({
    languageSession: languageSessionAdapter,
    documentSync: documentSyncAdapter,
    javaIntelligence: javaIntelligenceAdapter,
    applySemanticWorkspaceEdit: applyJavaSemanticEditsToOpenBuffers,
    openSemanticDocument: (path, isCurrent) =>
      editorViewModel.openFileInBackground(path, isCurrent),
    workspaceInfo,
    workspaceGeneration: workspace.generation,
    getEditorState: editorStore.getState,
    readyActiveDocument,
    projectJdkHome: javaProjectContext.settings.sdkHome || undefined,
    serverJdkHome: javaLanguageServerRuntimePreference.serverJdkHome || undefined,
    gradleImportEnabled,
    gradle: javaProjectContext.settings.gradle,
    projectPath: javaProjectContext.settings.projectPath,
    mavenRepository: javaProjectContext.settings.mavenRepository,
    activeMavenProfiles: javaProjectContext.settings.activeMavenProfiles,
    inactiveMavenProfiles: javaProjectContext.settings.inactiveMavenProfiles,
    javaFormatterProfile: workspaceEditorPreferences.preferences.javaFormatterProfile,
  });

  const javaProjectContextAvailable = javaProjectContext.context != null;
  const javaProjectContextHash = javaProjectContext.context?.contextHash;
  const javaProjectPathRef = useRef(javaProjectContext.settings.projectPath);
  javaProjectPathRef.current = javaProjectContext.settings.projectPath;
  const javaGradleSettings = javaProjectContext.settings.gradle;
  const applyJavaProjectLanguageSettings = javaProjectContext.applyLanguageSettings;
  const currentWorkspaceRuntimeContext = getWorkspaceContext();
  const workspaceMetadataLoading = currentWorkspaceRuntimeContext.isMetadataLoading;
  const workspaceSwitching = currentWorkspaceRuntimeContext.isSwitching;

  useEffect(() => {
    const workspaceId = workspace.currentWorkspaceId;
    const generation = workspace.generation;
    const sdkHome = javaProjectContext.settings.sdkHome.trim();
    if (!workspaceId || !sdkHome || workspaceSwitching) {
      setJavaLspCapabilities(null);
      return;
    }
    let current = true;
    setJavaLspCapabilities(null);
    void javaLspRefactoringAdapter
      .getCapabilities({ workspaceId, generation, sdkHome })
      .then((capabilities) => {
        if (current) setJavaLspCapabilities(capabilities);
      })
      .catch((error: unknown) => {
        if (current) {
          setJavaLspCapabilities({
            available: false,
            serverVersion: null,
            changeVisibility: false,
            extractParameter: false,
            extractSuperclass: false,
            detail: error instanceof Error ? error.message : "RefactorKit LSP is unavailable.",
          });
        }
      });
    return () => {
      current = false;
    };
  }, [
    workspace.currentWorkspaceId,
    workspace.generation,
    javaProjectContext.settings.sdkHome,
    workspaceSwitching,
  ]);

  useEffect(() => {
    setJavaLspIntent(null);
  }, [workspace.currentWorkspaceId, workspace.generation]);

  useEffect(() => {
    if (!javaProjectContextAvailable || !javaGradleSettings) return;
    void applyJavaProjectLanguageSettings().catch(() => undefined);
  }, [
    javaProjectContextAvailable,
    javaProjectContextHash,
    javaGradleSettings,
    javaProjectContext.settings.projectPath,
    applyJavaProjectLanguageSettings,
    javaLanguage.status?.generation,
    javaLanguage.status?.gradleImportEnabled,
    javaLanguage.status?.gradleSettingsConfigured,
    javaLanguage.status?.projectPath,
    javaLanguage.status?.state,
    javaLanguage.status?.workspaceId,
    workspace.currentWorkspaceId,
    workspace.generation,
    workspaceMetadataLoading,
    workspaceSwitching,
  ]);

  const refactorKitImport = useRefactorKitImportController({
    clipboard: clipboardAdapter,
    refactorKit: refactorKitAdapter,
    fileTree: fileTreeViewModel,
    workspaceId: workspace.currentWorkspaceId,
    getWorkspaceGeneration: workspace.getGeneration,
    openResultFile: desktopEditorController.openFileProgrammatically,
  });

  const javaRefactoring = useJavaRefactoringController({
    refactorKit: refactorKitAdapter,
    capabilities: refactorKitStatus.capabilities,
    workspaceId: workspace.currentWorkspaceId,
    getWorkspaceGeneration: workspace.getGeneration,
    getProjectContext: () => ({
      settings: javaProjectContext.settings,
      context: javaProjectContext.context,
    }),
    getJavaFormatterProfile: () => workspaceEditorPreferences.preferences.javaFormatterProfile,
    reviewSavedBuffers: (options) => editorViewModel.reviewSavedBuffers(options),
    captureEditorBuffers: () => editorViewModel.captureEditorBuffers(),
    getCursorPosition: (path) => editorViewModel.cursorPosition(path),
    beginWorkspaceWrite: () => editorViewModel.beginExternalWrite(),
    beginEditorTransaction: () => editorViewModel.beginEditorTransaction(),
    onEditorSourceChanged: () => javaProjectContext.retireContext(),
    onProjectContextStale: () => javaProjectContext.retireContext(JAVA_REFACTORING_STALE_CONTEXT),
    reconcileEditorBuffers: (changes, isCurrent) =>
      reconcileEditorRefactoring(
        { editor: desktopEditorController, documents: javaLanguage, fileTree: fileTreeViewModel },
        changes,
        isCurrent,
      ),
    onSourceChanged: () => javaProjectContext.retireContext(),
    reconcileChanges: (changes, isCurrent) =>
      reconcileRefactoringEditor(
        {
          editor: editorViewModel,
          navigation: { reconcileBufferRenames },
          documents: javaLanguage,
          fileTree: fileTreeViewModel,
          refreshProjectModel: async () => {
            if (javaProjectModel.model) await javaProjectModel.refresh();
          },
        },
        changes,
        isCurrent,
      ),
  });

  const moveClassContextRefreshKey = useRef<string | null>(null);
  useEffect(() => {
    const dialog = javaRefactoring.dialog;
    if (!dialog) {
      moveClassContextRefreshKey.current = null;
      return;
    }
    if (
      dialog.operation !== "move-class" ||
      dialog.status !== "idle" ||
      javaProjectContext.isBusy ||
      !javaMoveClassTargetModuleSelectionOffered(refactorKitStatus.capabilities)
    )
      return;

    const context = javaProjectContext.context;
    if (
      !context ||
      context.schemaVersion === "java-project-context-v3" ||
      context.schemaVersion === "java-project-context-v4" ||
      context.schemaVersion === "java-project-context-v5" ||
      context.schemaVersion === "java-project-context-v6" ||
      context.schemaVersion === "java-project-context-v7"
    )
      return;

    const source = javaMoveClassSourceSelection(
      context,
      dialog.target.path,
      javaProjectContext.settings.projectPath,
    );
    if (!source) return;
    const refreshKey = JSON.stringify([
      workspace.currentWorkspaceId,
      workspace.generation,
      context.schemaVersion,
      context.contextHash,
      dialog.target.path,
      source.providerId,
      source.moduleId,
      source.sourceSetId,
    ]);
    if (moveClassContextRefreshKey.current === refreshKey) return;
    moveClassContextRefreshKey.current = refreshKey;
    void javaProjectContext
      .refreshForExecution(javaProjectContext.settings, source)
      .catch(() => undefined);
  }, [
    javaProjectContext,
    javaRefactoring.dialog,
    refactorKitStatus.capabilities,
    workspace.currentWorkspaceId,
    workspace.generation,
  ]);

  const javaTransactionRecovery = useJavaTransactionRecoveryController({
    workspaceId: workspace.currentWorkspaceId,
    generation: workspace.generation,
    port: refactorKitAdapter,
    editor: editorViewModel,
    capabilities: refactorKitStatus.capabilities,
    getWorkspaceContext: workspace.getContext,
    getProjectContext: () => ({
      settings: javaProjectContext.settings,
      context: javaProjectContext.context,
    }),
    isOtherWriting: javaRefactoring.isWriting || javaProjectWriting || gitSourceWriting,
    onSourceChanged: () => javaProjectContext.retireContext(),
    reconcile: (changes, isCurrent) =>
      reconcileEditorRefactoring(
        { editor: desktopEditorController, documents: javaLanguage, fileTree: fileTreeViewModel },
        changes,
        isCurrent,
      ),
  });
  const beginJavaProjectWrite = useCallback(() => {
    const releaseWrite = editorViewModel.beginExternalWrite();
    setJavaProjectWriting(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseWrite();
      setJavaProjectWriting(false);
    };
  }, []);
  const javaWritesInProgress =
    javaRefactoring.isWriting || javaTransactionRecovery.isWriting || javaProjectWriting || gitSourceWriting;
  const javaWritesInProgressRef = useRef(javaWritesInProgress);
  javaWritesInProgressRef.current = javaWritesInProgress;
  const gitWorkspace = useGitWorkspaceController({
    port: gitWorkspaceAdapter,
    activeFilePath,
    workspace: workspaceInfo,
    generation: workspace.generation,
    getContext: getWorkspaceContext,
    isDirty: path => editorStore.getState().tabs.some(tab => tab.filePath === path && tab.isDirty),
    canMutate: () => !javaWritesInProgressRef.current,
    openFile: async path => desktopEditorController.openFileProgrammatically({ id: path, name: path.split("/").at(-1) ?? path, path, type: "file" }),
    openBlameLocation: (path, line, fingerprint, isCurrent) => openSavedBlameLocation(path, line, fingerprint, {
      isCurrent,
      openFile: async path => desktopEditorController.openFileProgrammatically({ id: path, name: path.split("/").at(-1) ?? path, path, type: "file" }),
      readBuffer: path => {
        const state = editorStore.getState();
        const text = state.contents[path], lifetime = editorViewModel.bufferLifetime(path);
        const tab = state.tabs.find(tab => tab.filePath === path);
        return text !== undefined && lifetime !== null && lifetime !== undefined && tab
          ? { text, lifetime, dirty: tab.isDirty, active: state.activeFilePath === path } : undefined;
      },
      reveal: (path, line, guard) => documentNavigationRef.current?.revealCurrentLocation(path, {
        kind: "point", point: { lineNumber: line, column: 1 },
      }, guard) ?? false,
    }),
    onTransitionBlockReason: onGitTransitionBlockReason,
    beginBranchSwitch: () => {
      const release = editorViewModel.beginExternalWrite();
      const paths = editorStore.getState().tabs.map(tab => tab.filePath);
      setGitSourceWriting(true);
      javaProjectContext.retireContext();
      javaProjectModel.resetWorkspace();
      return {
        reconcile: async isCurrent => {
          if (!isCurrent()) return;
          javaProjectContext.retireContext();
          javaProjectModel.resetWorkspace();
          const warning = await reconcileRefactoringEditor({
            editor: editorViewModel,
            navigation: { reconcileBufferRenames },
            documents: javaLanguage,
            fileTree: fileTreeViewModel,
          }, paths.map(path => ({ path, change: "edit" as const, primary: false })), isCurrent);
          // An empty editor still needs a refreshed explorer after a branch switch.
          if (paths.length === 0 && isCurrent()) await fileTreeViewModel.loadRoot(isCurrent);
          return warning;
        },
        release: () => { release(); setGitSourceWriting(false); },
      };
    },
  });
  const javaProjectCommandControllerRef = useRef(javaProjectContext);
  javaProjectCommandControllerRef.current = javaProjectContext;

  const reviewLspRefactoring = useCallback(
    (
      operation: JavaLspRefactoringIntent["operation"],
      document: { path: string; text: string; version?: number },
      cursor?: { line: number; column: number },
      selection?: { start: number; end: number },
    ) => {
      const context = getWorkspaceContext();
      const currentEditor = editorStore.getState();
      if (
        context.isSwitching ||
        !context.workspaceId ||
        context.workspaceId !== workspace.currentWorkspaceId ||
        context.generation !== workspace.generation ||
        javaWritesInProgressRef.current ||
        !javaProjectContext.settings.sdkHome.trim() ||
        currentEditor.activeFilePath !== document.path ||
        currentEditor.contents[document.path] !== document.text ||
        !document.path.toLowerCase().endsWith(".java")
      )
        throw new Error("The Java editor action is stale or RefactorKit LSP is unavailable.");
      setJavaLspIntent({
        operation,
        document,
        ...(cursor ? { cursor } : {}),
        ...(selection ? { selection } : {}),
      });
    },
    [
      getWorkspaceContext,
      workspace.currentWorkspaceId,
      workspace.generation,
      javaProjectContext.settings.sdkHome,
    ],
  );

  const javaFileActions = useJavaFileActions({
    workspaceId: workspace.currentWorkspaceId,
    generation: workspace.generation,
    rootPath: workspaceInfo?.rootPath ?? null,
    capabilities: refactorKitStatus.capabilities,
    lspCapabilities: javaLspCapabilities,
    sdkSelected: Boolean(javaProjectContext.settings.sdkHome.trim()),
    projectContextAvailable: javaProjectContext.context?.status === "available",
    javaWorkspaceSymbolsAvailable: javaLanguage.capabilities.workspaceSymbols,
    getCursorPosition: (path) => editorViewModel.cursorPosition(path),
    getContext: workspace.getContext,
    getEditorState: editorStore.getState,
    editor: editorViewModel,
    refactoring: javaRefactoring,
    reviewLsp: reviewLspRefactoring,
  });
  const javaProjectContextStatus = javaProjectContext.context?.status;
  const javaProjectContextModules = javaProjectContext.context?.modules;
  const javaRefactoringTargetSelection = javaRefactoring.dialog?.target.selection;
  const javaRefactoringAvailabilityForDialog = useMemo(() => {
    const options = {
      capabilities: refactorKitStatus.capabilities,
      sdkSelected: Boolean(javaProjectContext.settings.sdkHome.trim()),
      projectContextAvailable: javaProjectContextStatus === "available",
      javaWorkspaceSymbolsAvailable: javaLanguage.capabilities.workspaceSymbols,
      partialMavenProjectContextAvailable:
        javaProjectContextStatus === "partial" &&
        javaProjectContextModules?.some((module) => module.providerId === "maven-effective-v1"),
      partialGradleProjectContextAvailable:
        javaProjectContextStatus === "partial" &&
        javaProjectContextModules?.some((module) => module.providerId === "gradle-effective-v1"),
      projectPath: javaProjectContext.settings.projectPath,
      dirtyPaths: editorState.tabs.filter((tab) => tab.isDirty).map((tab) => tab.filePath),
      editorSelection:
        javaRefactoring.dialog?.target.identity === "@cursor" ||
        Boolean(
          javaRefactoringTargetSelection &&
          javaRefactoringTargetSelection.start < javaRefactoringTargetSelection.end,
        ) ||
        (javaRefactoring.dialog?.operation === "extract-method" &&
          Boolean(javaRefactoringTargetSelection)),
    };
    return {
      preview: availableJavaRefactoringOperations(options),
      apply: applicableJavaRefactoringOperations(options),
    };
  }, [
    editorState.tabs,
    javaRefactoring.dialog?.operation,
    javaRefactoring.dialog?.target.identity,
    javaRefactoringTargetSelection,
    javaProjectContextStatus,
    javaLanguage.capabilities.workspaceSymbols,
    javaProjectContextModules,
    javaProjectContext.settings.projectPath,
    javaProjectContext.settings.sdkHome,
    refactorKitStatus.capabilities,
  ]);

  const javaProjectModel = useJavaProjectModelController({
    refactorKit: refactorKitAdapter,
    status: refactorKitStatus.status,
    capabilities: refactorKitStatus.capabilities,
    isCheckingCapabilities: refactorKitStatus.isChecking,
    refreshCapabilities: refactorKitStatus.refreshWithSnapshot,
    workspaceInfo,
    workspaceGeneration: workspace.generation,
    getWorkspaceContext: workspace.getContext,
  });
  const currentJavaProjectModel = javaProjectModel.model;
  const refreshJavaProjectModel = javaProjectModel.refresh;
  const reconcileJavaProjectChanges = useCallback(
    (changes: readonly RefactorKitAffectedFile[], isCurrent: () => boolean, openPathsToRefresh?: readonly string[]) =>
      reconcileRefactoringEditor(
        {
          editor: editorViewModel,
          navigation: { reconcileBufferRenames },
          documents: javaLanguage,
          fileTree: fileTreeViewModel,
          refreshProjectModel: async () => {
            if (currentJavaProjectModel) await refreshJavaProjectModel();
          },
        },
        changes,
        isCurrent,
        openPathsToRefresh,
      ),
    [currentJavaProjectModel, javaLanguage, refreshJavaProjectModel, reconcileBufferRenames],
  );
  const [mavenModuleRenameTransaction, setMavenModuleRenameTransaction] =
    useState<MavenModuleRenameTransaction | null>(null);
  const retireJavaProjectContext = javaProjectContext.retireContext;
  const javaLanguageWasRunning = ["starting", "indexing", "ready", "degraded"].includes(
    javaLanguage.status?.state ?? "unavailable",
  );
  const reconcileMavenModuleRenameChanges = useCallback(
    async (changes: readonly RefactorKitAffectedFile[], isCurrent: () => boolean) => {
      if (!isCurrent()) return;
      await javaLanguage.load();
      const warning = await reconcileJavaProjectChanges(changes, isCurrent);
      if (javaLanguageWasRunning && isCurrent()) await javaLanguage.start();
      return warning;
    },
    [javaLanguage, javaLanguageWasRunning, reconcileJavaProjectChanges],
  );
  const onMavenModuleRenameSourceChanged = useCallback(
    () => retireJavaProjectContext(),
    [retireJavaProjectContext],
  );
  const recoverSavedJavaSourceProject = javaProjectContext.recoverSavedSources;
  const restartAfterSavedSourceRecovery = useRef<JavaSavedSourceRecoveryRequest | null>(null);
  const recoverSavedJavaSources = useCallback((request: JavaSavedSourceRecoveryRequest) =>
    recoverSavedJavaSourceProject?.(request, beginJavaProjectWrite, async (current, recovered) => {
      if (!current()) return;
      const shouldRestart = javaLanguageWasRunning || restartAfterSavedSourceRecovery.current === request;
      restartAfterSavedSourceRecovery.current = !recovered && shouldRestart ? request : null;
      await javaLanguage.load();
      const prefix = request.projectPath ? `${request.projectPath}/` : "";
      const openProjectFiles = editorStore.getState().tabs
        .filter((tab) => tab.filePath.startsWith(prefix))
        .map((tab) => tab.filePath);
      const warning = await reconcileJavaProjectChanges([], current, openProjectFiles);
      if (current() && openProjectFiles.length === 0) await fileTreeViewModel.loadRoot(current);
      if (recovered && shouldRestart && current()) await javaLanguage.start();
      return warning;
    }), [beginJavaProjectWrite, javaLanguage, javaLanguageWasRunning, reconcileJavaProjectChanges,
      recoverSavedJavaSourceProject]);

  const xcom2Setup = useXcom2SetupController({
    monitor: xcom2SetupMonitorAdapter,
    transactions: xcom2SetupAdapter,
    events: xcom2SetupEventSources,
    currentWorkspaceId: workspace.currentWorkspaceId,
    isSettingsOpen: settings.isOpen,
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
    activeDiagnostics: javaActiveDiagnostics,
    activeDiagnosticDocument: javaActiveDiagnosticDocument,
    activeDiagnosticOwner: javaActiveDiagnosticOwner,
    problemItems: javaProblemItems,
    hasJavaContext,
    javaSemantics,
  } = javaLanguage;

  const terminal = useTerminalController({
    port: terminalAdapter,
    workspaceId: workspaceInfo?.id ?? null,
    generation: workspace.generation,
    ready: workspace.switchingWorkspaceId === null,
  });
  const [terminalDirectoryRequest, setTerminalDirectoryRequest] = useState<{
    cwd: string;
    workspaceId: string;
    generation: number;
  }>();
  const fileExplorer = useFileExplorerController({
    fileTree: fileTreeViewModel,
    editor: desktopEditorController,
    getSelectedDirectoryPath: refactorKitImport.getSelectedDirectoryPath,
  });
  const generatedSourceReveal = useRef({
    context: javaProjectContext.context, activity: activeActivity, document: activeFilePath, request: 0,
  });
  generatedSourceReveal.current.context = javaProjectContext.context;
  generatedSourceReveal.current.activity = activeActivity;
  generatedSourceReveal.current.document = libraryDocument ? null : activeFilePath;
  const activeGeneratedJavaSource = useMemo(() => {
    if (libraryDocument || !activeFilePath?.toLowerCase().endsWith(".java") ||
      workspaceSwitching || workspaceMetadataLoading) return null;
    const directory = activeFilePath.slice(0, Math.max(0, activeFilePath.lastIndexOf("/")));
    const facts = javaTypeProjectContextForDirectory(
      directory, javaProjectContext.settings.projectPath, javaProjectContext.context,
    );
    return facts?.isGeneratedSource ? facts : null;
  }, [activeFilePath, javaProjectContext.context, javaProjectContext.settings.projectPath,
    libraryDocument, workspaceMetadataLoading, workspaceSwitching]);
  const activeGeneratedJavaRoot = activeGeneratedJavaSource?.generatedSourceRoot;
  const revealWorkspaceGeneratedJavaRoot = useCallback(async (path: string, document?: string) => {
    const context = javaProjectContext.context;
    const before = getWorkspaceContext();
    if (!context || context.status !== "available" || !before.workspaceId) return;
    const activity = generatedSourceReveal.current.activity;
    const request = ++generatedSourceReveal.current.request;
    const isCurrent = () => {
      const current = getWorkspaceContext();
      return current.workspaceId === before.workspaceId && current.generation === before.generation &&
        !current.isSwitching && !current.isMetadataLoading &&
        generatedSourceReveal.current.activity === activity &&
        (document === undefined ? activity === "java-project-model" : generatedSourceReveal.current.document === document) &&
        generatedSourceReveal.current.context === context && generatedSourceReveal.current.request === request;
    };
    setJavaProjectNavigationStatus(null);
    try {
      const folder = await fileTreeViewModel.revealFolder(path, isCurrent);
      if (!isCurrent()) return;
      if (!folder) throw new Error("Generated source root is unavailable.");
      setDirectoryToReveal({ path: folder.path, workspaceId: before.workspaceId, generation: before.generation });
      setActiveActivity("explorer");
    } catch {
      if (isCurrent()) {
        setJavaProjectNavigationStatus(`Could not reveal generated source root ${path}.`);
      }
    }
  }, [getWorkspaceContext, javaProjectContext.context]);
  const revealGeneratedJavaSourceRoot = useCallback((root: string) => {
    const context = javaProjectContext.context;
    if (!context) return;
    const path = javaSourceRootWorkspacePath(root, javaProjectContext.settings.projectPath, context.schemaVersion);
    if (path) void revealWorkspaceGeneratedJavaRoot(path);
    else setJavaProjectNavigationStatus(`Could not reveal generated source root ${root}.`);
  }, [javaProjectContext.context, javaProjectContext.settings.projectPath, revealWorkspaceGeneratedJavaRoot]);
  const clearDirectoryReveal = useCallback((path: string) => {
    setDirectoryToReveal((current) => current?.path === path ? null : current);
  }, []);
  const documentNavigation = useDocumentNavigationController({
    displayedFilePath: libraryDocument?.uri ?? activeFilePath,
    openFileProgrammatically: desktopEditorController.openFileProgrammatically,
    history: {
      workspaceId: workspace.currentWorkspaceId,
      generation: workspace.generation,
      ready: !workspace.isLoading && !workspace.switchingWorkspaceId,
      isCurrent: () => {
        const current = getWorkspaceContext();
        return current.workspaceId === workspace.currentWorkspaceId && current.generation === workspace.generation &&
          !current.isSwitching && !current.isMetadataLoading;
      },
      getCursorPosition: path => {
        const position = editorViewModel.cursorPosition(path);
        return position ? { lineNumber: position.line, column: position.column }
          : libraryCursorPositions.current.get(path) ?? (javaLibrary.revealRequest?.filePath === path
            ? { lineNumber: javaLibrary.revealRequest.line, column: javaLibrary.revealRequest.column ?? 1 } : null);
      },
      isAvailable: path => isNormalizedWorkspaceRelativePath(path) || javaLibrary.documents.some(document => document.uri === path),
      openLocation: async (location, isCurrent) => {
        if (!isCurrent()) return false;
        if (javaLibrary.documents.some(document => document.uri === location.filePath))
          return javaLibrary.select(location.filePath, location.point);
        if (!isNormalizedWorkspaceRelativePath(location.filePath)) return false;
        const previous = javaLibrary.activeDocument;
        const opened = await desktopEditorController.openFileProgrammatically({ id: location.filePath,
          path: location.filePath, name: location.filePath.split("/").at(-1) ?? location.filePath, type: "file" }, true);
        if (!opened && previous && isCurrent()) javaLibrary.select(previous.uri, libraryCursorPositions.current.get(previous.uri));
        return opened;
      },
    },
  });
  documentNavigationRef.current = documentNavigation;
  const readJavaStructureDocument = useCallback(() => {
    if (libraryDocument) return null;
    const state = editorStore.getState();
    const path = state.activeFilePath;
    if (!path?.endsWith(".java")) return null;
    const lifetime = editorViewModel.bufferLifetime(path);
    const text = state.contents[path];
    return lifetime && text !== undefined ? { path, text, lifetime } : null;
  }, [libraryDocument]);
  useNavigationHistoryShortcuts({
    enabled: Boolean(workspace.currentWorkspaceId && !workspace.isLoading && !workspace.switchingWorkspaceId),
    canGoBack: documentNavigation.canGoBack, canGoForward: documentNavigation.canGoForward,
    goBack: documentNavigation.goBack, goForward: documentNavigation.goForward,
  });
  const javaWorkspaceId = workspace.currentWorkspaceId;
  const javaWorkspaceGeneration = workspace.generation;
  const javaLanguageStatus = javaLanguage.status;
  const searchJavaWorkspaceSymbols = javaLanguage.searchWorkspaceSymbols;
  const navigateToDocumentLocation = documentNavigation.navigateToLocation;
  const navigateSearchEverywhereResult = useCallback(
    async (path: string, target: SearchEverywhereTarget, generation: number) => {
      const before = getWorkspaceContext();
      if (!before.workspaceId || before.generation !== generation || before.isSwitching)
        throw new Error("The workspace changed before the result could be opened.");
      const canReveal = () => {
        const current = getWorkspaceContext();
        return (
          current.workspaceId === before.workspaceId &&
          current.generation === generation &&
          !current.isSwitching
        );
      };
      const location =
        target.kind === "range"
          ? { kind: "range" as const, range: target.range }
          : {
              kind: "point" as const,
              point: { lineNumber: target.line, column: target.column },
            };
      const navigated = await navigateToDocumentLocation(path, location, canReveal);
      if (!navigated) throw new Error("The selected result could not be opened in this workspace.");
    },
    [getWorkspaceContext, navigateToDocumentLocation],
  );
  const javaCompilerDiagnostics = useJavaEditorDiagnosticsController({
    port: javaEditorDiagnosticsAdapter,
    getEditorState: editorStore.getState,
    navigate: (location, canReveal) => documentNavigation.navigateToLocation(location.path, { kind: "range", range: location.range }, canReveal),
    workspaceId: workspace.currentWorkspaceId,
    generation: workspace.generation,
    activeDocument: !libraryDocument && activeLanguage === "java" ? readyActiveDocument : null,
    getContext: workspace.getContext,
    getProjectContext: () => ({ settings: javaProjectContext.settings, context: javaProjectContext.context }),
    editor: editorViewModel,
    subscribeEditor: editorStore.subscribe,
    onProjectContextRetired: javaProjectContext.retireContext,
  });
  const javaPositionNavigation = useJavaNavigationController({
    port: javaNavigationAdapter,
    workspaceId: workspace.currentWorkspaceId,
    generation: workspace.generation,
    getContext: workspace.getContext,
    getEditorState: editorStore.getState,
    getProjectContext: () => ({
      settings: javaProjectContext.settings,
      context: javaProjectContext.context,
    }),
    editor: editorViewModel,
    navigate: (location, canReveal) =>
      documentNavigation.navigateToLocation(
        location.path,
        { kind: "range", range: location.range },
        canReveal,
      ),
    onProjectContextRetired: javaProjectContext.retireContext,
  });
  const queryJavaPosition = useCallback(
    async (
      kind: "typeDefinition" | "typeHierarchy" | "callHierarchy" | "implementations",
      direction?: "supertypes" | "subtypes" | "both" | "incoming" | "outgoing",
    ): Promise<JavaNavigationResult | null> => {
      const navigation = javaPositionNavigation.navigation;
      const path = activeFilePath;
      const workspaceId = workspace.currentWorkspaceId;
      const cursor = path ? editorViewModel.cursorPosition(path) : null;
      const recordQueryTrace = (entry: Record<string, unknown>) => {
        if (!globalThis.document.body.hasAttribute("data-native-java-navigation-diagnostics"))
          return;
        const attribute = "data-native-java-position-query-trace";
        let history: Record<string, unknown>[] = [];
        try {
          const value = JSON.parse(
            globalThis.document.documentElement.getAttribute(attribute) ?? "[]",
          );
          if (Array.isArray(value)) history = value;
        } catch {
          history = [];
        }
        history.push({ kind, direction: direction ?? null, ...entry });
        globalThis.document.documentElement.setAttribute(
          attribute,
          JSON.stringify(history.slice(-8)),
        );
      };
      if (
        !navigation ||
        !workspaceId ||
        activeLanguage !== "java" ||
        !path?.endsWith(".java") ||
        !cursor
      ) {
        recordQueryTrace({
          phase: "guard",
          reason: !navigation
            ? "navigation-unavailable"
            : !workspaceId
              ? "workspace-unavailable"
              : activeLanguage !== "java"
                ? "active-file-not-java"
                : !path?.endsWith(".java")
                  ? "active-file-not-java-source"
                  : "cursor-unavailable",
          hasNavigation: Boolean(navigation),
          hasWorkspace: Boolean(workspaceId),
          hasJavaFile: activeLanguage === "java" && Boolean(path?.endsWith(".java")),
          hasCursor: Boolean(cursor),
        });
        return null;
      }
      try {
        const capture = editorViewModel.captureEditorBuffers();
        const document = capture.documents.find((candidate) => candidate.path === path);
        if (!document) {
          recordQueryTrace({ phase: "guard", reason: "captured-document-unavailable" });
          return null;
        }
        const request: JavaNavigationRequest = {
          ...navigation.context,
          requestId: `java-position-panel-${Date.now().toString(36)}-${++javaPositionRequestSequence.current}`,
          kind,
          ...(direction ? { direction } : {}),
          document: { path, text: document.text, version: document.version },
          position: { line: cursor.line - 1, character: cursor.column - 1 },
          includeDeclaration: true,
          limit:
            kind === "typeDefinition"
              ? 1
              : kind === "typeHierarchy" || kind === "implementations"
                ? 200
                : 500,
        };
        const response = await navigation.query(request);
        recordQueryTrace({
          phase: "response",
          line: request.position.line,
          character: request.position.character,
          status: response?.status ?? null,
          message:
            response?.status === "refused" || response?.status === "unavailable"
              ? response.message
              : null,
          returned: response?.status === "ready" ? response.returned : null,
          total: response?.status === "ready" ? response.total : null,
          items: response?.status === "ready" ? response.items.map((item) => item.label) : [],
        });
        return response;
      } catch (error) {
        recordQueryTrace({
          phase: "exception",
          errorName: error instanceof Error ? error.name : "unknown",
        });
        return null;
      }
    },
    [
      activeFilePath,
      activeLanguage,
      javaPositionNavigation.navigation,
      workspace.currentWorkspaceId,
    ],
  );
  const navigateJavaPosition = useCallback(
    (requestId: string, location: JavaNavigationLocation) =>
      javaPositionNavigation.navigation?.openLocation(requestId, location),
    [javaPositionNavigation.navigation],
  );
  const queryJavaReferencesAtCursor = useCallback(async (): Promise<JavaReferencesResponse> => {
    const semantics = javaLanguage.javaSemantics;
    const context = semantics?.context;
    const path = activeFilePath;
    const position = path ? editorViewModel.cursorPosition(path) : null;
    const requestId = `java-lsp-references-${Date.now().toString(36)}-${++javaPositionRequestSequence.current}`;
    if (
      !semantics ||
      !context ||
      activeLanguage !== "java" ||
      !path?.endsWith(".java") ||
      !position ||
      context.document.path !== path
    ) {
      return {
        ok: false,
        requestId,
        error: {
          kind: "unavailable",
          summary: "Open a synchronized Java source and place the cursor on a symbol.",
          retryable: true,
        },
      };
    }
    const request = {
      workspaceId: context.workspaceId,
      generation: context.generation,
      document: { ...context.document },
      position: { line: position.line - 1, character: position.column - 1 },
      requestId,
      cancellationId: `${requestId}-cancel`,
      includeDeclaration: true,
    };
    return semantics.references(request);
  }, [activeFilePath, activeLanguage, javaLanguage.javaSemantics]);
  const queryJavaDefinitionsAtCursor = useCallback(
    async (
      requestedPosition?: { line: number; column: number },
      kind: "definition" | "typeDefinition" = "definition",
    ): Promise<JavaDefinitionsResponse> => {
      const semantics = javaLanguage.javaSemantics;
      const context = semantics?.context;
      const query = kind === "typeDefinition" ? semantics?.typeDefinitions : semantics?.definitions;
      const path = activeFilePath;
      const cursor = requestedPosition ?? (path ? editorViewModel.cursorPosition(path) : null);
      const requestId = `java-lsp-${kind}-${Date.now().toString(36)}-${++javaPositionRequestSequence.current}`;
      const cancellationId = `${requestId}-cancel`;
      const previous = javaDefinitionsCancellationRef.current;
      javaDefinitionSourceGuard.current = null;
      javaDefinitionsCancellationRef.current = null;
      if (previous) void semantics?.cancel(previous);
      if (
        !query ||
        !semantics ||
        !context ||
        activeLanguage !== "java" ||
        !path?.endsWith(".java") ||
        !cursor ||
        context.document.path !== path
      ) {
        return {
          ok: false,
          requestId,
          error: {
            kind: "unavailable",
            summary: "Open a synchronized Java source and place the cursor on a symbol.",
            retryable: true,
          },
        };
      }
      const sourceWorkspace = getWorkspaceContext();
      const sourceText = editorStore.getState().contents[path];
      const sourceIsCurrent = (afterOpen: boolean) => {
        const current = getWorkspaceContext();
        const state = editorStore.getState();
        const position = editorViewModel.cursorPosition(path);
        return !current.isSwitching &&
          current.workspaceId === sourceWorkspace.workspaceId &&
          current.generation === sourceWorkspace.generation &&
          state.contents[path] === sourceText &&
          (afterOpen || (state.activeFilePath === path &&
            position?.line === cursor.line && position?.column === cursor.column));
      };
      javaDefinitionsCancellationRef.current = cancellationId;
      try {
        const response = await query.call(semantics, {
          workspaceId: context.workspaceId,
          generation: context.generation,
          document: { ...context.document },
          position: { line: cursor.line - 1, character: cursor.column - 1 },
          requestId,
          cancellationId,
        });
        if (javaDefinitionsCancellationRef.current !== cancellationId || !sourceIsCurrent(false)) {
          return {
            ok: false,
            requestId,
            error: { kind: "stale-version", summary: "Java editor source or cursor changed" },
          };
        }
        if (response.ok) javaDefinitionSourceGuard.current = sourceIsCurrent;
        return response;
      } finally {
        if (javaDefinitionsCancellationRef.current === cancellationId)
          javaDefinitionsCancellationRef.current = null;
      }
    },
    [activeFilePath, activeLanguage, getWorkspaceContext, javaLanguage.javaSemantics],
  );
  const queryJavaPanelDefinitions = useCallback(
    (kind?: "definition" | "typeDefinition") => queryJavaDefinitionsAtCursor(undefined, kind),
    [queryJavaDefinitionsAtCursor],
  );
  const cancelJavaDefinitions = useCallback(() => {
    const cancellationId = javaDefinitionsCancellationRef.current;
    javaDefinitionSourceGuard.current = null;
    javaDefinitionsCancellationRef.current = null;
    if (cancellationId) void javaLanguage.javaSemantics?.cancel(cancellationId);
  }, [javaLanguage.javaSemantics]);
  const queryJavaCallHierarchyAtCursor = useCallback(
    async (
      direction: JavaCallHierarchyRequest["direction"],
    ): Promise<JavaCallHierarchyResponse> => {
      const semantics = javaLanguage.javaSemantics;
      const context = semantics?.context;
      const path = activeFilePath;
      const cursor = path ? editorViewModel.cursorPosition(path) : null;
      const requestId = `java-lsp-call-hierarchy-${Date.now().toString(36)}-${++javaPositionRequestSequence.current}`;
      const cancellationId = `${requestId}-cancel`;
      const previous = javaCallHierarchyCancellationRef.current;
      javaCallHierarchyCancellationRef.current = null;
      if (previous) void semantics?.cancel(previous);
      if (
        !semantics?.callHierarchy ||
        !context ||
        activeLanguage !== "java" ||
        !path?.endsWith(".java") ||
        !cursor ||
        context.document.path !== path
      ) {
        return {
          ok: false,
          requestId,
          error: {
            kind: "unavailable",
            summary: "Open a synchronized Java source and place the cursor on a method.",
            retryable: true,
          },
        };
      }
      const cursorPosition = { line: cursor.line - 1, character: cursor.column - 1 };
      const request: JavaCallHierarchyRequest = {
        workspaceId: context.workspaceId,
        generation: context.generation,
        document: { ...context.document },
        position: cursorPosition,
        requestId,
        cancellationId,
        direction,
      };
      javaCallHierarchyCancellationRef.current = cancellationId;
      const response = await semantics.callHierarchy(request);
      if (javaCallHierarchyCancellationRef.current === cancellationId)
        javaCallHierarchyCancellationRef.current = null;
      const currentCursor = editorViewModel.cursorPosition(path);
      if (
        activeFilePath !== path ||
        activeLanguage !== "java" ||
        currentCursor?.line !== cursor.line ||
        currentCursor?.column !== cursor.column
      ) {
        return {
          ok: false,
          requestId,
          error: { kind: "stale-version", summary: "Java editor cursor changed" },
        };
      }
      return response;
    },
    [activeFilePath, activeLanguage, javaLanguage.javaSemantics],
  );
  const cancelJavaCallHierarchy = useCallback(() => {
    const cancellationId = javaCallHierarchyCancellationRef.current;
    javaCallHierarchyCancellationRef.current = null;
    if (cancellationId) void javaLanguage.javaSemantics?.cancel(cancellationId);
  }, [javaLanguage.javaSemantics]);
  const openJavaReferencesFromEditor = useCallback(
    (filePath: string, position: { line: number; column: number }) => {
      const currentWorkspace = workspaceStateRef.current;
      const context = currentWorkspace.getContext();
      if (
        context.isSwitching ||
        context.workspaceId !== currentWorkspace.currentWorkspaceId ||
        context.generation !== currentWorkspace.generation ||
        activeLanguage !== "java" ||
        activeFilePath !== filePath
      )
        return;
      editorViewModel.updateCursorPosition(filePath, position);
      panelStore.getState().setVisibility("leftSidebar", true);
      setActiveActivity("java-intelligence");
      setJavaReferencesQueryFocus((request) => request + 1);
    },
    [activeFilePath, activeLanguage],
  );
  const navigateJavaReference = useCallback(
    async (
      location: JavaReferenceLocation,
      isCurrent: (afterOpen: boolean) => boolean = () => true,
      select = false,
    ) => {
      const workspaceId = javaWorkspaceId;
      const generation = javaWorkspaceGeneration;
      const canReveal = (afterOpen: boolean) => {
        const current = getWorkspaceContext();
        return (
          current.workspaceId === workspaceId &&
          current.generation === generation &&
          !current.isSwitching &&
          isCurrent(afterOpen)
        );
      };
      return navigateToDocumentLocation(
        location.path,
        { kind: "range", range: location.range, select },
        canReveal,
      );
    },
    [getWorkspaceContext, javaWorkspaceGeneration, javaWorkspaceId, navigateToDocumentLocation],
  );
  const navigateJavaDefinition = useCallback(
    async (location: JavaReferenceLocation) => {
      const sourceIsCurrent = javaDefinitionSourceGuard.current;
      if (!sourceIsCurrent?.(false)) return false;
      return navigateJavaReference(location, sourceIsCurrent);
    },
    [navigateJavaReference],
  );
  const goToJavaDefinitionFromEditor = useCallback(
    async (filePath: string, position: { line: number; column: number }) => {
      if (filePath !== activeFilePath || activeLanguage !== "java") return;
      editorViewModel.updateCursorPosition(filePath, position);
      try {
        const response = await queryJavaDefinitionsAtCursor(position);
        if (!response.ok || response.result.locations.length === 0) return;
        await navigateJavaDefinition(response.result.locations[0]!);
      } catch {
        // Provider failures remain visible through the Java Intelligence query panel.
      }
    },
    [activeFilePath, activeLanguage, navigateJavaDefinition, queryJavaDefinitionsAtCursor],
  );
  const testSourceNavigationSequence = useRef(0);
  const revealJavaTestMethod = useJavaTestMethodNavigation({
    semantics: javaSemantics,
    // The displayed document is temporarily absent while a navigation opens a tab.
    // The store's active path distinguishes that transition from a user tab change.
    activeFilePath: editorState.activeFilePath,
    getWorkspaceContext,
    source: (path) => {
      const snapshot = editorViewModel.captureEditorBuffers();
      const source = snapshot.documents.find((document) => document.path === path);
      return source ? { ...source, isCurrent: () => { snapshot.verify(); return true; } } : undefined;
    },
    reveal: async (path, range, isCurrent) => documentNavigation.revealCurrentLocation(
      path, { kind: "range", range },
      () => editorViewModel.activeFilePath === path && isCurrent(),
    ),
  });
  const { reviewForSourceNavigation: reviewJavaSourceContext, settings: javaSourceProjectSettings } = javaProjectContext;
  const openJavaTestSource = useCallback<OpenJavaTestSource>(
    async (test, results, isSourceActionCurrent) => {
      const sequence = ++testSourceNavigationSequence.current;
      const workspaceId = javaWorkspaceId;
      const generation = javaWorkspaceGeneration;
      const context = getWorkspaceContext();
      const status = javaLanguageStatus;
      if (!workspaceId) throw new Error("Open a Java workspace before opening a test source.");
      if (
        context.isSwitching ||
        context.workspaceId !== workspaceId ||
        context.generation !== generation
      ) {
        throw new Error(
          "The Java workspace changed; restart Java Language before opening a test source.",
        );
      }
      if (!status) throw new Error("Java Language has no active session for this workspace.");
      if (status.workspaceId !== workspaceId) {
        throw new Error("The active Java Language session belongs to another workspace.");
      }
      if (!["ready", "indexing", "degraded"].includes(status.state)) {
        throw new Error(
          `Java Language is ${status.state}; wait for it to be ready before opening a test source.`,
        );
      }
      if (!status.capabilities.workspaceSymbols) {
        throw new Error(
          "The current Java language provider does not support workspace symbol search, which is required to locate this test source.",
        );
      }

      const normalizePath = (path: string | undefined) =>
        (path ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").replace(/^\.$/, "");
      const serviceProject = normalizePath(status.projectPath);
      const testScope = resolveJavaTestReportScope(test, results);
      const testModule = testScope.modulePath;
      if (
        serviceProject &&
        testModule !== serviceProject &&
        !testModule.startsWith(`${serviceProject}/`)
      ) {
        throw new Error("The current Java language session does not cover the test's module.");
      }

      const canReveal = () => {
        const current = getWorkspaceContext();
        return isSourceActionCurrent() && testSourceNavigationSequence.current === sequence && !current.isSwitching &&
          !current.isMetadataLoading && current.workspaceId === workspaceId && current.generation === generation;
      };
      let ownership: Awaited<ReturnType<typeof reviewJavaSourceContext>> | undefined;
      let runtimeOwner: JavaTestSourceOwner | undefined;
      let ownershipReason: string | undefined;
      let verifySaved: (() => void) | undefined;
      const ownedIsCurrent = () => {
        try { verifySaved?.(); return canReveal() && ownership?.isCurrent() === true; }
        catch { return false; }
      };
      if (test.methodSource?.testOrigin) {
        try {
          verifySaved = editorViewModel.reviewSavedBuffers({ allowNewBuffers: true });
          ownership = await reviewJavaSourceContext(javaSourceProjectSettings);
          verifySaved();
          if (!ownedIsCurrent()) throw new Error("The test source context changed during review.");
          const runtime = resolveJavaTestRuntimeOwner(ownership.context, results.projectPath, test.methodSource.testOrigin);
          if (runtime.kind !== "resolved") throw new Error(runtime.reason);
          runtimeOwner = runtime.owner;
        } catch (error) {
          ownershipReason = error instanceof Error ? error.message : "Test source ownership is unavailable.";
        }
      }
      const resolveType = async (className: string, owner?: JavaTestSourceOwner, allowInterface = false) => {
        const modulePath = owner?.module.root ?? testModule;
        const options = owner ? { allowInterface } : { allowInterface, nestedModulePaths: testScope.nestedModulePaths };
        if (serviceProject && modulePath !== serviceProject && !modulePath.startsWith(`${serviceProject}/`))
          throw new Error("The current Java language session does not cover the declaring module.");
        const binaryName = className.split(".").at(-1) ?? className;
        const typeNames = [...new Set([binaryName, binaryName.split("$")[0]!])];
        const symbols: JavaWorkspaceSymbol[] = [];
        let resolution = resolveJavaTestClassSymbol(symbols, className, modulePath, options);
        for (const query of typeNames) {
          const response = await searchJavaWorkspaceSymbols(query);
          if (!response.ok) throw new Error(response.error.summary);
          if (response.result.isTruncated) throw new Error(
            "Java workspace search was truncated; the test source cannot be resolved safely.",
          );
          symbols.push(...response.result.symbols.filter((symbol) => !owner || javaTestSourceBelongsToOwner(symbol.path, owner)));
          resolution = resolveJavaTestClassSymbol(symbols, className, modulePath, options);
          if (resolution.kind === "resolved") break;
        }
        return resolution;
      };
      const resolution = await resolveType(test.className, runtimeOwner);
      if (resolution.kind !== "resolved") throw new Error(resolution.reason);
      const navigationGuard = runtimeOwner ? ownedIsCurrent : canReveal;
      const openClass = (symbol: JavaWorkspaceSymbol, guard: () => boolean) =>
        editorViewModel.activeFilePath === symbol.path
          ? documentNavigation.revealCurrentLocation(symbol.path, { kind: "range", range: symbol.range }, guard)
          : navigateToDocumentLocation(symbol.path, { kind: "range", range: symbol.range }, guard);
      const opened = await openClass(resolution.symbol, navigationGuard);
      if (!opened) throw new Error("The test source could not be opened in the current workspace.");

      if (test.detail && (test.state === "failed" || test.state === "error")) {
        const sourceSnapshot = editorViewModel.captureEditorBuffers();
        const source = sourceSnapshot.documents.find((document) => document.path === resolution.symbol.path);
        const line = source
          ? resolveJavaTestFailureLine(test.detail, test.className, source.text, {
              detailTruncated: test.detailTruncated,
              sourceIsDirty: source.isDirty,
              sourceFileName: resolution.symbol.path.split(/[\\/]/).at(-1),
            })
          : null;
        if (line !== null) {
          // The opened buffer can be ready before its tab is displayed.
          const revealedFailure = await navigateToDocumentLocation(
            resolution.symbol.path,
            { kind: "point", point: { lineNumber: line, column: 1 } },
            () => { try { sourceSnapshot.verify(); return navigationGuard(); } catch { return false; } },
          );
          if (!revealedFailure)
            throw new Error(
              "The test failure location could not be opened in the current workspace.",
            );
          return;
        }
      }
      if (test.methodSource && status.capabilities.documentSymbols && navigationGuard()) {
        const sourceClass = test.methodSource.declaringClassName;
        let owner: JavaTestSourceOwner | undefined;
        if (test.methodSource.testOrigin) {
          if (!runtimeOwner || !ownership || !sourceClass || !test.methodSource.declaringOrigin)
            throw new Error(`Opened the test class. ${ownershipReason ?? "The compiled declaring source is unavailable or ambiguous."}`);
          const declaration = resolveJavaTestDeclaringOwner(ownership.context, runtimeOwner, test.methodSource.declaringOrigin);
          if (declaration.kind !== "resolved") throw new Error(`Opened the test class. ${declaration.reason}`);
          owner = declaration.owner;
        }
        const declaring = !sourceClass || (sourceClass === test.className && !owner)
          ? resolution : await resolveType(sourceClass, owner, sourceClass !== test.className);
        if (declaring.kind !== "resolved") throw new Error(`Opened the test class. ${declaring.reason}`);
        if (!navigationGuard()) return;
        if (declaring.symbol.path !== resolution.symbol.path) {
          const opened = await openClass(declaring.symbol, navigationGuard);
          if (!opened) return;
        }
        const method = await revealJavaTestMethod({ path: declaring.symbol.path,
          declaringClassName: sourceClass, methodName: test.methodSource.methodName,
          workspaceId, generation, isCurrent: navigationGuard });
        if (!method.revealed && navigationGuard()) throw new Error(
          `Opened the test class. ${method.reason ?? "The method declaration is unavailable."}`,
        );
      }
    },
    [
      javaWorkspaceGeneration,
      javaWorkspaceId,
      getWorkspaceContext,
      javaLanguageStatus,
      navigateToDocumentLocation,
      searchJavaWorkspaceSymbols,
      revealJavaTestMethod,
      documentNavigation,
      reviewJavaSourceContext,
      javaSourceProjectSettings,
    ],
  );
  const openReportedJavaTestSource = useJavaTestSourceAction(openJavaTestSource, {
    workspaceId: javaWorkspaceId,
    generation: javaWorkspaceGeneration,
    languageGeneration: javaLanguageStatus?.generation ?? null,
  });
  const cancelLibraryDefinition = javaLibrary.cancelDefinition;
  const openLibraryAtCursor = javaLibrary.openAtCursor;
  const openDependencySource = useCallback(
    async (cursor: JavaNavigationRequest) => {
      const projectPath = javaProjectContext.settings.projectPath;
      const hasJavaDraft = editorViewModel
        .captureEditorBuffers()
        .documents.some(
          (document) =>
            document.isDirty &&
            document.path.endsWith(".java") &&
            (!projectPath || document.path.startsWith(`${projectPath}/`)),
        );
      const selection = hasJavaDraft
        ? await javaPositionNavigation.navigation?.query({
            ...cursor,
            kind: "definition",
            includeDeclaration: true,
            limit: 1,
          })
        : undefined;
      await openLibraryAtCursor(cursor, selection);
    },
    [
      javaProjectContext.settings.projectPath,
      javaPositionNavigation.navigation,
      openLibraryAtCursor,
    ],
  );
  const javaEditorNavigation = useMemo(
    () =>
      javaPositionNavigation.navigation
        ? {
            ...javaPositionNavigation.navigation,
            readSource: (filePath: string, isCurrent: () => boolean) =>
              readJavaNavigationSource(
                editorAdapter,
                () => {
                  const state = editorStore.getState();
                  return state.tabs.some((tab) => tab.filePath === filePath)
                    ? state.contents[filePath]
                    : undefined;
                },
                filePath,
                () => {
                  const current = getWorkspaceContext();
                  const expected = javaPositionNavigation.navigation?.context;
                  return (
                    !current.isSwitching &&
                    current.workspaceId === expected?.workspaceId &&
                    current.generation === expected?.generation &&
                    isCurrent()
                  );
                },
              ),
            openDependencySource,
            navigateToImplementation: (
              location: JavaNavigationLocation,
              canReveal: (afterOpen: boolean) => boolean,
            ) =>
              navigateToDocumentLocation(
                location.path,
                { kind: "range", range: location.range },
                canReveal,
              ),
            queryDependencyDefinition: javaLibrary.queryDefinition,
            openDependencyDefinition: javaLibrary.openDefinition,
            cancel: (requestId: string) => {
              javaPositionNavigation.navigation?.cancel(requestId);
              cancelLibraryDefinition(requestId);
            },
          }
        : undefined,
    [
      javaPositionNavigation.navigation,
      openDependencySource,
      getWorkspaceContext,
      navigateToDocumentLocation,
      javaLibrary.queryDefinition,
      javaLibrary.openDefinition,
      cancelLibraryDefinition,
    ],
  );
  const refactorKitSymbolNavigation = useRefactorKitSymbolNavigationController({
    refactorKit: refactorKitAdapter,
    status: refactorKitStatus.status,
    capabilities: refactorKitStatus.capabilities,
    javaSourceAnalysisAvailable:
      javaProjectContext.context?.semanticAnalysis?.availability !== "unqualified",
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
  const canReviewJavaProjectType = useCallback(
    (operation: JavaProjectModelTypeOperation, type: JavaProjectModelClass): boolean => {
      const projectPath = javaProjectContext.settings.projectPath;
      return Boolean(
        javaProjectContext.settings.sdkHome.trim() &&
        javaProjectContext.context?.status === "available" &&
        javaProjectContext.context.semanticAnalysis?.availability !== "unqualified" &&
        projectPath &&
        type.path.startsWith(`${projectPath}/`) &&
        javaContextRefactoringOffered(refactorKitStatus.capabilities, operation, "preview"),
      );
    },
    [
      javaProjectContext.context,
      javaProjectContext.settings.projectPath,
      javaProjectContext.settings.sdkHome,
      refactorKitStatus.capabilities,
    ],
  );
  const canReviewJavaProjectField = useCallback(
    (field: JavaProjectModelSymbol): boolean => {
      const projectPath = javaProjectContext.settings.projectPath
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/$/, "");
      const path = field.path.replace(/\\/g, "/");
      return Boolean(
        field.kind.toUpperCase() === "FIELD" &&
        field.qualifiedName.trim() &&
        javaProjectContext.settings.sdkHome.trim() &&
        javaProjectContext.context?.status === "available" &&
        javaProjectContext.context.semanticAnalysis?.availability !== "unqualified" &&
        projectPath &&
        path.startsWith(`${projectPath}/`) &&
        javaContextRefactoringOffered(
          refactorKitStatus.capabilities,
          "encapsulate-field",
          "preview",
        ),
      );
    },
    [
      javaProjectContext.context,
      javaProjectContext.settings.projectPath,
      javaProjectContext.settings.sdkHome,
      refactorKitStatus.capabilities,
    ],
  );
  const javaProjectPackageAnchor = useCallback(
    (pkg: JavaProjectModelPackage): string | null => {
      const projectPath = javaProjectContext.settings.projectPath
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/$/, "");
      if (!projectPath) return null;
      return (
        pkg.sourcePaths.find((sourcePath) => {
          const normalizedPath = sourcePath.replace(/\\/g, "/").replace(/^\.\//, "");
          return normalizedPath.startsWith(`${projectPath}/`);
        }) ?? null
      );
    },
    [javaProjectContext.settings.projectPath],
  );
  const canReviewJavaProjectPackage = useCallback(
    (pkg: JavaProjectModelPackage): boolean => {
      return Boolean(
        javaProjectContext.settings.sdkHome.trim() &&
        javaProjectContext.context?.status === "available" &&
        javaProjectContext.context.semanticAnalysis?.availability !== "unqualified" &&
        javaProjectPackageAnchor(pkg) &&
        javaContextRefactoringOffered(refactorKitStatus.capabilities, "move-package", "preview"),
      );
    },
    [
      javaProjectContext.context,
      javaProjectContext.settings.sdkHome,
      refactorKitStatus.capabilities,
      javaProjectPackageAnchor,
    ],
  );
  const openJavaRefactoring = javaRefactoring.open;
  const canReviewJavaSourceRootMove = useCallback(
    (sourceRoot: string): boolean => {
      const projectPath = javaProjectContext.settings.projectPath
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/$/, "");
      const safeRelative = (value: string, allowEmpty = false) =>
        (allowEmpty && value === "") ||
        (value.length > 0 &&
          value === value.trim() &&
          !value.includes("\\") &&
          !value.includes(":") &&
          !value.includes("\0") &&
          !value.startsWith("/") &&
          !/^[A-Za-z]:/.test(value) &&
          value.split("/").every((part) => part && part !== "." && part !== ".."));
      return Boolean(
        javaProjectContext.settings.sdkHome.trim() &&
        javaProjectContext.context?.status === "available" &&
        javaProjectContext.context.semanticAnalysis?.availability !== "unqualified" &&
        safeRelative(projectPath, true) &&
        safeRelative(sourceRoot) &&
        javaContextRefactoringOffered(
          refactorKitStatus.capabilities,
          "move-source-root",
          "preview",
        ),
      );
    },
    [
      javaProjectContext.context,
      javaProjectContext.settings.projectPath,
      javaProjectContext.settings.sdkHome,
      refactorKitStatus.capabilities,
    ],
  );
  const selectJavaProjectLocation = refactorKitSymbolNavigation.selectJavaReference;
  const openJavaProjectPackageRefactoring = useCallback(
    (pkg: JavaProjectModelPackage): void => {
      const currentWorkspace = getWorkspaceContext();
      if (
        javaWritesInProgressRef.current ||
        currentWorkspace.isSwitching ||
        currentWorkspace.isMetadataLoading ||
        !currentWorkspace.workspaceId ||
        !canReviewJavaProjectPackage(pkg)
      )
        return;
      const packageAnchor = javaProjectPackageAnchor(pkg);
      if (!packageAnchor) return;

      const projectPath = javaProjectContext.settings.projectPath
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/$/, "");
      const dirtyProjectJavaFile = editorStore
        .getState()
        .tabs.find(
          (tab) =>
            tab.isDirty &&
            tab.filePath.endsWith(".java") &&
            (!projectPath || tab.filePath.startsWith(`${projectPath}/`)),
        );
      if (dirtyProjectJavaFile) {
        setJavaProjectNavigationStatus(
          `Save ${dirtyProjectJavaFile.filePath} before reviewing a package move from the saved project model.`,
        );
        return;
      }

      openJavaRefactoring(
        "move-package",
        { kind: "package", path: packageAnchor, identity: pkg.name },
        undefined,
        { operation: "move-package", fromPackage: pkg.name, toPackage: "" },
      );
      setJavaProjectNavigationStatus(null);
    },
    [
      canReviewJavaProjectPackage,
      javaProjectContext.settings.projectPath,
      javaProjectPackageAnchor,
      openJavaRefactoring,
      getWorkspaceContext,
    ],
  );
  const javaProjectContextSchemaVersion = javaProjectContext.context?.schemaVersion;
  const openJavaProjectSourceRootMove = useCallback(
    (sourceRoot: string): void => {
      const initialWorkspace = getWorkspaceContext();
      if (
        javaWritesInProgressRef.current ||
        initialWorkspace.isSwitching ||
        initialWorkspace.isMetadataLoading ||
        !initialWorkspace.workspaceId ||
        !canReviewJavaSourceRootMove(sourceRoot)
      ) {
        return;
      }
      const projectPath = javaProjectContext.settings.projectPath
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/$/, "");
      if (!javaProjectContextSchemaVersion) {
        setJavaProjectNavigationStatus("Synchronize the Java project before moving a source root.");
        return;
      }
      const targetPath = javaSourceRootTargetPath(
        projectPath,
        sourceRoot,
        javaProjectContextSchemaVersion,
      );
      const dirtyProjectJavaFile = editorStore
        .getState()
        .tabs.find(
          (tab) =>
            tab.isDirty &&
            tab.filePath.endsWith(".java") &&
            (!projectPath || tab.filePath.startsWith(`${projectPath}/`)),
        );
      if (dirtyProjectJavaFile) {
        setJavaProjectNavigationStatus(
          `Save ${dirtyProjectJavaFile.filePath} before reviewing a source-root move from the saved project model.`,
        );
        return;
      }
      openJavaRefactoring(
        "move-source-root",
        { kind: "source-root", path: targetPath, identity: targetPath },
        undefined,
        { operation: "move-source-root", to: "" },
      );
    },
    [
      canReviewJavaSourceRootMove,
      getWorkspaceContext,
      javaProjectContextSchemaVersion,
      javaProjectContext.settings.projectPath,
      openJavaRefactoring,
    ],
  );
  const openJavaProjectTypeRefactoring = useCallback(
    async (operation: "move-class" | "safe-delete", type: JavaProjectModelClass): Promise<void> => {
      const initialWorkspace = workspace.getContext();
      if (
        javaWritesInProgressRef.current ||
        initialWorkspace.isSwitching ||
        initialWorkspace.isMetadataLoading ||
        !initialWorkspace.workspaceId ||
        !canReviewJavaProjectType(operation, type)
      ) {
        return;
      }

      const projectPath = javaProjectContext.settings.projectPath;
      const dirtyProjectJavaFile = editorStore
        .getState()
        .tabs.find(
          (tab) =>
            tab.isDirty &&
            tab.filePath.endsWith(".java") &&
            (!projectPath || tab.filePath.startsWith(`${projectPath}/`)),
        );
      if (dirtyProjectJavaFile) {
        setJavaProjectNavigationStatus(
          `Save ${dirtyProjectJavaFile.filePath} before reviewing a move or deletion from the saved project model.`,
        );
        return;
      }

      setJavaProjectNavigationStatus(`Opening ${type.path}:${type.line}…`);
      try {
        const opened = await selectJavaProjectLocation({
          filePath: type.path,
          point: { lineNumber: type.line, column: 1 },
        });
        const currentWorkspace = workspace.getContext();
        if (
          !opened ||
          currentWorkspace.isSwitching ||
          currentWorkspace.isMetadataLoading ||
          currentWorkspace.workspaceId !== initialWorkspace.workspaceId ||
          currentWorkspace.generation !== initialWorkspace.generation
        ) {
          setJavaProjectNavigationStatus(
            `Could not open Java source at ${type.path}:${type.line}.`,
          );
          return;
        }

        const newlyDirtyProjectJavaFile = editorStore
          .getState()
          .tabs.find(
            (tab) =>
              tab.isDirty &&
              tab.filePath.endsWith(".java") &&
              (!projectPath || tab.filePath.startsWith(`${projectPath}/`)),
          );
        if (newlyDirtyProjectJavaFile || javaWritesInProgressRef.current) {
          setJavaProjectNavigationStatus(
            newlyDirtyProjectJavaFile
              ? `Save ${newlyDirtyProjectJavaFile.filePath} before reviewing a move or deletion from the saved project model.`
              : "Wait for the current Java write to finish before reviewing another operation.",
          );
          return;
        }

        openJavaRefactoring(operation, {
          kind: "class",
          path: type.path,
          identity: type.qualifiedName,
        });
        setJavaProjectNavigationStatus(null);
      } catch {
        setJavaProjectNavigationStatus(`Could not open Java source at ${type.path}:${type.line}.`);
      }
    },
    [
      openJavaRefactoring,
      selectJavaProjectLocation,
      canReviewJavaProjectType,
      javaProjectContext.settings.projectPath,
      workspace,
    ],
  );
  const openJavaProjectFieldEncapsulation = useCallback(
    async (field: JavaProjectModelSymbol): Promise<void> => {
      const initialWorkspace = workspace.getContext();
      if (
        javaWritesInProgressRef.current ||
        initialWorkspace.isSwitching ||
        initialWorkspace.isMetadataLoading ||
        !initialWorkspace.workspaceId ||
        !canReviewJavaProjectField(field)
      )
        return;

      const projectPath = javaProjectContext.settings.projectPath
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/\/$/, "");
      const dirtyProjectJavaFile = () =>
        editorStore
          .getState()
          .tabs.find(
            (tab) =>
              tab.isDirty &&
              tab.filePath.endsWith(".java") &&
              (!projectPath || tab.filePath.startsWith(`${projectPath}/`)),
          );
      const dirtyFile = dirtyProjectJavaFile();
      if (dirtyFile) {
        setJavaProjectNavigationStatus(
          `Save ${dirtyFile.filePath} before reviewing field encapsulation from the saved project model.`,
        );
        return;
      }

      setJavaProjectNavigationStatus(`Opening ${field.path}:${field.line}…`);
      try {
        const opened = await selectJavaProjectLocation({
          filePath: field.path,
          point: { lineNumber: field.line, column: 1 },
        });
        const currentWorkspace = workspace.getContext();
        if (
          !opened ||
          currentWorkspace.isSwitching ||
          currentWorkspace.isMetadataLoading ||
          currentWorkspace.workspaceId !== initialWorkspace.workspaceId ||
          currentWorkspace.generation !== initialWorkspace.generation
        ) {
          setJavaProjectNavigationStatus(
            `Could not open Java field at ${field.path}:${field.line}.`,
          );
          return;
        }
        const newlyDirtyFile = dirtyProjectJavaFile();
        if (newlyDirtyFile || javaWritesInProgressRef.current) {
          setJavaProjectNavigationStatus(
            newlyDirtyFile
              ? `Save ${newlyDirtyFile.filePath} before reviewing field encapsulation.`
              : "Wait for the current Java write to finish before reviewing another operation.",
          );
          return;
        }

        openJavaRefactoring("encapsulate-field", {
          kind: "member",
          path: field.path,
          identity: field.qualifiedName,
        });
        setJavaProjectNavigationStatus(null);
      } catch {
        setJavaProjectNavigationStatus(`Could not open Java field at ${field.path}:${field.line}.`);
      }
    },
    [
      canReviewJavaProjectField,
      javaProjectContext.settings.projectPath,
      openJavaRefactoring,
      selectJavaProjectLocation,
      workspace,
    ],
  );
  const refactorKitDiagnostics = useRefactorKitDiagnosticsController({
    refactorKit: refactorKitAdapter,
    status: refactorKitStatus.status,
    capabilities: refactorKitStatus.capabilities,
    isCheckingCapabilities: refactorKitStatus.isChecking,
    workspaceInfo,
    workspaceGeneration: workspace.generation,
    acceptedSession: refactorKitSymbolNavigation.acceptedSession,
    getWorkspaceContext: workspace.getContext,
    getCurrentDocument: () => typeScriptDiagnosticsDocument,
  });
  const refactorKitDiagnosticsMatchActiveDocument =
    refactorKitDiagnostics.activeDiagnosticDocument?.path === activeFilePath;
  const javaCompilerDiagnosticsMatchActiveDocument = javaCompilerDiagnostics.activeDiagnosticDocument?.path === activeFilePath;
  const activeDiagnostics = refactorKitDiagnosticsMatchActiveDocument
    ? refactorKitDiagnostics.activeDiagnostics
    : javaCompilerDiagnosticsMatchActiveDocument
      ? [...javaCompilerDiagnostics.activeDiagnostics, ...javaActiveDiagnostics.filter(diagnostic => diagnostic.severity !== "error")]
      : javaActiveDiagnostics;
  const activeDiagnosticDocument = refactorKitDiagnosticsMatchActiveDocument
    ? refactorKitDiagnostics.activeDiagnosticDocument
    : javaCompilerDiagnosticsMatchActiveDocument ? javaCompilerDiagnostics.activeDiagnosticDocument : javaActiveDiagnosticDocument;
  const activeDiagnosticOwner = refactorKitDiagnosticsMatchActiveDocument
    ? refactorKitDiagnostics.activeDiagnosticOwner
    : javaCompilerDiagnosticsMatchActiveDocument ? javaCompilerDiagnostics.activeDiagnosticOwner : javaActiveDiagnosticOwner;
  const problemItems = useMemo(
    () => [
      ...javaProblemItems.filter(item => !(javaCompilerDiagnostics.result && item.severity === "error"
        && (!javaCompilerDiagnostics.checkedProjectPath || item.filePath.startsWith(`${javaCompilerDiagnostics.checkedProjectPath}/`)))),
      ...javaCompilerDiagnostics.problemItems,
      ...refactorKitDiagnostics.problemItems,
    ],
    [javaProblemItems, javaCompilerDiagnostics.result, javaCompilerDiagnostics.checkedProjectPath,
      javaCompilerDiagnostics.problemItems, refactorKitDiagnostics.problemItems],
  );

  const [showRecovery, setShowRecovery] = useState(false);
  const editorRecovery = useEditorRecoveryController({
    port: editorRecoveryAdapter,
    workspaceId: workspaceInfo?.id ?? null,
    generation: workspace.generation,
    ready: !workspace.isLoading,
    getContext: workspace.getContext,
    store: editorStore,
    editor: editorViewModel,
    documents: javaLanguage,
    openFile: (filePath) =>
      desktopEditorController.openFileProgrammatically({
        id: filePath,
        path: filePath,
        name: filePath.split("/").pop() ?? filePath,
        type: "file",
      }),
  });
  const refreshTreeAfterNewFileSave = useCallback(async () => {
    const before = getWorkspaceContext();
    await fileTreeViewModel.loadRoot(() => {
      const current = getWorkspaceContext();
      return (
        !current.isSwitching &&
        current.workspaceId === before.workspaceId &&
        current.generation === before.generation
      );
    });
  }, [getWorkspaceContext]);
  const editorCommands = useEditorCommandController({
    activeFilePath: editorState.activeFilePath,
    activeContent,
    activeReadOnly: !!libraryDocument,
    hasJavaContext: hasJavaContext && !libraryDocument,
    workspaceId: workspaceInfo?.id ?? null,
    workspaceGeneration: workspace.generation,
    getEditorState: editorStore.getState,
    editor: editorViewModel,
    desktopEditor: desktopEditorController,
    documents: javaLanguage,
    checkpointBeforeSave: editorRecovery.flush,
    afterNewFileSaved: refreshTreeAfterNewFileSave,
  });
  const getCloseGuardState = useCallback(() => ({
    ...editorStore.getState(), blockReason: gitTransitionBlockReasonRef.current ?? databaseTransitionBlockReasonRef.current,
  }), []);
  useEditorCloseGuard(getCloseGuardState, editorCommands.reportError);
  const diskComparison = useEditorDiskComparisonController({
    editor: editorViewModel,
    synchronizeDocument: javaLanguage.synchronizeEditorDocument,
    activeFilePath: editorState.activeFilePath,
    workspaceId: workspaceInfo?.id ?? null,
    workspaceGeneration: workspace.generation,
    reportError: editorCommands.reportError,
    checkpointBeforeDiscard: editorRecovery.flush,
  });
  const externalDisk = useEditorExternalChangeMonitor({
    port: editorAdapter,
    openFiles: editorState.openFiles,
    activeFile:
      editorState.openFiles.find((file) => file.filePath === editorState.activeFilePath) ?? null,
    workspaceId: workspaceInfo?.id ?? null,
    generation: workspace.generation,
    enabled: !workspace.isLoading,
    getContext: workspace.getContext,
    getOpenFiles: () => editorStore.getState().openFiles,
  });
  const sourceBreakpoints = useJavaSourceBreakpoints({
    workspaceId: workspaceInfo?.id ?? null,
    generation: workspace.generation,
    rootPath: workspaceInfo?.rootPath ?? null,
    getContext: workspace.getContext,
    getEditorState: editorStore.getState,
    editor: editorViewModel,
    isExecuting: () => javaExecution.pending || javaExecution.running,
  });
  const javaExecution = useJavaExecutionController({
    entryPointPort: javaEntryPointAdapter,
    sourceExecutionEnabled: Boolean(workspaceInfo && !workspace.isLoading),
    port: javaExecutionAdapter,
    workspaceId: workspaceInfo?.id ?? null,
    generation: workspace.generation,
    enabled: activeActivity === "java-execution" || commandPaletteOpen,
    prepare: () => editorCommands.saveAll({ deferJavaLanguageServiceSync: true }),
    getSourceBreakpoints: sourceBreakpoints.getInitial,
    reviewSavedBuffers: () => editorViewModel.reviewSavedBuffers(),
    captureCoverageSources: () => {
      const capture = editorViewModel.captureEditorBuffers({ allowNewBuffers: true });
      return {
        filePaths: capture.documents
          .filter((document) => !document.isNew && !document.isDirty)
          .map((document) => document.path),
        verify: capture.verify,
        isDocumentCurrent: capture.isDocumentCurrent,
      };
    },
    projectContext: {
      settings: javaProjectContext.settings,
      context: javaProjectContext.context,
      getSettings: () => javaProjectContext.settings,
      refresh: javaProjectContext.refreshForExecution,
      retire: javaProjectContext.retireContext,
      pauseMonitoring: javaProjectContext.pauseMonitoring,
    },
  });
  const javaDebugEditor = useJavaDebugEditorController({
    port: javaExecutionAdapter,
    snapshot: javaExecution.snapshot,
    workspaceId: workspace.currentWorkspaceId,
    generation: workspace.generation,
    getContext: workspace.getContext,
    getEditorState: editorStore.getState,
    editor: editorViewModel,
    breakpoints: sourceBreakpoints,
  });
  const coverageSourcePaths = useMemo(() => {
    const snapshot = javaExecution.snapshot;
    const captured = javaExecution.coverageProjectContext;
    if (
      !snapshot ||
      !snapshot.coverage ||
      !["coverage", "integration-coverage"].includes(snapshot.operation) ||
      ["starting", "running"].includes(snapshot.state) ||
      !captured ||
      captured.workspaceId !== snapshot.workspaceId ||
      captured.generation !== snapshot.generation ||
      captured.sessionId !== snapshot.sessionId
    )
      return new Map<string, string>();
    if (!captured.sourceFilesCurrent) return new Map<string, string>();
    const sources = javaCoverageSourcePaths(
      snapshot.coverage,
      captured.settings,
      captured.context,
      captured.sourcePaths,
    );
    const dirty = new Set(editorState.tabs.filter((tab) => tab.isDirty).map((tab) => tab.filePath));
    return new Map(
      [...sources].filter(
        ([, path]) =>
          typeof editorState.contents[path] === "string" &&
          captured.isDocumentCurrent?.(path) === true &&
          !dirty.has(path) &&
          !externalDisk.issues.some((issue) => issue.filePath === path),
      ),
    );
  }, [
    editorState.tabs,
    editorState.contents,
    externalDisk.issues,
    javaExecution.coverageProjectContext,
    javaExecution.snapshot,
  ]);
  const activeJavaCoverage = useMemo(() => {
    const snapshot = javaExecution.snapshot;
    if (
      !snapshot ||
      !snapshot.coverage ||
      !["coverage", "integration-coverage"].includes(snapshot.operation) ||
      ["starting", "running"].includes(snapshot.state) ||
      snapshot.workspaceId !== workspace.currentWorkspaceId ||
      snapshot.generation !== workspace.generation ||
      activeLanguage !== "java" ||
      libraryDocument
    )
      return undefined;
    const tab = editorState.tabs.find((item) => item.filePath === editorFilePath);
    if (!tab) return undefined;
    const measured = snapshot.coverage.files.find(
      (file) => coverageSourcePaths.get(file.id) === editorFilePath,
    );
    if (!measured) return undefined;
    return {
      context: {
        workspaceId: snapshot.workspaceId,
        generation: snapshot.generation,
        sessionId: snapshot.sessionId,
      },
      filePath: editorFilePath,
      lines: measured.lines,
      sourceCurrent:
        !tab.isDirty &&
        !(
          externalDisk.issue?.filePath === editorFilePath &&
          externalDisk.issue.status !== "unchanged"
        ),
    };
  }, [
    activeLanguage,
    coverageSourcePaths,
    editorFilePath,
    editorState.tabs,
    externalDisk.issue,
    javaExecution.snapshot,
    libraryDocument,
    workspace.currentWorkspaceId,
    workspace.generation,
  ]);
  const shell = useDesktopShellController({
    getPanelActions: panelStore.getState,
    loadAiAgentCommands,
    hasJavaContext,
    problemItems,
  });
  const { activateBottomTab } = shell;
  const handleOpenSettings = useSettingsOpenCoordinator({
    open: settings.open,
    loadAiAgentConfiguration,
    loadAiAgentCommands,
    loadWorkspaceMetadata,
    refreshJavaLanguage: javaLanguage.refresh,
    refreshRefactorKitStatus: refactorKitStatus.refresh,
  });

  useLayoutEffect(() => {
    document.documentElement.dataset.ideBootstrap = "react-committed";
  }, []);

  useLayoutEffect(() => {
    workspaceCollaboratorsRef.current = {
      transitionBlockReason: () => gitTransitionBlockReasonRef.current ?? databaseTransitionBlockReasonRef.current,
      editor: {
        hasUnsavedChanges: () => editorStore.getState().tabs.some((tab) => tab.isDirty),
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
      javaRefactoring: {
        resetWorkspace: javaRefactoring.resetWorkspace,
      },
      javaProjectModel: {
        resetWorkspace: javaProjectModel.resetWorkspace,
      },
      refactorKitStatus: refactorKitStatus.workspaceCollaborator,
      semanticSymbols: refactorKitSymbolNavigation.workspaceCollaborator,
      xcom2ModuleActivation: xcom2ModuleActivation.workspaceCollaborator,
      xcom: xcom2SetupWorkspaceCollaborator,
      ai: aiAgentWorkspaceCollaborator,
      shell: {
        clearClosedPreviews: documentNavigation.clearClosedPreviews,
        resetTerminal: terminal.resetWorkspace,
        loadFileTree: () => fileTreeViewModel.loadRoot(),
      },
    };
  });

  // ── Derived values ──────────────────────────────────────────────────

  const xcom2ModuleConfigurationDiagnosticCode =
    xcom2ModuleActivation.projectSnapshot?.diagnostic?.code;
  const xcom2ModuleConfigurationDiagnosticPresentation = useMemo(
    () =>
      xcom2ModuleConfigurationDiagnosticCode
        ? mapXcom2ModuleConfigurationDiagnosticPresentation(xcom2ModuleConfigurationDiagnosticCode)
        : null,
    [xcom2ModuleConfigurationDiagnosticCode],
  );

  const xcom2ProjectActivityContributions = useMemo<
    readonly Readonly<PanelLayoutActivityContribution>[]
  >(() => {
    if (
      !xcom2ModuleActivation.projectSnapshot ||
      xcom2ModuleActivation.activeProjectDecisions.length === 0
    ) {
      return NO_ACTIVITY_CONTRIBUTIONS;
    }

    const contribution = Object.freeze({
      id: "xcom2-project",
      label: "XCOM 2 Project",
      title: "XCOM 2 Project",
      content: (
        <Xcom2ProjectRecognitionPanel
          snapshot={xcom2ModuleActivation.snapshot!}
          activeDecisions={xcom2ModuleActivation.activeModules}
          projectSnapshot={xcom2ModuleActivation.projectSnapshot}
          recognitionSnapshot={xcom2ModuleActivation.snapshot}
          activeProjectDecisions={xcom2ModuleActivation.activeProjectDecisions}
          diagnosticPresentation={xcom2ModuleConfigurationDiagnosticPresentation}
          buildRecipeContribution={xcom2ProjectBuildRecipe.contribution}
        />
      ),
    } satisfies PanelLayoutActivityContribution);
    return Object.freeze([contribution]);
  }, [
    xcom2ModuleActivation.activeModules,
    xcom2ModuleActivation.activeProjectDecisions,
    xcom2ModuleActivation.projectSnapshot,
    xcom2ModuleActivation.snapshot,
    xcom2ModuleConfigurationDiagnosticPresentation,
    xcom2ProjectBuildRecipe.contribution,
  ]);

  const openWorkspaceFileFromAgent = desktopEditorController.openFileProgrammatically;
  const javaNavigationQueryCapabilities = useMemo(() => {
    const query = refactorKitStatus.capabilities?.methods?.find(
      (method) =>
        method.name === "intelligence.query" && method.requiresProject && !method.writesWorkspace,
    );
    const features = query?.features;
    const sourceAnalysisQualified =
      javaProjectContext.context?.semanticAnalysis?.availability !== "unqualified";
    const common = Boolean(
      sourceAnalysisQualified &&
      features?.snapshotBound &&
      features.typedRefusal &&
      features.bounded,
    );
    const projectPath = javaProjectContext.settings.projectPath;
    const hasDirtyJavaBuffers = editorState.tabs.some(
      (tab) =>
        tab.isDirty &&
        tab.filePath.endsWith(".java") &&
        (!projectPath || tab.filePath.startsWith(`${projectPath}/`)),
    );
    const hasOverlayAuthority = Boolean(
      javaProjectContext.settings.sdkHome.trim() &&
      javaProjectContext.context?.status === "available",
    );
    const admitted = (savedFeature: string, positionFeature: string, overlayFeature: string) =>
      Boolean(
        common &&
        features?.[savedFeature] &&
        features[positionFeature] &&
        (!hasDirtyJavaBuffers || (hasOverlayAuthority && features[overlayFeature])),
      );
    return {
      typeDefinition: admitted(
        "javaSavedSnapshotTypeDefinition",
        "typeDefinitionAtPosition",
        "javaImmutableEditorOverlayTypeDefinition",
      ),
      typeHierarchy: admitted(
        "javaSavedSnapshotTypeHierarchy",
        "typeHierarchyAtPosition",
        "javaImmutableEditorOverlayTypeHierarchy",
      ),
      callHierarchy: admitted(
        "javaSavedSnapshotCallHierarchy",
        "callHierarchyAtPosition",
        "javaImmutableEditorOverlayCallHierarchy",
      ),
      implementations: admitted(
        "javaSavedSnapshotImplementations",
        "implementationsAtPosition",
        "javaImmutableEditorOverlayImplementations",
      ),
    };
  }, [
    editorState.tabs,
    javaProjectContext.context,
    javaProjectContext.settings.projectPath,
    javaProjectContext.settings.sdkHome,
    refactorKitStatus.capabilities,
  ]);
  const isJavaPositionAvailable = Boolean(
    activeLanguage === "java" &&
    activeFilePath?.endsWith(".java") &&
    javaPositionNavigation.navigation &&
    editorViewModel.cursorPosition(activeFilePath),
  );
  const isJavaLanguageServicePositionAvailable = Boolean(
    activeLanguage === "java" &&
    activeFilePath?.endsWith(".java") &&
    javaLanguage.javaSemantics?.context?.document.path === activeFilePath &&
    editorViewModel.cursorPosition(activeFilePath),
  );
  // JavaIntelligencePanel derives its availability badge from status.available /
  // error / isChecking. Feed it a status that honestly reflects the Java
  // navigation surface (capability-advertised + authorized) so the Definition /
  // References controls and the badge match javaAvailability. No evidence is
  // fabricated: available is true only when the Java navigation capability is
  // genuinely available for the authorized workspace.
  const activityContributions = useMemo<
    readonly Readonly<PanelLayoutActivityContribution>[]
  >(() => {
    const javaNavigationPanelStatus: RefactorKitStatus =
      refactorKitSymbolNavigation.javaAvailability === "available"
        ? (refactorKitStatus.status ?? { available: true })
        : refactorKitSymbolNavigation.javaAvailability === "error"
          ? { available: false, lastError: refactorKitSymbolNavigation.javaError ?? undefined }
          : {
              available: false,
              lastError: refactorKitSymbolNavigation.javaAvailabilityReason ?? undefined,
            };
    return Object.freeze([
      Object.freeze({
        id: "pi-agent",
        label: "Agent",
        title: "Workspace Pi Agent",
        content: (
          <PiWorkspaceAgentActivity
            port={piWorkspaceAgentAdapter}
            workspace={workspaceInfo}
            workspaceGeneration={javaWorkspaceGeneration}
            onOpenWorkspaceFile={async (node) => {
              await openWorkspaceFileFromAgent(node, true);
            }}
            onOpenRange={(path, startLine, endLine) => {
              void (async () => {
                const context = getWorkspaceContext();
                if (context.isSwitching || context.isMetadataLoading || context.workspaceId !== workspaceInfo?.id || context.generation !== javaWorkspaceGeneration) return;
                const outcome = await new TauriEditorOpenRangeAdapter(workspaceInfo.rootPath).openRange({
                  path,
                  startLine,
                  endLine,
                });
                if (outcome.kind === "unavailable") {
                  console.warn("[PiWorkspaceAgent] editor_open_range unavailable", {
                    path,
                    startLine,
                    endLine,
                    reason: outcome.reason,
                  });
                  return;
                }
                const current = getWorkspaceContext();
                if (current.isSwitching || current.isMetadataLoading || current.workspaceId !== context.workspaceId || current.generation !== context.generation) return;
                // Native validation resolves the source; renderer navigation opens it.
                await documentNavigation.navigateToLocation(path, {
                  kind: "range",
                  range: {
                    start: { line: startLine - 1, character: 0 },
                    end: { line: endLine, character: 0 },
                  },
                });
              })().catch(() => {
                console.warn("[PiWorkspaceAgent] source range is unavailable; refresh Git Changes.");
              });
            }}
          />
        ),
      } satisfies PanelLayoutActivityContribution),
      ...xcom2ProjectActivityContributions,
      Object.freeze({
        id: "git-source-control",
        label: "Git",
        title: "Local Git changes, staging, commits and history",
        content: <GitWorkspacePanel controller={gitWorkspace} />,
      } satisfies PanelLayoutActivityContribution),
      Object.freeze({
        id: "java-structure",
        label: "Java Structure",
        title: "Types, fields and methods in the current Java file",
        content: <JavaStructurePanel
          active={activeActivity === "java-structure" && !workspaceMetadataLoading && !workspaceSwitching && !workspace.isLoading}
          workspaceId={workspace.currentWorkspaceId}
          generation={workspace.generation}
          document={readJavaStructureDocument()}
          semantics={libraryDocument ? undefined : javaSemantics}
          capable={javaLanguage.status?.capabilities.documentSymbols === true}
          isCurrent={() => {
            const context = getWorkspaceContext();
            return context.workspaceId === workspace.currentWorkspaceId && context.generation === workspace.generation &&
              !context.isSwitching && !context.isMetadataLoading;
          }}
          getCurrentDocument={readJavaStructureDocument}
          reveal={(path, range, isCurrent) => documentNavigation.revealCurrentLocation(path, { kind: "range", range }, isCurrent)}
        />,
      } satisfies PanelLayoutActivityContribution),
      Object.freeze({
        id: "java-execution",
        label: "Java Run",
        title: "Java build, tests, run and debugger",
        content: (
          <JavaExecutionPanel
            controller={javaExecution}
            onOpenJavaProject={() => setActiveActivity("java-project-model")}
            sourceBreakpoints={sourceBreakpoints}
            coverageSourcePaths={coverageSourcePaths}
            onOpenCompilerSource={(diagnostic) => {
              const context = getWorkspaceContext();
              const session = javaExecution.snapshot;
              if (!session || context.isSwitching || context.isMetadataLoading ||
                context.workspaceId !== session.workspaceId || context.generation !== session.generation ||
                !session.compilerDiagnostics?.items.includes(diagnostic)) return;
              void documentNavigation.navigateToLocation(diagnostic.path, {
                kind: "point", point: { lineNumber: diagnostic.line, column: 1 },
              });
            }}
            onOpenCoverageSource={(path, line) => {
              const context = getWorkspaceContext();
              const captured = javaExecution.coverageProjectContext;
              if (!captured || context.isSwitching || context.isMetadataLoading ||
                context.workspaceId !== captured.workspaceId || context.generation !== captured.generation ||
                !captured.isDocumentCurrent?.(path)) return;
              void documentNavigation.navigateToLocation(path, {
                kind: "point",
                point: { lineNumber: line, column: 1 },
              });
            }}
            onOpenTestSource={openReportedJavaTestSource}
          />
        ),
      } satisfies PanelLayoutActivityContribution),
      Object.freeze({
        id: "java-intelligence",
        label: "Java Intelligence",
        title: "Java symbol navigation",
        content: (
          <JavaIntelligencePanel
            presentationMode="project"
            focusWorkspaceSymbolSearch={javaWorkspaceSymbolSearchFocus}
            focusJavaReferencesQuery={javaReferencesQueryFocus}
            languageServiceStatus={javaLanguage.status}
            isLanguageServiceRefreshing={javaLanguage.refreshing}
            onStartLanguageService={javaLanguage.start}
            onStopLanguageService={javaLanguage.stop}
            onRestartLanguageService={javaLanguage.restart}
            onRefreshLanguageService={javaLanguage.refresh}
            onSearchWorkspaceSymbols={javaLanguage.searchWorkspaceSymbols}
            onCancelWorkspaceSymbolSearch={javaLanguage.cancelWorkspaceSymbolSearch}
            onNavigateWorkspaceSymbol={(symbol) => {
              void documentNavigation.navigateToLocation(symbol.path, {
                kind: "range",
                range: symbol.range,
              });
            }}
            javaPositionCapabilities={javaNavigationQueryCapabilities}
            isJavaPositionAvailable={isJavaPositionAvailable}
            positionNavigationScope={JSON.stringify([workspace.currentWorkspaceId, workspace.generation, activeFilePath, javaProjectContext.context?.contextHash])}
            isJavaLanguageServicePositionAvailable={isJavaLanguageServicePositionAvailable}
            onQueryJavaPosition={queryJavaPosition}
            onNavigateJavaPosition={navigateJavaPosition}
            onQueryJavaReferences={queryJavaReferencesAtCursor}
            onQueryJavaDefinitions={queryJavaPanelDefinitions}
            javaDefinitionScope={JSON.stringify([
              workspace.currentWorkspaceId,
              workspace.generation,
              javaLanguage.javaSemantics?.context?.generation,
              javaLanguage.javaSemantics?.context?.document,
              activeCursorPosition,
            ])}
            onCancelJavaDefinitions={cancelJavaDefinitions}
            onNavigateJavaDefinition={navigateJavaDefinition}
            onQueryJavaCallHierarchy={queryJavaCallHierarchyAtCursor}
            onCancelJavaCallHierarchy={cancelJavaCallHierarchy}
            onNavigateJavaReference={navigateJavaReference}
            onNavigateJavaCallHierarchy={navigateJavaReference}
            status={javaNavigationPanelStatus}
            capabilities={refactorKitStatus.capabilities}
            isChecking={refactorKitStatus.isChecking}
            error={refactorKitSymbolNavigation.javaError}
            symbol={refactorKitSymbolNavigation.javaSymbol}
            onSymbolChange={refactorKitSymbolNavigation.setJavaSymbol}
            isRunning={refactorKitSymbolNavigation.isJavaBusy}
            runningOperation={
              refactorKitSymbolNavigation.isJavaBusy
                ? refactorKitSymbolNavigation.javaLatestOperation
                : null
            }
            latestOperation={refactorKitSymbolNavigation.javaLatestOperation}
            result={refactorKitSymbolNavigation.javaResult}
            onDefinition={refactorKitSymbolNavigation.resolveJavaDefinition}
            onReferences={refactorKitSymbolNavigation.resolveJavaReferences}
            onNavigateLocation={(location) => {
              void refactorKitSymbolNavigation.selectJavaReference({
                filePath: location.path,
                point: { lineNumber: location.line, column: location.column ?? 1 },
              });
            }}
            onRefresh={refactorKitStatus.refresh}
          />
        ),
      } satisfies PanelLayoutActivityContribution),
      Object.freeze({
        id: "java-project-model",
        label: "Java Project",
        title: "Java project model from the RefactorKit engine",
        content: (
          <JavaProjectModelPanel
            controller={javaProjectModel}
            contextController={javaProjectContext}
            onOpenGradlePreparation={openJavaExecution}
            onOpenMavenVerification={openJavaExecution}
            onRecoverSavedSources={recoverSavedJavaSources}
            onOpenGradleTerminal={terminal.state.capabilities?.available ? (projectPath) => {
              const current = getWorkspaceContext();
              if (!javaWorkspaceId || current.isSwitching || current.isMetadataLoading ||
                  current.workspaceId !== javaWorkspaceId || current.generation !== javaWorkspaceGeneration) return;
              setTerminalDirectoryRequest({
                cwd: projectPath || ".",
                workspaceId: javaWorkspaceId,
                generation: javaWorkspaceGeneration,
              });
              panelStore.getState().setVisibility("bottomPanel", true);
              activateBottomTab("terminal");
            } : undefined}
            refactorKitPort={refactorKitAdapter}
            refactorKitCapabilities={refactorKitStatus.capabilities}
            beginJavaProjectWrite={beginJavaProjectWrite}
            reconcileJavaProjectChanges={reconcileMavenModuleRenameChanges}
            onMavenModuleRenameSourceChanged={onMavenModuleRenameSourceChanged}
            mavenModuleRenameTransaction={{
              transaction: mavenModuleRenameTransaction,
              setTransaction: setMavenModuleRenameTransaction,
            }}
            onCreateMavenModule={(parentPomPath) =>
              openJavaRefactoring("create-maven-module", {
                kind: "file",
                path: parentPomPath,
                identity: parentPomPath,
              })
            }
            onRenameGradleModule={(buildRoot, settingsPath, oldProjectPath) => openJavaRefactoring(
              "rename-gradle-module", { kind: "file", path: settingsPath, identity: settingsPath }, undefined,
              { operation: "rename-gradle-module", buildRoot, oldProjectPath, newProjectPath: "" },
            )}
            onCreateGradleModule={(buildRoot, settingsPath) =>
              openJavaRefactoring(
                "create-gradle-module",
                { kind: "file", path: settingsPath, identity: settingsPath },
                undefined,
                { operation: "create-gradle-module", buildRoot, projectPath: ":new-module" },
              )
            }
            workspaceId={javaWorkspaceId}
            generation={javaWorkspaceGeneration}
            workspaceRootPath={workspaceInfo?.rootPath ?? null}
            scaffoldPort={javaProjectScaffoldAdapter}
            declarationPort={javaProjectDeclarationAdapter}
            onDeclarationCreated={async (path, authority) => {
              const current = () => {
                const active = getWorkspaceContext();
                return active.workspaceId === authority.workspaceId &&
                  active.generation === authority.generation &&
                  !active.isSwitching && !active.isMetadataLoading;
              };
              if (!current()) throw new Error("The workspace changed after declaration creation.");
              javaProjectContext.retireContext(
                "Declaration created. Synchronize Java Project to validate the configuration with RefactorKit.",
              );
              await fileTreeViewModel.loadRoot(current);
              if (current()) await documentNavigation.navigateToLocation(path, {
                kind: "point", point: { lineNumber: 1, column: 1 },
              });
            }}
            pathPicker={javaProjectPathPickerAdapter}
            getWorkspaceContext={getWorkspaceContext}
            searchController={javaProjectTextSearch}
            searchFocusRequest={javaProjectTextSearchFocus}
            onSearchFocusRequestHandled={handleJavaProjectTextSearchFocusHandled}
            onProjectCreated={async (path, authority) => {
              const current = () => {
                const active = getWorkspaceContext();
                return active.workspaceId === authority.workspaceId &&
                  active.generation === authority.generation &&
                  !active.isSwitching && !active.isMetadataLoading;
              };
              if (!current())
                throw new Error("The workspace changed before the new project could be selected.");
              javaProjectTextSearch.clear();
              const settings = { ...javaProjectContext.settings, projectPath: path };
              javaProjectContext.setSettings(settings);
              await fileTreeViewModel.loadRoot(current);
              await javaProjectContext.synchronize({ ...authority, settings });
            }}
            gradleImportEnabled={gradleImportEnabled}
            onGradleImportAuthorizationChange={(enabled) =>
              setAuthorizedGradleImportScope(enabled ? gradleImportScope : null)
            }
            isWriting={javaWritesInProgress}
            onOpenTransactions={() => {
              if (!javaWritesInProgress) {
                javaRefactoring.cancel();
                void javaTransactionRecovery.refresh();
              }
            }}
            suggestedSdkHome={
              javaExecution.capabilities?.effectiveJdkHome ?? javaExecution.capabilities?.jdkHome
            }
            onNavigateLocation={(location) => {
              setJavaProjectNavigationStatus(`Opening ${location.path}:${location.line}…`);
              void refactorKitSymbolNavigation
                .selectJavaReference({
                  filePath: location.path,
                  point: { lineNumber: location.line, column: location.column ?? 1 },
                })
                .then((opened) => {
                  setJavaProjectNavigationStatus(
                    opened
                      ? null
                      : `Could not open Java source at ${location.path}:${location.line}.`,
                  );
                })
                .catch(() => {
                  setJavaProjectNavigationStatus(
                    `Could not open Java source at ${location.path}:${location.line}.`,
                  );
                });
            }}
            canRefactorType={canReviewJavaProjectType}
            onRefactorType={(operation, type) => {
              void openJavaProjectTypeRefactoring(operation, type);
            }}
            canEncapsulateField={canReviewJavaProjectField}
            onEncapsulateField={(field) => {
              void openJavaProjectFieldEncapsulation(field);
            }}
            canRefactorPackage={canReviewJavaProjectPackage}
            onRefactorPackage={openJavaProjectPackageRefactoring}
            canMoveSourceRoot={canReviewJavaSourceRootMove}
            onMoveSourceRoot={openJavaProjectSourceRootMove}
            onRevealGeneratedSourceRoot={revealGeneratedJavaSourceRoot}
          />
        ),
      } satisfies PanelLayoutActivityContribution),
    ]);
  }, [
    activeActivity,
    activeFilePath,
    workspace.currentWorkspaceId,
    workspace.generation,
    gitWorkspace,
    workspaceMetadataLoading,
    workspaceSwitching,
    workspace.isLoading,
    libraryDocument,
    javaSemantics,
    readJavaStructureDocument,
    openWorkspaceFileFromAgent,
    coverageSourcePaths,
    getWorkspaceContext,
    gradleImportEnabled,
    gradleImportScope,
    terminal.state.capabilities?.available,
    activateBottomTab,
    workspaceInfo,
    javaWorkspaceId,
    javaWorkspaceGeneration,
    xcom2ProjectActivityContributions,
    refactorKitStatus.status,
    javaWorkspaceSymbolSearchFocus,
    javaProjectTextSearchFocus,
    handleJavaProjectTextSearchFocusHandled,
    javaReferencesQueryFocus,
    javaLanguage.refreshing,
    javaLanguage.restart,
    javaLanguage.start,
    javaLanguage.status,
    javaLanguage.stop,
    javaLanguage.refresh,
    javaLanguage.searchWorkspaceSymbols,
    javaLanguage.cancelWorkspaceSymbolSearch,
    javaNavigationQueryCapabilities,
    isJavaPositionAvailable,
    isJavaLanguageServicePositionAvailable,
    queryJavaPosition,
    navigateJavaPosition,
    queryJavaReferencesAtCursor,
    activeCursorPosition,
    queryJavaPanelDefinitions,
    navigateJavaDefinition,
    javaLanguage.javaSemantics?.context,
    cancelJavaDefinitions,
    queryJavaCallHierarchyAtCursor,
    cancelJavaCallHierarchy,
    navigateJavaReference,
    openReportedJavaTestSource,
    refactorKitStatus.capabilities,
    refactorKitStatus.isChecking,
    refactorKitStatus.refresh,
    javaProjectModel,
    javaProjectContext,
    recoverSavedJavaSources,
    javaProjectTextSearch,
    beginJavaProjectWrite,
    reconcileMavenModuleRenameChanges,
    mavenModuleRenameTransaction,
    onMavenModuleRenameSourceChanged,
    canReviewJavaProjectType,
    canReviewJavaProjectField,
    canReviewJavaProjectPackage,
    openJavaProjectPackageRefactoring,
    canReviewJavaSourceRootMove,
    openJavaProjectSourceRootMove,
    revealGeneratedJavaSourceRoot,
    openJavaRefactoring,
    openJavaProjectTypeRefactoring,
    openJavaProjectFieldEncapsulation,
    javaWritesInProgress,
    javaTransactionRecovery,
    javaRefactoring,
    documentNavigation,
    refactorKitSymbolNavigation,
    javaExecution,
    sourceBreakpoints,
  ]);

  useLayoutEffect(() => {
    if (activeActivity === "xcom2-project" && xcom2ProjectActivityContributions.length === 0) {
      setActiveActivity("explorer");
    }
  }, [activeActivity, xcom2ProjectActivityContributions]);

  /** Bottom panel tabs configuration. */
  const javaDiagnosticUnavailableMessage = activeLanguage === "java" ? javaLanguage.diagnosticUnavailableMessage : undefined;
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
      id: "http-client",
      label: "HTTP Client",
      title: "Send a bounded HTTP request and inspect its response",
      scope: "core",
      isActive: shell.activeBottomTab === "http-client",
    },
    {
      id: "database",
      label: "Database",
      title: "Connect to a JDBC database, inspect schema and run SQL",
      scope: "core",
      isActive: shell.activeBottomTab === "database",
    },
    ...(shell.shouldShowProblems
      ? [
          {
            id: "problems",
            label: javaDiagnosticUnavailableMessage ? "Problems · incomplete" : "Problems",
            icon: <Icon type="circle-filled" size={10} />,
            title: javaDiagnosticUnavailableMessage ?? "Problems in the current project",
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
  const executionCommands = workspaceInfo && !workspace.isLoading
    ? javaExecutionCommands(javaExecution, openJavaExecution) : [];
  useJavaExecutionShortcuts({
    commands: executionCommands,
    enabled: Boolean(workspaceInfo && !workspace.isLoading &&
      (activeActivity === "java-execution" || activeFilePath?.endsWith(".java") || javaExecution.running)),
    openConfiguration: openJavaExecution,
  });
  const commandPaletteCommands: CommandPaletteCommand[] = [
    {
      id: "workbench.settings",
      label: "Open Settings",
      category: "Workbench",
      run: handleOpenSettings,
    },
  ];
  if (documentNavigation.canGoBack) commandPaletteCommands.push({
    id: "workbench.navigate-back", label: "Navigate Back", category: "Workbench", shortcut: "Ctrl/Cmd+Alt+Left",
    run: async () => { await documentNavigation.goBack(); },
  });
  if (documentNavigation.canGoForward) commandPaletteCommands.push({
    id: "workbench.navigate-forward", label: "Navigate Forward", category: "Workbench", shortcut: "Ctrl/Cmd+Alt+Right",
    run: async () => { await documentNavigation.goForward(); },
  });
  if (workspaceInfo) {
    commandPaletteCommands.push(
      {
        id: "git.open-source-control", label: "Open Git Source Control", category: "Git",
        run: () => { panelStore.getState().setVisibility("leftSidebar", true); setActiveActivity("git-source-control"); },
      },
      {
        id: "java.show-file-structure",
        label: "Show Java File Structure",
        category: "Java",
        run: () => { panelStore.getState().setVisibility("leftSidebar", true); setActiveActivity("java-structure"); },
      },
      {
        id: "workspace.go-to-file",
        label: "Go to File",
        category: "Workbench",
        shortcut: "Ctrl/Cmd+P",
        run: () => setWorkspaceFileQuickOpen(true),
      },
      {
        id: "workbench.search-everywhere",
        label: "Search Everywhere",
        category: "Workbench",
        description: "Search commands, files, Java symbols, and project text",
        shortcut: "Ctrl/Cmd+Shift+E",
        run: openSearchEverywhere,
      },
      {
        id: "java.intelligence.open",
        label: "Open Java Intelligence",
        category: "Java",
        run: () => {
          panelStore.getState().setVisibility("leftSidebar", true);
          setActiveActivity("java-intelligence");
        },
      },
      {
        id: "java.project-model.open",
        label: "Open Java Project Model",
        category: "Java",
        run: () => {
          panelStore.getState().setVisibility("leftSidebar", true);
          setActiveActivity("java-project-model");
        },
      },
      {
        id: "java.execution.open",
        label: "Open Java Run",
        category: "Java",
        run: openJavaExecution,
      },
      {
        id: "java.project-text-search",
        label: "Find in Java Project",
        category: "Java",
        shortcut: "Ctrl/Cmd+Shift+F",
        run: openJavaProjectTextSearch,
      },
    );
    commandPaletteCommands.push(...javaProjectContextCommands({
      ...getWorkspaceContext(),
      isWriting: javaWritesInProgress,
      controller: javaProjectContext,
    }, () => ({
      ...getWorkspaceContext(),
      isWriting: javaWritesInProgressRef.current,
      controller: javaProjectCommandControllerRef.current,
    }), () => {
      panelStore.getState().setVisibility("leftSidebar", true);
      setActiveActivity("java-project-model");
    }));
    commandPaletteCommands.push(...executionCommands);
    if (!workspace.isLoading) commandPaletteCommands.push(...workspaceTerminalCommands(terminal.controller, () => {
      panelStore.getState().setVisibility("bottomPanel", true);
      shell.activateBottomTab("terminal");
    }));
    if (javaLanguage.capabilities.workspaceSymbols) {
      commandPaletteCommands.push({
        id: "java.workspace-symbol-search",
        label: "Go to Java Symbol",
        category: "Java",
        shortcut: "Ctrl/Cmd+T",
        run: openJavaWorkspaceSymbolSearch,
      });
    }
  }
  const hasEditableJavaDocument = Boolean(
    !libraryDocument &&
    !isEditorOpening &&
    !javaWritesInProgress &&
    activeLanguage === "java" &&
    activeFilePath?.toLowerCase().endsWith(".java") &&
    readyActiveDocument,
  );
  if (hasEditableJavaDocument || javaCompilerDiagnostics.automatic) {
    commandPaletteCommands.push({
      id: "java.toggle-automatic-compiler-errors",
      label: javaCompilerDiagnostics.automatic ? "Disable Automatic Java Compiler Checks" : "Enable Automatic Java Compiler Checks",
      category: "Java",
      run: () => javaCompilerDiagnostics.setAutomaticChecks(!javaCompilerDiagnostics.automatic),
    });
  }
  if (hasEditableJavaDocument && activeFilePath && readyActiveDocument) {
    commandPaletteCommands.push({
      id: "java.check-compiler-errors",
      label: javaCompilerDiagnostics.busy ? "Cancel Java Compiler Check" : "Check Java Compiler Errors",
      category: "Java",
      run: () => { if (javaCompilerDiagnostics.busy) javaCompilerDiagnostics.cancel(); else void javaCompilerDiagnostics.check(); },
    });
    const currentDocument = { path: readyActiveDocument.path, text: readyActiveDocument.text };
    const hasPosition = Boolean(activeCursorPosition);
    const packageMoveCommand = javaPackageMoveCommandForActiveFile({
      model: javaProjectModel.model,
      activeFilePath,
      projectPath: javaProjectContext.settings.projectPath,
      canReview: canReviewJavaProjectPackage,
      onReview: openJavaProjectPackageRefactoring,
    });
    if (packageMoveCommand) commandPaletteCommands.push(packageMoveCommand);
    commandPaletteCommands.push(
      ...javaClassMoveCommandsForActiveFile({
        model: javaProjectModel.model,
        activeFilePath,
        projectPath: javaProjectContext.settings.projectPath,
        canReview: (type) => canReviewJavaProjectType("move-class", type),
        onReview: (type) => {
          void openJavaProjectTypeRefactoring("move-class", type);
        },
      }),
    );
    if (javaLanguage.status?.capabilities.definition && hasPosition) {
      commandPaletteCommands.push({
        id: "java.go-to-definition",
        label: "Go to Java Definition",
        category: "Java",
        shortcut: "Ctrl/Cmd+Alt+J",
        run: () => goToJavaDefinitionFromEditor(activeFilePath, activeCursorPosition!),
      });
    }
    if (javaLanguage.status?.capabilities.references && hasPosition) {
      commandPaletteCommands.push({
        id: "java.find-references",
        label: "Find Java References",
        category: "Java",
        shortcut: "Ctrl/Cmd+Alt+R",
        run: () => openJavaReferencesFromEditor(activeFilePath, activeCursorPosition!),
      });
    }
    for (const operation of javaFileActions?.operations ?? []) {
      if (
        operation === "extract-constant" ||
        operation === "extract-variable" ||
        operation === "extract-method" ||
        operation === "extract-parameter" ||
        operation === "extract-field" ||
        operation === "inline-variable" ||
        operation === "inline-constant" ||
        operation === "lsp-extract-parameter"
      )
        continue;
      const labels = {
        "format-file": ["Review Java Formatting", undefined],
        "organize-imports": ["Review Java Imports", "Shift+Alt+O"],
        "rename-class": ["Review Java Type Rename", "Shift+F6"],
        "rename-member": ["Review Java Member Rename", "F2"],
        "add-method-parameter": ["Review Java Add Parameter", undefined],
        "remove-method-parameter": ["Review Java Remove Parameter", undefined],
        "change-method-signature": ["Review Java Parameter Rename", undefined],
        "reorder-method-parameters": ["Review Java Parameter Order", undefined],
        "make-static": ["Review Make Method Static", undefined],
        "make-public": ["Review Make Method Public", undefined],
        "change-field-type": ["Review Java Field Type", undefined],
        "inline-method": ["Review Java Inline Method", undefined],
        "introduce-parameter-object": ["Review Java Introduce Parameter Object", undefined],
        "extract-delegate": ["Review Java Extract Delegate", undefined],
        "change-method-parameter-type": ["Review Java Parameter Type", undefined],
        "extract-interface": ["Review Java Interface Extraction", undefined],
        "extract-superclass": ["Review Java Superclass Extraction", undefined],
        "pull-up-member": ["Review Pull Up Method", undefined],
        "push-down-member": ["Review Push Down Method", undefined],
        "move-member": ["Review Move Member", undefined],
        "lsp-change-visibility": ["Review Java Visibility Change", undefined],
        "lsp-extract-parameter": ["Review Java Extract Parameter", undefined],
        "lsp-extract-superclass": ["Review Java Extract Superclass", undefined],
      } as const;
      const [label, shortcut] = labels[operation];
      const requiresCursor =
        operation === "rename-class" ||
        operation === "rename-member" ||
        operation === "add-method-parameter" ||
        operation === "remove-method-parameter" ||
        operation === "change-method-signature" ||
        operation === "change-method-parameter-type" ||
        operation === "reorder-method-parameters" ||
        operation === "make-static" ||
        (operation === "make-public" || operation === "change-field-type") ||
        operation === "inline-method" ||
        operation === "introduce-parameter-object" ||
        operation === "extract-delegate" ||
        operation === "extract-interface" ||
        operation === "extract-superclass" ||
        operation === "pull-up-member" ||
        operation === "push-down-member" ||
        operation === "move-member" ||
        operation === "lsp-change-visibility" ||
        operation === "lsp-extract-superclass";
      if (requiresCursor && !hasPosition) continue;
      commandPaletteCommands.push({
        id: `java.refactor.${operation}`,
        label,
        category: "Java · Refactor",
        ...(shortcut ? { shortcut } : {}),
        run: () => {
          const cursor = requiresCursor ? (activeCursorPosition ?? undefined) : undefined;
          if (operation === "lsp-change-visibility" || operation === "lsp-extract-superclass") {
            javaFileActions?.reviewLsp?.(operation, currentDocument, cursor);
            return;
          }
          javaFileActions?.review(operation, currentDocument, cursor);
        },
      });
    }
  }

  if (activeFilePath?.endsWith(".java") &&
      javaRefactoringAvailabilityForDialog.preview.includes("batch-cleanup")) {
    commandPaletteCommands.push({
      id: "java.refactor.batch-cleanup",
      label: "Review Java Cleanup",
      category: "Java · Refactor",
      run: () => javaRefactoring.open("batch-cleanup", {
        kind: "file", path: activeFilePath, identity: activeFilePath,
      }),
    });
  }

  // ── Render ──────────────────────────────────────────────────────────

  if (javaRefactoring.canReopenApplied) {
    commandPaletteCommands.push({
      id: "java.refactor.review-last-applied",
      label: "Review Last Applied Java Refactoring",
      category: "Java · Refactor",
      run: () => { javaRefactoring.reopenApplied(); },
    });
  }

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
            title={
              projectFoundry
                ? undefined
                : "Project Foundry is unavailable in this desktop composition"
            }
            onClick={projectFoundryController.open}
          >
            New XCOM 2 Project
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
            onClick={handleOpenSettings}
          >
            Settings
          </button>
          <button type="button" aria-label="Navigate Back" aria-keyshortcuts="Control+Alt+ArrowLeft Meta+Alt+ArrowLeft"
            title="Navigate Back (Ctrl/Cmd+Alt+Left)" disabled={!documentNavigation.canGoBack}
            className="rounded-sm px-2 py-1 disabled:opacity-40" onClick={() => void documentNavigation.goBack()}>←</button>
          <button type="button" aria-label="Navigate Forward" aria-keyshortcuts="Control+Alt+ArrowRight Meta+Alt+ArrowRight"
            title="Navigate Forward (Ctrl/Cmd+Alt+Right)" disabled={!documentNavigation.canGoForward}
            className="rounded-sm px-2 py-1 disabled:opacity-40" onClick={() => void documentNavigation.goForward()}>→</button>
          {documentNavigation.historyError ? <span role="status" className="text-xs text-[var(--text-secondary)]">{documentNavigation.historyError}</span> : null}
          <button
            aria-keyshortcuts="Control+Shift+E Meta+Shift+E"
            className="rounded-sm px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!workspaceInfo || isWorkspaceLoading || Boolean(switchingWorkspaceId)}
            onClick={openSearchEverywhere}
            title="Search commands, files, Java symbols, and project text (Ctrl/Cmd+Shift+E)"
            type="button"
          >
            Search
          </button>
          <button
            aria-keyshortcuts="Control+Shift+P Meta+Shift+P"
            className="rounded-sm px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
            onClick={() => setCommandPaletteOpen(true)}
            title="Search commands (Ctrl/Cmd+Shift+P)"
            type="button"
          >
            Commands
          </button>
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--highlight-bg)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)]"
            disabled={!!libraryDocument}
            onClick={() => {
              javaRefactoring.open("rename-class", {
                kind: "class",
                path: editorViewModel.activeFilePath?.endsWith(".java")
                  ? editorViewModel.activeFilePath
                  : "",
                identity: "",
              });
            }}
          >
            Java Refactor
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
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <PanelLayout
          layout={panelState.layout}
          statusBarRight={
            <>
              {javaProjectNavigationStatus ? (
                <span
                  className="statusbar-item"
                  role="status"
                  aria-live="polite"
                  data-testid="java-project-navigation-status"
                >
                  {javaProjectNavigationStatus}
                </span>
              ) : null}
              {activeCursorPosition ? (
                <span
                  className="statusbar-item"
                  aria-label={`Line ${activeCursorPosition.line}, column ${activeCursorPosition.column}`}
                  data-testid="editor-cursor-position"
                  data-reveal-file-path={documentNavigation.lastEditorRevealRequest?.filePath ?? ""}
                  data-reveal-line={documentNavigation.lastEditorRevealRequest?.line ?? ""}
                  data-navigation-workspace-id={workspaceInfo?.id ?? ""}
                  data-navigation-context-workspace-id={workspace.getContext().workspaceId ?? ""}
                  data-navigation-generation={workspace.generation}
                  data-navigation-context-generation={workspace.getContext().generation}
                  data-navigation-switching={String(workspace.getContext().isSwitching)}
                  data-navigation-metadata-loading={String(
                    workspace.getContext().isMetadataLoading,
                  )}
                >
                  Ln {activeCursorPosition.line}, Col {activeCursorPosition.column}
                </span>
              ) : null}
            </>
          }
          explorerActivityLabel="Files"
          activityContributions={activityContributions}
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
          onToggleLeftSidebar={shell.toggleLeftSidebar}
          onToggleBottomPanel={shell.toggleBottomPanel}
          leftSidebar={
            <LeftSidebar
              title="Files"
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
                key={JSON.stringify([workspace.currentWorkspaceId, workspace.generation])}
                nodes={fileTreeState.rootNodes}
                expandedPaths={fileTreeState.expandedPaths}
                selectedFilePath={fileTreeState.selectedFilePath}
                onSelect={desktopEditorController.selectTreeFile}
                onToggle={fileExplorer.toggleFolder}
                selectedDirectoryPath={refactorKitImport.selectedDirectoryPath}
                focusedDirectoryPath={refactorKitImport.focusedDirectoryPath}
                revealDirectoryPath={
                  directoryToReveal?.workspaceId === workspace.currentWorkspaceId &&
                  directoryToReveal.generation === workspace.generation ? directoryToReveal.path : null
                }
                onDirectoryRevealed={clearDirectoryReveal}
                onSelectDirectory={refactorKitImport.selectDirectory}
                onFocusDirectory={refactorKitImport.focusDirectory}
                onPasteJavaClass={(node) => {
                  void refactorKitImport.previewFromClipboard(node);
                }}
                onCreateFile={async (directory, name) => {
                  if (javaWritesInProgressRef.current) throw new Error("Wait for the workspace write to finish before creating files or folders.");
                  await desktopEditorController.createFile(directory.path, name);
                }}
                onCreateJavaType={async (directory, draft, sourceRoot) => {
                  if (javaWritesInProgressRef.current) throw new Error("Wait for the workspace write to finish before creating files or folders.");
                  const currentContext = javaTypeProjectContextForDirectory(
                    directory.path, javaProjectContext.settings.projectPath, javaProjectContext.context,
                  );
                  if (sourceRoot !== undefined && currentContext?.sourceRoot !== sourceRoot) {
                    throw new Error("The Java source root changed. Synchronize the project and try again.");
                  }
                  const filePath = await desktopEditorController.createFile(
                    sourceRoot ?? directory.path,
                    draft.kind === "module" ? "module-info.java" : draft.name + ".java",
                    sourceRoot !== undefined && draft.packageName ? draft.packageName.replaceAll(".", "/") : undefined,
                  );
                  const initialized = editorCommands.changeOpenDocumentContents([
                    { filePath, before: "", after: draft.source },
                  ]);
                  if (!initialized) {
                    throw new Error(
                      "The new Java type was created but its editor draft could not be initialized.",
                    );
                  }
                }}
                javaTypeProjectContextForDirectory={(directoryPath) =>
                  javaTypeProjectContextForDirectory(
                    directoryPath,
                    javaProjectContext.settings.projectPath,
                    javaProjectContext.context,
                  )
                }
                onCreateFolder={async (directory, name) => {
                  if (javaWritesInProgressRef.current) throw new Error("Wait for the workspace write to finish before creating files or folders.");
                  await desktopEditorController.createFolder(directory.path, name);
                }}
              />
            </LeftSidebar>
          }
          mainContent={
            <div className="h-full min-h-0 flex flex-col">
              {refactorKitImport.successMessage ? (
                <div
                  role="status"
                  aria-label="Java import status"
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
              <section className={`document-split-pane document-split-pane--${documentViewMode}`}>
                <header className="document-split-pane__toolbar">
                  <button
                    type="button"
                    className="document-split-pane__toggle"
                    disabled={!!libraryDocument}
                    aria-label="Toggle document view mode"
                    onClick={() => setDocumentViewMode(nextDocumentViewMode(documentViewMode))}
                  >
                    {documentViewMode === "split"
                      ? "Editor + Preview"
                      : documentViewMode === "preview-only"
                        ? "Preview"
                        : "Editor"}
                  </button>
                  <button
                    type="button"
                    className="document-split-pane__toggle"
                    disabled={
                      !!libraryDocument || !editorState.activeFilePath || diskComparison.busy
                    }
                    onClick={() => {
                      void diskComparison.compare();
                    }}
                  >
                    Compare with disk
                  </button>
                  {activeLanguage === "java" && !libraryDocument && (
                    <button
                      type="button"
                      className="document-split-pane__toggle"
                      disabled={javaLibrary.busy || !activeFilePath}
                      onClick={() => {
                        const point = activeFilePath
                          ? editorViewModel.cursorPosition(activeFilePath)
                          : null;
                        if (!activeFilePath || !workspace.currentWorkspaceId || !point) return;
                        void openDependencySource({
                          workspaceId: workspace.currentWorkspaceId,
                          generation: workspace.generation,
                          requestId: `library-toolbar-${Date.now()}`,
                          kind: "definition",
                          document: { path: activeFilePath, text: activeContent, version: 1 },
                          position: { line: point.line - 1, character: point.column - 1 },
                          includeDeclaration: true,
                          limit: 1,
                        });
                      }}
                    >
                      {javaLibrary.busy ? "Opening source…" : "Open source"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="document-split-pane__toggle"
                    onClick={() => setShowRecovery((shown) => !shown)}
                  >
                    Recovery and history
                  </button>
                  <span
                    role="status"
                    aria-label="Recovery checkpoint status"
                    title={editorRecovery.error ?? undefined}
                    className="text-xs"
                  >
                    Recovery: {editorRecovery.status}
                  </span>
                </header>
                {activeGeneratedJavaSource && (
                  <div className="border-b border-[var(--border-default)] px-3 py-2 text-xs">
                    <span role="status" aria-label="Generated Java source">
                      Generated Java source. A build may overwrite edits to this file.
                    </span>
                    {activeGeneratedJavaRoot && activeFilePath && (
                      <button type="button" className="ml-3 underline" onClick={() =>
                        void revealWorkspaceGeneratedJavaRoot(activeGeneratedJavaRoot, activeFilePath)
                      }>
                        Reveal generated root
                      </button>
                    )}
                  </div>
                )}
                <EditorBackgroundDiskChanges
                  issues={externalDisk.issues}
                  activeFilePath={libraryDocument ? null : editorState.activeFilePath}
                  onSelect={(path) => {
                    javaLibrary.showWorkspace();
                    editorCommands.activateTab(path);
                  }}
                />
                {!libraryDocument &&
                  externalDisk.issue &&
                  externalDisk.issue.filePath === editorState.activeFilePath && (
                    <p
                      role="status"
                      aria-label="External file change"
                      className="px-3 py-2 text-sm"
                    >
                      {externalDisk.issue.status === "changed"
                        ? "This file changed on disk. Your buffer was not reloaded. Compare with disk before saving."
                        : externalDisk.issue.status === "missing"
                          ? "This file is missing on disk. Your buffer is retained; saving will not silently recreate it."
                          : "Disk change detection is unavailable for this file. Your buffer is retained; saves still check its revision."}
                    </p>
                  )}
                {showRecovery && (
                  <EditorRecoveryPanel
                    key={`${workspaceInfo?.id}-${workspace.generation}`}
                    controller={editorRecovery}
                    activeFilePath={libraryDocument ? null : editorState.activeFilePath}
                    onClose={() => setShowRecovery(false)}
                  />
                )}
                {diskComparison.comparison && (
                  <EditorDiskComparisonDialog
                    comparison={diskComparison.comparison}
                    busy={diskComparison.busy}
                    onCancel={diskComparison.cancel}
                    onUseDiskVersion={() => {
                      void diskComparison.useDiskVersion();
                    }}
                  />
                )}
                {editorCommands.error && (
                  <p role="alert" className="px-2 text-sm text-red-500">
                    {editorCommands.error}
                  </p>
                )}
                {!libraryDocument && javaCompilerDiagnostics.automatic && (
                  <p role="status" aria-label="Automatic Java compiler checks" className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                    Automatic Java compiler checks enabled.
                    <button type="button" className="ml-3 underline" onClick={() => javaCompilerDiagnostics.setAutomaticChecks(false)}>Pause automatic checks</button>
                  </p>
                )}
                {!libraryDocument && javaCompilerDiagnostics.message && (
                  <p role="status" aria-label="Java compiler check" className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                    {javaCompilerDiagnostics.message}
                    {javaCompilerDiagnostics.busy && <button type="button" className="ml-3 underline" onClick={javaCompilerDiagnostics.cancel}>Cancel compiler check</button>}
                  </p>
                )}
                {!libraryDocument && javaPositionNavigation.message && (
                  <p role="status" className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                    {javaPositionNavigation.message}
                    <button
                      type="button"
                      className="ml-3 underline"
                      onClick={() => {
                        panelStore.getState().setVisibility("leftSidebar", true);
                        setActiveActivity("java-project-model");
                      }}
                    >
                      Open Java Project
                    </button>
                  </p>
                )}
                {javaLibrary.message && (
                  <p role="status" className="px-3 py-2 text-sm">
                    {javaLibrary.message}
                  </p>
                )}
                {libraryDocument && (
                  <p
                    role="status"
                    aria-label="Library source provenance"
                    className="px-3 py-2 text-sm"
                  >
                    {"resourceKind" in libraryDocument.association
                      ? `Read-only JDK ${libraryDocument.association.effectiveRelease} source · ${libraryDocument.association.platformModule}`
                      : `Read-only library source snapshot · ${libraryDocument.association.provenance.componentId}`}
                    {" · "}
                    {libraryDocument.association.sourceEntry}
                  </p>
                )}
                {javaDebugEditor.message && (
                  <p role="status" className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                    {javaDebugEditor.message}
                  </p>
                )}
                <div className="document-split-pane__body">
                  {documentViewMode !== "preview-only" ? (
                    <div className="document-split-pane__editor">
                      <Editor
                        content={libraryDocument?.content ?? activeContent}
                        language={libraryDocument ? "java" : activeLanguage}
                        workspaceEditorPreferences={workspaceEditorPreferences.preferences}
                        onChange={editorCommands.changeContent}
                        onWorkspaceDocumentChanges={editorCommands.changeOpenDocumentContents}
                        filePath={libraryDocument?.uri ?? editorFilePath}
                        modelUri={
                          !libraryDocument &&
                          activeLanguage === "java" &&
                          workspaceInfo?.rootPath &&
                          isNormalizedWorkspaceRelativePath(editorFilePath)
                            ? createWorkspaceFileUri(workspaceInfo.rootPath, editorFilePath)
                            : undefined
                        }
                        isLoading={!libraryDocument && isEditorOpening}
                        readOnly={!!libraryDocument || javaWritesInProgress}
                        tabs={[
                          ...editorState.tabs.map((tab) => ({
                            ...tab,
                            isActive: !libraryDocument && tab.isActive,
                          })),
                          ...javaLibrary.documents.map((document) => ({
                            filePath: document.uri,
                            isDirty: false,
                            isActive: document.uri === libraryDocument?.uri,
                          })),
                        ]}
                        tabLabels={Object.fromEntries(
                          javaLibrary.documents.map((document) => [
                            document.uri,
                            `${document.title} (read-only)`,
                          ]),
                        )}
                        onTabActivate={(path) => {
                          if (javaLibrary.documents.some((document) => document.uri === path))
                            javaLibrary.select(path, libraryCursorPositions.current.get(path));
                          else {
                            javaLibrary.showWorkspace();
                            editorCommands.activateTab(path);
                          }
                        }}
                        onTabClose={(path) => {
                          if (javaLibrary.documents.some((document) => document.uri === path))
                            javaLibrary.close(path);
                          else void editorCommands.closeTab(path);
                        }}
                        revealRequest={
                          libraryDocument
                            ? javaLibrary.revealRequest
                            : documentNavigation.editorRevealRequest
                        }
                        onRevealHandled={
                          libraryDocument ? undefined : documentNavigation.onRevealHandled
                        }
                        diagnostics={libraryDocument ? [] : activeDiagnostics}
                        documentIdentity={libraryDocument ? undefined : activeDiagnosticDocument}
                        diagnosticOwner={libraryDocument ? undefined : activeDiagnosticOwner}
                        javaSemantics={libraryDocument ? undefined : javaSemantics}
                        javaTemplateProjectContext={
                          !libraryDocument && activeLanguage === "java"
                            ? (javaProjectContext.context ?? undefined)
                            : undefined
                        }
                        javaTemplateProjectPath={
                          !libraryDocument && activeLanguage === "java"
                            ? javaProjectContext.settings.projectPath
                            : undefined
                        }
                        javaFileActions={
                          !libraryDocument && activeLanguage === "java"
                            ? javaFileActions
                            : undefined
                        }
                        onFindJavaReferences={
                          !libraryDocument && activeLanguage === "java"
                            ? openJavaReferencesFromEditor
                            : undefined
                        }
                        onGoToJavaDefinition={
                          !libraryDocument &&
                          activeLanguage === "java" &&
                          javaLanguage.status?.capabilities.definition
                            ? goToJavaDefinitionFromEditor
                            : undefined
                        }
                        onNavigateJavaDefinition={
                          !libraryDocument &&
                          activeLanguage === "java" &&
                          javaLanguage.status?.capabilities.definition
                            ? navigateJavaReference
                            : undefined
                        }
                        onCursorPositionChange={(path, position) => {
                          if (!libraryDocument)
                            editorViewModel.updateCursorPosition(path, position);
                          else if (path === libraryDocument.uri)
                            libraryCursorPositions.current.set(path, { lineNumber: position.line, column: position.column });
                        }}
                        javaNavigation={
                          !libraryDocument && activeLanguage === "java" && javaEditorNavigation
                            ? {
                                ...javaEditorNavigation,
                                typeDefinitionAvailable: javaNavigationQueryCapabilities.typeDefinition,
                              }
                            : undefined
                        }
                        javaDebugger={
                          !libraryDocument && activeLanguage === "java"
                            ? javaDebugEditor.debugging
                            : undefined
                        }
                        javaLaunch={
                          !libraryDocument && activeLanguage === "java" && workspaceInfo && !workspace.isLoading
                            ? {
                                context: {workspaceId: workspaceInfo.id, generation: workspace.generation},
                                available: javaExecution.entryPoints.sourceAvailable,
                                run: async (document, isCurrent, operation = "run") => {
                                  const context=workspace.getContext(), state=editorStore.getState();
                                  if (!isCurrent() || context.isSwitching || context.workspaceId!==workspaceInfo.id || context.generation!==workspace.generation ||
                                      state.activeFilePath!==document.path || state.contents[document.path]!==document.text) return;
                                  openJavaExecution();
                                  await javaExecution.entryPoints.discover({path:document.path,isCurrent,operation, ...(document.position ? {position:document.position} : {})});
                                },
                              }
                            : undefined
                        }
                        javaCoverage={activeJavaCoverage}
                        onCreateNewFile={fileExplorer.createFile}
                        createFileTargetLabel={
                          refactorKitImport.selectedDirectoryPath ?? "Workspace root"
                        }
                      />
                    </div>
                  ) : null}
                  {documentViewMode !== "editor-only" &&
                  documentNavigation.preview.isVisible &&
                  documentNavigation.preview.filePath ? (
                    <div className="document-split-pane__preview">
                      <DocumentPreviewPanel
                        content={activeContent}
                        kind={documentNavigation.preview.kind}
                        filePath={documentNavigation.preview.filePath}
                        onClose={documentNavigation.closeDisplayedPreview}
                      />
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          }
          bottomContent={
            <BottomPanel tabs={bottomTabs} onTabActivate={shell.activateBottomTab}>
              {shell.activeBottomTab === "terminal" ? (
                <WorkspaceTerminalPanel
                  controller={terminal.controller}
                  state={terminal.state}
                  directoryRequest={
                    terminalDirectoryRequest?.workspaceId === workspace.currentWorkspaceId &&
                    terminalDirectoryRequest.generation === workspace.generation
                      ? terminalDirectoryRequest
                      : undefined
                  }
                />
              ) : shell.activeBottomTab === "http-client" ? (
                <HttpClientFeature
                  port={httpClientAdapter}
                  activeDocument={!libraryDocument && activeFilePath && /\.(http|rest)$/iu.test(activeFilePath)
                    ? { path: activeFilePath, text: activeContent } : null}
                  getActiveDocument={() => {
                    const current = editorStore.getState();
                    const path = current.activeFilePath;
                    return path && /\.(http|rest)$/iu.test(path)
                      ? { path, text: current.contents[path] ?? "" } : null;
                  }}
                  workspaceId={javaWorkspaceId}
                  generation={javaWorkspaceGeneration}
                />
              ) : shell.activeBottomTab !== "database" ? (
                <ProblemsPanel
                  items={problemItems}
                  notice={javaDiagnosticUnavailableMessage}
                  emptyMessage={activeLanguage === "java" && javaCompilerDiagnostics.message && !javaCompilerDiagnostics.result
                    ? javaCompilerDiagnostics.message : "No problems detected in this project."}
                  onNavigateProblem={(item) => {
                    if (item.provider === "RefactorKit Java compiler") {
                      if (item.id) void javaCompilerDiagnostics.openProblem(item.id);
                    } else documentNavigation.navigateToProblem(item.filePath, item.range);
                  }}
                />
              ) : null}
              <div className={shell.activeBottomTab === "database" ? "contents" : "hidden"}>
                <JavaDatabaseFeature
                  port={javaDatabaseAdapter}
                  workspaceId={javaWorkspaceId}
                  generation={javaWorkspaceGeneration}
                  jdkHome={javaProjectContext.settings.sdkHome}
                  workspaceSwitching={workspaceSwitching}
                  onTransitionBlockReason={onDatabaseTransitionBlockReason}
                />
              </div>
            </BottomPanel>
          }
        />
      </div>
      <CommandPalette
        commands={commandPaletteCommands}
        onClose={() => setCommandPaletteOpen(false)}
        onOpen={() => setCommandPaletteOpen(true)}
        open={commandPaletteOpen}
      />
      <WorkspaceFileQuickOpenDialog
        enabled={Boolean(workspaceInfo && !isWorkspaceLoading && !switchingWorkspaceId)}
        onClose={() => setWorkspaceFileQuickOpen(false)}
        onOpen={() => setWorkspaceFileQuickOpen(true)}
        onOpenFile={openWorkspaceQuickOpenFile}
        open={workspaceFileQuickOpen}
        search={searchWorkspaceFiles}
        workspaceGeneration={workspace.generation}
      />
      <SearchEverywhereDialog
        commands={commandPaletteCommands}
        enabled={Boolean(workspaceInfo && !isWorkspaceLoading && !switchingWorkspaceId)}
        javaSymbolSearchAvailable={Boolean(javaLanguage.capabilities.workspaceSymbols)}
        onClose={() => setSearchEverywhereOpen(false)}
        onNavigate={navigateSearchEverywhereResult}
        onOpen={openSearchEverywhere}
        onOpenFile={openWorkspaceQuickOpenFile}
        open={searchEverywhereOpen}
        searchFiles={searchWorkspaceFiles}
        searchJavaSymbols={searchJavaWorkspaceSymbols}
        searchProjectText={searchProjectTextEverywhere}
        workspaceGeneration={workspace.generation}
      />
      {projectFoundryController.isOpen ? (
        <Xcom2ProjectFoundryDialog
          sourceRepository={projectFoundryController.sourceRepository}
          destinationParent={projectFoundryController.destinationParent}
          modId={projectFoundryController.modId}
          finalProjectLocation={projectFoundryController.finalProjectLocation}
          viewState={projectFoundryController.viewState}
          creationState={projectFoundryController.creationState}
          onSelectSourceRepository={projectFoundryController.selectSourceRepository}
          onSelectDestinationParent={projectFoundryController.selectDestinationParent}
          onModIdChange={projectFoundryController.setModId}
          onPreview={projectFoundryController.preview}
          onCreateProject={projectFoundryController.apply}
          onCancel={projectFoundryController.cancel}
        />
      ) : null}
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
      {javaRefactoring.dialog ? (
        <JavaRefactoringPreviewDialog
          dialog={javaRefactoring.dialog}
          capabilities={refactorKitStatus.capabilities}
          projectContext={javaProjectContext.context}
          projectPath={javaProjectContext.settings.projectPath}
          searchJavaTypes={javaLanguage.searchWorkspaceSymbols}
          searchCleanupFiles={searchWorkspaceFiles}
          workspaceGeneration={workspace.generation}
          availableOperations={javaRefactoringAvailabilityForDialog.preview}
          applicableOperations={javaRefactoringAvailabilityForDialog.apply}
          applyAuthorityAvailable={Boolean(
            javaRefactoring.dialog.plan?.editorPreview
              ? javaRefactoring.dialog.plan.editorPreview.mutationMode === "durable-editor-owned" &&
                  javaEditorMutationOffered(
                    refactorKitStatus.capabilities,
                    javaRefactoring.dialog.operation,
                  )
              : javaRefactoring.dialog.selection?.projectContext
                ? javaContextRefactoringOffered(
                    refactorKitStatus.capabilities,
                    javaRefactoring.dialog.operation,
                    "apply",
                  )
                : refactorKitStatus.capabilities?.generalRefactoring?.supported &&
                  refactorKitStatus.capabilities.generalRefactoring.apply &&
                  refactorKitStatus.capabilities.generalRefactoring.operations.includes(
                    javaRefactoring.dialog.operation,
                  ) &&
                  javaRefactoringMutationAuthorized(
                    refactorKitStatus.capabilities,
                    javaRefactoring.dialog.operation,
                  ),
          )}
          rollbackAdvertised={Boolean(
            javaRefactoring.dialog.selection?.projectContext
              ? javaContextRefactoringOffered(
                  refactorKitStatus.capabilities,
                  javaRefactoring.dialog.operation,
                  "rollback",
                ) && javaRefactoring.dialog.result?.appliedSnapshotHash
              : refactorKitStatus.capabilities?.generalRefactoring?.rollback,
          )}
          onSetOperation={javaRefactoring.setOperation}
          onSetTarget={javaRefactoring.setTarget}
          onSetChangeIntent={javaRefactoring.setChangeIntent}
          onPreview={() => {
            void javaRefactoring.preview();
          }}
          onOpenReference={(plan, location) => {
            void javaRefactoring.openPreviewReference(plan, location, (reference, isCurrent) =>
              navigateJavaReference(reference, isCurrent, true),
            );
          }}
          onApply={(plan) => {
            void javaRefactoring.applyDisplayedPlan(plan);
          }}
          onRollback={(result) => {
            void javaRefactoring.rollback(result);
          }}
          onUndoEditor={() => {
            void javaRefactoring.undoEditorTransaction();
          }}
          onRecoverEditor={() => {
            void javaRefactoring.recoverEditorTransaction();
          }}
          onDiscard={javaRefactoring.discardDisplayedPlan}
          onCancel={javaRefactoring.cancel}
        />
      ) : null}
      {javaLspIntent ? (
        <JavaLspRefactoringDialog
          intent={javaLspIntent}
          authority={{
            workspaceId: workspace.currentWorkspaceId ?? javaFileActions?.context.workspaceId ?? "",
            generation: workspace.generation,
            projectPath: javaProjectContext.settings.projectPath,
            sdkHome: javaProjectContext.settings.sdkHome,
          }}
          port={javaLspRefactoringAdapter}
          editor={editorViewModel}
          getContext={() => ({
            ...workspace.getContext(),
            projectPath: javaProjectPathRef.current,
          })}
          onCancel={() => setJavaLspIntent(null)}
          onApplied={() => setJavaLspIntent(null)}
        />
      ) : null}
      {javaTransactionRecovery.state && (
        <JavaTransactionRecoveryDialog
          state={javaTransactionRecovery.state}
          onRefresh={() => {
            void javaTransactionRecovery.refresh();
          }}
          onReview={(entry) => {
            void javaTransactionRecovery.review(entry);
          }}
          onRestore={() => {
            void javaTransactionRecovery.restore();
          }}
          onClose={javaTransactionRecovery.close}
        />
      )}
      <SettingsPanel
        isOpen={settings.isOpen}
        aiAgentSettings={aiAgentSettings}
        aiAgentStatus={aiAgentStatus}
        workspaceInfo={workspaceInfo}
        workspaceEditorPreferences={workspaceEditorPreferences.preferences}
        workspaceEditorPreferencesError={workspaceEditorPreferences.error}
        workspaceRegistry={workspaceRegistry}
        workspaceError={workspaceError}
        xcom2ModuleConfigurationDiagnosticPresentation={
          xcom2ModuleConfigurationDiagnosticPresentation
        }
        isXcom2ModuleConfigurationChecking={xcom2ModuleActivation.isScanning}
        javaLanguageServiceStatus={displayedLanguageServiceStatus}
        isJavaLanguageServiceRefreshing={javaLanguage.refreshing}
        javaLanguageServerRuntimeJdkHome={javaLanguageServerRuntimePreference.serverJdkHome}
        javaLanguageServerRuntimePreferenceError={javaLanguageServerRuntimePreference.error}
        javaRefactorKitStatus={refactorKitStatus.status}
        javaRefactorKitCapabilities={refactorKitStatus.capabilities}
        isJavaRefactorKitChecking={refactorKitStatus.isChecking}
        javaRefactorKitError={refactorKitStatus.error}
        languageToolingDiagnostics={refactorKitDiagnostics.presentation}
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
        onRefreshWorkspace={handleRefreshWorkspace}
        onSaveJavaLanguageServerRuntimeJdkHome={javaLanguageServerRuntimePreference.save}
        onChangeWorkspaceEditorPreferences={workspaceEditorPreferences.save}
        onSelectWorkspaceFormatterProfile={() =>
          workspaceInfo
            ? javaProjectPathPickerAdapter.selectWorkspaceXmlFile(workspaceInfo.rootPath)
            : Promise.resolve(null)
        }
        onListWorkspaceFormatterProfiles={async (path) => {
          const started = workspace.getContext();
          if (!started.workspaceId || started.isSwitching || started.isMetadataLoading)
            throw new Error("Select a workspace before reading formatter profiles.");
          const names = await javaProjectPathPickerAdapter.listFormatterProfiles(started.workspaceId, path);
          const current = workspace.getContext();
          if (current.workspaceId !== started.workspaceId || current.generation !== started.generation || current.isSwitching)
            throw new Error("The workspace changed while reading formatter profiles.");
          return names;
        }}
        onOpenWorkspaceFormatterProfile={async (path) => {
          const startedWorkspace = workspace.getContext();
          const configuredProfile = workspaceEditorPreferences.preferences.javaFormatterProfile;
          if (
            !workspaceInfo ||
            !configuredProfile ||
            configuredProfile.path !== path ||
            startedWorkspace.workspaceId !== workspaceInfo.id ||
            startedWorkspace.isSwitching ||
            startedWorkspace.isMetadataLoading
          )
            throw new Error(
              "The selected Java formatter profile is not available in the active workspace.",
            );
          const name = path.split("/").pop() ?? path;
          await desktopEditorController.openFileProgrammatically(
            { id: path, path, name, type: "file" },
            true,
          );
          const currentWorkspace = workspace.getContext();
          if (
            currentWorkspace.workspaceId !== startedWorkspace.workspaceId ||
            currentWorkspace.generation !== startedWorkspace.generation
          )
            throw new Error("The workspace changed while the Java formatter profile was opening.");
        }}
        onSwitchWorkspace={handleSwitchWorkspace}
        onStartJavaLanguageService={javaLanguage.start}
        onStopJavaLanguageService={javaLanguage.stop}
        onRestartJavaLanguageService={javaLanguage.restart}
        onRefreshJavaLanguageService={javaLanguage.refresh}
        onRefreshJavaRefactorKit={refactorKitStatus.refresh}
        onRequestLanguageToolingDiagnostics={refactorKitDiagnostics.request}
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
