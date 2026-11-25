import type { JavaEffectiveProjectContext } from "@ide/contracts";
import { isValidJavaPackageName } from "@ide/ui";

export interface JavaTypeProjectContext {
  effectiveSourceLevel: number;
  /** The package represented by one RefactorKit-declared ordinary source root. */
  packageName: string | null;
  /** Whether the selected directory is exactly one ordinary source root. */
  isSourceRoot: boolean;
  /** Unique ordinary source root, normalized to a workspace-relative path. */
  sourceRoot?: string;
  /** The provider identifies this directory beneath a generated source root. */
  isGeneratedSource?: boolean;
  /** Unique provider-declared generated root, normalized to a workspace-relative path. */
  generatedSourceRoot?: string;
  /** One provider-qualified named module, null if not declared, or absent if unknown. */
  moduleName?: string | null;
}

function normalizedRelativePath(value: string): string | null {
  if (value.includes("\0")) return null;
  const path = value.replaceAll("\\", "/");
  if (path.startsWith("/") || path.includes(":")) return null;
  if (path === "" || path === ".") return ".";
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function projectRelativeDirectory(directoryPath: string, projectPath: string): string | null {
  const directory = normalizedRelativePath(directoryPath);
  const project = normalizedRelativePath(projectPath);
  if (directory === null || project === null) return null;
  if (project === ".") return directory;
  if (directory === project) return ".";
  return directory.startsWith(`${project}/`) ? directory.slice(project.length + 1) : null;
}

function containsDirectory(root: string, directory: string): boolean {
  const normalizedRoot = normalizedRelativePath(root);
  if (normalizedRoot === null) return false;
  return (
    normalizedRoot === "." ||
    directory === normalizedRoot ||
    directory.startsWith(`${normalizedRoot}/`)
  );
}

export function javaSourceRootWorkspacePath(
  root: string,
  projectPath: string,
  schemaVersion: JavaEffectiveProjectContext["schemaVersion"],
): string | null {
  const relative = normalizedRelativePath(root);
  const project = normalizedRelativePath(projectPath);
  if (relative === null || project === null) return null;
  if (/^java-project-context-v[3-7]$/u.test(schemaVersion) || project === ".")
    return relative === "." ? "" : relative;
  return relative === "." ? project : `${project}/${relative}`;
}

function packageWithinSourceRoot(root: string, directory: string): string | null {
  const normalizedRoot = normalizedRelativePath(root);
  if (normalizedRoot === null || !containsDirectory(normalizedRoot, directory)) return null;
  const relative =
    normalizedRoot === "."
      ? directory === "."
        ? ""
        : directory
      : directory === normalizedRoot
        ? ""
        : directory.slice(normalizedRoot.length + 1);
  const packageName = relative.replaceAll("/", ".");
  return isValidJavaPackageName(packageName) ? packageName : null;
}

/**
 * Projects source level, package and qualified module facts from one current
 * RefactorKit source set. Package inference requires one ordinary source root;
 * v3 through v7 paths are workspace-relative, and earlier paths project-relative.
 */
export function javaTypeProjectContextForDirectory(
  directoryPath: string,
  projectPath: string,
  context: JavaEffectiveProjectContext | null,
): JavaTypeProjectContext | null {
  if (!context || context.status !== "available") return null;
  if (normalizedRelativePath(projectPath) === null) return null;
  const directory = /^java-project-context-v[3-7]$/u.test(context.schemaVersion)
    ? normalizedRelativePath(directoryPath)
    : projectRelativeDirectory(directoryPath, projectPath);
  if (directory === null) return null;

  const candidates: JavaTypeProjectContext[] = [];
  for (const module of context.modules) {
    const providers = context.providers.filter(
      (provider) => provider.providerId === module.providerId,
    );
    if (providers.length !== 1 || providers[0]?.status !== "available") continue;
    for (const sourceSet of module.sourceSets) {
      const ordinaryRoots = [...new Set(sourceSet.sourceRoots)].filter((root) =>
        containsDirectory(root, directory),
      );
      const generatedRoots = [...new Set(sourceSet.generatedSourceRoots)].filter((root) =>
        containsDirectory(root, directory),
      );
      const generatedRootMatches = generatedRoots.length > 0;
      if (ordinaryRoots.length === 0 && !generatedRootMatches) continue;

      const effectiveSourceLevel = sourceSet.release ?? sourceSet.sourceLevel;
      if (!Number.isSafeInteger(effectiveSourceLevel) || effectiveSourceLevel < 8) continue;
      const packageName =
        ordinaryRoots.length === 1 && !generatedRootMatches
          ? packageWithinSourceRoot(ordinaryRoots[0]!, directory)
          : null;
      const isSourceRoot =
        ordinaryRoots.length === 1 &&
        !generatedRootMatches &&
        normalizedRelativePath(ordinaryRoots[0]!) === directory;
      const jpms = sourceSet.jpms;
      const moduleName = jpms?.availability === "complete" && jpms.descriptors.length === 1
        ? jpms.descriptors[0]!.moduleName
        : jpms?.availability === "not-declared" && jpms.descriptors.length === 0
          ? null
          : undefined;
      const sourceRoot = ordinaryRoots.length === 1 && !generatedRootMatches
        ? javaSourceRootWorkspacePath(ordinaryRoots[0]!, projectPath, context.schemaVersion)
        : null;
      const generatedSourceRoot = generatedRoots.length === 1
        ? javaSourceRootWorkspacePath(generatedRoots[0]!, projectPath, context.schemaVersion)
        : null;
      candidates.push({ effectiveSourceLevel, packageName, isSourceRoot,
        ...(sourceRoot !== null ? { sourceRoot } : {}),
        ...(generatedRootMatches ? { isGeneratedSource: true } : {}),
        ...(generatedSourceRoot !== null ? { generatedSourceRoot } : {}),
        ...(moduleName !== undefined ? { moduleName } : {}),
      });
    }
  }

  return candidates.length === 1 ? candidates[0]! : null;
}
