import { useState } from "react";
import type { GitWorkspaceBranchDeletePlan } from "@ide/contracts";
import type { GitWorkspaceController } from "./useGitWorkspaceController";
function Review({
  git,
  plan,
}: {
  git: GitWorkspaceController;
  plan: GitWorkspaceBranchDeletePlan;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [force, setForce] = useState(false);
  return (
    <section aria-label="Git branch deletion review" className="space-y-2">
      <p className="break-all">
        Delete local branch <strong>{plan.name}</strong> at <code>{plan.branchHead}</code>.
      </p>
      <p className="break-all">
        Compared with current HEAD <code>{plan.currentHead}</code>.
      </p>
      <p>
        {plan.commitsNotInHead}{" "}
        {plan.commitsNotInHead === 1 ? "commit on this branch is" : "commits on this branch are"}{" "}
        not contained in current HEAD.
      </p>
      <ol
        aria-label="Branch commits not contained in HEAD"
        className="max-h-64 space-y-2 overflow-auto"
      >
        {plan.commits.map((commit) => (
          <li key={commit.id}>
            <p className="break-words">{commit.subject}</p>
            <p className="text-xs">
              {commit.id.slice(0, 12)} · {commit.author} · {commit.date}
            </p>
          </li>
        ))}
      </ol>
      {plan.commitsTruncated && (
        <p role="status">
          Only the first 200 commits are displayed. Use Git to inspect the complete range before
          deciding.
        </p>
      )}
      <p>
        Deletion removes this local reference, its reflog and branch configuration. Other references
        can still retain the commits. The action changes local branch metadata while keeping editor
        drafts in place. Trusted Git hooks can have additional effects. There is no IDE undo for
        this action.
      </p>
      <label className="flex gap-2">
        <input
          type="checkbox"
          aria-label="Allow forced local branch deletion"
          checked={force}
          onChange={(event) => setForce(event.target.checked)}
        />
        I explicitly allow forced deletion, including commits not contained in HEAD.
      </label>
      <label className="flex flex-col">
        Type the exact branch name to confirm
        <input
          aria-label="Confirm local branch deletion name"
          autoComplete="off"
          spellCheck={false}
          maxLength={1024}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={confirmation !== plan.name || (plan.commitsNotInHead > 0 && !force)}
        onClick={() => void git.deleteReviewedBranch(confirmation, force)}
      >
        Delete reviewed local branch
      </button>
    </section>
  );
}
export function GitBranchDeletePanel({ git }: { git: GitWorkspaceController }) {
  const [name, setName] = useState("");
  const snapshot = git.snapshot;
  if (!snapshot) return null;
  const plan = git.branchDeletePlan;
  return (
    <details>
      <summary className="font-semibold">Delete a local branch</summary>
      {!git.supportsBranchDelete && (
        <p role="status">This host does not provide reviewed local branch deletion.</p>
      )}
      <fieldset
        aria-label="Local branch deletion"
        disabled={
          !git.supportsBranchDelete ||
          !!git.busy ||
          !git.mutationsAvailable ||
          !!git.branchSwitchUnavailableReason ||
          !!snapshot.rebase ||
          !!snapshot.mergeHeads?.length
        }
        className="space-y-2"
      >
        <label className="flex flex-col">
          Local branch to delete
          <select
            aria-label="Git branch to delete"
            value={
              snapshot.localBranches.some(
                (branch) => branch.name === name && name !== snapshot.branch,
              )
                ? name
                : ""
            }
            onChange={(event) => setName(event.target.value)}
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
        <button
          type="button"
          disabled={
            !name ||
            !snapshot.localBranches.some(
              (branch) => branch.name === name && name !== snapshot.branch,
            )
          }
          onClick={() => void git.prepareBranchDelete(name)}
        >
          Review local branch deletion
        </button>
        <p>
          Requires the repository root. Branches checked out in any worktree are refused. Normal
          deletion requires all commits to be contained in current HEAD; other branches require a
          separate explicit force choice.
        </p>
        {plan?.name === name && <Review key={plan.fingerprint} git={git} plan={plan} />}
      </fieldset>
    </details>
  );
}
