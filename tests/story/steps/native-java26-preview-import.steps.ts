import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeJava26PreviewImportSession } from "../support/native-java27-preview-import.js";
import type { StoryWorld } from "../support/world.js";

const sessions = new WeakMap<StoryWorld, NativeJava26PreviewImportSession>();

function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw new Error("native Java 26 preview-import scenario was not prepared");
  return value;
}

Given<StoryWorld>(
  "the native Java 26 preview-import GUI has an isolated Java project and installed JDT LS",
  { timeout: 20_000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      this.targetEvidence.packagedApplication !== false
    )
      throw new Error(
        "Java 26 preview-import qualification requires release/no-bundle native GUI evidence",
      );
    const value = new NativeJava26PreviewImportSession();
    sessions.set(this, value);
    await value.prepare();
  },
);

When<StoryWorld>(
  "the person opens Java 26 preview with a Java 27 JDT compiler",
  { timeout: 120_000 },
  async function () {
    const value = session(this);
    try { await value.startAndInspectPreview(true); }
    catch (error) { value.setFailure(error); await value.captureFailure(); throw error; }
  },
);

Then<StoryWorld>("Problems explains the unsupported preview without claiming successful diagnostics", async function () {
  if (!session(this).evidence().previewDiagnosticUnavailabilityPresented)
    throw new Error("The incompatible preview compiler was not explained");
});

When<StoryWorld>("the person saves compatible project compiler options and refreshes JDT LS", { timeout: 90_000 }, async function () {
  const value = session(this);
  try { await value.saveCompatibleOptionsAndRefresh(); }
  catch (error) { value.setFailure(error); await value.captureFailure(); throw error; }
});

Then<StoryWorld>("real diagnostics recover without restarting the service or saving the Java draft", async function () {
  const proof = session(this).evidence();
  if (!proof.configurationChangeRecoveredDiagnostics || !proof.configurationChangePreservedUnsavedJava)
    throw new Error("Saved configuration recovery did not preserve the Java draft and native session");
});

When<StoryWorld>(
  "the person starts JDT LS and opens the Java 26 primitive-pattern source",
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
  "Monaco resolves the Java 26 primitive patterns without source errors while reporting an unrelated missing type",
  async function () {
    const evidence = session(this).evidence();
    if (
      !evidence.java26ProjectOpened ||
      !evidence.java26PrimitivePatternHoverPresented ||
      !evidence.unrelatedDiagnosticPresented ||
      !evidence.previewSourceHasNoErrors ||
      !evidence.fixtureSourcesUnchanged
    )
      throw new Error("Java 26 primitive-pattern project was not resolved cleanly");
  },
);

When<StoryWorld>(
  "the person stops JDT LS and closes the Java 26 preview-import IDE",
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
  "the Java 26 preview fixture is preserved and the native IDE exits cleanly",
  async function () {
    if (!session(this).evidence().cleanExit)
      throw new Error("Java 26 preview-import cleanup did not close the native IDE cleanly");
  },
);

After<StoryWorld>({ tags: "@native-java26-preview or @native-java-preview-incompatible", timeout: 20_000 }, async function () {
  const value = sessions.get(this);
  sessions.delete(this);
  if (!value) return;
  await value.dispose();
});
