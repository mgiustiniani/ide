import { After, Given, Then, When } from "@cucumber/cucumber";
import { NativeGitWorkspaceSession } from "../support/native-git-workspace.js";
import type { StoryWorld } from "../support/world.js";
const sessions = new WeakMap<StoryWorld, NativeGitWorkspaceSession>();
function session(world: StoryWorld) {
  const value = sessions.get(world);
  if (!value) throw Error("Git source-control scenario is not prepared");
  return value;
}
Given<StoryWorld>(
  "the native Git GUI has an isolated repository with saved Java changes",
  { timeout: 20000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence?.packagedApplication !== false
    )
      throw Error("Git qualification requires a real native release/no-bundle GUI");
    const value = new NativeGitWorkspaceSession();
    sessions.set(this, value);
    await value.prepare();
  },
);
When<StoryWorld>(
  "the person reviews, stages, unstages and commits the saved Java file while retaining a notes draft",
  { timeout: 120000 },
  async function () {
    const value = session(this);
    try {
      await value.exercise();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "Git records only the staged Java version, honors its hook and preserves the notes draft",
  async function () {
    const p = session(this).evidence();
    if (
      !p.trustRequired ||
      !p.indexPreservedBeforeAction ||
      !p.stageAndUnstageVerified ||
      !p.dirtyStageRefused ||
      !p.explicitStagedReviewRequired ||
      !p.commitVerified ||
      !p.hookExecuted ||
      !p.historyPresented ||
      !p.blameCommitted ||
      !p.blamePaged ||
      !p.blameUncommitted ||
      !p.blameStaleRefused ||
      !p.blameDraftPreserved ||
      !p.draftsPreserved ||
      !p.configurationPreserved
    )
      throw Error("Native Git actions did not preserve their reviewed source/index boundaries");
  },
);
When<StoryWorld>(
  "the person discards the notes draft and reopens the Git IDE",
  { timeout: 90000 },
  async function () {
    const value = session(this);
    try {
      await value.restart();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "Git trust is reset and the existing index is unchanged after restart",
  async function () {
    const p = session(this).evidence();
    if (!p.trustResetAfterRestart || !p.indexPreservedOnRestart)
      throw Error("Git restart did not reset trust while retaining the index");
  },
);
When<StoryWorld>(
  "the person closes the Git source-control IDE",
  { timeout: 30000 },
  async function () {
    await session(this).close();
  },
);
Then<StoryWorld>("the Git source-control IDE exits with source files preserved", async function () {
  if (!session(this).evidence().cleanExit)
    throw Error("Git source-control application did not close normally");
});
After<StoryWorld>({ tags: "@REQ-IDE-GIT-SOURCE-CONTROL-001", timeout: 45000 }, async function () {
  await sessions.get(this)?.dispose();
  sessions.delete(this);
});

Given<StoryWorld>(
  "the native Git GUI has an isolated repository with a held pre-commit hook",
  { timeout: 20000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence?.packagedApplication !== false
    )
      throw Error("Git qualification requires a real native release/no-bundle GUI");
    const value = new NativeGitWorkspaceSession();
    sessions.set(this, value);
    await value.prepare(true);
  },
);
When<StoryWorld>(
  "the person tries native close and workspace switching while the Git hook is pending",
  { timeout: 90000 },
  async function () {
    const value = session(this);
    try {
      await value.exerciseTransitionGuards();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "the Git mutation refuses both transitions and permits switching after completion",
  async function () {
    const p = session(this).evidence();
    if (
      !p.mutationCloseRefused ||
      !p.mutationWorkspaceSwitchRefused ||
      !p.workspaceSwitchAfterCommit
    )
      throw Error("Native Git mutation did not guard workspace and window transitions");
  },
);

Given<StoryWorld>(
  "the native Git GUI has an isolated repository with distinct local branches",
  { timeout: 20000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence?.packagedApplication !== false
    )
      throw Error("Git qualification requires a real native release/no-bundle GUI");
    const value = new NativeGitWorkspaceSession();
    sessions.set(this, value);
    await value.prepare(false, true);
  },
);
When<StoryWorld>(
  "the person creates a branch and switches after resolving editor and saved-file conflicts",
  { timeout: 120000 },
  async function () {
    const value = session(this);
    try {
      await value.exerciseBranches();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "Git preserves drafts and saved conflicts and refreshes clean buffers with a usable save baseline",
  async function () {
    const p = session(this).evidence();
    if (
      !p.branchCreated ||
      !p.inactiveBranchRenamed ||
      !p.currentBranchRenamedWithDraft ||
      !p.branchRenameCollisionRefused ||
      !p.dirtyBranchSwitchRefused ||
      !p.savedBranchSwitchRefused ||
      !p.cleanBranchBufferRefreshed ||
      !p.branchSaveBaselineUpdated ||
      !p.branchRoundTrip
    )
      throw Error("Native branch workflow did not preserve and reconcile source buffers");
  },
);

Given<StoryWorld>(
  "the native Git GUI has an isolated repository with diverging Java branches",
  { timeout: 20000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence?.packagedApplication !== false
    )
      throw Error("Native merge qualification requires the release/no-bundle desktop");
    const value = new NativeGitWorkspaceSession();
    sessions.set(this, value);
    await value.prepareMerge();
  },
);
When<StoryWorld>(
  "the person aborts a reviewed conflict and then resolves and commits the Java merge",
  { timeout: 120000 },
  async function () {
    const value = session(this);
    try {
      await value.exerciseMerge();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "Git preserves drafts, restores the aborted merge and records a compilable two-parent resolution",
  async function () {
    const p = session(this).evidence();
    if (
      !p.mergeDirtyRefused ||
      !p.mergeConflictPresented ||
      !p.mergeAbortRestored ||
      !p.mergeResolvedCommitted ||
      !p.mergeJavaCompiled
    )
      throw Error("The native merge did not preserve its reviewed source boundaries");
  },
);

Given<StoryWorld>(
  "the native Git GUI has an isolated repository with a linear Java rebase",
  { timeout: 20000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence?.packagedApplication !== false
    )
      throw Error("Native rebase qualification requires the release/no-bundle desktop");
    const value = new NativeGitWorkspaceSession();
    sessions.set(this, value);
    await value.prepareRebase();
  },
);
When<StoryWorld>(
  "the person reviews, aborts and then resolves and continues the local Java rebase",
  { timeout: 120000 },
  async function () {
    const value = session(this);
    try {
      await value.exerciseRebase();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "Git rewrites only the reviewed branch, preserves drafts and compiles the resolved Java source",
  async function () {
    const p = session(this).evidence();
    if (
      !p.rebaseHistoryReviewed ||
      !p.rebaseDirtyRefused ||
      !p.rebaseConflictPresented ||
      !p.rebaseAbortRestored ||
      !p.rebaseResolvedContinued ||
      !p.rebaseJavaCompiled
    )
      throw Error("Native rebase qualification is incomplete");
  },
);

Given<StoryWorld>(
  "the native Git GUI has an isolated repository with more than fifty historical Java commits",
  { timeout: 30000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence?.packagedApplication !== false
    )
      throw Error("Git history qualification requires a real native release/no-bundle GUI");
    const value = new NativeGitWorkspaceSession();
    sessions.set(this, value);
    await value.prepareHistory();
  },
);
When<StoryWorld>(
  "the person pages committed Java history, reviews a deleted file and encounters an external commit",
  { timeout: 120000 },
  async function () {
    const value = session(this);
    try {
      await value.exerciseHistory();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "historical reviews preserve drafts and the index and refuse the retired Git page",
  async function () {
    const p = session(this).evidence();
    if (
      !p.trustRequired ||
      !p.historyPaged ||
      !p.historicalCommitReviewed ||
      !p.deletedPathHistoryReviewed ||
      !p.staleHistoryRefused ||
      !p.historyDraftPreserved ||
      !p.historyIndexPreserved ||
      !p.configurationPreserved
    )
      throw Error("Git history did not preserve its captured read-only scope");
  },
);

Given<StoryWorld>(
  "the native Git GUI has isolated merged and unmerged local branches",
  { timeout: 30000 },
  async function () {
    if (
      this.targetProfile.driver !== "tauri-webdriver" ||
      this.targetEvidence?.nativeGui !== true ||
      this.targetEvidence?.packagedApplication !== false
    )
      throw Error("Branch deletion qualification requires a real native release/no-bundle GUI");
    const value = new NativeGitWorkspaceSession();
    sessions.set(this, value);
    await value.prepareDeletion();
  },
);
When<StoryWorld>(
  "the person reviews local branch deletion, rejects a stale target and explicitly confirms forced deletion",
  { timeout: 120000 },
  async function () {
    const value = session(this);
    try {
      await value.exerciseDeletion();
    } catch (error) {
      value.setFailure(error);
      await value.captureFailure();
      throw error;
    }
  },
);
Then<StoryWorld>(
  "Git deletes only the confirmed local branches while preserving the current source, index and editor draft",
  async function () {
    const p = session(this).evidence();
    if (
      !p.trustRequired ||
      !p.deletionReviewedWithoutWrites ||
      !p.mergedBranchDeleted ||
      !p.forcedBranchDeleted ||
      !p.deletionNameRequired ||
      !p.deletionForceRequired ||
      !p.staleDeletionRefused ||
      !p.deletionDraftPreserved ||
      !p.deletionIndexPreserved ||
      !p.configurationPreserved
    )
      throw Error("Branch deletion did not preserve the reviewed Git authority");
  },
);
