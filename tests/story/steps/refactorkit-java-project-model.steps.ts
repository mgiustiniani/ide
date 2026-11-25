// -----------------------------------------------------------------------------
// tests/story/steps/refactorkit-java-project-model.steps.ts
// Story BDD steps for REQ-IDE-JAVA-PROJECT-MODEL-001
// (features/refactorkit/java-project-model.feature, 6 scenarios / 32 Gherkin steps).
//
// GREEN (meaningful, honest): the Java project-model controller IS now wired.
// The production controller
// (apps/desktop/src/features/refactorkit-java-project-model/useJavaProjectModelController.ts)
// wires loadProjectModel (refresh()) to refactorKit.scan() / refactorKit.symbols()
// (real_engine.rs run_engine_scan / run_engine_symbols via the REAL
// TauriRefactorKitAdapter behind a fake Tauri invoke boundary), parses the engine
// symbols stdout (kind\tfqcn\tpath:line) into packages/classes/symbols
// (parseEngineSymbols + buildProjectModel), presents the read-only project
// model, and reports honest unavailable (ENGINE_ABSENT_REASON /
// CAPABILITY_REASON) or error (SCAN_ERROR / SYMBOLS_ERROR) — availability is
// available/unavailable/error and nothing is ever fabricated. App.tsx mounts the
// controller (line 353) and the JavaProjectModelPanel (line 686).
//
// Expected GREEN (honest):
//   - AC-001: the engine symbols scan returns packages/classes/symbols (TRUE via
//     the controller-driven adapter request) and the controller presents them as
//     the project model (modelPresented=true) -> PASS.
//   - AC-002: selecting a model location uses the guarded Java navigation
//     controller (TRUE through the production panel and controller) -> PASS.
//   - AC-003: the engine is absent (status.unavailable) or the capability is not
//     advertised (operationalSurface missing scan/symbols) and the controller
//     reports honest unavailable/error, never fabricating (TRUE) -> PASS.
//   - AC-004: the adapter extracts -> delegates -> returns (TRUE), and the
//     project model comes from RefactorKit, presented by the wired controller
//     (modelFromRefactorKit=true) -> PASS.
//   - AC-005: web-first layers stay Tauri-free and capability access is through
//     ports (TRUE) -> PASS (static).
//   - AC-006: feature stays @partial, requirement unique/reconciled, and the
//     deterministic production-path harness is distinct from direct real-CLI
//     and live GUI qualification (TRUE) -> PASS (static).
//
// Shared step wording (workspace authorization, adapter
// extract/delegate/response, web-first, status reconciliation) lives in
// shared-operational.steps.ts and is dispatched by tag scope; this file owns
// only feature-specific java-project-model steps. The focused runner imports
// this file plus shared-operational and the support glob, so no step text is
// defined twice for the focused run.
// -----------------------------------------------------------------------------

import { After, Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { StoryWorld } from "../support/world.js";
import {
  RefactorKitJavaProjectModelStorySession,
  REQUIREMENT,
  PROJECT_MODEL_OPERATIONS,
  getRefactorKitJavaProjectModelSession,
  disposeRefactorKitJavaProjectModelSession,
} from "../support/refactorkit-java-project-model.js";

/** Tag scope that disambiguates this slice's shared step wording from other slices. */
const REQUIREMENT_TAG = `@${REQUIREMENT}`;

function sessionFor(world: StoryWorld): RefactorKitJavaProjectModelStorySession {
  return getRefactorKitJavaProjectModelSession(world);
}

async function attachEvidence(
  session: RefactorKitJavaProjectModelStorySession,
  world: StoryWorld,
): Promise<void> {
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

// -----------------------------------------------------------------------------
// AC-001 — the engine symbols scan returns packages/classes/symbols and the wired
// controller presents the project model (GREEN)
// -----------------------------------------------------------------------------

// Given "an authorized Java workspace with a workspace root is presented in the
// IDE" is shared wording with java-build-run and is defined once in
// shared-operational.steps.ts with tag-scope dispatch (see the workspace
// authorization section there).

Given<StoryWorld>(
  "the provider authoritatively advertises the Java project-model capability for that workspace",
  async function () {
    const session = sessionFor(this);
    // Honest capability observation through the REAL adapter: the engine advertises
    // the Java project-model operational surface (scan/symbols) for the workspace.
    const capabilities = await session.observeCapability();
    const surface = capabilities.operationalSurface ?? [];
    assert.equal(
      PROJECT_MODEL_OPERATIONS.every((op) => surface.includes(op)),
      true,
      `${REQUIREMENT}: the provider does not authoritatively advertise the Java project-model capability`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the IDE requests the RefactorKit engine symbols scan for that workspace root",
  async function () {
    const session = sessionFor(this);
    await session.requestSymbolsScan();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the engine returns packages, classes, and symbols correlated to the workspace authority, the request, and the provider",
  async function () {
    const session = sessionFor(this);
    const outcome = await session.recordSymbolsResolution();
    // Honest: the engine symbols scan returns packages/classes/symbols via the
    // controller-driven adapter request behind the fake boundary
    // (run_refactorkit_engine_symbols through the wired controller loadProjectModel path).
    assert.equal(
      outcome.symbolsResolved,
      true,
      `${REQUIREMENT}: the engine did NOT return packages, classes, and symbols correlated to the workspace authority, the request, and the provider`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the IDE presents the packages, classes, and symbols from the engine result as the project model",
  async function () {
    const session = sessionFor(this);
    await session.presentModel();
    // GREEN: the wired controller loadProjectModel path presents the
    // packages/classes/symbols from the engine result as the project model
    // (parseEngineSymbols + buildProjectModel over the engine symbols stdout).
    assert.equal(
      session.presentationOutcome()?.modelPresented,
      true,
      `${REQUIREMENT}: the IDE did NOT present the packages, classes, and symbols from the engine result as the project model — the wired controller loadProjectModel path did not present the engine scan/symbols result`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the project model is not fabricated, reimplemented, or sourced from a standalone kit",
  async function () {
    const session = sessionFor(this);
    await session.assertNoFabricatedModel();
    // GREEN: the presented model is engine-sourced (verified against the captured
    // engine symbols result), no standalone kit exists, and the model is not
    // reimplemented — the controller builds read-only groupings of the engine's
    // own symbol list.
    assert.equal(
      session.fabricatedProjectModel(),
      false,
      `${REQUIREMENT}: a project model was fabricated`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-003 — the engine is absent or the surface is not advertised and the wired
// controller reports honest unavailable/error (GREEN)
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "the Java project model contains a type or member with an engine-reported path and line",
  async function () {
    const session = sessionFor(this);
    await session.start();
    await session.prepareProjectModelNavigation();
    await attachEvidence(session, this);
  },
);

When<StoryWorld>("the developer selects that type or member", async function () {
  const session = sessionFor(this);
  await session.selectProjectModelLocation();
  await attachEvidence(session, this);
});

Then<StoryWorld>(
  "the IDE opens its reported source location through the shared Java navigation controller",
  async function () {
    const session = sessionFor(this);
    const outcome = await session.verifyProjectModelNavigation();
    assert.equal(
      outcome.selectedLocationMatchesEngine,
      true,
      `${REQUIREMENT}: the panel did not select the engine-reported path and line`,
    );
    assert.equal(
      outcome.openedLocationMatchesSelection,
      true,
      `${REQUIREMENT}: the shared Java navigation controller did not open the selected location`,
    );
    assert.equal(
      outcome.applicationUsesSharedNavigationController,
      true,
      `${REQUIREMENT}: App.tsx does not route project-model navigation through the shared controller`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>("workspace-generation and active-workspace guards still apply", async function () {
  const session = sessionFor(this);
  const outcome = session.projectModelNavigationOutcome();
  assert.ok(outcome, `${REQUIREMENT}: Java navigation verification is missing`);
  assert.equal(outcome.workspaceGenerationRefused, true, `${REQUIREMENT}: stale generation was accepted`);
  assert.equal(outcome.inactiveWorkspaceRefused, true, `${REQUIREMENT}: inactive workspace was accepted`);
  assert.equal(outcome.switchingWorkspaceRefused, true, `${REQUIREMENT}: navigation during workspace switching was accepted`);
  assert.equal(outcome.metadataLoadingRefused, true, `${REQUIREMENT}: navigation during metadata loading was accepted`);
  await attachEvidence(session, this);
});

When<StoryWorld>(
  "the engine is absent or the engine symbols scan fails for that workspace root",
  async function () {
    const session = sessionFor(this);
    await session.recordHonestUnavailable();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the IDE reports the project-model capability honestly as unavailable or the scan honestly as an error",
  async function () {
    const session = sessionFor(this);
    // GREEN: the wired controller loadProjectModel path reports the capability
    // honestly as unavailable/error when the engine is absent
    // (status.unavailable -> ENGINE_ABSENT_REASON) or the capability is not
    // advertised (operationalSurface missing scan/symbols -> CAPABILITY_REASON),
    // and never fabricates a model.
    assert.equal(
      session.reportsCapabilityUnavailableOrError(),
      true,
      `${REQUIREMENT}: the IDE did NOT report the project-model capability honestly as unavailable or the scan honestly as an error — the wired controller loadProjectModel path fabricated availability`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "it neither fabricates a project model, a package\\/class\\/symbol list, a successful result, nor a fallback textual rewrite",
  async function () {
    const session = sessionFor(this);
    assert.equal(
      session.fabricatedProjectModel(),
      false,
      `${REQUIREMENT}: a project model was fabricated`,
    );
    assert.equal(
      session.fabricatedPackageClassSymbolList(),
      false,
      `${REQUIREMENT}: a package/class/symbol list was fabricated`,
    );
    assert.equal(
      session.fabricatedSuccess(),
      false,
      `${REQUIREMENT}: a successful result was fabricated`,
    );
    assert.equal(
      session.fallbackRewrite(),
      false,
      `${REQUIREMENT}: a fallback textual rewrite was fabricated`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "a browser without a conforming browser provider reports the local Java project-model capability as unavailable",
  async function () {
    const session = sessionFor(this);
    const unavailable = await session.observeBrowserUnavailable();
    assert.equal(
      unavailable,
      true,
      `${REQUIREMENT}: a browser without a conforming provider fabricated local Java project-model availability`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-004 — adapters use extract/delegate/response and the presented model is
// sourced from RefactorKit (GREEN)
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "a Java project-model request arrives at a browser or desktop adapter behind a provider-neutral port",
  async function () {
    const session = sessionFor(this);
    await session.start();
    await session.requestAdapter();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter delegates the extracted request to the owned RefactorKit scan or symbols capability",
  async function () {
    const session = sessionFor(this);
    const adapter = session.adapterOutcome();
    assert.ok(adapter, `${REQUIREMENT}: adapter outcome is missing`);
    // Honest: the real adapter delegates the extracted request to the owned engine
    // scan/symbols capability (run_refactorkit_engine_scan / run_refactorkit_engine_symbols).
    assert.equal(
      adapter.delegated,
      true,
      `${REQUIREMENT}: the adapter did NOT delegate the extracted request to the owned RefactorKit scan or symbols capability`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter returns the delegated engine response to the caller",
  async function () {
    const session = sessionFor(this);
    const adapter = session.adapterOutcome();
    assert.ok(adapter, `${REQUIREMENT}: adapter outcome is missing`);
    // Honest: the real adapter returns the delegated engine response to the caller.
    assert.equal(
      adapter.returnedResponse,
      true,
      `${REQUIREMENT}: the adapter did NOT return the delegated engine response to the caller`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter contains no hidden domain policy, no standalone project-model kit, and no reimplementation of the model",
  async function () {
    const session = sessionFor(this);
    const adapter = session.adapterOutcome();
    assert.ok(adapter, `${REQUIREMENT}: adapter outcome is missing`);
    assert.equal(adapter.noHiddenPolicy, true, `${REQUIREMENT}: the adapter hid domain policy`);
    assert.equal(
      adapter.noStandaloneProjectModelKit,
      true,
      `${REQUIREMENT}: the adapter sourced the model from a standalone project-model kit`,
    );
    assert.equal(
      adapter.noReimplementation,
      true,
      `${REQUIREMENT}: the adapter reimplemented the project model`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the project model comes from RefactorKit and is never produced by the IDE itself",
  async function () {
    const session = sessionFor(this);
    const adapter = session.adapterOutcome();
    assert.ok(adapter, `${REQUIREMENT}: adapter outcome is missing`);
    // GREEN: the wired controller presents the model built from the delegated
    // engine response (buildProjectModel over the engine symbols result), so the
    // project model comes from RefactorKit and is never produced by the IDE itself.
    assert.equal(
      adapter.modelFromRefactorKit,
      true,
      `${REQUIREMENT}: the project model does NOT come from RefactorKit and is produced by the IDE itself — the wired controller loadProjectModel path did not present the engine scan/symbols result as the project model`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-005 — web frontend stays Tauri-free at the platform boundary (PASS, static)
// -----------------------------------------------------------------------------

When<StoryWorld>(
  "the Java project-model capability is exercised through the browser profile",
  async function () {
    const session = sessionFor(this);
    await session.observeBrowserCapability();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "browser and desktop project-model implementations live behind frontend ports, not platform APIs",
  async function () {
    const session = sessionFor(this);
    const ports = session.portCapabilityEvidence();
    assert.ok(ports.length === 1, `${REQUIREMENT}: port capability evidence is incomplete`);
    for (const port of ports) {
      assert.equal(
        port.declaresInterface,
        true,
        `${REQUIREMENT}: ${port.port} does not declare a port interface`,
      );
      assert.equal(port.tauriImports, 0, `${REQUIREMENT}: ${port.port} imports a platform API`);
    }
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-006 — implementation status reflects partial verification (PASS, static)
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "the production project-model controller, adapter, and panel are implemented",
  async function () {
    const session = sessionFor(this);
    await session.start();
    const gap = session.productionGap();
    assert.equal(gap.engineDefinesScanSymbolsCommands, true, `${REQUIREMENT}: engine scan/symbols are missing`);
    assert.equal(gap.adapterDelegatesScanSymbols, true, `${REQUIREMENT}: adapter scan/symbols delegation is missing`);
    assert.equal(gap.controllerProjectModelWired, true, `${REQUIREMENT}: production controller/panel wiring is missing`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  'the Java project-model feature declares exactly one effective status "@partial" at feature level',
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.equal(
      new Set(reconciliation.featureStatusTags).size,
      1,
      `${REQUIREMENT}: feature must declare exactly one effective status at feature level`,
    );
    assert.ok(
      reconciliation.featureStatusTags.includes("@partial"),
      `${REQUIREMENT}: feature does not declare @partial`,
    );
    assert.equal(
      reconciliation.scenarioStatusTags.length,
      0,
      `${REQUIREMENT}: a scenario overrides the feature-level status`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  'the requirement ID "@REQ-IDE-JAVA-PROJECT-MODEL-001" is repository-unique and reconciled',
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.ok(
      reconciliation.requirementTags.includes(`@${REQUIREMENT}`),
      `${REQUIREMENT}: requirement ID is not declared`,
    );
    const uniqueness = session.requirementOccurrences();
    assert.equal(
      uniqueness.unique,
      true,
      `${REQUIREMENT}: requirement ID is not repository-unique`,
    );
    assert.ok(
      uniqueness.occurrences >= 5,
      `${REQUIREMENT}: requirement ID is not reconciled across scenarios`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "production code and deterministic controller tests do not imply direct real CLI qualification",
  async function () {
    const session = sessionFor(this);
    // The production path is present, but the deterministic harness does not
    // qualify direct real-CLI scan/symbols output through the live panel.
    const gap = session.productionGap();
    assert.equal(
      gap.engineDefinesScanSymbolsCommands,
      true,
      `${REQUIREMENT}: the engine does not define run_engine_scan / run_engine_symbols`,
    );
    assert.equal(
      gap.adapterDelegatesScanSymbols,
      true,
      `${REQUIREMENT}: the TauriRefactorKitAdapter does not delegate scan() / symbols()`,
    );
    assert.equal(
      gap.controllerProjectModelWired,
      true,
      `${REQUIREMENT}: the controller project-model path is not wired — GREEN requires the controller path and App.tsx panel wiring`,
    );
    const evidence = session.evidence();
    assert.equal(evidence.evidenceKind, "tauri-harness", `${REQUIREMENT}: harness evidence kind mismatch`);
    assert.equal(evidence.nativeGui, false, `${REQUIREMENT}: harness evidence claims native GUI coverage`);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@partial"),
      `${REQUIREMENT}: declared status does not match the implemented partial scope`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "direct scan\\/symbols CLI verification, live GUI behavior, packaging, and platform coverage are reported separately",
  async function () {
    const session = sessionFor(this);
    // This GREEN drives the real controller and adapter through a deterministic
    // in-process boundary behind the fake Tauri invoke seam. It does not prove
    // direct real-CLI scan/symbols output through the live panel, packaging, or
    // platform coverage.
    const evidence = session.evidence();
    assert.equal(evidence.evidenceKind, "tauri-harness", `${REQUIREMENT}: evidence kind mismatch`);
    assert.equal(
      evidence.nativeGui,
      false,
      `${REQUIREMENT}: native GUI evidence is not reported separately`,
    );
    assert.equal(evidence.e2e, false, `${REQUIREMENT}: e2e evidence is not reported separately`);
    assert.equal(
      evidence.packagedApplication,
      false,
      `${REQUIREMENT}: packaging evidence is not reported separately`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "headless or bounded GUI evidence does not silently upgrade the declared status",
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@partial"),
      `${REQUIREMENT}: bounded GUI evidence silently upgraded the declared status`,
    );
    assert.equal(
      reconciliation.scenarioStatusTags.length,
      0,
      `${REQUIREMENT}: unvalidated headless e2e silently upgraded a scenario status`,
    );
    await attachEvidence(session, this);
  },
);

After<StoryWorld>({ tags: REQUIREMENT_TAG }, async function () {
  const session = getRefactorKitJavaProjectModelSession(this);
  if (session !== undefined) {
    session.dispose();
    await attachEvidence(session, this);
    disposeRefactorKitJavaProjectModelSession(this);
  }
});
