import {
  isJavaGradleSettings,
  type DidChangeLanguageDocumentRequest,
  type DidCloseLanguageDocumentRequest,
  type DidOpenLanguageDocumentRequest,
  type DidSaveLanguageDocumentRequest,
  type RevalidateLanguageDocumentRequest,
  type DidSaveLanguageWorkspaceFileRequest,
  type LanguageDiagnostic,
  type LanguageServiceCapabilities,
  type LanguageServiceEvent,
  type LanguageServiceEventListener,
  type LanguageServiceProgress,
  type LanguageServiceState,
  type LanguageServiceStatus,
  type LanguageServiceUnsubscribe,
  type LanguageSessionTarget,
  type RestartLanguageSessionRequest,
  type StartLanguageSessionRequest,
  type StopLanguageSessionRequest,
  type VersionedLanguageDocument,
} from "@ide/contracts";
import type { DocumentSyncPort, LanguageSessionPort } from "@ide/web-core/ports";

import { TauriAdapterError, invokeTauri, toTauriAdapterError } from "./errors";

const POLL_COMMAND = "poll_java_language_service_events";
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_PATH_LENGTH = 4_096;
const MAX_DIAGNOSTICS = 200;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 4_096;
const MAX_RELATED_INFORMATION = 16;
const MAX_DIAGNOSTIC_URI_LENGTH = 4_096;
const MAX_MAVEN_PROFILES = 64;
const MAX_MAVEN_PROFILE_ID_LENGTH = 256;
const EMPTY_CAPABILITIES: LanguageServiceCapabilities = {
  documentSync: false,
  diagnostics: false,
  completion: false,
  hover: false,
  signature: false,
  definition: false,
  references: false,
  symbols: false,
  documentSymbols: false,
  documentHighlights: false,
  implementation: false,
  callHierarchy: false,
  workspaceSymbols: false,
  semanticTokens: false,
  inlayHints: false,
  rangeFormatting: false,
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
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(command: string, message: string, response: unknown): TauriAdapterError {
  return new TauriAdapterError(command, `Invalid ${command} response: ${message}`, response);
}

function requiredRecord(command: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(command, "expected object", value);
  return value;
}

function requiredString(command: string, response: unknown, value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw invalid(command, `invalid string ${field}`, response);
  }
  return value;
}

function optionalString(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(command, `invalid string ${field}`, response);
  return value || undefined;
}

function formatterProfile(
  command: string,
  response: unknown,
  value: unknown,
): StartLanguageSessionRequest["javaFormatterProfile"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    value.path.length > MAX_DOCUMENT_PATH_LENGTH ||
    value.path.trim() !== value.path ||
    /[\u0000-\u001f\u007f]/.test(value.path) ||
    value.path.startsWith("/") ||
    /^[A-Za-z]:/.test(value.path) ||
    value.path
      .replace(/\\/g, "/")
      .split("/")
      .some((part) => part === ".." || part === "." || part === "") ||
    !value.path.toLowerCase().endsWith(".xml") ||
    typeof value.profileName !== "string" ||
    value.profileName.length === 0 ||
    value.profileName.length > 256 ||
    value.profileName.trim() !== value.profileName ||
    /[\u0000-\u001f\u007f]/.test(value.profileName)
  ) {
    throw invalid(command, "invalid workspace Eclipse formatter profile", response);
  }
  return { path: value.path, profileName: value.profileName };
}

function integer(command: string, response: unknown, value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalid(command, `invalid non-negative integer ${field}`, response);
  }
  return value as number;
}

function booleanField(
  command: string,
  response: unknown,
  record: Record<string, unknown>,
  field: string,
): boolean {
  if (typeof record[field] !== "boolean")
    throw invalid(command, `invalid boolean ${field}`, response);
  return record[field] as boolean;
}

function mavenProfiles(
  command: string,
  response: unknown,
  value: unknown,
  field: string,
): string[] {
  if (!Array.isArray(value) || value.length > MAX_MAVEN_PROFILES) {
    throw invalid(command, `invalid ${field}`, response);
  }
  const profiles = value.map((profile) => {
    if (
      typeof profile !== "string" ||
      profile.length === 0 ||
      profile.length > MAX_MAVEN_PROFILE_ID_LENGTH ||
      profile.trim() !== profile ||
      profile.startsWith("!") ||
      profile.includes(",") ||
      /[\u0000-\u001f\u007f]/.test(profile)
    ) {
      throw invalid(command, `invalid ${field}`, response);
    }
    return profile;
  });
  if (new Set(profiles).size !== profiles.length) {
    throw invalid(command, `duplicate ${field}`, response);
  }
  return profiles;
}

function lifecycleState(
  command: string,
  response: unknown,
  lifecycle: unknown,
  available: boolean,
): LanguageServiceState {
  if (!available) return "unavailable";
  switch (lifecycle) {
    case "stopped":
      return "stopped";
    case "starting":
    case "initializing":
      return "starting";
    case "indexing":
      return "indexing";
    case "initialized":
    case "ready":
      return "ready";
    case "degraded":
      return "degraded";
    case "failed":
    case "error":
      return "failed";
    case "stopping":
      return "stopping";
    default:
      throw invalid(command, "unsupported lifecycle", response);
  }
}

function normalizeCapabilities(
  command: string,
  response: unknown,
  value: unknown,
  initialized: boolean,
): LanguageServiceCapabilities {
  if (!initialized || value === undefined || value === null) return { ...EMPTY_CAPABILITIES };
  const record = requiredRecord(command, value);
  const documentSync = booleanField(command, response, record, "documentSync");
  const diagnostics = booleanField(command, response, record, "diagnostics");
  const completion = booleanField(command, response, record, "completion");
  const hover = booleanField(command, response, record, "hover");
  const definition = booleanField(command, response, record, "definition");
  const references = booleanField(command, response, record, "references");
  const documentSymbols = booleanField(command, response, record, "documentSymbols");
  const documentHighlights = booleanField(command, response, record, "documentHighlights");
  const implementation = booleanField(command, response, record, "implementation");
  const callHierarchy =
    record.callHierarchy === undefined
      ? false
      : booleanField(command, response, record, "callHierarchy");
  const workspaceSymbols = booleanField(command, response, record, "workspaceSymbols");
  const semanticTokens = booleanField(command, response, record, "semanticTokens");
  const inlayHints =
    record.inlayHints === undefined ? false : booleanField(command, response, record, "inlayHints");
  const rename = booleanField(command, response, record, "rename");
  const codeActions = booleanField(command, response, record, "codeActions");
  const formatting = booleanField(command, response, record, "formatting");
  const rangeFormatting =
    record.rangeFormatting === undefined
      ? false
      : booleanField(command, response, record, "rangeFormatting");
  const signature = booleanField(command, response, record, "signatureHelp");
  const triggers = record.onTypeFormattingTriggers;
  if (triggers !== undefined && (!Array.isArray(triggers) || triggers.length > 16 ||
    triggers.some(value => typeof value !== "string" || [...value].length !== 1 || value.includes("\0") || /^[\uD800-\uDFFF]$/u.test(value)) ||
    new Set(triggers).size !== triggers.length))
    throw invalid(command, "Invalid Java on-type formatting triggers", response);
  return {
    documentSync,
    diagnostics,
    completion,
    hover,
    signature,
    definition,
    ...(record.typeDefinition === undefined ? {} : { typeDefinition: booleanField(command, response, record, "typeDefinition") }),
    references,
    symbols: documentSymbols || workspaceSymbols,
    documentSymbols,
    documentHighlights,
    implementation,
    callHierarchy,
    workspaceSymbols,
    semanticTokens,
    inlayHints,
    codeActions,
    formatting,
    rangeFormatting,
    ...(triggers === undefined ? {} : { onTypeFormattingTriggers: [...(triggers as string[])] }),
    rename,
    hierarchy: false,
  };
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function normalizeProvider(command: string, response: unknown, value: unknown): string {
  if (value === "jdtls" || value === "jdt-ls") return "jdt-ls";
  throw invalid(command, "unsupported provider", response);
}

function normalizeStatus(
  command: string,
  response: unknown,
  expectedWorkspaceId: string,
): { status: LanguageServiceStatus; workspaceRoot?: string } {
  const record = requiredRecord(command, response);
  if (typeof record.available !== "boolean")
    throw invalid(command, "invalid boolean available", response);
  const generation = integer(command, response, record.generation, "generation");
  const workspaceId = requiredString(command, response, record.workspaceId, "workspaceId");
  if (workspaceId !== expectedWorkspaceId) {
    throw invalid(command, `workspaceId did not match ${expectedWorkspaceId}`, response);
  }
  const state = lifecycleState(command, response, record.lifecycle, record.available);
  const provider = normalizeProvider(command, response, record.provider);
  const gradleImportEnabled = booleanField(command, response, record, "gradleImportEnabled");
  const gradleSettingsConfigured = booleanField(
    command,
    response,
    record,
    "gradleSettingsConfigured",
  );
  let projectPath: string | undefined;
  if (record.projectPath !== undefined && record.projectPath !== null) {
    if (
      typeof record.projectPath !== "string" ||
      record.projectPath.length > MAX_DOCUMENT_PATH_LENGTH ||
      record.projectPath.startsWith("/") ||
      /^[A-Za-z]:/.test(record.projectPath) ||
      /[\u0000-\u001f\u007f]/.test(record.projectPath) ||
      record.projectPath
        .replace(/\\/g, "/")
        .split("/")
        .some((part) => part === ".." || part === ".")
    ) {
      throw invalid(command, "invalid workspace-relative projectPath", response);
    }
    projectPath = record.projectPath;
  }
  const activeMavenProfiles = mavenProfiles(
    command,
    response,
    record.activeMavenProfiles,
    "activeMavenProfiles",
  );
  const inactiveMavenProfiles = mavenProfiles(
    command,
    response,
    record.inactiveMavenProfiles,
    "inactiveMavenProfiles",
  );
  if (activeMavenProfiles.some((profile) => inactiveMavenProfiles.includes(profile))) {
    throw invalid(command, "a Maven profile is both active and inactive", response);
  }
  const javaFormatterProfile = formatterProfile(command, response, record.javaFormatterProfile);
  const mavenRepository = optionalString(
    command,
    response,
    record.mavenRepository,
    "mavenRepository",
  );
  const serverVersion = optionalString(command, response, record.jdtlsVersion, "jdtlsVersion");
  const status: LanguageServiceStatus = {
    state,
    provider,
    workspaceId,
    generation,
    capabilities: normalizeCapabilities(
      command,
      response,
      record.capabilities,
      state === "ready" || state === "indexing" || state === "degraded",
    ),
    gradleImportEnabled,
    gradleSettingsConfigured,
    ...(projectPath !== undefined ? { projectPath } : {}),
    ...(mavenRepository !== undefined ? { mavenRepository } : {}),
    activeMavenProfiles,
    inactiveMavenProfiles,
    ...(javaFormatterProfile ? { javaFormatterProfile } : {}),
    checkedAt: validTimestamp(record.checkedAt) ?? new Date().toISOString(),
  };
  const serverPath = optionalString(command, response, record.jdtlsHome, "jdtlsHome");
  const javaExecutable = optionalString(command, response, record.javaExecutable, "javaExecutable");
  const javaVersion = optionalString(command, response, record.javaVersion, "javaVersion");
  const projectJdkHome = optionalString(command, response, record.projectJdkHome, "projectJdkHome");
  const serverJdkHome = optionalString(command, response, record.serverJdkHome, "serverJdkHome");
  const projectJdkVersion = optionalString(
    command,
    response,
    record.projectJdkVersion,
    "projectJdkVersion",
  );
  const detail = optionalString(command, response, record.detail, "detail");
  const workspaceRoot = optionalString(command, response, record.workspaceRoot, "workspaceRoot");
  if (serverVersion) {
    status.serverVersion = serverVersion;
    status.providerVersion = serverVersion;
  }
  if (serverPath) status.serverPath = serverPath;
  if (javaExecutable) status.javaExecutable = javaExecutable;
  if (javaVersion) status.javaVersion = javaVersion;
  if (projectJdkHome) status.projectJdkHome = projectJdkHome;
  if (serverJdkHome) status.serverJdkHome = serverJdkHome;
  if (projectJdkVersion) status.projectJdkVersion = projectJdkVersion;
  if (detail) status.lastError = detail;
  return { status, workspaceRoot };
}

function normalizeProgress(response: unknown): LanguageServiceProgress {
  const payload = requiredRecord(POLL_COMMAND, response);
  if (typeof payload.indexing === "boolean") {
    const progress: LanguageServiceProgress = { indexing: payload.indexing };
    if (typeof payload.message === "string" && payload.message) progress.message = payload.message;
    if (
      typeof payload.percentage === "number" &&
      Number.isFinite(payload.percentage) &&
      payload.percentage >= 0 &&
      payload.percentage <= 100
    )
      progress.percentage = payload.percentage;
    return progress;
  }
  const params = requiredRecord(POLL_COMMAND, payload.params);
  const value = requiredRecord(POLL_COMMAND, params.value);
  const kind = value.kind;
  if (kind !== "begin" && kind !== "report" && kind !== "end")
    throw invalid(POLL_COMMAND, "invalid progress kind", response);
  const progress: LanguageServiceProgress = { indexing: kind !== "end" };
  const message =
    typeof value.message === "string" && value.message
      ? value.message
      : typeof value.title === "string" && value.title
        ? value.title
        : undefined;
  if (message) progress.message = message;
  if (
    typeof value.percentage === "number" &&
    Number.isFinite(value.percentage) &&
    value.percentage >= 0 &&
    value.percentage <= 100
  )
    progress.percentage = value.percentage;
  return progress;
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^\/[A-Za-z]:\//.test(normalized) ? normalized.slice(1) : normalized;
}

function identityFromUri(
  response: unknown,
  workspaceId: string,
  workspaceRoot: string | undefined,
  uri: unknown,
): Omit<VersionedLanguageDocument, "version"> {
  const text = requiredString(POLL_COMMAND, response, uri, "diagnostics URI");
  if (text.length > MAX_DIAGNOSTIC_URI_LENGTH)
    throw invalid(POLL_COMMAND, "diagnostics URI is too long", response);
  if (!workspaceRoot)
    throw invalid(POLL_COMMAND, "workspace root is unknown for diagnostics", response);
  let pathname: string;
  try {
    const url = new URL(text);
    if (url.protocol !== "file:" || (url.hostname !== "" && url.hostname !== "localhost"))
      throw new Error("not a local file URI");
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw invalid(POLL_COMMAND, "invalid diagnostics file URI", response);
  }
  const root = normalizePath(workspaceRoot);
  const absolute = normalizePath(pathname);
  const prefix = `${root}/`;
  if (!absolute.startsWith(prefix)) {
    throw invalid(POLL_COMMAND, "diagnostics URI is outside the workspace", response);
  }
  const path = absolute.slice(prefix.length);
  if (
    !path ||
    path.length > MAX_DOCUMENT_PATH_LENGTH ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw invalid(POLL_COMMAND, "invalid diagnostics path", response);
  }
  return { workspaceId, path, uri: text };
}

function normalizePosition(
  response: unknown,
  value: unknown,
  field: string,
): { line: number; character: number } {
  const record = requiredRecord(POLL_COMMAND, value);
  return {
    line: integer(POLL_COMMAND, response, record.line, `${field}.line`),
    character: integer(POLL_COMMAND, response, record.character, `${field}.character`),
  };
}

function normalizeRange(
  response: unknown,
  value: unknown,
  field: string,
): LanguageDiagnostic["range"] {
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
  const severityMap = ["error", "warning", "information", "hint"] as const;
  const severityNumber = integer(POLL_COMMAND, response, record.severity, "diagnostic.severity");
  if (severityNumber < 1 || severityNumber > 4)
    throw invalid(POLL_COMMAND, "invalid diagnostic severity", response);
  const diagnostic: LanguageDiagnostic = {
    range: normalizeRange(response, record.range, "diagnostic.range"),
    severity: severityMap[severityNumber - 1],
    message: requiredString(POLL_COMMAND, response, record.message, "diagnostic.message"),
  };
  if (diagnostic.message.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH)
    throw invalid(POLL_COMMAND, "diagnostic message is too long", response);
  if (
    typeof record.code === "string" ||
    (typeof record.code === "number" && Number.isSafeInteger(record.code))
  )
    diagnostic.code = record.code;
  if (typeof record.source === "string" && record.source.length <= 256)
    diagnostic.source = record.source;
  if (record.relatedInformation !== undefined) {
    if (!Array.isArray(record.relatedInformation))
      throw invalid(POLL_COMMAND, "invalid diagnostic relatedInformation", response);
    diagnostic.relatedInformation = record.relatedInformation
      .slice(0, MAX_RELATED_INFORMATION)
      .map((item) => {
        const related = requiredRecord(POLL_COMMAND, item);
        const location = requiredRecord(POLL_COMMAND, related.location);
        const message = requiredString(
          POLL_COMMAND,
          response,
          related.message,
          "relatedInformation.message",
        );
        if (message.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH)
          throw invalid(POLL_COMMAND, "related information message is too long", response);
        return {
          message,
          location: {
            document: identityFromUri(response, workspaceId, workspaceRoot, location.uri),
            range: normalizeRange(response, location.range, "relatedInformation.range"),
          },
        };
      });
  }
  return diagnostic;
}

function validJavaPath(path: string): boolean {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= MAX_DOCUMENT_PATH_LENGTH &&
    !path.startsWith("/") &&
    !path.startsWith("\\") &&
    !/^[A-Za-z]:/.test(path) &&
    !/[\u0000-\u001f\u007f]/.test(path) &&
    path.split(/[\\/]/).every((part) => part !== "" && part !== "." && part !== "..") &&
    path.endsWith(".java")
  );
}

function documentSyncError(
  command: string,
  error: unknown,
  sourceText: string | undefined,
): TauriAdapterError {
  const normalized = toTauriAdapterError(command, error);
  let message = normalized.message.replace(/^\[tauri:[^\]]+\]\s*/, "");
  if (sourceText) message = message.split(sourceText).join("[source redacted]");
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
    this.hiddenPollIntervalMs = Math.max(
      this.pollIntervalMs,
      options.hiddenPollIntervalMs ?? 1_000,
    );
    this.maxBackoffMs = Math.max(this.pollIntervalMs, options.maxBackoffMs ?? 5_000);
    this.pollLimit = Math.min(100, Math.max(1, Math.floor(options.pollLimit ?? 100)));
  }

  private async lifecycle(
    command: string,
    workspaceId: string,
    request?: {
      workspaceId: string;
      generation?: number;
      projectJdkHome?: string;
      serverJdkHome?: string;
      gradleImportEnabled?: boolean;
      projectPath?: string;
      mavenRepository?: string;
      activeMavenProfiles?: string[];
      inactiveMavenProfiles?: string[];
      gradle?: StartLanguageSessionRequest["gradle"];
      javaFormatterProfile?: StartLanguageSessionRequest["javaFormatterProfile"];
    },
  ): Promise<LanguageServiceStatus> {
    try {
      if (
        request?.gradleImportEnabled !== undefined &&
        typeof request.gradleImportEnabled !== "boolean"
      ) {
        throw invalid(command, "invalid Gradle import authorization", request);
      }
      if (
        request?.projectJdkHome !== undefined &&
        (typeof request.projectJdkHome !== "string" ||
          request.projectJdkHome.length === 0 ||
          request.projectJdkHome.length > 4096 ||
          request.projectJdkHome.includes("\0"))
      ) {
        throw invalid(command, "invalid project JDK home", request);
      }
      if (
        request?.serverJdkHome !== undefined &&
        (typeof request.serverJdkHome !== "string" ||
          request.serverJdkHome.length === 0 ||
          request.serverJdkHome.length > 4096 ||
          request.serverJdkHome.trim() !== request.serverJdkHome ||
          !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(request.serverJdkHome) ||
          /[\u0000-\u001f\u007f]/.test(request.serverJdkHome))
      ) {
        throw invalid(command, "invalid JDT LS runtime JDK home", request);
      }
      if (
        request?.projectPath !== undefined &&
        (typeof request.projectPath !== "string" ||
          request.projectPath.length > MAX_DOCUMENT_PATH_LENGTH ||
          request.projectPath.startsWith("/") ||
          /^[A-Za-z]:/.test(request.projectPath) ||
          /[\u0000-\u001f\u007f]/.test(request.projectPath) ||
          request.projectPath
            .replace(/\\/g, "/")
            .split("/")
            .some((part) => part === ".." || part === "."))
      ) {
        throw invalid(command, "invalid workspace-relative projectPath", request);
      }
      if (
        request?.mavenRepository !== undefined &&
        (typeof request.mavenRepository !== "string" ||
          request.mavenRepository.length > MAX_DOCUMENT_PATH_LENGTH ||
          request.mavenRepository.includes("\0") ||
          /[\u0000-\u001f\u007f]/.test(request.mavenRepository))
      ) {
        throw invalid(command, "invalid Maven local repository", request);
      }
      if (request?.activeMavenProfiles !== undefined) {
        mavenProfiles(command, request, request.activeMavenProfiles, "activeMavenProfiles");
      }
      if (request?.inactiveMavenProfiles !== undefined) {
        mavenProfiles(command, request, request.inactiveMavenProfiles, "inactiveMavenProfiles");
      }
      if (request?.gradle !== undefined && !isJavaGradleSettings(request.gradle)) {
        throw invalid(command, "invalid Gradle project settings", request);
      }
      if (request?.javaFormatterProfile !== undefined) {
        formatterProfile(command, request, request.javaFormatterProfile);
      }
      if (
        request?.activeMavenProfiles?.some((profile) =>
          request.inactiveMavenProfiles?.includes(profile),
        )
      ) {
        throw invalid(command, "a Maven profile is both active and inactive", request);
      }
      const response = await invokeTauri<unknown>(command, request ? { request } : undefined);
      const normalized = normalizeStatus(command, response, workspaceId);
      if (
        request &&
        command !== "stop_java_language_service" &&
        ["ready", "indexing", "degraded"].includes(normalized.status.state) &&
        normalized.status.projectJdkHome !== request.projectJdkHome
      ) {
        throw invalid(command, "project JDK selection was not applied", response);
      }
      if (
        request &&
        command !== "stop_java_language_service" &&
        ["ready", "indexing", "degraded"].includes(normalized.status.state) &&
        (normalized.status.serverJdkHome ?? "") !== (request.serverJdkHome ?? "")
      ) {
        throw invalid(command, "JDT LS runtime JDK selection was not applied", response);
      }
      if (
        request &&
        command !== "stop_java_language_service" &&
        ["ready", "indexing", "degraded"].includes(normalized.status.state) &&
        normalized.status.gradleImportEnabled !== (request.gradleImportEnabled ?? false)
      ) {
        throw invalid(command, "Gradle import authorization was not applied", response);
      }
      if (
        request &&
        command !== "stop_java_language_service" &&
        ["ready", "indexing", "degraded"].includes(normalized.status.state) &&
        normalized.status.gradleSettingsConfigured !== (request.gradle !== undefined)
      ) {
        throw invalid(command, "Gradle project settings were not applied", response);
      }
      if (
        request &&
        request.projectPath !== undefined &&
        command !== "stop_java_language_service" &&
        ["ready", "indexing", "degraded"].includes(normalized.status.state) &&
        normalized.status.projectPath !== (request.projectPath ?? "")
      ) {
        throw invalid(command, "selected Java project path was not applied", response);
      }
      if (
        request &&
        request.mavenRepository !== undefined &&
        command !== "stop_java_language_service" &&
        ["ready", "indexing", "degraded"].includes(normalized.status.state) &&
        (normalized.status.mavenRepository ?? "") !== request.mavenRepository
      ) {
        throw invalid(command, "selected Maven local repository was not applied", response);
      }
      if (
        request &&
        command !== "stop_java_language_service" &&
        ["ready", "indexing", "degraded"].includes(normalized.status.state) &&
        (JSON.stringify(normalized.status.activeMavenProfiles) !==
          JSON.stringify(request.activeMavenProfiles ?? []) ||
          JSON.stringify(normalized.status.inactiveMavenProfiles) !==
            JSON.stringify(request.inactiveMavenProfiles ?? []))
      ) {
        throw invalid(command, "Maven profile selection was not applied", response);
      }
      if (
        request &&
        command !== "stop_java_language_service" &&
        ["ready", "indexing", "degraded"].includes(normalized.status.state) &&
        JSON.stringify(normalized.status.javaFormatterProfile ?? null) !==
          JSON.stringify(request.javaFormatterProfile ?? null)
      ) {
        throw invalid(command, "Eclipse formatter profile was not applied", response);
      }
      const previous = this.statuses.get(workspaceId);
      this.statuses.set(workspaceId, normalized.status);
      if (
        (previous && previous.generation !== normalized.status.generation) ||
        !["ready", "indexing", "degraded"].includes(normalized.status.state)
      )
        this.clearDocumentVersions(workspaceId);
      if (normalized.workspaceRoot) this.workspaceRoots.set(workspaceId, normalized.workspaceRoot);
      return normalized.status;
    } catch (error) {
      throw toTauriAdapterError(command, error);
    }
  }

  getStatus(target: LanguageSessionTarget): Promise<LanguageServiceStatus> {
    return this.lifecycle("get_java_language_service_status", target.workspaceId);
  }

  private lifecycleMutation: Promise<void> = Promise.resolve();

  private mutateSession(
    command: string,
    request: {
      workspaceId: string;
      generation?: number;
      projectJdkHome?: string;
      serverJdkHome?: string;
      gradleImportEnabled?: boolean;
      projectPath?: string;
      mavenRepository?: string;
      activeMavenProfiles?: string[];
      inactiveMavenProfiles?: string[];
      gradle?: StartLanguageSessionRequest["gradle"];
      javaFormatterProfile?: StartLanguageSessionRequest["javaFormatterProfile"];
    },
  ): Promise<LanguageServiceStatus> {
    // Native lifecycle workers own one process. Preserve submission order so an older
    // JDK replacement cannot acquire the native mutex after a newer replacement.
    const operation = this.lifecycleMutation.then(() =>
      this.lifecycle(command, request.workspaceId, request),
    );
    this.lifecycleMutation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  start(request: StartLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return this.mutateSession("start_java_language_service", {
      workspaceId: request.workspaceId,
      ...(request.projectJdkHome !== undefined ? { projectJdkHome: request.projectJdkHome } : {}),
      ...(request.serverJdkHome !== undefined ? { serverJdkHome: request.serverJdkHome } : {}),
      gradleImportEnabled: request.gradleImportEnabled,
      ...(request.projectPath !== undefined ? { projectPath: request.projectPath } : {}),
      ...(request.mavenRepository !== undefined
        ? { mavenRepository: request.mavenRepository }
        : {}),
      ...(request.activeMavenProfiles !== undefined
        ? { activeMavenProfiles: request.activeMavenProfiles }
        : {}),
      ...(request.inactiveMavenProfiles !== undefined
        ? { inactiveMavenProfiles: request.inactiveMavenProfiles }
        : {}),
      ...(request.gradle !== undefined ? { gradle: request.gradle } : {}),
      ...(request.javaFormatterProfile !== undefined
        ? { javaFormatterProfile: request.javaFormatterProfile }
        : {}),
    });
  }

  stop(request: StopLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return this.mutateSession("stop_java_language_service", {
      workspaceId: request.workspaceId,
      generation: request.generation,
    });
  }

  restart(request: RestartLanguageSessionRequest): Promise<LanguageServiceStatus> {
    return this.mutateSession("restart_java_language_service", {
      workspaceId: request.workspaceId,
      generation: request.generation,
      ...(request.projectJdkHome !== undefined ? { projectJdkHome: request.projectJdkHome } : {}),
      ...(request.serverJdkHome !== undefined ? { serverJdkHome: request.serverJdkHome } : {}),
      gradleImportEnabled: request.gradleImportEnabled,
      ...(request.projectPath !== undefined ? { projectPath: request.projectPath } : {}),
      ...(request.mavenRepository !== undefined
        ? { mavenRepository: request.mavenRepository }
        : {}),
      ...(request.activeMavenProfiles !== undefined
        ? { activeMavenProfiles: request.activeMavenProfiles }
        : {}),
      ...(request.inactiveMavenProfiles !== undefined
        ? { inactiveMavenProfiles: request.inactiveMavenProfiles }
        : {}),
      ...(request.gradle !== undefined ? { gradle: request.gradle } : {}),
      ...(request.javaFormatterProfile !== undefined
        ? { javaFormatterProfile: request.javaFormatterProfile }
        : {}),
    });
  }

  didOpen(request: DidOpenLanguageDocumentRequest): Promise<void> {
    return this.syncDocument("open_java_language_document", "open", request.document);
  }

  didChange(request: DidChangeLanguageDocumentRequest): Promise<void> {
    return this.syncDocument("change_java_language_document", "change", request.document);
  }

  didSave(request: DidSaveLanguageDocumentRequest): Promise<void> {
    return this.syncDocument("save_java_language_document", "save", request.document);
  }

  didClose(request: DidCloseLanguageDocumentRequest): Promise<void> {
    return this.syncDocument("close_java_language_document", "close", request.document);
  }

  revalidate(request: RevalidateLanguageDocumentRequest): Promise<void> {
    return this.syncDocument("revalidate_java_language_document", "revalidate", request.document);
  }

  async didSaveWorkspaceFile({ document }: DidSaveLanguageWorkspaceFileRequest): Promise<void> {
    const command = "notify_java_language_workspace_file_saved";
    const status = this.statuses.get(document.workspaceId);
    if (!status || !["ready", "indexing", "degraded"].includes(status.state))
      throw new TauriAdapterError(command, "Workspace file notifications require an initialized session");
    const identity = identityFromUri(document, document.workspaceId, this.workspaceRoots.get(document.workspaceId), document.uri);
    if (identity.path !== document.path || /[\u0000-\u001f\u007f]/.test(document.path))
      throw new TauriAdapterError(command, "Workspace file path and URI do not match");
    await invokeTauri<void>(command, { document: { ...identity, generation: status.generation } });
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
    action: "open" | "change" | "save" | "close" | "revalidate",
    document:
      DidOpenLanguageDocumentRequest["document"] | DidCloseLanguageDocumentRequest["document"],
  ): Promise<void> {
    const status = this.statuses.get(document.workspaceId);
    if (
      !status ||
      !["ready", "indexing", "degraded"].includes(status.state) ||
      !status.capabilities.documentSync
    ) {
      throw new TauriAdapterError(
        command,
        "Java document synchronization requires an initialized session",
      );
    }
    if (!Number.isSafeInteger(document.version) || document.version < 0) {
      throw new TauriAdapterError(command, "Document version must be a non-negative safe integer");
    }
    if (!validJavaPath(document.path))
      throw new TauriAdapterError(command, "Invalid workspace-relative Java document path");
    if (
      typeof document.uri !== "string" ||
      document.uri.length === 0 ||
      document.uri.length > MAX_DIAGNOSTIC_URI_LENGTH
    ) {
      throw new TauriAdapterError(command, "Invalid Java document URI");
    }
    const fullDocument =
      action === "close" || action === "revalidate"
        ? undefined
        : (document as DidOpenLanguageDocumentRequest["document"]);
    if (fullDocument) {
      if (fullDocument.languageId !== "java")
        throw new TauriAdapterError(command, "Only the Java language is supported");
      if (
        typeof fullDocument.text !== "string" ||
        new TextEncoder().encode(fullDocument.text).length > MAX_DOCUMENT_BYTES
      ) {
        throw new TauriAdapterError(command, "Document exceeds the synchronization byte limit");
      }
    }
    const key = this.documentVersionKey(document.workspaceId, document.path);
    const currentVersion = this.documentVersions.get(key);
    if (action === "open" && currentVersion !== undefined)
      throw new TauriAdapterError(command, "Document is already open");
    if (
      action === "change" &&
      (currentVersion === undefined || document.version <= currentVersion)
    ) {
      throw new TauriAdapterError(command, "Document change version must be strictly increasing");
    }
    if (
      (action === "save" || action === "close" || action === "revalidate") &&
      (currentVersion === undefined || document.version !== currentVersion)
    ) {
      throw new TauriAdapterError(
        command,
        `Document ${action} version must equal the current version`,
      );
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
    if (action === "close") this.documentVersions.delete(key);
    try {
      await invokeTauri<void>(command, { document: nativeDocument });
    } catch (error) {
      throw documentSyncError(command, error, fullDocument?.text);
    }
    const currentStatus = this.statuses.get(document.workspaceId);
    if (
      action !== "close" &&
      action !== "revalidate" &&
      currentStatus?.generation === status.generation &&
      ["ready", "indexing", "degraded"].includes(currentStatus.state)
    )
      this.documentVersions.set(key, document.version);
  }

  subscribe(
    workspaceId: string,
    listener: LanguageServiceEventListener,
  ): LanguageServiceUnsubscribe {
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
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const base = hidden ? this.hiddenPollIntervalMs : this.pollIntervalMs;
    return Math.min(this.maxBackoffMs, base * 2 ** Math.min(this.failures, 5));
  }

  private emit(workspaceId: string, event: LanguageServiceEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active || subscription.workspaceId !== workspaceId) continue;
      try {
        subscription.listener(event);
      } catch {
        /* A listener cannot terminate polling. */
      }
    }
  }

  private surfaceError(error: unknown): void {
    const adapterError = toTauriAdapterError(POLL_COMMAND, error);
    const workspaceIds = new Set(
      Array.from(this.subscriptions.values(), (item) => item.workspaceId),
    );
    for (const workspaceId of workspaceIds) {
      const cached = this.statuses.get(workspaceId);
      const status: LanguageServiceStatus = cached
        ? {
            ...cached,
            state: cached.state === "ready" ? "degraded" : cached.state,
            lastError: adapterError.message,
            checkedAt: new Date().toISOString(),
          }
        : {
            state: "failed",
            provider: "jdt-ls",
            workspaceId,
            generation: 0,
            gradleImportEnabled: false,
            gradleSettingsConfigured: false,
            activeMavenProfiles: [],
            inactiveMavenProfiles: [],
            capabilities: { ...EMPTY_CAPABILITIES },
            lastError: adapterError.message,
            checkedAt: new Date().toISOString(),
          };
      this.emit(workspaceId, { type: "status", status });
    }
  }

  private parseBatch(response: unknown): { events: NativeEvent[]; latestSequence: number } {
    const batch = requiredRecord(POLL_COMMAND, response);
    if (!Array.isArray(batch.events)) throw invalid(POLL_COMMAND, "invalid events array", response);
    const latestSequence = integer(POLL_COMMAND, response, batch.latestSequence, "latestSequence");
    const events = batch.events.map((value): NativeEvent => {
      const event = requiredRecord(POLL_COMMAND, value);
      return {
        sequence: integer(POLL_COMMAND, response, event.sequence, "event.sequence"),
        generation: integer(POLL_COMMAND, response, event.generation, "event.generation"),
        kind: requiredString(POLL_COMMAND, response, event.kind, "event.kind"),
        payload: event.payload,
      };
    });
    return { events, latestSequence };
  }

  private workspaceForEvent(generation: number): string | undefined {
    for (const [workspaceId, status] of this.statuses) {
      if (status.generation === generation) return workspaceId;
    }
    const workspaceIds = new Set(
      Array.from(this.subscriptions.values(), (item) => item.workspaceId),
    );
    return workspaceIds.size === 1 ? workspaceIds.values().next().value : undefined;
  }

  private normalizeEvent(
    nativeEvent: NativeEvent,
  ): { workspaceId: string; event: LanguageServiceEvent } | undefined {
    const workspaceId = this.workspaceForEvent(nativeEvent.generation);
    if (!workspaceId) throw invalid(POLL_COMMAND, "event workspace is ambiguous", nativeEvent);
    const cached = this.statuses.get(workspaceId);
    if (cached && nativeEvent.generation < cached.generation) return undefined;
    const provider = cached?.provider ?? "jdt-ls";

    if (nativeEvent.kind === "status") {
      const payload = requiredRecord(POLL_COMMAND, nativeEvent.payload);
      const available = cached?.state !== "unavailable";
      const state = lifecycleState(POLL_COMMAND, nativeEvent.payload, payload.lifecycle, available);
      const status: LanguageServiceStatus = {
        ...(cached ?? {
          provider,
          workspaceId,
          gradleImportEnabled: false,
          gradleSettingsConfigured: false,
          activeMavenProfiles: [],
          inactiveMavenProfiles: [],
          capabilities: { ...EMPTY_CAPABILITIES },
          checkedAt: new Date().toISOString(),
        }),
        state,
        generation: nativeEvent.generation,
        checkedAt: new Date().toISOString(),
      };
      status.capabilities = normalizeCapabilities(
        POLL_COMMAND,
        nativeEvent.payload,
        payload.capabilities,
        state === "ready" || state === "indexing" || state === "degraded",
      );
      const detail = optionalString(POLL_COMMAND, nativeEvent.payload, payload.detail, "detail");
      if (detail) status.lastError = detail;
      else if (state !== "failed") delete status.lastError;
      if (
        cached?.generation !== status.generation ||
        !["ready", "indexing", "degraded"].includes(status.state)
      )
        this.clearDocumentVersions(workspaceId);
      this.statuses.set(workspaceId, status);
      return { workspaceId, event: { type: "status", status } };
    }
    if (nativeEvent.kind === "progress") {
      return {
        workspaceId,
        event: {
          type: "progress",
          workspaceId,
          generation: nativeEvent.generation,
          provider,
          progress: normalizeProgress(nativeEvent.payload),
        },
      };
    }
    if (nativeEvent.kind === "diagnostics") {
      const payload = requiredRecord(POLL_COMMAND, nativeEvent.payload);
      const params = requiredRecord(POLL_COMMAND, payload.params);
      if (cached === undefined || nativeEvent.generation !== cached.generation) return undefined;
      if (payload.workspaceId !== workspaceId || payload.generation !== nativeEvent.generation) {
        throw invalid(
          POLL_COMMAND,
          "diagnostics workspace or generation mismatch",
          nativeEvent.payload,
        );
      }
      if (!Array.isArray(params.diagnostics))
        throw invalid(POLL_COMMAND, "invalid diagnostics array", nativeEvent.payload);
      // Resolve and authorize the URI before consulting synchronization state.
      const identity = identityFromUri(
        nativeEvent.payload,
        workspaceId,
        this.workspaceRoots.get(workspaceId),
        params.uri,
      );
      let version: number;
      if (params.version === undefined) {
        // JDT LS can omit version despite advertising versionSupport. Such an event
        // carries no ordering evidence, so receipt associates it only with the exact
        // workspace/path version that is synchronized at this instant.
        const synchronizedVersion = this.documentVersions.get(
          this.documentVersionKey(workspaceId, identity.path),
        );
        if (synchronizedVersion === undefined) return undefined;
        version = synchronizedVersion;
      } else {
        version = integer(
          POLL_COMMAND,
          nativeEvent.payload,
          params.version,
          "diagnostics.params.version",
        );
      }
      const document: VersionedLanguageDocument = { ...identity, version };
      const unavailableReason = optionalString(POLL_COMMAND, nativeEvent.payload, params.unavailableReason, "unavailableReason");
      if (unavailableReason && (unavailableReason.length > 4096 || params.diagnostics.length !== 0))
        throw invalid(POLL_COMMAND, "invalid diagnostic unavailability", nativeEvent.payload);
      const diagnostics = params.diagnostics
        .slice(0, MAX_DIAGNOSTICS)
        .map((item) =>
          normalizeDiagnostic(
            nativeEvent.payload,
            item,
            workspaceId,
            this.workspaceRoots.get(workspaceId),
          ),
        );
      return {
        workspaceId,
        event: {
          type: "diagnostics",
          workspaceId,
          generation: nativeEvent.generation,
          provider,
          document,
          diagnostics,
          ...(unavailableReason ? { unavailableReason } : {}),
        },
      };
    }
    return undefined;
  }

  private async poll(): Promise<void> {
    if (this.polling || this.subscriptions.size === 0) return;
    this.polling = true;
    try {
      const response = await invokeTauri<unknown>(POLL_COMMAND, {
        afterSequence: this.sequence,
        limit: this.pollLimit,
      });
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
      this.sequence =
        last === this.sequence && batch.events.length === 0
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
