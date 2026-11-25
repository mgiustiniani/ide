import assert from "node:assert/strict";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeJavaTextSearchSession } from "../support/native-java-text-search.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeJavaTextSearchSession>();

function session(world: StoryWorld): NativeJavaTextSearchSession {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java text-search scenario was not prepared");
  return value;
}

Given<StoryWorld>(
  "the Java text search GUI has an isolated project workspace",
  { timeout: 40_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.artifactKind !== "release-no-bundle"
    )
      throw new Error(
        "Java text search acceptance requires a real release/no-bundle native window",
      );
    const value = new NativeJavaTextSearchSession();
    sessions.set(this, value);
    await value.prepare();
  },
);

When<StoryWorld>(
  "the person searches the selected Java project for saved source and resource text",
  { timeout: 20_000 },
  async function () {
    await session(this).searchAndNavigate();
  },
);

Then<StoryWorld>(
  "Find in Java results show exact columns for all matches, including repeated matches on one line, open in the editor and omit unsupported files",
  function () {
    const evidence = session(this).evidence();
    assert.equal(evidence.caseSensitiveProjectResults, true);
    assert.equal(evidence.buildAndResourceTextIncluded, true);
    assert.equal(evidence.resourceResultOpened, true);
  },
);

When<StoryWorld>(
  "the person searches while the Java resource editor has an unsaved text change",
  { timeout: 20_000 },
  async function () {
    await session(this).searchWithResourceDraft();
  },
);

Then<StoryWorld>(
  "the resource draft replaces its saved results without changing the file on disk",
  function () {
    const evidence = session(this).evidence();
    assert.equal(evidence.unsavedResourceDraftIncluded, true);
    assert.equal(evidence.resourceSavedVersionReplaced, true);
    assert.equal(evidence.resourceFilePreserved, true);
  },
);

When<StoryWorld>(
  "the person searches while the Java editor has an unsaved draft",
  { timeout: 20_000 },
  async function () {
    await session(this).searchWithDrafts();
  },
);

Then<StoryWorld>(
  "the draft replaces its saved version in the results and preserves project files",
  function () {
    const evidence = session(this).evidence();
    assert.equal(evidence.unsavedDraftIncluded, true);
    assert.equal(evidence.savedVersionReplaced, true);
    assert.equal(evidence.sourceFilesPreserved, true);
  },
);

When<StoryWorld>("the person closes the Java text search IDE", async function () {
  await session(this).close();
});

Then<StoryWorld>(
  "the text search window exits cleanly and the scenario environment is restored",
  { timeout: 10_000 },
  async function () {
    await session(this).assertFinal();
  },
);

After<StoryWorld>(
  {
    tags: "@REQ-IDE-JAVA-PROJECT-CONTEXT-NATIVE-001 and @native-java-text-search",
    timeout: 20_000,
  },
  async function () {
    const value = sessions.get(this);
    if (!value) return;
    sessions.delete(this);
    try {
      await value.dispose();
    } finally {
      await this.attach(JSON.stringify(value.evidence()), "application/json");
      const diagnostic = value.diagnostics();
      if (diagnostic) await this.attach(diagnostic, "text/plain");
    }
  },
);
