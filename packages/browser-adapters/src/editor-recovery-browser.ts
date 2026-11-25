import type { EditorRecoveryPort } from "@ide/web-core/ports";
import type {
  EditorRecoveryContext,
  EditorRecoveryDraft,
  EditorRecoveryEntry,
  EditorRecoverySession,
  EditorRecoverySnapshot,
} from "@ide/contracts";

/** Browser storage is not presented as native, durable recovery. */
export class BrowserEditorRecoveryAdapter implements EditorRecoveryPort {
  private unavailable(): never {
    throw new Error("Persistent editor recovery is unavailable in this browser provider.");
  }
  async start(_context: EditorRecoveryContext): Promise<EditorRecoverySession> {
    return this.unavailable();
  }
  async checkpoint(
    _session: EditorRecoverySession,
    _drafts: readonly EditorRecoveryDraft[],
  ): Promise<void> {
    return this.unavailable();
  }
  async list(_session: EditorRecoverySession): Promise<readonly EditorRecoveryEntry[]> {
    return this.unavailable();
  }
  async read(_session: EditorRecoverySession, _entryId: string): Promise<EditorRecoverySnapshot> {
    return this.unavailable();
  }
  async remove(_session: EditorRecoverySession, _entryId: string): Promise<void> {
    return this.unavailable();
  }
  async stop(_session: EditorRecoverySession): Promise<void> {
    return this.unavailable();
  }
}
