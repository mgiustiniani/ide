import type {
  EditorRecoveryContext,
  EditorRecoveryDraft,
  EditorRecoveryEntry,
  EditorRecoverySession,
  EditorRecoverySnapshot,
} from "@ide/contracts";
import { EDITOR_RECOVERY_MAX_DRAFTS, EDITOR_RECOVERY_MAX_FILE_BYTES } from "@ide/contracts";
import type { EditorRecoveryPort } from "@ide/web-core/ports";
import { invokeTauri } from "./errors";

const identity = /^[a-f0-9]{32}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid recovery response.");
  return value as Record<string, unknown>;
}
function correlated(value: unknown, context: EditorRecoveryContext & { sessionId?: string }) {
  const result = object(value);
  if (
    result.workspaceId !== context.workspaceId ||
    result.generation !== context.generation ||
    typeof result.sessionId !== "string" ||
    !identity.test(result.sessionId) ||
    (context.sessionId !== undefined && result.sessionId !== context.sessionId)
  )
    throw new Error("Stale recovery response.");
  return result;
}
function entry(
  value: unknown,
  includeContent = false,
): EditorRecoverySnapshot | EditorRecoveryEntry {
  const data = object(value);
  if (
    typeof data.id !== "string" ||
    !identity.test(data.id) ||
    typeof data.filePath !== "string" ||
    data.filePath.length === 0 ||
    data.filePath.length > 4096 ||
    data.filePath.startsWith("/") ||
    data.filePath.includes("\\") ||
    data.filePath.includes("\0") ||
    data.filePath.split("/").some((part) => !part || part === "." || part === "..") ||
    typeof data.language !== "string" ||
    !data.language ||
    data.language.length > 64 ||
    !["draft", "history"].includes(String(data.kind)) ||
    typeof data.currentSession !== "boolean" ||
    !Number.isSafeInteger(data.capturedAt) ||
    Number(data.capturedAt) < 0 ||
    !Number.isSafeInteger(data.byteLength) ||
    Number(data.byteLength) < 0 ||
    Number(data.byteLength) > EDITOR_RECOVERY_MAX_FILE_BYTES ||
    (includeContent
      ? typeof data.content !== "string" ||
        new TextEncoder().encode(data.content).length !== data.byteLength
      : data.content !== undefined)
  )
    throw new Error("Invalid recovery entry.");
  return Object.freeze(data) as unknown as EditorRecoverySnapshot | EditorRecoveryEntry;
}
export class TauriEditorRecoveryAdapter implements EditorRecoveryPort {
  async start(context: EditorRecoveryContext): Promise<EditorRecoverySession> {
    const result = correlated(
      await invokeTauri("start_editor_recovery", { request: context }),
      context,
    );
    return {
      workspaceId: context.workspaceId,
      generation: context.generation,
      sessionId: result.sessionId as string,
    };
  }
  async checkpoint(
    session: EditorRecoverySession,
    drafts: readonly EditorRecoveryDraft[],
  ): Promise<void> {
    if (
      drafts.length > EDITOR_RECOVERY_MAX_DRAFTS ||
      drafts.some(
        (draft) => new TextEncoder().encode(draft.content).length > EDITOR_RECOVERY_MAX_FILE_BYTES,
      )
    )
      throw new Error("Recovery checkpoint capacity exceeded.");
    correlated(
      await invokeTauri("checkpoint_editor_recovery", { request: { session, drafts } }),
      session,
    );
  }
  async list(session: EditorRecoverySession): Promise<readonly EditorRecoveryEntry[]> {
    const data = correlated(
      await invokeTauri("list_editor_recovery", { request: session }),
      session,
    );
    if (!Array.isArray(data.entries) || data.entries.length > 164)
      throw new Error("Invalid recovery inventory.");
    const entries = data.entries.map((item) => entry(item) as EditorRecoveryEntry);
    if (new Set(entries.map((item) => item.id)).size !== entries.length)
      throw new Error("Duplicate recovery entries.");
    return Object.freeze(entries);
  }
  async read(session: EditorRecoverySession, entryId: string): Promise<EditorRecoverySnapshot> {
    const data = correlated(
      await invokeTauri("read_editor_recovery", { request: { session, entryId } }),
      session,
    );
    const snapshot = entry(data.entry, true) as EditorRecoverySnapshot;
    if (snapshot.id !== entryId) throw new Error("Mismatched recovery entry.");
    return snapshot;
  }
  async remove(session: EditorRecoverySession, entryId: string): Promise<void> {
    correlated(
      await invokeTauri("remove_editor_recovery", { request: { session, entryId } }),
      session,
    );
  }
  async stop(session: EditorRecoverySession): Promise<void> {
    correlated(await invokeTauri("stop_editor_recovery", { request: session }), session);
  }
}
