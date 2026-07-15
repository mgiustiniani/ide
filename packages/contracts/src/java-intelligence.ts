// ---------------------------------------------------------------------------
// @ide/contracts – Provider-neutral Java interactive intelligence types
// ---------------------------------------------------------------------------
// These contracts describe normalized, bounded semantic results. They do not
// expose JDT LS, LSP, Monaco, or any other provider-specific wire types.

import type {
  LanguagePosition,
  LanguageRange,
  LanguageServiceCancellationId,
  LanguageServiceRequestId,
  VersionedLanguageDocument,
} from "./language-service";

/** A synchronized document target inside the request's authorized workspace. */
export interface JavaSemanticDocumentTarget {
  /** Validated workspace-relative path; absolute and escaping paths are forbidden. */
  path: string;
  /** Authorized URI corresponding exactly to `path`. */
  uri: string;
  /** Version of the synchronized in-memory document. */
  version: number;
}

/** Fields shared by position-based Java semantic requests. */
export interface JavaSemanticRequest {
  workspaceId: string;
  /** Session generation used to reject requests and replies from replaced sessions. */
  generation: number;
  document: JavaSemanticDocumentTarget;
  /** Zero-based position in the synchronized document. */
  position: LanguagePosition;
  requestId: LanguageServiceRequestId;
  cancellationId: LanguageServiceCancellationId;
}

export type JavaCompletionTriggerKind = "invoked" | "trigger-character" | "incomplete-completions";

/** Optional reason for requesting completion, normalized independently of LSP. */
export interface JavaCompletionTriggerContext {
  kind: JavaCompletionTriggerKind;
  /** Present only when `kind` is `trigger-character`. */
  character?: string;
}

export interface JavaCompletionRequest extends JavaSemanticRequest {
  trigger?: JavaCompletionTriggerContext;
}

export type JavaHoverRequest = JavaSemanticRequest;
export type JavaSignatureHelpRequest = JavaSemanticRequest;

/** Provider identity attached to every successful semantic response. */
export interface JavaSemanticProviderIdentity {
  provider: string;
  /** Provider version, or `null` when discovery cannot determine it. */
  providerVersion: string | null;
}

/** Untrusted display data. Markdown must be sanitized by the presentation layer. */
export interface JavaSemanticContent {
  format: "plaintext" | "markdown";
  value: string;
}

/** A zero-based, end-exclusive replacement in a text document. */
export interface JavaTextEdit {
  range: LanguageRange;
  newText: string;
}

/**
 * An additional edit in a document authorized under the request workspace.
 * Adapters must reject absolute paths, traversal, workspace mismatch and stale versions.
 */
export interface JavaWorkspaceTextEdit {
  document: VersionedLanguageDocument;
  edit: JavaTextEdit;
}

/** Provider-neutral completion categories. */
export type JavaCompletionItemKind =
  | "text"
  | "method"
  | "function"
  | "constructor"
  | "field"
  | "variable"
  | "class"
  | "interface"
  | "module"
  | "property"
  | "unit"
  | "value"
  | "enum"
  | "keyword"
  | "snippet"
  | "color"
  | "file"
  | "reference"
  | "folder"
  | "enum-member"
  | "constant"
  | "struct"
  | "event"
  | "operator"
  | "type-parameter"
  | "unknown";

export interface JavaCompletionItem {
  label: string;
  kind: JavaCompletionItemKind;
  detail?: string;
  documentation?: JavaSemanticContent;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  /** Primary edit in the requested document; its range is end-exclusive. */
  textEdit?: JavaTextEdit;
  /** Bounded edits whose document identities have been workspace-authorized. */
  additionalTextEdits?: JavaWorkspaceTextEdit[];
  commitCharacters?: string[];
  deprecated?: boolean;
  preselect?: boolean;
}

/** Metadata tying a response to the synchronized document and session that produced it. */
export interface JavaSemanticResponseMetadata extends JavaSemanticProviderIdentity {
  workspaceId: string;
  generation: number;
  document: JavaSemanticDocumentTarget;
}

export interface JavaCompletionResult extends JavaSemanticResponseMetadata {
  /** Bounded by the adapter's configured completion-item limit. */
  items: JavaCompletionItem[];
  /** True when the provider or adapter reports that more items may exist. */
  isIncomplete: boolean;
}

export interface JavaHoverResult extends JavaSemanticResponseMetadata {
  /** Bounded, untrusted data blocks. The UI must sanitize Markdown before rendering. */
  contents: JavaSemanticContent[];
  /** True when content was truncated to satisfy a transport or display bound. */
  isTruncated: boolean;
  /** Zero-based, end-exclusive source range to which this hover applies. */
  range?: LanguageRange;
}

/** A label or an end-exclusive offset pair into the owning signature's `label`. */
export type JavaSignatureParameterLabel =
  | string
  | {
      start: number;
      end: number;
    };

export interface JavaSignatureParameter {
  label: JavaSignatureParameterLabel;
  documentation?: JavaSemanticContent;
}

export interface JavaSignatureInformation {
  label: string;
  documentation?: JavaSemanticContent;
  parameters: JavaSignatureParameter[];
  /** When present, must index `parameters`. */
  activeParameter?: number;
}

export interface JavaSignatureHelpResult extends JavaSemanticResponseMetadata {
  /** Bounded by the adapter's configured signature limit. */
  signatures: JavaSignatureInformation[];
  /** When present, must index `signatures`. */
  activeSignature?: number;
  /** When present, must index the active signature's `parameters`. */
  activeParameter?: number;
  /** True when signatures or parameters were truncated to a configured bound. */
  isTruncated: boolean;
}

export type JavaSemanticErrorKind =
  "cancelled" | "timeout" | "unavailable" | "stale-version" | "provider-error" | "malformed-result";

/**
 * Bounded, sanitized failure information safe to cross into presentation code.
 * `summary` and `providerCode` must never contain source text, raw provider output,
 * absolute paths, environment values, or serialized exception/cause objects.
 */
export interface JavaSemanticError {
  kind: JavaSemanticErrorKind;
  summary?: string;
  providerCode?: string | number;
  retryable?: boolean;
}

export interface JavaSemanticSuccess<T> {
  ok: true;
  requestId: LanguageServiceRequestId;
  result: T;
}

export interface JavaSemanticFailure {
  ok: false;
  requestId: LanguageServiceRequestId;
  error: JavaSemanticError;
}

/** Result envelope that represents cancellation and operational failures as data. */
export type JavaSemanticResult<T> = JavaSemanticSuccess<T> | JavaSemanticFailure;

export type JavaCompletionResponse = JavaSemanticResult<JavaCompletionResult>;
export type JavaHoverResponse = JavaSemanticResult<JavaHoverResult>;
export type JavaSignatureHelpResponse = JavaSemanticResult<JavaSignatureHelpResult>;
