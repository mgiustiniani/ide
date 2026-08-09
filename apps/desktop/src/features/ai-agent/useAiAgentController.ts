import type {
  AiAgentCommand,
  PiAgentInstallResult,
  PiAgentRun,
  PiAgentSessionMessage,
  PiAgentSessionMessages,
  PiAgentSettings,
  PiAgentSettingsUpdate,
  PiAgentStatus,
  PiAgentTraceEvent,
  WorkspaceInfo,
} from "@ide/contracts";
import type {
  AiAgentActivityEvent,
  AiAgentActivityStatus,
  AiAgentMessage as AiAgentPanelMessage,
  AiAgentResponseMessage,
} from "@ide/ui";
import type { AiAgentPort } from "@ide/web-core/ports";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AiAgentChangedFile = NonNullable<AiAgentActivityEvent["changedFiles"]>[number];
type AiAgentMessage = AiAgentResponseMessage;

type AiAgentWorkspaceUiState = {
  aiAgentMessages: AiAgentMessage[];
  aiAgentLatestResponse: string | null;
  aiAgentActivities: AiAgentActivityEvent[];
  isAiAgentResponsePanelOpen: boolean;
  aiAgentSendError: string | null;
  isAiAgentSending: boolean;
};

function createEmptyAiAgentWorkspaceUiState(): AiAgentWorkspaceUiState {
  return {
    aiAgentMessages: [],
    aiAgentLatestResponse: null,
    aiAgentActivities: [],
    isAiAgentResponsePanelOpen: false,
    aiAgentSendError: null,
    isAiAgentSending: false,
  };
}

function cloneAiAgentWorkspaceUiState(state: AiAgentWorkspaceUiState): AiAgentWorkspaceUiState {
  return {
    aiAgentMessages: [...state.aiAgentMessages],
    aiAgentLatestResponse: state.aiAgentLatestResponse,
    aiAgentActivities: [...state.aiAgentActivities],
    isAiAgentResponsePanelOpen: state.isAiAgentResponsePanelOpen,
    aiAgentSendError: state.aiAgentSendError,
    isAiAgentSending: state.isAiAgentSending,
  };
}

function getAiAgentWorkspaceStateKey(workspace: WorkspaceInfo | null | undefined): string {
  const workspaceId = workspace?.id?.trim();
  if (workspaceId) return workspaceId;

  const rootPath = workspace?.rootPath?.trim();
  if (rootPath) return rootPath;

  return "default";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringField(
  record: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

const SESSION_MESSAGE_MAX_LENGTH = 4000;
const SESSION_MESSAGE_JSON_MAX_LENGTH = 800;
const SESSION_MESSAGE_TEXT_PARTS_MAX = 8;

function truncateSessionMessageText(
  value: string,
  maxLength = SESSION_MESSAGE_MAX_LENGTH,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stringifyCompactSessionValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    return truncateSessionMessageText(value, SESSION_MESSAGE_MAX_LENGTH);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return truncateSessionMessageText(JSON.stringify(value), SESSION_MESSAGE_JSON_MAX_LENGTH);
  } catch {
    return undefined;
  }
}

function readPiSessionMessageTextPart(value: unknown): string | undefined {
  if (typeof value === "string") {
    return truncateSessionMessageText(value);
  }

  if (!isRecord(value)) return undefined;

  const directText = readStringField(value, [
    "text",
    "content",
    "input_text",
    "output_text",
    "message",
  ]);
  if (directText) return truncateSessionMessageText(directText);

  const nestedText = value.text;
  if (isRecord(nestedText)) {
    return readPiSessionMessageTextPart(nestedText);
  }

  return undefined;
}

function readPiSessionMessageContent(message: PiAgentSessionMessage): string | undefined {
  const content = message.content;

  if (typeof content === "string") {
    return truncateSessionMessageText(content);
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      const part = readPiSessionMessageTextPart(item);
      if (part) parts.push(part);
      if (parts.length >= SESSION_MESSAGE_TEXT_PARTS_MAX) break;
    }

    if (parts.length > 0) {
      return truncateSessionMessageText(parts.join("\n"));
    }

    return stringifyCompactSessionValue(content);
  }

  const directText = readStringField(message, ["text", "message", "output", "stdout", "stderr"]);
  if (directText) return truncateSessionMessageText(directText);

  return stringifyCompactSessionValue(content ?? message);
}

function mapPiSessionMessageRole(message: PiAgentSessionMessage): AiAgentMessage["role"] {
  const role = typeof message.role === "string" ? message.role.toLowerCase().trim() : "";

  if (role === "user" || role === "human") return "user";
  if (role === "assistant" || role === "ai" || role === "model") return "assistant";
  if (role === "tool" || role === "function") return "tool";
  if (role === "system" || role === "developer") return "system";

  if (typeof message.toolCallId === "string" || typeof message.tool_call_id === "string") {
    return "tool";
  }

  return "system";
}

function readPiSessionMessageTimestamp(message: PiAgentSessionMessage): string | undefined {
  const timestamp = readStringField(message, ["createdAt", "created_at", "timestamp", "time"]);
  if (timestamp) return timestamp;

  const createdAt = message.createdAt ?? message.created_at ?? message.timestamp ?? message.time;
  if (typeof createdAt === "number" && Number.isFinite(createdAt)) {
    const millis = createdAt > 10_000_000_000 ? createdAt : createdAt * 1000;
    return new Date(millis).toLocaleTimeString();
  }

  return undefined;
}

function convertPiSessionMessagesToAiAgentMessages(
  sessionMessages: readonly PiAgentSessionMessage[],
): AiAgentMessage[] {
  return sessionMessages.flatMap((message, index): AiAgentMessage[] => {
    if (!isRecord(message)) return [];

    const content = readPiSessionMessageContent(message);
    if (!content) return [];

    return [
      {
        id:
          readStringField(message, ["id", "messageId", "message_id", "uuid"]) ??
          `pi-session-${index}`,
        role: mapPiSessionMessageRole(message),
        content,
        createdAt: readPiSessionMessageTimestamp(message),
      },
    ];
  });
}

function getLatestAiAgentAssistantResponse(messages: readonly AiAgentMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") return message.content;
  }

  return null;
}

function createAiAgentWorkspaceUiStateFromSession(
  session: PiAgentSessionMessages,
): AiAgentWorkspaceUiState {
  const messages = convertPiSessionMessagesToAiAgentMessages(session.messages);
  return {
    ...createEmptyAiAgentWorkspaceUiState(),
    aiAgentMessages: messages,
    aiAgentLatestResponse: getLatestAiAgentAssistantResponse(messages),
    isAiAgentResponsePanelOpen: messages.length > 0,
  };
}

function toAiAgentPanelMessages(messages: readonly AiAgentMessage[]): AiAgentPanelMessage[] {
  return messages.map((message) => ({
    ...message,
    role: message.role === "tool" ? "system" : message.role,
  }));
}

const ACTIVITY_DETAIL_MAX_LENGTH = 360;
const ACTIVITY_DETAIL_PART_MAX_LENGTH = 180;
const ACTIVITY_CHANGED_FILES_MAX = 5;

function truncateActivityDetail(
  value: string,
  maxLength = ACTIVITY_DETAIL_MAX_LENGTH,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stringifyActivityDetail(
  value: unknown,
  maxLength = ACTIVITY_DETAIL_MAX_LENGTH,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return truncateActivityDetail(value, maxLength);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return truncateActivityDetail(JSON.stringify(value), maxLength);
  } catch {
    return undefined;
  }
}

function readSequenceValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function readMultiAgentEnvelope(
  event: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return isRecord(event.multiAgent) ? event.multiAgent : undefined;
}

function readActivityAgentId(event: Record<string, unknown>): string | undefined {
  const multiAgent = readMultiAgentEnvelope(event);
  return (
    (multiAgent ? readStringField(multiAgent, ["agentId"]) : undefined) ??
    readStringField(event, ["agentId"])
  );
}

function readActivityRunId(event: Record<string, unknown>): string | undefined {
  const multiAgent = readMultiAgentEnvelope(event);
  return (
    (multiAgent ? readStringField(multiAgent, ["runId"]) : undefined) ??
    readStringField(event, ["runId"])
  );
}

function readToolName(event: Record<string, unknown>): string | undefined {
  const directName = readStringField(event, ["toolName"]);
  if (directName) return directName;

  const tool = event.tool;
  if (isRecord(tool)) {
    return readStringField(tool, ["name", "toolName"]);
  }

  return undefined;
}

function readMessageRole(event: Record<string, unknown>): string | undefined {
  const message = event.message;
  if (isRecord(message)) {
    return readStringField(message, ["role"]);
  }

  return readStringField(event, ["role"]);
}

function readMessageDetail(event: Record<string, unknown>): string | undefined {
  const message = event.message;

  if (typeof message === "string") {
    return stringifyActivityDetail(message, ACTIVITY_DETAIL_PART_MAX_LENGTH);
  }

  if (isRecord(message)) {
    const role = readStringField(message, ["role"]);
    const content = readStringField(message, ["content", "text", "delta"]);
    if (content) {
      const detail = role ? `${role}: ${content}` : content;
      return stringifyActivityDetail(detail, ACTIVITY_DETAIL_PART_MAX_LENGTH);
    }
    if (role) return `role: ${role}`;
  }

  const role = readStringField(event, ["role"]);
  const content = readStringField(event, ["content", "text", "delta"]);
  if (content) {
    const detail = role ? `${role}: ${content}` : content;
    return stringifyActivityDetail(detail, ACTIVITY_DETAIL_PART_MAX_LENGTH);
  }

  return undefined;
}

function normalizeChangedFiles(
  value: unknown,
  maxEntries?: number,
): AiAgentChangedFile[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const entries: AiAgentChangedFile[] = [];
  const items = maxEntries === undefined ? value : value.slice(0, maxEntries);
  for (const item of items) {
    if (typeof item === "string" && item.trim()) {
      entries.push({ path: item.trim() });
      continue;
    }

    if (!isRecord(item)) continue;
    const path = readStringField(item, ["path", "filePath", "name"]);
    if (!path) continue;

    const status = readStringField(item, ["status", "changeType", "type"]);
    entries.push(status ? { path, status } : { path });
  }

  return entries.length > 0 ? entries : undefined;
}

function formatChangedFiles(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;

  const changedFiles = normalizeChangedFiles(value, ACTIVITY_CHANGED_FILES_MAX);
  if (!changedFiles) return undefined;

  const entries = changedFiles.map((changedFile) =>
    changedFile.status ? `${changedFile.path} (${changedFile.status})` : changedFile.path,
  );
  const suffix =
    value.length > ACTIVITY_CHANGED_FILES_MAX
      ? ` +${value.length - ACTIVITY_CHANGED_FILES_MAX} more`
      : "";
  return `changed files: ${entries.join(", ")}${suffix}`;
}

function appendChangedFilesFromValue(
  value: unknown,
  target: AiAgentChangedFile[],
  seen: Set<string>,
): void {
  const changedFiles = normalizeChangedFiles(value);
  if (!changedFiles) return;

  for (const changedFile of changedFiles) {
    const key = `${changedFile.path}\0${changedFile.status ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(changedFile);
  }
}

function readActivityChangedFiles(
  event: Record<string, unknown>,
): AiAgentActivityEvent["changedFiles"] {
  const changedFiles: AiAgentChangedFile[] = [];
  const seen = new Set<string>();

  appendChangedFilesFromValue(event.changedFiles, changedFiles, seen);

  const details = event.details;
  if (isRecord(details)) {
    appendChangedFilesFromValue(details.changedFiles, changedFiles, seen);
  }

  const result = event.result;
  if (isRecord(result)) {
    const resultDetails = result.details;
    if (isRecord(resultDetails)) {
      appendChangedFilesFromValue(resultDetails.changedFiles, changedFiles, seen);
    }
    appendChangedFilesFromValue(result.changedFiles, changedFiles, seen);
  }

  return changedFiles.length > 0 ? changedFiles : undefined;
}

function readChangedFilesDetail(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const direct = formatChangedFiles(value.changedFiles);
  if (direct) return direct;

  const details = value.details;
  if (isRecord(details)) {
    return formatChangedFiles(details.changedFiles);
  }

  return undefined;
}

function readContentText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return stringifyActivityDetail(value, ACTIVITY_DETAIL_PART_MAX_LENGTH);
  }

  if (!isRecord(value)) return undefined;

  const directText = readStringField(value, ["text", "message", "output", "stdout", "stderr"]);
  if (directText) {
    return stringifyActivityDetail(directText, ACTIVITY_DETAIL_PART_MAX_LENGTH);
  }

  const content = value.content;
  if (typeof content === "string") {
    return stringifyActivityDetail(content, ACTIVITY_DETAIL_PART_MAX_LENGTH);
  }

  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === "string" && item.trim()) {
      parts.push(item.trim());
    } else if (isRecord(item)) {
      const text = readStringField(item, ["text", "content"]);
      if (text) parts.push(text);
    }

    if (parts.length >= 3) break;
  }

  return parts.length > 0
    ? stringifyActivityDetail(parts.join("\n"), ACTIVITY_DETAIL_PART_MAX_LENGTH)
    : undefined;
}

function summarizePayload(label: string, value: unknown): string | undefined {
  const changedFiles = readChangedFilesDetail(value);
  if (changedFiles) return changedFiles;

  const content =
    readContentText(value) ?? stringifyActivityDetail(value, ACTIVITY_DETAIL_PART_MAX_LENGTH);
  return content ? `${label}: ${content}` : undefined;
}

function summarizeActivityPayload(event: Record<string, unknown>): string | undefined {
  if (event.args !== undefined) {
    return summarizePayload("args", event.args);
  }

  if (event.partialResult !== undefined) {
    return summarizePayload("partial", event.partialResult);
  }

  if (event.result !== undefined) {
    return summarizePayload("result", event.result);
  }

  return readChangedFilesDetail(event);
}

function composeActivityDetail(event: Record<string, unknown>): string | undefined {
  const primary =
    stringifyActivityDetail(event.preview) ??
    stringifyActivityDetail(event.detail) ??
    readMessageDetail(event) ??
    stringifyActivityDetail(event.error) ??
    stringifyActivityDetail(event.text) ??
    summarizeActivityPayload(event);

  const agentId = readActivityAgentId(event);
  if (!agentId) return primary;

  const agentDetail = `agent: ${agentId}`;
  if (!primary) return agentDetail;
  if (primary.includes(agentDetail)) return primary;
  return truncateActivityDetail(`${primary} · ${agentDetail}`);
}

function readActivityPluginName(event: Record<string, unknown>, type: string): string | undefined {
  const normalizedType = type.toLowerCase();
  const toolName = readToolName(event);
  if (normalizedType.startsWith("tool_execution_") && toolName) {
    return toolName;
  }

  const role = readMessageRole(event);
  if (normalizedType.includes("message") && role) {
    return role;
  }

  return readStringField(event, ["pluginName", "plugin", "toolName", "name", "extensionName"]);
}

function readActivityTimestamp(event: Record<string, unknown>): string | undefined {
  const timestamp = readStringField(event, ["timestamp", "createdAt", "time"]);
  if (timestamp) return timestamp;

  const multiAgent = readMultiAgentEnvelope(event);
  return multiAgent ? readStringField(multiAgent, ["timestamp"]) : undefined;
}

function readActivityId(event: Record<string, unknown>, type: string, index: number): string {
  const explicitId = readStringField(event, ["id", "eventId", "event_id"]);
  if (explicitId) return explicitId;

  const multiAgent = readMultiAgentEnvelope(event);
  const runId = readActivityRunId(event);
  const sequence = multiAgent
    ? readSequenceValue(multiAgent.sequence)
    : readSequenceValue(event.sequence);
  if (runId && sequence) return `ai-agent-trace-${runId}-${sequence}-${type}`;

  return `ai-agent-activity-${index}`;
}

function normalizeActivityStatus(
  status: unknown,
  eventType: string,
  isError?: unknown,
): AiAgentActivityStatus | undefined {
  if (isError === true) return "error";

  const rawStatus = typeof status === "string" ? status.toLowerCase() : "";
  const rawType = eventType.toLowerCase();

  if (rawStatus === "pending" || rawStatus === "queued" || rawStatus === "retrying")
    return "pending";
  if (rawStatus === "running" || rawStatus === "started" || rawStatus === "in_progress")
    return "running";
  if (
    rawStatus === "success" ||
    rawStatus === "succeeded" ||
    rawStatus === "completed" ||
    rawStatus === "settled"
  )
    return "success";
  if (rawStatus === "error" || rawStatus === "failed") return "error";
  if (rawStatus === "info") return "info";

  if (rawType.includes("error") || rawType.includes("failed")) return "error";
  if (rawType.endsWith("_start")) return "running";
  if (rawType.endsWith("_end") || rawType.endsWith("_settled")) return "success";
  if (rawType.includes("update")) return "info";
  return undefined;
}

function parseAiAgentActivityEvents(events: unknown): AiAgentActivityEvent[] {
  if (!Array.isArray(events)) return [];

  return events.flatMap((event, index): AiAgentActivityEvent[] => {
    if (!isRecord(event)) return [];

    const type = readStringField(event, ["type", "eventType", "event_type", "kind"]);
    if (!type) return [];

    return [
      {
        id: readActivityId(event, type, index),
        type,
        title: readStringField(event, ["title", "label"]),
        pluginName: readActivityPluginName(event, type),
        detail: composeActivityDetail(event),
        timestamp: readActivityTimestamp(event),
        status: normalizeActivityStatus(event.status, type, event.isError),
        agentId: readActivityAgentId(event),
        runId: readActivityRunId(event),
        changedFiles: readActivityChangedFiles(event),
      },
    ];
  });
}

function mergeAiAgentActivities(
  current: AiAgentActivityEvent[],
  incoming: AiAgentActivityEvent[],
): AiAgentActivityEvent[] {
  if (incoming.length === 0) return current;

  const seen = new Set(
    current.map(
      (activity) =>
        activity.id ??
        `${activity.type}|${activity.timestamp ?? ""}|${activity.pluginName ?? ""}|${activity.detail ?? ""}`,
    ),
  );
  const merged = [...current];

  for (const activity of incoming) {
    const key =
      activity.id ??
      `${activity.type}|${activity.timestamp ?? ""}|${activity.pluginName ?? ""}|${activity.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(activity);
  }

  return merged;
}

function withAgentRunContext(
  run: PiAgentRun,
  event: PiAgentTraceEvent,
  index: number,
): PiAgentTraceEvent {
  if (event.multiAgent) return event;

  const enriched: PiAgentTraceEvent = {
    ...event,
    runId: run.runId,
    sequence: index,
  };

  if (run.traceId && readStringField(enriched, ["traceId"]) === undefined) {
    enriched.traceId = run.traceId;
  }
  if (run.agentId && readStringField(enriched, ["agentId"]) === undefined) {
    enriched.agentId = run.agentId;
  }
  if (readStringField(enriched, ["timestamp", "createdAt", "time"]) === undefined) {
    const timestamp = run.startedAt ?? run.sealedAt;
    if (timestamp) enriched.timestamp = timestamp;
  }

  return enriched;
}

export interface AiAgentWorkspaceCollaborator {
  beginWorkspaceSwitch(): void;
  activateWorkspace(workspace: WorkspaceInfo): string;
  loadCommands(workspaceKey: string): Promise<void>;
}

export interface UseAiAgentControllerDependencies {
  aiAgent: AiAgentPort;
  workspaceInfo: WorkspaceInfo | null;
  isWorkspaceLoading: boolean;
  /** Desktop composition delegates workspace activation to useWorkspaceController. */
  deferWorkspaceActivation?: boolean;
  /**
   * Legacy React/RPC message projection. Native Pi TUI compositions disable it
   * so a second process never reads or owns the interactive Pi session.
   */
  projectSessionMessages?: boolean;
}

export interface AiAgentController {
  settings: PiAgentSettings | undefined;
  status: PiAgentStatus | null;
  commands: AiAgentCommand[];
  isCommandsLoading: boolean;
  commandsError: string | null;
  messages: AiAgentMessage[];
  panelMessages: AiAgentPanelMessage[];
  latestResponse: string | null;
  activities: AiAgentActivityEvent[];
  isResponsePanelOpen: boolean;
  isResponsePanelVisible: boolean;
  isSending: boolean;
  sendError: string | null;
  isInitialLoading: boolean;
  initialError: string | null;
  panelError: string | null;
  isEnabled: boolean;
  isAvailable: boolean;
  workspaceCollaborator: AiAgentWorkspaceCollaborator;
  loadConfiguration(): Promise<void>;
  loadCommands(workspaceKey?: string): Promise<void>;
  refreshStatus(): Promise<PiAgentStatus>;
  saveSettings(settings: PiAgentSettingsUpdate): Promise<PiAgentSettings>;
  installPiAgent(): Promise<PiAgentInstallResult>;
  sendPrompt(prompt: string): Promise<void>;
  closeResponsePanel(): void;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Application-layer owner of Pi Agent configuration and workspace-scoped orchestration.
 * The concrete desktop adapter is supplied through the AI Agent port boundary.
 */
export function useAiAgentController(
  dependencies: UseAiAgentControllerDependencies,
): AiAgentController {
  const configurationRequestRef = useRef(0);
  const commandsLoadRequestRef = useRef(0);
  const sessionLoadRequestRef = useRef(0);
  const traceLoadRequestRef = useRef(0);
  const sendRequestSequenceRef = useRef(0);
  const activeSendRequestsRef = useRef<Map<string, number>>(new Map());
  const workspaceStateCacheRef = useRef<Map<string, AiAgentWorkspaceUiState>>(new Map());
  const currentWorkspaceKeyRef = useRef(getAiAgentWorkspaceStateKey(null));
  const workspaceStateRef = useRef<AiAgentWorkspaceUiState>(createEmptyAiAgentWorkspaceUiState());

  const [settings, setSettings] = useState<PiAgentSettings | undefined>(undefined);
  const [status, setStatus] = useState<PiAgentStatus | null>(null);
  const [commands, setCommands] = useState<AiAgentCommand[]>([]);
  const [isCommandsLoading, setIsCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiAgentMessage[]>([]);
  const [latestResponse, setLatestResponse] = useState<string | null>(null);
  const [activities, setActivities] = useState<AiAgentActivityEvent[]>([]);
  const [isResponsePanelOpen, setIsResponsePanelOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);

  const setVisibleWorkspaceState = useCallback((state: AiAgentWorkspaceUiState): void => {
    const nextState = cloneAiAgentWorkspaceUiState(state);
    workspaceStateRef.current = nextState;
    setMessages(nextState.aiAgentMessages);
    setLatestResponse(nextState.aiAgentLatestResponse);
    setActivities(nextState.aiAgentActivities);
    setIsResponsePanelOpen(nextState.isAiAgentResponsePanelOpen);
    setSendError(nextState.aiAgentSendError);
    setIsSending(nextState.isAiAgentSending);
  }, []);

  const updateWorkspaceState = useCallback(
    (
      workspaceKey: string,
      updater: (state: AiAgentWorkspaceUiState) => AiAgentWorkspaceUiState,
    ): void => {
      const baseState =
        workspaceKey === currentWorkspaceKeyRef.current
          ? workspaceStateRef.current
          : (workspaceStateCacheRef.current.get(workspaceKey) ??
            createEmptyAiAgentWorkspaceUiState());
      const nextState = cloneAiAgentWorkspaceUiState(updater(baseState));
      workspaceStateCacheRef.current.set(workspaceKey, nextState);

      if (workspaceKey === currentWorkspaceKeyRef.current) {
        setVisibleWorkspaceState(nextState);
      }
    },
    [setVisibleWorkspaceState],
  );

  const saveCurrentWorkspaceState = useCallback((): void => {
    workspaceStateCacheRef.current.set(
      currentWorkspaceKeyRef.current,
      cloneAiAgentWorkspaceUiState(workspaceStateRef.current),
    );
  }, []);

  const loadConfiguration = useCallback(async (): Promise<void> => {
    const requestId = configurationRequestRef.current + 1;
    configurationRequestRef.current = requestId;
    setIsInitialLoading(true);
    setInitialError(null);

    try {
      const [loadedSettings, loadedStatus] = await Promise.all([
        dependencies.aiAgent.getSettings(),
        dependencies.aiAgent.getStatus(),
      ]);

      if (configurationRequestRef.current !== requestId) return;
      setSettings(loadedSettings);
      setStatus(loadedStatus);
    } catch (error) {
      if (configurationRequestRef.current !== requestId) return;
      setInitialError(getErrorMessage(error));
      console.error("[AiAgent] Failed to load Pi Agent configuration", {
        errorType: getErrorType(error),
      });
    } finally {
      if (configurationRequestRef.current === requestId) {
        setIsInitialLoading(false);
      }
    }
  }, [dependencies.aiAgent]);

  const loadCommands = useCallback(
    async (workspaceKey?: string): Promise<void> => {
      const targetWorkspaceKey = workspaceKey ?? currentWorkspaceKeyRef.current;
      const requestId = commandsLoadRequestRef.current + 1;
      commandsLoadRequestRef.current = requestId;
      setIsCommandsLoading(true);
      setCommandsError(null);

      try {
        const loadedCommands = await dependencies.aiAgent.listCommands();
        if (
          commandsLoadRequestRef.current !== requestId ||
          currentWorkspaceKeyRef.current !== targetWorkspaceKey
        ) {
          return;
        }
        setCommands(loadedCommands);
      } catch (error) {
        if (
          commandsLoadRequestRef.current !== requestId ||
          currentWorkspaceKeyRef.current !== targetWorkspaceKey
        ) {
          return;
        }
        setCommandsError(getErrorMessage(error));
        console.error("[AiAgent] Failed to load Pi Agent commands", {
          errorType: getErrorType(error),
        });
      } finally {
        if (
          commandsLoadRequestRef.current === requestId &&
          currentWorkspaceKeyRef.current === targetWorkspaceKey
        ) {
          setIsCommandsLoading(false);
        }
      }
    },
    [dependencies.aiAgent],
  );

  const loadSessionMessages = useCallback(
    async (workspaceKey?: string): Promise<boolean> => {
      const targetWorkspaceKey = workspaceKey ?? currentWorkspaceKeyRef.current;
      if (
        dependencies.projectSessionMessages === false ||
        typeof dependencies.aiAgent.getSessionMessages !== "function"
      ) {
        return false;
      }

      const requestId = sessionLoadRequestRef.current + 1;
      sessionLoadRequestRef.current = requestId;

      try {
        const session = await dependencies.aiAgent.getSessionMessages();
        if (
          sessionLoadRequestRef.current !== requestId ||
          currentWorkspaceKeyRef.current !== targetWorkspaceKey
        ) {
          return false;
        }

        const restoredState = createAiAgentWorkspaceUiStateFromSession(session);
        updateWorkspaceState(targetWorkspaceKey, (state) => {
          if (state.aiAgentMessages.length > 0 || state.isAiAgentSending) return state;
          return {
            ...state,
            aiAgentMessages: restoredState.aiAgentMessages,
            aiAgentLatestResponse: restoredState.aiAgentLatestResponse,
            isAiAgentResponsePanelOpen:
              state.isAiAgentResponsePanelOpen || restoredState.isAiAgentResponsePanelOpen,
            aiAgentSendError: null,
          };
        });
        return true;
      } catch (error) {
        if (
          sessionLoadRequestRef.current === requestId &&
          currentWorkspaceKeyRef.current === targetWorkspaceKey
        ) {
          console.warn("[AiAgent] Failed to restore Pi Agent session messages", {
            errorType: getErrorType(error),
          });
        }
        return false;
      }
    },
    [dependencies.aiAgent, dependencies.projectSessionMessages, updateWorkspaceState],
  );

  const loadRecentTraceActivities = useCallback(
    async (mode: "replace" | "append" = "replace", workspaceKey?: string): Promise<void> => {
      const targetWorkspaceKey = workspaceKey ?? currentWorkspaceKeyRef.current;
      if (
        typeof dependencies.aiAgent.listAgentRuns !== "function" ||
        typeof dependencies.aiAgent.getAgentRunTrace !== "function"
      ) {
        return;
      }

      const requestId = traceLoadRequestRef.current + 1;
      traceLoadRequestRef.current = requestId;

      try {
        const runs = await dependencies.aiAgent.listAgentRuns(5);
        if (
          traceLoadRequestRef.current !== requestId ||
          currentWorkspaceKeyRef.current !== targetWorkspaceKey
        ) {
          return;
        }

        const traceEventGroups = await Promise.all(
          runs.map(async (run) => {
            try {
              const trace = await dependencies.aiAgent.getAgentRunTrace(run.runId);
              return trace.events.map((event, index) => withAgentRunContext(run, event, index));
            } catch (error) {
              if (
                traceLoadRequestRef.current === requestId &&
                currentWorkspaceKeyRef.current === targetWorkspaceKey
              ) {
                console.warn("[AiAgent] Failed to load a Pi Agent trace", {
                  errorType: getErrorType(error),
                });
              }
              return [];
            }
          }),
        );

        if (
          traceLoadRequestRef.current !== requestId ||
          currentWorkspaceKeyRef.current !== targetWorkspaceKey
        ) {
          return;
        }

        const parsedActivities = parseAiAgentActivityEvents(traceEventGroups.flat());
        updateWorkspaceState(targetWorkspaceKey, (state) => ({
          ...state,
          aiAgentActivities:
            mode === "append"
              ? mergeAiAgentActivities(state.aiAgentActivities, parsedActivities)
              : parsedActivities,
        }));
      } catch (error) {
        if (
          traceLoadRequestRef.current === requestId &&
          currentWorkspaceKeyRef.current === targetWorkspaceKey
        ) {
          console.warn("[AiAgent] Failed to load recent Pi Agent traces", {
            errorType: getErrorType(error),
          });
        }
      }
    },
    [dependencies.aiAgent, updateWorkspaceState],
  );

  const activateWorkspaceState = useCallback(
    (workspaceKey: string): void => {
      currentWorkspaceKeyRef.current = workspaceKey;
      const cachedState = workspaceStateCacheRef.current.get(workspaceKey);
      if (cachedState) {
        setVisibleWorkspaceState(cachedState);
        return;
      }

      const emptyState = createEmptyAiAgentWorkspaceUiState();
      workspaceStateCacheRef.current.set(workspaceKey, emptyState);
      setVisibleWorkspaceState(emptyState);
      void loadSessionMessages(workspaceKey);
      void loadRecentTraceActivities("replace", workspaceKey);
    },
    [loadRecentTraceActivities, loadSessionMessages, setVisibleWorkspaceState],
  );

  const invalidateWorkspaceRequests = useCallback((): void => {
    sessionLoadRequestRef.current += 1;
    traceLoadRequestRef.current += 1;
    commandsLoadRequestRef.current += 1;
  }, []);

  const beginWorkspaceSwitch = useCallback((): void => {
    saveCurrentWorkspaceState();
    invalidateWorkspaceRequests();
    setCommands([]);
    setCommandsError(null);
    setIsCommandsLoading(false);
  }, [invalidateWorkspaceRequests, saveCurrentWorkspaceState]);

  const activateWorkspace = useCallback(
    (workspace: WorkspaceInfo): string => {
      const workspaceKey = getAiAgentWorkspaceStateKey(workspace);
      activateWorkspaceState(workspaceKey);
      return workspaceKey;
    },
    [activateWorkspaceState],
  );

  const refreshStatus = useCallback(async (): Promise<PiAgentStatus> => {
    const requestId = configurationRequestRef.current + 1;
    configurationRequestRef.current = requestId;
    try {
      const refreshedStatus = await dependencies.aiAgent.getStatus();
      if (configurationRequestRef.current === requestId) {
        setStatus(refreshedStatus);
        setInitialError(null);
      }
      return refreshedStatus;
    } finally {
      if (configurationRequestRef.current === requestId) setIsInitialLoading(false);
    }
  }, [dependencies.aiAgent]);

  const saveSettings = useCallback(
    async (update: PiAgentSettingsUpdate): Promise<PiAgentSettings> => {
      const requestId = configurationRequestRef.current + 1;
      configurationRequestRef.current = requestId;
      try {
        const savedSettings = await dependencies.aiAgent.updateSettings(update);
        const refreshedStatus = await dependencies.aiAgent.getStatus();
        if (configurationRequestRef.current === requestId) {
          setSettings(savedSettings);
          setStatus(refreshedStatus);
          setInitialError(null);
          void loadCommands();
        }
        return savedSettings;
      } finally {
        if (configurationRequestRef.current === requestId) setIsInitialLoading(false);
      }
    },
    [dependencies.aiAgent, loadCommands],
  );

  const installPiAgent = useCallback(async (): Promise<PiAgentInstallResult> => {
    const requestId = configurationRequestRef.current + 1;
    configurationRequestRef.current = requestId;
    try {
      const result = await dependencies.aiAgent.installPiAgent();
      const [loadedSettings, loadedStatus] = await Promise.all([
        dependencies.aiAgent.getSettings(),
        dependencies.aiAgent.getStatus(),
      ]);
      if (configurationRequestRef.current === requestId) {
        setSettings(loadedSettings);
        setStatus(loadedStatus);
        setInitialError(null);
        void loadCommands();
      }
      return result;
    } finally {
      if (configurationRequestRef.current === requestId) setIsInitialLoading(false);
    }
  }, [dependencies.aiAgent, loadCommands]);

  const sendPrompt = useCallback(
    async (prompt: string): Promise<void> => {
      const trimmedPrompt = prompt.trim();
      const workspaceKey = currentWorkspaceKeyRef.current;
      if (!trimmedPrompt || workspaceStateRef.current.isAiAgentSending) return;

      const requestId = sendRequestSequenceRef.current + 1;
      sendRequestSequenceRef.current = requestId;
      activeSendRequestsRef.current.set(workspaceKey, requestId);
      const userMessage: AiAgentMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmedPrompt,
        createdAt: new Date().toLocaleTimeString(),
      };

      traceLoadRequestRef.current += 1;
      updateWorkspaceState(workspaceKey, (state) => ({
        ...state,
        aiAgentMessages: [...state.aiAgentMessages, userMessage],
        aiAgentLatestResponse: null,
        aiAgentActivities: [],
        isAiAgentResponsePanelOpen: true,
        aiAgentSendError: null,
        isAiAgentSending: true,
      }));

      try {
        if (!dependencies.aiAgent.sendPrompt) {
          throw new Error("AI Agent prompt adapter unavailable");
        }

        // Privacy boundary: only the explicit, trimmed panel prompt crosses the port.
        const response = await dependencies.aiAgent.sendPrompt(trimmedPrompt);
        if (activeSendRequestsRef.current.get(workspaceKey) !== requestId) return;

        const assistantMessage: AiAgentMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: response.text,
          createdAt: new Date().toLocaleTimeString(),
        };
        const responseActivities = parseAiAgentActivityEvents(response.metadata?.events);
        updateWorkspaceState(workspaceKey, (state) => ({
          ...state,
          aiAgentLatestResponse: response.text,
          aiAgentActivities: responseActivities,
          aiAgentMessages: [...state.aiAgentMessages, assistantMessage],
          aiAgentSendError: null,
        }));
        if (currentWorkspaceKeyRef.current === workspaceKey) setInitialError(null);
      } catch (error) {
        if (activeSendRequestsRef.current.get(workspaceKey) !== requestId) return;
        updateWorkspaceState(workspaceKey, (state) => ({
          ...state,
          aiAgentSendError: getErrorMessage(error),
        }));
        console.error("[AiAgent] Failed to send AI Agent prompt", {
          errorType: getErrorType(error),
        });
      } finally {
        if (activeSendRequestsRef.current.get(workspaceKey) === requestId) {
          activeSendRequestsRef.current.delete(workspaceKey);
          updateWorkspaceState(workspaceKey, (state) => ({
            ...state,
            isAiAgentSending: false,
          }));
          if (currentWorkspaceKeyRef.current === workspaceKey) {
            void loadRecentTraceActivities("append", workspaceKey);
          }
        }
      }
    },
    [dependencies.aiAgent, loadRecentTraceActivities, updateWorkspaceState],
  );

  const closeResponsePanel = useCallback((): void => {
    updateWorkspaceState(currentWorkspaceKeyRef.current, (state) => ({
      ...state,
      isAiAgentResponsePanelOpen: false,
    }));
  }, [updateWorkspaceState]);

  useEffect(
    () => () => {
      configurationRequestRef.current += 1;
      invalidateWorkspaceRequests();
      activeSendRequestsRef.current.clear();
    },
    [invalidateWorkspaceRequests],
  );

  useEffect(() => {
    void loadConfiguration();
  }, [loadConfiguration]);

  useEffect(() => {
    if (!dependencies.deferWorkspaceActivation) void loadCommands();
  }, [dependencies.deferWorkspaceActivation, loadCommands]);

  useEffect(() => {
    if (
      dependencies.deferWorkspaceActivation ||
      isInitialLoading ||
      dependencies.isWorkspaceLoading
    ) {
      return;
    }

    const workspaceKey = getAiAgentWorkspaceStateKey(dependencies.workspaceInfo);
    if (workspaceKey === currentWorkspaceKeyRef.current) {
      if (!workspaceStateCacheRef.current.has(workspaceKey)) {
        activateWorkspaceState(workspaceKey);
      }
      return;
    }

    saveCurrentWorkspaceState();
    invalidateWorkspaceRequests();
    activateWorkspaceState(workspaceKey);
    setCommands([]);
    setCommandsError(null);
    setIsCommandsLoading(false);
    void loadCommands(workspaceKey);
  }, [
    activateWorkspaceState,
    dependencies.deferWorkspaceActivation,
    dependencies.isWorkspaceLoading,
    dependencies.workspaceInfo,
    invalidateWorkspaceRequests,
    isInitialLoading,
    loadCommands,
    saveCurrentWorkspaceState,
  ]);

  const panelMessages = useMemo(() => toAiAgentPanelMessages(messages), [messages]);
  const workspaceCollaborator = useMemo<AiAgentWorkspaceCollaborator>(
    () => ({ beginWorkspaceSwitch, activateWorkspace, loadCommands }),
    [activateWorkspace, beginWorkspaceSwitch, loadCommands],
  );

  return {
    settings,
    status,
    commands,
    isCommandsLoading,
    commandsError,
    messages,
    panelMessages,
    latestResponse,
    activities,
    isResponsePanelOpen,
    isResponsePanelVisible: isResponsePanelOpen || isSending,
    isSending,
    sendError,
    isInitialLoading,
    initialError,
    panelError: sendError ?? initialError,
    isEnabled: settings?.enabled ?? status?.enabled ?? false,
    isAvailable: status?.available ?? false,
    workspaceCollaborator,
    loadConfiguration,
    loadCommands,
    refreshStatus,
    saveSettings,
    installPiAgent,
    sendPrompt,
    closeResponsePanel,
  };
}
