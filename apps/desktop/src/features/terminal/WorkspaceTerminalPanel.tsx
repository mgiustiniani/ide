import { useEffect, useState } from "react";
import { RawTerminal } from "@ide/ui";
import type {
  WorkspaceTerminalController,
  WorkspaceTerminalView,
} from "@ide/web-core/terminal/WorkspaceTerminalController";
export function WorkspaceTerminalPanel({
  controller,
  state,
  directoryRequest,
}: {
  controller: WorkspaceTerminalController;
  state: WorkspaceTerminalView;
  directoryRequest?: { cwd: string };
}) {
  const [cwd, setCwd] = useState(directoryRequest?.cwd ?? ".");
  useEffect(() => {
    setCwd(directoryRequest?.cwd ?? ".");
  }, [directoryRequest]);
  const [shell, setShell] = useState("");
  const active = state.sessions.find(
    ({ snapshot }) => snapshot.sessionId === state.activeSessionId,
  );
  return (
    <section
      aria-label="Workspace terminal"
      className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)] text-xs"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] p-2">
        <label>
          <input
            type="checkbox"
            checked={state.trusted}
            onChange={(event) => controller.trust(event.target.checked)}
          />{" "}
          Trust workspace shell execution
        </label>
        <label>
          Directory{" "}
          <input
            aria-label="Terminal directory"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            className="w-28 bg-[var(--bg-secondary)]"
          />
        </label>
        <label>
          Shell{" "}
          <input
            aria-label="Terminal shell"
            value={shell}
            placeholder={state.capabilities?.defaultShell ?? "Absolute path"}
            onChange={(event) => setShell(event.target.value)}
            className="w-36 bg-[var(--bg-secondary)]"
          />
        </label>
        <button
          disabled={
            !state.trusted ||
            !state.capabilities?.available ||
            state.pending ||
            state.sessions.length >= 8
          }
          onClick={() => {
            void controller.start(cwd, shell || undefined);
          }}
        >
          New terminal
        </button>
        {active ? (
          <>
            <button
              disabled={active.busy || ["exited", "stopped"].includes(active.snapshot.state)}
              onClick={() => {
                void controller.stop();
              }}
            >
              Stop terminal
            </button>
            <button
              disabled={active.busy}
              onClick={() => {
                void controller.stop(true);
              }}
            >
              Close terminal
            </button>
            <button onClick={() => controller.clear()}>Clear terminal display</button>
          </>
        ) : null}
      </div>
      <div role="tablist" aria-label="Terminal sessions" className="flex gap-3 px-2">
        {state.sessions.map(({ snapshot }) => (
          <button
            key={snapshot.sessionId}
            role="tab"
            aria-selected={snapshot.sessionId === state.activeSessionId}
            onClick={() => controller.select(snapshot.sessionId)}
          >
            {snapshot.shell.split("/").pop()} · {snapshot.pid} · {snapshot.state}
            {snapshot.exitCode !== null ? ` (${snapshot.exitCode})` : ""}
          </button>
        ))}
      </div>
      {state.error ? (
        <p role="alert" className="px-2 text-[var(--error)]">
          {state.error}
        </p>
      ) : null}
      {!active ? (
        <p role="status" className="p-3">
          {state.pending
            ? "Checking terminal provider…"
            : (state.capabilities?.reason ??
              "Start a shell to use the saved files in this workspace. Unsaved editor changes are not written by the terminal.")}
        </p>
      ) : (
        <div className="min-h-0 flex-1">
          <RawTerminal
            key={active.snapshot.sessionId}
            feed={active.feed}
            isRunning={active.snapshot.state === "running" && !active.busy}
            onData={(data) => controller.input(data)}
            onResize={(cols, rows) => {
              void controller.resize(cols, rows);
            }}
          />
        </div>
      )}
    </section>
  );
}
