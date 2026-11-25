/** A literal, read-only search over supported project text files in one selected Java project. */
export interface JavaProjectTextSearchRequest {
  workspaceId: string;
  generation: number;
  requestId: string;
  projectPath: string;
  query: string;
  caseSensitive: boolean;
}

export interface JavaProjectTextSearchMatch {
  /** Workspace-relative project text path. */
  path: string;
  /** One-based source line. */
  line: number;
  /** One-based UTF-16 column of the first literal match on the line. */
  column: number;
  /** Bounded, unmodified text from the matching line. */
  snippet: string;
}

export interface JavaProjectTextSearchResult {
  workspaceId: string;
  generation: number;
  requestId: string;
  projectPath: string;
  query: string;
  matches: JavaProjectTextSearchMatch[];
  scannedFiles: number;
  skippedFiles: number;
  truncated: boolean;
}
