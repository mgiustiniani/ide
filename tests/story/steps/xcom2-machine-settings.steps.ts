import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given(
  "the deterministic desktop Tauri harness cold-starts the production App on generic non-XCOM workspace {string}",
  async function (this: StoryWorld, workspaceName: string) {
    await this.createXcom2MachineSettingsSession(workspaceName);
  },
);

Given(
  "the harness drives the production controllers and typed Tauri adapters through a fake in-process Tauri command backend and fake timers",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertHarnessBoundary();
  },
);

Given("Settings is closed", function (this: StoryWorld) {
  this.xcom2MachineSettingsSession().assertSettingsClosed();
});

When("that workspace becomes ready", async function (this: StoryWorld) {
  const session = this.xcom2MachineSettingsSession();
  await session.settle();
  session.assertWorkspaceReady("generic-cold");
});

When(
  "the person switches to another generic non-XCOM workspace named {string} while Settings remains closed",
  async function (this: StoryWorld, workspaceName: string) {
    await this.xcom2MachineSettingsSession().switchWorkspace(workspaceName);
  },
);

Then(
  "for both generic workspaces the backend records zero XCOM monitor snapshot or refresh calls",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertNoClosedMonitorReads();
  },
);

Then("it records zero XCOM transaction history or detail calls", function (this: StoryWorld) {
  this.xcom2MachineSettingsSession().assertNoClosedTransactionReads();
});

Then("it records zero XCOM event-poll or subscription calls", function (this: StoryWorld) {
  this.xcom2MachineSettingsSession().assertNoClosedPollOrSubscriptions();
});

Then(
  "neither workspace receives an XCOM activity or bottom contribution",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertNoXcomContributions();
  },
);

When(
  "the person opens machine Settings for {string}",
  async function (this: StoryWorld, workspaceName: string) {
    await this.xcom2MachineSettingsSession().openMachineSettings(workspaceName);
  },
);

Then(
  "exactly one bounded XCOM monitor lifecycle and one bounded XCOM transaction lifecycle are active for the current workspace",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertFirstLifecycleActive();
  },
);

Then(
  "each lifecycle owns only its corresponding subscription and poll timer",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertLifecycleOwnsOneTimerEach();
  },
);

Then(
  "the backend obtains exactly one fresh XCOM monitor snapshot and exactly one XCOM transaction-history load for the current workspace",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertFirstOpenLoads();
  },
);

Then(
  "machine Settings adds no XCOM activity or bottom contribution and does not activate an XCOM module",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertSettingsDoesNotActivateXcom();
  },
);

When("the person requests one manual XCOM refresh", async function (this: StoryWorld) {
  await this.xcom2MachineSettingsSession().manualRefresh();
});

Then(
  "the backend performs exactly one XCOM monitor refresh and exactly one additional XCOM transaction-history load",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertManualRefreshCalls();
  },
);

Then("no duplicate lifecycle, poll timer, or subscription is created", function (this: StoryWorld) {
  this.xcom2MachineSettingsSession().assertNoDuplicateFirstLifecycle();
});

When("the person closes Settings", async function (this: StoryWorld) {
  await this.xcom2MachineSettingsSession().closeSettings();
});

Then(
  "the XCOM monitor and transaction subscriptions and poll timers are cancelled",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertLifecyclesCancelled();
  },
);

When(
  "the fake clock advances by five configured monitor and transaction poll intervals",
  async function (this: StoryWorld) {
    await this.xcom2MachineSettingsSession().advanceFivePollIntervals();
  },
);

Then(
  "the complete XCOM native-call transcript remains unchanged from the moment Settings closed",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertClosedTranscriptImmutable();
  },
);

When(
  "the person reopens machine Settings for {string}",
  async function (this: StoryWorld, workspaceName: string) {
    await this.xcom2MachineSettingsSession().openMachineSettings(workspaceName, true);
  },
);

Then(
  "exactly one new bounded XCOM monitor lifecycle and one new bounded XCOM transaction lifecycle are active",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertReopenedLifecycleActive();
  },
);

Then("all earlier lifecycle generations remain cancelled", function (this: StoryWorld) {
  this.xcom2MachineSettingsSession().assertEarlierGenerationsCancelled();
});

Then(
  "the backend obtains exactly one new fresh XCOM monitor snapshot and exactly one new XCOM transaction-history load",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertReopenLoads();
  },
);

Then(
  "no native call is duplicated by an earlier lifecycle generation",
  function (this: StoryWorld) {
    this.xcom2MachineSettingsSession().assertNoEarlierGenerationDuplicates();
  },
);
