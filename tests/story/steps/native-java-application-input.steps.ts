import { After, Given, Then, When } from "@cucumber/cucumber";
import type { StoryWorld } from "../support/world.js";
import { NativeJavaApplicationInputSession } from "../support/native-java-application-input.js";
const sessions = new WeakMap<StoryWorld, NativeJavaApplicationInputSession>();
function session(world: StoryWorld) { const value = sessions.get(world); if (!value) throw new Error("application-input fixture not prepared"); return value; }
Given<StoryWorld>("the native Java application input fixture uses {string}", async function (mode: string) {
  const value = new NativeJavaApplicationInputSession(); sessions.set(this, value); await value.prepare(mode);
});
When<StoryWorld>("the person enables application input and launches the real Java application", { timeout: 60_000 }, async function () { await session(this).launch(); });
Then<StoryWorld>("Unicode text and an empty line reach System.in exactly once and EOF completes the application", { timeout: 30_000 }, async function () { await session(this).sendAndClose(); });
When<StoryWorld>("the person repeats the captured input launch and stops its waiting JVM", { timeout: 60_000 }, async function () { await session(this).repeatAndStop(); });
Then<StoryWorld>("the Java application input IDE closes with its source preserved", { timeout: 20_000 }, async function () { await session(this).close(); });
After<StoryWorld>({ tags: "@native-java-application-input", timeout: 30_000 }, async function () { await sessions.get(this)?.dispose(); });
