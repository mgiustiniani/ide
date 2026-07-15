// ---------------------------------------------------------------------------
// @ide/ui – AiAgentResponsePanel
// Presentation-only side panel for LLM responses, message history, and agent
// activity. Host apps own all Pi/adapter integrations and pass plain data in.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

export type AiAgentResponseMessageRole = "user" | "assistant" | "system" | "tool";
export type AiAgentActivityStatus = "pending" | "running" | "success" | "error" | "info";

export interface AiAgentResponseMessage {
  /** Stable message identifier supplied by the host app when available. */
  id?: string;
  /** Message author role. */
  role: AiAgentResponseMessageRole;
  /** Plain-text message content. */
  content: string;
  /** Optional timestamp or display label. */
  createdAt?: string;
}

export interface AiAgentActivityChangedFile {
  /** Repository-relative or display path for the changed file. */
  path: string;
  /** Optional display status for the changed file. */
  status?: string;
}

export interface AiAgentActivityEvent {
  /** Stable event identifier supplied by the host app when available. */
  id?: string;
  /** Generic activity event type. */
  type: string;
  /** Short event title. Falls back to a humanized type label. */
  title?: string;
  /** Optional source/tool name retained for backwards compatibility. */
  pluginName?: string;
  /** Optional plain-text detail shown under the title. */
  detail?: string;
  /** Optional event timestamp or display label. */
  timestamp?: string;
  /** Visual status for the event. Inferred from type when omitted. */
  status?: AiAgentActivityStatus;
  /** Optional generic agent identifier associated with this activity. */
  agentId?: string;
  /** Optional generic run/session identifier associated with this activity. */
  runId?: string;
  /** Optional list of files changed by this activity. */
  changedFiles?: AiAgentActivityChangedFile[];
}

export interface AiAgentResponsePanelProps {
  /** Most recent assistant/LLM response to emphasize at the top. */
  latestResponse?: string | null;
  /** Optional conversation history. Omit or pass an empty array to hide it. */
  messages?: AiAgentResponseMessage[];
  /** Optional generic activity stream. */
  activities?: AiAgentActivityEvent[];
  /** Whether a prompt/request is currently in flight. */
  isSending?: boolean;
  /** Optional user-facing error message. */
  error?: string | null;
  /** Closes the side panel. */
  onClose: () => void | Promise<void>;
  /** Optional heading override. */
  title?: string;
  /** Optional subtitle override. */
  subtitle?: string;
}

type AiAgentResponseTabId = "response" | "activity" | "agents" | "changes";

interface AgentSummary {
  agentId: string;
  count: number;
  lastStatus: AiAgentActivityStatus;
  lastType: string;
  lastTimestamp?: string;
  runIds: string[];
}

interface ChangedFileSummary {
  path: string;
  status?: string;
  count: number;
}

const tabs: Array<{ id: AiAgentResponseTabId; label: string }> = [
  { id: "response", label: "Response" },
  { id: "activity", label: "Activity" },
  { id: "agents", label: "Agents" },
  { id: "changes", label: "Changes" },
];

const messageRoleLabels: Record<AiAgentResponseMessageRole, string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
  tool: "Tool",
};

const messageRoleStyles: Record<AiAgentResponseMessageRole, string> = {
  user: "border-blue-500/30 bg-blue-500/10 text-blue-100",
  assistant: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  system: "border-amber-500/30 bg-amber-500/10 text-amber-100",
  tool: "border-purple-500/30 bg-purple-500/10 text-purple-100",
};

const activityStatusStyles: Record<AiAgentActivityStatus, string> = {
  pending: "border-[var(--border-default)] bg-[var(--surface-panel)] text-[var(--text-secondary)]",
  running: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
  error: "border-red-500/30 bg-red-500/10 text-red-200",
  info: "border-[var(--border-default)] bg-[var(--highlight-bg)] text-[var(--text-secondary)]",
};

function inferActivityStatus(type: string): AiAgentActivityStatus {
  const normalizedType = type.toLowerCase();
  if (normalizedType.includes("error") || normalizedType.includes("failed")) return "error";
  if (normalizedType.endsWith("_start") || normalizedType.includes("running")) return "running";
  if (normalizedType.endsWith("_end") || normalizedType.includes("complete")) return "success";
  if (normalizedType.includes("update")) return "info";
  return "pending";
}

function humanizeEventType(type: string): string {
  return type
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getMessageKey(message: AiAgentResponseMessage, index: number): string {
  return message.id ?? `${message.role}-${index}-${message.content.slice(0, 24)}`;
}

function getActivityKey(activity: AiAgentActivityEvent, index: number): string {
  return activity.id ?? `${activity.type}-${index}-${activity.detail?.slice(0, 24) ?? ""}`;
}

function getTabId(tabId: AiAgentResponseTabId): string {
  return `ai-agent-${tabId}-tab`;
}

function getTabPanelId(tabId: AiAgentResponseTabId): string {
  return `ai-agent-${tabId}-tabpanel`;
}

function getCountLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function buildAgentSummaries(activities: AiAgentActivityEvent[]): AgentSummary[] {
  const summaries = new Map<string, AgentSummary & { runIdSet: Set<string> }>();

  activities.forEach((activity) => {
    const agentId = activity.agentId?.trim();
    if (!agentId) return;

    const existing = summaries.get(agentId);
    const status = activity.status ?? inferActivityStatus(activity.type);

    if (existing) {
      existing.count += 1;
      existing.lastStatus = status;
      existing.lastType = activity.type;
      existing.lastTimestamp = activity.timestamp;
      if (activity.runId) existing.runIdSet.add(activity.runId);
      existing.runIds = Array.from(existing.runIdSet);
      return;
    }

    const runIdSet = new Set<string>();
    if (activity.runId) runIdSet.add(activity.runId);

    summaries.set(agentId, {
      agentId,
      count: 1,
      lastStatus: status,
      lastType: activity.type,
      lastTimestamp: activity.timestamp,
      runIds: Array.from(runIdSet),
      runIdSet,
    });
  });

  return Array.from(summaries.values()).map(({ runIdSet: _runIdSet, ...summary }) => summary);
}

function buildChangedFileSummaries(activities: AiAgentActivityEvent[]): ChangedFileSummary[] {
  const summaries = new Map<string, ChangedFileSummary>();

  activities.forEach((activity) => {
    activity.changedFiles?.forEach((changedFile) => {
      const path = changedFile.path.trim();
      if (!path) return;

      const existing = summaries.get(path);
      if (existing) {
        existing.count += 1;
        existing.status = changedFile.status ?? existing.status;
        return;
      }

      summaries.set(path, {
        path,
        status: changedFile.status,
        count: 1,
      });
    });
  });

  return Array.from(summaries.values());
}

function renderStatusDot(status: AiAgentActivityStatus): JSX.Element {
  const dotStyles: Record<AiAgentActivityStatus, string> = {
    pending: "bg-current opacity-70",
    running: "bg-blue-300",
    success: "bg-emerald-300",
    error: "bg-red-300",
    info: "bg-current opacity-70",
  };

  return <span className={`h-1.5 w-1.5 rounded-full ${dotStyles[status]}`} aria-hidden="true" />;
}

export function AiAgentResponsePanel({
  latestResponse,
  messages = [],
  activities = [],
  isSending = false,
  error,
  onClose,
  title = "AI Agent response",
  subtitle = "LLM output and activity",
}: AiAgentResponsePanelProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<AiAgentResponseTabId>("response");
  const agentSummaries = useMemo(() => buildAgentSummaries(activities), [activities]);
  const changedFileSummaries = useMemo(() => buildChangedFileSummaries(activities), [activities]);

  const hasLatestResponse = Boolean(latestResponse?.trim());
  const hasMessages = messages.length > 0;
  const hasActivities = activities.length > 0;
  const hasAgents = agentSummaries.length > 0;
  const hasChangedFiles = changedFileSummaries.length > 0;

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col border-l border-[var(--border-default)] bg-[var(--surface-sidebar)] text-[var(--text-primary)] shadow-xl"
      aria-label="AI Agent response"
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] bg-[var(--surface-header)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          <p className="truncate text-xs text-[var(--text-secondary)]">{subtitle}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          aria-label="Close AI Agent response panel"
          title="Close"
          onClick={() => void onClose()}
        >
          <Icon type="close" size={12} />
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2 text-xs">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
            isSending
              ? "border-blue-500/30 bg-blue-500/10 text-blue-200"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {isSending ? (
            <Icon type="spinner" size={12} />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          )}
          {isSending ? "Sending…" : "Ready"}
        </span>
        {error ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-200">
            Error
          </span>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </div>
      ) : null}

      <div className="border-b border-[var(--border-default)] bg-[var(--surface-sidebar)] px-3 py-2">
        <div
          className="grid grid-cols-4 gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-panel)] p-1"
          role="tablist"
          aria-label="AI Agent response sections"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                id={getTabId(tab.id)}
                type="button"
                role="tab"
                variant="ghost"
                size="sm"
                aria-selected={isActive}
                aria-controls={getTabPanelId(tab.id)}
                className={`min-w-0 rounded px-1.5 py-1 ${
                  isActive
                    ? "border-[var(--border-default)] bg-[var(--highlight-bg)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)]"
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="truncate">{tab.label}</span>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === "response" ? (
          <div
            id={getTabPanelId("response")}
            role="tabpanel"
            aria-labelledby={getTabId("response")}
            className="space-y-4"
          >
            <section aria-labelledby="ai-agent-latest-response-heading">
              <h3
                id="ai-agent-latest-response-heading"
                className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
              >
                Latest response
              </h3>
              <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-editor)] p-3 shadow-sm">
                {hasLatestResponse ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-primary)]">
                    {latestResponse}
                  </p>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">
                    {isSending ? "Waiting for the LLM response…" : "No LLM response yet."}
                  </p>
                )}
              </div>
            </section>

            {hasMessages ? (
              <section aria-labelledby="ai-agent-history-heading">
                <h3
                  id="ai-agent-history-heading"
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                >
                  Message history
                </h3>
                <ol className="space-y-2" aria-label="AI Agent response message history">
                  {messages.map((message, index) => (
                    <li
                      key={getMessageKey(message, index)}
                      className={`rounded-md border px-3 py-2 ${messageRoleStyles[message.role]}`}
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-wide">
                        <span>{messageRoleLabels[message.role]}</span>
                        {message.createdAt ? (
                          <span className="font-normal normal-case opacity-70">
                            {message.createdAt}
                          </span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-5">
                        {message.content}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
        ) : null}

        {activeTab === "activity" ? (
          <section
            id={getTabPanelId("activity")}
            role="tabpanel"
            aria-labelledby={getTabId("activity")}
          >
            <h3
              id="ai-agent-activity-heading"
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            >
              Activity
            </h3>
            {hasActivities ? (
              <ol className="space-y-2" aria-label="AI Agent activity">
                {activities.map((activity, index) => {
                  const status = activity.status ?? inferActivityStatus(activity.type);
                  const titleText = activity.title ?? humanizeEventType(activity.type);

                  return (
                    <li
                      key={getActivityKey(activity, index)}
                      className={`rounded-md border px-3 py-2 ${activityStatusStyles[status]}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{titleText}</p>
                          <p className="truncate text-xs opacity-75">
                            {activity.pluginName ? `${activity.pluginName} · ` : ""}
                            {activity.type}
                          </p>
                        </div>
                        {activity.timestamp ? (
                          <span className="shrink-0 text-[0.68rem] opacity-70">
                            {activity.timestamp}
                          </span>
                        ) : null}
                      </div>
                      {activity.agentId || activity.runId ? (
                        <div className="mt-1 flex flex-wrap gap-1 text-[0.68rem] opacity-75">
                          {activity.agentId ? <span>Agent: {activity.agentId}</span> : null}
                          {activity.runId ? <span>Run: {activity.runId}</span> : null}
                        </div>
                      ) : null}
                      {activity.detail ? (
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 opacity-90">
                          {activity.detail}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-panel)] p-3 text-sm text-[var(--text-secondary)]">
                No activity yet.
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "agents" ? (
          <section
            id={getTabPanelId("agents")}
            role="tabpanel"
            aria-labelledby={getTabId("agents")}
          >
            <h3
              id="ai-agent-agents-heading"
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            >
              Agents
            </h3>
            {hasAgents ? (
              <ol className="space-y-2" aria-label="AI Agent activity by agent">
                {agentSummaries.map((agent) => (
                  <li
                    key={agent.agentId}
                    className={`rounded-md border px-3 py-2 ${activityStatusStyles[agent.lastStatus]}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{agent.agentId}</p>
                        <p className="truncate text-xs opacity-75">
                          {getCountLabel(agent.count, "event")}
                        </p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-current/20 px-2 py-0.5 text-[0.68rem] capitalize opacity-85">
                        {renderStatusDot(agent.lastStatus)}
                        {agent.lastStatus}
                      </span>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs opacity-85">
                      <div className="flex min-w-0 justify-between gap-2">
                        <dt className="shrink-0 text-[var(--text-secondary)]">Last type</dt>
                        <dd className="truncate">{agent.lastType}</dd>
                      </div>
                      {agent.lastTimestamp ? (
                        <div className="flex min-w-0 justify-between gap-2">
                          <dt className="shrink-0 text-[var(--text-secondary)]">Last seen</dt>
                          <dd className="truncate">{agent.lastTimestamp}</dd>
                        </div>
                      ) : null}
                      {agent.runIds.length > 0 ? (
                        <div className="flex min-w-0 justify-between gap-2">
                          <dt className="shrink-0 text-[var(--text-secondary)]">Runs</dt>
                          <dd className="truncate">{agent.runIds.join(", ")}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-panel)] p-3 text-sm text-[var(--text-secondary)]">
                No agent activity reported yet.
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "changes" ? (
          <section
            id={getTabPanelId("changes")}
            role="tabpanel"
            aria-labelledby={getTabId("changes")}
          >
            <h3
              id="ai-agent-changes-heading"
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
            >
              Changes
            </h3>
            {hasChangedFiles ? (
              <ol className="space-y-2" aria-label="AI Agent changed files">
                {changedFileSummaries.map((changedFile) => (
                  <li
                    key={changedFile.path}
                    className="rounded-md border border-[var(--border-default)] bg-[var(--surface-editor)] px-3 py-2 text-[var(--text-primary)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 break-all font-mono text-xs leading-5">
                        {changedFile.path}
                      </p>
                      <span className="shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 py-0.5 text-[0.68rem] uppercase tracking-wide text-[var(--text-secondary)]">
                        {changedFile.status ?? "changed"}
                      </span>
                    </div>
                    {changedFile.count > 1 ? (
                      <p className="mt-1 text-[0.68rem] text-[var(--text-secondary)]">
                        Reported {getCountLabel(changedFile.count, "time")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="rounded-md border border-dashed border-[var(--border-default)] bg-[var(--surface-panel)] p-3 text-sm text-[var(--text-secondary)]">
                No changed files reported yet.
              </div>
            )}
          </section>
        ) : null}
      </div>
    </aside>
  );
}
