// ---------------------------------------------------------------------------
// @ide/web-core – State Public API
// ---------------------------------------------------------------------------

export type { FileTreeStoreSlice, FileTreeStore } from "./file-tree-store";
export { createFileTreeStore } from "./file-tree-store";

export type { EditorStoreSlice, EditorStore } from "./editor-store";
export { createEditorStore } from "./editor-store";

export type { TerminalStoreSlice, TerminalStore } from "./terminal-store";
export { createTerminalStore } from "./terminal-store";

export type { PanelStoreSlice, PanelStore } from "./panel-store";
export { createPanelStore } from "./panel-store";

export type { StoreAccessor } from "./store-accessor";
export { toGetState } from "./store-accessor";
