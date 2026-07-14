import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>(
  "a TypeScript or JavaScript developer has opened an authorized desktop workspace",
  function () {
    this.startRefactorKit062ProtocolFixture();
  },
);

Given<StoryWorld>(
  "each participating TypeScript or JavaScript editor buffer matches its saved file",
  function () {
    this.refactorKit062ProtocolFixture().confirmParticipatingBuffersMatchSavedFiles();
  },
);

Given<StoryWorld>(
  "accepted RefactorKit experimental language-server capability evidence advertises workspace symbol search and semantic definition lookup for that workspace",
  async function () {
    await this.refactorKit062ProtocolFixture().discoverSymbolNavigationCapabilities();
  },
);

Given<StoryWorld>(
  "the only eligible toolchain uses external Node, typescript-language-server, and TypeScript paths explicitly approved by the developer",
  function () {
    this.refactorKit062ProtocolFixture().approveExplicitExternalToolchain();
  },
);

When<StoryWorld>(
  "the developer searches for a workspace symbol in the existing generic Search surface",
  async function () {
    await this.refactorKit062ProtocolFixture().searchWorkspaceSymbol();
  },
);

When<StoryWorld>("selects a semantic search result", async function () {
  await this.refactorKit062ProtocolFixture().selectSemanticSearchResult();
});

Then<StoryWorld>(
  "its semantic definition opens in the existing editor at the exact point reported by the provider coordinates",
  async function () {
    await this.refactorKit062ProtocolFixture().assertSemanticDefinitionOpenedAtProviderPoint();
  },
);

Then<StoryWorld>(
  "the selected result and definition come from the same authorized workspace, workspace generation, semantic session, and saved workspace snapshot",
  function () {
    this.refactorKit062ProtocolFixture().assertSymbolNavigationAuthorityCorrelated();
  },
);

Then<StoryWorld>(
  "any opaque symbol identity is passed transiently between search and definition without being entered by the developer or persisted",
  function () {
    this.refactorKit062ProtocolFixture().assertOpaqueSymbolIdentityIsTransient();
  },
);

Then<StoryWorld>(
  "semantic search and navigation are refused while a participating TypeScript or JavaScript editor buffer is dirty or has never been saved",
  async function () {
    await this.refactorKit062ProtocolFixture().assertUnsafeBuffersRefused();
  },
);

Then<StoryWorld>(
  "the Search surface discloses that results may be incomplete for dynamic or mixed JavaScript",
  function () {
    this.refactorKit062ProtocolFixture().assertSearchCompatibilityDisclosure();
  },
);

Then<StoryWorld>(
  "neither PATH nor workspace-local files are searched for semantic tooling",
  function () {
    this.refactorKit062ProtocolFixture().assertOnlyApprovedExternalToolchainEligible();
  },
);

Then<StoryWorld>(
  "unavailable semantic evidence never falls back to structural identifiers",
  function () {
    this.refactorKit062ProtocolFixture().assertNoStructuralIdentifierFallback();
  },
);

Then<StoryWorld>(
  "the operation does not execute project scripts or write to the workspace",
  function () {
    this.refactorKit062ProtocolFixture().assertReadOnlySymbolNavigation();
  },
);

Then<StoryWorld>("no TypeScript- or JavaScript-specific panel is introduced", function () {
  this.refactorKit062ProtocolFixture().assertNoScriptSpecificPanel();
});

Then<StoryWorld>("no project action is added to global Settings", function () {
  this.refactorKit062ProtocolFixture().assertNoProjectActionInGlobalSettings();
});

Then<StoryWorld>(
  "a browser without explicit desktop simulation reports the capability as unavailable",
  async function () {
    await this.refactorKit062ProtocolFixture().assertUnsimmulatedBrowserUnavailable();
  },
);
