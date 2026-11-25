// ---------------------------------------------------------------------------
// @ide/contracts – Provider-neutral language-service types
// ---------------------------------------------------------------------------
// Source-only contracts for managed, workspace-scoped language services.
// These types intentionally do not expose JDT LS or raw LSP wire types.

import type { JavaGradleSettings } from "./java-project-context";
import type { JavaFormatterProfile } from "./editor";

/** Lifecycle and availability state of a managed language-service session. */
export type LanguageServiceState =
  | "unavailable"
  | "stopped"
  | "starting"
  | "indexing"
  | "ready"
  | "degraded"
  | "failed"
  | "stopping";

/** Stable identifier assigned to a request crossing a language-service boundary. */
export type LanguageServiceRequestId = string;

/** Identifier adapters may use to cancel a pending operation. */
export type LanguageServiceCancellationId = string;

/** Optional request correlation and cancellation metadata. */
export interface LanguageServiceRequestContext {
  requestId?: LanguageServiceRequestId;
  cancellationId?: LanguageServiceCancellationId;
}

/**
 * Capabilities confirmed by the initialized provider.
 *
 * Every flag must remain `false` until server initialization has completed and
 * the concrete adapter has confirmed support. A configured provider is not, by
 * itself, evidence that a capability is available.
 */
export interface LanguageServiceCapabilities {
  documentSync: boolean;
  diagnostics: boolean;
  completion: boolean;
  hover: boolean;
  signature: boolean;
  definition: boolean;
  typeDefinition?: boolean;
  references: boolean;
  symbols: boolean;
  /** Exact support for current-document outline requests; optional for older adapters. */
  documentSymbols?: boolean;
  /** Exact support for same-document symbol occurrence highlights; optional for older adapters. */
  documentHighlights?: boolean;
  /** Exact support for Java implementation queries; optional for older adapters. */
  implementation?: boolean;
  /** Exact support for caller/callee queries on the synchronized Java document. */
  callHierarchy?: boolean;
  /** Exact support for workspace-wide symbol search; optional for older adapters. */
  workspaceSymbols?: boolean;
  /** Exact support for full-document semantic tokens; optional for older adapters. */
  semanticTokens?: boolean;
  /** Exact support for range-based Java inlay hints; optional for older adapters. */
  inlayHints?: boolean;
  /** Exact support for formatting only the selected range; optional for older adapters. */
  rangeFormatting?: boolean;
  /** Characters advertised by the server for formatting after typing. */
  onTypeFormattingTriggers?: string[];
  codeActions: boolean;
  formatting: boolean;
  rename: boolean;
  hierarchy: boolean;
}

/** Indexing or other long-running provider progress. */
export interface LanguageServiceProgress {
  /** Whether the provider is currently indexing the workspace. */
  indexing: boolean;
  /** Human-readable, provider-normalized progress description. */
  message?: string;
  /** Completion percentage in the inclusive range 0–100, when known. */
  percentage?: number;
}

/** Provider and tool status for one workspace-scoped session generation. */
export interface LanguageServiceStatus {
  /** Normalized lifecycle state; `unavailable` also represents failed discovery. */
  state: LanguageServiceState;
  /** Provider identifier, for example `jdt-ls`; never implies provider ownership. */
  provider: string;
  providerVersion?: string;
  /** Resolved Java executable used to launch the service, when discovered. */
  javaExecutable?: string;
  javaVersion?: string;
  /** Explicit full JDK home selected to launch the language server, when configured. */
  serverJdkHome?: string;
  /** Project JDK selection; separate from the Java runtime launching the service. */
  projectJdkHome?: string;
  projectJdkVersion?: string;
  /** Whether this session may import Gradle projects and execute their build scripts. */
  gradleImportEnabled: boolean;
  /** Whether this session has the Java Project panel's selected Gradle settings. */
  gradleSettingsConfigured: boolean;
  /** Workspace-relative RefactorKit project whose Maven profiles feed this session. */
  projectPath?: string;
  /** Selected Maven local repository applied to JDT LS project import. */
  mavenRepository?: string;
  /** Active Maven profiles applied to JDT LS Maven projects in this session. */
  activeMavenProfiles: string[];
  /** Inactive Maven profiles applied to JDT LS Maven projects in this session. */
  inactiveMavenProfiles: string[];
  /** Workspace-relative Eclipse formatter profile applied to this JDT LS session. */
  javaFormatterProfile?: JavaFormatterProfile;
  /** Resolved external language-server installation or executable path. */
  serverPath?: string;
  serverVersion?: string;
  /** Stable identity of the authorized workspace owning this session. */
  workspaceId: string;
  /** Monotonically increasing generation used to reject stale session events. */
  generation: number;
  /** Current indexing/progress information, when a task is active or known. */
  progress?: LanguageServiceProgress;
  /** Capabilities confirmed by initialization; all flags are false beforehand. */
  capabilities: LanguageServiceCapabilities;
  /** Last normalized provider/tool error message, when any. */
  lastError?: string;
  /** ISO-8601 timestamp at which this status snapshot was checked. */
  checkedAt: string;
}

/**
 * A position using LSP-style, zero-based line and character offsets.
 *
 * This differs from `CursorPosition` and `RefactorKitLocation`, whose line and
 * column values are 1-based. Adapters must convert explicitly at those edges.
 */
export interface LanguagePosition {
  line: number;
  character: number;
}

/** A zero-based, end-exclusive source range suitable for Monaco/LSP mapping. */
export interface LanguageRange {
  start: LanguagePosition;
  end: LanguagePosition;
}

/** Authorized identity of a document inside one workspace. */
export interface LanguageDocumentIdentity {
  workspaceId: string;
  /** Validated, workspace-relative path; absolute and escaping paths are forbidden. */
  path: string;
  /** Authorized document URI corresponding to `path`. */
  uri: string;
}

/** Versioned document identity used when full text is unnecessary. */
export interface VersionedLanguageDocument extends LanguageDocumentIdentity {
  /** Monotonically increasing version within this open-document lifecycle. */
  version: number;
}

/** Full synchronized document snapshot. Phase 1 uses full-text synchronization. */
export interface LanguageDocument extends VersionedLanguageDocument {
  languageId: string;
  text: string;
}

/** Provider-neutral source location; coordinates are zero-based. */
export interface LanguageLocation {
  document: LanguageDocumentIdentity;
  range: LanguageRange;
}

export type LanguageDiagnosticSeverity = "error" | "warning" | "information" | "hint";

/** Related location attached to a diagnostic. */
export interface LanguageDiagnosticRelatedInformation {
  location: LanguageLocation;
  message: string;
}

/** Provider-neutral diagnostic suitable for later Monaco marker mapping. */
export interface LanguageDiagnostic {
  range: LanguageRange;
  severity: LanguageDiagnosticSeverity;
  message: string;
  /** Provider-defined stable code, normalized to a transport-safe primitive. */
  code?: string | number;
  /** Human-readable diagnostic source, such as a compiler or analyzer name. */
  source?: string;
  relatedInformation?: LanguageDiagnosticRelatedInformation[];
}

export interface DidOpenLanguageDocumentRequest extends LanguageServiceRequestContext {
  document: LanguageDocument;
}

/** Full-text change; `document.version` must be greater than the prior version. */
export interface DidChangeLanguageDocumentRequest extends LanguageServiceRequestContext {
  document: LanguageDocument;
}

/** Save notification carrying the authoritative full text and current version. */
export interface DidSaveLanguageDocumentRequest extends LanguageServiceRequestContext {
  document: LanguageDocument;
}

export interface DidCloseLanguageDocumentRequest extends LanguageServiceRequestContext {
  document: VersionedLanguageDocument;
}

/** Recompute diagnostics for the current open version without saving or changing text. */
export interface RevalidateLanguageDocumentRequest extends LanguageServiceRequestContext {
  document: VersionedLanguageDocument;
}

/** A workspace file was saved; the provider may refresh its imported configuration. */
export interface DidSaveLanguageWorkspaceFileRequest extends LanguageServiceRequestContext {
  document: LanguageDocumentIdentity;
}

/** Target for querying one workspace's current session status. */
export interface LanguageSessionTarget {
  workspaceId: string;
}

export interface StartLanguageSessionRequest extends LanguageServiceRequestContext {
  workspaceId: string;
  /** Full JDK used for Java project analysis. Omission restores provider discovery. */
  projectJdkHome?: string;
  /** Full JDK used to launch JDT LS. Omission uses IDE_JDTLS_JAVA_HOME and normal discovery. */
  serverJdkHome?: string;
  /** Explicit, session-only authorization for JDT LS Gradle project import. */
  gradleImportEnabled: boolean;
  /** Workspace-relative project selected in the Java Project panel. */
  projectPath?: string;
  /** Selected Maven local repository used when importing Maven projects. */
  mavenRepository?: string;
  activeMavenProfiles?: string[];
  inactiveMavenProfiles?: string[];
  /** Selected Gradle tool and user settings used if this session imports Gradle projects. */
  gradle?: JavaGradleSettings;
  /** Optional workspace-contained Eclipse formatter profile XML and selected profile name. */
  javaFormatterProfile?: JavaFormatterProfile;
}

/** Generation prevents a stale caller from stopping a replacement session. */
export interface StopLanguageSessionRequest extends LanguageServiceRequestContext {
  workspaceId: string;
  generation: number;
}

/** Generation identifies the session that should be replaced. */
export interface RestartLanguageSessionRequest extends LanguageServiceRequestContext {
  workspaceId: string;
  generation: number;
  projectJdkHome?: string;
  /** Full JDK used to launch JDT LS. Omission uses IDE_JDTLS_JAVA_HOME and normal discovery. */
  serverJdkHome?: string;
  /** Explicit, session-only authorization for JDT LS Gradle project import. */
  gradleImportEnabled: boolean;
  /** Workspace-relative project selected in the Java Project panel. */
  projectPath?: string;
  /** Selected Maven local repository used when importing Maven projects. */
  mavenRepository?: string;
  activeMavenProfiles?: string[];
  inactiveMavenProfiles?: string[];
  /** Selected Gradle tool and user settings used if this session imports Gradle projects. */
  gradle?: JavaGradleSettings;
  /** Optional workspace-contained Eclipse formatter profile XML and selected profile name. */
  javaFormatterProfile?: JavaFormatterProfile;
}

export interface LanguageServiceStatusEvent {
  type: "status";
  status: LanguageServiceStatus;
}

export interface LanguageServiceProgressEvent {
  type: "progress";
  workspaceId: string;
  generation: number;
  provider: string;
  progress: LanguageServiceProgress;
}

export interface LanguageServiceDiagnosticsEvent {
  type: "diagnostics";
  /** The provider cannot diagnose this document with its current compiler settings. */
  unavailableReason?: string;
  workspaceId: string;
  generation: number;
  provider: string;
  document: VersionedLanguageDocument;
  diagnostics: LanguageDiagnostic[];
}

/** Push events emitted by a managed language-service adapter. */
export type LanguageServiceEvent =
  LanguageServiceStatusEvent | LanguageServiceProgressEvent | LanguageServiceDiagnosticsEvent;

export type LanguageServiceEventListener = (event: LanguageServiceEvent) => void;

/** Calling the returned function detaches an event listener. */
export type LanguageServiceUnsubscribe = () => void;
