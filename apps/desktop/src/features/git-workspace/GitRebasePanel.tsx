import { useState } from "react";
import type { GitWorkspaceController } from "./useGitWorkspaceController";
export function GitRebasePanel({ git }: { git: GitWorkspaceController }) {
  const [upstream, setUpstream] = useState("");
  const [rewrite, setRewrite] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [skip, setSkip] = useState(false);
  const snapshot = git.snapshot,
    state = snapshot?.rebase,
    plan = git.rebasePlan;
  if (!git.supportsRebase || !snapshot || snapshot.mergeHeads?.length) return null;
  return (
    <fieldset
      aria-label="Local Git rebase"
      className="space-y-2"
      disabled={!!git.busy || !git.mutationsAvailable || !!git.branchSwitchUnavailableReason}
    >
      <legend className="font-semibold">Local rebase</legend>
      {state ? (
        <>
          <p role="status">
            Rebase paused on {state.branch}. Attempted step {state.completed} of {state.total}.
          </p>
          <p className="break-all">
            Original HEAD: <code>{state.originalHead}</code>
            <br />
            New base: <code>{state.onto}</code>
            <br />
            Stopped commit: <code>{state.stoppedCommit ?? "unavailable"}</code>
          </p>
          <p>
            Resolve conflicts in the normal editor, save, Refresh Git, review and stage each saved
            result, then review all staged changes. During rebase, Git’s “ours” side is the new base
            and its already replayed commits.
          </p>
          <button
            type="button"
            disabled={!git.canContinueRebase || !state.stoppedCommit}
            onClick={() => {
              void git.rebaseAction("continueRebase");
            }}
          >
            Continue reviewed rebase
          </button>
          <label className="flex gap-2">
            <input
              type="checkbox"
              aria-label="Discard saved rebase resolutions on abort"
              checked={discard}
              onChange={(e) => setDiscard(e.target.checked)}
            />
            I understand abort discards saved resolutions and restores the original branch.
          </label>
          <button
            type="button"
            disabled={!discard}
            onClick={() => {
              void git.rebaseAction("abortRebase");
            }}
          >
            Abort reviewed rebase
          </button>
          <label className="flex gap-2">
            <input
              type="checkbox"
              aria-label="Drop stopped rebase commit"
              checked={skip}
              onChange={(e) => setSkip(e.target.checked)}
            />
            I choose to drop the stopped commit and discard its saved resolutions.
          </label>
          <button
            type="button"
            disabled={!skip || !state.stoppedCommit}
            onClick={() => {
              void git.rebaseAction("skipRebase");
            }}
          >
            Skip reviewed rebase commit
          </button>
        </>
      ) : (
        <>
          <label className="flex flex-col">
            Replay current branch onto local branch
            <select
              aria-label="Git rebase upstream"
              value={upstream}
              onChange={(e) => {
                setUpstream(e.target.value);
                setRewrite(false);
              }}
            >
              <option value="">Choose a local upstream</option>
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
              !upstream ||
              !snapshot.branch ||
              !!snapshot.files.length ||
              !!snapshot.commitUnavailableReason
            }
            onClick={() => {
              setRewrite(false);
              void git.prepareRebase(upstream);
            }}
          >
            Review local rebase
          </button>
          <p>
            Requires a clean repository and saved editor buffers. Review supports up to 200 linear
            commits and one shared merge base. Git creates rewritten commits during the action;
            empty results pause for an explicit decision. No automatic stash, squash, merge
            flattening or update of other branches is requested.
          </p>
          {plan && plan.upstream === upstream && (
            <section aria-label="Git rebase history review">
              <p className="break-all">
                Branch: {plan.branch}
                <br />
                Original HEAD: <code>{plan.originalHead}</code>
                <br />
                New base: <code>{plan.onto}</code>
              </p>
              <ol aria-label="Commits selected for rebase">
                {plan.commits.map((commit) => (
                  <li key={commit.id}>
                    <code>{commit.id.slice(0, 12)}</code> {commit.subject} · {commit.author}
                  </li>
                ))}
              </ol>
              {!plan.commits.length && (
                <p>
                  No local commits to replay. Git may advance the current branch to the selected
                  base.
                </p>
              )}
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  aria-label="Acknowledge local history rewrite"
                  checked={rewrite}
                  onChange={(e) => setRewrite(e.target.checked)}
                />
                I understand this rewrites the current branch immediately and may replace saved
                files. Shared history requires coordination with its users.
              </label>
              <button
                type="button"
                disabled={!rewrite}
                onClick={() => {
                  void git.startRebase();
                }}
              >
                Start reviewed rebase
              </button>
            </section>
          )}
        </>
      )}
    </fieldset>
  );
}
