/** Artifact identity supplied by the native runner; a GUI test never upgrades its own evidence. */
export function nativeArtifactEvidence(environment: NodeJS.ProcessEnv = process.env) {
  const artifactKind = environment.IDE_STORY_NATIVE_GUI_ARTIFACT_KIND ?? "release-no-bundle";
  const flag = environment.IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION;
  if (
    (artifactKind !== "release-no-bundle" && artifactKind !== "appimage") ||
    (flag !== undefined && flag !== "0" && flag !== "1") ||
    (artifactKind === "appimage") !== (flag === "1")
  ) {
    throw new Error("Native artifact evidence is inconsistent with the runner.");
  }
  return { artifactKind, packagedApplication: artifactKind === "appimage" };
}

/** Compare scenario metadata with the artifact actually selected by the native runner. */
export function matchesNativeArtifactEvidence(
  evidence: { artifactKind?: string; packagedApplication?: boolean } | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = nativeArtifactEvidence(environment);
  return (
    evidence?.artifactKind === expected.artifactKind &&
    evidence?.packagedApplication === expected.packagedApplication
  );
}
