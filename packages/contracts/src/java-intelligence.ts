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

/** Request metadata for a whole-document language-service operation. */
export interface JavaSemanticDocumentRequest {
  workspaceId: string;
  generation: number;
  document: JavaSemanticDocumentTarget;
  requestId: LanguageServiceRequestId;
  cancellationId: LanguageServiceCancellationId;
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
export type JavaDocumentHighlightsRequest = JavaSemanticRequest;
export type JavaDefinitionsRequest = JavaSemanticRequest;
export type JavaImplementationsRequest = JavaSemanticRequest;

/** Find callers or callees for the symbol at the current synchronized Java cursor. */
export interface JavaCallHierarchyRequest extends JavaSemanticRequest {
  direction: "incoming" | "outgoing";
}

/** Workspace reference search for the symbol at the current synchronized cursor. */
export interface JavaReferencesRequest extends JavaSemanticRequest {
  includeDeclaration: boolean;
}

/** Full-document semantic-token query for the current synchronized snapshot. */
export interface JavaSemanticTokensRequest {
  workspaceId: string;
  generation: number;
  document: JavaSemanticDocumentTarget;
  requestId: LanguageServiceRequestId;
  cancellationId: LanguageServiceCancellationId;
}

/** Request Java inlay hints for a bounded range of the synchronized document. */
export interface JavaInlayHintsRequest extends JavaSemanticDocumentRequest {
  range: LanguageRange;
}

/** Whole-document formatting request using the editor's indentation preferences. */
export interface JavaFormattingRequest extends JavaSemanticDocumentRequest {
  options: {
    tabSize: number;
    insertSpaces: boolean;
  };
}

/** Format the selected UTF-16 range in the current synchronized Java document. */
export interface JavaRangeFormattingRequest extends JavaFormattingRequest {
  range: LanguageRange;
}

/** Format after a server-advertised character in the synchronized Java buffer. */
export interface JavaOnTypeFormattingRequest extends JavaFormattingRequest {
  position: LanguagePosition;
  character: string;
}

/** Diagnostic context sent with a bounded Java code-action request. */
export interface JavaCodeActionDiagnostic {
  range: LanguageRange;
  severity: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
  code?: string | number;
}

export interface JavaCodeActionsRequest extends JavaSemanticRequest {
  range: LanguageRange;
  diagnostics: JavaCodeActionDiagnostic[];
  generationSelection?: JavaCodeActionGenerationSelection;
}

/** Explicit selection of a quick fix that needs background source synchronization. */
export interface JavaCodeActionApplyRequest extends JavaCodeActionsRequest {
  action: JavaCodeAction;
}

/** A provider-supplied choice in a Java code-generation dialog. */
export interface JavaCodeActionMember {
  selectionKey: string;
  name: string;
  detail?: string;
}

export interface JavaCodeActionMemberGroup {
  id: "fields" | "constructors" | "overridableMethods" | "delegateMethods";
  label: string;
  members: JavaCodeActionMember[];
  selectedKeys: string[];
}

export type JavaCodeActionGenerationKind =
  "constructors" | "hashCodeEquals" | "overrideMethods" | "delegateMethods";

export interface JavaCodeActionMemberSelection {
  kind: JavaCodeActionGenerationKind;
  groups: JavaCodeActionMemberGroup[];
}

/** A user's choices are revalidated against a fresh JDT LS status response. */
export interface JavaCodeActionGenerationSelection {
  kind: JavaCodeActionGenerationKind;
  selectedFieldBindingKeys: string[];
  selectedConstructorBindingKeys: string[];
  selectedOverridableMethodKeys: string[];
  selectedDelegateMethodKeys: string[];
}

/** Read-only outline query for the current synchronized Java document. */
export interface JavaDocumentSymbolsRequest {
  workspaceId: string;
  generation: number;
  document: JavaSemanticDocumentTarget;
  requestId: LanguageServiceRequestId;
  cancellationId: LanguageServiceCancellationId;
}

/** Search Java symbols in the initialized language-service workspace index. */
export interface JavaWorkspaceSymbolsRequest {
  workspaceId: string;
  generation: number;
  query: string;
  requestId: LanguageServiceRequestId;
  cancellationId: LanguageServiceCancellationId;
}

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

export type JavaDocumentHighlightKind = "text" | "read" | "write";

/** Same-document symbol occurrences returned by the current language service. */
export interface JavaDocumentHighlight {
  range: LanguageRange;
  kind?: JavaDocumentHighlightKind;
}

export interface JavaDocumentHighlightsResult extends JavaSemanticResponseMetadata {
  highlights: JavaDocumentHighlight[];
  isTruncated: boolean;
}

/** A Java implementation declaration in the authorized workspace. */
export interface JavaImplementationLocation {
  path: string;
  range: LanguageRange;
}

/** Workspace source implementations returned by the active Java language server. */
export interface JavaImplementationsResult extends JavaSemanticResponseMetadata {
  locations: JavaImplementationLocation[];
  isTruncated: boolean;
}

/** Bounded workspace Java declarations returned for the symbol at the current cursor. */
export interface JavaDefinitionsResult extends JavaSemanticResponseMetadata {
  locations: JavaImplementationLocation[];
  isTruncated: boolean;
}

/** A workspace source occurrence returned by the active Java language server. */
export interface JavaReferenceLocation {
  path: string;
  range: LanguageRange;
}

/** Bounded JDT LS references; partial result sets are explicitly marked. */
export interface JavaReferencesResult extends JavaSemanticResponseMetadata {
  locations: JavaReferenceLocation[];
  isTruncated: boolean;
}

/** One workspace call-hierarchy entry and the bounded source call sites for it. */
export interface JavaCallHierarchyEntry {
  name: string;
  kind: string;
  detail?: string;
  location: JavaReferenceLocation;
  callSites: JavaReferenceLocation[];
}

/** Results from the active language server for the synchronized Java document. */
export interface JavaCallHierarchyResult extends JavaSemanticResponseMetadata {
  direction: JavaCallHierarchyRequest["direction"];
  entries: JavaCallHierarchyEntry[];
  isTruncated: boolean;
}

/** One bounded, provider-classified source token in zero-based UTF-16 coordinates. */
export interface JavaSemanticToken {
  range: LanguageRange;
  tokenType: string;
  tokenModifiers: string[];
}

export interface JavaSemanticTokensResult extends JavaSemanticResponseMetadata {
  tokens: JavaSemanticToken[];
  isTruncated: boolean;
}

/** A bounded, plain-text annotation rendered inside a Java source line. */
export interface JavaInlayHint {
  position: LanguagePosition;
  label: string;
  kind?: "type" | "parameter";
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

export interface JavaInlayHintsResult extends JavaSemanticResponseMetadata {
  hints: JavaInlayHint[];
  isTruncated: boolean;
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

export type JavaDocumentSymbolKind =
  | "file"
  | "module"
  | "namespace"
  | "package"
  | "class"
  | "method"
  | "property"
  | "field"
  | "constructor"
  | "enum"
  | "interface"
  | "function"
  | "variable"
  | "constant"
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "key"
  | "null"
  | "enum-member"
  | "struct"
  | "event"
  | "operator"
  | "type-parameter";

/** Hierarchical, document-local source outline from the active language service. */
export interface JavaDocumentSymbol {
  name: string;
  kind: JavaDocumentSymbolKind;
  range: LanguageRange;
  selectionRange: LanguageRange;
  detail?: string;
  deprecated?: boolean;
  children?: JavaDocumentSymbol[];
}

export interface JavaDocumentSymbolsResult extends JavaSemanticResponseMetadata {
  symbols: JavaDocumentSymbol[];
  isTruncated: boolean;
}

/** A workspace-indexed Java declaration that can be opened in the editor. */
export interface JavaWorkspaceSymbol {
  name: string;
  kind: JavaDocumentSymbolKind;
  path: string;
  range: LanguageRange;
  containerName?: string;
  deprecated?: boolean;
}

export interface JavaWorkspaceSymbolsResult extends JavaSemanticProviderIdentity {
  workspaceId: string;
  generation: number;
  symbols: JavaWorkspaceSymbol[];
  isTruncated: boolean;
}

/** Safe edits for the requested and other open Java documents. Server commands are excluded. */
export interface JavaCodeAction {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  edits: JavaTextEdit[];
  /** Versioned edits for other synchronized Java documents in the same workspace. */
  additionalEdits?: JavaWorkspaceTextEdit[];
  memberSelection?: JavaCodeActionMemberSelection;
  /** Stable identity of the proposed text changes, excluding LSP document versions. */
  editPlanSha256?: string;
  /** Native-captured contents of every document affected by this proposal. */
  sourceDocuments?: { path: string; contentSha256: string }[];
  /** Selection only: synchronize these existing files and request the action again. */
  documentsToOpen?: string[];
}

export interface JavaCodeActionsResult extends JavaSemanticResponseMetadata {
  actions: JavaCodeAction[];
  isTruncated: boolean;
}

export type JavaCodeActionsResponse =
  JavaSemanticSuccess<JavaCodeActionsResult> | JavaSemanticFailure;

/** A semantic rename whose edits target synchronized Java documents in one workspace. */
export interface JavaRenameRequest extends JavaSemanticRequest {
  newName: string;
}

export interface JavaRenameDocumentEdits {
  document: JavaSemanticDocumentTarget;
  edits: JavaTextEdit[];
}

export interface JavaRenameResult extends JavaSemanticResponseMetadata {
  documentEdits: JavaRenameDocumentEdits[];
  /** Read-only discovery: open and synchronize these files, then request a fresh rename.
   * No edits from this response may be applied when this list is present. */
  documentsToOpen?: string[];
  /** Set by the desktop editor after it atomically commits the returned draft edits. */
  appliedToEditor?: true;
}

export type JavaRenameResponse = JavaSemanticResult<JavaRenameResult>;

/** Bounded formatting edits for one synchronized document snapshot. */
export interface JavaFormattingResult extends JavaSemanticResponseMetadata {
  edits: JavaTextEdit[];
}

export type JavaFormattingResponse = JavaSemanticResult<JavaFormattingResult>;
export type JavaRangeFormattingResponse = JavaFormattingResponse;

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
export type JavaDocumentSymbolsResponse = JavaSemanticResult<JavaDocumentSymbolsResult>;
export type JavaDocumentHighlightsResponse = JavaSemanticResult<JavaDocumentHighlightsResult>;
export type JavaImplementationsResponse = JavaSemanticResult<JavaImplementationsResult>;
export type JavaDefinitionsResponse = JavaSemanticResult<JavaDefinitionsResult>;
export type JavaReferencesResponse = JavaSemanticResult<JavaReferencesResult>;
export type JavaCallHierarchyResponse = JavaSemanticResult<JavaCallHierarchyResult>;
export type JavaSemanticTokensResponse = JavaSemanticResult<JavaSemanticTokensResult>;
export type JavaInlayHintsResponse = JavaSemanticResult<JavaInlayHintsResult>;
export type JavaWorkspaceSymbolsResponse = JavaSemanticResult<JavaWorkspaceSymbolsResult>;
