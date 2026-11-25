// ---------------------------------------------------------------------------
// @ide/web-core – DocumentSyncPort
// ---------------------------------------------------------------------------
// Full-text synchronization boundary for initialized workspace language sessions.

import type {
  DidChangeLanguageDocumentRequest,
  DidCloseLanguageDocumentRequest,
  DidOpenLanguageDocumentRequest,
  DidSaveLanguageDocumentRequest,
  RevalidateLanguageDocumentRequest,
  DidSaveLanguageWorkspaceFileRequest,
} from "@ide/contracts";

export interface DocumentSyncPort {
  /** Open a document with versioned full text. */
  didOpen(request: DidOpenLanguageDocumentRequest): Promise<void>;

  /** Replace synchronized text using a strictly increasing document version. */
  didChange(request: DidChangeLanguageDocumentRequest): Promise<void>;

  /** Notify the provider of the authoritative saved text and version. */
  didSave(request: DidSaveLanguageDocumentRequest): Promise<void>;

  /** Close the versioned document in its owning workspace session. */
  didClose(request: DidCloseLanguageDocumentRequest): Promise<void>;
  /** Optional read-only provider extension for diagnostics after workspace draft edits. */
  revalidate?(request: RevalidateLanguageDocumentRequest): Promise<void>;
  /** Notify an initialized provider about a saved non-language workspace file. */
  didSaveWorkspaceFile?(request: DidSaveLanguageWorkspaceFileRequest): Promise<void>;
}
