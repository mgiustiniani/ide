import { isJavaBinaryName } from "@ide/contracts";
import type { JavaEffectiveProjectContext } from "@ide/contracts";

const MAX_OUTPUT_DIRECTORIES = 256;
const MAX_SUGGESTIONS = 64;

export interface JavaClassFileSuggestions {
  paths: string[];
  truncated: boolean;
}



function workspaceRelativeDirectory(value: string) {
  if (
    value.length > 4096 ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.startsWith("/")
  )
    return null;
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "..")) return null;
  return parts.filter((part) => part !== ".").join("/");
}

export function javaClassFileSuggestions(
  context: JavaEffectiveProjectContext | null | undefined,
  selection: { providerId?: string; moduleId: string; sourceSetId: string } | undefined,
  className: string,
  projectPath = "",
): JavaClassFileSuggestions {
  if (!context || context.status !== "available" || !selection || !isJavaBinaryName(className))
    return { paths: [], truncated: false };

  const selectedModules = context.modules.filter(
    (module) =>
      module.id === selection.moduleId &&
      (!selection.providerId || module.providerId === selection.providerId),
  );
  if (selectedModules.length !== 1) return { paths: [], truncated: false };
  const selectedModule = selectedModules[0];
  const selectedSets = selectedModule.sourceSets.filter((set) => set.id === selection.sourceSetId);
  if (selectedSets.length !== 1) return { paths: [], truncated: false };
  const selectedSet = selectedSets[0];
  const workspaceProjectPath = projectPath ? workspaceRelativeDirectory(projectPath) : "";
  if (workspaceProjectPath === null) return { paths: [], truncated: false };

  const outputDirectories = new Set<string>();
  let truncated = false;
  const addOutputs = (sourceSet: (typeof selectedSet)[]) => {
    for (const output of sourceSet.flatMap((set) => set.outputDirectories)) {
      const relative = workspaceRelativeDirectory(output);
      if (relative === null) continue;
      const outputIncludesProjectPath =
        workspaceProjectPath &&
        (relative === workspaceProjectPath || relative.startsWith(`${workspaceProjectPath}/`));
      const workspaceRelative =
        workspaceProjectPath && !outputIncludesProjectPath
          ? `${workspaceProjectPath}/${relative}`
          : relative;
      if (
        !outputDirectories.has(workspaceRelative) &&
        outputDirectories.size >= MAX_OUTPUT_DIRECTORIES
      ) {
        truncated = true;
        return;
      }
      outputDirectories.add(workspaceRelative);
    }
  };
  addOutputs([selectedSet]);

  for (const dependency of selectedSet.runtimeClasspath) {
    if (outputDirectories.size >= MAX_OUTPUT_DIRECTORIES) {
      truncated = true;
      break;
    }
    const modules = context.modules.filter(
      (module) => module.id === dependency.moduleId && module.providerId === dependency.providerId,
    );
    if (modules.length !== 1) continue;
    const sourceSets = modules[0].sourceSets.filter((set) => set.id === dependency.sourceSetId);
    if (sourceSets.length === 1) addOutputs(sourceSets);
  }

  const classPath = `${className.replaceAll(".", "/")}.class`;
  const candidates = [...outputDirectories]
    .map((directory) => (directory ? `${directory}/${classPath}` : classPath))
    .filter((candidate) => candidate.length <= 1024)
    .sort();
  if (candidates.length > MAX_SUGGESTIONS) truncated = true;
  return { paths: candidates.slice(0, MAX_SUGGESTIONS), truncated };
}
