// -----------------------------------------------------------------------------
// tests/story/steps/refactorkit-java-project-model.steps.ts
// Story BDD steps for REQ-IDE-JAVA-PROJECT-MODEL-001
// (features/refactorkit/java-project-model.feature, 5 scenarios / 31 Gherkin steps).
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
//   - AC-002: the engine is absent (status.unavailable) or the capability is not
//     advertised (operationalSurface missing scan/symbols) and the controller
//     reports honest unavailable/error, never fabricating (TRUE) -> PASS.
//   - AC-003: the adapter extracts -> delegates -> returns (TRUE), and the
//     project model comes from RefactorKit, presented by the wired controller
//     (modelFromRefactorKit=true) -> PASS.
//   - AC-004: web-first layers stay Tauri-free and capability access is through
//     ports (TRUE) -> PASS (static).
//   - AC-005: feature stays @not-implemented (live Tauri-window project-model E2E
//     is unvalidated headless), requirement unique/reconciled, and production
//     presence (controllerProjectModelWired=true) does not silently promote the
//     status (TRUE) -> PASS (static).
//
// Shared step wording (adapter extract/delegate/response, web-first, status
// reconciliation) lives in shared-operational.steps.ts and is dispatched by tag
// scope; this file owns only feature-specific java-project-model steps. The
// focused runner imports this file plus shared-operational and the support glob,
// so no step text is defined twice for the focused run.
// -----------------------------------------------------------------------------

import { After, Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { StoryWorld } from "../support/world.js";
import {
  RefactorKitJavaProjectModelStorySession,
  REQUIREMENT,
  PACKAGE,
  CLASS_FQN,
  SYMBOLS,
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

Given<StoryWorld>(
  "an authorized Java workspace with a workspace root is presented in the IDE",
  async function () {
    const session = sessionFor(this);
    await session.start();
    await attachEvidence(session, this);
  },
);

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
// AC-002 — the engine is absent or the surface is not advertised and the wired
// controller reports honest unavailable/error (GREEN)
// -----------------------------------------------------------------------------

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
    assert.equal(session.fabricatedProjectModel(), false, `${REQUIREMENT}: a project model was fabricated`);
    assert.equal(
      session.fabricatedPackageClassSymbolList(),
      false,
      `${REQUIREMENT}: a package/class/symbol list was fabricated`,
    );
    assert.equal(session.fabricatedSuccess(), false, `${REQUIREMENT}: a successful result was fabricated`);
    assert.equal(session.fallbackRewrite(), false, `${REQUIREMENT}: a fallback textual rewrite was fabricated`);
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
// AC-003 — adapters use extract/delegate/response and the presented model is
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
// AC-004 — web frontend stays Tauri-free at the platform boundary (PASS, static)
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
      assert.equal(
        port.tauriImports,
        0,
        `${REQUIREMENT}: ${port.port} imports a platform API`,
      );
    }
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-005 — implementation status is evidence-based and stays @not-implemented (PASS, static)
// -----------------------------------------------------------------------------

Then<StoryWorld>(
  "the requirement ID \"@REQ-IDE-JAVA-PROJECT-MODEL-001\" is repository-unique and reconciled",
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.ok(
      reconciliation.requirementTags.includes(`@${REQUIREMENT}`),
      `${REQUIREMENT}: requirement ID is not declared`,
    );
    const uniqueness = session.requirementOccurrences();
    assert.equal(uniqueness.unique, true, `${REQUIREMENT}: requirement ID is not repository-unique`);
    assert.ok(
      uniqueness.occurrences >= 5,
      `${REQUIREMENT}: requirement ID is not reconciled across scenarios`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "contracts, shells, import Stories, diagnostics, or hard-coded\\/fake packages, classes, or symbols do not promote this status",
  async function () {
    const session = sessionFor(this);
    // Honest GREEN status evidence: the engine defines run_engine_scan /
    // run_engine_symbols, the real adapter delegates scan() / symbols(), and the
    // CONTROLLER PROJECT-MODEL PATH is now WIRED (real production behavior).
    // Production presence does not promote the declared status: the feature still
    // reconciles @not-implemented because live Tauri-window project-model E2E is
    // unvalidated headless, and no fabricated package/class/symbol result
    // promotes it.
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
      `${REQUIREMENT}: the controller project-model path is not wired — GREEN requires the wired controller loadProjectModel path and App.tsx panel wiring`,
    );
    assert.equal(session.fabricatedProjectModel(), false, `${REQUIREMENT}: a hard-coded/fake project model promotes the status`);
    assert.equal(
      session.fabricatedPackageClassSymbolList(),
      false,
      `${REQUIREMENT}: a hard-coded/fake package/class/symbol list promotes the status`,
    );
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@not-implemented"),
      `${REQUIREMENT}: production presence promoted the declared status`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "real-engine scan\\/symbols resolution, live editor or native GUI wiring, packaging, and platform coverage are reported separately",
  async function () {
    const session = sessionFor(this);
    // Honest GREEN evidence boundaries: this GREEN drives the REAL controller and
    // adapter through a deterministic in-process engine boundary behind the fake
    // Tauri invoke seam; real-engine scan/symbols CLI resolution, live
    // editor/native-GUI wiring, packaging, and platform coverage are reported
    // separately and not claimed here.
    const evidence = session.evidence();
    assert.equal(evidence.evidenceKind, "tauri-harness", `${REQUIREMENT}: evidence kind mismatch`);
    assert.equal(evidence.nativeGui, false, `${REQUIREMENT}: native GUI evidence is not reported separately`);
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
  "live Tauri-window project-model E2E may remain unvalidated headless without silently upgrading the declared status",
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@not-implemented"),
      `${REQUIREMENT}: unvalidated headless e2e silently upgraded the declared status`,
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
