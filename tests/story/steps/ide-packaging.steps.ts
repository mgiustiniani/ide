import { After, Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";
import { IdePackagingStorySession } from "../support/ide-packaging.js";

const packagingSessions = new WeakMap<StoryWorld, IdePackagingStorySession>();

function packaging(world: StoryWorld): IdePackagingStorySession {
  let session = packagingSessions.get(world);
  if (!session) {
    session = new IdePackagingStorySession();
    packagingSessions.set(world, session);
  }
  return session;
}

Given<StoryWorld>(
  "the IDE desktop workspace is at the frozen baseline BASELINE-REQ-IDE-PACKAGING-001-v1",
  async function () {
    await packaging(this).start();
  },
);

Given<StoryWorld>(
  "the host is a portable Linux environment compatible with CachyOS/Arch",
  async function () {},
);

Given<StoryWorld>(
  "the AppImage bundle arguments and executable selection remain fixed",
  async function () {},
);

When<StoryWorld>(
  "the scenario runs the fixed deterministic packaging command:",
  async function (command: string) {
    await packaging(this).runPackagingCommand(command);
  },
);

Then<StoryWorld>(
  "the command exits successfully and produces a real release AppImage artifact",
  async function () {
    await packaging(this).assertCommandExitedZeroAndProducedArtifact();
  },
);

Then<StoryWorld>(
  'the artifact exists at the fixed path "{string}"',
  async function (fixedPath: string) {
    await packaging(this).assertArtifactExists(fixedPath);
  },
);

Then<StoryWorld>(
  'the artifact has the fixed product name "{string}" and the fixed version "{string}"',
  async function (productName: string, version: string) {
    await packaging(this).assertProductNameAndVersion(productName, version);
  },
);

Then<StoryWorld>("the artifact is executable and self-contained", async function () {
  await packaging(this).assertExecutableAndSelfContained();
});

When<StoryWorld>("the artifact launches the real IDE desktop", async function () {
  await packaging(this).launchArtifact();
});

Then<StoryWorld>("the IDE desktop starts and its native window becomes ready", async function () {
  await packaging(this).assertIdeStartsAndWindowReady();
});

When<StoryWorld>("the person closes the IDE window", async function () {
  await packaging(this).closeIdeWindow();
});

Then<StoryWorld>("the packaged app exits cleanly", async function () {
  await packaging(this).assertCleanExit();
});

Then<StoryWorld>("zero IDE desktop processes survive after exit", async function () {
  await packaging(this).assertZeroSurvivingProcesses();
});

After<StoryWorld>(async function () {
  const session = packagingSessions.get(this);
  if (session) {
    await this.attach(JSON.stringify(session.evidence()), "application/json");
    await session.dispose();
    packagingSessions.delete(this);
  }
});
