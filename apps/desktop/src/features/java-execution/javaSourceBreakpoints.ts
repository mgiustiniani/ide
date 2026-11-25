import type { JavaBreakpointOptions, JavaSavedSourceBreakpoint } from "@ide/contracts";

export interface SavedSourceBreakpoint extends JavaSavedSourceBreakpoint {
  enabled: boolean;
  /** Hash of the trimmed previous, current and next source lines; source text is never stored. */
  anchor?: string;
}
export const MAX_SOURCE_BREAKPOINTS = 128;
export const MAX_BREAKPOINT_STORAGE_BYTES = 256 * 1024;
export const MAX_BREAKPOINT_ANCHOR_SCAN_LINES = 5000;
export const breakpointStorageKey = (workspaceId: string) => `ide.java.breakpoints.${workspaceId}`;

export function validBreakpointOptions(value: JavaBreakpointOptions): boolean {
  return (
    (value.condition === undefined ||
      (typeof value.condition === "string" &&
        !/[\0\r\n]/.test(value.condition) &&
        new TextEncoder().encode(value.condition).length <= 512)) &&
    (value.hitCount === undefined ||
      (Number.isSafeInteger(value.hitCount) &&
        value.hitCount >= 0 &&
        value.hitCount <= 1_000_000_000)) &&
    (value.logMessage === undefined ||
      (typeof value.logMessage === "string" &&
        !/[\0\r\n]/.test(value.logMessage) &&
        new TextEncoder().encode(value.logMessage).length <= 512))
  );
}

export function validSourcePath(value: unknown): boolean {
  return (
    typeof value === "string" &&
    new TextEncoder().encode(value).length <= 1024 &&
    value.endsWith(".java") &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !/[\0\r\n]/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}
export function validSourceBreakpoints(value: unknown): value is SavedSourceBreakpoint[] {
  if (!Array.isArray(value) || value.length > MAX_SOURCE_BREAKPOINTS) return false;
  const seen = new Set<string>();
  return value.every((point) => {
    if (
      !point ||
      !validSourcePath(point.sourcePath) ||
      !Number.isSafeInteger(point.line) ||
      point.line <= 0 ||
      point.line > 2147483647 ||
      typeof point.fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(point.fingerprint) ||
      (point.anchor !== undefined &&
        (typeof point.anchor !== "string" || !/^[0-9a-f]{64}$/.test(point.anchor))) ||
      typeof point.enabled !== "boolean" ||
      !validBreakpointOptions(point)
    )
      return false;
    const key = `${point.sourcePath}:${point.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function sourcePathInWorkspace(root: string, path: string): string {
  const directory = root.replaceAll("\\", "/").replace(/\/$/, ""),
    file = path.replaceAll("\\", "/");
  if (validSourcePath(file)) return file;
  const relative = file.startsWith(`${directory}/`) ? file.slice(directory.length + 1) : "";
  if (!validSourcePath(relative))
    throw new Error("Choose a Java source inside the current workspace.");
  return relative;
}
export async function sourceFingerprint(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 2 * 1024 * 1024)
    throw new Error("Debugger source exceeds the 2 MiB file limit.");
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure source hashing is unavailable in this application.");
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function anchorForLines(lines: string[], index: number): Promise<string | undefined> {
  const context = [lines[index - 1] ?? "", lines[index] ?? "", lines[index + 1] ?? ""]
    .map((part) => part.trim())
    .join("\n");
  // Avoid hashing or persisting huge source lines. The file fingerprint still protects binding.
  if (context.length > 16 * 1024) return undefined;
  if (!globalThis.crypto?.subtle)
    throw new Error("Secure source hashing is unavailable in this application.");
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(context));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function sourceLineAnchor(text: string, line: number): Promise<string | undefined> {
  const lines = text.split(/\r?\n/);
  if (!Number.isSafeInteger(line) || line < 1 || line > lines.length) return undefined;
  return anchorForLines(lines, line - 1);
}
export async function findSourceLineAnchors(
  text: string,
  anchors: ReadonlySet<string>,
): Promise<Map<string, number[]>> {
  const lines = text.split(/\r?\n/), matches = new Map<string, number[]>();
  if (lines.length > MAX_BREAKPOINT_ANCHOR_SCAN_LINES) return matches;
  for (let offset = 0; offset < lines.length; offset += 32) {
    const end = Math.min(offset + 32, lines.length), batch: Promise<void>[] = [];
    for (let index = offset; index < end; index++)
      batch.push(
        anchorForLines(lines, index).then((anchor) => {
          if (!anchor || !anchors.has(anchor)) return;
          const found = matches.get(anchor) ?? [];
          if (found.length < 2) found.push(index + 1);
          matches.set(anchor, found);
        }),
      );
    await Promise.all(batch);
  }
  return matches;
}
export function loadSourceBreakpoints(workspaceId: string): {
  points: SavedSourceBreakpoint[];
  error: string | null;
} {
  try {
    const raw = localStorage.getItem(breakpointStorageKey(workspaceId));
    if (raw === null) return { points: [], error: null };
    if (new TextEncoder().encode(raw).length > MAX_BREAKPOINT_STORAGE_BYTES)
      throw new Error("Saved breakpoint storage exceeds its limit.");
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4) ||
      !("points" in value) ||
      !validSourceBreakpoints(value.points)
    )
      throw new Error("Saved breakpoint storage is invalid.");
    return { points: value.points, error: null };
  } catch {
    return {
      points: [],
      error: "Saved breakpoints could not be restored. Stored data was preserved.",
    };
  }
}
