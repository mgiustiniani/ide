import { invoke } from "@tauri-apps/api/core";
import type {
  JavaCompletionItem,
  JavaCompletionItemKind,
  JavaCompletionRequest,
  JavaCompletionResponse,
  JavaFormattingRequest,
  JavaFormattingResponse,
  JavaFormattingResult,
  JavaRangeFormattingRequest,
  JavaOnTypeFormattingRequest,
  JavaRangeFormattingResponse,
  JavaCompletionResult,
  JavaCodeAction,
  JavaCodeActionGenerationKind,
  JavaCodeActionMember,
  JavaCodeActionMemberGroup,
  JavaCodeActionMemberSelection,
  JavaCodeActionGenerationSelection,
  JavaCodeActionsRequest,
  JavaCodeActionsResponse,
  JavaCodeActionsResult,
  JavaRenameRequest,
  JavaRenameResponse,
  JavaRenameResult,
  JavaDocumentSymbol,
  JavaDocumentSymbolKind,
  JavaDocumentSymbolsRequest,
  JavaDocumentSymbolsResponse,
  JavaDocumentHighlightsRequest,
  JavaDocumentHighlightsResponse,
  JavaDocumentHighlightsResult,
  JavaDefinitionsRequest,
  JavaDefinitionsResponse,
  JavaDefinitionsResult,
  JavaImplementationsRequest,
  JavaImplementationsResponse,
  JavaImplementationsResult,
  JavaCallHierarchyRequest,
  JavaCallHierarchyResponse,
  JavaCallHierarchyResult,
  JavaReferencesRequest,
  JavaReferencesResponse,
  JavaReferencesResult,
  JavaSemanticTokensRequest,
  JavaSemanticTokensResponse,
  JavaSemanticTokensResult,
  JavaInlayHintsRequest,
  JavaInlayHintsResponse,
  JavaInlayHintsResult,
  JavaDocumentSymbolsResult,
  JavaWorkspaceSymbol,
  JavaWorkspaceSymbolsRequest,
  JavaWorkspaceSymbolsResponse,
  JavaWorkspaceSymbolsResult,
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
} from "@ide/contracts";
import type { JavaIntelligencePort } from "@ide/web-core/ports";

import { TauriAdapterError } from "./errors";

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
const MAX_DOCUMENT_SYMBOLS = 1_000;
const MAX_DOCUMENT_SYMBOL_DEPTH = 32;
const MAX_DOCUMENT_HIGHLIGHTS = 512;
const MAX_SEMANTIC_TOKENS = 20_000;
const MAX_INLAY_HINTS = 512;
const MAX_WORKSPACE_SYMBOLS = 100;
const MAX_IMPLEMENTATIONS = 100;
const MAX_CALL_HIERARCHY_ITEMS = 100;
const MAX_CALL_HIERARCHY_SITES = 32;
const MAX_WORKSPACE_SYMBOL_QUERY_LENGTH = 256;
const MAX_CODE_ACTIONS = 50;
const MAX_CODE_ACTION_EDITS = 64;
const MAX_CODE_ACTION_DIAGNOSTICS = 100;
const MAX_GENERATOR_MEMBERS = 64;
const MAX_DELEGATE_METHODS = 128;
const MAX_GENERATOR_BINDING_KEY_BYTES = 4_096;
const MAX_FORMATTING_EDITS = 2_048;
const MAX_RENAME_DOCUMENTS = 128;
const MAX_RENAME_EDITS = 4_096;
const MAX_PARAMETERS = 64;
const MAX_STRING_LENGTH = 8_192;
const MAX_LABEL_LENGTH = 1_024;
const MAX_LINE = 100_000;
const MAX_CHARACTER = 1_000_000;

const COMPLETION_KINDS = new Set<JavaCompletionItemKind>([
  "text",
  "method",
  "function",
  "constructor",
  "field",
  "variable",
  "class",
  "interface",
  "module",
  "property",
  "unit",
  "value",
  "enum",
  "keyword",
  "snippet",
  "color",
  "file",
  "reference",
  "folder",
  "enum-member",
  "constant",
  "struct",
  "event",
  "operator",
  "type-parameter",
  "unknown",
]);
const ERROR_KINDS = new Set<JavaSemanticErrorKind>([
  "cancelled",
  "timeout",
  "unavailable",
  "stale-version",
  "provider-error",
  "malformed-result",
]);
const DOCUMENT_SYMBOL_KINDS = new Set<JavaDocumentSymbolKind>([
  "file",
  "module",
  "namespace",
  "package",
  "class",
  "method",
  "property",
  "field",
  "constructor",
  "enum",
  "interface",
  "function",
  "variable",
  "constant",
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "key",
  "null",
  "enum-member",
  "struct",
  "event",
  "operator",
  "type-parameter",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejected(command: string): TauriAdapterError {
  return new TauriAdapterError(command, "Native Java semantic response was rejected");
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
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > max) {
    throw rejected(command);
  }
  return value;
}

function optionalBoundedString(command: string, value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(command, value, max);
}

function validJavaPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
    path.endsWith(".java")
  );
}

function validDocumentUri(uri: unknown, path: string): uri is string {
  if (
    typeof uri !== "string" ||
    uri.length === 0 ||
    uri.length > MAX_URI_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(uri)
  ) {
    return false;
  }
  try {
    const rawSegments = uri.split("/");
    if (
      rawSegments.some((segment) => {
        const decodedSegment = decodeURIComponent(segment);
        return (
          decodedSegment === "." ||
          decodedSegment === ".." ||
          decodedSegment.includes("/") ||
          decodedSegment.includes("\\")
        );
      })
    )
      return false;
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:" || parsed.hostname !== "" || parsed.search || parsed.hash)
      return false;
    const decoded = decodeURIComponent(parsed.pathname);
    if (decoded.includes("\\") || decoded.split("/").some((part) => part === "." || part === ".."))
      return false;
    return decoded.endsWith(`/${path}`);
  } catch {
    return false;
  }
}

function documentUriWorkspaceRoot(uri: string, path: string): string | undefined {
  try {
    const decoded = decodeURIComponent(new URL(uri).pathname);
    const suffix = `/${path}`;
    return decoded.endsWith(suffix) ? decoded.slice(0, -suffix.length) : undefined;
  } catch {
    return undefined;
  }
}

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= MAX_ID_BYTES &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validateRequest(
  command: string,
  request: JavaSemanticRequest,
  completion: boolean,
): JavaSemanticRequest {
  if (!isRecord(request)) throw invalidRequest(command, "Invalid Java semantic request");
  if (
    typeof request.workspaceId !== "string" ||
    request.workspaceId.length === 0 ||
    new TextEncoder().encode(request.workspaceId).length > MAX_WORKSPACE_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(request.workspaceId)
  ) {
    throw invalidRequest(command, "Invalid Java semantic workspace");
  }
  if (!Number.isSafeInteger(request.generation) || request.generation < 0) {
    throw invalidRequest(command, "Invalid Java semantic generation");
  }
  if (
    !isRecord(request.document) ||
    !validJavaPath(request.document.path) ||
    !validDocumentUri(request.document.uri, request.document.path) ||
    !Number.isSafeInteger(request.document.version) ||
    request.document.version < 0
  ) {
    throw invalidRequest(command, "Invalid Java semantic document target");
  }
  if (
    !isRecord(request.position) ||
    !Number.isSafeInteger(request.position.line) ||
    request.position.line < 0 ||
    request.position.line > MAX_LINE ||
    !Number.isSafeInteger(request.position.character) ||
    request.position.character < 0 ||
    request.position.character > MAX_CHARACTER
  ) {
    throw invalidRequest(command, "Invalid Java semantic UTF-16 position");
  }
  if (!validId(request.requestId) || !validId(request.cancellationId)) {
    throw invalidRequest(command, "Invalid Java semantic correlation ID");
  }
  const trigger = (request as JavaCompletionRequest).trigger;
  if (!completion && trigger !== undefined)
    throw invalidRequest(command, "Invalid Java semantic trigger context");
  if (completion && trigger !== undefined) {
    if (
      !isRecord(trigger) ||
      !["invoked", "trigger-character", "incomplete-completions"].includes(String(trigger.kind))
    ) {
      throw invalidRequest(command, "Invalid Java completion trigger context");
    }
    if (trigger.kind === "trigger-character") {
      if (
        typeof trigger.character !== "string" ||
        [...trigger.character].length !== 1 ||
        new TextEncoder().encode(trigger.character).length > 4 ||
        /[\u0000-\u001f\u007f]/.test(trigger.character)
      ) {
        throw invalidRequest(command, "Invalid Java completion trigger context");
      }
    } else if (trigger.character !== undefined) {
      throw invalidRequest(command, "Invalid Java completion trigger context");
    }
  }
  return request;
}

function nativeRequest(
  request: JavaSemanticRequest,
  completion: boolean,
  formatting = false,
  rangeFormatting = false,
  inlayHints = false,
  onTypeFormatting = false,
): Record<string, unknown> {
  const value: Record<string, unknown> = {
    workspaceId: request.workspaceId,
    generation: request.generation,
    document: {
      path: request.document.path,
      uri: request.document.uri,
      version: request.document.version,
    },
    position: { line: request.position.line, character: request.position.character },
    requestId: request.requestId,
    cancellationId: request.cancellationId,
  };
  if (completion && (request as JavaCompletionRequest).trigger !== undefined) {
    const trigger = (request as JavaCompletionRequest).trigger!;
    value.trigger =
      trigger.character === undefined
        ? { kind: trigger.kind }
        : { kind: trigger.kind, character: trigger.character };
  }
  if (formatting) {
    const options = (
      request as JavaSemanticRequest & { options?: JavaFormattingRequest["options"] }
    ).options;
    if (
      !options ||
      !Number.isSafeInteger(options.tabSize) ||
      options.tabSize < 1 ||
      options.tabSize > 16 ||
      typeof options.insertSpaces !== "boolean"
    )
      throw invalidRequest("request_java_formatting", "Invalid Java formatting options");
    value.formattingOptions = { tabSize: options.tabSize, insertSpaces: options.insertSpaces };
  }
  if (rangeFormatting || inlayHints)
    value.range = (request as JavaSemanticRequest & Pick<JavaInlayHintsRequest, "range">).range;
  if (onTypeFormatting) value.formattingCharacter = (request as JavaOnTypeFormattingRequest).character;
  if ("includeDeclaration" in request)
    value.includeDeclaration = (request as JavaReferencesRequest).includeDeclaration;
  return value;
}

function validateFormattingRequest(command: string, request: JavaFormattingRequest): void {
  validateRequest(command, { ...request, position: { line: 0, character: 0 } }, false);
  if (
    !Number.isSafeInteger(request.options?.tabSize) ||
    request.options.tabSize < 1 ||
    request.options.tabSize > 16 ||
    typeof request.options.insertSpaces !== "boolean"
  )
    throw invalidRequest(command, "Invalid Java formatting options");
}

function validateRangeFormattingRequest(
  command: string,
  request: JavaRangeFormattingRequest,
): void {
  validateFormattingRequest(command, request);
  const range = normalizeRange(command, request.range);
  if (range.start.line === range.end.line && range.start.character === range.end.character)
    throw invalidRequest(command, "Java range formatting requires a non-empty selection");
  validateRequest(command, { ...request, position: range.start }, false);
}

function validateInlayHintsRequest(command: string, request: JavaInlayHintsRequest): void {
  const range = normalizeRange(command, request.range);
  if (range.start.line === range.end.line && range.start.character === range.end.character)
    throw invalidRequest(command, "Java inlay hints require a non-empty range");
  validateRequest(command, { ...request, position: range.start }, false);
}

function validateGeneratorBindingKeys(
  value: unknown,
  limit = MAX_GENERATOR_MEMBERS,
): value is string[] {
  if (!Array.isArray(value) || value.length > limit) return false;
  return value.every(
    (key, index) =>
      typeof key === "string" &&
      key.length > 0 &&
      new TextEncoder().encode(key).length <= MAX_GENERATOR_BINDING_KEY_BYTES &&
      !/[\u0000-\u001f\u007f]/.test(key) &&
      value.slice(0, index).every((previous) => previous !== key),
  );
}

function validateGenerationSelection(
  command: string,
  value: unknown,
): asserts value is JavaCodeActionGenerationSelection {
  if (
    !isRecord(value) ||
    !["constructors", "hashCodeEquals", "overrideMethods", "delegateMethods"].includes(
      String(value.kind),
    )
  )
    throw invalidRequest(command, "Invalid Java code-action generation selection");
  if (
    !validateGeneratorBindingKeys(value.selectedFieldBindingKeys) ||
    !validateGeneratorBindingKeys(value.selectedConstructorBindingKeys) ||
    !validateGeneratorBindingKeys(value.selectedOverridableMethodKeys) ||
    !validateGeneratorBindingKeys(value.selectedDelegateMethodKeys, MAX_DELEGATE_METHODS)
  )
    throw invalidRequest(command, "Invalid Java code-action generation selection");
  if (
    (value.kind === "constructors" && value.selectedConstructorBindingKeys.length === 0) ||
    (value.kind === "hashCodeEquals" &&
      (value.selectedFieldBindingKeys.length === 0 ||
        value.selectedConstructorBindingKeys.length !== 0 ||
        value.selectedOverridableMethodKeys.length !== 0 ||
        value.selectedDelegateMethodKeys.length !== 0)) ||
    (value.kind === "overrideMethods" &&
      (value.selectedOverridableMethodKeys.length === 0 ||
        value.selectedFieldBindingKeys.length !== 0 ||
        value.selectedConstructorBindingKeys.length !== 0 ||
        value.selectedDelegateMethodKeys.length !== 0)) ||
    (value.kind === "delegateMethods" &&
      (value.selectedDelegateMethodKeys.length === 0 ||
        value.selectedFieldBindingKeys.length !== 0 ||
        value.selectedConstructorBindingKeys.length !== 0 ||
        value.selectedOverridableMethodKeys.length !== 0)) ||
    (value.kind === "constructors" &&
      (value.selectedFieldBindingKeys.length > 64 ||
        value.selectedOverridableMethodKeys.length !== 0 ||
        value.selectedDelegateMethodKeys.length !== 0))
  )
    throw invalidRequest(command, "Invalid Java code-action generation selection");
}

function validateCodeActionsRequest(command: string, request: JavaCodeActionsRequest): void {
  validateRequest(command, request, false);
  const range = normalizeRange(command, request.range);
  if (
    request.position.line !== range.start.line ||
    request.position.character !== range.start.character
  )
    throw invalidRequest(command, "Java code-action position does not match its range");
  if (
    !Array.isArray(request.diagnostics) ||
    request.diagnostics.length > MAX_CODE_ACTION_DIAGNOSTICS
  )
    throw invalidRequest(command, "Invalid Java code-action diagnostics");
  if (request.generationSelection !== undefined)
    validateGenerationSelection(command, request.generationSelection);
  for (const diagnostic of request.diagnostics) {
    if (
      !isRecord(diagnostic) ||
      ![1, 2, 3, 4].includes(diagnostic.severity) ||
      typeof diagnostic.message !== "string" ||
      new TextEncoder().encode(diagnostic.message).length > MAX_STRING_LENGTH ||
      (diagnostic.source !== undefined &&
        (typeof diagnostic.source !== "string" ||
          new TextEncoder().encode(diagnostic.source).length > 256)) ||
      (diagnostic.code !== undefined &&
        !(
          (typeof diagnostic.code === "string" && diagnostic.code.length <= 256) ||
          (typeof diagnostic.code === "number" && Number.isSafeInteger(diagnostic.code))
        ))
    )
      throw invalidRequest(command, "Invalid Java code-action diagnostic");
    normalizeRange(command, diagnostic.range);
  }
}

function nativeCodeActionsRequest(request: JavaCodeActionsRequest): Record<string, unknown> {
  return {
    ...nativeRequest(request, false),
    range: request.range,
    diagnostics: request.diagnostics,
    ...(request.generationSelection
      ? {
          generationSelection: {
            kind: request.generationSelection.kind,
            selectedFieldBindingKeys: [...request.generationSelection.selectedFieldBindingKeys],
            selectedConstructorBindingKeys: [
              ...request.generationSelection.selectedConstructorBindingKeys,
            ],
            selectedOverridableMethodKeys: [
              ...request.generationSelection.selectedOverridableMethodKeys,
            ],
            selectedDelegateMethodKeys: [...request.generationSelection.selectedDelegateMethodKeys],
          },
        }
      : {}),
  };
}

function validateRenameRequest(command: string, request: JavaRenameRequest): void {
  validateRequest(command, request, false);
  if (
    typeof request.newName !== "string" ||
    request.newName.trim().length === 0 ||
    new TextEncoder().encode(request.newName).length > 256 ||
    /[\u0000-\u001f\u007f]/.test(request.newName)
  )
    throw invalidRequest(command, "Invalid Java rename name");
}

function nativeRenameRequest(request: JavaRenameRequest): Record<string, unknown> {
  return { ...nativeRequest(request, false), newName: request.newName };
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
  if (end.line < start.line || (end.line === start.line && end.character < start.character))
    throw rejected(command);
  return { start, end };
}

function normalizeContent(command: string, value: unknown): JavaSemanticContent {
  const content = record(command, value);
  if (content.format !== "plaintext" && content.format !== "markdown") throw rejected(command);
  return {
    format: content.format,
    value: boundedString(command, content.value, MAX_STRING_LENGTH),
  };
}

function normalizeTextEdit(command: string, value: unknown): JavaTextEdit {
  const edit = record(command, value);
  if (Object.keys(edit).some((key) => key !== "range" && key !== "newText"))
    throw rejected(command);
  return {
    range: normalizeRange(command, edit.range),
    newText: boundedString(command, edit.newText, MAX_STRING_LENGTH),
  };
}

function normalizeAdditionalEdit(
  command: string,
  value: unknown,
  request: JavaSemanticRequest,
): JavaWorkspaceTextEdit {
  const additional = record(command, value);
  const document = record(command, additional.document);
  const workspaceId = boundedString(command, document.workspaceId, MAX_WORKSPACE_ID_LENGTH, false);
  const path = document.path;
  const uri = document.uri;
  const version = safeInteger(command, document.version);
  if (
    !validJavaPath(path) ||
    !validDocumentUri(uri, path) ||
    workspaceId !== request.workspaceId ||
    path !== request.document.path ||
    uri !== request.document.uri ||
    version !== request.document.version
  )
    throw rejected(command);
  return {
    document: { workspaceId, path, uri, version },
    edit: normalizeTextEdit(command, additional.edit),
  };
}

function normalizeCompletionItem(
  command: string,
  value: unknown,
  request: JavaSemanticRequest,
): JavaCompletionItem {
  const native = record(command, value);
  const label = boundedString(command, native.label, MAX_LABEL_LENGTH, false);
  if (
    typeof native.kind !== "string" ||
    !COMPLETION_KINDS.has(native.kind as JavaCompletionItemKind)
  )
    throw rejected(command);
  const item: JavaCompletionItem = { label, kind: native.kind as JavaCompletionItemKind };
  const detail = optionalBoundedString(command, native.detail, MAX_STRING_LENGTH);
  const sortText = optionalBoundedString(command, native.sortText, MAX_LABEL_LENGTH);
  const filterText = optionalBoundedString(command, native.filterText, MAX_LABEL_LENGTH);
  const insertText = optionalBoundedString(command, native.insertText, MAX_STRING_LENGTH);
  if (detail !== undefined) item.detail = detail;
  if (sortText !== undefined) item.sortText = sortText;
  if (filterText !== undefined) item.filterText = filterText;
  if (insertText !== undefined) item.insertText = insertText;
  if (native.documentation !== undefined)
    item.documentation = normalizeContent(command, native.documentation);
  if (native.textEdit !== undefined) item.textEdit = normalizeTextEdit(command, native.textEdit);
  if (native.additionalTextEdits !== undefined) {
    if (
      !Array.isArray(native.additionalTextEdits) ||
      native.additionalTextEdits.length > MAX_ADDITIONAL_EDITS
    )
      throw rejected(command);
    item.additionalTextEdits = native.additionalTextEdits.map((edit) =>
      normalizeAdditionalEdit(command, edit, request),
    );
  }
  if (native.commitCharacters !== undefined) {
    if (
      !Array.isArray(native.commitCharacters) ||
      native.commitCharacters.length > MAX_COMMIT_CHARACTERS
    )
      throw rejected(command);
    item.commitCharacters = native.commitCharacters.map((character) => {
      if (
        typeof character !== "string" ||
        [...character].length !== 1 ||
        /[\u0000-\u001f\u007f]/.test(character)
      )
        throw rejected(command);
      return character;
    });
  }
  for (const field of ["deprecated", "preselect"] as const) {
    if (native[field] !== undefined) {
      if (typeof native[field] !== "boolean") throw rejected(command);
      item[field] = native[field];
    }
  }
  return item;
}

function metadata(
  command: string,
  response: Record<string, unknown>,
  request: JavaSemanticRequest,
) {
  const provider = response.provider;
  if (provider !== "jdtls" && provider !== "jdt-ls") throw rejected(command);
  const providerVersion =
    response.providerVersion === null
      ? null
      : boundedString(command, response.providerVersion, MAX_PROVIDER_VERSION_LENGTH, false);
  const workspaceId = boundedString(command, response.workspaceId, MAX_WORKSPACE_ID_LENGTH, false);
  const generation = safeInteger(command, response.generation);
  const path = response.path;
  const uri = response.uri;
  const version = safeInteger(command, response.version);
  const requestId = boundedString(command, response.requestId, MAX_ID_BYTES, false);
  if (
    !validJavaPath(path) ||
    !validDocumentUri(uri, path) ||
    workspaceId !== request.workspaceId ||
    generation !== request.generation ||
    path !== request.document.path ||
    uri !== request.document.uri ||
    version !== request.document.version ||
    requestId !== request.requestId
  )
    throw rejected(command);
  return {
    provider: "jdt-ls",
    providerVersion,
    workspaceId,
    generation,
    document: { path, uri, version },
  };
}

function normalizeFailure(
  command: string,
  native: Record<string, unknown>,
  request: Pick<JavaSemanticRequest, "requestId">,
) {
  if (typeof native.cancelled !== "boolean" || typeof native.timeout !== "boolean")
    throw rejected(command);
  const nativeError = native.error === null ? undefined : record(command, native.error);
  let kind: JavaSemanticErrorKind;
  if (native.cancelled) kind = "cancelled";
  else if (native.timeout) kind = "timeout";
  else {
    if (
      !nativeError ||
      typeof nativeError.kind !== "string" ||
      !ERROR_KINDS.has(nativeError.kind as JavaSemanticErrorKind)
    )
      throw rejected(command);
    kind = nativeError.kind as JavaSemanticErrorKind;
  }
  if (native.cancelled && native.timeout) throw rejected(command);
  if (nativeError?.kind !== undefined && nativeError.kind !== kind) throw rejected(command);
  if (native.result !== null) throw rejected(command);
  const summary: Record<JavaSemanticErrorKind, string> = {
    cancelled: "Java semantic request was cancelled",
    timeout: "Java semantic request timed out",
    unavailable: "Java semantic provider is unavailable",
    "stale-version": "Java semantic document version is stale",
    "provider-error": "Java semantic provider returned an error",
    "malformed-result": "Java semantic provider returned an invalid result",
  };
  const error: {
    kind: JavaSemanticErrorKind;
    summary: string;
    providerCode?: string | number;
    retryable?: boolean;
  } = { kind, summary: summary[kind] };
  if (nativeError) {
    if (typeof nativeError.retryable !== "boolean") throw rejected(command);
    error.retryable = nativeError.retryable;
    const code = nativeError.providerCode;
    if (code !== undefined && code !== null) {
      if (typeof code === "number" && Number.isSafeInteger(code)) error.providerCode = code;
      else if (typeof code === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(code))
        error.providerCode = code;
      else throw rejected(command);
    }
  }
  return { ok: false as const, requestId: request.requestId, error };
}

function validateWorkspaceSymbolsRequest(
  command: string,
  value: JavaWorkspaceSymbolsRequest,
): JavaWorkspaceSymbolsRequest {
  if (!isRecord(value)) throw invalidRequest(command, "Invalid Java workspace-symbol request");
  const workspaceId = boundedString(command, value.workspaceId, MAX_WORKSPACE_ID_LENGTH, false);
  const generation = safeInteger(command, value.generation);
  const query = boundedString(
    command,
    value.query,
    MAX_WORKSPACE_SYMBOL_QUERY_LENGTH,
    false,
  ).trim();
  if (
    new TextEncoder().encode(workspaceId).length > MAX_WORKSPACE_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(workspaceId) ||
    !query ||
    /[\u0000-\u001f\u007f]/.test(value.query)
  )
    throw invalidRequest(command, "Invalid Java workspace-symbol query");
  const requestId = boundedString(command, value.requestId, MAX_ID_BYTES, false);
  const cancellationId = boundedString(command, value.cancellationId, MAX_ID_BYTES, false);
  if (!validId(requestId) || !validId(cancellationId))
    throw invalidRequest(command, "Invalid Java workspace-symbol correlation ID");
  return { workspaceId, generation, query, requestId, cancellationId };
}

function normalizeWorkspaceSymbol(command: string, value: unknown): JavaWorkspaceSymbol {
  const native = record(command, value);
  const name = boundedString(command, native.name, MAX_LABEL_LENGTH, false);
  if (
    typeof native.kind !== "string" ||
    !DOCUMENT_SYMBOL_KINDS.has(native.kind as JavaDocumentSymbolKind) ||
    !validJavaPath(native.path)
  )
    throw rejected(command);
  const symbol: JavaWorkspaceSymbol = {
    name,
    kind: native.kind as JavaDocumentSymbolKind,
    path: native.path,
    range: normalizeRange(command, native.range),
  };
  const containerName = optionalBoundedString(command, native.containerName, MAX_LABEL_LENGTH);
  if (containerName !== undefined && containerName.length > 0) symbol.containerName = containerName;
  if (native.deprecated !== undefined) {
    if (typeof native.deprecated !== "boolean") throw rejected(command);
    if (native.deprecated) symbol.deprecated = true;
  }
  return symbol;
}

function normalizeWorkspaceSymbolsResult(
  command: string,
  value: unknown,
  metadata: Omit<JavaWorkspaceSymbolsResult, "symbols" | "isTruncated">,
): JavaWorkspaceSymbolsResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.symbols) ||
    native.symbols.length > MAX_WORKSPACE_SYMBOLS ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
  return {
    ...metadata,
    symbols: native.symbols.map((symbol) => normalizeWorkspaceSymbol(command, symbol)),
    isTruncated: native.isTruncated,
  };
}

function normalizeCompletionResult(
  command: string,
  value: unknown,
  request: JavaSemanticRequest,
  meta: ReturnType<typeof metadata>,
): JavaCompletionResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.items) ||
    native.items.length > MAX_ITEMS ||
    typeof native.isIncomplete !== "boolean"
  )
    throw rejected(command);
  return {
    ...meta,
    items: native.items.map((item) => normalizeCompletionItem(command, item, request)),
    isIncomplete: native.isIncomplete,
  };
}

function normalizeHoverResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
): JavaHoverResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.contents) ||
    native.contents.length > MAX_HOVER_CONTENTS ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
  const result: JavaHoverResult = {
    ...meta,
    contents: native.contents.map((item) => normalizeContent(command, item)),
    isTruncated: native.isTruncated,
  };
  if (native.range !== undefined) result.range = normalizeRange(command, native.range);
  return result;
}

function normalizeParameter(
  command: string,
  value: unknown,
  signatureLabel: string,
): JavaSignatureParameter {
  const native = record(command, value);
  let label: JavaSignatureParameter["label"];
  if (typeof native.label === "string")
    label = boundedString(command, native.label, MAX_LABEL_LENGTH);
  else {
    const offsets = record(command, native.label);
    const start = safeInteger(command, offsets.start, signatureLabel.length * 2);
    const end = safeInteger(command, offsets.end, signatureLabel.length * 2);
    if (
      start > end ||
      end > [...signatureLabel].reduce((count, character) => count + character.length, 0)
    )
      throw rejected(command);
    label = { start, end };
  }
  const parameter: JavaSignatureParameter = { label };
  if (native.documentation !== undefined)
    parameter.documentation = normalizeContent(command, native.documentation);
  return parameter;
}

function normalizeSignature(command: string, value: unknown): JavaSignatureInformation {
  const native = record(command, value);
  const label = boundedString(command, native.label, MAX_LABEL_LENGTH);
  if (!Array.isArray(native.parameters) || native.parameters.length > MAX_PARAMETERS)
    throw rejected(command);
  const parameters = native.parameters.map((parameter) =>
    normalizeParameter(command, parameter, label),
  );
  const signature: JavaSignatureInformation = { label, parameters };
  if (native.documentation !== undefined)
    signature.documentation = normalizeContent(command, native.documentation);
  if (native.activeParameter !== undefined) {
    const active = safeInteger(command, native.activeParameter);
    if (active >= parameters.length) throw rejected(command);
    signature.activeParameter = active;
  }
  return signature;
}

function normalizeSignatureResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
): JavaSignatureHelpResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.signatures) ||
    native.signatures.length > MAX_SIGNATURES ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
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

function containsRange(outer: LanguageRange, inner: LanguageRange): boolean {
  const compare = (
    a: { line: number; character: number },
    b: { line: number; character: number },
  ) => a.line - b.line || a.character - b.character;
  return compare(outer.start, inner.start) <= 0 && compare(inner.end, outer.end) <= 0;
}

function normalizeDocumentSymbol(
  command: string,
  value: unknown,
  state: { count: number },
  depth: number,
): JavaDocumentSymbol {
  if (depth > MAX_DOCUMENT_SYMBOL_DEPTH || ++state.count > MAX_DOCUMENT_SYMBOLS)
    throw rejected(command);
  const native = record(command, value);
  const name = boundedString(command, native.name, MAX_LABEL_LENGTH, false);
  if (
    typeof native.kind !== "string" ||
    !DOCUMENT_SYMBOL_KINDS.has(native.kind as JavaDocumentSymbolKind)
  )
    throw rejected(command);
  const range = normalizeRange(command, native.range);
  const selectionRange = normalizeRange(command, native.selectionRange);
  if (!containsRange(range, selectionRange)) throw rejected(command);
  const symbol: JavaDocumentSymbol = {
    name,
    kind: native.kind as JavaDocumentSymbolKind,
    range,
    selectionRange,
  };
  const detail = optionalBoundedString(command, native.detail, MAX_STRING_LENGTH);
  if (detail !== undefined) symbol.detail = detail;
  if (native.tags !== undefined) {
    if (!Array.isArray(native.tags) || native.tags.some((tag) => tag !== 1))
      throw rejected(command);
    if (native.tags.includes(1)) symbol.deprecated = true;
  } else if (native.deprecated !== undefined) {
    if (typeof native.deprecated !== "boolean") throw rejected(command);
    if (native.deprecated) symbol.deprecated = true;
  }
  if (native.children !== undefined) {
    if (!Array.isArray(native.children) || native.children.length > MAX_DOCUMENT_SYMBOLS)
      throw rejected(command);
    symbol.children = native.children.map((child) =>
      normalizeDocumentSymbol(command, child, state, depth + 1),
    );
    if (symbol.children.some((child) => !containsRange(range, child.range)))
      throw rejected(command);
  }
  return symbol;
}

function normalizeDocumentSymbolsResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
): JavaDocumentSymbolsResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.symbols) ||
    typeof native.isTruncated !== "boolean" ||
    native.symbols.length > MAX_DOCUMENT_SYMBOLS
  )
    throw rejected(command);
  const state = { count: 0 };
  return {
    ...meta,
    symbols: native.symbols.map((symbol) => normalizeDocumentSymbol(command, symbol, state, 0)),
    isTruncated: native.isTruncated,
  };
}

function textRangesOverlap(left: LanguageRange, right: LanguageRange): boolean {
  const compare = (
    a: { line: number; character: number },
    b: { line: number; character: number },
  ) => a.line - b.line || a.character - b.character;
  const leftEmpty = compare(left.start, left.end) === 0;
  const rightEmpty = compare(right.start, right.end) === 0;
  if (leftEmpty && rightEmpty) return compare(left.start, right.start) === 0;
  if (leftEmpty)
    return compare(right.start, left.start) <= 0 && compare(left.start, right.end) <= 0;
  if (rightEmpty)
    return compare(left.start, right.start) <= 0 && compare(right.start, left.end) <= 0;
  return compare(left.start, right.end) < 0 && compare(right.start, left.end) < 0;
}

function rangeContains(outer: LanguageRange, inner: LanguageRange): boolean {
  const compare = (left: LanguageRange["start"], right: LanguageRange["start"]) =>
    left.line - right.line || left.character - right.character;
  return compare(inner.start, outer.start) >= 0 && compare(inner.end, outer.end) <= 0;
}

function normalizeMemberSelection(command: string, value: unknown): JavaCodeActionMemberSelection {
  const selection = record(command, value);
  if (
    !["constructors", "hashCodeEquals", "overrideMethods", "delegateMethods"].includes(
      String(selection.kind),
    )
  )
    throw rejected(command);
  if (!Array.isArray(selection.groups) || selection.groups.length > 2) throw rejected(command);
  const groups: JavaCodeActionMemberGroup[] = selection.groups.map((value) => {
    const group = record(command, value);
    if (
      group.id !== "fields" &&
      group.id !== "constructors" &&
      group.id !== "overridableMethods" &&
      group.id !== "delegateMethods"
    )
      throw rejected(command);
    const label = boundedString(command, group.label, MAX_LABEL_LENGTH, false);
    const memberLimit =
      group.id === "delegateMethods" ? MAX_DELEGATE_METHODS : MAX_GENERATOR_MEMBERS;
    if (!Array.isArray(group.members) || group.members.length > memberLimit)
      throw rejected(command);
    const members: JavaCodeActionMember[] = group.members.map((value) => {
      const member = record(command, value);
      const selectionKey = boundedString(
        command,
        member.selectionKey,
        MAX_GENERATOR_BINDING_KEY_BYTES,
        false,
      );
      const name = boundedString(command, member.name, MAX_LABEL_LENGTH, false);
      if (/[\u0000-\u001f\u007f]/.test(selectionKey) || /[\u0000-\u001f\u007f]/.test(name))
        throw rejected(command);
      const detail = optionalBoundedString(command, member.detail, MAX_STRING_LENGTH);
      if (detail !== undefined && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(detail))
        throw rejected(command);
      return { selectionKey, name, ...(detail !== undefined ? { detail } : {}) };
    });
    if (
      members.some((member, index) =>
        members.slice(0, index).some((previous) => previous.selectionKey === member.selectionKey),
      )
    )
      throw rejected(command);
    if (!validateGeneratorBindingKeys(group.selectedKeys, memberLimit)) throw rejected(command);
    if (group.selectedKeys.some((key) => !members.some((member) => member.selectionKey === key)))
      throw rejected(command);
    return {
      id: group.id,
      label,
      members,
      selectedKeys: [...group.selectedKeys],
    };
  });
  const expectedIds =
    selection.kind === "constructors"
      ? ["fields", "constructors"]
      : selection.kind === "hashCodeEquals"
        ? ["fields"]
        : selection.kind === "overrideMethods"
          ? ["overridableMethods"]
          : ["delegateMethods"];
  if (
    groups.length !== expectedIds.length ||
    groups.some((group, index) => group.id !== expectedIds[index]) ||
    (selection.kind === "hashCodeEquals" && groups[0]?.members.length === 0) ||
    (selection.kind === "constructors" && groups[1]?.members.length === 0) ||
    ((selection.kind === "overrideMethods" || selection.kind === "delegateMethods") &&
      groups[0]?.members.length === 0)
  )
    throw rejected(command);
  return { kind: selection.kind as JavaCodeActionGenerationKind, groups };
}

function normalizeCodeActionsResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
  request: JavaCodeActionsRequest,
): JavaCodeActionsResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.actions) ||
    native.actions.length > MAX_CODE_ACTIONS ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
  const actions: JavaCodeAction[] = native.actions.map((value) => {
    const action = record(command, value);
    if (action.command !== undefined || action.disabled !== undefined) throw rejected(command);
    const title = boundedString(command, action.title, MAX_LABEL_LENGTH, false);
    const memberSelection =
      action.memberSelection === undefined
        ? undefined
        : normalizeMemberSelection(command, action.memberSelection);
    const planHash = action.editPlanSha256;
    if (
      planHash !== undefined &&
      (typeof planHash !== "string" || !/^[a-f0-9]{64}$/.test(planHash))
    )
      throw rejected(command);
    let sourceDocuments: { path: string; contentSha256: string }[] | undefined;
    if (action.sourceDocuments !== undefined) {
      if (
        !planHash ||
        !Array.isArray(action.sourceDocuments) ||
        !action.sourceDocuments.length ||
        action.sourceDocuments.length > MAX_RENAME_DOCUMENTS
      )
        throw rejected(command);
      sourceDocuments = action.sourceDocuments.map((value: unknown) => {
        const source = record(command, value);
        if (
          !validJavaPath(source.path) ||
          typeof source.contentSha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(source.contentSha256)
        )
          throw rejected(command);
        return { path: source.path as string, contentSha256: source.contentSha256 };
      });
      if (new Set(sourceDocuments.map((source) => source.path)).size !== sourceDocuments.length)
        throw rejected(command);
    } else if (planHash !== undefined) throw rejected(command);
    let documentsToOpen: string[] | undefined;
    if (action.documentsToOpen !== undefined) {
      if (
        !sourceDocuments ||
        memberSelection ||
        !Array.isArray(action.documentsToOpen) ||
        !action.documentsToOpen.length ||
        action.documentsToOpen.length > MAX_RENAME_DOCUMENTS ||
        action.documentsToOpen.some(
          (path) =>
            !validJavaPath(path) ||
            path === request.document.path ||
            !sourceDocuments!.some((source) => source.path === path),
        ) ||
        new Set(action.documentsToOpen).size !== action.documentsToOpen.length
      )
        throw rejected(command);
      documentsToOpen = [...action.documentsToOpen] as string[];
    }
    if (
      action.additionalEdits !== undefined &&
      (!Array.isArray(action.additionalEdits) ||
        action.additionalEdits.length > MAX_CODE_ACTION_EDITS)
    )
      throw rejected(command);
    const additionalEdits: JavaWorkspaceTextEdit[] = (action.additionalEdits ?? []).map(
      (value: unknown) => {
        const additional = record(command, value);
        const document = record(command, additional.document);
        const workspaceId = boundedString(
          command,
          document.workspaceId,
          MAX_WORKSPACE_ID_LENGTH,
          false,
        );
        const path = document.path;
        const uri = document.uri;
        const version = safeInteger(command, document.version);
        if (
          !validJavaPath(path) ||
          !validDocumentUri(uri, path) ||
          workspaceId !== request.workspaceId ||
          path === request.document.path ||
          uri === request.document.uri ||
          documentUriWorkspaceRoot(uri, path) !==
            documentUriWorkspaceRoot(request.document.uri, request.document.path)
        )
          throw rejected(command);
        return {
          document: { workspaceId, path, uri, version },
          edit: normalizeTextEdit(command, additional.edit),
        };
      },
    );
    if (
      !Array.isArray(action.edits) ||
      (memberSelection || documentsToOpen
        ? action.edits.length !== 0 || additionalEdits.length !== 0
        : action.edits.length + additionalEdits.length === 0) ||
      action.edits.length + additionalEdits.length > MAX_CODE_ACTION_EDITS
    )
      throw rejected(command);
    if (memberSelection && action.kind !== "quickassist") throw rejected(command);
    const edits = action.edits.map((edit) => normalizeTextEdit(command, edit));
    if (sourceDocuments && !documentsToOpen) {
      const affected = new Set([
        ...(edits.length ? [request.document.path] : []),
        ...additionalEdits.map((entry) => entry.document.path),
      ]);
      if (
        affected.size !== sourceDocuments.length ||
        sourceDocuments.some((source) => !affected.has(source.path))
      )
        throw rejected(command);
    }
    if (
      edits.some((edit, index) =>
        edits.slice(0, index).some((previous) => textRangesOverlap(previous.range, edit.range)),
      )
    )
      throw rejected(command);
    const editsByUri = new Map<string, JavaTextEdit[]>([[request.document.uri, edits]]);
    for (const additional of additionalEdits) {
      const documentEdits = editsByUri.get(additional.document.uri) ?? [];
      if (
        documentEdits.some((previous) => textRangesOverlap(previous.range, additional.edit.range))
      )
        throw rejected(command);
      documentEdits.push(additional.edit);
      editsByUri.set(additional.document.uri, documentEdits);
    }
    const result: JavaCodeAction = {
      title,
      edits,
      ...(additionalEdits.length > 0 ? { additionalEdits } : {}),
      ...(memberSelection ? { memberSelection } : {}),
      ...(planHash ? { editPlanSha256: planHash as string, sourceDocuments } : {}),
      ...(documentsToOpen ? { documentsToOpen } : {}),
    };
    if (action.kind !== undefined) {
      const kind = boundedString(command, action.kind, 128, false);
      if (!(
        kind === "quickfix" ||
        kind.startsWith("quickfix.") ||
        kind === "quickassist" ||
        kind.startsWith("quickassist.") ||
        kind === "refactor" ||
        kind.startsWith("refactor.") ||
        kind === "source" ||
        kind.startsWith("source.")
      ))
        throw rejected(command);
      result.kind = kind;
    }
    if (action.isPreferred !== undefined) {
      if (typeof action.isPreferred !== "boolean") throw rejected(command);
      result.isPreferred = action.isPreferred;
    }
    return result;
  });
  return { ...meta, actions, isTruncated: native.isTruncated };
}

function normalizeRenameResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
  request: JavaRenameRequest,
): JavaRenameResult {
  const native = record(command, value);
  if (!Array.isArray(native.documentEdits) || native.documentEdits.length > MAX_RENAME_DOCUMENTS)
    throw rejected(command);
  const requestRoot = documentUriWorkspaceRoot(request.document.uri, request.document.path);
  if (requestRoot === undefined) throw rejected(command);
  if (native.documentsToOpen !== undefined) {
    if (
      !Array.isArray(native.documentsToOpen) ||
      native.documentsToOpen.length === 0 ||
      native.documentsToOpen.length > MAX_RENAME_DOCUMENTS ||
      native.documentEdits.length !== 0 ||
      native.appliedToEditor !== undefined ||
      native.documentsToOpen.some(
        (path) => !validJavaPath(path) || path === request.document.path,
      ) ||
      new Set(native.documentsToOpen).size !== native.documentsToOpen.length
    )
      throw rejected(command);
    return { ...meta, documentEdits: [], documentsToOpen: [...native.documentsToOpen] as string[] };
  }
  const seenDocuments = new Set<string>();
  let totalEdits = 0;
  const documentEdits = native.documentEdits.map((value) => {
    const entry = record(command, value);
    const document = record(command, entry.document);
    const path = document.path;
    const uri = document.uri;
    const version = safeInteger(command, document.version);
    if (
      !validJavaPath(path) ||
      !validDocumentUri(uri, path) ||
      documentUriWorkspaceRoot(uri, path) !== requestRoot ||
      seenDocuments.has(path) ||
      (path === request.document.path &&
        (uri !== request.document.uri || version !== request.document.version)) ||
      !Array.isArray(entry.edits) ||
      entry.edits.length === 0
    )
      throw rejected(command);
    seenDocuments.add(path);
    totalEdits += entry.edits.length;
    if (totalEdits > MAX_RENAME_EDITS) throw rejected(command);
    const edits = entry.edits.map((edit) => normalizeTextEdit(command, edit));
    if (
      edits.some((edit, index) =>
        edits.slice(0, index).some((previous) => textRangesOverlap(previous.range, edit.range)),
      )
    )
      throw rejected(command);
    return { document: { path, uri, version }, edits };
  });
  return { ...meta, documentEdits };
}

function normalizeFormattingResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
  allowedRange?: LanguageRange,
): JavaFormattingResult {
  const native = record(command, value);
  if (!Array.isArray(native.edits) || native.edits.length > MAX_FORMATTING_EDITS)
    throw rejected(command);
  const edits = native.edits.map((edit) => normalizeTextEdit(command, edit));
  if (
    (allowedRange && edits.some((edit) => !rangeContains(allowedRange, edit.range))) ||
    edits.some((edit, index) =>
      edits.slice(0, index).some((previous) => textRangesOverlap(previous.range, edit.range)),
    )
  )
    throw rejected(command);
  return { ...meta, edits };
}

function normalizeDocumentHighlightsResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
): JavaDocumentHighlightsResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.highlights) ||
    native.highlights.length > MAX_DOCUMENT_HIGHLIGHTS ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
  return {
    ...meta,
    highlights: native.highlights.map((value) => {
      const highlight = record(command, value);
      const result: JavaDocumentHighlightsResult["highlights"][number] = {
        range: normalizeRange(command, highlight.range),
      };
      if (highlight.kind !== undefined) {
        if (!(highlight.kind === "text" || highlight.kind === "read" || highlight.kind === "write"))
          throw rejected(command);
        result.kind = highlight.kind;
      }
      return result;
    }),
    isTruncated: native.isTruncated,
  };
}

function normalizeImplementationsResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
): JavaImplementationsResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.locations) ||
    native.locations.length > MAX_IMPLEMENTATIONS ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
  return {
    ...meta,
    locations: native.locations.map((value) => {
      const location = record(command, value);
      const path = boundedString(command, location.path, MAX_PATH_LENGTH, false);
      if (!validJavaPath(path)) throw rejected(command);
      return { path, range: normalizeRange(command, location.range) };
    }),
    isTruncated: native.isTruncated,
  };
}

function normalizeDefinitionsResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
): JavaDefinitionsResult {
  return normalizeImplementationsResult(command, value, meta);
}

function normalizeReferencesResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
): JavaReferencesResult {
  return normalizeImplementationsResult(command, value, meta);
}

function normalizeCallHierarchyResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
  direction: JavaCallHierarchyRequest["direction"],
): JavaCallHierarchyResult {
  const native = record(command, value);
  if (
    native.direction !== direction ||
    !Array.isArray(native.entries) ||
    native.entries.length > MAX_CALL_HIERARCHY_ITEMS ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
  const entries = native.entries.map((value) => {
    const entry = record(command, value);
    const name = boundedString(command, entry.name, 1_024, false);
    const kind = boundedString(command, entry.kind, 64, false);
    const locationValue = record(command, entry.location);
    const path = boundedString(command, locationValue.path, MAX_PATH_LENGTH, false);
    if (
      !validJavaPath(path) ||
      !Array.isArray(entry.callSites) ||
      entry.callSites.length > MAX_CALL_HIERARCHY_SITES
    )
      throw rejected(command);
    const location = { path, range: normalizeRange(command, locationValue.range) };
    const callSites = entry.callSites.map((siteValue) => {
      const site = record(command, siteValue);
      const sitePath = boundedString(command, site.path, MAX_PATH_LENGTH, false);
      if (!validJavaPath(sitePath)) throw rejected(command);
      return { path: sitePath, range: normalizeRange(command, site.range) };
    });
    const result: JavaCallHierarchyResult["entries"][number] = {
      name,
      kind,
      location,
      callSites,
    };
    if (entry.detail !== undefined)
      result.detail = boundedString(command, entry.detail, 1_024, false);
    return result;
  });
  return { ...meta, direction, entries, isTruncated: native.isTruncated };
}

function normalizeSemanticTokensResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
): JavaSemanticTokensResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.tokens) ||
    native.tokens.length > MAX_SEMANTIC_TOKENS ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
  const tokens = native.tokens.map((value) => {
    const token = record(command, value);
    const range = normalizeRange(command, token.range);
    const tokenType = boundedString(command, token.tokenType, 128, false);
    if (
      range.start.line !== range.end.line ||
      range.end.character <= range.start.character ||
      !Array.isArray(token.tokenModifiers) ||
      token.tokenModifiers.length > 32
    )
      throw rejected(command);
    const tokenModifiers = token.tokenModifiers.map((modifier) =>
      boundedString(command, modifier, 128, false),
    );
    if (new Set(tokenModifiers).size !== tokenModifiers.length) throw rejected(command);
    return { range, tokenType, tokenModifiers };
  });
  for (let index = 1; index < tokens.length; index += 1) {
    const previous = tokens[index - 1]!.range;
    const current = tokens[index]!.range;
    if (
      current.start.line < previous.start.line ||
      (current.start.line === previous.start.line &&
        current.start.character < previous.end.character)
    )
      throw rejected(command);
  }
  return { ...meta, tokens, isTruncated: native.isTruncated };
}

function normalizeInlayHintsResult(
  command: string,
  value: unknown,
  meta: ReturnType<typeof metadata>,
  allowedRange: LanguageRange,
): JavaInlayHintsResult {
  const native = record(command, value);
  if (
    !Array.isArray(native.hints) ||
    native.hints.length > MAX_INLAY_HINTS ||
    typeof native.isTruncated !== "boolean"
  )
    throw rejected(command);
  const hints = native.hints.map((value) => {
    const hint = record(command, value);
    const positionValue = record(command, hint.position);
    const position = {
      line: safeInteger(command, positionValue.line),
      character: safeInteger(command, positionValue.character),
    };
    const label = boundedString(command, hint.label, MAX_LABEL_LENGTH, false);
    if (
      position.line > MAX_LINE ||
      position.character > MAX_CHARACTER ||
      !positionWithinRange(allowedRange, position)
    )
      throw rejected(command);
    const result: JavaInlayHintsResult["hints"][number] = { position, label };
    if (hint.kind !== undefined) {
      if (hint.kind !== "type" && hint.kind !== "parameter") throw rejected(command);
      result.kind = hint.kind;
    }
    for (const key of ["paddingLeft", "paddingRight"] as const) {
      if (hint[key] !== undefined) {
        if (typeof hint[key] !== "boolean") throw rejected(command);
        result[key] = hint[key];
      }
    }
    return result;
  });
  return { ...meta, hints, isTruncated: native.isTruncated };
}

function positionWithinRange(
  range: LanguageRange,
  position: { line: number; character: number },
): boolean {
  const compare = (left: { line: number; character: number }, right: typeof left) =>
    left.line - right.line || left.character - right.character;
  return compare(range.start, position) <= 0 && compare(position, range.end) <= 0;
}

type SemanticKind =
  | "completion"
  | "hover"
  | "signature"
  | "document-symbols"
  | "document-highlights"
  | "definitions"
  | "implementations"
  | "references"
  | "semantic-tokens"
  | "inlay-hints"
  | "code-actions"
  | "rename"
  | "formatting"
  | "range-formatting"
  | "on-type-formatting";

export class TauriJavaIntelligenceAdapter implements JavaIntelligencePort {
  private async request<
    T extends
      | JavaCompletionResponse
      | JavaHoverResponse
      | JavaSignatureHelpResponse
      | JavaDocumentSymbolsResponse
      | JavaDocumentHighlightsResponse
      | JavaDefinitionsResponse
      | JavaImplementationsResponse
      | JavaReferencesResponse
      | JavaSemanticTokensResponse
      | JavaInlayHintsResponse
      | JavaCodeActionsResponse
      | JavaRenameResponse
      | JavaFormattingResponse,
  >(command: string, request: JavaSemanticRequest, kind: SemanticKind): Promise<T> {
    if (kind === "code-actions")
      validateCodeActionsRequest(command, request as JavaCodeActionsRequest);
    else if (kind === "rename") validateRenameRequest(command, request as JavaRenameRequest);
    else if (kind === "inlay-hints")
      validateInlayHintsRequest(command, request as unknown as JavaInlayHintsRequest);
    else validateRequest(command, request, kind === "completion");
    let response: unknown;
    try {
      response = await invoke<unknown>(command, {
        request:
          kind === "code-actions"
            ? nativeCodeActionsRequest(request as JavaCodeActionsRequest)
            : kind === "rename"
              ? nativeRenameRequest(request as JavaRenameRequest)
              : nativeRequest(
                  request,
                  kind === "completion",
                  kind === "formatting" || kind === "range-formatting" || kind === "on-type-formatting",
                  kind === "range-formatting",
                  kind === "inlay-hints",
                  kind === "on-type-formatting",
                ),
      });
    } catch {
      return {
        ok: false,
        requestId: request.requestId,
        error: {
          kind: "unavailable",
          summary: "Java semantic provider is unavailable",
          retryable: true,
        },
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
    if (typeof native.cancelled !== "boolean" || typeof native.timeout !== "boolean")
      throw rejected(command);
    if (native.cancelled || native.timeout || native.error !== null)
      return normalizeFailure(command, native, request) as T;
    if (native.result === null || native.result === undefined) throw rejected(command);
    const result =
      kind === "completion"
        ? normalizeCompletionResult(command, native.result, request, meta)
        : kind === "hover"
          ? normalizeHoverResult(command, native.result, meta)
          : kind === "signature"
            ? normalizeSignatureResult(command, native.result, meta)
            : kind === "document-symbols"
              ? normalizeDocumentSymbolsResult(command, native.result, meta)
              : kind === "document-highlights"
                ? normalizeDocumentHighlightsResult(command, native.result, meta)
                : kind === "definitions"
                  ? normalizeDefinitionsResult(command, native.result, meta)
                  : kind === "implementations"
                    ? normalizeImplementationsResult(command, native.result, meta)
                    : kind === "references"
                      ? normalizeReferencesResult(command, native.result, meta)
                      : kind === "semantic-tokens"
                        ? normalizeSemanticTokensResult(command, native.result, meta)
                        : kind === "inlay-hints"
                          ? normalizeInlayHintsResult(
                              command,
                              native.result,
                              meta,
                              (
                                request as JavaSemanticRequest &
                                  Pick<JavaInlayHintsRequest, "range">
                              ).range,
                            )
                          : kind === "code-actions"
                            ? normalizeCodeActionsResult(
                                command,
                                native.result,
                                meta,
                                request as JavaCodeActionsRequest,
                              )
                            : kind === "rename"
                              ? normalizeRenameResult(
                                  command,
                                  native.result,
                                  meta,
                                  request as JavaRenameRequest,
                                )
                              : normalizeFormattingResult(
                                  command,
                                  native.result,
                                  meta,
                                  kind === "range-formatting"
                                    ? (
                                        request as JavaSemanticRequest &
                                          Pick<JavaRangeFormattingRequest, "range">
                                      ).range
                                    : undefined,
                                );
    return { ok: true, requestId: request.requestId, result } as T;
  }

  completion(request: JavaCompletionRequest): Promise<JavaCompletionResponse> {
    return this.request("request_java_completion", request, "completion");
  }

  formatDocument(request: JavaFormattingRequest): Promise<JavaFormattingResponse> {
    validateFormattingRequest("request_java_formatting", request);
    return this.request(
      "request_java_formatting",
      { ...request, position: { line: 0, character: 0 } },
      "formatting",
    );
  }

  formatRange(request: JavaRangeFormattingRequest): Promise<JavaRangeFormattingResponse> {
    validateRangeFormattingRequest("request_java_formatting", request);
    return this.request(
      "request_java_formatting",
      { ...request, position: request.range.start },
      "range-formatting",
    );
  }

  formatOnType(request: JavaOnTypeFormattingRequest): Promise<JavaFormattingResponse> {
    validateFormattingRequest("request_java_formatting", request);
    validateRequest("request_java_formatting", request, false);
    if (typeof request.character !== "string" || [...request.character].length !== 1 ||
      request.character.includes("\0") || /^[\uD800-\uDFFF]$/u.test(request.character))
      throw invalidRequest("request_java_formatting", "Invalid Java formatting character");
    return this.request("request_java_formatting", request, "on-type-formatting");
  }

  hover(request: JavaHoverRequest): Promise<JavaHoverResponse> {
    return this.request("request_java_hover", request, "hover");
  }

  signatureHelp(request: JavaSignatureHelpRequest): Promise<JavaSignatureHelpResponse> {
    return this.request("request_java_signature_help", request, "signature");
  }

  documentSymbols(request: JavaDocumentSymbolsRequest): Promise<JavaDocumentSymbolsResponse> {
    return this.request(
      "request_java_document_symbols",
      { ...request, position: { line: 0, character: 0 } },
      "document-symbols",
    );
  }

  documentHighlights(
    request: JavaDocumentHighlightsRequest,
  ): Promise<JavaDocumentHighlightsResponse> {
    return this.request("request_java_document_highlights", request, "document-highlights");
  }

  implementations(request: JavaImplementationsRequest): Promise<JavaImplementationsResponse> {
    return this.request("request_java_implementations", request, "implementations");
  }

  definitions(request: JavaDefinitionsRequest): Promise<JavaDefinitionsResponse> {
    return this.request("request_java_definitions", request, "definitions");
  }

  typeDefinitions(request: JavaDefinitionsRequest): Promise<JavaDefinitionsResponse> {
    return this.request("request_java_type_definitions", request, "definitions");
  }

  async callHierarchy(request: JavaCallHierarchyRequest): Promise<JavaCallHierarchyResponse> {
    const command = "request_java_call_hierarchy";
    if (request.direction !== "incoming" && request.direction !== "outgoing")
      throw invalidRequest(command, "Invalid Java call-hierarchy direction");
    validateRequest(command, request, false);
    let response: unknown;
    try {
      response = await invoke<unknown>(command, {
        request: { ...nativeRequest(request, false), direction: request.direction },
      });
    } catch {
      return {
        ok: false,
        requestId: request.requestId,
        error: {
          kind: "unavailable",
          summary: "Java call-hierarchy provider is unavailable",
          retryable: true,
        },
      };
    }
    const encoded = JSON.stringify(response);
    if (encoded === undefined || new TextEncoder().encode(encoded).length > MAX_RESPONSE_BYTES)
      throw rejected(command);
    const native = record(command, response);
    const meta = metadata(command, native, request);
    if (typeof native.cancelled !== "boolean" || typeof native.timeout !== "boolean")
      throw rejected(command);
    if (native.cancelled || native.timeout || native.error !== null)
      return normalizeFailure(command, native, request);
    if (native.result === null || native.result === undefined) throw rejected(command);
    return {
      ok: true,
      requestId: request.requestId,
      result: normalizeCallHierarchyResult(command, native.result, meta, request.direction),
    };
  }

  references(request: JavaReferencesRequest): Promise<JavaReferencesResponse> {
    if (typeof request.includeDeclaration !== "boolean")
      throw invalidRequest("request_java_references", "Invalid Java references context");
    return this.request("request_java_references", request, "references");
  }

  semanticTokens(request: JavaSemanticTokensRequest): Promise<JavaSemanticTokensResponse> {
    return this.request(
      "request_java_semantic_tokens",
      { ...request, position: { line: 0, character: 0 } },
      "semantic-tokens",
    );
  }

  inlayHints(request: JavaInlayHintsRequest): Promise<JavaInlayHintsResponse> {
    validateInlayHintsRequest("request_java_inlay_hints", request);
    return this.request(
      "request_java_inlay_hints",
      { ...request, position: request.range.start },
      "inlay-hints",
    );
  }

  async workspaceSymbols(
    request: JavaWorkspaceSymbolsRequest,
  ): Promise<JavaWorkspaceSymbolsResponse> {
    const command = "request_java_workspace_symbols";
    const validated = validateWorkspaceSymbolsRequest(command, request);
    let response: unknown;
    try {
      response = await invoke<unknown>(command, { request: validated });
    } catch {
      return {
        ok: false,
        requestId: validated.requestId,
        error: {
          kind: "unavailable",
          summary: "Java workspace-symbol provider is unavailable",
          retryable: true,
        },
      };
    }
    let encoded: string;
    try {
      encoded = JSON.stringify(response);
    } catch {
      throw rejected(command);
    }
    if (new TextEncoder().encode(encoded).length > MAX_RESPONSE_BYTES) throw rejected(command);
    const native = record(command, response);
    const provider = native.provider;
    const providerVersion =
      native.providerVersion === null
        ? null
        : boundedString(command, native.providerVersion, MAX_PROVIDER_VERSION_LENGTH, false);
    const workspaceId = boundedString(command, native.workspaceId, MAX_WORKSPACE_ID_LENGTH, false);
    const generation = safeInteger(command, native.generation);
    const requestId = boundedString(command, native.requestId, MAX_ID_BYTES, false);
    if (
      (provider !== "jdtls" && provider !== "jdt-ls") ||
      workspaceId !== validated.workspaceId ||
      generation !== validated.generation ||
      requestId !== validated.requestId
    )
      throw rejected(command);
    if (typeof native.cancelled !== "boolean" || typeof native.timeout !== "boolean")
      throw rejected(command);
    if (native.cancelled || native.timeout || native.error !== null) {
      return normalizeFailure(command, native, validated);
    }
    if (native.result === null || native.result === undefined) throw rejected(command);
    return {
      ok: true,
      requestId: validated.requestId,
      result: normalizeWorkspaceSymbolsResult(command, native.result, {
        provider: "jdt-ls",
        providerVersion,
        workspaceId,
        generation,
      }),
    };
  }

  codeActions(request: JavaCodeActionsRequest): Promise<JavaCodeActionsResponse> {
    return this.request("request_java_code_actions", request, "code-actions");
  }

  rename(request: JavaRenameRequest): Promise<JavaRenameResponse> {
    return this.request("request_java_rename", request, "rename");
  }

  async cancel(cancellationId: LanguageServiceCancellationId): Promise<void> {
    const command = "cancel_java_semantic_request";
    if (!validId(cancellationId))
      throw invalidRequest(command, "Invalid Java semantic cancellation ID");
    try {
      await invoke<void>(command, { cancellationId });
    } catch {
      // Cancellation is idempotent and best-effort. Native details are intentionally discarded.
    }
  }
}
