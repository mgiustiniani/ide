import { After, Given, Then, When, Status } from "@cucumber/cucumber";
import { NativeEditorStorageFullSession } from "../support/native-editor-storage-full.js";
import type { StoryWorld } from "../support/world.js";
const sessions = new WeakMap<StoryWorld, NativeEditorStorageFullSession>();
function session(world: StoryWorld) { const value = sessions.get(world); if (!value) throw new Error("Storage-full scenario not prepared"); return value; }
Given<StoryWorld>(/^the native editor has an isolated (source|recovery) filesystem limited to one MiB$/, async function (mode: "source" | "recovery") {
  if (this.targetProfile.driver !== "tauri-webdriver" || this.targetEvidence?.packagedApplication !== false) throw new Error("Storage-full acceptance requires a real native release/no-bundle GUI");
  const value = new NativeEditorStorageFullSession(mode); sessions.set(this, value); await value.prepare();
});
When<StoryWorld>("the person exhausts that filesystem and retries after releasing space", { timeout: 100_000 }, async function () { await session(this).exercise(); });
Then<StoryWorld>("the source and recovery behavior retain the inspected data through ENOSPC", async function () { session(this).assertBehavior(); });
When<StoryWorld>("the person closes the storage-full IDE normally", { timeout: 20_000 }, async function () { await session(this).close(); });
Then<StoryWorld>("the bounded filesystem scenario releases its native processes and environment", async function () { await session(this).dispose(); sessions.delete(this); });
After<StoryWorld>({ tags: "@native-editor-storage-full", timeout: 20_000 }, async function ({ result }) {
  const value = sessions.get(this); if (value) await value.dispose(result?.status === Status.FAILED ? result.message : undefined); sessions.delete(this);
});
