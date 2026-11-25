import { useState } from "react";
import { GitRebasePanel } from "./GitRebasePanel";
import { GitBranchDeletePanel } from "./GitBranchDeletePanel";
import { GitMergePanel } from "./GitMergePanel";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { GitBlamePanel } from "./GitBlamePanel";
import type { GitWorkspaceController } from "./useGitWorkspaceController";
export function GitWorkspacePanel({ controller: git }: { controller: GitWorkspaceController }) {
  const [newBranch, setNewBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [renameSource, setRenameSource] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  return (
    <section
      aria-label="Git source control"
      aria-busy={Boolean(git.busy)}
      className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3 text-sm text-[var(--text-primary)] [&_input]:bg-[var(--surface-editor)] [&_input]:text-[var(--text-primary)] [&_select]:bg-[var(--surface-editor)] [&_select]:text-[var(--text-primary)] [&_textarea]:text-[var(--text-primary)] [&_button]:text-[var(--text-primary)] [&_button:disabled]:opacity-50"
    >
      <h2 className="font-semibold">Git Source Control</h2>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={git.trusted}
          disabled={!git.available || git.isWriting}
          onChange={(event) => git.setTrusted(event.target.checked)}
        />
        I trust this repository to execute Git hooks and filters.
      </label>
      <p className="text-xs text-[var(--text-secondary)]">
        Git uses saved files and its index. These actions never save editor buffers. Hooks and
        filters can execute repository-configured programs.
      </p>
      <button
        type="button"
        disabled={!git.trusted || !git.available || Boolean(git.busy)}
        onClick={() => {
          void git.refresh();
        }}
      >
        Refresh Git
      </button>
      {!git.available ? (
        <p role="status">Open a workspace and wait for activation before using Git.</p>
      ) : null}
      {git.busy ? <p role="status">{git.busy}</p> : null}
      {git.error ? <p role="alert">{git.error}</p> : null}
      {git.status ? <p role="status">{git.status}</p> : null}
      <GitBlamePanel key={git.workspaceKey} git={git} />
      {git.snapshot ? (
        <>
          <p className="break-all text-xs">
            Repository: {git.snapshot.repositoryRoot}
            <br />
            Branch:{" "}
            {git.snapshot.branch ?? (git.snapshot.head ? "Detached HEAD" : "No initial commit")}
          </p>
          <fieldset
            disabled={
              Boolean(git.busy) ||
              !git.mutationsAvailable ||
              !git.snapshot.head ||
              !!git.snapshot.rebase
            }
            className="space-y-2"
          >
            <legend className="font-semibold">Local branches</legend>
            <label className="flex flex-col gap-1">
              New branch from current HEAD
              <input
                aria-label="New Git branch name"
                value={newBranch}
                maxLength={1024}
                onChange={(event) => setNewBranch(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!newBranch.trim()}
              onClick={() => {
                void git.branchAction("createBranch", newBranch);
              }}
            >
              Create local branch
            </button>
            <label className="flex flex-col gap-1">
              Switch to local branch
              <select
                aria-label="Target Git branch"
                value={
                  git.snapshot.localBranches.some((branch) => branch.name === targetBranch)
                    ? targetBranch
                    : ""
                }
                onChange={(event) => setTargetBranch(event.target.value)}
              >
                <option value="">Choose a local branch</option>
                {git.snapshot.localBranches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.name === git.snapshot!.branch ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={
                !targetBranch ||
                targetBranch === git.snapshot.branch ||
                Boolean(git.snapshot.commitUnavailableReason) ||
                Boolean(git.snapshot.mergeHeads?.length) ||
                Boolean(git.branchSwitchUnavailableReason)
              }
              onClick={() => {
                void git.branchAction("switchBranch", targetBranch);
              }}
            >
              Switch local branch
            </button>
            <label className="flex flex-col gap-1">
              Local branch to rename
              <select
                aria-label="Git branch to rename"
                value={
                  git.snapshot.localBranches.some((branch) => branch.name === renameSource)
                    ? renameSource
                    : ""
                }
                onChange={(event) => setRenameSource(event.target.value)}
              >
                <option value="">Choose a local branch</option>
                {git.snapshot.localBranches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.name === git.snapshot!.branch ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Replacement branch name
              <input
                aria-label="Replacement Git branch name"
                value={renameTarget}
                maxLength={1024}
                onChange={(event) => setRenameTarget(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !git.snapshot.localBranches.some((branch) => branch.name === renameSource) ||
                !renameTarget.trim() ||
                git.snapshot.localBranches.some((branch) => branch.name === renameTarget)
              }
              onClick={() => {
                void git.renameBranch(renameSource, renameTarget);
              }}
            >
              Rename local branch
            </button>
            <p className="text-xs">
              Renaming keeps saved files and editor drafts. Existing names and branches checked out
              in another worktree are refused. Remote branch names are unchanged.
            </p>
            <p className="text-xs">
              Creation keeps the current branch. Switching requires saved editor buffers; Git checks
              saved changes before replacing files.
            </p>
            {git.branchSwitchUnavailableReason ? (
              <p role="status">{git.branchSwitchUnavailableReason}</p>
            ) : null}
          </fieldset>
          <GitBranchDeletePanel
            key={`delete:${git.workspaceKey}:${git.snapshot.revision}`}
            git={git}
          />
          {!git.snapshot.rebase && (
            <GitMergePanel key={`merge:${git.snapshot.revision}`} git={git} />
          )}
          <GitRebasePanel key={`rebase:${git.snapshot.revision}`} git={git} />
          {git.snapshot.files.length === 0 ? (
            <p role="status">No changed files in this workspace.</p>
          ) : null}
          <h3 className="font-semibold">Changes</h3>
          <ul aria-label="Git changed files" className="space-y-3">
            {git.snapshot.files.map((file) => (
              <li key={file.path} className="rounded border border-[var(--border-default)] p-2">
                <p className="whitespace-pre-wrap break-all">
                  {file.path}
                  {file.originalPath ? ` (from ${file.originalPath})` : ""}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {file.staged ? "Staged" : "Not staged"}
                  {file.unstaged ? " · Unstaged changes" : ""}
                  {git.isDirty(file.path) ? " · Unsaved editor changes" : ""}
                  {file.conflict ? " · Conflict" : ""}
                  {file.directory ? " · Directory or submodule" : ""}
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {file.unstaged ? (
                    <button
                      type="button"
                      disabled={Boolean(git.busy) || file.directory}
                      aria-label={`Review saved changes in ${file.path}`}
                      onClick={() => {
                        void git.review(file.path, false);
                      }}
                    >
                      Review saved changes
                    </button>
                  ) : null}
                  {file.staged ? (
                    <>
                      <button
                        type="button"
                        disabled={Boolean(git.busy) || file.directory}
                        aria-label={`Review staged changes in ${file.path}`}
                        onClick={() => {
                          void git.review(file.path, true);
                        }}
                      >
                        Review staged changes
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(git.busy) || !git.mutationsAvailable || file.directory}
                        aria-label={`Unstage ${file.path}`}
                        onClick={() => {
                          void git.unstage(file.path);
                        }}
                      >
                        Unstage
                      </button>
                    </>
                  ) : null}
                  {!file.directory &&
                  file.worktree !== "D" &&
                  !(file.index === "D" && !file.unstaged) ? (
                    <button
                      type="button"
                      disabled={git.isWriting}
                      aria-label={`Open Git file ${file.path}`}
                      onClick={() => {
                        void git.openFile(file.path);
                      }}
                    >
                      Open file
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={
              Boolean(git.busy) ||
              (!git.snapshot.files.some((file) => file.staged) &&
                !git.snapshot.mergeHeads?.length &&
                !git.snapshot.rebase)
            }
            onClick={() => {
              void git.review(null, true);
            }}
          >
            Review all staged changes
          </button>
          {git.selection ? (
            <div className="space-y-2">
              <h3 className="font-semibold">{git.selection.path ?? "All staged changes"}</h3>
              <pre
                aria-label="Git changes review"
                className="max-h-80 overflow-auto whitespace-pre border border-[var(--border-default)] p-2 text-xs"
              >
                {git.selection.text}
              </pre>
              {!git.selection.staged && git.selection.path ? (
                <button
                  type="button"
                  disabled={
                    Boolean(git.busy) || !git.mutationsAvailable || git.isDirty(git.selection.path)
                  }
                  onClick={() => {
                    void git.stage();
                  }}
                >
                  Stage reviewed saved file
                </button>
              ) : null}
              {!git.selection.staged && git.selection.path && git.isDirty(git.selection.path) ? (
                <p role="status">Save or discard this file's editor changes before staging it.</p>
              ) : null}
            </div>
          ) : null}
          <fieldset disabled={git.isWriting} className="space-y-2">
            <legend className="font-semibold">Commit staged changes</legend>
            <label className="flex flex-col gap-1">
              Author name
              <input
                aria-label="Git author name"
                value={git.authorName}
                maxLength={256}
                onChange={(event) => git.setAuthorName(event.target.value)}
                className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] p-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              Author email
              <input
                aria-label="Git author email"
                value={git.authorEmail}
                maxLength={320}
                onChange={(event) => git.setAuthorEmail(event.target.value)}
                className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] p-1"
              />
            </label>
            <p className="text-xs text-[var(--text-secondary)]">
              Identity applies to this commit; repository configuration is retained.
            </p>
            <label className="flex flex-col gap-1">
              Commit message
              <textarea
                aria-label="Git commit message"
                value={git.message}
                maxLength={16000}
                rows={4}
                onChange={(event) => git.setMessage(event.target.value)}
                className="rounded border border-[var(--border-default)] bg-[var(--surface-background)] p-1"
              />
            </label>
            {git.snapshot.commitUnavailableReason ? (
              <p role="status">{git.snapshot.commitUnavailableReason}</p>
            ) : null}
            <p className="text-xs">
              Review all staged changes to enable Commit. Editor buffers are never saved. Trusted
              Git hooks can change files or staging.
            </p>
            <button
              type="button"
              disabled={!git.canCommit}
              onClick={() => {
                void git.commit();
              }}
            >
              Commit staged changes
            </button>
          </fieldset>
          <GitHistoryPanel key={git.workspaceKey} git={git} />
          <h3 className="font-semibold">Recent commits in this workspace</h3>
          <ol aria-label="Recent Git commits" className="space-y-2">
            {git.snapshot.commits.map((commit) => (
              <li key={commit.id}>
                <p className="break-words">{commit.subject}</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {commit.id.slice(0, 12)} · {commit.author} · {commit.date}
                </p>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}
