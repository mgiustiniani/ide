import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";

interface BufferSnapshot {
  text: string;
  lifetime: symbol;
  dirty: boolean;
  active: boolean;
}
interface Dependencies {
  isCurrent(): boolean;
  openFile(path: string): Promise<boolean>;
  readBuffer(path: string): BufferSnapshot | undefined;
  reveal(path: string, line: number, isCurrent: () => boolean): boolean;
}

/** Reveal saved attribution only in the exact clean source captured by Git. */
export async function openSavedBlameLocation(
  path: string,
  line: number,
  fingerprint: string,
  dependencies: Dependencies,
): Promise<boolean> {
  if (
    !isNormalizedWorkspaceRelativePath(path) ||
    !Number.isSafeInteger(line) ||
    line < 1 ||
    !/^[a-f0-9]{64}$/u.test(fingerprint) ||
    !dependencies.isCurrent() ||
    dependencies.readBuffer(path)?.dirty
  )
    return false;
  if (!(await dependencies.openFile(path)) || !dependencies.isCurrent()) return false;
  const buffer = dependencies.readBuffer(path);
  if (
    !buffer ||
    buffer.dirty ||
    !buffer.active ||
    line > buffer.text.split("\n").length ||
    buffer.text.replaceAll("\r\n", "").includes("\r")
  )
    return false;
  const bytes = new TextEncoder().encode(buffer.text);
  if (bytes.length > 512 * 1024 || !globalThis.crypto?.subtle) return false;
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const current = () => {
    const now = dependencies.readBuffer(path);
    return (
      dependencies.isCurrent() &&
      now?.active === true &&
      !now.dirty &&
      now.text === buffer.text &&
      now.lifetime === buffer.lifetime
    );
  };
  return actual === fingerprint && current() && dependencies.reveal(path, line, current);
}
