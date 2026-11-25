import type {
  JavaCoverageResults,
  JavaEffectiveProjectContext,
  JavaProjectContextSettings,
} from "@ide/contracts";

function normalizedRelativePath(value: string, allowEmpty = false) {
  if (allowEmpty && value === "") return "";
  if (
    value.length > 4096 ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    value.startsWith("/")
  )
    return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "..")) return null;
  return parts.filter((part) => part !== ".").join("/");
}

function isWithin(path: string, root: string) {
  return !root || path === root || path.startsWith(`${root}/`);
}

function mavenReportModulePath(reportPath: string) {
  const path = normalizedRelativePath(reportPath);
  if (path === null) return null;
  const suffix = path.match(/(?:^|\/)target\/site\/jacoco(?:-it)?\/jacoco\.xml$/u);
  return suffix?.index === undefined ? null : path.slice(0, suffix.index);
}

function inferredProjectPath(coverageProjectPath: string, context: JavaEffectiveProjectContext) {
  const roots = new Set(
    context.modules
      .map((module) => normalizedRelativePath(module.root, true))
      .filter((root): root is string => root !== null),
  );
  const matches = [...roots]
    .filter((root) => coverageProjectPath === root || coverageProjectPath.endsWith(`/${root}`))
    .sort((left, right) => right.length - left.length);
  const selectedRoot = matches[0];
  if (selectedRoot === undefined || matches[1]?.length === selectedRoot.length) return null;
  const prefixEnd = coverageProjectPath.length - selectedRoot.length;
  return coverageProjectPath.slice(0, prefixEnd).replace(/\/$/, "");
}

/** Resolve JaCoCo files through one synchronized main source root and an open source buffer. */
export function javaCoverageSourcePaths(
  results: JavaCoverageResults | null | undefined,
  settings: JavaProjectContextSettings,
  context: JavaEffectiveProjectContext | null | undefined,
  availableSourcePaths: readonly string[] = [],
): ReadonlyMap<string, string> {
  if (!results || !["ready", "partial"].includes(results.status) || context?.status !== "available")
    return new Map();

  const projectPath = normalizedRelativePath(settings.projectPath, true);
  const coverageProjectPath = normalizedRelativePath(results.projectPath, true);
  if (
    projectPath === null ||
    coverageProjectPath === null ||
    !isWithin(coverageProjectPath, projectPath)
  )
    return new Map();
  // Modern contexts already carry workspace-relative paths for Maven and Gradle.
  const workspaceRelativeContext = [
    "java-project-context-v3",
    "java-project-context-v4",
    "java-project-context-v5",
    "java-project-context-v6",
    "java-project-context-v7",
  ].includes(context.schemaVersion);
  const sourceProjectPath = workspaceRelativeContext || coverageProjectPath === ""
    ? projectPath
    : projectPath || inferredProjectPath(coverageProjectPath, context);
  if (sourceProjectPath === null) return new Map();

  const roots: { moduleRoot: string; workspaceModulePath: string; sourceRoot: string }[] = [];
  const available = new Set(
    availableSourcePaths
      .map((path) => normalizedRelativePath(path))
      .filter((path): path is string => path !== null),
  );
  for (const module of context.modules) {
    const moduleRoot = normalizedRelativePath(module.root, true);
    if (moduleRoot === null) continue;
    const workspaceModulePath = workspaceRelativeContext
      ? moduleRoot
      : [sourceProjectPath, moduleRoot].filter(Boolean).join("/");
    for (const sourceSet of module.sourceSets) {
      if (sourceSet.kind !== "main") continue;
      const generatedRoots = new Set(
        sourceSet.generatedSourceRoots
          .map((root) => normalizedRelativePath(root, true))
          .filter((root): root is string => root !== null),
      );
      for (const root of sourceSet.sourceRoots) {
        const relativeRoot = normalizedRelativePath(root, true);
        if (relativeRoot === null || generatedRoots.has(relativeRoot)) continue;
        const workspaceRoot = workspaceRelativeContext
          ? isWithin(relativeRoot, moduleRoot)
            ? relativeRoot
            : ""
          : isWithin(relativeRoot, moduleRoot)
            ? [sourceProjectPath, relativeRoot].filter(Boolean).join("/")
            : [sourceProjectPath, moduleRoot, relativeRoot].filter(Boolean).join("/");
        if (!workspaceRoot) continue;
        roots.push({ moduleRoot, workspaceModulePath, sourceRoot: workspaceRoot });
      }
    }
  }

  const resolved = new Map<string, string>();
  for (const file of results.files) {
    const packagePath = normalizedRelativePath(file.packageName, true);
    const reportModuleRoot =
      file.moduleRoot === undefined || file.moduleRoot === null
        ? null
        : normalizedRelativePath(file.moduleRoot, true);
    if (
      packagePath === null ||
      (file.moduleRoot !== undefined && file.moduleRoot !== null && reportModuleRoot === null) ||
      !file.name.endsWith(".java") ||
      file.name.includes("/") ||
      file.name.includes("\\") ||
      /[\x00-\x1f\x7f]/.test(file.name)
    )
      continue;
    const mavenModulePath = results.buildTool === "maven" && reportModuleRoot === null
      ? mavenReportModulePath(file.reportPath)
      : undefined;
    if (mavenModulePath === null) continue;

    const candidates = new Set<string>();
    for (const root of roots) {
      if (reportModuleRoot !== null && root.moduleRoot !== reportModuleRoot) continue;
      if (mavenModulePath !== undefined && root.workspaceModulePath !== mavenModulePath) continue;
      const candidate = [root.sourceRoot, packagePath, file.name].filter(Boolean).join("/");
      // A selected module's test task can report production classes from its
      // project dependencies. Keep those sources inside the synchronized
      // project, then require a unique provider-declared main root and an open
      // buffer below before allowing navigation.
      if (
        candidate.length <= 4096 &&
        isWithin(candidate, reportModuleRoot === null ? coverageProjectPath : sourceProjectPath)
      )
        candidates.add(candidate);
    }
    if (candidates.size === 1) {
      const [candidate] = candidates;
      if (candidate && available.has(candidate)) resolved.set(file.id, candidate);
    }
  }
  return resolved;
}
