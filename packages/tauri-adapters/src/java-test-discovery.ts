import { isJavaBinaryName, isJavaRuntimeIdentifier } from "@ide/contracts";
import type { JavaTestDiscovery } from "@ide/contracts";

function text(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    new TextEncoder().encode(value).length <= limit
  );
}
export function normalizeJavaTestDiscovery(value: unknown, state: string): JavaTestDiscovery {
  const invalid = () => {
    throw new Error("Invalid Java test discovery results.");
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  if (
    !text(data.projectPath, 4096) ||
    !["jdk", "maven", "gradle"].includes(String(data.buildTool)) ||
    data.scope !== (data.buildTool === "gradle" ? "test-task" : "engines") ||
    !["collecting", "ready", "partial", "unavailable"].includes(String(data.status)) ||
    !(data.message === null || (text(data.message, 4096) && data.message.length > 0)) ||
    !Array.isArray(data.tests) ||
    data.tests.length > 10000 ||
    (data.status === "collecting" &&
      (!["starting", "running"].includes(state) || data.tests.length > 0)) ||
    (["ready", "partial"].includes(String(data.status)) && state !== "succeeded") ||
    (data.status === "unavailable" &&
      (!["failed", "stopped"].includes(state) || data.tests.length > 0 || !data.message))
  )
    return invalid();
  const ids = new Set<string>();
  for (const item of data.tests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalid();
    const test = item as Record<string, unknown>;
    if (
      !text(test.id, 128) ||
      !/^test-[a-f0-9]{64}$/.test(test.id) ||
      ids.has(test.id) ||
      !text(test.className, 512) ||
      !isJavaBinaryName(test.className) ||
      !text(test.label, 4096) ||
      !(
        (test.kind === "class" && test.methodName === null) ||
        (test.kind === "method" &&
          text(test.methodName, 512) &&
          isJavaRuntimeIdentifier(test.methodName) &&
          !test.methodName.includes("."))
      )
    )
      return invalid();
    if (test.displayNames !== undefined || test.displayNameCount !== undefined) {
      if (
        test.kind !== "method" ||
        !Number.isSafeInteger(test.displayNameCount) ||
        (test.displayNameCount as number) < 2 ||
        (test.displayNameCount as number) > 10000 ||
        !Array.isArray(test.displayNames) ||
        test.displayNames.length !== Math.min(32, test.displayNameCount as number) ||
        !test.displayNames.every((name) => text(name, 4096)) ||
        new Set(test.displayNames).size !== test.displayNames.length ||
        !test.displayNames.includes(test.label)
      )
        return invalid();
    }
    ids.add(test.id);
  }
  return data as unknown as JavaTestDiscovery;
}
