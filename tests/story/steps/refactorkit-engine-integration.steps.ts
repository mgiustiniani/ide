// -----------------------------------------------------------------------------
// tests/story/steps/refactorkit-engine-integration.steps.ts
// Story BDD steps for REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001
// (features/refactorkit/engine-integration.feature, 5 scenarios / 48 Gherkin steps + 15 hooks = 63 observed).
//
// RED: real-engine delegation (engine discovery + real CLI preview/apply/rollback)
// does NOT exist in the production daemon. These steps drive the REAL
// TauriRefactorKitAdapter (and honest BrowserRefactorKitAdapter) through a fake
// in-process Tauri invoke boundary whose daemon reflects the real
// refactorkit_daemon engine-integration gap: engine discovery absent and
// preview/apply/rollback honestly unavailable / refused. Engine integration is
// never fabricated.
//
// Expected RED (honest unavailable/refused):
//   - AC-001 fails on "reports real-engine capability" and "correlated to the
//     discovered engine"; the honest-unavailable branch passes.
//   - AC-002 fails on "returns one real-engine patch plan"; the read-only /
//     no-apply-authority / fixture-harness-only branches pass.
//   - AC-003 fails on "runs the real engine transformation", "rollback is exposed
//     only for that advertised ...", and "restoration result ... reported"; the
//     honest-refusal, changed-plan, and not-advertised branches pass.
//   - AC-004 fails on "delegates the extracted request to the owned real-engine
//     capability" and "returns the delegated response"; extraction,
//     honest-unavailable, browser, web-first, and ports branches pass.
//   - AC-005 passes: status stays @not-implemented, requirement unique/reconciled,
//     production gap documented without promotion.
//
// Shared step wording (adapter extract/delegate/response, web-first, status
// reconciliation) lives in shared-operational.steps.ts and is dispatched by tag
// scope; this file owns only feature-specific engine-integration steps. The
// throwaway tmp runner imports this file plus shared-operational and the support
// glob, so no step text is defined twice for the focused run.
// -----------------------------------------------------------------------------

import { After, Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { StoryWorld } from "../support/world.js";
import {
  RefactorKitEngineIntegrationStorySession,
  REQUIREMENT,
  TARGET_FILE,
  WORKSPACE_ID,
  ENGINE_OPERATIONS,
} from "../support/refactorkit-engine-integration.js";

/** Tag scope that disambiguates this slice's shared step wording from other slices. */
const REQUIREMENT_TAG = `@${REQUIREMENT}`;

const sessions = new WeakMap<StoryWorld, RefactorKitEngineIntegrationStorySession>();

function sessionFor(world: StoryWorld): RefactorKitEngineIntegrationStorySession {
  let session = sessions.get(world);
  if (session === undefined) {
    session = new RefactorKitEngineIntegrationStorySession();
    sessions.set(world, session);
  }
  return session;
}

/**
 * Shared-session accessor used by shared-operational.steps.ts so the shared
 * adapter/web-first/status step wording and this file's feature-specific steps
 * operate on the SAME session instance per world.
 */
export function getRefactorKitEngineIntegrationSession(
  world: StoryWorld,
): RefactorKitEngineIntegrationStorySession {
  return sessionFor(world);
}

async function attachEvidence(
  session: RefactorKitEngineIntegrationStorySession,
  world: StoryWorld,
): Promise<void> {
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

// -----------------------------------------------------------------------------
// AC-001 — engine discovery yields authoritative capability and honest unavailability
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "an authorized Java workspace and the RefactorKit engine is discoverable through a wrapper PATH or an installed engine path",
  async function () {
    const session = sessionFor(this);
    session.start();
    // Honest RED: the production daemon has no wrapper-PATH / installed-engine-path
    // discovery, so the engine is recorded as NOT discovered (no fabrication).
    await session.observeEngineDiscovery();
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the IDE daemon resolves the engine for the requested operational surface",
  async function () {
    const session = sessionFor(this);
    await session.resolveEngine();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the daemon reports the real engine authoritative capability for scan, symbols, definition, references, rename, rename member, extract method, and change signature",
  async function () {
    const session = sessionFor(this);
    const outcome = await session.reportEngineCapability();
    // RED: the production daemon does NOT report a real-engine authoritative
    // capability (real-engine delegation absent; extract-method and the renamed
    // rename/change-signature surfaces are not advertised).
    assert.equal(
      outcome.reportsRealEngineCapability,
      true,
      `${REQUIREMENT}: the daemon did NOT report the real engine authoritative capability for the operational surface — real-engine delegation is absent`,
    );
    assert.equal(
      outcome.missingOperationalSurfaces.length,
      0,
      `${REQUIREMENT}: the daemon did not advertise ${[...outcome.missingOperationalSurfaces].join(", ")}`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the reported capability is correlated to the discovered engine, its version, and the workspace",
  async function () {
    const session = sessionFor(this);
    const outcome = await session.reportEngineCapability();
    // RED: no engine is discovered, so no capability is correlated to it.
    assert.equal(
      outcome.capabilityCorrelated,
      true,
      `${REQUIREMENT}: the reported capability is NOT correlated to a discovered engine, its version, and the workspace`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "neither the wrapper PATH nor an installed engine path is discoverable",
  async function () {
    const session = sessionFor(this);
    await session.recordHonestUnavailable();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the IDE reports the engine capability honestly as unavailable",
  async function () {
    const session = sessionFor(this);
    assert.equal(
      session.reportsCapabilityUnavailable(),
      true,
      `${REQUIREMENT}: the IDE fabricated engine availability when no wrapper PATH or installed engine path is discoverable`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "it neither fabricates an engine, a capability, a plan, nor a successful result from the fixture peer",
  async function () {
    const session = sessionFor(this);
    assert.equal(session.fabricatedEngine(), false, `${REQUIREMENT}: an engine was fabricated`);
    assert.equal(session.fabricatedCapability(), false, `${REQUIREMENT}: a capability was fabricated`);
    assert.equal(session.fabricatedPlan(), false, `${REQUIREMENT}: a plan was fabricated`);
    assert.equal(session.fabricatedSuccess(), false, `${REQUIREMENT}: a successful result was fabricated`);
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-002 — real-engine preview is read-only and correlated before any authority
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "a real RefactorKit engine is discoverable and an exact semantic target is selected",
  async function () {
    const session = sessionFor(this);
    session.start();
    await session.startWithTarget();
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person requests a preview for a supported operation and target",
  async function () {
    const session = sessionFor(this);
    await session.requestRealEnginePreview();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the provider returns one real-engine patch plan correlated to the operation, target, workspace authority, selection, request, and engine",
  async function () {
    const session = sessionFor(this);
    const preview = session.previewOutcome();
    assert.ok(preview, `${REQUIREMENT}: preview outcome is missing`);
    // RED: the production daemon returns NO real-engine patch plan — preview is
    // honestly refused because real-engine delegation is absent.
    assert.equal(
      preview.previewRefused,
      false,
      `${REQUIREMENT}: the provider returned NO real-engine patch plan — real-engine preview delegation is absent`,
    );
    assert.ok(preview.plan !== undefined, `${REQUIREMENT}: no real-engine patch plan was returned`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the fixture peer may serve as a harness only and is never reported as real-engine preview evidence",
  async function () {
    const session = sessionFor(this);
    // Honest RED: the fixture peer is a harness only and is never presented as
    // real-engine preview evidence.
    assert.equal(
      session.fixturePeerAsRealEngineEvidence(),
      false,
      `${REQUIREMENT}: the fixture peer was reported as real-engine preview evidence`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-003 — real transformation bound to exact plan + approval; rollback only when advertised
// -----------------------------------------------------------------------------

Then<StoryWorld>(
  "the provider runs the real engine transformation against that exact reviewed plan and current context rather than reconstructed source or UI-fabricated edits",
  async function () {
    const session = sessionFor(this);
    const apply = session.applyOutcome();
    assert.ok(apply, `${REQUIREMENT}: apply outcome is missing`);
    // RED: no real-engine transformation runs — Apply is refused because
    // real-engine delegation is absent.
    assert.equal(
      apply.receivedPlanAuthority && apply.appliedExactPlan,
      true,
      `${REQUIREMENT}: the provider did NOT run the real engine transformation against the exact reviewed plan and current context — real-engine apply delegation is absent`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the provider reports a correlated transaction for the applied real plan",
  async function () {
    const session = sessionFor(this);
    await session.recordTransaction();
    assert.equal(
      session.transactionReported(),
      true,
      `${REQUIREMENT}: the provider reported NO correlated transaction for the applied real plan`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the IDE reports the applied, refused, stale, failed, or indeterminate outcome honestly and never fabricates success",
  async function () {
    const session = sessionFor(this);
    const outcome = session.reportedOutcome();
    // Honest RED: the IDE reports the honest refused outcome and never fabricates
    // success.
    assert.ok(
      outcome !== undefined &&
        ["applied", "refused", "stale", "failed", "indeterminate"].includes(outcome),
      `${REQUIREMENT}: the IDE did not report an honest outcome`,
    );
    assert.equal(
      session.fabricatedSuccess(),
      false,
      `${REQUIREMENT}: the IDE fabricated success`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-004 — adapters extract, delegate, and respond with honest unavailable outcomes
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "a real-engine request arrives at a browser or desktop adapter behind a provider-neutral port",
  async function () {
    const session = sessionFor(this);
    session.start();
    await session.requestRealEngineAdapter();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter delegates the extracted request to the owned real-engine capability",
  async function () {
    const session = sessionFor(this);
    const adapter = session.adapterOutcome();
    assert.ok(adapter, `${REQUIREMENT}: adapter outcome is missing`);
    // RED: the adapter cannot delegate to an owned real-engine capability because
    // real-engine delegation is absent; the capability gate refuses.
    assert.equal(
      adapter.delegated,
      true,
      `${REQUIREMENT}: the adapter did NOT delegate the extracted request to an owned real-engine capability — real-engine delegation is absent`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the engine is absent, its capability metadata is absent or unacceptable, or the operation is unsupported",
  async function () {
    const session = sessionFor(this);
    await session.recordUnsupportedOperation();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "a browser without a conforming browser provider reports the local RefactorKit engine capability as unavailable",
  async function () {
    const session = sessionFor(this);
    const unavailable = await session.observeBrowserUnavailable();
    assert.equal(
      unavailable,
      true,
      `${REQUIREMENT}: a browser without a conforming provider fabricated local engine availability`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the capability is exercised through the browser profile",
  async function () {
    const session = sessionFor(this);
    await session.observeBrowserCapability();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "capability access to the real-engine capability is defined through ports, not platform APIs",
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
// AC-005 — implementation status is evidence-based and stays @not-implemented
// -----------------------------------------------------------------------------

Then<StoryWorld>(
  "the requirement ID \"@REQ-IDE-REFACTORKIT-ENGINE-INTEGRATION-001\" is repository-unique and reconciled",
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
  "deterministic fixture-peer evidence, real-engine semantic transformation, rollback restoration, live editor or native GUI wiring, packaging, and platform coverage are reported separately",
  async function () {
    const session = sessionFor(this);
    // Honest RED: this RED uses a deterministic in-process daemon boundary behind
    // the REAL adapter; real-engine transformation, rollback restoration, live
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
  "fixture-peer fallback is never claimed as real-engine evidence",
  async function () {
    const session = sessionFor(this);
    assert.equal(
      session.fixturePeerAsRealEngineEvidence(),
      false,
      `${REQUIREMENT}: fixture-peer fallback was claimed as real-engine evidence`,
    );
    await attachEvidence(session, this);
  },
);

After<StoryWorld>({ tags: REQUIREMENT_TAG }, async function () {
  const session = sessions.get(this);
  if (session !== undefined) {
    session.dispose();
    await attachEvidence(session, this);
    sessions.delete(this);
  }
});
