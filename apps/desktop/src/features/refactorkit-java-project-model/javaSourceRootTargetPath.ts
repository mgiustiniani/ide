import type { JavaProjectContextSchemaVersion } from "@ide/contracts";

/** Convert a provider source-root path to the workspace-relative target used by RefactorKit. */
export function javaSourceRootTargetPath(
  projectPath: string,
  sourceRoot: string,
  schemaVersion: JavaProjectContextSchemaVersion,
): string {
  if (
    schemaVersion === "java-project-context-v3" ||
    schemaVersion === "java-project-context-v4" ||
    schemaVersion === "java-project-context-v5" ||
    schemaVersion === "java-project-context-v6" ||
    schemaVersion === "java-project-context-v7"
  )
    return sourceRoot;
  return [projectPath, sourceRoot].filter(Boolean).join("/");
}
