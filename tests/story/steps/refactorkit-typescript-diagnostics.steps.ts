import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>("a TypeScript developer has opened an authorized desktop workspace", function () {
  this.startRefactorKit070SnapshotDiagnosticsFixture();
});

Given<StoryWorld>(
  "the approved source-built RefactorKit 0.7.0-SNAPSHOT advertises diagnostics.v2 for TypeScript and JavaScript",
  async function () {
    await this.refactorKit070SnapshotDiagnosticsFixture().discoverDiagnosticsV2Capabilities();
  },
);

Given<StoryWorld>(
  "that snapshot is bound to accepted exact-source, clean-build, executable, compiler-process, and bounded workspace-audit evidence",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertAcceptedSnapshotEvidenceBound();
  },
);

When<StoryWorld>(
  "compiler diagnostics are requested for the current source snapshot",
  async function () {
    await this.refactorKit070SnapshotDiagnosticsFixture().requestCurrentSnapshotDiagnostics();
  },
);

Then<StoryWorld>(
  "the IDE retains and enforces all capability metadata advertised for diagnostics.v2",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertDiagnosticsV2CapabilityMetadataPreserved();
  },
);

Then<StoryWorld>(
  "the request and every response use schema version 2 with the same operation and request identity",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertSchemaAndCorrelation();
  },
);

Then<StoryWorld>(
  "processing continues only for a structured ready status, while a structured refused or error status stops it",
  async function () {
    await this.refactorKit070SnapshotDiagnosticsFixture().assertStructuredStatusGate();
  },
);

Then<StoryWorld>(
  "diagnostics run only through the exact compiler backend and attestation accepted for that source-built snapshot",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertExactCompilerBackendAndAttestation();
  },
);

Then<StoryWorld>(
  "every accepted diagnostic preserves the exact compiler result and exact UTF-16 source range",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertExactCompilerDiagnosticAndUtf16Range();
  },
);

Then<StoryWorld>(
  "every status and diagnostic response matches the current workspace, workspace generation, semantic session, source snapshot, semantic lease, and source authority",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertAuthorityCorrelated();
  },
);

Then<StoryWorld>(
  "stale or mismatched status and diagnostic results are rejected before they can replace current IDE state",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertStaleAuthorityRejected();
  },
);

Then<StoryWorld>(
  "only complete responses within the advertised runtime and response bounds are accepted",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertCompleteBoundedResponse();
  },
);

Then<StoryWorld>(
  "exact compiler diagnostics for the current authorized workspace appear in the existing Problems experience and Monaco editor diagnostics",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertStructuredDiagnosticsAvailableForExistingSurfaces();
  },
);

Then<StoryWorld>(
  "checking, ready, refused, and error states are presented honestly in the existing Language Tooling UI",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertLanguageToolingStatesPresentedHonestly();
  },
);

Then<StoryWorld>(
  "the diagnostic operation does not write to the workspace or execute project scripts",
  function () {
    this.refactorKit070SnapshotDiagnosticsFixture().assertReadOnlyExecution();
  },
);

Then<StoryWorld>("no fallback diagnostic output is shown", function () {
  this.refactorKit070SnapshotDiagnosticsFixture().assertNoFallbackOutput();
});

Then<StoryWorld>("no TypeScript-specific panel is introduced", function () {
  this.refactorKit070SnapshotDiagnosticsFixture().assertNoTypeScriptSpecificPanel();
});
