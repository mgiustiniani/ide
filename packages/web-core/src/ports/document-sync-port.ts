// ---------------------------------------------------------------------------
// @ide/web-core – DocumentSyncPort
// ---------------------------------------------------------------------------
// Full-text synchronization boundary for initialized workspace language sessions.

import type {
  DidChangeLanguageDocumentRequest,
  DidCloseLanguageDocumentRequest,
  DidOpenLanguageDocumentRequest,
  DidSaveLanguageDocumentRequest,
} from '@ide/contracts';

export interface DocumentSyncPort {
  /** Open a document with versioned full text. */
  didOpen(request: DidOpenLanguageDocumentRequest): Promise<void>;

  /** Replace synchronized text using a strictly increasing document version. */
  didChange(request: DidChangeLanguageDocumentRequest): Promise<void>;

  /** Notify the provider of the authoritative saved text and version. */
  didSave(request: DidSaveLanguageDocumentRequest): Promise<void>;

  /** Close the versioned document in its owning workspace session. */
  didClose(request: DidCloseLanguageDocumentRequest): Promise<void>;
}
