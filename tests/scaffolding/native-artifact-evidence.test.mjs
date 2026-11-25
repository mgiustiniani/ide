import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { nativeArtifactEvidence, matchesNativeArtifactEvidence } = await tsImport(
  "../story/support/native-artifact-evidence.ts",
  import.meta.url,
);

test("native scenario evidence preserves the runner's artifact kind", () => {
  assert.deepEqual(nativeArtifactEvidence({}), {
    artifactKind: "release-no-bundle",
    packagedApplication: false,
  });
  assert.deepEqual(
    nativeArtifactEvidence({
      IDE_STORY_NATIVE_GUI_ARTIFACT_KIND: "appimage",
      IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION: "1",
    }),
    { artifactKind: "appimage", packagedApplication: true },
  );
  assert.deepEqual(
    nativeArtifactEvidence({
      IDE_STORY_NATIVE_GUI_ARTIFACT_KIND: "release-no-bundle",
      IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION: "0",
    }),
    { artifactKind: "release-no-bundle", packagedApplication: false },
  );
});
test("a scenario cannot promote inconsistent or unknown artifact evidence", () => {
  for (const environment of [
    { IDE_STORY_NATIVE_GUI_ARTIFACT_KIND: "appimage" },
    { IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION: "1" },
    {
      IDE_STORY_NATIVE_GUI_ARTIFACT_KIND: "appimage",
      IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION: "0",
    },
    {
      IDE_STORY_NATIVE_GUI_ARTIFACT_KIND: "installer",
      IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION: "1",
    },
  ])
    assert.throws(() => nativeArtifactEvidence(environment), /inconsistent/);
});

test("scenario artifact metadata must match the native runner", () => {
  const environment = {
    IDE_STORY_NATIVE_GUI_ARTIFACT_KIND: "appimage",
    IDE_STORY_NATIVE_GUI_PACKAGED_APPLICATION: "1",
  };
  assert.equal(matchesNativeArtifactEvidence(undefined, environment), false);
  assert.equal(
    matchesNativeArtifactEvidence(
      { artifactKind: "release-no-bundle", packagedApplication: false },
      environment,
    ),
    false,
  );
  assert.equal(
    matchesNativeArtifactEvidence(
      { artifactKind: "appimage", packagedApplication: false },
      environment,
    ),
    false,
  );
  assert.equal(
    matchesNativeArtifactEvidence(
      { artifactKind: "appimage", packagedApplication: true },
      environment,
    ),
    true,
  );
});
