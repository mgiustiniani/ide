// ---------------------------------------------------------------------------
// @ide/tauri-adapters – TauriAiAgentAdapter
// ---------------------------------------------------------------------------
// Implements AiAgentPort by invoking Tauri Rust commands:
//   get_pi_agent_status, get_pi_agent_settings,
//   update_pi_agent_settings, install_pi_agent,
//   list_pi_agent_commands, get_pi_agent_session_messages,
//   send_pi_agent_prompt
// ---------------------------------------------------------------------------

import { TauriAdapterError, invokeTauri } from './errors';
import type {
  AiAgentCommand,
  AiAgentCommandSource,
  AiAgentProvider,
  AiAgentResponse,
  PiAgentAvailability,
  PiAgentInstallOutcome,
  PiAgentInstallResult,
  PiAgentIntegration,
  PiAgentRun,
  PiAgentRunTrace,
  PiAgentSessionMessage,
  PiAgentSessionMessages,
  PiAgentSettings,
  PiAgentSettingsUpdate,
  PiAgentStatus,
  PiAgentTraceEvent,
} from '@ide/contracts';
import type { AiAgentPort } from '@ide/web-core/ports';

const PI_AGENT_PROVIDER: AiAgentProvider = 'pi';
// Runtime policy is RPC-only. CLI/SDK remain contract literals for compatibility,
// but adapter validation must never surface them as selected/active integrations.
const PI_AGENT_INTEGRATIONS = new Set<PiAgentIntegration>(['rpc']);
const PI_AGENT_AVAILABILITIES = new Set<PiAgentAvailability>([
  'disabled',
  'available',
  'not-installed',
  'installing',
  'unavailable',
  'error',
]);
const PI_AGENT_INSTALL_OUTCOMES = new Set<PiAgentInstallOutcome>([
  'installed',
  'already-installed',
  'failed',
  'cancelled',
  'unsupported',
]);
const AI_AGENT_COMMAND_SOURCES = new Set<AiAgentCommandSource>([
  'skill',
  'prompt',
  'extension',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidShape(
  command: string,
  message: string,
  response: unknown,
): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`, response);
}

function requireRecord(command: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidShape(command, 'expected object', value);
  }

  return value;
}

function requireString(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw invalidShape(command, `missing string ${field}`, response);
  }

  return value;
}

function requireBoolean(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') {
    throw invalidShape(command, `missing boolean ${field}`, response);
  }

  return value;
}

function optionalString(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw invalidShape(command, `invalid string ${field}`, response);
  }

  return value;
}

function optionalNullableString(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'string') {
    return value;
  }

  throw invalidShape(command, `invalid nullable string ${field}`, response);
}

function optionalBoolean(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw invalidShape(command, `invalid boolean ${field}`, response);
  }

  return value;
}

function optionalNumber(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number') {
    throw invalidShape(command, `invalid number ${field}`, response);
  }

  return value;
}

function optionalCommandString(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw invalidShape(command, `invalid string ${field}`, response);
  }

  return value;
}

function optionalMetadata(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const value = record.metadata;
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw invalidShape(command, 'invalid object metadata', response);
  }

  return value;
}

function requireProvider(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
): AiAgentProvider {
  const provider = requireString(command, response, record, 'provider');
  if (provider !== PI_AGENT_PROVIDER) {
    throw invalidShape(command, `unsupported provider ${provider}`, response);
  }

  return provider;
}

function requireIntegration(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): PiAgentIntegration {
  const integration = requireString(command, response, record, field);
  if (!PI_AGENT_INTEGRATIONS.has(integration as PiAgentIntegration)) {
    throw invalidShape(command, `unsupported integration ${integration}`, response);
  }

  return integration as PiAgentIntegration;
}

function optionalIntegration(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): PiAgentIntegration | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || !PI_AGENT_INTEGRATIONS.has(value as PiAgentIntegration)) {
    throw invalidShape(command, `invalid integration ${field}`, response);
  }

  return value as PiAgentIntegration;
}

function integrationList(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): readonly PiAgentIntegration[] {
  if (!Array.isArray(value)) {
    throw invalidShape(command, `missing array ${field}`, response);
  }

  return value.map((integration) => {
    if (typeof integration !== 'string' || !PI_AGENT_INTEGRATIONS.has(integration as PiAgentIntegration)) {
      throw invalidShape(command, `invalid integration in ${field}`, response);
    }

    return integration as PiAgentIntegration;
  });
}

function optionalIntegrationList(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): readonly PiAgentIntegration[] | undefined {
  const value = record[field];
  if (value === undefined || value === null) {
    return undefined;
  }

  return integrationList(command, response, value, field);
}

function normalizeSettings(command: string, response: unknown): PiAgentSettings {
  const record = requireRecord(command, response);
  const settings: PiAgentSettings = {
    enabled: requireBoolean(command, response, record, 'enabled'),
    provider: requireProvider(command, response, record),
    preferredIntegration: requireIntegration(command, response, record, 'preferredIntegration'),
    fallbackIntegrations: integrationList(
      command,
      response,
      record.fallbackIntegrations,
      'fallbackIntegrations',
    ),
  };

  const model = optionalString(command, response, record, 'model');
  const cliPath = optionalString(command, response, record, 'cliPath');
  const rpcEndpoint = optionalString(command, response, record, 'rpcEndpoint');
  const metadata = optionalMetadata(command, response, record);

  if (model !== undefined) {
    settings.model = model;
  }
  if (cliPath !== undefined) {
    settings.cliPath = cliPath;
  }
  if (rpcEndpoint !== undefined) {
    settings.rpcEndpoint = rpcEndpoint;
  }
  if (metadata !== undefined) {
    settings.metadata = metadata;
  }

  return settings;
}

function normalizeStatus(command: string, response: unknown): PiAgentStatus {
  const record = requireRecord(command, response);
  const availability = requireString(command, response, record, 'availability');
  if (!PI_AGENT_AVAILABILITIES.has(availability as PiAgentAvailability)) {
    throw invalidShape(command, `unsupported availability ${availability}`, response);
  }

  const status: PiAgentStatus = {
    provider: requireProvider(command, response, record),
    enabled: requireBoolean(command, response, record, 'enabled'),
    available: requireBoolean(command, response, record, 'available'),
    availability: availability as PiAgentAvailability,
    preferredIntegration: requireIntegration(command, response, record, 'preferredIntegration'),
  };

  const activeIntegration = optionalIntegration(command, response, record, 'activeIntegration');
  const fallbackIntegrations = optionalIntegrationList(
    command,
    response,
    record,
    'fallbackIntegrations',
  );
  const version = optionalString(command, response, record, 'version');
  const lastError = optionalString(command, response, record, 'lastError');
  const checkedAt = optionalString(command, response, record, 'checkedAt');
  const metadata = optionalMetadata(command, response, record);

  if (activeIntegration !== undefined) {
    status.activeIntegration = activeIntegration;
  }
  if (fallbackIntegrations !== undefined) {
    status.fallbackIntegrations = fallbackIntegrations;
  }
  if (version !== undefined) {
    status.version = version;
  }
  if (lastError !== undefined) {
    status.lastError = lastError;
  }
  if (checkedAt !== undefined) {
    status.checkedAt = checkedAt;
  }
  if (metadata !== undefined) {
    status.metadata = metadata;
  }

  return status;
}

function normalizeInstallResult(command: string, response: unknown): PiAgentInstallResult {
  const record = requireRecord(command, response);
  const outcome = requireString(command, response, record, 'outcome');
  if (!PI_AGENT_INSTALL_OUTCOMES.has(outcome as PiAgentInstallOutcome)) {
    throw invalidShape(command, `unsupported install outcome ${outcome}`, response);
  }

  const result: PiAgentInstallResult = {
    provider: requireProvider(command, response, record),
    success: requireBoolean(command, response, record, 'success'),
    outcome: outcome as PiAgentInstallOutcome,
  };

  const integration = optionalIntegration(command, response, record, 'integration');
  const version = optionalString(command, response, record, 'version');
  const message = optionalString(command, response, record, 'message');
  const metadata = optionalMetadata(command, response, record);

  if (integration !== undefined) {
    result.integration = integration;
  }
  if (version !== undefined) {
    result.version = version;
  }
  if (message !== undefined) {
    result.message = message;
  }
  if (metadata !== undefined) {
    result.metadata = metadata;
  }

  return result;
}

function normalizeCommands(command: string, response: unknown): AiAgentCommand[] {
  const record = requireRecord(command, response);
  requireProvider(command, response, record);
  requireIntegration(command, response, record, 'integration');

  const commands = record.commands;
  if (!Array.isArray(commands)) {
    throw invalidShape(command, 'missing array commands', response);
  }

  return commands.map((item, index) => {
    if (!isRecord(item)) {
      throw invalidShape(command, `invalid object commands[${index}]`, response);
    }

    const source = requireString(command, response, item, 'source');
    if (!AI_AGENT_COMMAND_SOURCES.has(source as AiAgentCommandSource)) {
      throw invalidShape(command, `unsupported command source ${source}`, response);
    }

    const aiCommand: AiAgentCommand = {
      name: requireString(command, response, item, 'name'),
      source: source as AiAgentCommandSource,
    };

    const description = optionalCommandString(command, response, item, 'description');
    const location = optionalCommandString(command, response, item, 'location');
    const path = optionalCommandString(command, response, item, 'path');

    if (description !== undefined) {
      aiCommand.description = description;
    }
    if (location !== undefined) {
      aiCommand.location = location;
    }
    if (path !== undefined) {
      aiCommand.path = path;
    }

    return aiCommand;
  });
}

function normalizePromptResponse(command: string, response: unknown): AiAgentResponse {
  const record = requireRecord(command, response);
  const result: AiAgentResponse = {
    text: requireString(command, response, record, 'text'),
    provider: requireProvider(command, response, record),
    integration: requireIntegration(command, response, record, 'integration'),
  };

  const model = optionalString(command, response, record, 'model');
  const metadata = optionalMetadata(command, response, record);

  if (model !== undefined) {
    result.model = model;
  }
  if (metadata !== undefined) {
    result.metadata = metadata;
  }

  return result;
}

function normalizeChangedFiles(
  command: string,
  response: unknown,
  value: unknown,
): PiAgentRun['changedFiles'] {
  if (!Array.isArray(value)) {
    throw invalidShape(command, 'invalid array changedFiles', response);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw invalidShape(command, `invalid object changedFiles[${index}]`, response);
    }

    return {
      path: requireString(command, response, item, 'path'),
      status: requireString(command, response, item, 'status'),
    };
  });
}

function normalizeAgentRuns(command: string, response: unknown): PiAgentRun[] {
  if (!Array.isArray(response)) {
    throw invalidShape(command, 'expected array', response);
  }

  return response.map((item, index) => {
    if (!isRecord(item)) {
      throw invalidShape(command, `invalid object runs[${index}]`, response);
    }

    const run: PiAgentRun = {
      runId: requireString(command, response, item, 'runId'),
    };

    const traceId = optionalString(command, response, item, 'traceId');
    const agentId = optionalString(command, response, item, 'agentId');
    const parentAgentId = optionalNullableString(command, response, item, 'parentAgentId');
    const workflow = optionalNullableString(command, response, item, 'workflow');
    const workspaceId = optionalString(command, response, item, 'workspaceId');
    const startedAt = optionalString(command, response, item, 'startedAt');
    const sealedAt = optionalString(command, response, item, 'sealedAt');
    const complete = optionalBoolean(command, response, item, 'complete');
    const eventCount = optionalNumber(command, response, item, 'eventCount');
    const changedFiles = item.changedFiles === undefined || item.changedFiles === null
      ? undefined
      : normalizeChangedFiles(command, response, item.changedFiles);

    if (traceId !== undefined) {
      run.traceId = traceId;
    }
    if (agentId !== undefined) {
      run.agentId = agentId;
    }
    if (parentAgentId !== undefined) {
      run.parentAgentId = parentAgentId;
    }
    if (workflow !== undefined) {
      run.workflow = workflow;
    }
    if (workspaceId !== undefined) {
      run.workspaceId = workspaceId;
    }
    if (startedAt !== undefined) {
      run.startedAt = startedAt;
    }
    if (sealedAt !== undefined) {
      run.sealedAt = sealedAt;
    }
    if (complete !== undefined) {
      run.complete = complete;
    }
    if (eventCount !== undefined) {
      run.eventCount = eventCount;
    }
    if (changedFiles !== undefined) {
      run.changedFiles = changedFiles;
    }

    return run;
  });
}

function normalizeAgentRunTrace(command: string, response: unknown): PiAgentRunTrace {
  const record = requireRecord(command, response);
  const events = record.events;
  if (!Array.isArray(events)) {
    throw invalidShape(command, 'missing array events', response);
  }

  return {
    runId: requireString(command, response, record, 'runId'),
    events: events.map((event, index) => {
      if (!isRecord(event)) {
        throw invalidShape(command, `invalid object events[${index}]`, response);
      }
      if (typeof event.type !== 'string') {
        throw invalidShape(command, `missing string events[${index}].type`, response);
      }

      return event as PiAgentTraceEvent;
    }),
  };
}

function normalizeSessionMessages(command: string, response: unknown): PiAgentSessionMessages {
  const record = requireRecord(command, response);
  const provider = record.provider === undefined || record.provider === null
    ? undefined
    : requireProvider(command, response, record);
  const integration = optionalIntegration(command, response, record, 'integration');
  const messages = record.messages;
  if (!Array.isArray(messages)) {
    throw invalidShape(command, 'missing array messages', response);
  }

  const metadata = optionalMetadata(command, response, record);
  const result: PiAgentSessionMessages = {
    workspaceId: requireString(command, response, record, 'workspaceId'),
    sessionId: requireString(command, response, record, 'sessionId'),
    messages: messages.map((message, index): PiAgentSessionMessage => {
      if (!isRecord(message)) {
        throw invalidShape(command, `invalid object messages[${index}]`, response);
      }

      return { ...message };
    }),
  };

  if (provider !== undefined) {
    result.provider = provider;
  }
  if (integration !== undefined) {
    result.integration = integration;
  }
  if (metadata !== undefined) {
    result.metadata = metadata;
  }

  return result;
}

export class TauriAiAgentAdapter implements AiAgentPort {
  /** Return Pi agent availability/status from the Tauri backend. */
  async getStatus(): Promise<PiAgentStatus> {
    const command = 'get_pi_agent_status';
    const response = await invokeTauri<unknown>(command);
    return normalizeStatus(command, response);
  }

  /** Return normalized Settings UI values for the optional Pi integration. */
  async getSettings(): Promise<PiAgentSettings> {
    const command = 'get_pi_agent_settings';
    const response = await invokeTauri<unknown>(command);
    return normalizeSettings(command, response);
  }

  /** List discoverable Pi commands/skills through the Tauri backend. */
  async listCommands(): Promise<AiAgentCommand[]> {
    const command = 'list_pi_agent_commands';
    const response = await invokeTauri<unknown>(command);
    return normalizeCommands(command, response);
  }

  /** Persist Settings UI changes and return normalized settings. */
  async updateSettings(settings: PiAgentSettingsUpdate): Promise<PiAgentSettings> {
    const command = 'update_pi_agent_settings';
    const response = await invokeTauri<unknown>(command, { update: settings });
    return normalizeSettings(command, response);
  }

  /** Install Pi agent through the guarded Tauri command. */
  async installPiAgent(): Promise<PiAgentInstallResult> {
    const command = 'install_pi_agent';
    const response = await invokeTauri<unknown>(command, { confirm: true });
    return normalizeInstallResult(command, response);
  }

  /** List persisted Pi agent run trace summaries from the workspace. */
  async listAgentRuns(limit?: number): Promise<PiAgentRun[]> {
    const command = 'list_agent_runs';
    const response = await invokeTauri<unknown>(
      command,
      limit === undefined ? undefined : { limit },
    );
    return normalizeAgentRuns(command, response);
  }

  /** Load the persisted Pi event stream for one agent run. */
  async getAgentRunTrace(runId: string): Promise<PiAgentRunTrace> {
    const command = 'get_agent_run_trace';
    const response = await invokeTauri<unknown>(command, { runId });
    return normalizeAgentRunTrace(command, response);
  }

  /** Restore persisted Pi session messages for the current workspace/session. */
  async getSessionMessages(): Promise<PiAgentSessionMessages> {
    const command = 'get_pi_agent_session_messages';
    const response = await invokeTauri<unknown>(command);
    return normalizeSessionMessages(command, response);
  }

  /** Send a one-shot prompt through the fixed Pi RPC backend command. */
  async sendPrompt(prompt: string): Promise<AiAgentResponse> {
    const command = 'send_pi_agent_prompt';
    const response = await invokeTauri<unknown>(command, { prompt });
    return normalizePromptResponse(command, response);
  }
}
