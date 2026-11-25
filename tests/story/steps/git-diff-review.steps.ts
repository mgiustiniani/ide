// -----------------------------------------------------------------------------
// tests/story/steps/git-diff-review.steps.ts
// Story BDD steps for REQ-IDE-GIT-DIFF-REVIEW-001 (features/workspace/git-diff-review.feature).
//
// RED phase: every port delegation fails closed with NOT_IMPLEMENTED until
// production ports and adapters exist behind packages/web-core/src/ports,
// packages/browser-adapters/src, and packages/tauri-adapters/src. The steps
// assert the desired contract; the driver's anti-fake RED makes them fail.
// -----------------------------------------------------------------------------

import { After, Given, Then, When } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import type { StoryWorld } from "../support/world.js";
import { DefaultEditorOpenRangePort } from "../../../packages/web-core/src/ports/editor-open-range-port.js";
import { GitDiffReviewSession, REQUIREMENT } from "../support/git-diff-review.js";

const gitDiffReviewSessions = new WeakMap<StoryWorld, GitDiffReviewSession>();

function sessionFor(world: StoryWorld): GitDiffReviewSession {
  let session = gitDiffReviewSessions.get(world);
  if (session === undefined) {
    session = new GitDiffReviewSession();
    gitDiffReviewSessions.set(world, session);
  }
  return session;
}

async function attachEvidence(session: GitDiffReviewSession, world: StoryWorld): Promise<void> {
  await world.attach(JSON.stringify(session.evidence(), null, 2), "application/json");
}

Given<StoryWorld>(
  "an open workspace with a modified file {string}",
  async function (filePath: string) {
    const session = sessionFor(this);
    session.start();
    session.recordModifiedFiles([filePath]);
    await attachEvidence(session, this);
  },
);

Given<StoryWorld>(
  "a visible read-only hunk-level diff range from line {int} to line {int}",
  async function (startLine: number, endLine: number) {
    const session = sessionFor(this);
    const modified = session.modifiedFiles();
    const path = modified.length > 0 ? modified[0] : "src/lib/git.ts";
    session.recordVisibleRange(path, startLine, endLine);
    await attachEvidence(session, this);
  },
);

Given<StoryWorld>("a platform that cannot produce a diff for the modified file", async function () {
  const session = sessionFor(this);
  session.markPlatformDiffUnavailable();
  await attachEvidence(session, this);
});

Given<StoryWorld>(
  "the web-first layers packages\\/ui, packages\\/web-core, and apps\\/web",
  async function () {
    const session = sessionFor(this);
    session.start();
    session.recordWebFirstLayers(["packages/ui", "packages/web-core", "apps/web"]);
    await attachEvidence(session, this);
  },
);

When<StoryWorld>("the Changes surface is asked to review the modified file", async function () {
  const session = sessionFor(this);
  await session.reviewModifiedFile("src/lib/git.ts"); // RED: throws NOT_IMPLEMENTED
  await attachEvidence(session, this);
});

When<StoryWorld>("the person activates the diff range in the Changes surface", async function () {
  const session = sessionFor(this);
  const visible = session.visibleRange() ?? { path: "src/lib/git.ts", startLine: 42, endLine: 60 };
  // Inject a real editor driver so the production port DELEGATES and returns
  // the driver's outcome — never an identity shortcut. This is the
  // exact-range-open scenario (REQ-IDE-GIT-DIFF-REVIEW-002).
  const editorPort = new DefaultEditorOpenRangePort({
    openRange: (range) => {
      session.recordEditorDriverOpen(range);
      return { kind: "ok", opened: range };
    },
  });
  session.setEditorPort(editorPort);
  await session.openRange(visible.path, visible.startLine, visible.endLine);
  await attachEvidence(session, this);
});

When<StoryWorld>("the diff adapter is asked to produce the diff", async function () {
  const session = sessionFor(this);
  await session.reviewModifiedFile("src/lib/git.ts"); // RED: throws NOT_IMPLEMENTED
  await attachEvidence(session, this);
});

When<StoryWorld>("their source is scanned for platform API imports", async function () {
  const session = sessionFor(this);
  session.scanWebFirstLayers(session.webFirstLayers());
  await attachEvidence(session, this);
});

Then<StoryWorld>(
  "the Changes surface returns a read-only hunk-level diff for the modified file",
  async function () {
    const session = sessionFor(this);
    const outcome = session.reviewOutcome();
    assert.ok(outcome, `${REQUIREMENT} review outcome is missing`);
    assert.equal(outcome.kind, "ok", `${REQUIREMENT} must be an ok outcome`);
    assert.equal(outcome.diff.readOnly, true, `${REQUIREMENT} diff must be read-only`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>("the hunk-level diff carries line and range metadata", async function () {
  const session = sessionFor(this);
  const outcome = session.reviewOutcome();
  assert.ok(outcome && outcome.kind === "ok", `${REQUIREMENT} ok diff is missing`);
  assert.ok(outcome.diff.hunks.length > 0, `${REQUIREMENT} hunk-level diff has no hunks`);
  assert.ok(outcome.diff.range.startLine >= 1, `${REQUIREMENT} range has no start line`);
  assert.ok(
    outcome.diff.range.endLine >= outcome.diff.range.startLine,
    `${REQUIREMENT} range is not contiguous`,
  );
  assert.equal(outcome.diff.path, "src/lib/git.ts", `${REQUIREMENT} diff path mismatch`);
  await attachEvidence(session, this);
});

Then<StoryWorld>(
  "no write operation touched the working tree during the review",
  async function () {
    const session = sessionFor(this);
    assert.equal(
      session.writeOperations().length,
      0,
      `${REQUIREMENT} review wrote to the working tree`,
    );
    assert.ok(
      session
        .invokedPorts()
        .every((port) => port.endsWith("#listModifiedFiles") || port.endsWith("#produceDiff")),
      `${REQUIREMENT} review delegated outside the read-only diff ports`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the existing editor port opens the exact path {string} at lines {int} to {int}",
  async function (filePath: string, startLine: number, endLine: number) {
    const session = sessionFor(this);
    const opened = session.openedRange();
    assert.ok(opened, `${REQUIREMENT} editor port did not open a range`);
    assert.deepEqual(opened, { path: filePath, startLine, endLine });
    // The exact range came from the injected editor driver, never an identity shortcut.
    assert.deepEqual(
      session.editorDriverOpened(),
      { path: filePath, startLine, endLine },
      `${REQUIREMENT} the injected editor driver did not open the exact range`,
    );
    assert.equal(
      session.lastOutcomeSource(),
      "editor-driver",
      `${REQUIREMENT} range-open outcome did not come from real driver delegation`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the IDE creates no new AI or model dependency for the open operation",
  async function () {
    const session = sessionFor(this);
    assert.equal(
      session.aiOrModelOperations().length,
      0,
      `${REQUIREMENT} opened an AI/model dependency`,
    );
    assert.ok(
      session.invokedPorts().every((port) => port.endsWith("#openRange")),
      `${REQUIREMENT} range activation delegated outside the editor port`,
    );
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the diff adapter reports unavailable honestly with a platform reason",
  async function () {
    const session = sessionFor(this);
    const outcome = session.reviewOutcome();
    assert.ok(outcome, `${REQUIREMENT} review outcome is missing`);
    assert.equal(outcome.kind, "unavailable", `${REQUIREMENT} must report unavailable`);
    assert.ok(outcome.reason.length > 0, `${REQUIREMENT} unavailable has no platform reason`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "the diff adapter does not fall back to a mock-only or hard-coded response",
  async function () {
    const session = sessionFor(this);
    assert.equal(session.fabricatedResponse(), false, `${REQUIREMENT} fabricated a diff response`);
    await attachEvidence(session, this);
  },
);

Then<StoryWorld>(
  "no import of @tauri-apps\\/api is present in the web-first layers",
  async function () {
    const session = sessionFor(this);
    const scan = session.webFirstLayerScan();
    assert.ok(scan.length > 0, `${REQUIREMENT} web-first layer scan is missing`);
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
  "browser and Tauri diff implementations live behind the frontend ports",
  async function () {
    const session = sessionFor(this);
    await session.diffImplementationsBehindPorts(); // RED: throws NOT_IMPLEMENTED
    await attachEvidence(session, this);
  },
);

After<StoryWorld>({ tags: `@${REQUIREMENT}` }, async function () {
  const session = gitDiffReviewSessions.get(this);
  if (session !== undefined) {
    session.dispose(); // remove the temporary git fixture if present
    await attachEvidence(session, this);
    gitDiffReviewSessions.delete(this);
  }
});
