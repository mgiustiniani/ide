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
import { getJavaLanguageServiceSession } from "./java-language-service.steps.js";
import { getRefactorKitJavaRefactoringSession } from "./refactorkit-java-refactoring.steps.js";

const JAVA_LANGUAGE_TAG = `@${JAVA_LANGUAGE_REQUIREMENT}`;
const REFACTORING_TAG = `@${REFACTORING_REQUIREMENT}`;

/** The scenario's owning feature tag, captured by the Before hook below. */
function featureTagOf(world: StoryWorld): string {
  return (world as unknown as { __featureTag?: string }).__featureTag ?? "";
}

function isRefactoring(world: StoryWorld): boolean {
  return featureTagOf(world) === REFACTORING_TAG;
}

async function attachJavaEvidence(world: StoryWorld): Promise<void> {
  const session = getJavaLanguageServiceSession(world);
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

async function attachRefactoringEvidence(world: StoryWorld): Promise<void> {
  const session = getRefactorKitJavaRefactoringSession(world);
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
      : "";
});

// -----------------------------------------------------------------------------
// Adapter extract / delegate / response
// -----------------------------------------------------------------------------

When<StoryWorld>(
  "the adapter receives the request",
  async function () {
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
// Web-first, Tauri-free invariant
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "packages ui, web-core, and web are part of the standalone web frontend",
  async function () {
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
