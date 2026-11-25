/** Workspace-scoped recovery. These identifiers do not authorize source writes. */
export interface EditorRecoveryContext {
  workspaceId: string;
  generation: number;
}
export interface EditorRecoverySession extends EditorRecoveryContext {
  sessionId: string;
}
export interface EditorRecoveryDraft {
  filePath: string;
  content: string;
  language: string;
}
export interface EditorRecoveryEntry {
  id: string;
  filePath: string;
  language: string;
  kind: "draft" | "history";
  capturedAt: number;
  byteLength: number;
  currentSession: boolean;
}
export interface EditorRecoverySnapshot extends EditorRecoveryEntry {
  content: string;
}
export interface EditorBufferReplacement {
  readonly filePath: string;
  readonly before: string;
  readonly after: string;
}
export const EDITOR_RECOVERY_MAX_FILE_BYTES = 1024 * 1024;
export const EDITOR_RECOVERY_MAX_DRAFTS = 64;
