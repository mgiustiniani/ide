import { useState } from "react";
import type { GitWorkspaceController } from "./useGitWorkspaceController";
/** Explicit Git operations; the normal editor owns conflict resolution and saved text. */
export function GitMergePanel({ git }: { git: GitWorkspaceController }) {
  const [target, setTarget] = useState("");
  const [discardResolution, setDiscardResolution] = useState(false);
  const snapshot = git.snapshot;
  if (!snapshot || snapshot.mergeHeads === undefined) return null;
  const merging = snapshot.mergeHeads.length > 0;
  const unavailable = !!git.busy || !git.mutationsAvailable || !!git.branchSwitchUnavailableReason;
  return (
    <fieldset disabled={unavailable} className="space-y-2" aria-label="Local Git merge">
      <legend className="font-semibold">Local merge</legend>
      {merging ? (
        <>
          <p role="status">
            Merge in progress. Resolve conflicts in the editor, save each result, review and stage
            it, then review all staged changes and enter a commit message. Git creates the merge
            commit only when you explicitly commit.
          </p>
          <p className="break-all text-xs">Merge parent: {snapshot.mergeHeads.join(", ")}</p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              aria-label="Discard saved merge resolutions on abort"
              checked={discardResolution}
              onChange={(event) => setDiscardResolution(event.target.checked)}
            />
            I understand aborting discards saved merge resolutions and restores the pre-merge state.
          </label>
          <button
            type="button"
            disabled={!discardResolution}
            onClick={() => {
              void git.abortMerge();
            }}
          >
            Abort reviewed merge
          </button>
        </>
      ) : (
        <>
          <label className="flex flex-col">
            Merge local branch into the current branch
            <select
              aria-label="Git branch to merge"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">Choose a local branch</option>
              {snapshot.localBranches
                .filter((branch) => branch.name !== snapshot.branch)
                .map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-xs">
            Requires saved editor buffers and no saved changes or untracked files. Git stops before
            committing, including a fast-forward candidate. Review the result before committing or
            aborting. No automatic stash or cleanup is performed.
          </p>
          <button
            type="button"
            disabled={
              !target ||
              !snapshot.branch ||
              !snapshot.head ||
              !!snapshot.commitUnavailableReason ||
              !!snapshot.files.length
            }
            onClick={() => {
              void git.branchAction("mergeBranch", target);
            }}
          >
            Start reviewed merge
          </button>
        </>
      )}
    </fieldset>
  );
}
