import assert from "node:assert/strict";
import { After, Given, Then, When } from "@cucumber/cucumber";
import type { JavaExecutionOperation } from "../../../packages/contracts/src/java-execution.js";
import type { StoryWorld } from "../support/world.js";
import {
  REQUIREMENT,
  getRefactorKitJavaBuildRunSession as session,
  disposeRefactorKitJavaBuildRunSession,
} from "../support/refactorkit-java-build-run.js";

Given<StoryWorld>("a trusted Java execution workspace", async function () {
  await session(this).trust();
});
Given<StoryWorld>(
  "a trusted Java execution workspace whose toolchain is unavailable",
  async function () {
    await session(this).trust();
    session(this).makeUnavailable();
  },
);
Given<StoryWorld>("an untrusted Java execution workspace", async function () {
  await session(this).start();
});
When<StoryWorld>("Java execution requests {word}", async function (operation: string) {
  assert.ok(["build", "run", "test", "debug"].includes(operation));
  await session(this).execute(operation as JavaExecutionOperation);
});
Then<StoryWorld>(
  "the Java execution console presents the {word} result returned by the tools",
  function (operation: string) {
    session(this).assertPresentation(operation);
  },
);
Then<StoryWorld>(
  "Java execution forwards a breakpoint command and stops its debugger session",
  async function () {
    await session(this).debugAndStop();
  },
);
Then<StoryWorld>("Java execution reports unavailable without a successful result", function () {
  session(this).assertUnavailable();
});
Then<StoryWorld>("the browser refuses local Java execution", async function () {
  await session(this).assertBrowserUnavailable();
});
Then<StoryWorld>("Java execution keeps web layers Tauri-free", function () {
  for (const result of session(this).scanWebFirstLayers())
    assert.equal(result.platformApiImportCount, 0, result.layer);
  assert.equal(session(this).portCapabilityEvidence()[0].tauriImports, 0);
});
Then<StoryWorld>("Java execution does not start a native process", function () {
  session(this).assertUntrusted();
});
After<StoryWorld>({ tags: `@${REQUIREMENT}` }, async function () {
  await this.attach(JSON.stringify(session(this).evidence()), "application/json");
  disposeRefactorKitJavaBuildRunSession(this);
});
