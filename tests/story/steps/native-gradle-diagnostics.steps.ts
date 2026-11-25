import { After, Given, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { matchesNativeArtifactEvidence } from "../support/native-artifact-evidence.js";
import { NativeGradleDiagnosticSession } from "../support/native-gradle-diagnostics.js";
const sessions = new WeakMap<StoryWorld, NativeGradleDiagnosticSession>();
function session(world: StoryWorld) { const value = sessions.get(world); if (!value) throw new Error("Gradle diagnostic fixture not prepared"); return value; }
Given<StoryWorld>("the native Gradle diagnostic GUI has a real project and a {word} cache failure", { timeout: 25_000 }, async function (cause: string) {
  if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.nativeGui !== true || this.targetEvidence.e2e !== true || !matchesNativeArtifactEvidence(this.targetEvidence)) throw new Error("Gradle diagnostics require matching native desktop artifact evidence");
  const value = new NativeGradleDiagnosticSession(); sessions.set(this, value); await value.prepare(cause);
});
When<StoryWorld>("the person explicitly evaluates Gradle and receives a bounded cause without an effective context", { timeout: 60_000 }, async function () { await session(this).observeRefusal(); });
When<StoryWorld>("the person selects a complete writable cache and explicitly evaluates Gradle again", { timeout: 60_000 }, async function () { await session(this).recover(); });
When<StoryWorld>("the person prepares the same Gradle cache from Java Run and evaluates offline with the repository stopped", { timeout: 195_000 }, async function () { await session(this).recover(); });
When<StoryWorld>("the person sees preparation fail during a repository outage then retries and evaluates offline", { timeout: 195_000 }, async function () { await session(this).recover(); });
Then<StoryWorld>("the Gradle diagnostic window closes with inputs unchanged and no implicit compilation", { timeout: 20_000 }, async function () { await session(this).close(); });
After<StoryWorld>({ tags: "@native-java-gradle-diagnostics", timeout: 30_000 }, async function () { await sessions.get(this)?.dispose(); });
