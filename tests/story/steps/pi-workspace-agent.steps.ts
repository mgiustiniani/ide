import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

const originalWorkspaceAPids = new WeakMap<StoryWorld, number>();

function agent(world: StoryWorld) {
  return world.piWorkspaceAgentSession();
}

Given<StoryWorld>(
  "the existing IDE Workspace Registry contains distinct workspaces A and B",
  { timeout: 300_000 },
  async function () {
    await this.createPiWorkspaceAgentSession();
    await agent(this).assertRegistryAndFiles();
  },
);

Given<StoryWorld>(
  "workspace A and workspace B each contain a distinct file visible through the existing File Explorer",
  async function () {
    await agent(this).assertRegistryAndFiles();
  },
);

Given<StoryWorld>(
  "Pi is available as a fixed executable that can run its real interactive TUI in a pseudoterminal",
  async function () {
    await agent(this).assertFixedPiPtyAvailable();
  },
);

When<StoryWorld>(
  "the person selects the existing Agent activity for workspace A",
  { timeout: 30_000 },
  async function () {
    await agent(this).selectAgent("workspace-a");
    originalWorkspaceAPids.set(this, await agent(this).processId("workspace-a"));
  },
);

Then<StoryWorld>(
  "the composite Agent screen attaches to a backend-owned Pi pseudoterminal rooted at the exact registered root of workspace A",
  async function () {
    await agent(this).assertAttachedToExactRoot("workspace-a");
  },
);

Then<StoryWorld>(
  "the terminal forwards raw keyboard input, paste, modified Enter sequences, ANSI output, and resize without a synthetic prompt or command parser",
  { timeout: 30_000 },
  async function () {
    await agent(this).assertRawTransport();
  },
);

Then<StoryWorld>(
  "Pi remains the sole authority for chat messages, history, tools, commands, extensions, models, trust, compaction, retry, and session behavior",
  async function () {
    await agent(this).assertPiOwnsConversation();
  },
);

When<StoryWorld>(
  "the person enters a distinctive workspace A interaction in the native Pi TUI",
  async function () {
    await agent(this).interact("workspace-a", "A-DISTINCTIVE");
  },
);

Then<StoryWorld>(
  "workspace A output is retained in a bounded reattachment transcript owned by the backend terminal transport",
  async function () {
    await agent(this).assertTranscript("workspace-a", "A-DISTINCTIVE");
  },
);

Then<StoryWorld>(
  "the same Agent screen exposes Changes, Activity, Resources, and Sessions as read-only accessory views",
  { timeout: 30_000 },
  async function () {
    await agent(this).assertCompositeAccessories();
  },
);

Then<StoryWorld>(
  "Resources includes every installed Pi package even when a package registers no slash command",
  { timeout: 30_000 },
  async function () {
    await agent(this).assertInstalledPackages();
  },
);

Then<StoryWorld>(
  "Sessions identifies the workspace-bound Pi session without projecting its conversation",
  async function () {
    await agent(this).assertSessionMetadataOnly("workspace-a");
  },
);

When<StoryWorld>(
  "the person uses the existing Workspace Explorer to switch to workspace B",
  { timeout: 30_000 },
  async function () {
    await agent(this).switchTo("workspace-b");
  },
);

Then<StoryWorld>(
  "the Agent screen detaches from workspace A without EOF, signal, or termination",
  async function () {
    await agent(this).assertDetachedWithoutTermination("workspace-a");
  },
);

Then<StoryWorld>(
  "it attaches to a distinct backend-owned Pi pseudoterminal rooted at the exact registered root of workspace B",
  async function () {
    await agent(this).assertAttachedToExactRoot("workspace-b");
    if ((await agent(this).processId("workspace-b")) === originalWorkspaceAPids.get(this)) {
      throw new Error("Workspace B unexpectedly reused workspace A's Pi process");
    }
  },
);

Then<StoryWorld>("no workspace A input or output is delivered to workspace B", async function () {
  await agent(this).assertNoLeak("workspace-a", "workspace-b", "A-DISTINCTIVE");
});

When<StoryWorld>(
  "the person enters a distinctive workspace B interaction and returns through the existing Workspace Explorer to workspace A",
  { timeout: 30_000 },
  async function () {
    await agent(this).returnToAAfterB("B-DISTINCTIVE");
  },
);

Then<StoryWorld>(
  "the original live workspace A Pi process and bounded transcript are reattached",
  async function () {
    const pid = originalWorkspaceAPids.get(this);
    if (pid === undefined) throw new Error("Workspace A original process evidence is missing");
    await agent(this).assertReattachedA(pid);
    await agent(this).assertTranscript("workspace-a", "A-DISTINCTIVE");
  },
);

Then<StoryWorld>("no workspace B input or output is delivered to workspace A", async function () {
  await agent(this).assertNoLeak("workspace-b", "workspace-a", "B-DISTINCTIVE");
});

When<StoryWorld>(
  "the person selects workspace A's distinct file in the Files activity",
  async function () {
    await agent(this).openAFile();
  },
);

Then<StoryWorld>(
  "the existing editor authority opens that file without a second file or workspace model",
  { timeout: 30_000 },
  async function () {
    await agent(this).assertExistingEditorOpenedAFile();
  },
);

When<StoryWorld>("the person detaches the Agent screen", { timeout: 30_000 }, async function () {
  await agent(this).detachA();
});

Then<StoryWorld>(
  "one larger Agent window is pinned to workspace A and attaches to the same Pi process and session",
  { timeout: 30_000 },
  async function () {
    await agent(this).assertDetachedPinnedToA();
  },
);

When<StoryWorld>(
  "the person closes the detached Agent window and later reopens the docked Agent screen",
  { timeout: 30_000 },
  async function () {
    await agent(this).closeDetachedAndReopenDocked();
  },
);

Then<StoryWorld>(
  "workspace A Pi is still running and its bounded transcript is available for reattachment",
  async function () {
    const pid = originalWorkspaceAPids.get(this);
    if (pid === undefined) throw new Error("Workspace A original process evidence is missing");
    await agent(this).assertRunningAfterDetachedClose(pid);
    await agent(this).assertTranscript("workspace-a", "A-DISTINCTIVE");
  },
);

When<StoryWorld>("the person requests Stop Pi for workspace A", async function () {
  await agent(this).requestStopA();
});

Then<StoryWorld>(
  "a separate confirmation names workspace A and warns that the live process will terminate",
  async function () {
    await agent(this).assertNamedStopConfirmation();
  },
);

Then<StoryWorld>("cancelling the confirmation leaves Pi running", async function () {
  await agent(this).cancelStop();
});

When<StoryWorld>("the person confirms Stop Pi", { timeout: 30_000 }, async function () {
  await agent(this).confirmStopA();
});

Then<StoryWorld>("only workspace A's Pi process is terminated", async function () {
  await agent(this).assertOnlyAStopped();
});

Then<StoryWorld>("workspace B's Pi process and session remain unaffected", async function () {
  await agent(this).assertOnlyAStopped();
  await agent(this).assertSessionMetadataOnly("workspace-b");
});

When<StoryWorld>("Pi is started again for workspace A", { timeout: 30_000 }, async function () {
  await agent(this).restartA();
});

Then<StoryWorld>(
  "the same deterministic Pi session identifier restores Pi-owned session history",
  async function () {
    await agent(this).assertRestoredDeterministicSession();
  },
);

Then<StoryWorld>(
  "the IDE still has not created a parallel workspace, file, editor, chat, tool, extension, model, or history authority",
  async function () {
    await agent(this).assertNoParallelAuthorities();
  },
);
