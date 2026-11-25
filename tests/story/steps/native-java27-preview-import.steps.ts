import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeJava27PreviewImportSession } from "../support/native-java27-preview-import.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeJava27PreviewImportSession>();

function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java 27 preview-import scenario was not prepared");
  return value;
}

Given<StoryWorld>(
  "the native Java 27 preview-import GUI has an isolated Maven project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java 27 preview-import qualification requires release/no-bundle native GUI evidence",
      );
    const value = new NativeJava27PreviewImportSession();
    sessions.set(this, value);
    await value.prepare();
  },
);

When<StoryWorld>(
  "the person starts JDT LS and opens the Maven Java 27 preview source",
  { timeout: 120_000 },
  async function () {
    const value = session(this);
    try {
      await value.startAndInspectPreview();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "Monaco resolves Java 27 preview switch and instanceof patterns, hovers both pattern variables, and reports no source errors",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.mavenPreviewProjectOpened ||
      !evidence.unrelatedDiagnosticPresented ||
      !evidence.java27PatternHoverPresented ||
      !evidence.java27InstanceofPatternHoverPresented ||
      !evidence.previewSourceHasNoErrors ||
      !evidence.fixtureSourcesUnchanged
    )
      throw new Error("Maven Java 27 preview import was not resolved cleanly in the native editor");
  },
);

When<StoryWorld>(
  "the person stops JDT LS and closes the Java 27 preview-import IDE",
  { timeout: 40_000 },
  async function () {
    const value = session(this);
    try {
      await value.restoreAndClose();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);

Then<StoryWorld>(
  "the Maven Java 27 preview fixture is preserved and the native IDE exits cleanly",
  async function () {
    if (!session(this).evidence().cleanExit)
      throw new Error("Java 27 preview-import cleanup did not close the native IDE cleanly");
  },
);

After<StoryWorld>({ tags: "@native-java27-preview", timeout: 20_000 }, async function () {
  const value = sessions.get(this);
  sessions.delete(this);
  if (!value) return;
  await value.dispose();
});
