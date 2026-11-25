import { After, Given, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaModularSourceCreationSession } from "../support/native-java-modular-source-creation.js";

const sessions = new WeakMap<StoryWorld, NativeJavaModularSourceCreationSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw Error("Modular source-creation fixture is not prepared");
  return value;
}
async function checked(world: StoryWorld, action: (value: NativeJavaModularSourceCreationSession) => Promise<void>) {
  const value = session(world);
  try { await action(value); }
  catch (error) { await value.captureFailure(error); throw error; }
}
Given<StoryWorld>("an isolated native {word} project declares a named Java 25 module", { timeout: 30000 }, async function (tool: string) {
  if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.nativeGui !== true || this.targetEvidence.packagedApplication !== false)
    throw Error("Modular source creation requires the native release/no-bundle desktop");
  const value = new NativeJavaModularSourceCreationSession(); sessions.set(this, value); await value.prepare(tool);
});
When<StoryWorld>("the person synchronizes its module details and keeps an unrelated notes draft", { timeout: 120000 }, async function () {
  await checked(this, value => value.launchAndSynchronize());
});
Then<StoryWorld>("the source wizard has provider-qualified named-module metadata", async function () {
  if (!session(this).evidence().moduleMetadataAvailable) throw Error("Module metadata is unavailable");
});
When<StoryWorld>("the person attempts compact and unnamed-package types then creates a packaged type", { timeout: 60000 }, async function () {
  await checked(this, value => value.refuseAndCreate());
});
Then<StoryWorld>("the incompatible requests create no files or tabs and the packaged type is an unsaved draft", async function () {
  const p = session(this).evidence();
  if (!p.compactRejected || !p.unnamedTypeRejected || !p.refusedInputsPreserved || !p.packagedDraftAccepted || !p.diskInitiallyEmpty)
    throw Error("Modular source-creation boundaries are incomplete");
});
When<StoryWorld>("the captured packaged draft is checked by the selected JDK and only the new type is saved", { timeout: 60000 }, async function () {
  await checked(this, value => value.verifyAndSave());
});
Then<StoryWorld>("the generated type belongs to a resolvable named module while notes and original inputs remain unchanged", async function () {
  const p = session(this).evidence();
  if (!p.capturedDraftCompiled || !p.namedModuleResolved || !p.onlyCreatedTypeSaved || !p.notesDraftPreserved || !p.noWorkspaceCompilation || !p.inputsPreserved)
    throw Error("Named-module draft qualification is incomplete");
});
When<StoryWorld>("the person inspects nested declarations and overloads in an unsaved project source", { timeout: 120000 }, async function () {
  await checked(this, value => value.inspectProjectStructure());
});
Then<StoryWorld>("the project outline navigates to the exact overload and preserves every source and notes draft", async function () {
  const p = session(this).evidence();
  if (!p.projectStructureDraftOnlySymbol || !p.projectStructureNestedAndOverloads || !p.projectStructureExactOverloadCursor || !p.projectStructureNameOrder || !p.projectStructureInputsAndDraftsPreserved)
    throw Error("Project outline qualification is incomplete");
});
When<StoryWorld>("the person discards the unrelated draft and closes the modular-source IDE", { timeout: 30000 }, async function () {
  await checked(this, value => value.close());
});
Then<StoryWorld>("the modular source inputs remain intact and the native window closes normally", async function () {
  if (!session(this).evidence().cleanExit || !session(this).evidence().inputsPreserved) throw Error("Modular source-creation close failed");
});
After<StoryWorld>({ tags: "@native-java-modular-source-creation", timeout: 45000 }, async function () {
  await sessions.get(this)?.dispose(); sessions.delete(this);
});
