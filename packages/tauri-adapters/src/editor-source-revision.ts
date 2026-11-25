import type { EditorDiskInspectionContext, EditorDiskStatus } from "@ide/contracts";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri, TauriAdapterError } from "./errors";

const DISK_INSPECTION_RETRY_MS = 25;

/** Journal-directed read-only inspection; it does not create or change an editor save baseline. */
export async function inspectEditorSourceRevision(
  context: EditorDiskInspectionContext,
  filePath: string,
  revision: string,
  timeoutMs: number,
): Promise<EditorDiskStatus> {
  const command = "inspect_editor_disk_status";
  if (
    !context ||
    typeof context.workspaceId !== "string" ||
    !context.workspaceId ||
    context.workspaceId.length > 256 ||
    context.workspaceId.includes("\0") ||
    !Number.isSafeInteger(context.generation) ||
    context.generation < 1 ||
    !isNormalizedWorkspaceRelativePath(filePath) ||
    filePath.length > 4096 ||
    !/^[a-f0-9]{64}$/.test(revision)
  )
    throw new TauriAdapterError(command, "Invalid transaction source inspection.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const timeoutError = new TauriAdapterError(command, "Transaction source inspection timed out.");
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(timeoutError);
    }, timeoutMs);
  });
  const request = {
    workspaceId: context.workspaceId,
    generation: context.generation,
    filePath,
    expectedRevision: revision,
  };
  const inspect = async () => {
    while (!expired) {
      try {
        return await invokeTauri<unknown>(command, { request });
      } catch (error) {
        // The background editor monitor can temporarily hold the single native worker slot.
        if (!(error instanceof TauriAdapterError) ||
          error.message !== `[tauri:${command}] Disk inspection is busy; retry`) throw error;
        if (!expired) await new Promise(resolve => setTimeout(resolve, DISK_INSPECTION_RETRY_MS));
      }
    }
    throw timeoutError;
  };
  try {
    const result = await Promise.race([inspect(), timeout]);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new TauriAdapterError(command, "Invalid transaction source status.");
    const r = result as Record<string, unknown>;
    if (
      Object.keys(r).sort().join(",") !== "filePath,generation,status,workspaceId" ||
      r.workspaceId !== context.workspaceId ||
      r.generation !== context.generation ||
      r.filePath !== filePath ||
      !["unchanged", "changed", "missing", "unavailable"].includes(r.status as string)
    )
      throw new TauriAdapterError(command, "Invalid transaction source status.");
    return { filePath, status: r.status as EditorDiskStatus["status"] };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
