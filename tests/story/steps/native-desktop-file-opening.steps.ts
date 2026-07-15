import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>(
  "an isolated temporary sandbox contains the authorized workspace and all desktop user state",
  async function () {
    await this.createNativeDesktopFileOpenSession().assertSandboxReady();
  },
);

Given<StoryWorld>(
  "the workspace root contains a deterministic file named {string}",
  async function (fileName: string) {
    await this.nativeDesktopFileOpenSession().createFixture(fileName);
  },
);

Given<StoryWorld>("its unique exact logical content is:", async function (content: string) {
  await this.nativeDesktopFileOpenSession().setExactFixtureContent(content);
});

When<StoryWorld>(
  /^the real production release\/no-bundle Tauri executable is launched directly instead of a CachyOS package$/,
  { timeout: 35_000 },
  async function () {
    await this.nativeDesktopFileOpenSession().launch();
  },
);

Then<StoryWorld>(
  "the authorized File Explorer becomes ready",
  { timeout: 20_000 },
  async function () {
    await this.nativeDesktopFileOpenSession().waitForFileExplorer();
  },
);

Then<StoryWorld>(
  "it exposes {string} as a visible file item with an accessible name",
  { timeout: 20_000 },
  async function (fileName: string) {
    await this.nativeDesktopFileOpenSession().assertAccessibleFileItem(fileName);
  },
);

When<StoryWorld>("the person clicks that file item", async function () {
  await this.nativeDesktopFileOpenSession().clickFileItem();
});

Then<StoryWorld>(
  "within {int} seconds the selected path is exactly the sandboxed workspace path for {string}",
  { timeout: 20_000 },
  async function (seconds: number, fileName: string) {
    await this.nativeDesktopFileOpenSession().assertSelectedPathWithin(seconds, fileName);
  },
);

Then<StoryWorld>(
  "within the same {int} seconds the active editor tab is exactly {string} and exposes its selected state",
  { timeout: 20_000 },
  async function (seconds: number, fileName: string) {
    await this.nativeDesktopFileOpenSession().assertActiveTabWithin(seconds, fileName);
  },
);

Then<StoryWorld>(
  "within the same {int} seconds Monaco is ready with the unique exact logical content of {string}",
  { timeout: 20_000 },
  async function (seconds: number, fileName: string) {
    await this.nativeDesktopFileOpenSession().assertMonacoContentWithin(seconds, fileName);
  },
);

Then<StoryWorld>(
  "the editor shows neither an opening placeholder nor a file-open failure",
  async function () {
    await this.nativeDesktopFileOpenSession().assertNoOpeningOrFailure();
  },
);

Then<StoryWorld>("the native window remains responsive without hanging", async function () {
  await this.nativeDesktopFileOpenSession().assertResponsive();
});

When<StoryWorld>("the person closes the native window", { timeout: 10_000 }, async function () {
  await this.nativeDesktopFileOpenSession().closeNativeWindow();
});

Then<StoryWorld>("the executable exits cleanly", { timeout: 10_000 }, async function () {
  await this.nativeDesktopFileOpenSession().assertExecutableExited();
});

Then<StoryWorld>(
  "no state has been written outside the temporary sandbox",
  { timeout: 10_000 },
  async function () {
    await this.nativeDesktopFileOpenSession().assertSandboxConfinement();
    await this.attachNativeDesktopEvidence();
  },
);
