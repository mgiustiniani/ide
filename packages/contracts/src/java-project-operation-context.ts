import type {
  JavaEffectiveProjectContext,
  JavaProjectContextAttestation,
  JavaProjectContextSettings,
  JavaProjectOperationContext,
  JavaGradleSettings,
} from "./java-project-context";

const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function isJavaGradleSettings(value: unknown): value is JavaGradleSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as JavaGradleSettings;
  const path = (s: unknown, empty = false) =>
    typeof s === "string" &&
    s.length <= 4096 &&
    !s.includes("\0") &&
    ((empty && s === "") || /^(\/|[A-Za-z]:[\\/])/.test(s));
  return (
    path(settings.executable) &&
    path(settings.userHome, true) &&
    (settings.gradleRuntimeHome === undefined || path(settings.gradleRuntimeHome, true)) &&
    !!settings.projectProperties &&
    typeof settings.projectProperties === "object" &&
    !Array.isArray(settings.projectProperties) &&
    Object.keys(settings.projectProperties).length <= 64 &&
    Object.entries(settings.projectProperties).every(
      ([key, text]) =>
        /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key) &&
        typeof text === "string" &&
        text.length <= 1024 &&
        !text.includes("\0"),
    )
  );
}

/** Validate operation context at a transport boundary without building a semantic model. */
export function isJavaProjectOperationContext(
  value: unknown,
): value is JavaProjectOperationContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const context = value as JavaProjectOperationContext;
  return (
    (context.contextSchemaVersion === undefined ||
      context.contextSchemaVersion === "java-project-context-v1" ||
      context.contextSchemaVersion === "java-project-context-v2" ||
      context.contextSchemaVersion === "java-project-context-v3" ||
      context.contextSchemaVersion === "java-project-context-v4" ||
      context.contextSchemaVersion === "java-project-context-v5" ||
      context.contextSchemaVersion === "java-project-context-v6" ||
      context.contextSchemaVersion === "java-project-context-v7") &&
    typeof context.projectPath === "string" &&
    context.projectPath.length <= 4096 &&
    (context.projectPath === "" ||
      (!context.projectPath.includes(":") &&
        !context.projectPath.includes("\\") &&
        !context.projectPath.includes("\0") &&
        context.projectPath
          .split("/")
          .every((part) => part !== "" && part !== "." && part !== ".."))) &&
    [context.sdkHome, context.mavenRepository].every(
      (text) => typeof text === "string" && text.length <= 4096 && !text.includes("\0"),
    ) &&
    Boolean(context.sdkHome.trim()) &&
    (context.gradle === undefined || isJavaGradleSettings(context.gradle)) &&
    hash(context.snapshotHash) &&
    hash(context.contextHash) &&
    Array.isArray(context.platformIdentities) &&
    context.platformIdentities.length > 0 &&
    context.platformIdentities.length <= 256 &&
    context.platformIdentities.every(hash) &&
    [context.activeMavenProfiles, context.inactiveMavenProfiles].every(
      (profiles) =>
        Array.isArray(profiles) &&
        profiles.length <= 64 &&
        profiles.every(
          (profile) =>
            typeof profile === "string" &&
            profile.length > 0 &&
            profile.length <= 256 &&
            !profile.includes("\0"),
        ),
    )
  );
}

/** Capture saved provider authority only after the selected project has synchronized. */
export function captureJavaProjectOperationContext(
  selected?: {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
  },
  options: {
    allowPartialContext?: boolean;
    /** Build/run/test can use v6/v7 project metadata while semantic Java analysis is unqualified. */
    allowUnqualifiedSemanticAnalysis?: boolean;
  } = {},
): JavaProjectOperationContext | undefined {
  if (!selected?.settings.sdkHome.trim()) return undefined;
  if (
    !selected.context ||
    (selected.context.status !== "available" &&
      !(options.allowPartialContext && selected.context.status === "partial"))
  )
    throw new Error(
      "Synchronize an effective Java project context before using the selected project JDK.",
    );
  if (
    selected.context.semanticAnalysis?.availability === "unqualified" &&
    options.allowUnqualifiedSemanticAnalysis !== true
  )
    throw new Error(
      "The synchronized Java project context has no qualified source analysis for this operation.",
    );
  const context = {
    ...structuredClone(selected.settings),
    contextSchemaVersion: selected.context.schemaVersion,
    snapshotHash: selected.context.snapshotHash,
    contextHash: selected.context.contextHash,
    platformIdentities: selected.context.sdk.map((sdk) => sdk.identitySha256),
  };
  if (!isJavaProjectOperationContext(context))
    throw new Error("The selected Java project context is invalid.");
  return context;
}

export function sameJavaProjectOperationContext(
  left: JavaProjectOperationContext | undefined,
  right: JavaProjectOperationContext | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    sameJavaProjectContextSettings(left, right) &&
    (left.contextSchemaVersion ?? "java-project-context-v1") ===
      (right.contextSchemaVersion ?? "java-project-context-v1") &&
    left.snapshotHash === right.snapshotHash &&
    left.contextHash === right.contextHash &&
    JSON.stringify(left.platformIdentities) === JSON.stringify(right.platformIdentities)
  );
}

/** Rollback retains the original context while requiring unchanged user settings. */
export function sameJavaProjectContextSettings(
  left: JavaProjectContextSettings,
  right: JavaProjectContextSettings,
): boolean {
  return (
    left.projectPath === right.projectPath &&
    left.sdkHome === right.sdkHome &&
    left.mavenRepository === right.mavenRepository &&
    JSON.stringify(left.activeMavenProfiles) === JSON.stringify(right.activeMavenProfiles) &&
    JSON.stringify(left.inactiveMavenProfiles) === JSON.stringify(right.inactiveMavenProfiles) &&
    JSON.stringify(left.gradle) === JSON.stringify(right.gradle)
  );
}

export function javaProjectContextAttestationMatches(
  expected: JavaProjectOperationContext | undefined,
  actual: JavaProjectContextAttestation | undefined,
): boolean {
  if (!expected) return actual === undefined;
  return (
    actual?.projectPath === expected.projectPath &&
    actual.contextHash === expected.contextHash &&
    actual.contextSchemaVersion === (expected.contextSchemaVersion ?? "java-project-context-v1") &&
    JSON.stringify(actual.platformIdentities) === JSON.stringify(expected.platformIdentities)
  );
}
