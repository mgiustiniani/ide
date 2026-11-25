import type { JavaEffectiveProjectContext, JavaProjectModule } from "@ide/contracts";

export interface JavaMoveClassTargetModule {
  id: string;
  name: string;
  root: string;
}

export interface JavaMoveClassSourceSelection {
  providerId: string;
  moduleId: string;
  sourceSetId: string;
}

function normalizedRelativePath(value: string): string | null {
  if (!value || value.includes("\0") || value.includes("\\") || value.includes(":")) {
    return null;
  }
  if (value.startsWith("/")) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "..")) return null;
  return parts.filter((part) => part !== ".").join("/") || ".";
}

function workspaceRelativeSourcePaths(path: string, projectPath: string): string[] {
  const source = path.replaceAll("\\", "/");
  const project = projectPath.replaceAll("\\", "/").replace(/\/$/, "");
  const absoluteSource = source.startsWith("/") || /^[a-zA-Z]:\//.test(source);
  if (absoluteSource) {
    if (!project || project === ".") return [];
    const prefix = project.endsWith("/") ? project : `${project}/`;
    const insensitive = /^[a-zA-Z]:\//.test(project);
    const matches = insensitive
      ? source.toLowerCase().startsWith(prefix.toLowerCase())
      : source.startsWith(prefix);
    if (!matches) return [];
    const relative = normalizedRelativePath(source.slice(prefix.length));
    return relative ? [relative] : [];
  }
  const relative = normalizedRelativePath(source);
  const relativeProject = normalizedRelativePath(project);
  if (!relative) return [];
  if (
    relativeProject &&
    relativeProject !== "." &&
    relative.startsWith(`${relativeProject}/`)
  ) {
    const projectStripped = normalizedRelativePath(relative.slice(relativeProject.length + 1));
    return projectStripped ? [relative, projectStripped] : [relative];
  }
  return [relative];
}

function isWithin(root: string, path: string): boolean {
  return root === "." || path === root || path.startsWith(`${root}/`);
}

function rootsForSourceSet(module: JavaProjectModule, sourceSetId: string): string[] {
  const sets = module.sourceSets.filter((set) => set.id === sourceSetId);
  if (sets.length !== 1) return [];
  const sourceSet = sets[0]!;
  const generatedRoots = sourceSet.generatedSourceRoots
    .map(normalizedRelativePath)
    .filter((root): root is string => root !== null);
  const roots = [...new Set(sourceSet.sourceRoots.map(normalizedRelativePath))].filter(
    (root): root is string =>
      root !== null &&
      !generatedRoots.some((generated) => isWithin(root, generated) || isWithin(generated, root)),
  );
  return roots;
}

function hasQualifiedJavaSourceAnalysis(context: JavaEffectiveProjectContext): boolean {
  switch (context.schemaVersion) {
    case "java-project-context-v1":
    case "java-project-context-v2":
    case "java-project-context-v3":
    case "java-project-context-v4":
    case "java-project-context-v5":
      return true;
    case "java-project-context-v6":
    case "java-project-context-v7":
      return (
        context.semanticAnalysis?.availability === "available" &&
        context.semanticAnalysis.refusalCode === null &&
        context.analysis?.snapshotHash === context.snapshotHash
      );
  }
}

export function javaMoveClassSourceSelection(
  context: JavaEffectiveProjectContext,
  path: string,
  projectPath: string,
): JavaMoveClassSourceSelection | null {
  if (context.status !== "available" || !hasQualifiedJavaSourceAnalysis(context)) return null;

  const relativePaths = workspaceRelativeSourcePaths(path, projectPath).filter((candidate) =>
    candidate.endsWith(".java"),
  );
  if (relativePaths.length === 0) return null;

  const matches = context.modules.flatMap((module) => {
    const mainSets = module.sourceSets.filter((sourceSet) => sourceSet.kind === "main");
    if (mainSets.length !== 1) return [];
    const sourceSet = mainSets[0]!;
    if (
      rootsForSourceSet(module, sourceSet.id).length !== 1 ||
      !rootsForSourceSet(module, sourceSet.id).some((root) =>
        relativePaths.some((relativePath) => isWithin(root, relativePath)),
      )
    )
      return [];
    const providers = context.providers.filter((provider) => provider.providerId === module.providerId);
    if (providers.length !== 1 || providers[0]?.status !== "available") return [];
    return [{ providerId: module.providerId, moduleId: module.id, sourceSetId: sourceSet.id }];
  });
  return matches.length === 1 ? matches[0]! : null;
}

function hasUniqueMainRoot(module: JavaProjectModule): boolean {
  const mainSets = module.sourceSets.filter((sourceSet) => sourceSet.kind === "main");
  return mainSets.length === 1 && rootsForSourceSet(module, mainSets[0]!.id).length === 1;
}

function hasBoundedModuleIdentity(module: JavaProjectModule): boolean {
  return (
    module.id.length > 0 &&
    module.id.length <= 1024 &&
    module.id.trim().length > 0 &&
    ![module.id, module.name].some((value) => /[\u0000-\u001f\u007f-\u009f]/u.test(value))
  );
}

/**
 * Lists safe cross-module destinations from the current provider-owned context.
 * Selection requires a provider-qualified context so module IDs remain scoped
 * to an exact RefactorKit provider.
 */
export function javaMoveClassTargetModules(
  context: JavaEffectiveProjectContext | null | undefined,
  sourcePath: string,
  projectPath: string,
): JavaMoveClassTargetModule[] {
  if (
    !context ||
    context.status !== "available" ||
    ![
      "java-project-context-v3",
      "java-project-context-v4",
      "java-project-context-v5",
      "java-project-context-v6",
      "java-project-context-v7",
    ].includes(context.schemaVersion) ||
    !hasQualifiedJavaSourceAnalysis(context)
  ) {
    return [];
  }

  const source = javaMoveClassSourceSelection(context, sourcePath, projectPath);
  if (!source) return [];
  const sourceProviders = context.providers.filter(
    (provider) => provider.providerId === source.providerId,
  );
  if (sourceProviders.length !== 1 || sourceProviders[0]?.status !== "available") return [];

  const providerModules = context.modules.filter(
    (module) => module.providerId === source.providerId,
  );
  const idCounts = new Map<string, number>();
  for (const module of providerModules) idCounts.set(module.id, (idCounts.get(module.id) ?? 0) + 1);

  return providerModules
    .filter(
      (module) =>
        module.id !== source.moduleId &&
        (idCounts.get(module.id) ?? 0) === 1 &&
        hasBoundedModuleIdentity(module) &&
        hasUniqueMainRoot(module),
    )
    .map((module) => ({ id: module.id, name: module.name, root: module.root }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
