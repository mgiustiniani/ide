import type { CommandPaletteCommand } from "@ide/ui";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core";
import type { JavaProjectModel, JavaProjectModelPackage } from "./useJavaProjectModelController";

export interface JavaPackageMoveCommandOptions {
  model: JavaProjectModel | null;
  activeFilePath: string;
  projectPath: string;
  canReview(pkg: JavaProjectModelPackage): boolean;
  onReview(pkg: JavaProjectModelPackage): void;
}

function normalizedWorkspacePath(value: string): string | null {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || !isNormalizedWorkspaceRelativePath(normalized)) return null;
  return normalized;
}

/**
 * Offer package move from the command palette only when RefactorKit's current
 * workspace symbol model associates the exact active file with one package in
 * the selected project and the shared operation gate permits review.
 */
export function javaPackageMoveCommandForActiveFile({
  model,
  activeFilePath,
  projectPath,
  canReview,
  onReview,
}: JavaPackageMoveCommandOptions): CommandPaletteCommand | null {
  if (!model) return null;
  const activePath = normalizedWorkspacePath(activeFilePath);
  if (!activePath) return null;

  const normalizedProjectPath = projectPath ? normalizedWorkspacePath(projectPath) : "";
  if (
    normalizedProjectPath === null ||
    (normalizedProjectPath && !activePath.startsWith(`${normalizedProjectPath}/`))
  )
    return null;

  const sourceMatches = model.packages.filter((pkg) => {
    const packagePath = pkg.name.trim();
    if (!packagePath) return false;
    return pkg.sourcePaths.some((sourcePath) => normalizedWorkspacePath(sourcePath) === activePath);
  });
  // RefactorKit may report a member's unqualified owner name. The read-only
  // grouping then also associates that file with the default package. When
  // the same saved file has a type declaration, use that engine-provided type
  // identity to disambiguate the package rather than hiding a valid action.
  const activeTypePackages = new Set(
    model.classes
      .filter((type) => normalizedWorkspacePath(type.path) === activePath)
      .map((type) => {
        const separator = type.qualifiedName.lastIndexOf(".");
        return separator <= 0 ? "(default)" : type.qualifiedName.slice(0, separator);
      }),
  );
  const matches =
    activeTypePackages.size > 0
      ? sourceMatches.filter((pkg) => activeTypePackages.has(pkg.name))
      : sourceMatches;
  if (matches.length !== 1 || !canReview(matches[0]!)) return null;

  const selectedPackage = matches[0]!;
  return {
    id: "java.refactor.move-package",
    label: `Review move of package ${selectedPackage.name}`,
    category: "Java · Refactor",
    run: () => onReview(selectedPackage),
  };
}
