import type { JavaExecutionSnapshot } from "@ide/contracts";

export function normalizeJavaCompilerDiagnostics(
  value: unknown,
): NonNullable<JavaExecutionSnapshot["compilerDiagnostics"]> {
  const fail = () => {
    throw new Error("Invalid Java compiler locations.");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const data = value as Record<string, unknown>;
  if (typeof data.truncated !== "boolean" || !Array.isArray(data.items) || data.items.length > 100)
    return fail();
  const keys = new Set<string>();
  for (const raw of data.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
    const item = raw as Record<string, unknown>;
    if (
      typeof item.path !== "string" ||
      !item.path.endsWith(".java") ||
      item.path.startsWith("/") ||
      /[\\:\u0000-\u001f\u007f]/u.test(item.path) ||
      new TextEncoder().encode(item.path).length > 4096 ||
      !item.path.split("/").every((part) => part && part !== "." && part !== "..") ||
      !Number.isSafeInteger(item.line) ||
      Number(item.line) < 1 ||
      Number(item.line) > 2147483647 ||
      !(
        item.reportedColumn === null ||
        (Number.isSafeInteger(item.reportedColumn) &&
          Number(item.reportedColumn) >= 1 &&
          Number(item.reportedColumn) <= 2147483647)
      ) ||
      !["error", "warning"].includes(String(item.severity)) ||
      typeof item.message !== "string" ||
      !item.message ||
      /[\u0000-\u001f\u007f]/u.test(item.message) ||
      new TextEncoder().encode(item.message).length > 2048
    )
      return fail();
    const key = JSON.stringify([
      item.path,
      item.line,
      item.reportedColumn,
      item.severity,
      item.message,
    ]);
    if (keys.has(key)) return fail();
    keys.add(key);
  }
  return value as NonNullable<JavaExecutionSnapshot["compilerDiagnostics"]>;
}
