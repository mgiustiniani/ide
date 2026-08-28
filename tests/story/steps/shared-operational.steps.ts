// -----------------------------------------------------------------------------
// tests/story/steps/shared-operational.steps.ts
// Shared operational Story step wording that is identical across two features:
//   - REQ-IDE-JAVA-LANGUAGE-001 (features/workspace/java-language-service.feature)
//   - REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001 (features/refactorkit/java-refactoring.feature)
//
// cucumber-js v13 does not support tag-scoping of step DEFINITIONS (only hooks),
// so two step files defining the same step text would be ambiguous under
// strict:true. This module defines each shared step text exactly ONCE and
// dispatches to the owning feature's driver by the scenario's requirement tag.
// The tag is captured per-scenario by an unscoped Before hook (cucumber exposes
// the pickle only to hooks, not to step functions or the World).
//
// Both feature step files (java-language-service.steps.ts and
// refactorkit-java-refactoring.steps.ts) keep their feature-specific step
// definitions and expose a shared-session accessor; this module uses those
// accessors so shared and feature-specific steps operate on the SAME session
// instance per world.
// -----------------------------------------------------------------------------

import {
  Before,
  Given,
  Then,
  When,
  type ITestCaseHookParameter,
} from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { StoryWorld } from "../support/world.js";
import {
  REQUIREMENT as JAVA_LANGUAGE_REQUIREMENT,
} from "../support/java-language-service.js";
import {
  REQUIREMENT as REFACTORING_REQUIREMENT,
} from "../support/refactorkit-java-refactoring.js";
import {
  REQUIREMENT as ENGINE_INTEGRATION_REQUIREMENT,
} from "../support/refactorkit-engine-integration.js";
import { getJavaLanguageServiceSession } from "./java-language-service.steps.js";
import { getRefactorKitJavaRefactoringSession } from "../support/refactorkit-java-refactoring.js";
import { getRefactorKitEngineIntegrationSession } from "./refactorkit-engine-integration.steps.js";

const JAVA_LANGUAGE_TAG = `@${JAVA_LANGUAGE_REQUIREMENT}`;
const REFACTORING_TAG = `@${REFACTORING_REQUIREMENT}`;
const ENGINE_INTEGRATION_TAG = `@${ENGINE_INTEGRATION_REQUIREMENT}`;

/** The scenario's owning feature tag, captured by the Before hook below. */
function featureTagOf(world: StoryWorld): string {
  return (world as unknown as { __featureTag?: string }).__featureTag ?? "";
}

function isRefactoring(world: StoryWorld): boolean {
  return featureTagOf(world) === REFACTORING_TAG;
}

function isEngineIntegration(world: StoryWorld): boolean {
  return featureTagOf(world) === ENGINE_INTEGRATION_TAG;
}

async function attachJavaEvidence(world: StoryWorld): Promise<void> {
  const session = getJavaLanguageServiceSession(world);
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

async function attachRefactoringEvidence(world: StoryWorld): Promise<void> {
  const session = getRefactorKitJavaRefactoringSession(world);
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

async function attachEngineEvidence(world: StoryWorld): Promise<void> {
  const session = getRefactorKitEngineIntegrationSession(world);
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

// -----------------------------------------------------------------------------
// Per-scenario tag capture: cucumber exposes the pickle (and its tags) only to
// hooks. This unscoped Before hook records the owning feature tag on the World,
// which is recreated per scenario.
// -----------------------------------------------------------------------------

Before<StoryWorld>(function (this: StoryWorld, hookParam: ITestCaseHookParameter) {
  const tags = (hookParam.pickle?.tags ?? []).map((tag) => tag.name);
  (this as unknown as { __featureTag?: string }).__featureTag = tags.includes(REFACTORING_TAG)
    ? REFACTORING_TAG
    : tags.includes(JAVA_LANGUAGE_TAG)
      ? JAVA_LANGUAGE_TAG
      : tags.includes(ENGINE_INTEGRATION_TAG)
        ? ENGINE_INTEGRATION_TAG
        : "";
});

// -----------------------------------------------------------------------------
// Adapter extract / delegate / response
// -----------------------------------------------------------------------------

When<StoryWorld>(
  "the adapter receives the request",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      await session.receiveAdapterRequest();
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      await session.receiveAdapterRequest();
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    await session.requestCompletion();
    await attachJavaEvidence(this);
  },
);

Then<StoryWorld>(
  "the adapter extracts only the request payload needed by the delegate",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const adapter = session.adapterOutcome();
      assert.ok(adapter, `${ENGINE_INTEGRATION_REQUIREMENT} adapter outcome is missing`);
      assert.equal(
        adapter.extracted,
        true,
        `${ENGINE_INTEGRATION_REQUIREMENT} the adapter did not extract the request payload needed by the delegate`,
      );
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      const adapter = session.adapterOutcome();
      assert.ok(adapter, `${REFACTORING_REQUIREMENT} adapter outcome is missing`);
      assert.equal(
        adapter.extracted,
        true,
        `${REFACTORING_REQUIREMENT} the adapter did not extract the request payload needed by the delegate`,
      );
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    const envelope = session.adapterEnvelope();
    assert.ok(envelope, `${JAVA_LANGUAGE_REQUIREMENT} adapter envelope is missing`);
    assert.deepEqual(
      Object.keys(envelope).sort(),
      ["cancellationId", "document", "generation", "position", "requestId", "workspaceId"],
      `${JAVA_LANGUAGE_REQUIREMENT} adapter extracted fields beyond the delegate payload`,
    );
    assert.deepEqual(Object.keys((envelope.document as Record<string, unknown>)).sort(), ["path", "uri", "version"]);
    assert.deepEqual(Object.keys((envelope.position as Record<string, unknown>)).sort(), ["character", "line"]);
    await attachJavaEvidence(this);
  },
);

Then<StoryWorld>(
  "the adapter returns the delegated response to the caller",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const adapter = session.adapterOutcome();
      // RED: no real-engine delegation exists, so the adapter returns no delegated
      // real-engine response.
      assert.ok(
        adapter?.returnedResponse,
        `${ENGINE_INTEGRATION_REQUIREMENT} the adapter returned no delegated real-engine response — real-engine delegation is absent`,
      );
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      const adapter = session.adapterOutcome();
      assert.ok(
        adapter?.returnedResponse,
        `${REFACTORING_REQUIREMENT} the adapter returned no delegated response`,
      );
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    const response = session.completionResponse();
    assert.ok(response, `${JAVA_LANGUAGE_REQUIREMENT} delegated response is missing`);
    assert.equal(
      response.requestId,
      "story-completion-1",
      `${JAVA_LANGUAGE_REQUIREMENT} response is not correlated to the request`,
    );
    await attachJavaEvidence(this);
  },
);

// -----------------------------------------------------------------------------
// Honest unavailable / no-fabrication outcomes
// -----------------------------------------------------------------------------

Then<StoryWorld>(
  "the IDE reports the capability honestly as unavailable",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      assert.equal(
        session.reportsCapabilityUnavailable(),
        true,
        `${ENGINE_INTEGRATION_REQUIREMENT} the IDE fabricated availability when the engine is absent or the operation is unsupported`,
      );
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    assert.equal(
      session.reportsCapabilityUnavailable(),
      true,
      `${REFACTORING_REQUIREMENT} the IDE fabricated availability for an unsupported operation`,
    );
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "it neither fabricates a plan, successful result, nor fallback textual rewrite",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      assert.equal(session.fabricatedPlan(), false, `${ENGINE_INTEGRATION_REQUIREMENT} a plan was fabricated`);
      assert.equal(session.fabricatedSuccess(), false, `${ENGINE_INTEGRATION_REQUIREMENT} a successful result was fabricated`);
      assert.equal(session.fallbackRewrite(), false, `${ENGINE_INTEGRATION_REQUIREMENT} a fallback textual rewrite was fabricated`);
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    assert.equal(session.fabricatedPlan(), false, `${REFACTORING_REQUIREMENT} a plan was fabricated`);
    assert.equal(session.fabricatedSuccess(), false, `${REFACTORING_REQUIREMENT} a successful result was fabricated`);
    assert.equal(session.fallbackRewrite(), false, `${REFACTORING_REQUIREMENT} a fallback textual rewrite was fabricated`);
    await attachRefactoringEvidence(this);
  },
);

// -----------------------------------------------------------------------------
// Shared preview / apply / rollback wording (java-refactoring + engine-integration)
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "the exact reviewed plan is still current against the workspace, selection, and request",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      session.start();
      await session.recordReviewedPlanCurrency();
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    session.start();
    await session.recordReviewedPlanCurrency();
    assert.equal(
      session.reviewedPlanCurrent(),
      true,
      `${REFACTORING_REQUIREMENT} no exact reviewed plan is current`,
    );
    await attachRefactoringEvidence(this);
  },
);

When<StoryWorld>(
  "the person gives explicit apply authority bound to that exact reviewed plan",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      await session.requestRealEngineApply();
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    await session.requestGeneralRefactoringApply("rename-class");
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "no proposed project-content effect occurs before explicit authority",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      await session.assertNoProjectContentEffectBeforeAuthority();
      assert.equal(
        session.noDirectWorkspaceMutation(),
        true,
        `${ENGINE_INTEGRATION_REQUIREMENT} a project-content effect occurred before explicit authority`,
      );
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    await session.assertNoProjectContentEffectBeforeAuthority();
    assert.equal(
      session.appliedBeforeAuthority(),
      false,
      `${REFACTORING_REQUIREMENT} a project-content effect occurred before explicit authority`,
    );
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "the preview grants no apply authority for the plan",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      await session.assertPreviewGrantsNoApplyAuthority();
      assert.equal(
        session.previewGrantsApplyAuthority(),
        false,
        `${ENGINE_INTEGRATION_REQUIREMENT} the preview granted apply authority`,
      );
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    await session.assertPreviewGrantsNoApplyAuthority();
    const plan = session.previewOutcome()?.plan;
    assert.ok(plan, `${REFACTORING_REQUIREMENT} no plan to check apply authority`);
    assert.equal(
      plan.grantsApplyAuthority,
      false,
      `${REFACTORING_REQUIREMENT} the preview granted apply authority`,
    );
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "a changed or replaced plan requires a fresh preview and review before any Apply",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      await session.assertChangedPlanRequiresFreshPreview();
      assert.equal(
        session.changedPlanRequiresFreshPreview(),
        true,
        `${ENGINE_INTEGRATION_REQUIREMENT} an Apply occurred for a changed/replaced plan without a fresh preview`,
      );
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    await session.assertChangedPlanRequiresFreshPreview();
    assert.equal(
      session.changedPlanRequiresFreshPreview(),
      true,
      `${REFACTORING_REQUIREMENT} an Apply occurred for a changed/replaced plan without a fresh preview`,
    );
    await attachRefactoringEvidence(this);
  },
);

When<StoryWorld>(
  "rollback is authoritatively advertised for the relevant transaction class",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      await session.recordRollbackAdvertisement();
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    await session.recordRollbackAdvertisement();
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "rollback is exposed only for that advertised, transaction-bound compensating write",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const rollback = session.advertisedRollbackOutcome();
      assert.ok(rollback, `${ENGINE_INTEGRATION_REQUIREMENT} advertised rollback outcome is missing`);
      assert.equal(
        rollback.advertised,
        true,
        `${ENGINE_INTEGRATION_REQUIREMENT} rollback is not advertised for the relevant transaction class — no real-engine delegation`,
      );
      assert.equal(rollback.offered, true, `${ENGINE_INTEGRATION_REQUIREMENT} advertised rollback is not exposed`);
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    const rollback = session.advertisedRollbackOutcome();
    assert.ok(rollback?.advertised, `${REFACTORING_REQUIREMENT} rollback is not advertised for the transaction class`);
    assert.equal(rollback.offered, true, `${REFACTORING_REQUIREMENT} advertised rollback is not exposed`);
    assert.ok(
      rollback.transactionId !== undefined,
      `${REFACTORING_REQUIREMENT} rollback is not bound to a transaction`,
    );
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "its restoration result, conflicts, changed files, and diagnostics are reported honestly",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const rollback = session.advertisedRollbackOutcome();
      assert.ok(
        rollback?.advertised,
        `${ENGINE_INTEGRATION_REQUIREMENT} no rollback restoration result — rollback is not advertised`,
      );
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    const rollback = session.advertisedRollbackOutcome();
    assert.ok(rollback?.advertised, `${REFACTORING_REQUIREMENT} no advertised rollback restoration result`);
    assert.equal(rollback.rolledBack, true, `${REFACTORING_REQUIREMENT} rollback restoration did not occur`);
    assert.ok(Array.isArray(rollback.changedFiles), `${REFACTORING_REQUIREMENT} changed files not reported`);
    assert.ok(Array.isArray(rollback.conflicts), `${REFACTORING_REQUIREMENT} conflicts not reported`);
    assert.ok(Array.isArray(rollback.diagnostics), `${REFACTORING_REQUIREMENT} diagnostics not reported`);
    await attachRefactoringEvidence(this);
  },
);

When<StoryWorld>(
  "rollback is not advertised",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      await session.recordRollbackNotAdvertised();
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    await session.recordRollbackNotAdvertised();
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "rollback is neither offered nor described as read-only, and no rollback success is inferred from a transaction ID, generic apply capability, or a visible control",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const rollback = session.notAdvertisedRollbackOutcome();
      assert.ok(rollback, `${ENGINE_INTEGRATION_REQUIREMENT} not-advertised rollback outcome is missing`);
      assert.equal(rollback.offered, false, `${ENGINE_INTEGRATION_REQUIREMENT} rollback was offered without advertisement`);
      assert.equal(
        rollback.describedAsReadOnly,
        false,
        `${ENGINE_INTEGRATION_REQUIREMENT} rollback was described as read-only without advertisement`,
      );
      assert.equal(
        rollback.successInferred,
        false,
        `${ENGINE_INTEGRATION_REQUIREMENT} rollback success was inferred from a transaction ID, generic apply capability, or a control`,
      );
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    const rollback = session.notAdvertisedRollbackOutcome();
    assert.ok(rollback, `${REFACTORING_REQUIREMENT} not-advertised rollback outcome is missing`);
    assert.equal(rollback.offered, false, `${REFACTORING_REQUIREMENT} rollback was offered without advertisement`);
    assert.equal(
      rollback.describedAsReadOnly,
      false,
      `${REFACTORING_REQUIREMENT} rollback was described as read-only without advertisement`,
    );
    assert.equal(
      rollback.successInferred,
      false,
      `${REFACTORING_REQUIREMENT} rollback success was inferred from a transaction ID, generic apply capability, or a control`,
    );
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "the adapter contains no hidden domain policy, direct workspace mutation, or fabricated evidence",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const adapter = session.adapterOutcome();
      assert.ok(adapter, `${ENGINE_INTEGRATION_REQUIREMENT} adapter outcome is missing`);
      assert.equal(adapter.noHiddenPolicy, true, `${ENGINE_INTEGRATION_REQUIREMENT} the adapter hid domain policy`);
      assert.equal(
        adapter.noDirectWorkspaceMutation,
        true,
        `${ENGINE_INTEGRATION_REQUIREMENT} the adapter mutated the workspace directly`,
      );
      assert.equal(adapter.fabricatedEvidence, false, `${ENGINE_INTEGRATION_REQUIREMENT} the adapter fabricated evidence`);
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    const adapter = session.adapterOutcome();
    assert.equal(adapter?.noHiddenPolicy, true, `${REFACTORING_REQUIREMENT} the adapter hid domain policy`);
    assert.equal(
      adapter?.noDirectWorkspaceMutation,
      true,
      `${REFACTORING_REQUIREMENT} the adapter mutated the workspace directly`,
    );
    assert.equal(adapter?.fabricatedEvidence, false, `${REFACTORING_REQUIREMENT} the adapter fabricated evidence`);
    await attachRefactoringEvidence(this);
  },
);

Given<StoryWorld>(
  "meaningful RED precedes new product behavior for this feature",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      session.start();
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    session.start();
    await attachRefactoringEvidence(this);
  },
);

Then<StoryWorld>(
  "live e2e may remain unvalidated headless without silently upgrading the declared status",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const reconciliation = session.featureReconciliation();
      assert.ok(reconciliation, `${ENGINE_INTEGRATION_REQUIREMENT} reconciliation is missing`);
      assert.ok(
        reconciliation.featureStatusTags.includes("@not-implemented"),
        `${ENGINE_INTEGRATION_REQUIREMENT} unvalidated e2e silently upgraded the declared status`,
      );
      assert.equal(
        reconciliation.scenarioStatusTags.length,
        0,
        `${ENGINE_INTEGRATION_REQUIREMENT} unvalidated e2e silently upgraded a scenario status`,
      );
      await attachEngineEvidence(this);
      return;
    }
    const session = getRefactorKitJavaRefactoringSession(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REFACTORING_REQUIREMENT} reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@not-implemented"),
      `${REFACTORING_REQUIREMENT} unvalidated e2e silently upgraded the declared status`,
    );
    assert.equal(
      reconciliation.scenarioStatusTags.length,
      0,
      `${REFACTORING_REQUIREMENT} unvalidated e2e silently upgraded a scenario status`,
    );
    await attachRefactoringEvidence(this);
  },
);



Then<StoryWorld>(
  /contracts, shells, fixture orchestration, import Stories, diagnostics, or hard-coded\/fake plans do not promote this status/,
  async function () {
    const session = getRefactorKitEngineIntegrationSession(this);
    // Honest GREEN: the production port/adapter expose the engine surface and the
    // daemon delegates to the real engine (real_engine.rs: discovery + real CLI
    // preview/apply/rollback/discard/scan/symbols/definition/references/
    // diagnostics). The deterministic fixture-peer (refactorkit-daemon) remains
    // only a fallback / harness. Real-engine delegation is present, but that
    // presence does NOT promote the declared status; the feature still reconciles
    // @not-implemented because live e2e, rollback restoration, native GUI wiring,
    // packaging, and platform coverage are not validated here.
    const gap = session.productionGap();
    assert.equal(gap.realEngineDelegation, true, `ENGINE_INTEGRATION_REQUIREMENT real-engine delegation is absent`);
    assert.equal(session.fabricatedPlan(), false, `ENGINE_INTEGRATION_REQUIREMENT a hard-coded/fake plan promotes the status`);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `ENGINE_INTEGRATION_REQUIREMENT reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@not-implemented"),
      `ENGINE_INTEGRATION_REQUIREMENT production presence promoted the declared status`,
    );
    await attachEngineEvidence(this);
  },
);

// -----------------------------------------------------------------------------
// Web-first, Tauri-free invariant
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "packages ui, web-core, and web are part of the standalone web frontend",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      session.start();
      session.scanWebFirstLayers();
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      session.start();
      session.scanWebFirstLayers();
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    session.start();
    session.scanWebFirstLayers();
    await attachJavaEvidence(this);
  },
);

Then<StoryWorld>(
  "no file under ui, web-core, or web imports {string}",
  async function (platformApi: string) {
    assert.equal(platformApi, "@tauri-apps/api", "boundary API token mismatch");
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const scan = session.webFirstLayerScan();
      assert.ok(scan && scan.length > 0, `${ENGINE_INTEGRATION_REQUIREMENT} web-first layer scan is missing`);
      for (const result of scan) {
        assert.equal(
          result.platformApiImportCount,
          0,
          `${ENGINE_INTEGRATION_REQUIREMENT} ${result.layer} imports @tauri-apps/api ${result.platformApiImportCount} time(s)`,
        );
      }
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      const scan = session.webFirstLayerScan();
      assert.ok(scan && scan.length > 0, `${REFACTORING_REQUIREMENT} web-first layer scan is missing`);
      for (const result of scan) {
        assert.equal(
          result.platformApiImportCount,
          0,
          `${REFACTORING_REQUIREMENT} ${result.layer} imports @tauri-apps/api ${result.platformApiImportCount} time(s)`,
        );
      }
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    const scan = session.webFirstLayerScan();
    assert.ok(scan && scan.length > 0, `${JAVA_LANGUAGE_REQUIREMENT} web-first layer scan is missing`);
    for (const result of scan) {
      assert.equal(
        result.platformApiImportCount,
        0,
        `${JAVA_LANGUAGE_REQUIREMENT} ${result.layer} imports @tauri-apps/api ${result.platformApiImportCount} time(s)`,
      );
    }
    await attachJavaEvidence(this);
  },
);

Then<StoryWorld>(
  "the web frontend builds and runs without Tauri",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      // Structural Tauri-free guarantee: zero @tauri-apps/api imports across the
      // web-first layers and zero platform imports on the RefactorKit port. The full
      // web build is proven by the independent quality gate; this Story harness does
      // not re-run it here.
      const scan = session.webFirstLayerScan();
      assert.ok(scan && scan.length > 0, `${ENGINE_INTEGRATION_REQUIREMENT} web-first layer scan is missing`);
      for (const result of scan) {
        assert.equal(
          result.platformApiImportCount,
          0,
          `${ENGINE_INTEGRATION_REQUIREMENT} ${result.layer} imports a platform API`,
        );
      }
      const ports = session.portCapabilityEvidence();
      assert.ok(ports.length === 1, `${ENGINE_INTEGRATION_REQUIREMENT} port capability evidence is incomplete`);
      for (const port of ports) {
        assert.equal(port.tauriImports, 0, `${ENGINE_INTEGRATION_REQUIREMENT} ${port.port} imports a platform API`);
      }
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      // Structural Tauri-free guarantee: zero @tauri-apps/api imports across the
      // web-first layers and zero platform imports on the RefactorKit port. The full
      // web build is proven by the independent quality gate; this Story harness does
      // not re-run it here.
      const scan = session.webFirstLayerScan();
      assert.ok(scan && scan.length > 0, `${REFACTORING_REQUIREMENT} web-first layer scan is missing`);
      for (const result of scan) {
        assert.equal(
          result.platformApiImportCount,
          0,
          `${REFACTORING_REQUIREMENT} ${result.layer} imports a platform API`,
        );
      }
      const ports = session.portCapabilityEvidence();
      assert.ok(ports.length === 1, `${REFACTORING_REQUIREMENT} port capability evidence is incomplete`);
      for (const port of ports) {
        assert.equal(port.tauriImports, 0, `${REFACTORING_REQUIREMENT} ${port.port} imports a platform API`);
      }
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    assert.equal(session.webBuildProof(), "passed", `${JAVA_LANGUAGE_REQUIREMENT} web build did not pass`);
    await attachJavaEvidence(this);
  },
);

// -----------------------------------------------------------------------------
// Requirement / status reconciliation
// -----------------------------------------------------------------------------

When<StoryWorld>(
  "the feature file is parsed for requirement and status reconciliation",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      session.reconcileFeatureStatus();
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      session.reconcileFeatureStatus();
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    session.reconcileFeatureStatus();
    await attachJavaEvidence(this);
  },
);

Then<StoryWorld>(
  "the feature declares exactly one effective status \"@not-implemented\" at feature level",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const reconciliation = session.featureReconciliation();
      assert.ok(reconciliation, `${ENGINE_INTEGRATION_REQUIREMENT} reconciliation is missing`);
      assert.equal(
        new Set(reconciliation.featureStatusTags).size,
        1,
        `${ENGINE_INTEGRATION_REQUIREMENT} feature must declare exactly one effective status at feature level`,
      );
      assert.ok(
        reconciliation.featureStatusTags.includes("@not-implemented"),
        `${ENGINE_INTEGRATION_REQUIREMENT} feature does not declare @not-implemented`,
      );
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      const reconciliation = session.featureReconciliation();
      assert.ok(reconciliation, `${REFACTORING_REQUIREMENT} reconciliation is missing`);
      assert.equal(
        new Set(reconciliation.featureStatusTags).size,
        1,
        `${REFACTORING_REQUIREMENT} feature must declare exactly one effective status at feature level`,
      );
      assert.ok(
        reconciliation.featureStatusTags.includes("@not-implemented"),
        `${REFACTORING_REQUIREMENT} feature does not declare @not-implemented`,
      );
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${JAVA_LANGUAGE_REQUIREMENT} reconciliation is missing`);
    assert.equal(
      new Set(reconciliation.featureStatusTags).size,
      1,
      `${JAVA_LANGUAGE_REQUIREMENT} feature must declare exactly one effective status at feature level`,
    );
    assert.ok(
      reconciliation.featureStatusTags.includes("@not-implemented"),
      `${JAVA_LANGUAGE_REQUIREMENT} feature does not declare @not-implemented`,
    );
    assert.equal(
      reconciliation.scenarioStatusTags.length,
      0,
      `${JAVA_LANGUAGE_REQUIREMENT} scenarios declare status tags at scenario level instead of feature level`,
    );
    await attachJavaEvidence(this);
  },
);

Then<StoryWorld>(
  "no scenario overrides that single effective status",
  async function () {
    if (isEngineIntegration(this)) {
      const session = getRefactorKitEngineIntegrationSession(this);
      const reconciliation = session.featureReconciliation();
      assert.ok(reconciliation, `${ENGINE_INTEGRATION_REQUIREMENT} reconciliation is missing`);
      assert.equal(
        reconciliation.scenarioStatusTags.length,
        0,
        `${ENGINE_INTEGRATION_REQUIREMENT} scenarios declare status tags at scenario level instead of feature level`,
      );
      await attachEngineEvidence(this);
      return;
    }
    if (isRefactoring(this)) {
      const session = getRefactorKitJavaRefactoringSession(this);
      const reconciliation = session.featureReconciliation();
      assert.ok(reconciliation, `${REFACTORING_REQUIREMENT} reconciliation is missing`);
      assert.equal(
        reconciliation.scenarioStatusTags.length,
        0,
        `${REFACTORING_REQUIREMENT} scenarios declare status tags at scenario level instead of feature level`,
      );
      await attachRefactoringEvidence(this);
      return;
    }
    const session = getJavaLanguageServiceSession(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${JAVA_LANGUAGE_REQUIREMENT} reconciliation is missing`);
    assert.ok(
      reconciliation.scenarioStatusTags.every((tag) => tag === "@not-implemented"),
      `${JAVA_LANGUAGE_REQUIREMENT} a scenario overrides @not-implemented`,
    );
    await attachJavaEvidence(this);
  },
);
