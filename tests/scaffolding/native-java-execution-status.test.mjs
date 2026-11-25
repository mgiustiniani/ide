import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { NativeJavaBuildToolsSession } = await tsImport("../story/support/native-java-build-tools.ts", import.meta.url);
const { NativeJavaProjectContextSession } = await tsImport("../story/support/native-java-project-context.ts", import.meta.url);

for (const [name, createSession, method] of [
  ["manual build-tool", () => new NativeJavaBuildToolsSession("maven"), "waitStatus"],
  ["synchronized project", () => new NativeJavaProjectContextSession(), "waitProjectExecution"],
]) {
  test(`${name} waits for Build rather than accepting a Rebuild result`, async () => {
    const session = createSession();
    let text = "rebuild: succeeded (exit 0)";
    const panel = { getText: async () => `Console text may include build: succeeded (exit 0)\n${text}`, $$: () => ({ getElements: async () => [] }), $: () => ({ isEnabled: async () => true }) };
    session.panel = () => panel;
    session.executionPanel = () => panel;
    session.browser = () => ({ execute: async () => [text], waitUntil: async (predicate) => {
      assert.equal(await predicate(), false, "A Rebuild result is not a Build result");
      text = "build: succeeded (exit 0)";
      assert.equal(await predicate(), true);
    } });
    await session[method]("build", method === "waitStatus" ? false : "succeeded");
  });
}

test("project Build neither fails for a Rebuild failure nor accepts a prefixed debug-test result", async () => {
  const session = new NativeJavaProjectContextSession();
  let text = "rebuild: failed (exit 1)";
  const panel = { getText: async () => `Console text may include build: succeeded (exit 0)\n${text}`, $$: () => ({ getElements: async () => [] }), $: () => ({ isEnabled: async () => true }) };
  session.executionPanel = () => panel;
  session.browser = () => ({ execute: async () => [text], waitUntil: async (predicate) => {
    assert.equal(await predicate(), false);
    text = "build: failed (exit 1)";
    await assert.rejects(predicate, /terminated unsuccessfully/);
  } });
  await session.waitProjectExecution("build", "succeeded");
  session.browser = () => ({ execute: async () => [text], waitUntil: async (predicate) => {
    text = "debug-integration-test: succeeded (exit 0)";
    assert.equal(await predicate(), false);
    text = "integration-test: succeeded (exit 0)";
    assert.equal(await predicate(), true);
  } });
  await session.waitProjectExecution("integration-test", "succeeded");
});
