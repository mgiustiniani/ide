import { useMemo, useState } from "react";
import type {
  PiWorkspaceAgentAccessories,
  PiWorkspaceAgentAttachment,
  PiWorkspaceAgentProcessState,
} from "@ide/contracts";
import type { DiffReviewOutcome, HunkLevelDiff } from "@ide/web-core/ports";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { PiNativeTerminal, type PiTerminalFeedSource } from "./PiNativeTerminal";

export type PiWorkspaceAgentTab = "pi" | "changes" | "activity" | "resources" | "sessions";

export interface PiWorkspaceAgentScreenProps {
  workspaceId: string;
  workspaceName: string;
  attachment: PiWorkspaceAgentAttachment | null;
  accessories: PiWorkspaceAgentAccessories | null;
  terminalFeed: PiTerminalFeedSource;
  isAttaching: boolean;
  isAccessoryLoading: boolean;
  error?: string | null;
  accessoryError?: string | null;
  detached?: boolean;
  onData(data: string): void;
  onResize(cols: number, rows: number): void;
  onRefresh(): void | Promise<void>;
  onRefreshAccessories(): void | Promise<void>;
  onStart(): void | Promise<void>;
  onStop(): void | Promise<void>;
  onDetach?(): void | Promise<void>;
  onOpenChangedFile?(path: string): void | Promise<void>;
  reviews?: ReadonlyMap<string, DiffReviewOutcome>;
  onOpenRange?(path: string, startLine: number, endLine: number): void | Promise<void>;
}

const TABS: ReadonlyArray<{ id: PiWorkspaceAgentTab; label: string }> = [
  { id: "pi", label: "Pi" },
  { id: "changes", label: "Changes" },
  { id: "activity", label: "Activity" },
  { id: "resources", label: "Resources" },
  { id: "sessions", label: "Sessions" },
];

const STATE_LABELS: Record<PiWorkspaceAgentProcessState, string> = {
  starting: "Starting",
  running: "Running",
  exited: "Exited",
  stopped: "Stopped",
  failed: "Failed",
};

function countByKind(accessories: PiWorkspaceAgentAccessories | null, kind: string): number {
  return accessories?.resources.filter((resource) => resource.kind === kind).length ?? 0;
}

export function PiWorkspaceAgentScreen({
  workspaceId,
  workspaceName,
  attachment,
  accessories,
  terminalFeed,
  isAttaching,
  isAccessoryLoading,
  error,
  accessoryError,
  detached = false,
  onData,
  onResize,
  onRefresh,
  onRefreshAccessories,
  onStart,
  onStop,
  onDetach,
  onOpenChangedFile,
  reviews,
  onOpenRange,
}: PiWorkspaceAgentScreenProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<PiWorkspaceAgentTab>("pi");
  const [confirmStop, setConfirmStop] = useState(false);
  const session = attachment?.session ?? null;
  const isRunning = session?.processState === "running";
  const canStart = session ? ["stopped", "exited", "failed"].includes(session.processState) : false;
  const sessions = useMemo(
    () =>
      [...(attachment?.sessions ?? [])].sort((left, right) => {
        if (left.workspaceId === workspaceId) return -1;
        if (right.workspaceId === workspaceId) return 1;
        return left.workspaceName.localeCompare(right.workspaceName);
      }),
    [attachment?.sessions, workspaceId],
  );

  return (
    <section
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--surface-sidebar)] text-[var(--text-primary)]"
      aria-label={`Pi Agent for ${workspaceName}`}
      data-workspace-id={workspaceId}
    >
      <header className="shrink-0 border-b border-[var(--border-default)] bg-[var(--surface-header)] px-2 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isRunning ? "bg-emerald-400" : isAttaching ? "bg-amber-300" : "bg-slate-500"
                }`}
                aria-hidden="true"
              />
              <h2 className="truncate text-xs font-semibold">Agent · {workspaceName}</h2>
            </div>
            <p
              className="truncate pl-3.5 text-[0.68rem] text-[var(--text-muted)]"
              title={workspaceId}
            >
              {session
                ? `${STATE_LABELS[session.processState]} · ${session.sessionId}`
                : isAttaching
                  ? "Attaching to workspace Pi…"
                  : "Pi is unavailable"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canStart ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => void onStart()}>
                Restart Pi
              </Button>
            ) : null}
            {isRunning ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-200"
                onClick={() => setConfirmStop(true)}
              >
                Stop Pi
              </Button>
            ) : null}
            {!detached && onDetach ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Detach Pi Agent for ${workspaceName}`}
                title="Open a larger workspace-pinned Agent window"
                onClick={() => void onDetach()}
              >
                Detach
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="shrink-0 overflow-x-auto border-b border-[var(--border-default)] bg-[var(--surface-panel)] px-1 py-1">
        <div className="flex min-w-max gap-0.5" role="tablist" aria-label="Agent screen sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              id={`pi-agent-${tab.id}-tab`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`pi-agent-${tab.id}-panel`}
              className={`rounded px-2 py-1 text-[0.68rem] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] ${
                activeTab === tab.id
                  ? "bg-[var(--highlight-bg)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--highlight-bg)]"
              }`}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id !== "pi") void onRefreshAccessories();
              }}
            >
              {tab.label}
              {tab.id === "changes" && accessories?.changes.length ? (
                <span className="ml-1 text-[var(--text-muted)]">{accessories.changes.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div
          className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-200"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Keep xterm mounted while accessory tabs are selected so live PTY output is not lost. */}
        <div
          id="pi-agent-pi-panel"
          role="tabpanel"
          aria-labelledby="pi-agent-pi-tab"
          className={`absolute inset-0 ${activeTab === "pi" ? "block" : "invisible"}`}
          aria-hidden={activeTab !== "pi"}
        >
          <PiNativeTerminal
            feed={terminalFeed}
            isRunning={isRunning}
            isLoading={isAttaching}
            onData={onData}
            onResize={onResize}
          />
          {!isAttaching && !session ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0f1117]/90 p-4 text-center text-xs text-[var(--text-secondary)]">
              Pi could not be attached to this workspace.
            </div>
          ) : null}
        </div>

        {activeTab !== "pi" ? (
          <div
            id={`pi-agent-${activeTab}-panel`}
            role="tabpanel"
            aria-labelledby={`pi-agent-${activeTab}-tab`}
            className="h-full min-h-0 overflow-y-auto p-2"
          >
            <AccessoryHeader
              loading={isAccessoryLoading}
              onRefresh={
                activeTab === "sessions" || activeTab === "activity"
                  ? onRefresh
                  : onRefreshAccessories
              }
            />
            {accessoryError ? (
              <p
                className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100"
                role="alert"
              >
                {accessoryError}
              </p>
            ) : null}
            {accessories?.warnings.map((warning) => (
              <p
                key={warning}
                className="mb-2 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-100"
              >
                {warning}
              </p>
            ))}

            {activeTab === "changes" ? (
              <ChangesView
                changes={accessories?.changes ?? []}
                reviews={reviews}
                onOpenChangedFile={onOpenChangedFile}
                onOpenRange={onOpenRange}
              />
            ) : null}
            {activeTab === "activity" ? (
              <ActivityView activities={attachment?.activities ?? []} />
            ) : null}
            {activeTab === "resources" ? <ResourcesView accessories={accessories} /> : null}
            {activeTab === "sessions" ? <SessionsView sessions={sessions} /> : null}
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-[var(--border-default)] bg-[var(--surface-panel)] px-2 py-1 text-[0.65rem] text-[var(--text-muted)]">
        Native Pi TUI · view attachment only · closing this view does not stop Pi
        {attachment?.transcriptTruncated ? " · bounded transcript tail retained" : ""}
      </footer>

      {confirmStop ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pi-stop-confirm-title"
        >
          <div className="w-full max-w-sm rounded-md border border-red-500/40 bg-[var(--surface-panel)] p-3 shadow-2xl">
            <h3 id="pi-stop-confirm-title" className="text-sm font-semibold text-red-100">
              Stop Pi for {workspaceName}?
            </h3>
            <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
              This terminates the live Pi process for this workspace. Closing or detaching the Agent
              view never does this.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmStop(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setConfirmStop(false);
                  void onStop();
                }}
              >
                Stop Pi
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AccessoryHeader({
  loading,
  onRefresh,
}: {
  loading: boolean;
  onRefresh(): void | Promise<void>;
}): JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="text-[0.68rem] text-[var(--text-muted)]">
        Read-only IDE metadata; Pi remains the conversation authority.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Refresh Agent accessory metadata"
        disabled={loading}
        onClick={() => void onRefresh()}
      >
        {loading ? <Icon type="spinner" size={12} /> : "Refresh"}
      </Button>
    </div>
  );
}

function Empty({ children }: { children: string }): JSX.Element {
  return (
    <p className="rounded border border-dashed border-[var(--border-default)] p-3 text-xs text-[var(--text-secondary)]">
      {children}
    </p>
  );
}

export interface ChangesViewProps {
  changes: PiWorkspaceAgentAccessories["changes"];
  reviews?: ReadonlyMap<string, DiffReviewOutcome>;
  onOpenChangedFile?(path: string): void | Promise<void>;
  onOpenRange?(path: string, startLine: number, endLine: number): void | Promise<void>;
}

function ChangesView({
  changes,
  reviews,
  onOpenChangedFile,
  onOpenRange,
}: ChangesViewProps): JSX.Element {
  if (changes.length === 0) return <Empty>No workspace changes detected.</Empty>;
  return (
    <ol className="space-y-1" aria-label="Workspace changes">
      {changes.map((change) => {
        const review = reviews?.get(change.path);
        return (
          <li key={change.path} className="space-y-1">
            <button
              type="button"
              className="flex w-full min-w-0 items-start justify-between gap-2 rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1.5 text-left disabled:cursor-default"
              disabled={!onOpenChangedFile}
              onClick={() => void onOpenChangedFile?.(change.path)}
            >
              <span className="min-w-0 break-all font-mono text-[0.68rem]">{change.path}</span>
              <span className="shrink-0 text-[0.62rem] uppercase text-[var(--text-muted)]">
                {change.status}
              </span>
            </button>
            {review?.kind === "ok" ? (
              <HunkPanel diff={review.diff} onOpenRange={onOpenRange} />
            ) : review?.kind === "unavailable" ? (
              <p
                className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[0.66rem] text-[var(--text-muted)]"
                role="note"
              >
                Diff review unavailable: {review.reason}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function HunkPanel({
  diff,
  onOpenRange,
}: {
  diff: HunkLevelDiff;
  onOpenRange?(path: string, startLine: number, endLine: number): void | Promise<void>;
}): JSX.Element {
  return (
    <div
      className="space-y-1 rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1.5"
      aria-label={`Read-only diff for ${diff.path}`}
    >
      {diff.hunks.map((hunk, index) => {
        const endLine = hunk.newStart + hunk.newLines - 1;
        return (
          <section
            key={`${diff.path}:${index}`}
            className="space-y-1"
            aria-label={`Hunk ${index + 1}`}
          >
            <header className="flex items-center justify-between gap-2">
              <span className="shrink-0 font-mono text-[0.62rem] text-[var(--text-muted)]">
                new {hunk.newStart} · {hunk.newLines} lines
              </span>
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[0.62rem] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default"
                disabled={!onOpenRange}
                aria-label={`Open range ${diff.path}:${hunk.newStart}-${endLine}`}
                onClick={() => void onOpenRange?.(diff.path, hunk.newStart, endLine)}
              >
                Open range
              </button>
            </header>
            <pre className="overflow-x-auto whitespace-pre font-mono text-[0.66rem] leading-4 text-[var(--text-secondary)]">
              {hunk.text}
            </pre>
          </section>
        );
      })}
    </div>
  );
}

function ActivityView({
  activities,
}: {
  activities: PiWorkspaceAgentAttachment["activities"];
}): JSX.Element {
  if (activities.length === 0) return <Empty>No IDE attachment activity yet.</Empty>;
  return (
    <ol className="space-y-1" aria-label="Pi process and attachment activity">
      {[...activities].reverse().map((activity) => (
        <li
          key={activity.sequence}
          className="rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1.5"
        >
          <div className="flex justify-between gap-2 text-[0.68rem]">
            <strong className="capitalize">{activity.eventType}</strong>
            <time className="shrink-0 text-[var(--text-muted)]">{activity.timestamp}</time>
          </div>
          <p className="mt-1 break-words text-[0.66rem] leading-4 text-[var(--text-secondary)]">
            {activity.detail}
          </p>
        </li>
      ))}
    </ol>
  );
}

function ResourcesView({
  accessories,
}: {
  accessories: PiWorkspaceAgentAccessories | null;
}): JSX.Element {
  const resources = accessories?.resources ?? [];
  if (resources.length === 0) return <Empty>No Pi resources discovered.</Empty>;
  return (
    <div>
      <p className="mb-2 text-[0.68rem] text-[var(--text-secondary)]">
        {countByKind(accessories, "package")} packages · {countByKind(accessories, "command")}{" "}
        commands
      </p>
      <ol className="space-y-1" aria-label="Installed Pi packages and commands">
        {resources.map((resource) => (
          <li
            key={`${resource.kind}:${resource.scope}:${resource.name}`}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1.5"
          >
            <div className="flex min-w-0 justify-between gap-2">
              <span className="min-w-0 break-all font-mono text-[0.68rem]">{resource.name}</span>
              <span className="shrink-0 text-[0.6rem] uppercase text-[var(--text-muted)]">
                {resource.kind} · {resource.scope}
              </span>
            </div>
            {resource.description ? (
              <p className="mt-1 text-[0.66rem] text-[var(--text-secondary)]">
                {resource.description}
              </p>
            ) : null}
            {resource.path ? (
              <p className="mt-1 break-all font-mono text-[0.6rem] text-[var(--text-muted)]">
                {resource.path}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SessionsView({
  sessions,
}: {
  sessions: PiWorkspaceAgentAttachment["sessions"];
}): JSX.Element {
  if (sessions.length === 0) return <Empty>No workspace Pi sessions attached yet.</Empty>;
  return (
    <ol className="space-y-1" aria-label="Workspace Pi sessions">
      {sessions.map((session) => (
        <li
          key={session.workspaceId}
          className="rounded border border-[var(--border-default)] bg-[var(--surface-editor)] px-2 py-1.5"
        >
          <div className="flex min-w-0 justify-between gap-2 text-[0.68rem]">
            <strong className="truncate">{session.workspaceName}</strong>
            <span className="shrink-0 capitalize text-[var(--text-secondary)]">
              {session.processState}
            </span>
          </div>
          <dl className="mt-1 space-y-0.5 text-[0.62rem] text-[var(--text-muted)]">
            <div className="flex min-w-0 gap-1">
              <dt>Session</dt>
              <dd className="truncate font-mono">{session.sessionId}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Views</dt>
              <dd>{session.attachedViewCount}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}
