import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>("a TypeScript developer has opened an authorized desktop workspace", function () {
  this.startRefactorKit062ProtocolFixture();
});

Given<StoryWorld>(
  "RefactorKit 0.6.2 advertises compiler diagnostics for TypeScript and JavaScript",
  async function () {
    await this.refactorKit062ProtocolFixture().discoverCapabilities();
  },
);

When<StoryWorld>(
  "compiler diagnostics are requested for the current source snapshot",
  async function () {
    await this.refactorKit062ProtocolFixture().requestCurrentSnapshotDiagnostics();
  },
);

Then<StoryWorld>(
  "the IDE respects all capability metadata advertised for that operation",
  function () {
    this.refactorKit062ProtocolFixture().assertOperationMetadataPreserved();
  },
);

Then<StoryWorld>(
  "diagnostics run only through a ready, qualified, and hash-bound RefactorKit 0.6.2 semantic toolchain",
  function () {
    this.refactorKit062ProtocolFixture().assertQualifiedSnapshotRequest();
  },
);

Then<StoryWorld>(
  "exact compiler diagnostics for the current authorized workspace appear in the existing Problems experience and Monaco editor diagnostics",
  function () {
    this.refactorKit062ProtocolFixture().assertStructuredDiagnosticsAvailableForExistingSurfaces();
  },
);

Then<StoryWorld>(
  "results from a stale workspace, session, or source snapshot are rejected",
  function () {
    this.refactorKit062ProtocolFixture().assertStaleAuthorityRejected();
  },
);

Then<StoryWorld>(
  "unavailable or refused readiness is presented honestly in the existing Language Tooling UI",
  function () {
    this.refactorKit062ProtocolFixture().assertReadinessIsRepresentable();
  },
);

Then<StoryWorld>(
  "the diagnostic operation does not write to the workspace or execute project scripts",
  function () {
    this.refactorKit062ProtocolFixture().assertReadOnlyExecution();
  },
);

Then<StoryWorld>("no fallback diagnostic output is shown", function () {
  this.refactorKit062ProtocolFixture().assertNoFallbackOutput();
});

Then<StoryWorld>("no TypeScript-specific panel is introduced", function () {
  this.refactorKit062ProtocolFixture().assertNoTypeScriptSpecificPanel();
});
