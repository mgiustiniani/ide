import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import {
  PI_WORKSPACE_AGENT_PROTOCOL_VERSION,
  type AttachPiWorkspaceAgentRequest,
  type DetachPiWorkspaceAgentRequest,
  type PiWorkspaceAgentAccessories,
  type PiWorkspaceAgentActivity,
  type PiWorkspaceAgentAttachment,
  type PiWorkspaceAgentChange,
  type PiWorkspaceAgentDetachedBinding,
  type PiWorkspaceAgentOutputEvent,
  type PiWorkspaceAgentProcessState,
  type PiWorkspaceAgentResource,
  type PiWorkspaceAgentResourceKind,
  type PiWorkspaceAgentResourceScope,
  type PiWorkspaceAgentSessionSnapshot,
  type PiWorkspaceAgentSessionSummary,
  type PiWorkspaceAgentStatusEvent,
  type ResizePiWorkspaceAgentRequest,
} from "@ide/contracts";
import type { PiWorkspaceAgentPort, PiWorkspaceAgentUnsubscribe } from "@ide/web-core/ports";

import { invokeTauri, TauriAdapterError, toTauriAdapterError } from "./errors";

export const PI_WORKSPACE_AGENT_COMMANDS = Object.freeze({
  attach: "attach_pi_workspace_agent",
  detach: "detach_pi_workspace_agent",
  write: "write_pi_workspace_agent",
  resize: "resize_pi_workspace_agent",
  start: "start_pi_workspace_agent",
  stop: "stop_pi_workspace_agent",
  snapshot: "get_pi_workspace_agent_snapshot",
  accessories: "get_pi_workspace_agent_accessories",
  openDetached: "open_pi_workspace_agent_window",
  detachedBinding: "get_pi_workspace_agent_detached_binding",
});

export const PI_WORKSPACE_AGENT_EVENTS = Object.freeze({
  output: "pi-workspace-agent-output",
  status: "pi-workspace-agent-status",
});

const PROCESS_STATES = new Set<PiWorkspaceAgentProcessState>([
  "starting",
  "running",
  "exited",
  "stopped",
  "failed",
]);
const RESOURCE_KINDS = new Set<PiWorkspaceAgentResourceKind>(["package", "command"]);
const RESOURCE_SCOPES = new Set<PiWorkspaceAgentResourceScope>(["user", "project", "effective"]);
const BASE64 = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u;
const SESSION_SUMMARY_FIELD_NAMES = [
  "workspaceId",
  "workspaceName",
  "sessionId",
  "processState",
  "processGeneration",
  "lastActivityAt",
  "attachedViewCount",
] as const satisfies readonly (keyof PiWorkspaceAgentSessionSummary)[];
const SESSION_SUMMARY_FIELDS: ReadonlySet<string> = new Set(SESSION_SUMMARY_FIELD_NAMES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(command: string, message: string, response: unknown): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`, response);
}

function record(command: string, response: unknown, value: unknown = response) {
  if (!isRecord(value)) throw invalid(command, "expected object", response);
  return value;
}

function text(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw invalid(command, `invalid string ${field}`, response);
  }
  return value;
}

function optionalText(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(command, response, value, field);
}

function integer(command: string, response: unknown, value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalid(command, `invalid non-negative safe integer ${field}`, response);
  }
  return value;
}

function optionalInteger(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return integer(command, response, value, field);
}

function bool(command: string, response: unknown, value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw invalid(command, `invalid boolean ${field}`, response);
  return value;
}

function protocol(command: string, response: unknown, value: unknown): 1 {
  if (value !== PI_WORKSPACE_AGENT_PROTOCOL_VERSION) {
    throw invalid(command, "unsupported protocolVersion", response);
  }
  return PI_WORKSPACE_AGENT_PROTOCOL_VERSION;
}

function normalizeSession(
  command: string,
  response: unknown,
  value: unknown,
  field = "session",
): PiWorkspaceAgentSessionSnapshot {
  const item = record(command, response, value);
  const processState = text(command, response, item.processState, `${field}.processState`);
  if (!PROCESS_STATES.has(processState as PiWorkspaceAgentProcessState)) {
    throw invalid(command, `invalid ${field}.processState`, response);
  }
  return {
    workspaceId: text(command, response, item.workspaceId, `${field}.workspaceId`),
    workspaceName: text(command, response, item.workspaceName, `${field}.workspaceName`),
    rootPath: text(command, response, item.rootPath, `${field}.rootPath`),
    sessionId: text(command, response, item.sessionId, `${field}.sessionId`),
    processState: processState as PiWorkspaceAgentProcessState,
    processGeneration: integer(
      command,
      response,
      item.processGeneration,
      `${field}.processGeneration`,
    ),
    processId: optionalInteger(command, response, item.processId, `${field}.processId`),
    exitCode: optionalInteger(command, response, item.exitCode, `${field}.exitCode`),
    startedAt: optionalText(command, response, item.startedAt, `${field}.startedAt`),
    lastActivityAt: text(command, response, item.lastActivityAt, `${field}.lastActivityAt`),
    attachedViewCount: integer(
      command,
      response,
      item.attachedViewCount,
      `${field}.attachedViewCount`,
    ),
    lastError: optionalText(command, response, item.lastError, `${field}.lastError`),
  };
}

function normalizeSessionSummary(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): PiWorkspaceAgentSessionSummary {
  const item = record(command, response, value);
  const actualFields = Object.keys(item);
  const unsupportedField = actualFields.find((candidate) => !SESSION_SUMMARY_FIELDS.has(candidate));
  if (unsupportedField) {
    throw invalid(command, `unsupported field ${field}.${unsupportedField}`, response);
  }
  const missingField = SESSION_SUMMARY_FIELD_NAMES.find(
    (candidate) => !Object.prototype.hasOwnProperty.call(item, candidate),
  );
  if (missingField) {
    throw invalid(command, `missing field ${field}.${missingField}`, response);
  }
  if (actualFields.length !== SESSION_SUMMARY_FIELD_NAMES.length) {
    throw invalid(command, `invalid fields ${field}`, response);
  }

  const processState = text(command, response, item.processState, `${field}.processState`);
  if (!PROCESS_STATES.has(processState as PiWorkspaceAgentProcessState)) {
    throw invalid(command, `invalid ${field}.processState`, response);
  }
  return {
    workspaceId: text(command, response, item.workspaceId, `${field}.workspaceId`),
    workspaceName: text(command, response, item.workspaceName, `${field}.workspaceName`),
    sessionId: text(command, response, item.sessionId, `${field}.sessionId`),
    processState: processState as PiWorkspaceAgentProcessState,
    processGeneration: integer(
      command,
      response,
      item.processGeneration,
      `${field}.processGeneration`,
    ),
    lastActivityAt: text(command, response, item.lastActivityAt, `${field}.lastActivityAt`),
    attachedViewCount: integer(
      command,
      response,
      item.attachedViewCount,
      `${field}.attachedViewCount`,
    ),
  };
}

function normalizeActivity(
  command: string,
  response: unknown,
  value: unknown,
  index: number,
): PiWorkspaceAgentActivity {
  const item = record(command, response, value);
  const field = `activities[${index}]`;
  return {
    sequence: integer(command, response, item.sequence, `${field}.sequence`),
    eventType: text(command, response, item.eventType, `${field}.eventType`),
    timestamp: text(command, response, item.timestamp, `${field}.timestamp`),
    detail: text(command, response, item.detail, `${field}.detail`),
    viewId: optionalText(command, response, item.viewId, `${field}.viewId`),
  };
}

function array(command: string, response: unknown, value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(command, `invalid array ${field}`, response);
  return value;
}

function normalizeAttachment(command: string, response: unknown): PiWorkspaceAgentAttachment {
  const item = record(command, response);
  const transcriptBase64 = text(command, response, item.transcriptBase64, "transcriptBase64", true);
  if (!BASE64.test(transcriptBase64)) {
    throw invalid(command, "invalid base64 transcriptBase64", response);
  }
  return {
    protocolVersion: protocol(command, response, item.protocolVersion),
    session: normalizeSession(command, response, item.session),
    transcriptBase64,
    transcriptSequence: integer(command, response, item.transcriptSequence, "transcriptSequence"),
    transcriptTruncated: bool(command, response, item.transcriptTruncated, "transcriptTruncated"),
    activities: array(command, response, item.activities, "activities").map((activity, index) =>
      normalizeActivity(command, response, activity, index),
    ),
    sessions: array(command, response, item.sessions, "sessions").map((session, index) =>
      normalizeSessionSummary(command, response, session, `sessions[${index}]`),
    ),
  };
}

function normalizeOutputEvent(command: string, response: unknown): PiWorkspaceAgentOutputEvent {
  const item = record(command, response);
  const dataBase64 = text(command, response, item.dataBase64, "dataBase64", true);
  if (!BASE64.test(dataBase64)) throw invalid(command, "invalid base64 dataBase64", response);
  return {
    protocolVersion: protocol(command, response, item.protocolVersion),
    workspaceId: text(command, response, item.workspaceId, "workspaceId"),
    processGeneration: integer(command, response, item.processGeneration, "processGeneration"),
    sequence: integer(command, response, item.sequence, "sequence"),
    dataBase64,
  };
}

function normalizeStatusEvent(command: string, response: unknown): PiWorkspaceAgentStatusEvent {
  const item = record(command, response);
  return {
    protocolVersion: protocol(command, response, item.protocolVersion),
    session: normalizeSession(command, response, item.session),
  };
}

function normalizeChange(
  command: string,
  response: unknown,
  value: unknown,
  index: number,
): PiWorkspaceAgentChange {
  const item = record(command, response, value);
  return {
    path: text(command, response, item.path, `changes[${index}].path`),
    status: text(command, response, item.status, `changes[${index}].status`),
  };
}

function normalizeResource(
  command: string,
  response: unknown,
  value: unknown,
  index: number,
): PiWorkspaceAgentResource {
  const item = record(command, response, value);
  const kind = text(command, response, item.kind, `resources[${index}].kind`);
  const scope = text(command, response, item.scope, `resources[${index}].scope`);
  if (!RESOURCE_KINDS.has(kind as PiWorkspaceAgentResourceKind)) {
    throw invalid(command, `invalid resources[${index}].kind`, response);
  }
  if (!RESOURCE_SCOPES.has(scope as PiWorkspaceAgentResourceScope)) {
    throw invalid(command, `invalid resources[${index}].scope`, response);
  }
  return {
    kind: kind as PiWorkspaceAgentResourceKind,
    name: text(command, response, item.name, `resources[${index}].name`),
    scope: scope as PiWorkspaceAgentResourceScope,
    source: optionalText(command, response, item.source, `resources[${index}].source`),
    path: optionalText(command, response, item.path, `resources[${index}].path`),
    description: optionalText(
      command,
      response,
      item.description,
      `resources[${index}].description`,
    ),
  };
}

function normalizeAccessories(command: string, response: unknown): PiWorkspaceAgentAccessories {
  const item = record(command, response);
  return {
    protocolVersion: protocol(command, response, item.protocolVersion),
    workspaceId: text(command, response, item.workspaceId, "workspaceId"),
    changes: array(command, response, item.changes, "changes").map((change, index) =>
      normalizeChange(command, response, change, index),
    ),
    resources: array(command, response, item.resources, "resources").map((resource, index) =>
      normalizeResource(command, response, resource, index),
    ),
    warnings: array(command, response, item.warnings, "warnings").map((warning, index) =>
      text(command, response, warning, `warnings[${index}]`),
    ),
  };
}

function normalizeDetachedBinding(
  command: string,
  response: unknown,
): PiWorkspaceAgentDetachedBinding {
  const item = record(command, response);
  return {
    protocolVersion: protocol(command, response, item.protocolVersion),
    workspaceId: text(command, response, item.workspaceId, "workspaceId"),
    workspaceName: text(command, response, item.workspaceName, "workspaceName"),
  };
}

function bytesToBase64(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function subscribe<T>(
  eventName: string,
  normalizer: (command: string, response: unknown) => T,
  listener: (event: T) => void,
): Promise<PiWorkspaceAgentUnsubscribe> {
  try {
    return await listen<unknown>(eventName, (event: TauriEvent<unknown>) => {
      try {
        listener(normalizer(eventName, event.payload));
      } catch (error) {
        console.error(`[PiWorkspaceAgent] Ignored invalid ${eventName} event`, error);
      }
    });
  } catch (error) {
    throw toTauriAdapterError(`listen:${eventName}`, error);
  }
}

export class TauriPiWorkspaceAgentAdapter implements PiWorkspaceAgentPort {
  async attach(request: AttachPiWorkspaceAgentRequest): Promise<PiWorkspaceAgentAttachment> {
    const command = PI_WORKSPACE_AGENT_COMMANDS.attach;
    return normalizeAttachment(command, await invokeTauri(command, { ...request }));
  }

  async detach(request: DetachPiWorkspaceAgentRequest): Promise<void> {
    await invokeTauri<void>(PI_WORKSPACE_AGENT_COMMANDS.detach, { ...request });
  }

  async write(workspaceId: string, data: Uint8Array): Promise<void> {
    await invokeTauri<void>(PI_WORKSPACE_AGENT_COMMANDS.write, {
      workspaceId,
      dataBase64: bytesToBase64(data),
    });
  }

  async resize(request: ResizePiWorkspaceAgentRequest): Promise<void> {
    await invokeTauri<void>(PI_WORKSPACE_AGENT_COMMANDS.resize, { ...request });
  }

  async start(
    workspaceId: string,
    cols: number,
    rows: number,
  ): Promise<PiWorkspaceAgentAttachment> {
    const command = PI_WORKSPACE_AGENT_COMMANDS.start;
    return normalizeAttachment(command, await invokeTauri(command, { workspaceId, cols, rows }));
  }

  async stop(workspaceId: string, confirmed: true): Promise<PiWorkspaceAgentAttachment> {
    const command = PI_WORKSPACE_AGENT_COMMANDS.stop;
    return normalizeAttachment(command, await invokeTauri(command, { workspaceId, confirmed }));
  }

  async snapshot(workspaceId: string): Promise<PiWorkspaceAgentAttachment> {
    const command = PI_WORKSPACE_AGENT_COMMANDS.snapshot;
    return normalizeAttachment(command, await invokeTauri(command, { workspaceId }));
  }

  async accessories(workspaceId: string): Promise<PiWorkspaceAgentAccessories> {
    const command = PI_WORKSPACE_AGENT_COMMANDS.accessories;
    return normalizeAccessories(command, await invokeTauri(command, { workspaceId }));
  }

  async openDetached(workspaceId: string): Promise<PiWorkspaceAgentDetachedBinding> {
    const command = PI_WORKSPACE_AGENT_COMMANDS.openDetached;
    return normalizeDetachedBinding(command, await invokeTauri(command, { workspaceId }));
  }

  async getDetachedBinding(): Promise<PiWorkspaceAgentDetachedBinding> {
    const command = PI_WORKSPACE_AGENT_COMMANDS.detachedBinding;
    return normalizeDetachedBinding(command, await invokeTauri(command));
  }

  subscribeOutput(
    listener: (event: PiWorkspaceAgentOutputEvent) => void,
  ): Promise<PiWorkspaceAgentUnsubscribe> {
    return subscribe(PI_WORKSPACE_AGENT_EVENTS.output, normalizeOutputEvent, listener);
  }

  subscribeStatus(
    listener: (event: PiWorkspaceAgentStatusEvent) => void,
  ): Promise<PiWorkspaceAgentUnsubscribe> {
    return subscribe(PI_WORKSPACE_AGENT_EVENTS.status, normalizeStatusEvent, listener);
  }
}
