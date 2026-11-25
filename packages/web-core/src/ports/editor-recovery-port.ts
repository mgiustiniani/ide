import type {
  EditorRecoveryContext,
  EditorRecoveryDraft,
  EditorRecoveryEntry,
  EditorRecoverySession,
  EditorRecoverySnapshot,
} from "@ide/contracts";

/** Persistent checkpoints, not a file writer or semantic refactoring transaction. */
export interface EditorRecoveryPort {
  start(context: EditorRecoveryContext): Promise<EditorRecoverySession>;
  checkpoint(session: EditorRecoverySession, drafts: readonly EditorRecoveryDraft[]): Promise<void>;
  list(session: EditorRecoverySession): Promise<readonly EditorRecoveryEntry[]>;
  read(session: EditorRecoverySession, entryId: string): Promise<EditorRecoverySnapshot>;
  remove(session: EditorRecoverySession, entryId: string): Promise<void>;
  stop(session: EditorRecoverySession): Promise<void>;
}
