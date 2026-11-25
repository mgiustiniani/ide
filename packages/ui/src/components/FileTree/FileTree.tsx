// ---------------------------------------------------------------------------
// @ide/ui – FileTree
// Main file‑tree component: renders recursive folder/file list from
// FileNode[] props, handles expand/collapse, file selection callback.
// ---------------------------------------------------------------------------

import type { FileNode } from "@ide/contracts";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createJavaTypeDraft, type JavaTypeKind } from "./javaTypeSource";
import { FileTreeFolder } from "./FileTreeFolder";
import { FileTreeItem } from "./FileTreeItem";

export interface FileTreeProps {
  /** Root‑level nodes to display. */
  nodes: FileNode[];
  /** Currently expanded folder paths. */
  expandedPaths: Set<string>;
  /** Currently selected file path. */
  selectedFilePath: string | null;
  /** Called when the user selects a file node. */
  onSelect: (node: FileNode) => void;
  /** Called when a folder is toggled open/closed. */
  onToggle: (node: FileNode) => void;
  /** Controlled path of the selected directory. */
  selectedDirectoryPath?: string | null;
  /** Controlled path of the directory that owns keyboard focus. */
  focusedDirectoryPath?: string | null;
  /** One-shot directory navigation after its ancestors have been expanded. */
  revealDirectoryPath?: string | null;
  onDirectoryRevealed?(path: string): void;
  /** Called in addition to onToggle when a directory row is selected. */
  onSelectDirectory?: (node: FileNode) => void;
  /** Called when a directory row receives focus. */
  onFocusDirectory?: (node: FileNode) => void;
  /** Requests the host workflow for a selected directory; the UI never reads the clipboard. */
  onPasteJavaClass?: (directoryNode: FileNode) => void;
  /** Creates and opens a new file beneath the selected directory. */
  onCreateFile?: (directoryNode: FileNode, name: string) => void | Promise<void>;
  /** Creates a new directory beneath the selected directory. */
  onCreateFolder?: (directoryNode: FileNode, name: string) => void | Promise<void>;
  /** Opens Java type, compact source or module descriptor content as an unsaved draft. */
  onCreateJavaType?: (
    directoryNode: FileNode,
    draft: ReturnType<typeof createJavaTypeDraft>,
    sourceRoot?: string,
  ) => void | Promise<void>;
  /** Provider-backed source context for the selected directory, or null when ambiguous. */
  javaTypeProjectContextForDirectory?: (directoryPath: string) => JavaTypeProjectContext | null;
}

export interface JavaTypeProjectContext {
  effectiveSourceLevel: number;
  packageName: string | null;
  isSourceRoot: boolean;
  /** Unique provider-declared ordinary source root, relative to the workspace. */
  sourceRoot?: string;
  /** Present when provider facts identify a generated source directory. */
  isGeneratedSource?: boolean;
  /** One provider-qualified named module, null if not declared, or absent if unknown. */
  moduleName?: string | null;
}

interface DirectoryMenuState {
  node: FileNode;
  x: number;
  y: number;
  returnFocus: HTMLElement;
}

interface CreateEntryDialogState {
  kind: "file" | "folder" | "java-type";
  node: FileNode;
  returnFocus: HTMLElement;
}

function findDirectory(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.type === "folder" && node.path === path) return node;
    const nested = node.children ? findDirectory(node.children, path) : null;
    if (nested) return nested;
  }
  return null;
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function FileTree({
  nodes,
  expandedPaths,
  selectedFilePath,
  onSelect,
  onToggle,
  selectedDirectoryPath = null,
  focusedDirectoryPath = null,
  revealDirectoryPath = null,
  onDirectoryRevealed,
  onSelectDirectory,
  onFocusDirectory,
  onPasteJavaClass,
  onCreateFile,
  onCreateFolder,
  onCreateJavaType,
  javaTypeProjectContextForDirectory,
}: FileTreeProps): JSX.Element {
  const [menu, setMenu] = useState<DirectoryMenuState | null>(null);
  const [createEntryDialog, setCreateEntryDialog] = useState<CreateEntryDialogState | null>(null);
  const [createEntryName, setCreateEntryName] = useState("");
  const [createJavaPackage, setCreateJavaPackage] = useState("");
  const [createJavaTypeKind, setCreateJavaTypeKind] = useState<JavaTypeKind>("class");
  const [createEntryError, setCreateEntryError] = useState<string | null>(null);
  const [creatingEntry, setCreatingEntry] = useState(false);
  const compactSource = createJavaTypeKind === "compact-source";
  const menuItemRef = useRef<HTMLButtonElement>(null);
  const createEntryInputRef = useRef<HTMLInputElement>(null);
  const restoreCreateDialogFocusRef = useRef<HTMLElement | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!revealDirectoryPath) return;
    const row = treeRef.current?.querySelector<HTMLElement>(
      `[role="treeitem"][data-path="${CSS.escape(revealDirectoryPath)}"]`,
    );
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
    onDirectoryRevealed?.(revealDirectoryPath);
  }, [revealDirectoryPath, onDirectoryRevealed]);
  const selectedDirectory = useMemo(
    () => (selectedDirectoryPath ? findDirectory(nodes, selectedDirectoryPath) : null),
    [nodes, selectedDirectoryPath],
  );
  const selectedJavaTypeProjectContext =
    createEntryDialog?.kind === "java-type"
      ? (javaTypeProjectContextForDirectory?.(createEntryDialog.node.path) ?? null)
      : null;
  const javaSourceDestination = createEntryDialog?.kind === "java-type"
    ? [
        selectedJavaTypeProjectContext?.sourceRoot ?? createEntryDialog.node.path,
        selectedJavaTypeProjectContext?.sourceRoot !== undefined && !compactSource && createJavaTypeKind !== "module"
          ? createJavaPackage.trim().replaceAll(".", "/") : "",
        createJavaTypeKind === "module" ? "module-info.java"
          : `${createEntryName.trim() || (compactSource ? "SourceName" : "TypeName")}.java`,
      ].filter((part) => part !== "").join("/")
    : null;
  const menuJavaTypeProjectContext = menu
    ? (javaTypeProjectContextForDirectory?.(menu.node.path) ?? null)
    : null;

  useEffect(() => {
    if (menu) menuItemRef.current?.focus();
  }, [menu]);

  useEffect(() => {
    if (createEntryDialog) createEntryInputRef.current?.focus();
    else {
      restoreCreateDialogFocusRef.current?.focus();
      restoreCreateDialogFocusRef.current = null;
    }
  }, [createEntryDialog]);

  const dismissCreateEntryDialog = () => {
    restoreCreateDialogFocusRef.current = createEntryDialog?.returnFocus ?? null;
    setCreateEntryDialog(null);
  };

  const submitCreateEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createEntryDialog || creatingEntry) return;
    if (
      (createEntryDialog.kind === "file" && !onCreateFile) ||
      (createEntryDialog.kind === "folder" && !onCreateFolder) ||
      (createEntryDialog.kind === "java-type" && !onCreateJavaType)
    )
      return;
    const name = createEntryName.trim();
    if (!name || name === "." || name === ".." || /[\\/]/u.test(name)) {
      setCreateEntryError("Enter one name without a directory path.");
      return;
    }
    setCreatingEntry(true);
    setCreateEntryError(null);
    try {
      if (createEntryDialog.kind === "java-type") {
        const projectContext =
          javaTypeProjectContextForDirectory?.(createEntryDialog.node.path) ?? null;
        const draft = createJavaTypeDraft(
          name,
          createJavaTypeKind === "compact-source" ? "" : createJavaPackage,
          createJavaTypeKind,
          projectContext?.effectiveSourceLevel,
          projectContext?.moduleName,
        );
        if (draft.kind === "module") {
          if (projectContext?.isSourceRoot !== true) {
            setCreateEntryError(
              "Create a Java module descriptor directly in one declared ordinary source root.",
            );
            return;
          }
          if (projectContext.effectiveSourceLevel < 9) {
            setCreateEntryError(
              `The selected source set uses Java ${projectContext.effectiveSourceLevel}; module descriptors require Java 9 or later.`,
            );
            return;
          }
        }
        if (
          draft.kind === "record" &&
          projectContext !== null &&
          projectContext.effectiveSourceLevel < 16
        ) {
          setCreateEntryError(
            `The selected source set uses Java ${projectContext.effectiveSourceLevel}; records require Java 16 or later.`,
          );
          return;
        }
        if (projectContext?.sourceRoot !== undefined) {
          await onCreateJavaType?.(createEntryDialog.node, draft, projectContext.sourceRoot);
        } else {
          await onCreateJavaType?.(createEntryDialog.node, draft);
        }
      } else if (createEntryDialog.kind === "file") {
        await onCreateFile?.(createEntryDialog.node, name);
      } else {
        await onCreateFolder?.(createEntryDialog.node, name);
      }
      restoreCreateDialogFocusRef.current = createEntryDialog.returnFocus;
      setCreateEntryDialog(null);
    } catch (error) {
      setCreateEntryError(
        error instanceof Error ? error.message : `Could not create the ${createEntryDialog.kind}.`,
      );
    } finally {
      setCreatingEntry(false);
    }
  };

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-[var(--text-muted)]">
        No files yet
      </div>
    );
  }

  return (
    <div
      ref={treeRef}
      className="relative select-none overflow-y-auto h-full"
      role="tree"
      aria-label="File Explorer"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "v" &&
          selectedDirectory &&
          onPasteJavaClass &&
          !isEditablePasteTarget(event.target)
        ) {
          event.preventDefault();
          onPasteJavaClass(selectedDirectory);
        }
      }}
      onPointerDownCapture={(event) => {
        if (
          menu &&
          !(event.target instanceof Node && event.target.parentElement?.closest('[role="menu"]'))
        ) {
          setMenu(null);
        }
      }}
    >
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FileTreeFolder
            key={node.id}
            node={node}
            depth={0}
            isOpen={expandedPaths.has(node.path)}
            expandedPaths={expandedPaths}
            selectedFilePath={selectedFilePath}
            onToggle={onToggle}
            onSelect={onSelect}
            selectedDirectoryPath={selectedDirectoryPath}
            focusedDirectoryPath={focusedDirectoryPath}
            onSelectDirectory={onSelectDirectory}
            onFocusDirectory={onFocusDirectory}
            onOpenDirectoryMenu={
              onPasteJavaClass || onCreateFile || onCreateFolder || onCreateJavaType
                ? (directoryNode, row, point) => {
                    setMenu({
                      node: directoryNode,
                      x: point?.x ?? row.getBoundingClientRect().left + 20,
                      y: point?.y ?? row.getBoundingClientRect().bottom,
                      returnFocus: row,
                    });
                  }
                : undefined
            }
          />
        ) : (
          <FileTreeItem
            key={node.id}
            node={node}
            depth={0}
            isActive={selectedFilePath === node.path}
            onSelect={onSelect}
          />
        ),
      )}
      {menu && (onPasteJavaClass || onCreateFile || onCreateFolder || onCreateJavaType) && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onPointerDown={() => setMenu(null)}
          />
          <div
            role="menu"
            aria-label={`Actions for ${menu.node.name}`}
            className="fixed z-50 min-w-56 rounded border border-[var(--border-default)] bg-[var(--surface-overlay)] p-1 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                const returnFocus = menu.returnFocus;
                setMenu(null);
                returnFocus.focus();
              }
            }}
          >
            {onCreateFile && (
              <button
                ref={menuItemRef}
                type="button"
                role="menuitem"
                className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--highlight-bg)] focus:bg-[var(--highlight-bg)]"
                onClick={() => {
                  setCreateEntryName("");
                  setCreateEntryError(null);
                  setCreateEntryDialog({
                    kind: "file",
                    node: menu.node,
                    returnFocus: menu.returnFocus,
                  });
                  setMenu(null);
                }}
              >
                New File…
              </button>
            )}
            {onCreateJavaType && (
              <>
                <button
                  ref={onCreateFile || onCreateFolder ? undefined : menuItemRef}
                  type="button"
                  role="menuitem"
                  className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--highlight-bg)] focus:bg-[var(--highlight-bg)]"
                  onClick={() => {
                    setCreateEntryName("");
                    setCreateJavaPackage(
                      javaTypeProjectContextForDirectory?.(menu.node.path)?.packageName ?? "",
                    );
                    setCreateJavaTypeKind("class");
                    setCreateEntryError(null);
                    setCreateEntryDialog({
                      kind: "java-type",
                      node: menu.node,
                      returnFocus: menu.returnFocus,
                    });
                    setMenu(null);
                  }}
                >
                  New Java Type…
                </button>
                {menuJavaTypeProjectContext?.isSourceRoot && (
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--highlight-bg)] focus:bg-[var(--highlight-bg)] disabled:opacity-50"
                    disabled={menuJavaTypeProjectContext.effectiveSourceLevel < 9}
                    title={
                      menuJavaTypeProjectContext.effectiveSourceLevel < 9
                        ? "Module descriptors require Java 9 or later."
                        : undefined
                    }
                    onClick={() => {
                      setCreateEntryName("");
                      setCreateJavaPackage("");
                      setCreateJavaTypeKind("module");
                      setCreateEntryError(null);
                      setCreateEntryDialog({
                        kind: "java-type",
                        node: menu.node,
                        returnFocus: menu.returnFocus,
                      });
                      setMenu(null);
                    }}
                  >
                    New Java Module Descriptor…
                  </button>
                )}
              </>
            )}
            {onCreateFolder && (
              <button
                ref={onCreateFile ? undefined : menuItemRef}
                type="button"
                role="menuitem"
                className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--highlight-bg)] focus:bg-[var(--highlight-bg)]"
                onClick={() => {
                  setCreateEntryName("");
                  setCreateEntryError(null);
                  setCreateEntryDialog({
                    kind: "folder",
                    node: menu.node,
                    returnFocus: menu.returnFocus,
                  });
                  setMenu(null);
                }}
              >
                New Folder…
              </button>
            )}
            {onPasteJavaClass && (
              <button
                ref={onCreateFile || onCreateFolder ? undefined : menuItemRef}
                type="button"
                role="menuitem"
                className="w-full rounded px-2 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--highlight-bg)] focus:bg-[var(--highlight-bg)]"
                onClick={() => {
                  onPasteJavaClass(menu.node);
                  setMenu(null);
                }}
              >
                Paste Java Class from Clipboard
              </button>
            )}
          </div>
        </>
      )}
      {createEntryDialog &&
        ((createEntryDialog.kind === "file" && onCreateFile) ||
          (createEntryDialog.kind === "folder" && onCreateFolder) ||
          (createEntryDialog.kind === "java-type" && onCreateJavaType)) && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <form
              role="dialog"
              aria-modal="true"
              aria-labelledby="file-tree-create-title"
              className="w-full max-w-md rounded-lg border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5 shadow-2xl"
              onSubmit={(event) => void submitCreateEntry(event)}
              onKeyDown={(event) => {
                if (event.key === "Tab") {
                  const focusable = Array.from(
                    event.currentTarget.querySelectorAll<HTMLElement>(
                      "input:not([disabled]), select:not([disabled]), button:not([disabled])",
                    ),
                  );
                  const first = focusable[0];
                  const last = focusable[focusable.length - 1];
                  if (!first || !last) return;
                  if (!event.currentTarget.contains(document.activeElement)) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                  } else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                  } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                  }
                  return;
                }
                if (event.key === "Escape" && !creatingEntry) {
                  event.preventDefault();
                  dismissCreateEntryDialog();
                }
              }}
            >
              <h2
                id="file-tree-create-title"
                className="mb-4 text-base font-semibold text-[var(--text-primary)]"
              >
                {createEntryDialog.kind === "java-type"
                  ? createJavaTypeKind === "module"
                    ? "Create Java module descriptor"
                    : compactSource
                      ? "Create compact Java source"
                      : "Create Java type"
                  : "Create " + createEntryDialog.kind}
              </h2>
              <p className="mb-3 text-xs text-[var(--text-muted)]">
                In {createEntryDialog.node.path}
              </p>
              <label
                htmlFor="file-tree-create-name"
                className="mb-1 block text-sm text-[var(--text-primary)]"
              >
                {createEntryDialog.kind === "file"
                  ? "File name"
                  : createEntryDialog.kind === "java-type"
                    ? createJavaTypeKind === "module"
                      ? "Module name"
                      : compactSource
                        ? "Source name"
                        : "Type name"
                    : "Folder name"}
              </label>
              <input
                ref={createEntryInputRef}
                id="file-tree-create-name"
                aria-label={
                  createEntryDialog.kind === "file"
                    ? "File name"
                    : createEntryDialog.kind === "java-type"
                      ? createJavaTypeKind === "module"
                        ? "Module name"
                        : compactSource
                          ? "Source name"
                          : "Type name"
                      : "Folder name"
                }
                aria-invalid={Boolean(createEntryError)}
                aria-describedby={createEntryError ? "file-tree-create-error" : undefined}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                value={createEntryName}
                onChange={(event) => setCreateEntryName(event.target.value)}
                disabled={creatingEntry}
              />
              {createEntryDialog.kind === "java-type" && createJavaTypeKind === "module" && (
                <>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    The module descriptor is created at this source root as module-info.java. Add
                    the requires and exports directives used by this module.
                  </p>
                  <p role="status" className="mt-1 text-xs text-[var(--text-muted)]">
                    {selectedJavaTypeProjectContext
                      ? `Project source level: Java ${selectedJavaTypeProjectContext.effectiveSourceLevel}. Module descriptors require Java 9 or later.`
                      : "The current project context no longer identifies this as a Java source root."}
                  </p>
                </>
              )}
              {createEntryDialog.kind === "java-type" && createJavaTypeKind !== "module" && (
                <>
                  <label
                    htmlFor="file-tree-create-java-kind"
                    className="mb-1 mt-3 block text-sm text-[var(--text-primary)]"
                  >
                    Java type
                  </label>
                  <select
                    id="file-tree-create-java-kind"
                    aria-label="Java type"
                    className="w-full rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                    value={createJavaTypeKind}
                    onChange={(event) => setCreateJavaTypeKind(event.target.value as JavaTypeKind)}
                    disabled={creatingEntry}
                  >
                    <option value="class">Class</option>
                    <option value="interface">Interface</option>
                    <option value="enum">Enum</option>
                    <option value="record">Record (Java 16+)</option>
                    <option value="annotation">Annotation</option>
                    <option value="compact-source">Compact source (Java 25+)</option>
                  </select>
                  {compactSource ? (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      Creates a compact .java source with an instance main method in the unnamed
                      package. Java 25 or later is required. Named modules need an ordinary type
                      with a package name. Source name is the file name without .java. In Java Run,
                      select a synchronized main source set and Java 25 launcher rules for
                      provider-supported discovery and editor actions, or enter the main class.
                    </p>
                  ) : (
                    <>
                      <label
                        htmlFor="file-tree-create-java-package"
                        className="mb-1 mt-3 block text-sm text-[var(--text-primary)]"
                      >
                        {selectedJavaTypeProjectContext?.moduleName ? "Package name (required for this named module)" : "Package name (optional)"}
                      </label>
                      <input
                        id="file-tree-create-java-package"
                        aria-label="Package name"
                        aria-invalid={Boolean(createEntryError)}
                        aria-describedby={createEntryError ? "file-tree-create-error" : undefined}
                        className="w-full rounded border border-[var(--border-default)] bg-[var(--surface-background)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                        value={createJavaPackage}
                        onChange={(event) => setCreateJavaPackage(event.target.value)}
                        disabled={creatingEntry}
                      />
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        {selectedJavaTypeProjectContext?.sourceRoot !== undefined
                          ? "The type is created beneath the declared source root in directories matching its package. Missing package directories are created."
                          : "No unique ordinary source root is available. The type is created in the selected folder; check that its package matches the project layout."}
                        {" "}Record syntax requires Java 16 or later.
                      </p>
                    </>
                  )}
                  {(selectedJavaTypeProjectContext !== null ||
                    createJavaTypeKind === "record" ||
                    compactSource) && (
                    <p role="status" className="mt-1 text-xs text-[var(--text-muted)]">
                      {selectedJavaTypeProjectContext === null
                        ? compactSource
                          ? "The current project context does not identify one source-set release for this folder, so compact-source compatibility cannot be checked. Java 25 or later is required."
                          : "The current project context does not identify one source-set release for this folder, so record compatibility cannot be checked."
                        : `Project source level: Java ${selectedJavaTypeProjectContext.effectiveSourceLevel}.${selectedJavaTypeProjectContext.moduleName
                          ? ` Named module: ${selectedJavaTypeProjectContext.moduleName}.`
                          : selectedJavaTypeProjectContext.moduleName === null ? " No named module is declared." : " Module information is unavailable."}`}
                    </p>
                  )}
                </>
              )}
              {createEntryDialog.kind === "java-type" && selectedJavaTypeProjectContext?.isGeneratedSource === true && (
                <p className="mt-2 text-xs text-[var(--text-muted)]" aria-label="Generated Java sources">
                  This is a generated source folder. Builds or code generation can replace its
                  contents. Use an ordinary source folder for hand-written types.
                </p>
              )}
              {javaSourceDestination !== null && (
                <p className="mt-2 break-all text-xs text-[var(--text-muted)]" aria-label="Java source destination">
                  Destination: {javaSourceDestination}
                </p>
              )}
              {createEntryError && (
                <p
                  id="file-tree-create-error"
                  role="alert"
                  className="mt-2 text-xs text-[var(--accent-red)]"
                >
                  {createEntryError}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-[var(--border-default)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
                  disabled={creatingEntry}
                  onClick={dismissCreateEntryDialog}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-[var(--accent-blue)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={creatingEntry || !createEntryName.trim()}
                >
                  {creatingEntry
                    ? "Creating…"
                    : createEntryDialog.kind === "java-type"
                      ? createJavaTypeKind === "module"
                        ? "Create module descriptor"
                        : compactSource
                          ? "Create compact source"
                          : "Create Java type"
                      : "Create"}
                </button>
              </div>
            </form>
          </div>
        )}
    </div>
  );
}
