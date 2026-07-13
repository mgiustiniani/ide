import { invoke } from '@tauri-apps/api/core';
import type {
  JavaCompletionItem,
  JavaCompletionItemKind,
  JavaCompletionRequest,
  JavaCompletionResponse,
  JavaCompletionResult,
  JavaHoverRequest,
  JavaHoverResponse,
  JavaHoverResult,
  JavaSemanticContent,
  JavaSemanticErrorKind,
  JavaSemanticRequest,
  JavaSignatureHelpRequest,
  JavaSignatureHelpResponse,
  JavaSignatureHelpResult,
  JavaSignatureInformation,
  JavaSignatureParameter,
  JavaTextEdit,
  JavaWorkspaceTextEdit,
  LanguageRange,
  LanguageServiceCancellationId,
} from '@ide/contracts';
import type { JavaIntelligencePort } from '@ide/web-core/ports';

import { TauriAdapterError } from './errors';

const MAX_PATH_LENGTH = 4_096;
const MAX_URI_LENGTH = 4_096;
const MAX_ID_BYTES = 256;
const MAX_WORKSPACE_ID_LENGTH = 256;
const MAX_PROVIDER_VERSION_LENGTH = 256;
const MAX_RESPONSE_BYTES = 256 * 1_024;
const MAX_ITEMS = 200;
const MAX_ADDITIONAL_EDITS = 16;
const MAX_COMMIT_CHARACTERS = 16;
const MAX_HOVER_CONTENTS = 8;
const MAX_SIGNATURES = 32;
const MAX_PARAMETERS = 64;
const MAX_STRING_LENGTH = 8_192;
const MAX_LABEL_LENGTH = 1_024;
const MAX_LINE = 100_000;
const MAX_CHARACTER = 1_000_000;

const COMPLETION_KINDS = new Set<JavaCompletionItemKind>([
  'text', 'method', 'function', 'constructor', 'field', 'variable', 'class',
  'interface', 'module', 'property', 'unit', 'value', 'enum', 'keyword',
  'snippet', 'color', 'file', 'reference', 'folder', 'enum-member', 'constant',
  'struct', 'event', 'operator', 'type-parameter', 'unknown',
]);
const ERROR_KINDS = new Set<JavaSemanticErrorKind>([
  'cancelled', 'timeout', 'unavailable', 'stale-version', 'provider-error',
  'malformed-result',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejected(command: string): TauriAdapterError {
  return new TauriAdapterError(command, 'Native Java semantic response was rejected');
}

function invalidRequest(command: string, message: string): TauriAdapterError {
  return new TauriAdapterError(command, message);
}

function record(command: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw rejected(command);
  return value;
}

function safeInteger(command: string, value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw rejected(command);
  }
  return value as number;
}

function boundedString(command: string, value: unknown, max: number, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max) {
    throw rejected(command);
  }
  return value;
}

function optionalBoundedString(command: string, value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(command, value, max);
}

function validJavaPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= MAX_PATH_LENGTH
    && !path.startsWith('/') && !path.startsWith('\\') && !/^[A-Za-z]:/.test(path)
    && !path.includes('\\') && !/[\u0000-\u001f\u007f]/.test(path)
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
    && path.endsWith('.java');
}

function validDocumentUri(uri: unknown, path: string): uri is string {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_URI_LENGTH || /[\u0000-\u001f\u007f]/.test(uri)) {
    return false;
  }
  try {
    const rawSegments = uri.split('/');
    if (rawSegments.some((segment) => {
      const decodedSegment = decodeURIComponent(segment);
      return decodedSegment === '.' || decodedSegment === '..'
        || decodedSegment.includes('/') || decodedSegment.includes('\\');
    })) return false;
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:' || parsed.hostname !== '' || parsed.search || parsed.hash) return false;
    const decoded = decodeURIComponent(parsed.pathname);
    if (decoded.includes('\\') || decoded.split('/').some((part) => part === '.' || part === '..')) return false;
    return decoded.endsWith(`/${path}`);
  } catch {
    return false;
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && new TextEncoder().encode(value).length <= MAX_ID_BYTES
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validateRequest(command: string, request: JavaSemanticRequest, completion: boolean): JavaSemanticRequest {
  if (!isRecord(request)) throw invalidRequest(command, 'Invalid Java semantic request');
  if (typeof request.workspaceId !== 'string' || request.workspaceId.length === 0
    || new TextEncoder().encode(request.workspaceId).length > MAX_WORKSPACE_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(request.workspaceId)) {
    throw invalidRequest(command, 'Invalid Java semantic workspace');
  }
  if (!Number.isSafeInteger(request.generation) || request.generation < 0) {
    throw invalidRequest(command, 'Invalid Java semantic generation');
  }
  if (!isRecord(request.document) || !validJavaPath(request.document.path)
    || !validDocumentUri(request.document.uri, request.document.path)
    || !Number.isSafeInteger(request.document.version) || request.document.version < 0) {
    throw invalidRequest(command, 'Invalid Java semantic document target');
  }
  if (!isRecord(request.position) || !Number.isSafeInteger(request.position.line)
    || request.position.line < 0 || request.position.line > MAX_LINE
    || !Number.isSafeInteger(request.position.character) || request.position.character < 0
    || request.position.character > MAX_CHARACTER) {
    throw invalidRequest(command, 'Invalid Java semantic UTF-16 position');
  }
  if (!validId(request.requestId) || !validId(request.cancellationId)) {
    throw invalidRequest(command, 'Invalid Java semantic correlation ID');
  }
  const trigger = (request as JavaCompletionRequest).trigger;
  if (!completion && trigger !== undefined) throw invalidRequest(command, 'Invalid Java semantic trigger context');
  if (completion && trigger !== undefined) {
    if (!isRecord(trigger) || !['invoked', 'trigger-character', 'incomplete-completions'].includes(String(trigger.kind))) {
      throw invalidRequest(command, 'Invalid Java completion trigger context');
    }
    if (trigger.kind === 'trigger-character') {
      if (typeof trigger.character !== 'string' || [...trigger.character].length !== 1
        || new TextEncoder().encode(trigger.character).length > 4 || /[\u0000-\u001f\u007f]/.test(trigger.character)) {
        throw invalidRequest(command, 'Invalid Java completion trigger context');
      }
    } else if (trigger.character !== undefined) {
      throw invalidRequest(command, 'Invalid Java completion trigger context');
    }
  }
  return request;
}

function nativeRequest(request: JavaSemanticRequest, completion: boolean): Record<string, unknown> {
  const value: Record<string, unknown> = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    document: { path: request.document.path, uri: request.document.uri, version: request.document.version },
    position: { line: request.position.line, character: request.position.character },
    requestId: request.requestId,
    cancellationId: request.cancellationId,
  };
  if (completion && (request as JavaCompletionRequest).trigger !== undefined) {
    const trigger = (request as JavaCompletionRequest).trigger!;
    value.trigger = trigger.character === undefined
      ? { kind: trigger.kind }
      : { kind: trigger.kind, character: trigger.character };
  }
  return value;
}

function normalizePosition(command: string, value: unknown): { line: number; character: number } {
  const position = record(command, value);
  return {
    line: safeInteger(command, position.line, MAX_LINE),
    character: safeInteger(command, position.character, MAX_CHARACTER),
  };
}

function normalizeRange(command: string, value: unknown): LanguageRange {
  const range = record(command, value);
  const start = normalizePosition(command, range.start);
  const end = normalizePosition(command, range.end);
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) throw rejected(command);
  return { start, end };
}

function normalizeContent(command: string, value: unknown): JavaSemanticContent {
  const content = record(command, value);
  if (content.format !== 'plaintext' && content.format !== 'markdown') throw rejected(command);
  return { format: content.format, value: boundedString(command, content.value, MAX_STRING_LENGTH) };
}

function normalizeTextEdit(command: string, value: unknown): JavaTextEdit {
  const edit = record(command, value);
  if (Object.keys(edit).some((key) => key !== 'range' && key !== 'newText')) throw rejected(command);
  return {
    range: normalizeRange(command, edit.range),
    newText: boundedString(command, edit.newText, MAX_STRING_LENGTH),
  };
}

function normalizeAdditionalEdit(command: string, value: unknown, request: JavaSemanticRequest): JavaWorkspaceTextEdit {
  const additional = record(command, value);
  const document = record(command, additional.document);
  const workspaceId = boundedString(command, document.workspaceId, MAX_WORKSPACE_ID_LENGTH, false);
  const path = document.path;
  const uri = document.uri;
  const version = safeInteger(command, document.version);
  if (!validJavaPath(path) || !validDocumentUri(uri, path)
    || workspaceId !== request.workspaceId || path !== request.document.path
    || uri !== request.document.uri || version !== request.document.version) throw rejected(command);
  return { document: { workspaceId, path, uri, version }, edit: normalizeTextEdit(command, additional.edit) };
}

function normalizeCompletionItem(command: string, value: unknown, request: JavaSemanticRequest): JavaCompletionItem {
  const native = record(command, value);
  const label = boundedString(command, native.label, MAX_LABEL_LENGTH, false);
  if (typeof native.kind !== 'string' || !COMPLETION_KINDS.has(native.kind as JavaCompletionItemKind)) throw rejected(command);
  const item: JavaCompletionItem = { label, kind: native.kind as JavaCompletionItemKind };
  const detail = optionalBoundedString(command, native.detail, MAX_STRING_LENGTH);
  const sortText = optionalBoundedString(command, native.sortText, MAX_LABEL_LENGTH);
  const filterText = optionalBoundedString(command, native.filterText, MAX_LABEL_LENGTH);
  const insertText = optionalBoundedString(command, native.insertText, MAX_STRING_LENGTH);
  if (detail !== undefined) item.detail = detail;
  if (sortText !== undefined) item.sortText = sortText;
  if (filterText !== undefined) item.filterText = filterText;
  if (insertText !== undefined) item.insertText = insertText;
  if (native.documentation !== undefined) item.documentation = normalizeContent(command, native.documentation);
  if (native.textEdit !== undefined) item.textEdit = normalizeTextEdit(command, native.textEdit);
  if (native.additionalTextEdits !== undefined) {
    if (!Array.isArray(native.additionalTextEdits) || native.additionalTextEdits.length > MAX_ADDITIONAL_EDITS) throw rejected(command);
    item.additionalTextEdits = native.additionalTextEdits.map((edit) => normalizeAdditionalEdit(command, edit, request));
  }
  if (native.commitCharacters !== undefined) {
    if (!Array.isArray(native.commitCharacters) || native.commitCharacters.length > MAX_COMMIT_CHARACTERS) throw rejected(command);
    item.commitCharacters = native.commitCharacters.map((character) => {
      if (typeof character !== 'string' || [...character].length !== 1 || /[\u0000-\u001f\u007f]/.test(character)) throw rejected(command);
      return character;
    });
  }
  for (const field of ['deprecated', 'preselect'] as const) {
    if (native[field] !== undefined) {
      if (typeof native[field] !== 'boolean') throw rejected(command);
      item[field] = native[field];
    }
  }
  return item;
}

function metadata(command: string, response: Record<string, unknown>, request: JavaSemanticRequest) {
  const provider = response.provider;
  if (provider !== 'jdtls' && provider !== 'jdt-ls') throw rejected(command);
  const providerVersion = response.providerVersion === null
    ? null
    : boundedString(command, response.providerVersion, MAX_PROVIDER_VERSION_LENGTH, false);
  const workspaceId = boundedString(command, response.workspaceId, MAX_WORKSPACE_ID_LENGTH, false);
  const generation = safeInteger(command, response.generation);
  const path = response.path;
  const uri = response.uri;
  const version = safeInteger(command, response.version);
  const requestId = boundedString(command, response.requestId, MAX_ID_BYTES, false);
  if (!validJavaPath(path) || !validDocumentUri(uri, path)
    || workspaceId !== request.workspaceId || generation !== request.generation
    || path !== request.document.path || uri !== request.document.uri
    || version !== request.document.version || requestId !== request.requestId) throw rejected(command);
  return {
    provider: 'jdt-ls', providerVersion, workspaceId, generation,
    document: { path, uri, version },
  };
}

function normalizeFailure(command: string, native: Record<string, unknown>, request: JavaSemanticRequest) {
  if (typeof native.cancelled !== 'boolean' || typeof native.timeout !== 'boolean') throw rejected(command);
  const nativeError = native.error === null ? undefined : record(command, native.error);
  let kind: JavaSemanticErrorKind;
  if (native.cancelled) kind = 'cancelled';
  else if (native.timeout) kind = 'timeout';
  else {
    if (!nativeError || typeof nativeError.kind !== 'string' || !ERROR_KINDS.has(nativeError.kind as JavaSemanticErrorKind)) throw rejected(command);
    kind = nativeError.kind as JavaSemanticErrorKind;
  }
  if (native.cancelled && native.timeout) throw rejected(command);
  if (nativeError?.kind !== undefined && nativeError.kind !== kind) throw rejected(command);
  if (native.result !== null) throw rejected(command);
  const summary: Record<JavaSemanticErrorKind, string> = {
    cancelled: 'Java semantic request was cancelled',
    timeout: 'Java semantic request timed out',
    unavailable: 'Java semantic provider is unavailable',
    'stale-version': 'Java semantic document version is stale',
    'provider-error': 'Java semantic provider returned an error',
    'malformed-result': 'Java semantic provider returned an invalid result',
  };
  const error: { kind: JavaSemanticErrorKind; summary: string; providerCode?: string | number; retryable?: boolean } = { kind, summary: summary[kind] };
  if (nativeError) {
    if (typeof nativeError.retryable !== 'boolean') throw rejected(command);
    error.retryable = nativeError.retryable;
    const code = nativeError.providerCode;
    if (code !== undefined && code !== null) {
      if (typeof code === 'number' && Number.isSafeInteger(code)) error.providerCode = code;
      else if (typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(code)) error.providerCode = code;
      else throw rejected(command);
    }
  }
  return { ok: false as const, requestId: request.requestId, error };
}

function normalizeCompletionResult(command: string, value: unknown, request: JavaSemanticRequest, meta: ReturnType<typeof metadata>): JavaCompletionResult {
  const native = record(command, value);
  if (!Array.isArray(native.items) || native.items.length > MAX_ITEMS || typeof native.isIncomplete !== 'boolean') throw rejected(command);
  return { ...meta, items: native.items.map((item) => normalizeCompletionItem(command, item, request)), isIncomplete: native.isIncomplete };
}

function normalizeHoverResult(command: string, value: unknown, meta: ReturnType<typeof metadata>): JavaHoverResult {
  const native = record(command, value);
  if (!Array.isArray(native.contents) || native.contents.length > MAX_HOVER_CONTENTS || typeof native.isTruncated !== 'boolean') throw rejected(command);
  const result: JavaHoverResult = { ...meta, contents: native.contents.map((item) => normalizeContent(command, item)), isTruncated: native.isTruncated };
  if (native.range !== undefined) result.range = normalizeRange(command, native.range);
  return result;
}

function normalizeParameter(command: string, value: unknown, signatureLabel: string): JavaSignatureParameter {
  const native = record(command, value);
  let label: JavaSignatureParameter['label'];
  if (typeof native.label === 'string') label = boundedString(command, native.label, MAX_LABEL_LENGTH);
  else {
    const offsets = record(command, native.label);
    const start = safeInteger(command, offsets.start, signatureLabel.length * 2);
    const end = safeInteger(command, offsets.end, signatureLabel.length * 2);
    if (start > end || end > [...signatureLabel].reduce((count, character) => count + character.length, 0)) throw rejected(command);
    label = { start, end };
  }
  const parameter: JavaSignatureParameter = { label };
  if (native.documentation !== undefined) parameter.documentation = normalizeContent(command, native.documentation);
  return parameter;
}

function normalizeSignature(command: string, value: unknown): JavaSignatureInformation {
  const native = record(command, value);
  const label = boundedString(command, native.label, MAX_LABEL_LENGTH);
  if (!Array.isArray(native.parameters) || native.parameters.length > MAX_PARAMETERS) throw rejected(command);
  const parameters = native.parameters.map((parameter) => normalizeParameter(command, parameter, label));
  const signature: JavaSignatureInformation = { label, parameters };
  if (native.documentation !== undefined) signature.documentation = normalizeContent(command, native.documentation);
  if (native.activeParameter !== undefined) {
    const active = safeInteger(command, native.activeParameter);
    if (active >= parameters.length) throw rejected(command);
    signature.activeParameter = active;
  }
  return signature;
}

function normalizeSignatureResult(command: string, value: unknown, meta: ReturnType<typeof metadata>): JavaSignatureHelpResult {
  const native = record(command, value);
  if (!Array.isArray(native.signatures) || native.signatures.length > MAX_SIGNATURES || typeof native.isTruncated !== 'boolean') throw rejected(command);
  const signatures = native.signatures.map((signature) => normalizeSignature(command, signature));
  const result: JavaSignatureHelpResult = { ...meta, signatures, isTruncated: native.isTruncated };
  if (native.activeSignature !== undefined) {
    const active = safeInteger(command, native.activeSignature);
    if (active >= signatures.length) throw rejected(command);
    result.activeSignature = active;
  }
  if (native.activeParameter !== undefined) {
    const active = safeInteger(command, native.activeParameter);
    const signature = signatures[result.activeSignature ?? 0];
    if (!signature || active >= signature.parameters.length) throw rejected(command);
    result.activeParameter = active;
  }
  return result;
}

type SemanticKind = 'completion' | 'hover' | 'signature';

export class TauriJavaIntelligenceAdapter implements JavaIntelligencePort {
  private async request<T extends JavaCompletionResponse | JavaHoverResponse | JavaSignatureHelpResponse>(
    command: string,
    request: JavaSemanticRequest,
    kind: SemanticKind,
  ): Promise<T> {
    validateRequest(command, request, kind === 'completion');
    let response: unknown;
    try {
      response = await invoke<unknown>(command, { request: nativeRequest(request, kind === 'completion') });
    } catch {
      return {
        ok: false,
        requestId: request.requestId,
        error: { kind: 'unavailable', summary: 'Java semantic provider is unavailable', retryable: true },
      } as T;
    }
    let encoded: string;
    try {
      encoded = JSON.stringify(response);
    } catch {
      throw rejected(command);
    }
    if (new TextEncoder().encode(encoded).length > MAX_RESPONSE_BYTES) throw rejected(command);
    const native = record(command, response);
    const meta = metadata(command, native, request);
    if (typeof native.cancelled !== 'boolean' || typeof native.timeout !== 'boolean') throw rejected(command);
    if (native.cancelled || native.timeout || native.error !== null) return normalizeFailure(command, native, request) as T;
    if (native.result === null || native.result === undefined) throw rejected(command);
    const result = kind === 'completion'
      ? normalizeCompletionResult(command, native.result, request, meta)
      : kind === 'hover'
        ? normalizeHoverResult(command, native.result, meta)
        : normalizeSignatureResult(command, native.result, meta);
    return { ok: true, requestId: request.requestId, result } as T;
  }

  completion(request: JavaCompletionRequest): Promise<JavaCompletionResponse> {
    return this.request('request_java_completion', request, 'completion');
  }

  hover(request: JavaHoverRequest): Promise<JavaHoverResponse> {
    return this.request('request_java_hover', request, 'hover');
  }

  signatureHelp(request: JavaSignatureHelpRequest): Promise<JavaSignatureHelpResponse> {
    return this.request('request_java_signature_help', request, 'signature');
  }

  async cancel(cancellationId: LanguageServiceCancellationId): Promise<void> {
    const command = 'cancel_java_semantic_request';
    if (!validId(cancellationId)) throw invalidRequest(command, 'Invalid Java semantic cancellation ID');
    try {
      await invoke<void>(command, { cancellationId });
    } catch {
      // Cancellation is idempotent and best-effort. Native details are intentionally discarded.
    }
  }
}
