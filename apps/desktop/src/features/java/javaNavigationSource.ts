import type { EditorPort } from "@ide/web-core/ports";

const MAX_SOURCE_BYTES = 1024 * 1024;

/** Read presentation text without opening a tab or adopting a disk save baseline. */
export async function readJavaNavigationSource(
  editor: Pick<EditorPort, "readPreviewContent">,
  getBuffer: () => string | undefined,
  filePath: string,
  isCurrent: () => boolean,
): Promise<string | null> {
  if (
    !isCurrent() ||
    !filePath.endsWith(".java") ||
    filePath.startsWith("/") ||
    filePath.includes("\\") ||
    filePath.includes(":") ||
    filePath.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  const bounded = (text: string) =>
    new TextEncoder().encode(text).byteLength <= MAX_SOURCE_BYTES ? text : null;
  const buffer = getBuffer();
  if (buffer !== undefined) return isCurrent() ? bounded(buffer) : null;
  if (!editor.readPreviewContent) return null;
  try {
    const snapshot = await editor.readPreviewContent(filePath);
    if (
      !isCurrent() ||
      snapshot.filePath !== filePath ||
      getBuffer() !== undefined
    )
      return null;
    return bounded(snapshot.content);
  } catch {
    return null;
  }
}
