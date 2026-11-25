import type {
  JavaEffectiveProjectContext,
  JavaProjectModule,
  JavaProjectSourceSet,
  JavaTestClassOrigin,
} from "@ide/contracts";

export interface JavaTestSourceOwner {
  module: JavaProjectModule;
  sourceSet: JavaProjectSourceSet;
}
type Ownership = { kind: "resolved"; owner: JavaTestSourceOwner } | { kind: "unavailable"; reason: string };
const unavailable = (reason: string): Ownership => ({ kind: "unavailable", reason });
const qualified = (context: JavaEffectiveProjectContext) =>
  context.status === "available" && /^java-project-context-v[3-7]$/.test(context.schemaVersion);
const same = (a: JavaTestSourceOwner, b: JavaTestSourceOwner) =>
  a.module.providerId === b.module.providerId && a.module.id === b.module.id && a.sourceSet.id === b.sourceSet.id;
const owners = (context: JavaEffectiveProjectContext): JavaTestSourceOwner[] =>
  context.modules.flatMap((module) => module.sourceSets.map((sourceSet) => ({ module, sourceSet })));
const providerAvailable = (context: JavaEffectiveProjectContext, owner: JavaTestSourceOwner) => {
  const providers = context.providers.filter((provider) => provider.providerId === owner.module.providerId);
  return providers.length === 1 && providers[0]!.status === "available";
};
const path = (value: string) => value === "." ? "" : value;
const relative = (value: string, root = false) =>
  (root && path(value) === "") || (value.length > 0 && !/[\\:\0]/.test(value) &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== ".."));
const admitted = (entry: JavaProjectSourceSet["runtimeClasspath"][number]) =>
  typeof entry.fingerprint === "string" && entry.fingerprint.length > 0 && entry.fingerprint !== "missing";

function gradleArchiveOwnerMatchesDependencies(
  executing: JavaTestSourceOwner,
  owner: JavaTestSourceOwner,
  entries: JavaProjectSourceSet["runtimeClasspath"],
) {
  const dependencies = executing.sourceSet.moduleDependencies.filter(
    (edge) => edge.scope === "compile" || edge.scope === "runtime",
  );
  const scopes = new Map(dependencies.map((edge) => [edge.moduleId, edge.scope]));
  if (owner.module.providerId !== executing.module.providerId || owner.sourceSet.kind !== "main")
    return false;
  const ownerScope = scopes.get(owner.module.id);
  if (owner.module.id !== executing.module.id &&
      (!ownerScope || entries.some((entry) => entry.dependencyScope !== ownerScope)))
    return false;
  const represented = new Set(executing.sourceSet.runtimeClasspath.filter((entry) =>
    entry.providerId === executing.module.providerId && entry.dependencyScope === scopes.get(entry.moduleId),
  ).map((entry) => entry.moduleId));
  return dependencies.every((edge) => represented.has(edge.moduleId) && scopes.get(edge.moduleId) === edge.scope);
}

/** Match actual test output to one provider-owned source set, never by class name alone. */
export function resolveJavaTestRuntimeOwner(
  context: JavaEffectiveProjectContext,
  projectPath: string,
  origin: JavaTestClassOrigin,
): Ownership {
  if (!qualified(context) || origin.kind !== "directory" || !relative(origin.path) || !relative(projectPath, true))
    return unavailable("The test's compiled output has no qualified workspace source ownership.");
  const matches = owners(context).filter((owner) => owner.sourceSet.outputDirectories.includes(origin.path));
  if (matches.length !== 1 || path(matches[0]!.module.root) !== path(projectPath) ||
      matches[0]!.module.providerId !== "gradle-effective-v1" || !providerAvailable(context, matches[0]!))
    return unavailable("The test's compiled output does not identify one current Gradle source set.");
  const owner = matches[0]!;
  const entries = owner.sourceSet.runtimeClasspath.filter((entry) => entry.path === origin.path);
  if (!entries.length || entries.some((entry) => !admitted(entry) ||
      entry.providerId !== owner.module.providerId || entry.moduleId !== owner.module.id || entry.sourceSetId !== owner.sourceSet.id))
    return unavailable("The test output is absent from its current provider-owned runtime classpath.");
  return { kind: "resolved", owner };
}

/** Consume RefactorKit's runtime-classpath ownership, including internal project JARs. */
export function resolveJavaTestDeclaringOwner(
  context: JavaEffectiveProjectContext,
  executing: JavaTestSourceOwner,
  origin: JavaTestClassOrigin,
): Ownership {
  if (!qualified(context) || !relative(origin.path) || !providerAvailable(context, executing) ||
      !owners(context).some((owner) => owner.module === executing.module && owner.sourceSet === executing.sourceSet))
    return unavailable("The declaring class has no current provider-owned runtime context.");
  const entries = executing.sourceSet.runtimeClasspath.filter((entry) => entry.path === origin.path);
  if (!entries.length || entries.some((entry) => !admitted(entry)))
    return unavailable("The declaring class origin is absent from the current runtime classpath.");
  const matches = owners(context).filter((owner) => entries.every((entry) =>
    entry.providerId === owner.module.providerId && entry.moduleId === owner.module.id && entry.sourceSetId === owner.sourceSet.id));
  if (matches.length !== 1 || !providerAvailable(context, matches[0]!))
    return unavailable("The declaring class origin does not identify one provider-owned source set.");
  const owner = matches[0]!;
  if (origin.kind === "directory") {
    const outputs = owners(context).filter((candidate) => candidate.sourceSet.outputDirectories.includes(origin.path));
    if (outputs.length !== 1 || !same(owner, outputs[0]!))
      return unavailable("The declaring output directory has ambiguous source ownership.");
  } else if (origin.kind !== "archive" || same(owner, executing) ||
      entries.some((entry) => entry.fingerprint !== entries[0]!.fingerprint) ||
      (executing.module.providerId === "gradle-effective-v1" &&
       !gradleArchiveOwnerMatchesDependencies(executing, owner, entries))) {
    // RefactorKit attributes external artifacts to the consuming source set.
    // Only an explicitly different producer identifies an internal project JAR.
    return unavailable("The declaring archive is not identified as an internal project artifact.");
  }
  return { kind: "resolved", owner };
}

/** Dependency analysis roots cannot establish ownership of a source declaration. */
export function javaTestSourceBelongsToOwner(value: string, owner: JavaTestSourceOwner): boolean {
  if (!relative(value) || !relative(owner.module.root, true)) return false;
  const moduleRoot = path(owner.module.root);
  if (moduleRoot && !value.startsWith(`${moduleRoot}/`)) return false;
  return [...owner.sourceSet.sourceRoots, ...owner.sourceSet.generatedSourceRoots].some((root) =>
    relative(root, true) && (path(root) === "" || value.startsWith(`${path(root)}/`)));
}
