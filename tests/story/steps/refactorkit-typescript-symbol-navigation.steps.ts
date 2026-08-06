import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>(
  "a TypeScript or JavaScript developer has opened an authorized desktop workspace",
  function () {
    this.startRefactorKit070SnapshotProtocolFixture();
  },
);

Given<StoryWorld>(
  "each participating TypeScript or JavaScript editor buffer matches its saved file",
  function () {
    this.refactorKit070SnapshotProtocolFixture().confirmParticipatingBuffersMatchSavedFiles();
  },
);

Given<StoryWorld>(
  "accepted RefactorKit experimental language-server capability evidence advertises workspace symbol search and semantic definition lookup for that workspace",
  async function () {
    await this.refactorKit070SnapshotProtocolFixture().discoverSymbolNavigationCapabilities();
  },
);

Given<StoryWorld>(
  "the only eligible toolchain uses external Node, typescript-language-server, and TypeScript paths explicitly approved by the developer",
  function () {
    this.refactorKit070SnapshotProtocolFixture().approveExplicitExternalToolchain();
  },
);

When<StoryWorld>(
  "the developer searches for a workspace symbol in the existing generic Search surface",
  async function () {
    await this.refactorKit070SnapshotProtocolFixture().searchWorkspaceSymbol();
  },
);

When<StoryWorld>("selects a semantic search result", async function () {
  await this.refactorKit070SnapshotProtocolFixture().selectSemanticSearchResult();
});

Then<StoryWorld>(
  "its semantic definition opens in the existing editor at the exact point reported by the provider coordinates",
  async function () {
    await this.refactorKit070SnapshotProtocolFixture().assertSemanticDefinitionOpenedAtProviderPoint();
  },
);

Then<StoryWorld>(
  "the selected result and definition come from the same authorized workspace, workspace generation, semantic session, and saved workspace snapshot",
  function () {
    this.refactorKit070SnapshotProtocolFixture().assertSymbolNavigationAuthorityCorrelated();
  },
);

Then<StoryWorld>(
  "any opaque symbol identity is passed transiently between search and definition without being entered by the developer or persisted",
  function () {
    this.refactorKit070SnapshotProtocolFixture().assertOpaqueSymbolIdentityIsTransient();
  },
);

Then<StoryWorld>(
  "semantic search and navigation are refused while a participating TypeScript or JavaScript editor buffer is dirty or has never been saved",
  async function () {
    await this.refactorKit070SnapshotProtocolFixture().assertUnsafeBuffersRefused();
  },
);

Then<StoryWorld>(
  "the Search surface discloses that results may be incomplete for dynamic or mixed JavaScript",
  function () {
    this.refactorKit070SnapshotProtocolFixture().assertSearchCompatibilityDisclosure();
  },
);

Then<StoryWorld>(
  "neither PATH nor workspace-local files are searched for semantic tooling",
  function () {
    this.refactorKit070SnapshotProtocolFixture().assertOnlyApprovedExternalToolchainEligible();
  },
);

Then<StoryWorld>(
  "unavailable semantic evidence never falls back to structural identifiers",
  function () {
    this.refactorKit070SnapshotProtocolFixture().assertNoStructuralIdentifierFallback();
  },
);

Then<StoryWorld>(
  "the operation does not execute project scripts or write to the workspace",
  function () {
    this.refactorKit070SnapshotProtocolFixture().assertReadOnlySymbolNavigation();
  },
);

Then<StoryWorld>("no TypeScript- or JavaScript-specific panel is introduced", function () {
  this.refactorKit070SnapshotProtocolFixture().assertNoScriptSpecificPanel();
});

Then<StoryWorld>("no project action is added to global Settings", function () {
  this.refactorKit070SnapshotProtocolFixture().assertNoProjectActionInGlobalSettings();
});

Then<StoryWorld>(
  "a browser without explicit desktop simulation reports the capability as unavailable",
  async function () {
    await this.refactorKit070SnapshotProtocolFixture().assertUnsimmulatedBrowserUnavailable();
  },
);
