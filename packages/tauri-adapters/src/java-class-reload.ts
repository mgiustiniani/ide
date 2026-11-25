import type { JavaClassReloadResult } from "@ide/contracts";

export function normalizeJavaClassReload(value: unknown, state: string): JavaClassReloadResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Java class reload result.");
  const result = value as Record<string, unknown>;
  if (
    typeof result.requestId !== "string" ||
    !/^reload-[0-9]{1,20}$/.test(result.requestId) ||
    !["queued", "applied", "failed"].includes(String(result.status)) ||
    (result.status === "queued" && state !== "running") ||
    !Array.isArray(result.classes) ||
    result.classes.length < 1 ||
    result.classes.length > 32 ||
    result.classes.some(
      (name) =>
        typeof name !== "string" ||
        !name ||
        new TextEncoder().encode(name).length > 512 ||
        name.includes("\0"),
    ) ||
    new Set(result.classes).size !== result.classes.length ||
    (result.status === "failed"
      ? typeof result.error !== "string" ||
        !result.error ||
        result.error.includes("\0") ||
        new TextEncoder().encode(result.error).length > 4096
      : result.error !== null)
  )
    throw new Error("Invalid Java class reload result.");
  return result as unknown as JavaClassReloadResult;
}
