import type { CommandPaletteCommand } from "@ide/ui";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core";
import type { JavaProjectModel, JavaProjectModelClass } from "./useJavaProjectModelController";

export interface JavaClassMoveCommandOptions {
  model: JavaProjectModel | null;
  activeFilePath: string;
  projectPath: string;
  canReview(type: JavaProjectModelClass): boolean;
  onReview(type: JavaProjectModelClass): void;
}

function normalizedWorkspacePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || !isNormalizedWorkspaceRelativePath(normalized)) return null;
  return normalized;
}

/**
 * Offer one saved-source type move command for each RefactorKit type identity
 * associated with the exact active Java file. The project operation gate owns
 * capability, SDK and synchronized-context admission.
 */
export function javaClassMoveCommandsForActiveFile({
  model,
  activeFilePath,
  projectPath,
  canReview,
  onReview,
}: JavaClassMoveCommandOptions): CommandPaletteCommand[] {
  if (!model) return [];
  const activePath = normalizedWorkspacePath(activeFilePath);
  if (!activePath) return [];

  const normalizedProjectPath = projectPath ? normalizedWorkspacePath(projectPath) : "";
  if (
    normalizedProjectPath === null ||
    (normalizedProjectPath && !activePath.startsWith(`${normalizedProjectPath}/`))
  )
    return [];

  const matchingTypes = new Map<string, JavaProjectModelClass>();
  for (const type of model.classes) {
    if (normalizedWorkspacePath(type.path) !== activePath || !canReview(type)) continue;
    matchingTypes.set(`${type.qualifiedName}\0${type.path}`, type);
  }

  return [...matchingTypes.values()]
    .sort(
      (left, right) =>
        left.line - right.line || left.qualifiedName.localeCompare(right.qualifiedName),
    )
    .map((type) => ({
      id: `java.refactor.move-class:${encodeURIComponent(type.path)}:${encodeURIComponent(type.qualifiedName)}`,
      label: `Review move of Java type ${type.qualifiedName} (${type.path})`,
      category: "Java · Refactor",
      run: () => onReview(type),
    }));
}
