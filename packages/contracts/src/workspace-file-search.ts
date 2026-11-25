/** A workspace-relative file offered by the native Quick Open search. */
export interface WorkspaceFileSearchMatch {
  readonly name: string;
  readonly path: string;
}

/** Bounded file matches after the native adapter validates workspace authority. */
export interface WorkspaceFileSearchResult {
  readonly files: readonly WorkspaceFileSearchMatch[];
  readonly truncated: boolean;
  readonly partial: boolean;
}
