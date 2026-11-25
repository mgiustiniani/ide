import { After, Given, When, Then } from "@cucumber/cucumber";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaEditorDiagnosticsSession } from "../support/native-java-editor-diagnostics.js";
const sessions = new WeakMap<StoryWorld, NativeJavaEditorDiagnosticsSession>();
Given<StoryWorld>(
  "the Java compiler-check GUI has a Maven project using {string}",
  { timeout: 30000 },
  async function (profile: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true ||
      !matchesNativeArtifactEvidence(this.targetEvidence)
    )
      throw new Error("Java compiler-check acceptance requires the real native application and matching artifact evidence");
    const session = new NativeJavaEditorDiagnosticsSession();
    sessions.set(this, session);
    await session.prepare(profile);
  },
);
Given<StoryWorld>(
  "the Java compiler-check GUI has a Gradle project using {string}",
  { timeout: 30000 },
  async function (profile: string) {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true
    )
      throw new Error("Gradle compiler-check acceptance requires the real native application");
    const session = new NativeJavaEditorDiagnosticsSession();
    sessions.set(this, session);
    await session.prepare(profile, "gradle");
  },
);
for (const [kind, buildTool] of [
  ["Maven reactor", "maven"],
  ["Gradle multi-project", "gradle"],
] as const) {
  Given<StoryWorld>(
    `the Java compiler-check GUI has a ${kind} using {string}`,
    { timeout: 30000 },
    async function (profile: string) {
      if (
        this.targetProfile.driver !== "tauri-webdriver" ||
        this.targetEvidence?.nativeGui !== true ||
        this.targetEvidence.e2e !== true
      )
        throw new Error("Cross-module compiler checks require the real native application");
      const session = new NativeJavaEditorDiagnosticsSession();
      sessions.set(this, session);
      await session.prepare(profile, buildTool, true);
    },
  );
}
for (const [kind, buildTool] of [
  ["Maven", "maven"],
  ["Gradle", "gradle"],
] as const) {
  Given<StoryWorld>(
    `the Java compiler-check GUI has a ${kind} project with JUnit test sources using {string}`,
    { timeout: 30000 },
    async function (profile: string) {
      if (
        this.targetProfile.driver !== "tauri-webdriver" ||
        this.targetEvidence?.nativeGui !== true ||
        this.targetEvidence.e2e !== true ||
        !matchesNativeArtifactEvidence(this.targetEvidence)
      )
        throw new Error("JUnit compiler checks require the real native application and matching artifact evidence");
      const session = new NativeJavaEditorDiagnosticsSession();
      sessions.set(this, session);
      await session.prepare(profile, buildTool, false, true);
    },
  );
}
Given<StoryWorld>(
  "the Java compiler-check GUI has a metadata-only Java 27 project",
  { timeout: 30000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence.e2e !== true
    )
      throw new Error("Metadata-only compiler checks require the real native application");
    const session = new NativeJavaEditorDiagnosticsSession();
    sessions.set(this, session);
    await session.prepare("source/target 27", "maven");
  },
);
for (const [kind, buildTool] of [
  ["Maven", "maven"],
  ["Gradle", "gradle"],
] as const) {
  Given<StoryWorld>(
    `the Java compiler-check GUI has a ${kind} project for external-source changes`,
    { timeout: 30000 },
    async function () {
      if (
        this.targetProfile.driver !== "tauri-webdriver" ||
        this.targetEvidence?.nativeGui !== true ||
        this.targetEvidence.e2e !== true
      )
        throw new Error("External-source compiler checks require the real native application");
      const session = new NativeJavaEditorDiagnosticsSession();
      sessions.set(this, session);
      await session.prepareExternalSource(buildTool);
    },
  );
}
for (const [phrase, method] of [
  ["the person opens the compiler-check IDE and synchronizes its selected JDK", "launch"],
  [
    "automatic compiler checks recover from an external source change without saving drafts or evaluating the build",
    "checkExternalSource",
  ],
  [
    "the person restores the external fixture, discards drafts and closes the compiler-check IDE",
    "closeExternalSource",
  ],
  [
    "the external-source compiler-check inputs remain unchanged and the window exits normally",
    "assertExternalSourceClosure",
  ],
  [
    "the compiler-check commands keep metadata-only Java analysis unavailable without losing the draft",
    "checkMetadataOnly",
  ],
  [
    "the person pauses checks, discards the metadata-only draft and closes the IDE",
    "closeMetadataOnly",
  ],
  [
    "the metadata-only compiler-check inputs remain unchanged and the window exits normally",
    "assertMetadataOnlyClosure",
  ],
  ["the person changes the Java caller and companion without saving", "edit"],
  [
    "the compiler-check command shows SDK-aware errors, companion markers, and saved-source navigation",
    "check",
  ],
  ["the person enables automatic Java compiler checks and repairs the companion", "repair"],
  [
    "the test dependency resolves only in test sources and repairs keep the classpaths separate",
    "assertTestClasspath",
  ],
  [
    "the changed library signature invalidates the caller and its unsaved repair resolves the error",
    "assertCrossModule",
  ],
  [
    "the compiler-check results retire on edits and retain the expected SDK restriction",
    "assertRepair",
  ],
  ["the person discards the Java drafts and closes the compiler-check IDE", "discardAndClose"],
  ["the compiler-check inputs remain unchanged and the native window exits cleanly", "assertFinal"],
] as const) {
  const define = [
    "check",
    "assertRepair",
    "assertCrossModule",
    "assertTestClasspath",
    "checkMetadataOnly",
    "assertMetadataOnlyClosure",
    "checkExternalSource",
    "assertExternalSourceClosure",
    "assertFinal",
  ].includes(method)
    ? Then
    : When;
  define<StoryWorld>(phrase, { timeout: 90000 }, async function () {
    const session = sessions.get(this);
    if (!session) throw new Error("Missing Java compiler-check session");
    try { await session[method](); }
    catch (error) { await session.captureFailure(error); throw error; }
  });
}
After<StoryWorld>({ tags: "@native-java-editor-diagnostics or @native-java-editor-sdk26-diagnostics", timeout: 20000 }, async function () {
  const session = sessions.get(this);
  if (!session) return;
  sessions.delete(this);
  try {
    await session.dispose();
  } finally {
    await this.attach(JSON.stringify(session.evidence()), "application/json");
  }
});
