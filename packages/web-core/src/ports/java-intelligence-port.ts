// ---------------------------------------------------------------------------
// @ide/web-core – JavaIntelligencePort
// ---------------------------------------------------------------------------
// Provider-neutral boundary for low-latency Java semantic requests. Concrete
// adapters own transport, provider conversion, authorization and cancellation.

import type {
  JavaCompletionRequest,
  JavaCompletionResponse,
  JavaHoverRequest,
  JavaHoverResponse,
  JavaSignatureHelpRequest,
  JavaSignatureHelpResponse,
  LanguageServiceCancellationId,
} from '@ide/contracts';

export interface JavaIntelligencePort {
  /** Request a bounded completion list for a synchronized document version. */
  completion(request: JavaCompletionRequest): Promise<JavaCompletionResponse>;

  /** Request bounded hover content treated by consumers as untrusted data. */
  hover(request: JavaHoverRequest): Promise<JavaHoverResponse>;

  /** Request bounded signature and parameter information. */
  signatureHelp(request: JavaSignatureHelpRequest): Promise<JavaSignatureHelpResponse>;

  /** Best-effort cancellation of an operation carrying this cancellation ID. */
  cancel(cancellationId: LanguageServiceCancellationId): Promise<void>;
}
