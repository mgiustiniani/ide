import { useState } from "react";
import { GIT_BLAME_PAGE_LINES } from "@ide/contracts";
import type { GitWorkspaceController } from "./useGitWorkspaceController";
export function GitBlamePanel({ git }: { git: GitWorkspaceController }) {
  const [path, setPath] = useState("");
  const [start, setStart] = useState("1");
  const page = git.blameSelection;
  const unavailable = !git.supportsBlame || !git.trusted || !git.snapshot?.head || !!git.busy;
  function read(path: string, line: number, fingerprint?: string) {
    setPath(path);
    setStart(String(line));
    void git.blameFile(path, line, fingerprint);
  }
  return (
    <details>
      <summary className="font-semibold">Saved-source blame</summary>
      <p className="text-xs">
        Inspect who last changed saved lines. Editor drafts are excluded. Git owns attribution,
        rename tracking and configured ignored revisions. Source files are limited to 512 KiB; each
        page contains at most 200 lines. Select a line number to open its unchanged saved source.
      </p>
      {!git.supportsBlame && <p role="status">This host does not provide Git blame.</p>}
      <fieldset disabled={unavailable} className="space-y-2">
        <label className="flex flex-col">
          Workspace-relative blame file
          <input
            aria-label="Git blame file"
            value={path}
            maxLength={32768}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <label>
          First saved line{" "}
          <input
            aria-label="Git blame start line"
            type="number"
            min={1}
            step={1}
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!path || !Number.isSafeInteger(Number(start)) || Number(start) < 1}
            onClick={() => read(path, Number(start))}
          >
            Blame saved file
          </button>
          <button
            type="button"
            disabled={!git.activeFilePath}
            onClick={() => {
              if (git.activeFilePath) read(git.activeFilePath, 1);
            }}
          >
            Blame active saved file
          </button>
        </div>
      </fieldset>
      {page && (
        <section aria-label="Saved-source blame">
          <p className="whitespace-pre-wrap break-all">
            {page.path}: saved lines {page.totalLines ? page.startLine : 0}–
            {page.startLine + page.lines.length - 1} of {page.totalLines}
          </p>
          {git.isDirty(page.path) && (
            <p role="status">
              This file has unsaved editor changes. The annotation shows only its saved text. Save
              or discard this draft to open a saved line.
            </p>
          )}
          {!page.totalLines ? (
            <p>No saved lines in this file.</p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-left text-xs" aria-label="Git blame lines">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Commit</th>
                    <th>Author</th>
                    <th>Date (UTC)</th>
                    <th>Saved text</th>
                  </tr>
                </thead>
                <tbody>
                  {page.lines.map((line) => (
                    <tr key={line.line} aria-label={`Git blame line ${line.line}`}>
                      <td>
                        <button
                          type="button"
                          aria-label={`Open saved line ${line.line}`}
                          className="underline disabled:no-underline"
                          disabled={
                            unavailable ||
                            !git.supportsBlameLineNavigation ||
                            git.isDirty(page.path)
                          }
                          onClick={() => {
                            void git.openBlameLine(line.line);
                          }}
                        >
                          {line.line}
                        </button>
                      </td>
                      <td title={line.summary}>
                        <code title={line.commit ?? undefined}>
                          {line.commit?.slice(0, 12) ?? "Uncommitted"}
                        </code>
                        {line.boundary && (
                          <span title="Git reports a history boundary"> · boundary</span>
                        )}
                        {line.ignored && <span> · ignored revision</span>}
                        {line.unblamable && <span> · unattributed ignored change</span>}
                      </td>
                      <td>{line.author ?? "Uncommitted saved text"}</td>
                      <td>
                        {line.authorTime === null
                          ? "—"
                          : new Date(line.authorTime * 1000).toISOString().split("T")[0]}
                      </td>
                      <td>
                        <pre className="m-0 whitespace-pre">{line.text}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={unavailable || page.startLine === 1}
              onClick={() =>
                read(
                  page.path,
                  Math.max(1, page.startLine - GIT_BLAME_PAGE_LINES),
                  page.savedFingerprint,
                )
              }
            >
              Previous blame page
            </button>
            <button
              type="button"
              disabled={unavailable || page.startLine + page.lines.length > page.totalLines}
              onClick={() =>
                read(page.path, page.startLine + page.lines.length, page.savedFingerprint)
              }
            >
              Next blame page
            </button>
            <button
              type="button"
              disabled={git.isWriting}
              onClick={() => {
                void git.openFile(page.path);
              }}
            >
              Open blamed file
            </button>
          </div>
        </section>
      )}
    </details>
  );
}
