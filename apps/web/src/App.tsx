// ---------------------------------------------------------------------------
// apps/web/src/App.tsx
// Root component for the IDE webapp. Creates store instances, view models,
// and browser adapters; wires them together; renders PanelLayout with
// FileTree, Editor, and Terminal.
// ---------------------------------------------------------------------------

import { useEffect, useCallback, useRef } from "react";
import type { FileNode } from "@ide/contracts";
import type { BottomPanelTab } from "@ide/ui";

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
// Browser-safe adapter implementations (no Tauri dependency).
import { createBrowserAdapters } from "@ide/browser-adapters";

// ── UI Components ────────────────────────────────────────────────────────
import { PanelLayout } from "@ide/ui";
import { LeftSidebar } from "@ide/ui";
import { BottomPanel } from "@ide/ui";
import { FileTree } from "@ide/ui";
import { Editor } from "@ide/ui";
import { Terminal } from "@ide/ui";
import { Icon } from "@ide/ui";

// ── Store hooks ──────────────────────────────────────────────────────────
// Zustand stores are created once and exposed as singletons for the app.
// Components subscribe via the generated hook selectors below.

// Create singleton stores (called once at module scope).
const fileTreeStore = createFileTreeStore();
const editorStore = createEditorStore();
const terminalStore = createTerminalStore();
const panelStore = createPanelStore();

// Create singleton adapters.
const { fileTreeAdapter, editorAdapter, terminalAdapter } = createBrowserAdapters();

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
  const isLoading = editorStore((s) => s.isLoading);

  return { activeFilePath, tabs, contents, isLoading };
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
  const lastUserSelectedFilePathRef = useRef<string | null>(null);

  // ── Lifecycle: load initial data ─────────────────────────────────────

  useEffect(() => {
    // Load file tree root nodes on mount.
    fileTreeViewModel.loadRoot().catch((err) => {
      console.error("[App] Failed to load file tree root:", err);
    });

    // Restore previously open editor files. If a user clicks a file while the
    // async restore is still in flight, reconcile afterwards so restore cannot
    // clobber the user's selection back to the welcome screen.
    editorViewModel
      .restoreSession()
      .catch((err) => {
        console.error("[App] Failed to restore editor session:", err);
      })
      .then(async () => {
        const selectedFilePath = lastUserSelectedFilePathRef.current;
        if (selectedFilePath && editorStore.getState().activeFilePath !== selectedFilePath) {
          await editorViewModel.openFile(selectedFilePath);
        }
      })
      .catch((err) => {
        console.error("[App] Failed to reopen selected file after restore:", err);
      });

    // Connect terminal adapter (subscribe to output/exit events).
    terminalViewModel.connect();

    // Start a simulated shell session.
    terminalStore.getState().setSessionActive(false);
    terminalStore.getState().setLoading(false);
    terminalAdapter.startSession();

    // Subscribe to external file-selection events.
    const unsubscribe = fileTreeViewModel.subscribeToFileSelection();

    return () => {
      terminalViewModel.disconnect();
      terminalAdapter.stopSession();
      terminalStore.getState().setSessionActive(false);
      unsubscribe();
    };
  }, []);

  // ── Callbacks ─────────────────────────────────────────────────────────

  /** Handle file tree node selection. */
  const handleFileSelect = useCallback(async (node: FileNode) => {
    if (node.type === "file") {
      lastUserSelectedFilePathRef.current = node.path;
      fileTreeViewModel.selectFile(node.path);
      await editorViewModel.openFile(node.path);
    }
  }, []);

  /** Create a file at the workspace root, then open the exact path returned by the view model. */
  const handleCreateFileFromEmptyEditor = useCallback(
    async (name: string): Promise<void> => {
      const createdPath = await fileTreeViewModel.createFile("", name);
      await handleFileSelect({
        id: createdPath,
        name: createdPath.split("/").pop() ?? createdPath,
        path: createdPath,
        type: "file",
      });
    },
    [handleFileSelect],
  );

  /** Handle file tree folder toggle. */
  const handleFolderToggle = useCallback(async (node: FileNode) => {
    if (node.type === "folder") {
      await fileTreeViewModel.toggleFolder(node.path);
    }
  }, []);

  /** Handle editor content change. */
  const handleEditorChange = useCallback(
    (value: string) => {
      const path = editorState.activeFilePath;
      if (path) {
        editorViewModel.updateContent(path, value);
      }
    },
    [editorState.activeFilePath],
  );

  /** Save the active file when it has unsaved changes. */
  const handleSaveActiveFile = useCallback(async () => {
    const state = editorStore.getState();
    const filePath = state.activeFilePath;
    if (!filePath) return;

    const tab = state.tabs.find((candidate) => candidate.filePath === filePath);
    if (!tab?.isDirty) return;

    try {
      await editorViewModel.saveFile(filePath);
    } catch (err) {
      console.error("[App] Failed to save active file:", err);
    }
  }, []);

  /** Save dirty content before closing a tab, keeping it open on save failure. */
  const handleTabClose = useCallback(async (filePath: string) => {
    const tab = editorStore.getState().tabs.find((candidate) => candidate.filePath === filePath);

    try {
      if (tab?.isDirty) {
        await editorViewModel.saveFile(filePath);
      }
      await editorViewModel.closeFile(filePath);
    } catch (err) {
      console.error(`[App] Failed to close ${filePath}:`, err);
    }
  }, []);

  /** Handle terminal command submission. */
  const handleTerminalCommand = useCallback(async (command: string) => {
    try {
      await terminalViewModel.executeCommand(command);
    } catch (err) {
      console.error("[App] Failed to execute terminal command:", err);
    } finally {
      terminalViewModel.updateCurrentInput("");
    }
  }, []);

  /** Handle terminal input change (as the user types). */
  const handleTerminalInputChange = useCallback((value: string) => {
    terminalViewModel.updateCurrentInput(value);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveActiveFile();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSaveActiveFile]);

  /** Handle panel resize for left sidebar. */
  const handleResizeLeft = useCallback((width: number) => {
    panelStore.getState().setLeftSidebarWidth(width);
  }, []);

  /** Handle panel resize for bottom panel. */
  const handleResizeBottom = useCallback((height: number) => {
    panelStore.getState().setBottomPanelHeight(height);
  }, []);

  /** Handle panel toggle for left sidebar. */
  const handleToggleLeftSidebar = useCallback(() => {
    panelStore.getState().toggleVisibility("leftSidebar");
  }, []);

  /** Keep the core Terminal contribution selected when its tab is activated. */
  const handleTabActivate = useCallback((tabId: string) => {
    if (tabId === "terminal") {
      panelStore.getState().setActivePanel("bottomPanel");
    }
  }, []);

  // ── Derived values ──────────────────────────────────────────────────

  /** Determine the active file content and language for the editor. */
  const activeFilePath = editorState.activeFilePath;
  const activeContent = activeFilePath ? (editorState.contents[activeFilePath] ?? "") : "";
  const activeLanguage = activeFilePath
    ? (editorViewModel.openFiles.find((f) => f.filePath === activeFilePath)?.language ??
      "plaintext")
    : "plaintext";

  /** Bottom panel tabs configuration. */
  const bottomTabs: BottomPanelTab[] = [
    {
      id: "terminal",
      label: "Terminal",
      icon: <Icon type="terminal" size={14} />,
      title: "Integrated terminal",
      scope: "core",
      isActive: true,
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="h-full w-full dark" style={{ background: "var(--surface-background)" }}>
      <PanelLayout
        layout={panelState.layout}
        onResizeLeft={handleResizeLeft}
        onResizeBottom={handleResizeBottom}
        leftSidebar={
          <LeftSidebar
            title="Explorer"
            isVisible={panelState.layout.visibility.leftSidebar.visible}
            onToggle={handleToggleLeftSidebar}
          >
            <FileTree
              nodes={fileTreeState.rootNodes}
              expandedPaths={fileTreeState.expandedPaths}
              selectedFilePath={fileTreeState.selectedFilePath}
              onSelect={handleFileSelect}
              onToggle={handleFolderToggle}
            />
          </LeftSidebar>
        }
        mainContent={
          <Editor
            content={activeContent}
            language={activeLanguage}
            onChange={handleEditorChange}
            filePath={activeFilePath ?? ""}
            isLoading={editorState.isLoading}
            tabs={editorState.tabs}
            onTabActivate={(fp) => editorViewModel.switchActiveFile(fp)}
            onTabClose={handleTabClose}
            onCreateNewFile={handleCreateFileFromEmptyEditor}
            createFileTargetLabel="Workspace root"
          />
        }
        bottomContent={
          <BottomPanel tabs={bottomTabs} onTabActivate={handleTabActivate}>
            <Terminal
              output={terminalState.output}
              onCommand={handleTerminalCommand}
              isSessionActive={terminalState.isSessionActive}
              currentInput={terminalState.currentInput}
              onInputChange={handleTerminalInputChange}
              isLoading={terminalState.isLoading}
              cols={terminalState.cols}
              rows={terminalState.rows}
              commandHistory={terminalState.commandHistory}
              onClear={() => terminalViewModel.clearOutput()}
            />
          </BottomPanel>
        }
      />
    </div>
  );
}
