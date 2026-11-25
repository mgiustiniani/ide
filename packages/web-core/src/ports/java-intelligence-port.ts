// ---------------------------------------------------------------------------
// @ide/web-core – JavaIntelligencePort
// ---------------------------------------------------------------------------
// Provider-neutral boundary for low-latency Java semantic requests. Concrete
// adapters own transport, provider conversion, authorization and cancellation.

import type {
  JavaCompletionRequest,
  JavaCompletionResponse,
  JavaFormattingRequest,
  JavaRangeFormattingRequest,
  JavaOnTypeFormattingRequest,
  JavaRangeFormattingResponse,
  JavaFormattingResponse,
  JavaCodeActionsRequest,
  JavaCodeActionsResponse,
  JavaRenameRequest,
  JavaRenameResponse,
  JavaDocumentSymbolsRequest,
  JavaDocumentSymbolsResponse,
  JavaDocumentHighlightsRequest,
  JavaDocumentHighlightsResponse,
  JavaImplementationsRequest,
  JavaImplementationsResponse,
  JavaDefinitionsRequest,
  JavaDefinitionsResponse,
  JavaCallHierarchyRequest,
  JavaCallHierarchyResponse,
  JavaReferencesRequest,
  JavaReferencesResponse,
  JavaSemanticTokensRequest,
  JavaSemanticTokensResponse,
  JavaInlayHintsRequest,
  JavaInlayHintsResponse,
  JavaWorkspaceSymbolsRequest,
  JavaWorkspaceSymbolsResponse,
  JavaHoverRequest,
  JavaHoverResponse,
  JavaSignatureHelpRequest,
  JavaSignatureHelpResponse,
  LanguageServiceCancellationId,
} from "@ide/contracts";

export interface JavaIntelligencePort {
  /** Request a bounded completion list for a synchronized document version. */
  completion(request: JavaCompletionRequest): Promise<JavaCompletionResponse>;

  /** Request bounded formatter edits for one synchronized document snapshot. */
  formatDocument(request: JavaFormattingRequest): Promise<JavaFormattingResponse>;
  formatRange(request: JavaRangeFormattingRequest): Promise<JavaRangeFormattingResponse>;
  formatOnType?(request: JavaOnTypeFormattingRequest): Promise<JavaFormattingResponse>;

  /** Request bounded hover content treated by consumers as untrusted data. */
  hover(request: JavaHoverRequest): Promise<JavaHoverResponse>;

  /** Request bounded signature and parameter information. */
  signatureHelp(request: JavaSignatureHelpRequest): Promise<JavaSignatureHelpResponse>;

  /** Request bounded, same-document quick fixes and import actions. */
  codeActions(request: JavaCodeActionsRequest): Promise<JavaCodeActionsResponse>;

  /** Request a bounded semantic rename whose edits are confined to the current document. */
  rename(request: JavaRenameRequest): Promise<JavaRenameResponse>;

  /** Request a bounded, hierarchical outline for one synchronized Java document. */
  documentSymbols(request: JavaDocumentSymbolsRequest): Promise<JavaDocumentSymbolsResponse>;

  /** Request bounded same-document occurrences for the symbol at the cursor. */
  documentHighlights(
    request: JavaDocumentHighlightsRequest,
  ): Promise<JavaDocumentHighlightsResponse>;

  /** Request bounded implementation locations for the symbol at the cursor. */
  implementations(request: JavaImplementationsRequest): Promise<JavaImplementationsResponse>;

  /** Request bounded definitions for the symbol at the cursor in the current Java buffer. */
  definitions?(request: JavaDefinitionsRequest): Promise<JavaDefinitionsResponse>;
  typeDefinitions?(request: JavaDefinitionsRequest): Promise<JavaDefinitionsResponse>;

  /** Request bounded callers or callees for a symbol in the synchronized document. */
  callHierarchy?(request: JavaCallHierarchyRequest): Promise<JavaCallHierarchyResponse>;

  /** Request bounded workspace references for the symbol at the cursor. */
  references(request: JavaReferencesRequest): Promise<JavaReferencesResponse>;

  /** Request bounded semantic classifications for the current synchronized Java document. */
  semanticTokens(request: JavaSemanticTokensRequest): Promise<JavaSemanticTokensResponse>;

  /** Request bounded, plain-text inlay hints for a synchronized document range. */
  inlayHints?(request: JavaInlayHintsRequest): Promise<JavaInlayHintsResponse>;

  /** Search a bounded set of Java declarations in the active provider workspace. */
  workspaceSymbols(request: JavaWorkspaceSymbolsRequest): Promise<JavaWorkspaceSymbolsResponse>;

  /** Best-effort cancellation of an operation carrying this cancellation ID. */
  cancel(cancellationId: LanguageServiceCancellationId): Promise<void>;
}
