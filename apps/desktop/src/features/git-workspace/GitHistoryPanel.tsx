import { useState } from "react";
import type { GitWorkspaceController } from "./useGitWorkspaceController";
export function GitHistoryPanel({ git }: { git: GitWorkspaceController }) {
  const [path, setPath] = useState("");
  const page = git.historySelection;
  const unavailable = !git.supportsHistory || !git.trusted || !git.snapshot?.head || !!git.busy;
  return (
    <details>
      <summary className="font-semibold">Commit history</summary>
      <p className="text-xs">
        Browse committed history reachable from the captured HEAD, 50 commits per page. Leave the
        path empty for this workspace or enter a literal workspace-relative file or directory,
        including deleted paths. File renames are not followed. Merge reviews compare against the
        first parent. Drafts and the index remain unchanged.
      </p>
      {!git.supportsHistory && (
        <p role="status">This host does not provide paginated Git history.</p>
      )}
      <fieldset disabled={unavailable} className="space-y-2">
        <label className="flex flex-col">
          History path (optional)
          <input
            aria-label="Git history path"
            value={path}
            maxLength={32768}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => void git.loadHistory(path || null)}>
          Browse commit history
        </button>
        <button
          type="button"
          disabled={!git.activeFilePath}
          onClick={() => {
            if (git.activeFilePath) {
              setPath(git.activeFilePath);
              void git.loadHistory(git.activeFilePath);
            }
          }}
        >
          History of active file
        </button>
      </fieldset>
      {page && (
        <section aria-label="Git commit history">
          <p className="break-all">
            {page.path ?? "Workspace"} · HEAD {page.head.slice(0, 12)} · commits{" "}
            {page.commits.length ? page.offset + 1 : 0}–{page.offset + page.commits.length}
          </p>
          {!page.commits.length && <p>No commits match this path in the captured history.</p>}
          <ol aria-label="Git history page" className="max-h-72 space-y-2 overflow-auto">
            {page.commits.map((commit) => (
              <li key={commit.id}>
                <p className="break-words">{commit.subject}</p>
                <p className="text-xs">
                  {commit.id.slice(0, 12)} · {commit.author} · {commit.date}
                </p>
                <button
                  type="button"
                  aria-label={`Review commit ${commit.id}`}
                  disabled={unavailable}
                  onClick={() => void git.reviewCommit(commit.id)}
                >
                  Review committed changes
                </button>
              </li>
            ))}
          </ol>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={unavailable || page.offset === 0}
              onClick={() => void git.loadHistory(page.path, Math.max(0, page.offset - 50))}
            >
              Newer commits
            </button>
            <button
              type="button"
              disabled={unavailable || page.nextOffset === null}
              onClick={() => {
                if (page.nextOffset !== null) void git.loadHistory(page.path, page.nextOffset);
              }}
            >
              Older commits
            </button>
          </div>
          {git.commitSelection && (
            <pre
              aria-label="Git historical commit review"
              className="max-h-96 overflow-auto whitespace-pre border border-[var(--border-default)] p-2 text-xs"
            >
              {git.commitSelection.text}
            </pre>
          )}
        </section>
      )}
    </details>
  );
}
