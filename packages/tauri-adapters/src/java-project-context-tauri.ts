import type {
  JavaEffectiveProjectContext,
  JavaProjectContextAuthority,
  JavaProjectContextRequest,
  JavaProjectContextResult,
  JavaSavedSourceRecoveryRequest,
  JavaProjectLanguageSettingsRequest,
  JavaProjectLanguageSettingsResult,
  JavaProjectClasspathEntry,
  JavaProjectSourceSet,
  JavaProjectContextAvailability,
  JavaProjectContextSchemaVersion,
  JavaProjectDependencyScope,
  JavaProjectModule,
  JavaProjectResolvedArtifact,
  JavaProjectSourceRootEvidence,
  JavaMavenFailsafeAvailability,
  JavaMavenFailsafeContext,
  JavaMavenTestJvmAvailability,
  JavaMavenTestJvmContext,
  JavaMavenTestJvmExecution,
  JavaMavenTestJvmSetting,
} from "@ide/contracts";
import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { isJavaGradleSettings } from "@ide/contracts";
import type { JavaProjectContextChangeEvent, JavaProjectContextPort } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri } from "./errors";

const INVALID = "Invalid or uncorrelated Java project context.";
const MISSING_GRADLE_COMPOSITE_IDENTITY =
  "Gradle project context is missing the build root or logical project path required to identify this module. Update RefactorKit and synchronize again.";
const PROJECT_WATCH_EVENT = "ide://java-project-inputs-changed";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new Error(INVALID);
}
function isContextV5Plus(schemaVersion: unknown): boolean {
  return (
    schemaVersion === "java-project-context-v5" ||
    schemaVersion === "java-project-context-v6" ||
    schemaVersion === "java-project-context-v7"
  );
}
function isContextV6OrV7(schemaVersion: unknown): boolean {
  return schemaVersion === "java-project-context-v6" || schemaVersion === "java-project-context-v7";
}
function isContextV2ThroughV5(schemaVersion: unknown): boolean {
  return (
    schemaVersion === "java-project-context-v2" ||
    schemaVersion === "java-project-context-v3" ||
    schemaVersion === "java-project-context-v4" ||
    schemaVersion === "java-project-context-v5"
  );
}
function isJavaProjectContextSchemaVersion(
  value: unknown,
): value is JavaProjectContextSchemaVersion {
  return (
    value === "java-project-context-v1" ||
    value === "java-project-context-v2" ||
    value === "java-project-context-v3" ||
    value === "java-project-context-v4" ||
    value === "java-project-context-v5" ||
    value === "java-project-context-v6" ||
    value === "java-project-context-v7"
  );
}
function hasProviderQualifiedAssociation(schemaVersion: JavaProjectContextSchemaVersion) {
  return (
    schemaVersion === "java-project-context-v3" ||
    schemaVersion === "java-project-context-v4" ||
    isContextV5Plus(schemaVersion)
  );
}
function text(value: unknown, limit = 4096, empty = false): string {
  if (
    typeof value !== "string" ||
    (!empty && !value) ||
    value.length > limit ||
    value.includes("\0")
  )
    throw new Error(INVALID);
  return value;
}
function absolutePath(value: unknown): string {
  const path = text(value);
  if (!/^(\/|[A-Za-z]:[\\/])/.test(path)) throw new Error(INVALID);
  return path;
}
function relative(value: unknown, empty = false): string {
  const result = text(value, 4096, empty);
  if ((result || !empty) && (result.includes(":") || !isNormalizedWorkspaceRelativePath(result)))
    throw new Error(INVALID);
  return result;
}
function gradleBuildRoot(value: unknown): string {
  if (value === ".") return ".";
  return relative(value);
}
function gradleProjectPath(value: unknown): string {
  const result = text(value, 4096);
  if (!result.startsWith(":")) throw new Error(INVALID);
  const segments = result === ":" ? [] : result.slice(1).split(":");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        [...segment].some((character) => character.charCodeAt(0) < 32),
    )
  )
    throw new Error(INVALID);
  return result;
}
function hash(value: unknown): string {
  const result = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(INVALID);
  return result;
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(INVALID);
  return value;
}
function list<T>(value: unknown, limit: number, normalize: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(INVALID);
  return value.map(normalize);
}
const nullable = (value: unknown, limit = 4096) => (value === null ? null : text(value, limit));
const nullableText = (value: unknown, limit = 4096) =>
  value === null ? null : text(value, limit, true);
function availability(value: unknown): JavaProjectContextAvailability {
  if (
    value !== "complete" &&
    value !== "not-declared" &&
    value !== "partial" &&
    value !== "unavailable" &&
    value !== "ambiguous"
  )
    throw new Error(INVALID);
  return value;
}
function mavenFailsafeAvailability(value: unknown): JavaMavenFailsafeAvailability {
  return value === "not-applicable" ? value : availability(value);
}
function mavenTestJvmAvailability(value: unknown): JavaMavenTestJvmAvailability {
  return value === "not-applicable" ? value : availability(value);
}
function dependencyScope(value: unknown): JavaProjectDependencyScope | null {
  if (value === null) return null;
  if (
    value !== "compile" &&
    value !== "provided" &&
    value !== "runtime" &&
    value !== "test" &&
    value !== "system" &&
    value !== "custom"
  )
    throw new Error(INVALID);
  return value;
}
function artifactCoordinates(value: unknown, schemaVersion?: JavaProjectContextSchemaVersion) {
  const coordinates = object(value);
  if (isContextV5Plus(schemaVersion)) exactKeys(coordinates, ["groupId", "artifactId", "version"]);
  return {
    groupId: text(coordinates.groupId, 512),
    artifactId: text(coordinates.artifactId, 512),
    version: text(coordinates.version, 512),
  };
}
function resolvedArtifact(
  value: unknown,
  schemaVersion?: JavaProjectContextSchemaVersion,
): JavaProjectResolvedArtifact {
  const data = object(value);
  if (isContextV5Plus(schemaVersion))
    exactKeys(data, [
      "path",
      "coordinates",
      "extension",
      "classifier",
      "scope",
      "transitive",
      "fingerprint",
    ]);
  return {
    path: text(data.path, 8192, true),
    coordinates: artifactCoordinates(data.coordinates, schemaVersion),
    extension: text(data.extension, 64),
    classifier: nullable(data.classifier, 256),
    scope: dependencyScope(data.scope),
    transitive: (() => {
      if (typeof data.transitive !== "boolean") throw new Error(INVALID);
      return data.transitive;
    })(),
    fingerprint: nullable(data.fingerprint),
  };
}
function classpath(
  value: unknown,
  schemaVersion: JavaProjectContextSchemaVersion,
): JavaProjectClasspathEntry[] {
  return list(value, 4096, (item) => {
    const data = object(item);
    if (isContextV5Plus(schemaVersion))
      exactKeys(data, [
        "path",
        "providerId",
        "moduleId",
        "sourceSetId",
        "dependencyScope",
        "fingerprint",
        "artifact",
      ]);
    const dependencyScope = nullable(data.dependencyScope, 128);
    if (schemaVersion !== "java-project-context-v1") dependencyScopeValue(dependencyScope);
    const entry: JavaProjectClasspathEntry = {
      path: text(data.path),
      providerId: text(data.providerId, 1024),
      moduleId: text(data.moduleId, 1024),
      sourceSetId: text(data.sourceSetId, 1024),
      dependencyScope,
      fingerprint: nullable(data.fingerprint),
    };
    if (schemaVersion !== "java-project-context-v1") {
      if (!("artifact" in data)) throw new Error(INVALID);
      entry.artifact =
        data.artifact === null ? null : resolvedArtifact(data.artifact, schemaVersion);
    }
    return entry;
  });
}
function dependencyScopeValue(value: string | null): JavaProjectDependencyScope | null {
  if (
    value === null ||
    value === "compile" ||
    value === "provided" ||
    value === "runtime" ||
    value === "test" ||
    value === "system" ||
    value === "custom"
  )
    return value;
  throw new Error(INVALID);
}
function sourceRootEvidence(value: unknown, schemaVersion?: JavaProjectContextSchemaVersion) {
  return list(value, 4096, (item) => {
    const data = object(item);
    if (isContextV5Plus(schemaVersion))
      exactKeys(data, [
        "path",
        "origin",
        "providerId",
        "descriptorPath",
        "profileId",
        "pluginId",
        "executionId",
        "goal",
        "phase",
        "availability",
      ]);
    const origin = data.origin;
    if (
      origin !== "conventional" &&
      origin !== "build-descriptor" &&
      origin !== "build-plugin" &&
      origin !== "generated"
    )
      throw new Error(INVALID);
    return {
      path: text(data.path, 8192, true),
      origin: origin as JavaProjectSourceRootEvidence["origin"],
      providerId: text(data.providerId, 128, true),
      descriptorPath: nullable(data.descriptorPath, 256),
      profileId: nullable(data.profileId, 256),
      pluginId: nullable(data.pluginId, 256),
      executionId: nullable(data.executionId, 256),
      goal: nullable(data.goal, 256),
      phase: nullable(data.phase, 256),
      availability: availability(data.availability),
    };
  });
}
function mavenFailsafe(value: unknown): JavaMavenFailsafeContext {
  const data = object(value);
  exactKeys(data, ["availability", "refusalCode", "executions"]);
  const result: JavaMavenFailsafeContext = {
    availability: mavenFailsafeAvailability(data.availability),
    refusalCode: nullable(data.refusalCode, 128),
    executions: list(data.executions, 16, (item) => {
      const execution = object(item);
      exactKeys(execution, [
        "pluginId",
        "pluginVersion",
        "executionId",
        "goals",
        "phase",
        "profileId",
        "selectors",
        "reports",
        "availability",
        "refusalCode",
      ]);
      const configuredValues = (raw: unknown) =>
        list(raw, 128, (configuredValue) => {
          const setting = object(configuredValue);
          exactKeys(setting, ["name", "value", "origin", "availability"]);
          if (
            ![
              "test",
              "includes",
              "excludes",
              "includesFile",
              "excludesFile",
              "suiteXmlFiles",
              "reportsDirectory",
              "reportFormat",
              "reportNameSuffix",
              "summaryFile",
            ].includes(String(setting.name))
          )
            throw new Error(INVALID);
          return {
            name: text(setting.name, 128),
            value: nullableText(setting.value, 8192),
            origin: text(setting.origin, 512),
            availability: mavenFailsafeAvailability(setting.availability),
          };
        });
      const normalized = {
        pluginId: text(execution.pluginId, 256),
        pluginVersion: nullable(execution.pluginVersion, 128),
        executionId: nullable(execution.executionId, 256),
        goals: list(execution.goals, 32, (goal) => text(goal, 256)),
        phase: nullable(execution.phase, 256),
        profileId: nullable(execution.profileId, 256),
        selectors: configuredValues(execution.selectors),
        reports: configuredValues(execution.reports),
        availability: mavenFailsafeAvailability(execution.availability),
        refusalCode: nullable(execution.refusalCode, 128),
      };
      if (
        normalized.pluginId !== "org.apache.maven.plugins:maven-failsafe-plugin" ||
        (normalized.availability === "complete" &&
          (!normalized.pluginVersion ||
            !normalized.executionId ||
            !normalized.phase ||
            !normalized.goals.includes("integration-test") ||
            normalized.refusalCode !== null)) ||
        (normalized.availability !== "complete" &&
          normalized.availability !== "not-applicable" &&
          normalized.refusalCode === null)
      )
        throw new Error(INVALID);
      return normalized;
    }),
  };
  if (
    (result.availability === "complete" &&
      (result.refusalCode !== null ||
        result.executions.length !== 1 ||
        result.executions[0]?.availability !== "complete")) ||
    (result.availability === "not-declared" &&
      (result.refusalCode !== null || result.executions.length !== 0)) ||
    (result.availability === "not-applicable" &&
      (result.refusalCode !== null || result.executions.length !== 0)) ||
    ((result.availability === "ambiguous" ||
      result.availability === "partial" ||
      result.availability === "unavailable") &&
      result.refusalCode === null)
  )
    throw new Error(INVALID);
  return result;
}
function mavenTestJvmSetting(value: unknown): JavaMavenTestJvmSetting {
  const data = object(value);
  exactKeys(data, ["name", "value", "origin", "availability", "redacted"]);
  if (
    data.name !== "forkCount" &&
    data.name !== "forkMode" &&
    data.name !== "reuseForks" &&
    data.name !== "argLine"
  )
    throw new Error(INVALID);
  if (typeof data.redacted !== "boolean") throw new Error(INVALID);
  return {
    name: data.name,
    value: nullableText(data.value, 16_384),
    origin: text(data.origin, 8192, true),
    availability: mavenTestJvmAvailability(data.availability),
    redacted: data.redacted,
  };
}
function mavenTestJvm(value: unknown): JavaMavenTestJvmContext {
  const data = object(value);
  exactKeys(data, ["availability", "mode", "refusalCode", "executions"]);
  const factAvailability = mavenTestJvmAvailability(data.availability);
  const mode = data.mode;
  if (
    mode !== "forked" &&
    mode !== "in-process" &&
    mode !== "ambiguous" &&
    mode !== "unknown" &&
    mode !== "mixed"
  )
    throw new Error(INVALID);
  const executions = list(data.executions, 16, (item): JavaMavenTestJvmExecution => {
    const execution = object(item);
    exactKeys(execution, [
      "pluginId",
      "pluginVersion",
      "executionId",
      "goals",
      "phase",
      "mode",
      "availability",
      "refusalCode",
      "forkSettings",
      "argLineLayers",
      "effectiveArgLineTemplate",
    ]);
    const executionMode = execution.mode;
    if (
      executionMode !== "forked" &&
      executionMode !== "in-process" &&
      executionMode !== "ambiguous" &&
      executionMode !== "unknown"
    )
      throw new Error(INVALID);
    if (
      execution.availability !== "complete" &&
      execution.availability !== "partial" &&
      execution.availability !== "unavailable" &&
      execution.availability !== "ambiguous"
    )
      throw new Error(INVALID);
    const executionAvailability: JavaMavenTestJvmExecution["availability"] = execution.availability;
    const normalized = {
      pluginId: text(execution.pluginId, 512, true),
      pluginVersion: nullable(execution.pluginVersion, 128),
      executionId: nullable(execution.executionId, 512),
      goals: list(execution.goals, 32, (goal) => text(goal, 128, true)),
      phase: nullable(execution.phase, 128),
      mode: executionMode,
      availability: executionAvailability,
      refusalCode: nullable(execution.refusalCode, 128),
      forkSettings: list(execution.forkSettings, 16, mavenTestJvmSetting),
      argLineLayers: list(execution.argLineLayers, 16, mavenTestJvmSetting),
      effectiveArgLineTemplate: nullableText(execution.effectiveArgLineTemplate, 16_384),
    } satisfies JavaMavenTestJvmExecution;
    if (
      (normalized.availability === "complete" &&
        (normalized.refusalCode !== null || !normalized.pluginId)) ||
      (normalized.availability !== "complete" && normalized.refusalCode === null)
    )
      throw new Error(INVALID);
    return normalized;
  });
  const refusalCode = nullable(data.refusalCode, 128);
  if (
    (factAvailability === "complete" &&
      (refusalCode !== null ||
        executions.length === 0 ||
        executions.some((item) => item.availability !== "complete"))) ||
    (factAvailability === "not-declared" && (refusalCode !== null || executions.length !== 0)) ||
    (factAvailability === "not-applicable" && (refusalCode !== null || executions.length !== 0)) ||
    ((factAvailability === "partial" ||
      factAvailability === "unavailable" ||
      factAvailability === "ambiguous") &&
      refusalCode === null)
  )
    throw new Error(INVALID);
  return { availability: factAvailability, mode, refusalCode, executions };
}
function jpms(value: unknown, schemaVersion: JavaProjectContextSchemaVersion) {
  const data = object(value);
  if (isContextV5Plus(schemaVersion))
    exactKeys(data, ["availability", "modulePath", "descriptors", "refusalCode"]);
  const reportedAvailability = availability(data.availability);
  const descriptors = list(data.descriptors, 16, (item) => {
      const descriptor = object(item);
      if (isContextV5Plus(schemaVersion)) {
        exactKeys(descriptor, [
          "path",
          "moduleName",
          "open",
          "requires",
          "exports",
          "opens",
          "uses",
          "provides",
          "contentSha256",
        ]);
      }
      return {
        path: text(descriptor.path, 8192, true),
        moduleName: text(descriptor.moduleName, 512, true),
        open: (() => {
          if (typeof descriptor.open !== "boolean") throw new Error(INVALID);
          return descriptor.open;
        })(),
        requires: list(descriptor.requires, 1024, (requirement) => {
          const required = object(requirement);
          if (isContextV5Plus(schemaVersion)) exactKeys(required, ["moduleName", "modifiers"]);
          return {
            moduleName: text(required.moduleName, 512, true),
            modifiers: list(required.modifiers, 2, (modifier) => {
              if (modifier !== "static" && modifier !== "transitive") throw new Error(INVALID);
              return modifier;
            }),
          };
        }),
        exports: list(descriptor.exports, 1024, (exported) => {
          const itemData = object(exported);
          if (isContextV5Plus(schemaVersion)) exactKeys(itemData, ["packageName", "targets"]);
          return {
            packageName: text(itemData.packageName, 1024, true),
            targets: list(itemData.targets, 1024, (target) => text(target, 512, true)),
          };
        }),
        opens: list(descriptor.opens ?? [], 1024, (opened) => {
          const itemData = object(opened);
          if (isContextV5Plus(schemaVersion)) exactKeys(itemData, ["packageName", "targets"]);
          return {
            packageName: text(itemData.packageName, 1024, true),
            targets: list(itemData.targets, 1024, (target) => text(target, 512, true)),
          };
        }),
        uses: list(descriptor.uses ?? [], 1024, (serviceType) => text(serviceType, 1024, true)),
        provides: list(descriptor.provides ?? [], 1024, (provider) => {
          const itemData = object(provider);
          if (isContextV5Plus(schemaVersion))
            exactKeys(itemData, ["serviceName", "implementations"]);
          return {
            serviceType: text(
              isContextV5Plus(schemaVersion) ? itemData.serviceName : itemData.serviceType,
              1024,
              true,
            ),
            implementations: list(itemData.implementations, 1024, (implementation) =>
              text(implementation, 1024, true),
            ),
          };
        }),
        unreportedDirectives: (["opens", "uses", "provides"] as const).filter(
          (directive) => !Array.isArray(descriptor[directive]),
        ),
        contentSha256: hash(descriptor.contentSha256),
      };
    }),
    omittedDirectives = descriptors.some(
      (descriptor) => descriptor.unreportedDirectives.length > 0,
    ),
    providerCode = nullable(data.refusalCode, 128);
  return {
    availability:
      reportedAvailability === "complete" && omittedDirectives ? "partial" : reportedAvailability,
    modulePath: list(data.modulePath, 4096, (item) => {
      const entry = object(item);
      if (isContextV5Plus(schemaVersion)) exactKeys(entry, ["path", "moduleNames", "fingerprint"]);
      return {
        path: text(entry.path, 8192, true),
        moduleNames: list(entry.moduleNames, 4096, (name) => text(name, 512, true)),
        fingerprint: nullable(entry.fingerprint),
      };
    }),
    descriptors,
    refusalCode:
      reportedAvailability === "complete" && omittedDirectives
        ? (providerCode ?? "java.context.jpmsDirectivesNotReported")
        : providerCode,
  };
}
function annotationProcessors(value: unknown, schemaVersion?: JavaProjectContextSchemaVersion) {
  const data = object(value),
    options = object(data.options);
  if (isContextV5Plus(schemaVersion))
    exactKeys(data, [
      "availability",
      "processorPath",
      "dependencies",
      "processorNames",
      "options",
      "mode",
      "refusalCode",
    ]);
  if (Object.keys(options).length > 256) throw new Error(INVALID);
  const normalizedOptions: Record<string, string> = {};
  for (const [key, option] of Object.entries(options)) {
    if (
      key.length > 512 ||
      typeof option !== "string" ||
      option.length > 16_384 ||
      option.includes("\0")
    )
      throw new Error(INVALID);
    normalizedOptions[key] = option;
  }
  return {
    availability: availability(data.availability),
    processorPath: list(data.processorPath, 256, (path) => text(path, 8192, true)),
    dependencies: list(data.dependencies, 256, (artifact) =>
      resolvedArtifact(artifact, schemaVersion),
    ),
    processorNames: list(data.processorNames, 256, (name) => text(name, 512, true)),
    options: normalizedOptions,
    mode: nullable(data.mode, 128),
    refusalCode: nullable(data.refusalCode, 128),
  };
}
function sourceSet(
  value: unknown,
  schemaVersion: JavaProjectContextSchemaVersion,
): JavaProjectSourceSet {
  const data = object(value);
  if (isContextV5Plus(schemaVersion))
    exactKeys(data, [
      "id",
      "kind",
      "sourceLevel",
      "release",
      "sourceRoots",
      "generatedSourceRoots",
      "outputDirectories",
      "analysisSourceRoots",
      "compileClasspath",
      "runtimeClasspath",
      "moduleDependencies",
      "sourceRootEvidence",
      "compilerOptionsAvailability",
      "compilerOptionsRefusalCode",
      "compilerOptions",
      "resolvedArtifactAvailability",
      "resolvedArtifactRefusalCode",
      "resolvedArtifacts",
      "annotationProcessors",
      "jpms",
      "mavenFailsafe",
      ...(schemaVersion === "java-project-context-v7" ? ["mavenTestJvm"] : []),
    ]);
  const kind = text(data.kind, 128);
  if (kind !== "main" && kind !== "test" && kind !== "integration-test" && kind !== "custom")
    throw new Error(INVALID);
  const maximumSourceLevel = isContextV6OrV7(schemaVersion)
    ? 27
    : isContextV2ThroughV5(schemaVersion)
      ? 25
      : 100;
  const result: JavaProjectSourceSet = {
    id: text(data.id, 1024),
    kind,
    sourceLevel: integer(data.sourceLevel, 8, maximumSourceLevel),
    release:
      data.release === null
        ? null
        : integer(data.release, 8, maximumSourceLevel),
    sourceRoots: list(data.sourceRoots, 256, (v) => relative(v, true)),
    generatedSourceRoots: list(data.generatedSourceRoots, 256, (v) => relative(v, true)),
    outputDirectories: list(data.outputDirectories, 256, (v) => relative(v, true)),
    analysisSourceRoots: list(
      data.analysisSourceRoots,
      isContextV5Plus(schemaVersion) ? 16_384 : 4096,
      (v) => relative(v, true),
    ),
    compileClasspath: classpath(data.compileClasspath, schemaVersion),
    runtimeClasspath: classpath(data.runtimeClasspath, schemaVersion),
    moduleDependencies: list(
      data.moduleDependencies,
      isContextV5Plus(schemaVersion) ? 1024 : 256,
      (item) => {
        const edge = object(item);
        if (isContextV5Plus(schemaVersion)) exactKeys(edge, ["moduleId", "scope"]);
        const rawScope = text(edge.scope, 128);
        const scope = isContextV5Plus(schemaVersion) ? dependencyScopeValue(rawScope) : rawScope;
        if (scope === null) throw new Error(INVALID);
        return { moduleId: text(edge.moduleId, 1024), scope };
      },
    ),
  };
  if (schemaVersion !== "java-project-context-v1") {
    result.sourceRootEvidence = sourceRootEvidence(data.sourceRootEvidence, schemaVersion);
    result.compilerOptionsAvailability = availability(data.compilerOptionsAvailability);
    result.compilerOptionsRefusalCode = nullable(data.compilerOptionsRefusalCode, 128);
    result.compilerOptions = list(data.compilerOptions, 1024, (item) => {
      const option = object(item);
      if (isContextV5Plus(schemaVersion))
        exactKeys(option, ["name", "value", "origin", "redacted"]);
      if (typeof option.redacted !== "boolean") throw new Error(INVALID);
      return {
        name: text(option.name, 256, true),
        value: text(option.value, 16_384, true),
        origin: text(option.origin, 512, true),
        redacted: option.redacted,
      };
    });
    result.resolvedArtifactAvailability = availability(data.resolvedArtifactAvailability);
    result.resolvedArtifactRefusalCode = nullable(data.resolvedArtifactRefusalCode, 128);
    result.resolvedArtifacts = list(data.resolvedArtifacts, 16_384, (artifact) =>
      resolvedArtifact(artifact, schemaVersion),
    );
    result.annotationProcessors = annotationProcessors(data.annotationProcessors, schemaVersion);
    result.jpms = jpms(data.jpms, schemaVersion);
  }
  if (Object.prototype.hasOwnProperty.call(data, "mavenFailsafe")) {
    if (schemaVersion !== "java-project-context-v4" && !isContextV5Plus(schemaVersion))
      throw new Error(INVALID);
    result.mavenFailsafe = mavenFailsafe(data.mavenFailsafe);
  }
  if (isContextV5Plus(schemaVersion) && result.mavenFailsafe === undefined)
    throw new Error(INVALID);
  if (schemaVersion === "java-project-context-v7") {
    if (data.mavenTestJvm === undefined) throw new Error(INVALID);
    result.mavenTestJvm = mavenTestJvm(data.mavenTestJvm);
  }
  return result;
}
function context(value: unknown, gradleAuthorized: boolean): JavaEffectiveProjectContext {
  const data = object(value);
  if (
    !isJavaProjectContextSchemaVersion(data.schemaVersion) ||
    !["available", "partial"].includes(String(data.status)) ||
    data.refusal !== null
  )
    throw new Error(INVALID);
  const schemaVersion = data.schemaVersion;
  if (isContextV5Plus(schemaVersion))
    exactKeys(data, [
      "schemaVersion",
      "status",
      "snapshotHash",
      "contextHash",
      "sdk",
      "providers",
      "modules",
      "buildEvidence",
      "selectedSource",
      "analysis",
      ...(isContextV6OrV7(schemaVersion) ? ["semanticAnalysis"] : []),
      "refusal",
    ]);
  const snapshotHash = hash(data.snapshotHash);
  const sdk = list(data.sdk, isContextV5Plus(schemaVersion) ? 18 : 100, (item) => {
    const entry = object(item);
    if (isContextV5Plus(schemaVersion))
      exactKeys(entry, [
        "home",
        "sourceRelease",
        "platformRelease",
        "identitySha256",
        "releaseMetadataSha256",
        "signatureArchive",
        "signatureArchiveSha256",
      ]);
    const sourceRelease = integer(
      entry.sourceRelease,
      8,
      schemaVersion === "java-project-context-v1" ? 100 : 27,
    );
    if (isContextV2ThroughV5(schemaVersion) && sourceRelease === 26) throw new Error(INVALID);
    return {
      home: text(entry.home),
      sourceRelease,
      platformRelease: integer(entry.platformRelease, 8, 100),
      identitySha256: hash(entry.identitySha256),
      releaseMetadataSha256: hash(entry.releaseMetadataSha256),
      signatureArchive: text(entry.signatureArchive),
      signatureArchiveSha256: hash(entry.signatureArchiveSha256),
    };
  });
  const providers = list(data.providers, isContextV5Plus(schemaVersion) ? 16 : 32, (item) => {
    const provider = object(item);
    if (isContextV5Plus(schemaVersion))
      exactKeys(provider, [
        "providerId",
        "status",
        "strategy",
        "buildCodeExecution",
        "credentialsAccess",
        "networkAccess",
        "diagnostics",
      ]);
    const result = {
      providerId: text(provider.providerId, 1024),
      status: text(provider.status, 128),
      strategy: text(provider.strategy, 256, true),
      buildCodeExecution: text(provider.buildCodeExecution, 128),
      credentialsAccess: text(provider.credentialsAccess, 128),
      networkAccess: text(provider.networkAccess, 128),
      diagnostics: list(provider.diagnostics, isContextV5Plus(schemaVersion) ? 500 : 4096, (v) =>
        text(v, 1024),
      ),
    };
    if (
      isContextV5Plus(schemaVersion) &&
      !["available", "partial", "offline-missing", "unavailable", "execution-refused"].includes(
        result.status,
      )
    )
      throw new Error(INVALID);
    if (
      !(
        result.buildCodeExecution === "denied" &&
        result.credentialsAccess === "denied" &&
        result.networkAccess === "denied"
      ) &&
      !(
        gradleAuthorized &&
        result.providerId === "gradle-effective-v1" &&
        result.buildCodeExecution === "allowed-explicit" &&
        result.credentialsAccess === "build-controlled" &&
        result.networkAccess === "offline-resolution"
      )
    )
      throw new Error(INVALID);
    return result;
  });
  const modules = list(data.modules, 1024, (item) => {
    const module = object(item);
    const providerId = text(module.providerId, 1024);
    const hasBuildRoot = Object.prototype.hasOwnProperty.call(module, "buildRoot");
    const hasProjectPath = Object.prototype.hasOwnProperty.call(module, "projectPath");
    if (isContextV5Plus(schemaVersion))
      exactKeys(module, [
        "providerId",
        "id",
        "name",
        "root",
        "sourceSets",
        "coordinates",
        ...(hasBuildRoot ? ["buildRoot"] : []),
        ...(hasProjectPath ? ["projectPath"] : []),
      ]);
    const result: JavaProjectModule = {
      providerId,
      id: text(module.id, 1024),
      name: text(module.name, 1024),
      root: relative(module.root, true),
      ...(Object.prototype.hasOwnProperty.call(module, "coordinates")
        ? {
            coordinates:
              module.coordinates === null
                ? null
                : artifactCoordinates(module.coordinates, schemaVersion),
          }
        : {}),
      sourceSets: list(module.sourceSets, 64, (sourceSetValue) =>
        sourceSet(sourceSetValue, schemaVersion),
      ),
    };
    if (hasProviderQualifiedAssociation(schemaVersion) && providerId === "gradle-effective-v1") {
      if (!hasBuildRoot || !hasProjectPath) throw new Error(MISSING_GRADLE_COMPOSITE_IDENTITY);
      result.buildRoot = gradleBuildRoot(module.buildRoot);
      result.projectPath = gradleProjectPath(module.projectPath);
    } else if (hasBuildRoot || hasProjectPath) throw new Error(INVALID);
    const failsafeFacts = result.sourceSets.flatMap((sourceSet) =>
      sourceSet.mavenFailsafe ? [sourceSet.mavenFailsafe] : [],
    );
    if (
      (failsafeFacts.length > 0 &&
        schemaVersion !== "java-project-context-v4" &&
        !isContextV5Plus(schemaVersion)) ||
      (providerId === "maven-effective-v1" &&
        failsafeFacts.some((facts) => facts.availability === "not-applicable")) ||
      (providerId !== "maven-effective-v1" &&
        failsafeFacts.some((facts) => facts.availability !== "not-applicable"))
    )
      throw new Error(INVALID);
    return result;
  });
  const providerIds = new Set(providers.map((p) => p.providerId));
  if (providerIds.size !== providers.length) throw new Error(INVALID);
  const moduleIds = new Set<string>();
  const gradleProjects = new Set<string>();
  for (const module of modules) {
    if (!providerIds.has(module.providerId) || moduleIds.has(`${module.providerId}/${module.id}`))
      throw new Error(INVALID);
    moduleIds.add(`${module.providerId}/${module.id}`);
    if (module.buildRoot !== undefined && module.projectPath !== undefined) {
      const identity = `${module.buildRoot}\0${module.projectPath}`;
      if (gradleProjects.has(identity)) throw new Error(INVALID);
      gradleProjects.add(identity);
    }
    const sets = new Set<string>();
    for (const set of module.sourceSets) {
      if (sets.has(set.id)) throw new Error(INVALID);
      sets.add(set.id);
    }
  }
  for (const module of modules)
    for (const set of module.sourceSets) {
      for (const entry of [...set.compileClasspath, ...set.runtimeClasspath]) {
        if (
          !modules.some(
            (owner) =>
              owner.providerId === entry.providerId &&
              owner.id === entry.moduleId &&
              owner.sourceSets.some((source) => source.id === entry.sourceSetId),
          )
        )
          throw new Error(INVALID);
      }
    }
  const analysis =
    data.analysis === null
      ? null
      : (() => {
          const raw = object(data.analysis),
            identities = object(raw.platformIdentitiesByRelease);
          if (isContextV5Plus(schemaVersion))
            exactKeys(raw, [
              "backend",
              "snapshotHash",
              "platformIdentitiesByRelease",
              "warningCount",
            ]);
          if (
            raw.backend !== "eclipse-jdt" ||
            hash(raw.snapshotHash) !== snapshotHash ||
            Object.keys(identities).length > 100
          )
            throw new Error(INVALID);
          const platformIdentitiesByRelease: Record<string, string> = {};
          for (const [release, identity] of Object.entries(identities)) {
            if (!/^\d{1,3}$/.test(release)) throw new Error(INVALID);
            platformIdentitiesByRelease[release] = hash(identity);
          }
          return {
            backend: "eclipse-jdt",
            snapshotHash,
            platformIdentitiesByRelease,
            warningCount: integer(raw.warningCount),
          };
        })();
  const metadataOnlySourceSelection =
    data.selectedSource === null ||
    (schemaVersion === "java-project-context-v7" &&
      (() => {
        const selected = object(data.selectedSource);
        return (
          selected.evidence === "SOURCE_ROOT_OWNERSHIP" &&
          selected.symbol === null &&
          selected.bindingKey === null
        );
      })());
  const semanticAnalysisValue = data.semanticAnalysis;
  const semanticAnalysis = isContextV6OrV7(schemaVersion)
    ? ((): NonNullable<JavaEffectiveProjectContext["semanticAnalysis"]> => {
        const semanticData = object(semanticAnalysisValue);
        exactKeys(semanticData, ["availability", "refusalCode"]);
        const refusalCode = nullable(semanticData.refusalCode, 128);
        if (semanticData.availability === "available" && refusalCode === null && analysis !== null)
          return { availability: "available", refusalCode: null };
        if (
          semanticData.availability === "unqualified" &&
          refusalCode === "java.context.sourceAnalysisUnqualified" &&
          analysis === null &&
          metadataOnlySourceSelection
        )
          return {
            availability: "unqualified",
            refusalCode: "java.context.sourceAnalysisUnqualified",
          };
        else throw new Error(INVALID);
      })()
    : undefined;
  const metadataOnlyContext =
    isContextV6OrV7(schemaVersion) &&
    semanticAnalysis?.availability === "unqualified" &&
    analysis === null;
  if (isContextV6OrV7(schemaVersion) && semanticAnalysis === undefined) throw new Error(INVALID);
  if (
    data.status === "available" &&
    ((!analysis && !metadataOnlyContext) ||
      !sdk.length ||
      !providers.length ||
      !modules.length ||
      providers.some(
        (p) =>
          !["maven-effective-v1", "gradle-effective-v1", "java-declared-v1"].includes(
            p.providerId,
          ) || p.status !== "available",
      ))
  )
    throw new Error(INVALID);
  const selectedSource =
    data.selectedSource === null
      ? null
      : (() => {
          const selected = object(data.selectedSource);
          if (isContextV5Plus(schemaVersion))
            exactKeys(selected, [
              "path",
              "symbol",
              "providerId",
              "moduleId",
              "sourceSetId",
              "sourceRoot",
              "generated",
              "bindingKey",
              "evidence",
            ]);
          if (typeof selected.generated !== "boolean") throw new Error(INVALID);
          if (
            hasProviderQualifiedAssociation(schemaVersion) !==
            Object.prototype.hasOwnProperty.call(selected, "providerId")
          )
            throw new Error(INVALID);
          const source = {
            path: relative(selected.path),
            symbol: nullable(selected.symbol, 1024),
            ...(hasProviderQualifiedAssociation(schemaVersion)
              ? { providerId: text(selected.providerId, 128) }
              : {}),
            moduleId: text(selected.moduleId, 1024),
            sourceSetId: text(selected.sourceSetId, 1024),
            sourceRoot: relative(selected.sourceRoot, true),
            generated: selected.generated,
            bindingKey: nullable(selected.bindingKey),
            evidence: (() => {
              if (
                isContextV5Plus(schemaVersion) &&
                selected.evidence !== "JDT_BINDING" &&
                selected.evidence !== "SOURCE_ROOT_OWNERSHIP"
              )
                throw new Error(INVALID);
              return text(selected.evidence, 128);
            })(),
          };
          const owners = modules.filter(
            (m) =>
              (!hasProviderQualifiedAssociation(schemaVersion) ||
                m.providerId === source.providerId) &&
              m.id === source.moduleId &&
              m.sourceSets.some((s) => s.id === source.sourceSetId),
          );
          if (owners.length !== 1) throw new Error(INVALID);
          return source;
        })();
  return {
    schemaVersion,
    status: data.status as "available" | "partial",
    snapshotHash,
    contextHash: hash(data.contextHash),
    sdk,
    providers,
    modules,
    buildEvidence: list(data.buildEvidence, 16384, (item) => {
      const entry = object(item);
      if (isContextV5Plus(schemaVersion)) exactKeys(entry, ["path", "kind", "fingerprint"]);
      return {
        path: text(entry.path),
        kind: text(entry.kind, 128),
        fingerprint: text(entry.fingerprint),
      };
    }),
    selectedSource,
    analysis,
    ...(semanticAnalysis ? { semanticAnalysis } : {}),
    refusal: null,
  };
}
export function normalizeJavaProjectContext(
  value: unknown,
  request: JavaProjectContextRequest,
): JavaProjectContextResult {
  const data = object(value);
  if (
    data.workspaceId !== request.workspaceId ||
    data.generation !== request.generation ||
    data.requestId !== request.requestId ||
    data.projectPath !== request.projectPath
  )
    throw new Error(INVALID);
  const correlation = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    projectPath: request.projectPath,
  };
  if (data.status === "unavailable" || data.status === "refused") {
    const code = text(data.code, 256);
    const cause = data.gradleFailureCause;
    const gradleFailureCause =
      request.evaluateGradle === true &&
      data.status === "refused" &&
      code === "gradle.sync.exportFailed" &&
      typeof cause === "string" &&
      cause.length <= 128 &&
      /^gradle\.sync\.cause\.[A-Za-z][A-Za-z0-9]*$/u.test(cause)
        ? cause
        : undefined;
    return {
      ...correlation,
      status: data.status,
      message: text(data.message, 4096),
      code,
      ...(gradleFailureCause ? { gradleFailureCause } : {}),
    };
  }
  const contextData = object(data.context);
  let gradleSync: JavaProjectContextResult["gradleSync"];
  if (data.gradleSync !== undefined) {
    const receipt = object(data.gradleSync);
    const baseReceiptKeys = [
      "schemaVersion",
      "status",
      "providerId",
      "snapshotHash",
      "gradleVersion",
      "sdkHome",
    ] as const;
    if (isContextV5Plus(contextData.schemaVersion))
      exactKeys(
        receipt,
        isContextV6OrV7(contextData.schemaVersion)
          ? [...baseReceiptKeys, "gradleRuntimeHome"]
          : baseReceiptKeys,
      );
    if (
      !isJavaGradleSettings(request.gradle) ||
      receipt.schemaVersion !== "java-gradle-sync-v1" ||
      receipt.status !== "synchronized" ||
      receipt.providerId !== "gradle-effective-v1"
    )
      throw new Error(INVALID);
    gradleSync = {
      schemaVersion: "java-gradle-sync-v1",
      status: "synchronized",
      providerId: "gradle-effective-v1",
      snapshotHash: hash(receipt.snapshotHash),
      gradleVersion: text(receipt.gradleVersion, 128),
      sdkHome: text(receipt.sdkHome),
      ...(receipt.gradleRuntimeHome !== undefined
        ? { gradleRuntimeHome: absolutePath(receipt.gradleRuntimeHome) }
        : {}),
    };
  }
  const normalized = context(contextData, Boolean(gradleSync));
  const expectsProviderQualifiedContext =
    request.providerId !== undefined ||
    request.aggregateGradleCompositeContext === true ||
    isContextV6OrV7(normalized.schemaVersion);
  if (
    expectsProviderQualifiedContext !== hasProviderQualifiedAssociation(normalized.schemaVersion) ||
    (request.sourceSetKind !== undefined &&
      normalized.schemaVersion !== "java-project-context-v4" &&
      !isContextV5Plus(normalized.schemaVersion))
  )
    throw new Error(INVALID);
  if (
    normalized.status === "available" &&
    request.moduleId !== undefined &&
    (request.sourceSetId !== undefined || request.sourceSetKind !== undefined)
  ) {
    const selectedScopes = normalized.modules.filter(
      (module) =>
        module.id === request.moduleId &&
        (!request.providerId || module.providerId === request.providerId) &&
        module.sourceSets.some((sourceSet) =>
          request.sourceSetKind !== undefined
            ? sourceSet.kind === request.sourceSetKind
            : sourceSet.id === request.sourceSetId,
        ),
    );
    if (selectedScopes.length !== 1) throw new Error(INVALID);
  }
  if (normalized.providers.some((p) => p.providerId === "gradle-effective-v1") && !gradleSync)
    throw new Error(INVALID);
  // The native session retains the provider's original evaluation receipt. A
  // source-only refresh can change the current snapshot without re-running Gradle.
  // An explicit evaluation must attest the snapshot returned by that operation.
  if (
    gradleSync &&
    ((request.evaluateGradle === true && gradleSync.snapshotHash !== normalized.snapshotHash) ||
      normalized.sdk.some((sdk) => sdk.home !== gradleSync.sdkHome))
  )
    throw new Error(INVALID);
  if (
    data.status !== normalized.status ||
    (request.expectedSnapshotHash && normalized.snapshotHash !== request.expectedSnapshotHash) ||
    (request.expectedContextHash && normalized.contextHash !== request.expectedContextHash)
  )
    throw new Error(INVALID);
  if (!request.sourceRelativePath && !request.symbol && normalized.selectedSource)
    throw new Error(INVALID);
  if (request.sourceRelativePath || request.symbol) {
    const selected = normalized.selectedSource;
    if (
      !selected ||
      (request.moduleId && selected.moduleId !== request.moduleId) ||
      (request.sourceSetId && selected.sourceSetId !== request.sourceSetId) ||
      (request.providerId && selected.providerId !== request.providerId) ||
      (request.providerId && !hasProviderQualifiedAssociation(normalized.schemaVersion)) ||
      (request.symbol && selected.symbol !== request.symbol) ||
      (request.symbol && (selected.evidence !== "JDT_BINDING" || !selected.bindingKey))
    )
      throw new Error(INVALID);
    if (
      request.sourceRelativePath &&
      selected.path !==
        `${selected.sourceRoot ? selected.sourceRoot + "/" : ""}${request.sourceRelativePath}`
    )
      throw new Error(INVALID);
    const owner = normalized.modules
      .find(
        (module) =>
          module.id === selected.moduleId &&
          (!selected.providerId || module.providerId === selected.providerId) &&
          module.sourceSets.some((set) => set.id === selected.sourceSetId),
      )
      ?.sourceSets.find((set) => set.id === selected.sourceSetId);
    if (
      !owner ||
      (request.sourceSetKind !== undefined && owner.kind !== request.sourceSetKind) ||
      !(selected.generated ? owner.generatedSourceRoots : owner.sourceRoots).includes(
        selected.sourceRoot,
      )
    )
      throw new Error(INVALID);
  }
  if (request.requiredFacts?.includes("jpms")) {
    const selectedSets =
      request.moduleId && request.sourceSetId
        ? normalized.modules.flatMap((module) =>
            module.id === request.moduleId &&
            (!request.providerId || module.providerId === request.providerId)
              ? module.sourceSets.filter((sourceSet) => sourceSet.id === request.sourceSetId)
              : [],
          )
        : normalized.modules.flatMap((module) => module.sourceSets);
    const scopeIsUnambiguous =
      !request.moduleId || !request.sourceSetId || selectedSets.length === 1;
    const jpmsIsComplete =
      scopeIsUnambiguous &&
      selectedSets.length > 0 &&
      selectedSets.every(
        (sourceSet) =>
          sourceSet.jpms &&
          (sourceSet.jpms.availability === "complete" ||
            sourceSet.jpms.availability === "not-declared"),
      );
    if (!jpmsIsComplete)
      return {
        ...correlation,
        status: "refused",
        code: "java.context.requiredFactIncomplete",
        message: "The requested JPMS facts are incomplete or ambiguous.",
      };
  }
  return {
    ...correlation,
    status: normalized.status,
    context: normalized,
    engineVersion: text(data.engineVersion, 128),
    ...(gradleSync ? { gradleSync } : {}),
  };
}

export class TauriJavaProjectContextAdapter implements JavaProjectContextPort {
  async query(request: JavaProjectContextRequest) {
    const requiredFacts = request.requiredFacts;
    const aggregateGradleContext = request.aggregateGradleCompositeContext;
    const sourceSetSelectorCount =
      Number(request.sourceSetId !== undefined) + Number(request.sourceSetKind !== undefined);
    if (
      (request.gradle !== undefined && !isJavaGradleSettings(request.gradle)) ||
      (request.evaluateGradle !== undefined &&
        (request.evaluateGradle !== true || !request.gradle)) ||
      (request.moduleId === undefined) !== (sourceSetSelectorCount === 0) ||
      sourceSetSelectorCount > 1 ||
      (request.providerId !== undefined &&
        (request.moduleId === undefined || !text(request.providerId, 128))) ||
      (request.sourceSetKind !== undefined &&
        (request.providerId !== "maven-effective-v1" ||
          !["main", "test", "integration-test", "custom"].includes(request.sourceSetKind))) ||
      (request.moduleId !== undefined && (!request.moduleId || request.moduleId.length > 1024)) ||
      (request.sourceSetId !== undefined &&
        (!request.sourceSetId || request.sourceSetId.length > 1024)) ||
      (aggregateGradleContext !== undefined &&
        (aggregateGradleContext !== true ||
          request.evaluateGradle !== true ||
          request.gradle === undefined ||
          request.providerId !== undefined ||
          request.moduleId !== undefined ||
          sourceSetSelectorCount !== 0 ||
          request.sourceRelativePath !== undefined ||
          request.symbol !== undefined)) ||
      (requiredFacts !== undefined &&
        (!Array.isArray(requiredFacts) ||
          requiredFacts.length > 5 ||
          new Set(requiredFacts).size !== requiredFacts.length ||
          requiredFacts.some(
            (fact) =>
              fact !== "source-root-provenance" &&
              fact !== "compiler-options" &&
              fact !== "artifact-coordinates" &&
              fact !== "annotation-processors" &&
              fact !== "jpms",
          )))
    )
      throw new Error(INVALID);
    const result = normalizeJavaProjectContext(
      await invokeTauri<unknown>("query_refactorkit_java_project_context", { request }),
      request,
    );
    if (
      aggregateGradleContext === true &&
      "context" in result &&
      result.context.schemaVersion !== "java-project-context-v3" &&
      result.context.schemaVersion !== "java-project-context-v6" &&
      result.context.schemaVersion !== "java-project-context-v7"
    )
      throw new Error(INVALID);
    return result;
  }
  async stop(authority: JavaProjectContextAuthority) {
    await invokeTauri<void>("stop_refactorkit_java_project_context", { authority });
  }

  async recoverSavedSources(request: JavaSavedSourceRecoveryRequest): Promise<void> {
    if (
      !text(request.workspaceId, 256) ||
      !integer(request.generation, 1) ||
      !text(request.requestId, 256) ||
      (request.projectPath !== "" && relative(request.projectPath) !== request.projectPath)
    ) throw new Error(INVALID);
    const response = object(
      await invokeTauri<unknown>("recover_refactorkit_java_saved_sources", { request }),
    );
    exactKeys(response, ["workspaceId", "generation", "projectPath", "requestId", "recovered"]);
    if (
      response.workspaceId !== request.workspaceId ||
      response.generation !== request.generation ||
      response.projectPath !== request.projectPath ||
      response.requestId !== request.requestId ||
      response.recovered !== true
    ) throw new Error(INVALID);
  }

  async applyLanguageSettings(
    request: JavaProjectLanguageSettingsRequest,
  ): Promise<JavaProjectLanguageSettingsResult> {
    if (
      !text(request.workspaceId, 256) ||
      !integer(request.generation, 1) ||
      (request.projectPath !== "" && relative(request.projectPath) !== request.projectPath) ||
      (request.contextSchemaVersion !== "java-project-context-v1" &&
        request.contextSchemaVersion !== "java-project-context-v2" &&
        request.contextSchemaVersion !== "java-project-context-v3" &&
        request.contextSchemaVersion !== "java-project-context-v4" &&
        request.contextSchemaVersion !== "java-project-context-v5" &&
        request.contextSchemaVersion !== "java-project-context-v6" &&
        request.contextSchemaVersion !== "java-project-context-v7")
    )
      throw new Error(INVALID);
    const snapshotHash = hash(request.snapshotHash),
      contextHash = hash(request.contextHash);
    const data = object(
      await invokeTauri<unknown>("apply_refactorkit_java_project_language_settings", { request }),
    );
    const outcome = data.outcome;
    if (
      data.workspaceId !== request.workspaceId ||
      data.generation !== request.generation ||
      data.projectPath !== request.projectPath ||
      data.contextSchemaVersion !== request.contextSchemaVersion ||
      data.snapshotHash !== snapshotHash ||
      data.contextHash !== contextHash ||
      (outcome !== "applied" &&
        outcome !== "unchanged" &&
        outcome !== "unavailable" &&
        outcome !== "refused")
    )
      throw new Error(INVALID);
    return {
      workspaceId: request.workspaceId,
      generation: request.generation,
      projectPath: request.projectPath,
      contextSchemaVersion: request.contextSchemaVersion,
      snapshotHash,
      contextHash,
      outcome,
      message: text(data.message, 1024),
    };
  }

  async clearLanguageSettings(authority: JavaProjectContextAuthority) {
    if (!text(authority.workspaceId, 256) || !integer(authority.generation, 1))
      throw new Error(INVALID);
    await invokeTauri<void>("clear_refactorkit_java_project_language_settings", { authority });
  }

  async watch(
    authority: JavaProjectContextAuthority,
    projectPath: string,
    watchId: string,
    listener: (event: JavaProjectContextChangeEvent) => void,
  ) {
    if (
      !text(authority.workspaceId, 256) ||
      !integer(authority.generation, 1) ||
      !text(watchId, 256) ||
      (projectPath !== "" && relative(projectPath) !== projectPath)
    )
      throw new Error(INVALID);
    let unlisten: (() => void) | undefined;
    let active = true;
    try {
      unlisten = await listen<unknown>(PROJECT_WATCH_EVENT, (event: TauriEvent<unknown>) => {
        if (!active) return;
        try {
          const data = object(event.payload);
          const normalized = {
            workspaceId: text(data.workspaceId, 256),
            generation: integer(data.generation, 1),
            projectPath: relative(data.projectPath, true),
            watchId: text(data.watchId, 256),
          };
          if (
            normalized.workspaceId === authority.workspaceId &&
            normalized.generation === authority.generation &&
            normalized.projectPath === projectPath &&
            normalized.watchId === watchId &&
            (data.status === "changed" || data.status === "unavailable") &&
            (data.changeKind === undefined ||
              (data.status === "changed" &&
                (data.changeKind === "source" || data.changeKind === "buildConfiguration")))
          ) {
            listener({
              ...normalized,
              status: data.status,
              ...(data.changeKind !== undefined
                ? { changeKind: data.changeKind as "source" | "buildConfiguration" }
                : {}),
            });
          }
        } catch {
          // Malformed or stale native events carry no authority in the renderer.
        }
      });
      await invokeTauri<void>("watch_refactorkit_java_project_inputs", {
        authority,
        projectPath,
        watchId,
      });
      return () => {
        if (!active) return Promise.resolve();
        active = false;
        unlisten?.();
        return invokeTauri<void>("stop_refactorkit_java_project_watch", {
          authority,
          watchId,
        }).catch(() => undefined);
      };
    } catch {
      active = false;
      unlisten?.();
      void invokeTauri<void>("stop_refactorkit_java_project_watch", { authority, watchId }).catch(
        () => undefined,
      );
      throw new Error("Automatic Java project change tracking is unavailable.");
    }
  }
}
