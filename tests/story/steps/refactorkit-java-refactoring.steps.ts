// -----------------------------------------------------------------------------
// tests/story/steps/refactorkit-java-refactoring.steps.ts
// Story BDD steps for REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001
// (features/refactorkit/java-refactoring.feature, 5 scenarios / 42 steps).
//
// GREEN: the operational RefactorKit Java refactoring slice is implemented on the
// production surface. These steps drive the REAL TauriRefactorKitAdapter through
// a fake in-process Tauri invoke boundary whose daemon mirrors the real
// refactorkit_daemon capability advertisement (rename-class / rename-member /
// rename-local-variable / move-class / change-method-signature / safe-delete) and
// preview -> apply -> rollback semantics.
//
// Honesty (GREEN):
//   - preview is read-only and grantsApplyAuthority=false;
//   - Apply binds the exact reviewed planId + explicit approval, never
//     reconstructed source or UI-fabricated edits; a changed/replaced plan
//     requires a fresh preview;
//   - rollback is exposed only for an advertised, transaction-bound write; a
//     not-advertised transaction class is neither offered nor inferred;
//   - unsupported operations and a browser without a conforming provider are
//     reported honestly unavailable/refused — no fabricated plan/success/rewrite.
//
// The feature file itself is NOT promoted; AC-005 keeps @not-implemented until
// real-engine integration validation exists.
//
// Shared step wording with java-language-service.steps.ts (e.g. "the adapter
// receives the request", "packages ui, web-core, and web ...") is disambiguated
// by tag-scoping each shared definition to its owning requirement so the
// permanent runner (strict:true, all steps imported) never sees ambiguity.
// -----------------------------------------------------------------------------

import { After, Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { StoryWorld } from "../support/world.js";
import {
  RefactorKitJavaRefactoringStorySession,
  REQUIREMENT,
  TARGET_FILE,
  WORKSPACE_ID,
  type RefactorOperation,
  getRefactorKitJavaRefactoringSession,
  disposeRefactorKitJavaRefactoringSession,
} from "../support/refactorkit-java-refactoring.js";

/** Tag scope that disambiguates this slice's shared step wording from other slices. */
const REQUIREMENT_TAG = `@${REQUIREMENT}`;

function sessionFor(world: StoryWorld): RefactorKitJavaRefactoringStorySession {
  return getRefactorKitJavaRefactoringSession(world);
}

async function attachEvidence(
  session: RefactorKitJavaRefactoringStorySession,
  world: StoryWorld,
): Promise<void> {
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

/** The primary operation exercised by this GREEN slice. */
const PRIMARY_OPERATION: RefactorOperation = "rename-class";

// -----------------------------------------------------------------------------
// AC-001 — read-only preview, grants no apply authority (GREEN)
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "an authorized Java workspace and an exact semantic target are selected",
  async function () {
    const session = sessionFor(this);
    session.start();
    await attachEvidence(session, this);
  },
);

Given<StoryWorld>(
  "the provider authoritatively advertises the requested Java refactoring operation",
  async function () {
    const session = sessionFor(this);
    // Honest capability observation through the REAL adapter: the daemon now
    // advertises the six general refactoring operations.
    await session.observeCapability();
    assert.equal(
      session.advertisedOperations().includes(PRIMARY_OPERATION),
      true,
      `${REQUIREMENT}: the daemon does not advertise ${PRIMARY_OPERATION}`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>("the person requests a preview for that operation and target", async function () {
  const session = sessionFor(this);
  await session.requestGeneralRefactoringPreview(PRIMARY_OPERATION, TARGET_FILE);
  await attachEvidence(session, this);
});

Then<StoryWorld>(
  // cucumber-js reports a step whose text contains "/" as undefined unless the
  // pattern is a RegExp; this matches the feature's single-line step verbatim.
  new RegExp(
    "^the provider returns one immutable patch plan correlated to the operation, target, workspace authority, selection/request, and provider$",
  ),
  async function () {
    const session = sessionFor(this);
    const preview = session.previewOutcome();
    assert.ok(preview, `${REQUIREMENT} preview outcome is missing`);
    assert.ok(
      preview.plan !== undefined,
      `${REQUIREMENT}: the provider returned NO immutable patch plan`,
    );
    const plan = preview.plan;
    assert.equal(plan.operation, PRIMARY_OPERATION, `${REQUIREMENT} plan operation mismatch`);
    assert.equal(plan.target.path, TARGET_FILE, `${REQUIREMENT} plan target mismatch`);
    assert.equal(
      plan.authority.workspaceId,
      WORKSPACE_ID,
      `${REQUIREMENT} plan workspace authority mismatch`,
    );
    assert.ok(plan.requestId.length > 0, `${REQUIREMENT} plan is not correlated to a request`);
    assert.equal(plan.provider, "refactorkit", `${REQUIREMENT} plan provider mismatch`);
    assert.equal(
      plan.grantsApplyAuthority,
      false,
      `${REQUIREMENT} the preview granted apply authority`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the review identifies the proposed effects as create, edit, move, or delete with available diff, warnings, diagnostics, risks, conflicts, blockers, eligibility, and staleness evidence",
  async function () {
    const session = sessionFor(this);
    const plan = session.previewOutcome()?.plan;
    assert.ok(plan, `${REQUIREMENT} no review evidence — no immutable patch plan`);
    assert.ok(
      plan.affectedFiles.length > 0 &&
        plan.affectedFiles.every((file) =>
          ["create", "edit", "move", "delete"].includes(file.change),
        ),
      `${REQUIREMENT} review does not identify proposed effects as create/edit/move/delete`,
    );
    assert.ok(plan.renderedDiff.length > 0, `${REQUIREMENT} no available diff`);
    assert.ok(plan.structuredDiff.length > 0, `${REQUIREMENT} no structured diff`);
    assert.ok(Array.isArray(plan.warnings), `${REQUIREMENT} no warnings evidence`);
    assert.ok(
      Array.isArray(plan.diagnosticsAfterPreview),
      `${REQUIREMENT} no diagnostics evidence`,
    );
    assert.ok(Array.isArray(plan.risks), `${REQUIREMENT} no risk evidence`);
    assert.ok(Array.isArray(plan.conflicts), `${REQUIREMENT} no conflicts evidence`);
    assert.ok(
      Array.isArray(plan.applyEligibility.blockers),
      `${REQUIREMENT} no apply-eligibility blockers evidence`,
    );
    assert.ok(Array.isArray(plan.staleness.reasons), `${REQUIREMENT} no staleness evidence`);
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-002 — exact-plan apply / conditional rollback (GREEN)
// -----------------------------------------------------------------------------

Then<StoryWorld>(
  "the provider receives the plan authority rather than reconstructed Java source or UI-fabricated edits",
  async function () {
    const session = sessionFor(this);
    const apply = session.applyOutcome();
    assert.ok(apply, `${REQUIREMENT} apply outcome is missing`);
    assert.equal(
      apply.receivedPlanAuthority,
      true,
      `${REQUIREMENT} the provider received reconstructed source or UI-fabricated edits instead of plan authority`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "Apply occurs only for that exact reviewed plan and current context",
  async function () {
    const session = sessionFor(this);
    const apply = session.applyOutcome();
    assert.ok(apply, `${REQUIREMENT} apply outcome is missing`);
    assert.equal(
      apply.appliedExactPlan,
      true,
      `${REQUIREMENT} Apply did not occur for the exact reviewed plan and current context`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the provider reports a correlated transaction for the applied plan",
  async function () {
    const session = sessionFor(this);
    await session.recordTransaction();
    assert.equal(
      session.transactionReported(),
      true,
      `${REQUIREMENT} the provider reported no correlated transaction for the applied plan`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the IDE reports the applied, refused, stale, failed, or indeterminate outcome honestly",
  async function () {
    const session = sessionFor(this);
    const outcome = session.reportedOutcome();
    assert.ok(
      outcome !== undefined &&
        ["applied", "refused", "stale", "failed", "indeterminate"].includes(outcome),
      `${REQUIREMENT} the IDE did not report an honest outcome`,
    );
    assert.equal(outcome, "applied", `${REQUIREMENT} the IDE fabricated a non-applied outcome`);
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-003 — adapters extract/delegate/response and honest unavailable outcomes
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "a Java refactoring request arrives at a browser or desktop adapter behind a provider-neutral port",
  async function () {
    const session = sessionFor(this);
    session.start();
    await session.requestGeneralRefactoringAdapter();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter delegates the extracted request to the owned capability",
  async function () {
    const session = sessionFor(this);
    const adapter = session.adapterOutcome();
    assert.ok(
      adapter?.delegated,
      `${REQUIREMENT} the adapter did not delegate the extracted request to the owned capability`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the provider is absent, its capability metadata is absent or unacceptable, or the operation is unsupported",
  async function () {
    const session = sessionFor(this);
    await session.recordUnsupportedOperation();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "a browser without a conforming browser provider reports the local RefactorKit capability as unavailable",
  async function () {
    const session = sessionFor(this);
    const unavailable = await session.observeBrowserUnavailable();
    assert.equal(
      unavailable,
      true,
      `${REQUIREMENT} a browser without a conforming provider fabricated local availability`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-004 — web frontend stays Tauri-free (architecture invariant, honest)
// -----------------------------------------------------------------------------

When<StoryWorld>(
  "the Java refactoring capability is exercised through the browser profile",
  async function () {
    const session = sessionFor(this);
    await session.observeCapability();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "capability access to the refactoring capability is defined through ports, not platform APIs",
  async function () {
    const session = sessionFor(this);
    const ports = session.portCapabilityEvidence();
    assert.ok(ports.length === 1, `${REQUIREMENT} port capability evidence is incomplete`);
    for (const port of ports) {
      assert.equal(
        port.declaresInterface,
        true,
        `${REQUIREMENT} ${port.port} does not declare a port interface`,
      );
      assert.equal(port.tauriImports, 0, `${REQUIREMENT} ${port.port} imports a platform API`);
    }
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-005 — implementation status is evidence-based and stays @not-implemented
// -----------------------------------------------------------------------------

Then<StoryWorld>(
  'the requirement ID "@REQ-IDE-REFACTORKIT-JAVA-REFACTORING-001" is repository-unique and reconciled',
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT} reconciliation is missing`);
    assert.ok(
      reconciliation.requirementTags.includes(`@${REQUIREMENT}`),
      `${REQUIREMENT} requirement ID is not declared`,
    );
    const uniqueness = session.requirementOccurrences();
    assert.equal(uniqueness.unique, true, `${REQUIREMENT} requirement ID is not repository-unique`);
    assert.ok(
      uniqueness.occurrences >= 5,
      `${REQUIREMENT} requirement ID is not reconciled across scenarios`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  // cucumber-js reports a step whose text contains "/" as undefined unless the
  // pattern is a RegExp; this matches the feature's step verbatim.
  new RegExp(
    "^contracts, shells, import Stories, diagnostics, or hard-coded/fake plans do not promote this status$",
  ),
  async function () {
    const session = sessionFor(this);
    // Honest status evidence: the production surface now exposes the general
    // refactoring preview/apply/rollback/discard path, but that presence does NOT
    // by itself promote the declared status — the feature still reconciles
    // @not-implemented and no fabricated plan promotes it.
    await session.observeCapability();
    const gap = session.productionGap();
    assert.equal(
      gap.portHasGeneralRefactoringPreview,
      true,
      `${REQUIREMENT} the RefactorKitPort does not expose a general refactoring preview/apply/rollback/discard surface`,
    );
    assert.equal(
      gap.adapterHasGeneralRefactoringPreview,
      true,
      `${REQUIREMENT} the TauriRefactorKitAdapter does not expose a general refactoring preview/apply/rollback/discard surface`,
    );
    assert.equal(
      gap.daemonAdvertisesGeneralRefactoringPreview,
      true,
      `${REQUIREMENT} the daemon does not advertise the general refactoring operation set`,
    );
    assert.equal(
      session.fabricatedPlan(),
      false,
      `${REQUIREMENT} a hard-coded/fake plan promotes the status`,
    );
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT} reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@not-implemented"),
      `${REQUIREMENT} production presence promoted the declared status`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "deterministic fixture orchestration, real-engine semantic transformation, rollback restoration, live editor or native GUI wiring, packaging, and platform coverage are reported separately",
  async function () {
    const session = sessionFor(this);
    // Honest evidence boundaries: this GREEN uses a deterministic in-process daemon
    // boundary behind the REAL adapter; real-engine transformation, rollback
    // restoration, live editor/native-GUI wiring, packaging, and platform coverage
    // are reported separately and not claimed here.
    const evidence = session.evidence();
    assert.equal(evidence.evidenceKind, "tauri-harness", `${REQUIREMENT} evidence kind mismatch`);
    assert.equal(
      evidence.nativeGui,
      false,
      `${REQUIREMENT} native GUI evidence is not reported separately`,
    );
    assert.equal(evidence.e2e, false, `${REQUIREMENT} e2e evidence is not reported separately`);
    assert.equal(
      evidence.packagedApplication,
      false,
      `${REQUIREMENT} packaging evidence is not reported separately`,
    );
    await attachEvidence(session, this);
  },
);

After<StoryWorld>({ tags: REQUIREMENT_TAG }, async function () {
  const session = getRefactorKitJavaRefactoringSession(this);
  if (session !== undefined) {
    session.dispose();
    await attachEvidence(session, this);
    disposeRefactorKitJavaRefactoringSession(this);
  }
});
