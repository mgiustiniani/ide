import type {
  DidChangeLanguageDocumentRequest,
  DidCloseLanguageDocumentRequest,
  DidOpenLanguageDocumentRequest,
  DidSaveLanguageDocumentRequest,
  LanguageDiagnostic,
  LanguageServiceCapabilities,
  LanguageServiceEvent,
  LanguageServiceEventListener,
  LanguageServiceProgress,
  LanguageServiceState,
  LanguageServiceStatus,
  LanguageServiceUnsubscribe,
  LanguageSessionTarget,
  RestartLanguageSessionRequest,
  StartLanguageSessionRequest,
  StopLanguageSessionRequest,
  VersionedLanguageDocument,
} from '@ide/contracts';
import type { DocumentSyncPort, LanguageSessionPort } from '@ide/web-core/ports';

import { TauriAdapterError, invokeTauri, toTauriAdapterError } from './errors';

const POLL_COMMAND = 'poll_java_language_service_events';
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_PATH_LENGTH = 4_096;
const MAX_DIAGNOSTICS = 200;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 4_096;
const MAX_RELATED_INFORMATION = 16;
const MAX_DIAGNOSTIC_URI_LENGTH = 4_096;
const EMPTY_CAPABILITIES: LanguageServiceCapabilities = {
  documentSync: false,
  diagnostics: false,
  completion: false,
  hover: false,
  signature: false,
  definition: false,
  references: false,
  symbols: false,
  codeActions: false,
  formatting: false,
  rename: false,
  hierarchy: false,
};

interface PollOptions {
  pollIntervalMs?: number;
  hiddenPollIntervalMs?: number;
  maxBackoffMs?: number;
  pollLimit?: number;
}

interface Subscription {
  workspaceId: string;
  listener: LanguageServiceEventListener;
  active: boolean;
}

interface NativeEvent {
  sequence: number;
  generation: number;
  kind: string;
  payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(command: string, message: string, response: unknown): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`, response);
}

function requiredRecord(command: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(command, 'expected object', value);
  return value;
}

function requiredString(command: string, response: unknown, value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(command, `invalid string ${field}`, response);
  }
  return value;
}

function optionalString(command: string, response: unknown, value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalid(command, `invalid string ${field}`, response);
  return value || undefined;
}

function integer(command: string, response: unknown, value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalid(command, `invalid non-negative integer ${field}`, response);
  }
  return value as number;
}

function booleanField(command: string, response: unknown, record: Record<string, unknown>, field: string): boolean {
  if (typeof record[field] !== 'boolean') throw invalid(command, `invalid boolean ${field}`, response);
  return record[field] as boolean;
}

function lifecycleState(command: string, response: unknown, lifecycle: unknown, available: boolean): LanguageServiceState {
  if (!available) return 'unavailable';
  switch (lifecycle) {
    case 'stopped': return 'stopped';
    case 'starting': case 'initializing': return 'starting';
    case 'indexing': return 'indexing';
    case 'initialized': case 'ready': return 'ready';
    case 'degraded': return 'degraded';
    case 'failed': case 'error': return 'failed';
    case 'stopping': return 'stopping';
    default: throw invalid(command, 'unsupported lifecycle', response);
  }
}

function normalizeCapabilities(command: string, response: unknown, value: unknown, initialized: boolean): LanguageServiceCapabilities {
  if (!initialized || value === undefined || value === null) return { ...EMPTY_CAPABILITIES };
  const record = requiredRecord(command, value);
  const documentSync = booleanField(command, response, record, 'documentSync');
  const diagnostics = booleanField(command, response, record, 'diagnostics');
  const completion = booleanField(command, response, record, 'completion');
  const hover = booleanField(command, response, record, 'hover');
  const definition = booleanField(command, response, record, 'definition');
  const references = booleanField(command, response, record, 'references');
  const documentSymbols = booleanField(command, response, record, 'documentSymbols');
  const workspaceSymbols = booleanField(command, response, record, 'workspaceSymbols');
  const rename = booleanField(command, response, record, 'rename');
  const codeActions = booleanField(command, response, record, 'codeActions');
  const formatting = booleanField(command, response, record, 'formatting');
  const signature = booleanField(command, response, record, 'signatureHelp');
  return {
    documentSync,
    diagnostics,
    completion,
    hover,
    signature,
    definition,
    references,
    symbols: documentSymbols || workspaceSymbols,
    codeActions,
    formatting,
    rename,
    hierarchy: false,
  };
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function normalizeProvider(command: string, response: unknown, value: unknown): string {
  if (value === 'jdtls' || value === 'jdt-ls') return 'jdt-ls';
  throw invalid(command, 'unsupported provider', response);
}

function normalizeStatus(command: string, response: unknown, expectedWorkspaceId: string): { status: LanguageServiceStatus; workspaceRoot?: string } {
  const record = requiredRecord(command, response);
  if (typeof record.available !== 'boolean') throw invalid(command, 'invalid boolean available', response);
  const generation = integer(command, response, record.generation, 'generation');
  const workspaceId = requiredString(command, response, record.workspaceId, 'workspaceId');
  if (workspaceId !== expectedWorkspaceId) {
    throw invalid(command, `workspaceId did not match ${expectedWorkspaceId}`, response);
  }
  const state = lifecycleState(command, response, record.lifecycle, record.available);
  const provider = normalizeProvider(command, response, record.provider);
  const serverVersion = optionalString(command, response, record.jdtlsVersion, 'jdtlsVersion');
  const status: LanguageServiceStatus = {
    state,
    provider,
    workspaceId,
    generation,
    capabilities: normalizeCapabilities(command, response, record.capabilities, state === 'ready' || state === 'indexing' || state === 'degraded'),
    checkedAt: validTimestamp(record.checkedAt) ?? new Date().toISOString(),
  };
  const serverPath = optionalString(command, response, record.jdtlsHome, 'jdtlsHome');
  const javaExecutable = optionalString(command, response, record.javaExecutable, 'javaExecutable');
  const javaVersion = optionalString(command, response, record.javaVersion, 'javaVersion');
  const detail = optionalString(command, response, record.detail, 'detail');
  const workspaceRoot = optionalString(command, response, record.workspaceRoot, 'workspaceRoot');
  if (serverVersion) { status.serverVersion = serverVersion; status.providerVersion = serverVersion; }
  if (serverPath) status.serverPath = serverPath;
  if (javaExecutable) status.javaExecutable = javaExecutable;
  if (javaVersion) status.javaVersion = javaVersion;
  if (detail) status.lastError = detail;
  return { status, workspaceRoot };
}

function normalizeProgress(response: unknown): LanguageServiceProgress {
  const payload = requiredRecord(POLL_COMMAND, response);
  if (typeof payload.indexing === 'boolean') {
    const progress: LanguageServiceProgress = { indexing: payload.indexing };
    if (typeof payload.message === 'string' && payload.message) progress.message = payload.message;
    if (typeof payload.percentage === 'number' && Number.isFinite(payload.percentage) && payload.percentage >= 0 && payload.percentage <= 100) progress.percentage = payload.percentage;
    return progress;
  }
  const params = requiredRecord(POLL_COMMAND, payload.params);
  const value = requiredRecord(POLL_COMMAND, params.value);
  const kind = value.kind;
  if (kind !== 'begin' && kind !== 'report' && kind !== 'end') throw invalid(POLL_COMMAND, 'invalid progress kind', response);
  const progress: LanguageServiceProgress = { indexing: kind !== 'end' };
  const message = typeof value.message === 'string' && value.message ? value.message :
    typeof value.title === 'string' && value.title ? value.title : undefined;
  if (message) progress.message = message;
  if (typeof value.percentage === 'number' && Number.isFinite(value.percentage) && value.percentage >= 0 && value.percentage <= 100) progress.percentage = value.percentage;
  return progress;
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^\/[A-Za-z]:\//.test(normalized) ? normalized.slice(1) : normalized;
}

function identityFromUri(response: unknown, workspaceId: string, workspaceRoot: string | undefined, uri: unknown): Omit<VersionedLanguageDocument, 'version'> {
  const text = requiredString(POLL_COMMAND, response, uri, 'diagnostics URI');
  if (text.length > MAX_DIAGNOSTIC_URI_LENGTH) throw invalid(POLL_COMMAND, 'diagnostics URI is too long', response);
  if (!workspaceRoot) throw invalid(POLL_COMMAND, 'workspace root is unknown for diagnostics', response);
  let pathname: string;
  try {
    const url = new URL(text);
    if (url.protocol !== 'file:' || (url.hostname !== '' && url.hostname !== 'localhost')) throw new Error('not a local file URI');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw invalid(POLL_COMMAND, 'invalid diagnostics file URI', response);
  }
  const root = normalizePath(workspaceRoot);
  const absolute = normalizePath(pathname);
  const prefix = `${root}/`;
  if (!absolute.startsWith(prefix)) {
    throw invalid(POLL_COMMAND, 'diagnostics URI is outside the workspace', response);
  }
  const path = absolute.slice(prefix.length);
  if (!path || path.length > MAX_DOCUMENT_PATH_LENGTH || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw invalid(POLL_COMMAND, 'invalid diagnostics path', response);
  }
  return { workspaceId, path, uri: text };
}

function normalizePosition(response: unknown, value: unknown, field: string): { line: number; character: number } {
  const record = requiredRecord(POLL_COMMAND, value);
  return {
    line: integer(POLL_COMMAND, response, record.line, `${field}.line`),
    character: integer(POLL_COMMAND, response, record.character, `${field}.character`),
  };
}

function normalizeRange(response: unknown, value: unknown, field: string): LanguageDiagnostic['range'] {
  const record = requiredRecord(POLL_COMMAND, value);
  const start = normalizePosition(response, record.start, `${field}.start`);
  const end = normalizePosition(response, record.end, `${field}.end`);
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) {
    throw invalid(POLL_COMMAND, `invalid reversed ${field}`, response);
  }
  return { start, end };
}

function normalizeDiagnostic(
  response: unknown,
  value: unknown,
  workspaceId: string,
  workspaceRoot: string | undefined,
): LanguageDiagnostic {
  const record = requiredRecord(POLL_COMMAND, value);
  const severityMap = ['error', 'warning', 'information', 'hint'] as const;
  const severityNumber = integer(POLL_COMMAND, response, record.severity, 'diagnostic.severity');
  if (severityNumber < 1 || severityNumber > 4) throw invalid(POLL_COMMAND, 'invalid diagnostic severity', response);
  const diagnostic: LanguageDiagnostic = {
    range: normalizeRange(response, record.range, 'diagnostic.range'),
    severity: severityMap[severityNumber - 1],
    message: requiredString(POLL_COMMAND, response, record.message, 'diagnostic.message'),
  };
  if (diagnostic.message.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH) throw invalid(POLL_COMMAND, 'diagnostic message is too long', response);
  if (typeof record.code === 'string' || (typeof record.code === 'number' && Number.isSafeInteger(record.code))) diagnostic.code = record.code;
  if (typeof record.source === 'string' && record.source.length <= 256) diagnostic.source = record.source;
  if (record.relatedInformation !== undefined) {
    if (!Array.isArray(record.relatedInformation)) throw invalid(POLL_COMMAND, 'invalid diagnostic relatedInformation', response);
    diagnostic.relatedInformation = record.relatedInformation.slice(0, MAX_RELATED_INFORMATION).map((item) => {
      const related = requiredRecord(POLL_COMMAND, item);
      const location = requiredRecord(POLL_COMMAND, related.location);
      const message = requiredString(POLL_COMMAND, response, related.message, 'relatedInformation.message');
      if (message.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH) throw invalid(POLL_COMMAND, 'related information message is too long', response);
      return {
        message,
        location: {
          document: identityFromUri(response, workspaceId, workspaceRoot, location.uri),
          range: normalizeRange(response, location.range, 'relatedInformation.range'),
        },
      };
    });
  }
  return diagnostic;
}

function validJavaPath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= MAX_DOCUMENT_PATH_LENGTH
    && !path.startsWith('/') && !path.startsWith('\\') && !/^[A-Za-z]:/.test(path)
    && !/[\u0000-\u001f\u007f]/.test(path)
    && path.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..')
    && path.endsWith('.java');
}

function documentSyncError(command: string, error: unknown, sourceText: string | undefined): TauriAdapterError {
  const normalized = toTauriAdapterError(command, error);
  let message = normalized.message.replace(/^\[tauri:[^\]]+\]\s*/, '');
  if (sourceText) message = message.split(sourceText).join('[source redacted]');
  return new TauriAdapterError(command, message);
}

export class TauriLanguageSessionAdapter implements LanguageSessionPort, DocumentSyncPort {
  private readonly subscriptions = new Map<number, Subscription>();
  private readonly statuses = new Map<string, LanguageServiceStatus>();
  private readonly workspaceRoots = new Map<string, string>();
  private readonly documentVersions = new Map<string, number>();
  private readonly pollIntervalMs: number;
  private readonly hiddenPollIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly pollLimit: number;
  private nextSubscriptionId = 0;
  private sequence = 0;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;

  constructor(options: PollOptions = {}) {
    this.pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
    this.hiddenPollIntervalMs = Math.max(this.pollIntervalMs, options.hiddenPollIntervalMs ?? 1_000);
    this.maxBackoffMs = Math.max(this.pollIntervalMs, options.maxBackoffMs ?? 5_000);
    this.pollLimit = Math.min(100, Math.max(1, Math.floor(options.pollLimit ?? 100)));
  }

  private async lifecycle(command: string, workspaceId: string): Promise<LanguageServiceStatus> {
    try {
      const response = await invokeTauri<unknown>(command);
      const normalized = normalizeStatus(command, response, workspaceId);
      const previous = this.statuses.get(workspaceId);
      this.statuses.set(workspaceId, normalized.status);
      if (
        (previous && previous.generation !== normalized.status.generation) ||
        !['ready', 'indexing', 'degraded'].includes(normalized.status.state)
      ) this.clearDocumentVersions(workspaceId);
      if (normalized.workspaceRoot) this.workspaceRoots.set(workspaceId, normalized.workspaceRoot);
      return normalized.status;
    } catch (error) {
      throw toTauriAdapterError(command, error);
    }
  }

  getStatus(target: LanguageSessionTarget): Promise<LanguageServiceStatus> {
    return this.lifecycle('get_java_language_service_status', target.workspaceId);
  }

  start(request: StartLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return this.lifecycle('start_java_language_service', request.workspaceId);
  }

  stop(request: StopLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return this.lifecycle('stop_java_language_service', request.workspaceId);
  }

  restart(request: RestartLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return this.lifecycle('restart_java_language_service', request.workspaceId);
  }

  didOpen(request: DidOpenLanguageDocumentRequest): Promise<void> {
    return this.syncDocument('open_java_language_document', 'open', request.document);
  }

  didChange(request: DidChangeLanguageDocumentRequest): Promise<void> {
    return this.syncDocument('change_java_language_document', 'change', request.document);
  }

  didSave(request: DidSaveLanguageDocumentRequest): Promise<void> {
    return this.syncDocument('save_java_language_document', 'save', request.document);
  }

  didClose(request: DidCloseLanguageDocumentRequest): Promise<void> {
    return this.syncDocument('close_java_language_document', 'close', request.document);
  }

  private documentVersionKey(workspaceId: string, path: string): string {
    return `${workspaceId}\u0000${normalizePath(path)}`;
  }

  private clearDocumentVersions(workspaceId: string): void {
    for (const key of this.documentVersions.keys()) {
      if (key.startsWith(`${workspaceId}\u0000`)) this.documentVersions.delete(key);
    }
  }

  private async syncDocument(
    command: string,
    action: 'open' | 'change' | 'save' | 'close',
    document: DidOpenLanguageDocumentRequest['document'] | DidCloseLanguageDocumentRequest['document'],
  ): Promise<void> {
    const status = this.statuses.get(document.workspaceId);
    if (!status || !['ready', 'indexing', 'degraded'].includes(status.state) || !status.capabilities.documentSync) {
      throw new TauriAdapterError(command, 'Java document synchronization requires an initialized session');
    }
    if (!Number.isSafeInteger(document.version) || document.version < 0) {
      throw new TauriAdapterError(command, 'Document version must be a non-negative safe integer');
    }
    if (!validJavaPath(document.path)) throw new TauriAdapterError(command, 'Invalid workspace-relative Java document path');
    if (typeof document.uri !== 'string' || document.uri.length === 0 || document.uri.length > MAX_DIAGNOSTIC_URI_LENGTH) {
      throw new TauriAdapterError(command, 'Invalid Java document URI');
    }
    const fullDocument = action === 'close' ? undefined : document as DidOpenLanguageDocumentRequest['document'];
    if (fullDocument) {
      if (fullDocument.languageId !== 'java') throw new TauriAdapterError(command, 'Only the Java language is supported');
      if (typeof fullDocument.text !== 'string' || new TextEncoder().encode(fullDocument.text).length > MAX_DOCUMENT_BYTES) {
        throw new TauriAdapterError(command, 'Document exceeds the synchronization byte limit');
      }
    }
    const key = this.documentVersionKey(document.workspaceId, document.path);
    const currentVersion = this.documentVersions.get(key);
    if (action === 'open' && currentVersion !== undefined) throw new TauriAdapterError(command, 'Document is already open');
    if (action === 'change' && (currentVersion === undefined || document.version <= currentVersion)) {
      throw new TauriAdapterError(command, 'Document change version must be strictly increasing');
    }
    if ((action === 'save' || action === 'close') && (currentVersion === undefined || document.version !== currentVersion)) {
      throw new TauriAdapterError(command, `Document ${action} version must equal the current version`);
    }
    const nativeDocument: Record<string, unknown> = {
      workspaceId: document.workspaceId,
      generation: status.generation,
      path: document.path,
      uri: document.uri,
      version: document.version,
    };
    if (fullDocument) {
      nativeDocument.languageId = fullDocument.languageId;
      nativeDocument.text = fullDocument.text;
    }
    // A close becomes authoritative before native I/O completes so a concurrently
    // polled unversioned notification cannot be associated with a closing document.
    if (action === 'close') this.documentVersions.delete(key);
    try {
      await invokeTauri<void>(command, { document: nativeDocument });
    } catch (error) {
      throw documentSyncError(command, error, fullDocument?.text);
    }
    const currentStatus = this.statuses.get(document.workspaceId);
    if (
      action !== 'close' &&
      currentStatus?.generation === status.generation &&
      ['ready', 'indexing', 'degraded'].includes(currentStatus.state)
    ) this.documentVersions.set(key, document.version);
  }

  subscribe(workspaceId: string, listener: LanguageServiceEventListener): LanguageServiceUnsubscribe {
    const id = ++this.nextSubscriptionId;
    const subscription: Subscription = { workspaceId, listener, active: true };
    this.subscriptions.set(id, subscription);
    if (this.subscriptions.size === 1) this.schedule(0);
    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      this.subscriptions.delete(id);
      if (this.subscriptions.size === 0 && this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  private schedule(delay: number): void {
    if (this.subscriptions.size === 0 || this.timer !== undefined || this.polling) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, delay);
  }

  private nextDelay(): number {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const base = hidden ? this.hiddenPollIntervalMs : this.pollIntervalMs;
    return Math.min(this.maxBackoffMs, base * (2 ** Math.min(this.failures, 5)));
  }

  private emit(workspaceId: string, event: LanguageServiceEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active || subscription.workspaceId !== workspaceId) continue;
      try { subscription.listener(event); } catch { /* A listener cannot terminate polling. */ }
    }
  }

  private surfaceError(error: unknown): void {
    const adapterError = toTauriAdapterError(POLL_COMMAND, error);
    const workspaceIds = new Set(Array.from(this.subscriptions.values(), (item) => item.workspaceId));
    for (const workspaceId of workspaceIds) {
      const cached = this.statuses.get(workspaceId);
      const status: LanguageServiceStatus = cached ? {
        ...cached,
        state: cached.state === 'ready' ? 'degraded' : cached.state,
        lastError: adapterError.message,
        checkedAt: new Date().toISOString(),
      } : {
        state: 'failed', provider: 'jdt-ls', workspaceId, generation: 0,
        capabilities: { ...EMPTY_CAPABILITIES }, lastError: adapterError.message,
        checkedAt: new Date().toISOString(),
      };
      this.emit(workspaceId, { type: 'status', status });
    }
  }

  private parseBatch(response: unknown): { events: NativeEvent[]; latestSequence: number } {
    const batch = requiredRecord(POLL_COMMAND, response);
    if (!Array.isArray(batch.events)) throw invalid(POLL_COMMAND, 'invalid events array', response);
    const latestSequence = integer(POLL_COMMAND, response, batch.latestSequence, 'latestSequence');
    const events = batch.events.map((value): NativeEvent => {
      const event = requiredRecord(POLL_COMMAND, value);
      return {
        sequence: integer(POLL_COMMAND, response, event.sequence, 'event.sequence'),
        generation: integer(POLL_COMMAND, response, event.generation, 'event.generation'),
        kind: requiredString(POLL_COMMAND, response, event.kind, 'event.kind'),
        payload: event.payload,
      };
    });
    return { events, latestSequence };
  }

  private workspaceForEvent(generation: number): string | undefined {
    for (const [workspaceId, status] of this.statuses) {
      if (status.generation === generation) return workspaceId;
    }
    const workspaceIds = new Set(Array.from(this.subscriptions.values(), (item) => item.workspaceId));
    return workspaceIds.size === 1 ? workspaceIds.values().next().value : undefined;
  }

  private normalizeEvent(nativeEvent: NativeEvent): { workspaceId: string; event: LanguageServiceEvent } | undefined {
    const workspaceId = this.workspaceForEvent(nativeEvent.generation);
    if (!workspaceId) throw invalid(POLL_COMMAND, 'event workspace is ambiguous', nativeEvent);
    const cached = this.statuses.get(workspaceId);
    if (cached && nativeEvent.generation < cached.generation) return undefined;
    const provider = cached?.provider ?? 'jdt-ls';

    if (nativeEvent.kind === 'status') {
      const payload = requiredRecord(POLL_COMMAND, nativeEvent.payload);
      const available = cached?.state !== 'unavailable';
      const state = lifecycleState(POLL_COMMAND, nativeEvent.payload, payload.lifecycle, available);
      const status: LanguageServiceStatus = {
        ...(cached ?? {
          provider, workspaceId, capabilities: { ...EMPTY_CAPABILITIES }, checkedAt: new Date().toISOString(),
        }),
        state,
        generation: nativeEvent.generation,
        checkedAt: new Date().toISOString(),
      };
      status.capabilities = normalizeCapabilities(POLL_COMMAND, nativeEvent.payload, payload.capabilities, state === 'ready' || state === 'indexing' || state === 'degraded');
      const detail = optionalString(POLL_COMMAND, nativeEvent.payload, payload.detail, 'detail');
      if (detail) status.lastError = detail;
      else if (state !== 'failed') delete status.lastError;
      if (
        cached?.generation !== status.generation ||
        !['ready', 'indexing', 'degraded'].includes(status.state)
      ) this.clearDocumentVersions(workspaceId);
      this.statuses.set(workspaceId, status);
      return { workspaceId, event: { type: 'status', status } };
    }
    if (nativeEvent.kind === 'progress') {
      return { workspaceId, event: { type: 'progress', workspaceId, generation: nativeEvent.generation, provider, progress: normalizeProgress(nativeEvent.payload) } };
    }
    if (nativeEvent.kind === 'diagnostics') {
      const payload = requiredRecord(POLL_COMMAND, nativeEvent.payload);
      const params = requiredRecord(POLL_COMMAND, payload.params);
      if (cached === undefined || nativeEvent.generation !== cached.generation) return undefined;
      if (payload.workspaceId !== workspaceId || payload.generation !== nativeEvent.generation) {
        throw invalid(POLL_COMMAND, 'diagnostics workspace or generation mismatch', nativeEvent.payload);
      }
      if (!Array.isArray(params.diagnostics)) throw invalid(POLL_COMMAND, 'invalid diagnostics array', nativeEvent.payload);
      // Resolve and authorize the URI before consulting synchronization state.
      const identity = identityFromUri(nativeEvent.payload, workspaceId, this.workspaceRoots.get(workspaceId), params.uri);
      let version: number;
      if (params.version === undefined) {
        // JDT LS can omit version despite advertising versionSupport. Such an event
        // carries no ordering evidence, so receipt associates it only with the exact
        // workspace/path version that is synchronized at this instant.
        const synchronizedVersion = this.documentVersions.get(this.documentVersionKey(workspaceId, identity.path));
        if (synchronizedVersion === undefined) return undefined;
        version = synchronizedVersion;
      } else {
        version = integer(POLL_COMMAND, nativeEvent.payload, params.version, 'diagnostics.params.version');
      }
      const document: VersionedLanguageDocument = { ...identity, version };
      const diagnostics = params.diagnostics.slice(0, MAX_DIAGNOSTICS).map((item) => normalizeDiagnostic(
        nativeEvent.payload,
        item,
        workspaceId,
        this.workspaceRoots.get(workspaceId),
      ));
      return { workspaceId, event: { type: 'diagnostics', workspaceId, generation: nativeEvent.generation, provider, document, diagnostics } };
    }
    return undefined;
  }

  private async poll(): Promise<void> {
    if (this.polling || this.subscriptions.size === 0) return;
    this.polling = true;
    try {
      const response = await invokeTauri<unknown>(POLL_COMMAND, { afterSequence: this.sequence, limit: this.pollLimit });
      const batch = this.parseBatch(response);
      let last = this.sequence;
      for (const nativeEvent of batch.events) {
        if (nativeEvent.sequence <= last) continue;
        last = nativeEvent.sequence;
        try {
          const normalized = this.normalizeEvent(nativeEvent);
          if (normalized) this.emit(normalized.workspaceId, normalized.event);
        } catch (error) {
          this.surfaceError(error);
        }
      }
      this.sequence = last === this.sequence && batch.events.length === 0
        ? Math.max(this.sequence, batch.latestSequence)
        : last;
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      this.surfaceError(error);
    } finally {
      this.polling = false;
      this.schedule(this.nextDelay());
    }
  }
}
