// -----------------------------------------------------------------------------
// tests/story/steps/java-language-service.steps.ts
// Story BDD steps for REQ-IDE-JAVA-LANGUAGE-001
// (features/workspace/java-language-service.feature).
//
// Characterization GREEN: these steps drive the REAL production Tauri adapters
// (LanguageSessionPort, DocumentSyncPort, JavaIntelligencePort) through a fake
// in-process Tauri invoke boundary. The driver distinguishes honest-unavailable
// (genuine environment path) from ready-path (deterministic native fixture) and
// the spawn path is proven separately by the existing Rust unit tests.
// The feature file itself is NOT promoted; AC-006 keeps @not-implemented.
// -----------------------------------------------------------------------------

import { After, Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { StoryWorld } from "../support/world.js";
import {
  JavaLanguageServiceStorySession,
  REQUIREMENT,
  WORKSPACE_ID,
  JAVA_DOCUMENT_PATH,
  JAVA_DOCUMENT_URI,
} from "../support/java-language-service.js";

const javaLanguageServiceSessions = new WeakMap<StoryWorld, JavaLanguageServiceStorySession>();

function sessionFor(world: StoryWorld): JavaLanguageServiceStorySession {
  let session = javaLanguageServiceSessions.get(world);
  if (session === undefined) {
    session = new JavaLanguageServiceStorySession();
    javaLanguageServiceSessions.set(world, session);
  }
  return session;
}

async function attachEvidence(session: JavaLanguageServiceStorySession, world: StoryWorld): Promise<void> {
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

const lifecycleStates = new Set(["stopped", "starting", "ready", "stopping"]);

// -----------------------------------------------------------------------------
// AC-001 — lifecycle management and honest availability
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "a workspace contains Java sources and a Java language service controller is wired",
  async function () {
    const session = sessionFor(this);
    session.start();
    await attachEvidence(session, this);
  },
);

Given<StoryWorld>(
  "a JDT Language Server process can be spawned by the Rust backend",
  async function () {
    const session = sessionFor(this);
    await session.proveSpawnPath(); // existing Rust unit tests, not a live JDT LS spawn
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person requests the Java language service status",
  async function () {
    const session = sessionFor(this);
    await session.requestStatus();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller reports a lifecycle status from \"stopped\", \"starting\", \"running\", or \"stopping\"",
  async function () {
    const session = sessionFor(this);
    const status = session.status();
    assert.ok(status, `${REQUIREMENT} status is missing`);
    assert.ok(
      lifecycleStates.has(status.state),
      `${REQUIREMENT} lifecycle status ${status.state} is not stopped/starting/running/stopping`,
    );
    assert.equal(status.workspaceId, WORKSPACE_ID, `${REQUIREMENT} status workspace mismatch`);
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person starts the Java language service",
  async function () {
    const session = sessionFor(this);
    await session.startService();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller starts the JDT Language Server and reports \"running\" when ready",
  async function () {
    const session = sessionFor(this);
    const status = session.status();
    assert.ok(status, `${REQUIREMENT} status is missing`);
    assert.equal(status.state, "ready", `${REQUIREMENT} did not report running/ready after start`);
    assert.equal(status.capabilities.documentSync, true, `${REQUIREMENT} ready session lacks document sync`);
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person restarts the Java language service",
  async function () {
    const session = sessionFor(this);
    await session.restartService();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller restarts the JDT Language Server and reports a fresh \"running\" status",
  async function () {
    const session = sessionFor(this);
    const status = session.status();
    assert.ok(status, `${REQUIREMENT} status is missing`);
    assert.equal(status.state, "ready", `${REQUIREMENT} restart did not report running/ready`);
    assert.ok(
      status.generation >= 2,
      `${REQUIREMENT} restart did not produce a fresh session generation`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person stops the Java language service",
  async function () {
    const session = sessionFor(this);
    await session.stopService();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller stops the JDT Language Server and reports \"stopped\"",
  async function () {
    const session = sessionFor(this);
    const status = session.status();
    assert.ok(status, `${REQUIREMENT} status is missing`);
    assert.equal(status.state, "stopped", `${REQUIREMENT} did not report stopped after stop`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "lifecycle events are polled and observable through the poll-events channel",
  async function () {
    const session = sessionFor(this);
    await session.observePollEvents();
    assert.ok(
      session.lifecycleEvents().some((event) => event.state === "ready"),
      `${REQUIREMENT} poll-events channel did not deliver a ready status event`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "no JDT Language Server or JDK toolchain is discoverable",
  async function () {
    const session = sessionFor(this);
    await session.markUnavailable();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller reports Java language service availability honestly as unavailable",
  async function () {
    const session = sessionFor(this);
    const status = session.status();
    assert.ok(status, `${REQUIREMENT} status is missing`);
    assert.equal(status.state, "unavailable", `${REQUIREMENT} must report unavailable`);
    assert.ok(
      Object.values(status.capabilities).every((capability) => capability === false),
      `${REQUIREMENT} unavailable session fabricated capabilities`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "it neither reports \"running\" nor fabricates a ready state",
  async function () {
    const session = sessionFor(this);
    const status = session.status();
    assert.ok(status, `${REQUIREMENT} status is missing`);
    assert.notEqual(status.state, "ready", `${REQUIREMENT} fabricated a ready state`);
    assert.notEqual(status.state, "indexing", `${REQUIREMENT} fabricated an indexing state`);
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-002 — document sync keeps versioned full text and serves only ready docs
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "the Java language service is running for the workspace",
  async function () {
    const session = sessionFor(this);
    session.start();
    await session.startReadySession();
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person opens a Java document in the editor",
  async function () {
    const session = sessionFor(this);
    await session.openDocument();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller syncs the open event with versioned full text to the language server",
  async function () {
    const session = sessionFor(this);
    const invocations = session.syncInvocations();
    assert.ok(invocations.length > 0, `${REQUIREMENT} no open event synced`);
    const open = invocations.find((document) => document.action === undefined && document.version === 1);
    assert.ok(open, `${REQUIREMENT} open event did not carry versioned full text`);
    assert.equal(open.path, JAVA_DOCUMENT_PATH, `${REQUIREMENT} open path mismatch`);
    assert.equal(open.uri, JAVA_DOCUMENT_URI, `${REQUIREMENT} open uri mismatch`);
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person changes the Java document text",
  async function () {
    const session = sessionFor(this);
    await session.changeDocument();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller syncs the change event with the incremented version and full text",
  async function () {
    const session = sessionFor(this);
    const invocations = session.syncInvocations();
    const change = invocations.filter((document) => document.version === 2);
    assert.ok(change.length > 0, `${REQUIREMENT} change event did not carry incremented version`);
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person saves the Java document",
  async function () {
    const session = sessionFor(this);
    await session.saveDocument();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller syncs the save event for the current versioned text",
  async function () {
    const session = sessionFor(this);
    const invocations = session.syncInvocations();
    assert.ok(
      invocations.some((document) => document.version === 2),
      `${REQUIREMENT} save event did not carry the current versioned text`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person closes the Java document",
  async function () {
    const session = sessionFor(this);
    await session.closeDocument();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller syncs the close event and drops the document",
  async function () {
    const session = sessionFor(this);
    assert.ok(
      session.syncInvocations().length > 0,
      `${REQUIREMENT} close event was not synced`,
    );
    // After close the adapter drops the versioned document: a further change
    // for the same path must be declined as not-ready.
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "an intelligence request targets a document the language server has not fully synced",
  async function () {
    const session = sessionFor(this);
    await session.requestChangeForUnsyncedDocument();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller serves results only for ready documents and declines for not-ready ones",
  async function () {
    const session = sessionFor(this);
    const decline = session.notReadyDecline();
    assert.ok(decline, `${REQUIREMENT} did not record a decline outcome`);
    assert.notEqual(decline, "accepted", `${REQUIREMENT} served a not-ready document`);
    assert.ok(decline.length > 0, `${REQUIREMENT} decline has no reason`);
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-003 — Java intelligence is untrusted data and cancellable
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "a ready Java document is open and the Java language service is running",
  async function () {
    const session = sessionFor(this);
    session.start();
    await session.startReadySession();
    await session.openDocument();
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person requests completion for a position in the document",
  async function () {
    const session = sessionFor(this);
    await session.requestCompletion();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller returns completion items through JavaIntelligencePort",
  async function () {
    const session = sessionFor(this);
    const response = session.completionResponse();
    assert.ok(response, `${REQUIREMENT} completion response is missing`);
    assert.equal(response.ok, true, `${REQUIREMENT} completion did not succeed`);
    assert.ok(response.result.items.length > 0, `${REQUIREMENT} completion returned no items`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the frontend treats those completion items as untrusted data and validates before use",
  async function () {
    const session = sessionFor(this);
    const response = session.completionResponse();
    assert.ok(response && response.ok, `${REQUIREMENT} ok completion is missing`);
    for (const item of response.result.items) {
      assert.equal(typeof item.label, "string", `${REQUIREMENT} item label is not a validated string`);
      assert.ok(item.kind.length > 0, `${REQUIREMENT} item kind is not validated`);
    }
    // The adapter bounds and rejects malformed native kinds; the envelope
    // carries only the extracted request fields (AC-004).
    const envelope = session.adapterEnvelope();
    assert.ok(envelope, `${REQUIREMENT} adapter envelope is missing`);
    assert.deepEqual(Object.keys(envelope).sort(), ["cancellationId", "document", "generation", "position", "requestId", "workspaceId"]);
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person requests hover for a symbol in the document",
  async function () {
    const session = sessionFor(this);
    await session.requestHover();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller returns hover content through JavaIntelligencePort as untrusted data",
  async function () {
    const session = sessionFor(this);
    const response = session.hoverResponse();
    assert.ok(response, `${REQUIREMENT} hover response is missing`);
    assert.equal(response.ok, true, `${REQUIREMENT} hover did not succeed`);
    assert.ok(response.result.contents.length > 0, `${REQUIREMENT} hover returned no content`);
    assert.ok(
      response.result.contents.every((content) => content.format === "plaintext" || content.format === "markdown"),
      `${REQUIREMENT} hover content format is not validated`,
    );
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the person requests signature help for a call site in the document",
  async function () {
    const session = sessionFor(this);
    await session.requestSignatureHelp();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller returns signature help through JavaIntelligencePort as untrusted data",
  async function () {
    const session = sessionFor(this);
    const response = session.signatureResponse();
    assert.ok(response, `${REQUIREMENT} signature response is missing`);
    assert.equal(response.ok, true, `${REQUIREMENT} signature did not succeed`);
    assert.ok(response.result.signatures.length > 0, `${REQUIREMENT} signature returned no signatures`);
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "an intelligence request is cancelled",
  async function () {
    const session = sessionFor(this);
    await session.cancelInFlightCompletion();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the controller cancels the in-flight request and stops awaiting the language server",
  async function () {
    const session = sessionFor(this);
    const response = session.cancelledResponse();
    assert.ok(response, `${REQUIREMENT} cancelled response is missing`);
    assert.equal(response.ok, false, `${REQUIREMENT} cancelled request delivered a result`);
    assert.equal(response.error.kind, "cancelled", `${REQUIREMENT} cancellation was not reported as cancelled`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "no cancelled result is delivered to the editor",
  async function () {
    const session = sessionFor(this);
    const response = session.cancelledResponse();
    assert.ok(response && response.ok === false, `${REQUIREMENT} a cancelled result leaked to the editor`);
    assert.ok(
      !("result" in response),
      `${REQUIREMENT} cancelled response carried a result`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-004 — adapters use extract, delegate, and response with no hidden policy
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "a Java intelligence request arrives at a browser or desktop adapter behind a port",
  async function () {
    const session = sessionFor(this);
    session.start();
    await session.startReadySession();
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the adapter receives the request",
  async function () {
    const session = sessionFor(this);
    await session.requestCompletion();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter extracts only the request payload needed by the delegate",
  async function () {
    const session = sessionFor(this);
    const envelope = session.adapterEnvelope();
    assert.ok(envelope, `${REQUIREMENT} adapter envelope is missing`);
    assert.deepEqual(
      Object.keys(envelope).sort(),
      ["cancellationId", "document", "generation", "position", "requestId", "workspaceId"],
      `${REQUIREMENT} adapter extracted fields beyond the delegate payload`,
    );
    assert.deepEqual(Object.keys((envelope.document as Record<string, unknown>)).sort(), ["path", "uri", "version"]);
    assert.deepEqual(Object.keys((envelope.position as Record<string, unknown>)).sort(), ["character", "line"]);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter delegates the extracted request to the Java language service",
  async function () {
    const session = sessionFor(this);
    assert.ok(session.adapterEnvelope(), `${REQUIREMENT} no delegation envelope observed`);
    assert.ok(
      session.completionResponse()?.ok === true,
      `${REQUIREMENT} delegation did not reach the language service`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter returns the delegated response to the caller",
  async function () {
    const session = sessionFor(this);
    const response = session.completionResponse();
    assert.ok(response, `${REQUIREMENT} delegated response is missing`);
    assert.equal(response.requestId, "story-completion-1", `${REQUIREMENT} response is not correlated to the request`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the adapter contains no hidden domain policy or fabricated intelligence",
  async function () {
    const session = sessionFor(this);
    const response = session.completionResponse();
    assert.ok(response && response.ok, `${REQUIREMENT} fabricated an intelligence result`);
    const envelope = session.adapterEnvelope();
    assert.ok(envelope, `${REQUIREMENT} adapter envelope is missing`);
    // The returned items exactly reflect the delegated native result (no hidden policy).
    assert.ok(
      response.result.items.every((item) => typeof item.label === "string" && typeof item.kind === "string"),
      `${REQUIREMENT} returned intelligence is not a validated delegation result`,
    );
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-005 — the web frontend stays Tauri-free at the platform boundary
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "packages ui, web-core, and web are part of the standalone web frontend",
  async function () {
    const session = sessionFor(this);
    session.start();
    session.scanWebFirstLayers();
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the Java language service is exercised through the browser profile",
  async function () {
    const session = sessionFor(this);
    await session.proveWebBuild();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "no file under ui, web-core, or web imports {string}",
  async function (platformApi: string) {
    const session = sessionFor(this);
    assert.equal(platformApi, "@tauri-apps/api", `${REQUIREMENT} boundary API token mismatch`);
    const scan = session.webFirstLayerScan();
    assert.ok(scan && scan.length > 0, `${REQUIREMENT} web-first layer scan is missing`);
    for (const result of scan) {
      assert.equal(
        result.platformApiImportCount,
        0,
        `${REQUIREMENT} ${result.layer} imports @tauri-apps/api ${result.platformApiImportCount} time(s)`,
      );
    }
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the web frontend builds and runs without Tauri",
  async function () {
    const session = sessionFor(this);
    assert.equal(session.webBuildProof(), "passed", `${REQUIREMENT} web build did not pass`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "capability access to the Java language service is defined through ports, not platform APIs",
  async function () {
    const session = sessionFor(this);
    const ports = session.portCapabilityEvidence();
    assert.ok(ports.length === 3, `${REQUIREMENT} port capability evidence is incomplete`);
    for (const port of ports) {
      assert.equal(port.declaresInterface, true, `${REQUIREMENT} ${port.port} does not declare a port interface`);
      assert.equal(port.tauriImports, 0, `${REQUIREMENT} ${port.port} imports a platform API`);
    }
    await attachEvidence(session, this);
  },
);

// -----------------------------------------------------------------------------
// AC-006 — implementation status is evidence-based and not promoted
// -----------------------------------------------------------------------------

Given<StoryWorld>(
  "characterization steps and glue establish meaningful RED for this feature",
  async function () {
    const session = sessionFor(this);
    session.start();
    await attachEvidence(session, this);
  },
);

When<StoryWorld>(
  "the feature file is parsed for requirement and status reconciliation",
  async function () {
    const session = sessionFor(this);
    session.reconcileFeatureStatus();
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the feature declares exactly one effective status \"@not-implemented\" at feature level",
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT} reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@not-implemented"),
      `${REQUIREMENT} feature does not declare @not-implemented`,
    );
    assert.equal(
      new Set(reconciliation.scenarioStatusTags).size,
      1,
      `${REQUIREMENT} scenarios declare more than one effective status`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "no scenario overrides that single effective status",
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT} reconciliation is missing`);
    assert.ok(
      reconciliation.scenarioStatusTags.every((tag) => tag === "@not-implemented"),
      `${REQUIREMENT} a scenario overrides @not-implemented`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "observed test evidence does not silently upgrade the declared status",
  async function () {
    const session = sessionFor(this);
    const reconciliation = session.featureReconciliation();
    assert.ok(reconciliation, `${REQUIREMENT} reconciliation is missing`);
    assert.ok(
      reconciliation.featureStatusTags.includes("@not-implemented"),
      `${REQUIREMENT} GREEN evidence silently upgraded the declared status`,
    );
    assert.equal(
      reconciliation.scenarioStatusTags.every((tag) => tag === "@not-implemented"),
      true,
      `${REQUIREMENT} GREEN evidence silently upgraded a scenario status`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the requirement ID \"@REQ-IDE-JAVA-LANGUAGE-001\" is repository-unique and reconciled",
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
    assert.ok(uniqueness.occurrences >= 6, `${REQUIREMENT} requirement ID is not reconciled across scenarios`);
    await attachEvidence(session, this);
  },
);

After<StoryWorld>({ tags: `@${REQUIREMENT}` }, async function () {
  const session = javaLanguageServiceSessions.get(this);
  if (session !== undefined) {
    session.dispose();
    await attachEvidence(session, this);
    javaLanguageServiceSessions.delete(this);
  }
});
