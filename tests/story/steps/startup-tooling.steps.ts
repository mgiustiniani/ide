import assert from "node:assert/strict";

import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>(
  "a person starts a generic standalone web workspace",
  { timeout: 30_000 },
  async function () {
    await this.startStandaloneWebApp();
  },
);

When<StoryWorld>("the workspace is ready", { timeout: 15_000 }, async function () {
  const app = this.standaloneWebApp();
  await app.waitUntilReady();
  await this.attach(JSON.stringify(app.evidence()), "application/json");
});

Then<StoryWorld>("only core web tooling is offered", async function () {
  assert.deepEqual(await this.standaloneWebApp().offeredToolNames(), ["Terminal"]);
});

Then<StoryWorld>(
  "the terminal reports that process execution is unavailable in the browser",
  async function () {
    assert.equal(await this.standaloneWebApp().terminalReportsBrowserUnavailable(), true);
  },
);

Then<StoryWorld>("desktop-only Java tooling is not offered", async function () {
  const offeredTools = await this.standaloneWebApp().offeredToolNames();
  assert.equal(
    offeredTools.some((name) => /^Java(?:\s|$)/i.test(name)),
    false,
  );
});

Then<StoryWorld>("desktop-only XCOM tooling is not offered", async function () {
  const offeredTools = await this.standaloneWebApp().offeredToolNames();
  assert.equal(
    offeredTools.some((name) => /^XCOM(?:\s|$)/i.test(name)),
    false,
  );
});
