import { Given, Then, When, type DataTable } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

function session(world: StoryWorld) {
  return world.nativeXcom2MachineSettingsMissingSteamSession();
}

function fieldRows(dataTable: DataTable): Array<{ field: string; value: string }> {
  return dataTable.hashes().map((row) => ({
    field: row.field ?? "",
    value: row.value ?? "",
  }));
}

Given<StoryWorld>(
  "one scenario-owned sandbox contains these distinct empty locations before application launch:",
  async function (dataTable: DataTable) {
    const missingSteamSession = this.createNativeXcom2MachineSettingsMissingSteamSession();
    await missingSteamSession.allocateEmptyScenario(
      dataTable.hashes().map((row) => ({
        binding: row["environment binding or resource"] ?? "",
        location: row["empty scenario-owned location"] ?? "",
      })),
    );
  },
);

When<StoryWorld>(
  /^a freshly built production release\/no-bundle Tauri executable is launched directly on Linux X11 for the authorized generic workspace$/,
  { timeout: 35_000 },
  async function () {
    await session(this).launch();
  },
);

When<StoryWorld>("its production WebKit DOM viewport is exactly 1440x900", async function () {
  await session(this).assertViewport();
});

Then<StoryWorld>(
  "the generic workspace becomes ready in that fresh process",
  { timeout: 20_000 },
  async function () {
    await session(this).assertWorkspaceReady();
  },
);

When<StoryWorld>(
  "the person activates the visible {string} control",
  async function (name: string) {
    await session(this).activateVisibleControl(name);
  },
);

Then<StoryWorld>(
  "an accessible modal dialog named {string} is visible",
  async function (name: string) {
    await session(this).assertSettingsDialog(name);
  },
);

When<StoryWorld>(
  "the person uses the {string} navigation and selects the tab with label {string} and description {string}",
  async function (navigationName: string, label: string, description: string) {
    await session(this).selectSettingsTab(navigationName, label, description);
  },
);

Then<StoryWorld>("the {string} tab is selected", async function (label: string) {
  await session(this).assertTabSelected(label);
});

Then<StoryWorld>(
  "the selected section presents the accessible heading {string}",
  async function (text: string) {
    await session(this).assertHeading(text);
  },
);

Then<StoryWorld>("it presents the exact badge {string}", async function (text: string) {
  await session(this).assertBadge(text);
});

Then<StoryWorld>(
  "it presents a focusable scroll region named {string}",
  async function (name: string) {
    await session(this).assertFocusableDetailsRegion(name);
  },
);

Then<StoryWorld>(
  "that region contains one note with exactly {string}",
  { timeout: 20_000 },
  async function (text: string) {
    await session(this).assertExactMissingSteamNote(text);
  },
);

Then<StoryWorld>("{string} shows exactly:", async function (name: string, dataTable: DataTable) {
  await session(this).assertAggregateFields(name, fieldRows(dataTable));
});

Then<StoryWorld>("its ordered setup blockers are exactly:", async function (dataTable: DataTable) {
  await session(this).assertOrderedBlockers(
    dataTable.hashes().map((row) => ({
      position: row.position ?? "",
      value: row.blocker ?? "",
    })),
  );
});

Then<StoryWorld>(
  "{string} contains exactly these product cards:",
  async function (name: string, dataTable: DataTable) {
    await session(this).assertProductCards(
      name,
      dataTable.hashes().map((row) => ({
        product: row.product ?? "",
        "Steam AppID": row["Steam AppID"] ?? "",
        role: row.role ?? "",
        "accessible lifecycle": row["accessible lifecycle"] ?? "",
      })),
    );
  },
);

Then<StoryWorld>(
  "each product card shows exactly this presentation-safe missing-product detail:",
  async function (dataTable: DataTable) {
    await session(this).assertEveryProductDetail(fieldRows(dataTable));
  },
);

Then<StoryWorld>(
  "each product card shows exactly these ordered safe mutation reasons:",
  async function (dataTable: DataTable) {
    await session(this).assertEveryProductMutationReasons(
      dataTable.hashes().map((row) => ({
        position: row.position ?? "",
        value: row.reason ?? "",
      })),
    );
  },
);

Then<StoryWorld>(
  "no product card presents manifest provenance or any manifest, install, download, or other local filesystem path",
  async function () {
    await session(this).assertNoLocalPathDisclosure();
  },
);

When<StoryWorld>(
  "the person closes the native window after collecting the rendered evidence",
  { timeout: 10_000 },
  async function () {
    await session(this).closeNativeWindow();
  },
);

Then<StoryWorld>(
  "scenario cleanup releases its Linux X11 resources and removes the scenario-owned sandbox",
  { timeout: 15_000 },
  async function () {
    await session(this).assertScenarioCleanup();
    await this.attachNativeXcom2MachineSettingsMissingSteamEvidence();
  },
);
