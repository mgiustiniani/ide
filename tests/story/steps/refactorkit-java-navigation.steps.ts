// -----------------------------------------------------------------------------
// tests/story/steps/refactorkit-java-navigation.steps.ts
// Story BDD steps for REQ-IDE-JAVA-NAVIGATION-001
// (features/refactorkit/java-navigation.feature).
//
// GREEN (meaningful, honest): Java go-to-definition and find-references ARE now
// wired for Java. The production controller
// (apps/desktop/src/features/refactorkit-symbol-navigation/useRefactorKitSymbolNavigationController.ts)
// wires resolveJavaDefinition (via refactorKit.definition(symbol)) and
// resolveJavaReferences (via refactorKit.references(symbol)) to navigateToPoint,
// which App.tsx routes through documentNavigation.navigateToLocation +
// editor.revealRequest (Monaco revealPositionInCenter). The REAL
// TauriRefactorKitAdapter advertises the Java definition/references capability and
// delegates run_refactorkit_engine_definition / run_refactorkit_engine_references.
// So the IDE presents, navigates, and reveals a Java location, and reports the
// capability honestly as unavailable/error when the Java navigation capability is
// absent.
//
// Expected GREEN (honest):
//   - AC-001: engine resolves one definition location (TRUE) and the controller
//     reveals it via navigateToPoint -> documentNavigation.navigateToLocation +
//     editor.revealRequest (TRUE) -> PASS.
//   - AC-002: engine resolves reference locations (TRUE), the controller presents
//     them, and selecting one navigates/reveals via navigateToPoint (TRUE) -> PASS.
//   - AC-003: the adapter extracts -> delegates -> returns (TRUE), and the
//     controller reports the capability honestly as unavailable/error when the Java
//     navigation capability is absent (TRUE) -> PASS.
//   - AC-004: web-first layers stay Tauri-free and capability access is through
//     ports (TRUE) -> PASS (static).
//   - AC-005: qualified native coverage supports @partial while browser availability,
//     clean-provider behavior and platform coverage remain limited; static production
//     presence does not change the declared status (TRUE) -> PASS (static).
//
// Shared step wording (adapter extract/delegate/response, web-first, status
// reconciliation) lives in shared-operational.steps.ts and is dispatched by tag
// scope; this file owns only feature-specific java-navigation steps. The focused
// runner imports this file plus shared-operational and the support glob, so no
// step text is defined twice for the focused run.
// -----------------------------------------------------------------------------

import { After, Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { StoryWorld } from "../support/world.js";
import {
  RefactorKitJavaNavigationStorySession,
  REQUIREMENT,
  getRefactorKitJavaNavigationSession,
  disposeRefactorKitJavaNavigationSession,
} from "../support/refactorkit-java-navigation.js";

/** Tag scope that disambiguates this slice's shared step wording from other slices. */
const REQUIREMENT_TAG = `@${REQUIREMENT}`;

function sessionFor(world: StoryWorld): RefactorKitJavaNavigationStorySession {
  return getRefactorKitJavaNavigationSession(world);
}

async function attachEvidence(
  session: RefactorKitJavaNavigationStorySession,
  world: StoryWorld,
): Promise<void> {
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

// -----------------------------------------------------------------------------
// AC-001 — a Java symbol definition resolves and its location is revealed (GREEN)
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "an authorized Java workspace and a Java symbol fully-qualified name is selected",
  async function () {
    const session = sessionFor(this);
    await session.start();
    await attachEvidence(session, this);
  },
);

Given<StoryWorld>(
  "the provider authoritatively advertises the Java definition capability for that workspace",
  async function () {
    const session = sessionFor(this);
    // Honest capability observation through the REAL adapter: the engine advertises
    // the Java definition/references operational surface for the workspace.
    const capabilities = await session.observeCapability();
    const surface = capabilities.operationalSurface ?? [];
    assert.equal(
      surface.includes("definition"),
      true,
      `${REQUIREMENT}: the provider does not authoritatively advertise the Java definition capability`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person requests go-to-definition for that Java symbol FQN",
  async function () {
    const session = sessionFor(this);
    await session.requestDefinition();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the provider resolves one definition location correlated to the symbol FQN, the workspace authority, the request, and the provider",
  async function () {
    const session = sessionFor(this);
    const outcome = await session.recordDefinitionResolution();
    // Honest: the engine resolves one definition location correlated to the symbol
    // FQN and the controller reveals it via navigateToPoint.
    assert.equal(
      outcome.definitionResolved,
      true,
      `${REQUIREMENT}: the provider did NOT resolve one definition location for the symbol FQN`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the IDE reveals the resolved location in the editor at the exact point reported by the provider coordinates",
  async function () {
    const session = sessionFor(this);
    await session.revealDefinition();
    // GREEN: the controller Java path connects the engine definition to
    // navigateToPoint -> documentNavigation.navigateToLocation + editor
    // revealRequest, so the IDE reveals the resolved location.
    assert.equal(
      session.definitionOutcome()?.definitionRevealed,
      true,
      `${REQUIREMENT}: the IDE did NOT reveal the resolved location in the editor — the controller Java path did not connect engine definition/references to navigateToPoint -> documentNavigation.navigateToLocation + editor.revealRequest`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the reveal uses the existing navigation driver and editor revealRequest without fabricating a location",
  async function () {
    const session = sessionFor(this);
    // AC-001 (definition reveal) and AC-002 (reference reveal) share this step
    // text. Dispatch to the outcome currently in progress for the scenario so the
    // step text is registered exactly once (no ambiguity under strict:true).
    if (session.referencesOutcome() !== undefined) {
      await session.assertReferenceRevealUsesExistingNavigationDriver();
      // GREEN: the controller routes through navigateToPoint (the existing
      // navigation driver), so editor.revealRequest is used and no location is
      // fabricated.
      assert.equal(
        session.referencesOutcome()?.revealUsedExistingNavigationDriver,
        true,
        `${REQUIREMENT}: the reference reveal did NOT use the existing navigation driver and editor revealRequest — the controller Java path did not route through navigateToPoint`,
      );
    } else {
      await session.assertRevealUsesExistingNavigationDriver();
      // GREEN: the controller routes through navigateToPoint (the existing
      // navigation driver), so editor.revealRequest is used and no location is
      // fabricated.
      assert.equal(
        session.definitionOutcome()?.revealUsedExistingNavigationDriver,
        true,
        `${REQUIREMENT}: the reveal did NOT use the existing navigation driver and editor revealRequest — the controller Java path did not route through navigateToPoint`,
      );
    }
    assert.equal(
      session.fabricatedDefinition(),
      false,
      `${REQUIREMENT}: a definition location was fabricated`,
    );
    assert.equal(
      session.fabricatedReferenceList(),
      false,
      `${REQUIREMENT}: a reference list was fabricated`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-002 — Java references resolve, are presented, and a selected reference navigates (GREEN)
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "the provider authoritatively advertises the Java references capability for that workspace",
  async function () {
    const session = sessionFor(this);
    const capabilities = await session.observeCapability();
    const surface = capabilities.operationalSurface ?? [];
    assert.equal(
      surface.includes("references"),
      true,
      `${REQUIREMENT}: the provider does not authoritatively advertise the Java references capability`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>("the person requests find-references for that Java symbol FQN", async function () {
  const session = sessionFor(this);
  await session.requestReferences();
  await attachEvidence(session, this);
});

Then<StoryWorld>(
  "the provider resolves the reference locations correlated to the symbol FQN, the workspace authority, the request, and the provider",
  async function () {
    const session = sessionFor(this);
    const outcome = await session.recordReferencesResolution();
    // Honest: the engine resolves reference locations correlated to the symbol FQN.
    assert.equal(
      outcome.referencesResolved,
      true,
      `${REQUIREMENT}: the provider did NOT resolve reference locations for the symbol FQN`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>("the IDE presents the resolved references to the person", async function () {
  const session = sessionFor(this);
  await session.presentReferences();
  // GREEN: the controller Java path presents the resolved references (javaResult)
  // to the person.
  assert.equal(
    session.referencesOutcome()?.referencesPresented,
    true,
    `${REQUIREMENT}: the IDE did NOT present the resolved references to the person — the controller Java path did not present the resolved references`,
  );
  await attachEvidence(session, this);
});

When<StoryWorld>("the person selects a presented reference", async function () {
  const session = sessionFor(this);
  await session.selectReference();
  await attachEvidence(session, this);
});

Then<StoryWorld>(
  "the IDE navigates to and reveals that reference location in the editor at the exact point reported by the provider coordinates",
  async function () {
    const session = sessionFor(this);
    await session.navigateRevealReference();
    // GREEN: the controller Java path navigates to and reveals the selected
    // reference location via navigateToPoint.
    assert.equal(
      session.referencesOutcome()?.referenceNavigatedRevealed,
      true,
      `${REQUIREMENT}: the IDE did NOT navigate to and reveal the selected reference location — the controller Java path did not navigate to the selected reference`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-003 — adapters extract/delegate/response and honest unavailable outcomes (GREEN)
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "a Java navigation request arrives at a browser or desktop adapter behind a provider-neutral port",
  async function () {
    const session = sessionFor(this);
    await session.start();
    await session.requestAdapter();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter delegates the extracted request to the owned Java definition or references capability",
  async function () {
    const session = sessionFor(this);
    const adapter = session.adapterOutcome();
    assert.ok(adapter, `${REQUIREMENT}: adapter outcome is missing`);
    // Honest: the real adapter delegates the extracted symbol to the owned engine
    // definition/references capability (run_refactorkit_engine_definition /
    // run_refactorkit_engine_references).
    assert.equal(
      adapter.delegated,
      true,
      `${REQUIREMENT}: the adapter did NOT delegate the extracted request to the owned Java definition or references capability`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the capability is absent, its capability metadata is absent or unacceptable, the operation is unsupported, or the symbol FQN is unresolvable",
  async function () {
    const session = sessionFor(this);
    await session.recordHonestUnavailable();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the IDE reports the capability honestly as unavailable or the resolution honestly as an error",
  async function () {
    const session = sessionFor(this);
    // GREEN: the controller Java path reports the capability honestly as
    // unavailable/error when the Java navigation capability is absent or the
    // symbol is unresolvable, and never fabricates a result.
    assert.equal(
      session.reportsCapabilityUnavailableOrError(),
      true,
      `${REQUIREMENT}: the IDE did NOT report the capability honestly as unavailable or the resolution honestly as an error — the controller Java path fabricated availability`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "it neither fabricates a definition, a reference list, a successful result, nor a fallback textual rewrite",
  async function () {
    const session = sessionFor(this);
    assert.equal(
      session.fabricatedDefinition(),
      false,
      `${REQUIREMENT}: a definition was fabricated`,
    );
    assert.equal(
      session.fabricatedReferenceList(),
      false,
      `${REQUIREMENT}: a reference list was fabricated`,
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
  "a browser without a conforming browser provider reports the local Java navigation capability as unavailable",
  async function () {
    const session = sessionFor(this);
    const unavailable = await session.observeBrowserUnavailable();
    assert.equal(
      unavailable,
      true,
      `${REQUIREMENT}: a browser without a conforming provider fabricated local Java navigation availability`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-004 — web frontend stays Tauri-free at the platform boundary (PASS, static)
// -----------------------------------------------------------------------------

When<StoryWorld>(
  "the Java navigation capability is exercised through the browser profile",
  async function () {
    const session = sessionFor(this);
    await session.observeBrowserCapability();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "capability access to the Java navigation capability is defined through ports, not platform APIs",
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
// AC-005 — implementation status reflects qualified partial scope (PASS, static)
// -----------------------------------------------------------------------------

When<StoryWorld>(
  "Java navigation is reconciled against its current evidence",
  async function () {
    const session = sessionFor(this);
    await session.start();
    session.reconcileFeatureStatus();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "Java navigation declares one inherited partial status",
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.deepEqual(
      reconciliation.featureStatusTags,
      ["@partial"],
      `${REQUIREMENT}: feature status must reflect its qualified partial scope`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  'the requirement ID "@REQ-IDE-JAVA-NAVIGATION-001" is repository-unique and reconciled',
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
  "the native Java cursor acceptance is separately declared partial",
  async function () {
    const session = sessionFor(this);
    assert.equal(
      session.nativeCursorRequirementIsPartial(),
      true,
      `${REQUIREMENT}: native cursor acceptance must declare its bounded partial scope`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "contracts, shells, import Stories, diagnostics, or hard-coded\\/fake definition or reference results do not promote this status",
  async function () {
    const session = sessionFor(this);
    // Honest GREEN status evidence: the engine defines run_engine_definition /
    // run_engine_references, the real adapter delegates definition(symbol) /
    // references(symbol), and the CONTROLLER JAVA PATH is now WIRED (real
    // production behavior). Production presence does not promote the declared
    // status: the feature reconciles @partial based on separate native evidence;
    // this deterministic harness and no fabricated definition/reference result do
    // not promote that declared status further.
    const gap = session.productionGap();
    assert.equal(
      gap.engineDefinesDefinitionReferencesCommands,
      true,
      `${REQUIREMENT}: the engine does not define run_engine_definition / run_engine_references`,
    );
    assert.equal(
      gap.adapterDelegatesDefinitionReferences,
      true,
      `${REQUIREMENT}: the TauriRefactorKitAdapter does not delegate definition(symbol) / references(symbol)`,
    );
    assert.equal(
      gap.controllerJavaPathWired,
      true,
      `${REQUIREMENT}: the controller Java path is not wired — GREEN requires the wired controller path`,
    );
    assert.equal(
      session.fabricatedDefinition(),
      false,
      `${REQUIREMENT}: a hard-coded/fake definition promotes the status`,
    );
    assert.equal(
      session.fabricatedReferenceList(),
      false,
      `${REQUIREMENT}: a hard-coded/fake reference list promotes the status`,
    );
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT}: reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@partial"),
      `${REQUIREMENT}: production presence changed its partial status`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "real-engine definition\\/references resolution, live editor or native GUI wiring, packaging, and platform coverage are reported separately",
  async function () {
    const session = sessionFor(this);
    // Honest RED evidence boundaries: this RED uses a deterministic in-process
    // engine boundary behind the REAL adapter; real-engine definition/references
    // CLI resolution, live editor/native-GUI wiring, packaging, and platform
    // coverage are reported separately and not claimed here.
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

After<StoryWorld>({ tags: REQUIREMENT_TAG }, async function () {
  const session = getRefactorKitJavaNavigationSession(this);
  if (session !== undefined) {
    session.dispose();
    await attachEvidence(session, this);
    disposeRefactorKitJavaNavigationSession(this);
  }
});
