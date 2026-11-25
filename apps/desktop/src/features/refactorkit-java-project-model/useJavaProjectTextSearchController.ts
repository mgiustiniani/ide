import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JavaProjectTextSearchMatch } from "@ide/contracts";
import type { JavaProjectTextSearchPort } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";

interface WorkspaceContext {
  workspaceId: string | null;
  generation: number;
  isSwitching: boolean;
  isMetadataLoading: boolean;
}

export interface JavaProjectTextSearchDraft {
  path: string;
  content: string;
  lifetime: symbol;
}

interface Dependencies {
  port: JavaProjectTextSearchPort;
  workspaceId: string | null;
  generation: number;
  getWorkspaceContext(): WorkspaceContext;
  getOpenTextDrafts(): readonly JavaProjectTextSearchDraft[];
}

export interface JavaProjectTextSearchSnapshot {
  matches: JavaProjectTextSearchMatch[];
  scannedFiles: number;
  skippedFiles: number;
  searchedDraftFiles: number;
  skippedDraftFiles: number;
  truncated: boolean;
  hasSearched: boolean;
  isBusy: boolean;
  error: string | null;
}

const emptyState: JavaProjectTextSearchSnapshot = {
  matches: [],
  scannedFiles: 0,
  skippedFiles: 0,
  searchedDraftFiles: 0,
  skippedDraftFiles: 0,
  truncated: false,
  hasSearched: false,
  isBusy: false,
  error: null,
};

const MAX_DRAFT_FILES = 128;
const MAX_DRAFT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DRAFT_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_MATCHES = 200;
const MAX_SNIPPET_CHARS = 400;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".gradle",
  ".hg",
  ".idea",
  ".next",
  ".svn",
  ".turbo",
  "node_modules",
]);
const BUILD_OUTPUT_DIRECTORIES = new Set(["build", "coverage", "dist", "out", "target"]);
const SEARCHABLE_TEXT_EXTENSIONS = new Set([
  "java",
  "kt",
  "kts",
  "xml",
  "properties",
  "yaml",
  "yml",
  "json",
  "jsonc",
  "sql",
  "html",
  "htm",
  "txt",
  "csv",
  "conf",
  "config",
  "gradle",
  "groovy",
  "toml",
  "md",
  "prefs",
]);
const SEARCHABLE_EXTENSIONLESS_FILES = new Set([
  ".classpath",
  ".project",
  ".editorconfig",
  ".gitignore",
  ".gitattributes",
]);
const utf8Encoder = new TextEncoder();

function isSearchableProjectTextPath(path: string): boolean {
  const fileName = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (SEARCHABLE_EXTENSIONLESS_FILES.has(fileName)) return true;
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1);
  return SEARCHABLE_TEXT_EXTENSIONS.has(extension);
}

function projectDraftPath(path: string, projectPath: string): string | null {
  if (
    !isNormalizedWorkspaceRelativePath(path) ||
    path.length > 4096 ||
    !isSearchableProjectTextPath(path)
  )
    return null;

  const projectPrefix = projectPath ? `${projectPath}/` : "";
  if (projectPrefix && !path.startsWith(projectPrefix)) return null;
  const projectRelativePath = projectPrefix ? path.slice(projectPrefix.length) : path;
  const directories = projectRelativePath.split("/").slice(0, -1);
  if (directories.some((directory) => IGNORED_DIRECTORIES.has(directory))) return null;
  const insideSourceTree = directories.includes("src");
  if (!insideSourceTree && directories.some((directory) => BUILD_OUTPUT_DIRECTORIES.has(directory)))
    return null;
  return path;
}

function projectDraftSnapshot(
  drafts: readonly JavaProjectTextSearchDraft[],
  projectPath: string,
): JavaProjectTextSearchDraft[] {
  const unique = new Map<string, JavaProjectTextSearchDraft>();
  for (const draft of drafts) {
    const path = projectDraftPath(draft.path, projectPath);
    if (path) unique.set(path, { ...draft, path });
  }
  return [...unique.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function sameDraftSnapshot(
  previous: readonly JavaProjectTextSearchDraft[],
  current: readonly JavaProjectTextSearchDraft[],
): boolean {
  return (
    previous.length === current.length &&
    previous.every(
      (draft, index) =>
        draft.path === current[index].path &&
        draft.content === current[index].content &&
        draft.lifetime === current[index].lifetime,
    )
  );
}

function boundedSnippet(line: string): string {
  let snippet = "";
  let count = 0;
  for (const char of line) {
    if (count === MAX_SNIPPET_CHARS) return `${snippet}…`;
    snippet += char;
    count++;
  }
  return snippet;
}

function literalMatchColumns(
  line: string,
  query: string,
  caseSensitive: boolean,
  limit: number,
): { columns: number[]; truncated: boolean } {
  const foldedLine = caseSensitive ? line : line.toLowerCase();
  const foldedQuery = caseSensitive ? query : query.toLowerCase();
  if (limit <= 0) return { columns: [], truncated: foldedLine.includes(foldedQuery) };

  let sourceColumnByFoldedUnit: Uint32Array | null = null;
  if (!caseSensitive) {
    sourceColumnByFoldedUnit = new Uint32Array(foldedLine.length);
    let sourceOffset = 0;
    let foldedOffset = 0;
    for (const character of line) {
      const foldedWidth = character.toLowerCase().length;
      sourceColumnByFoldedUnit.fill(sourceOffset + 1, foldedOffset, foldedOffset + foldedWidth);
      foldedOffset += foldedWidth;
      sourceOffset += character.length;
    }
  }

  const columns: number[] = [];
  let searchFrom = 0;
  while (true) {
    const matchIndex = foldedLine.indexOf(foldedQuery, searchFrom);
    if (matchIndex < 0) return { columns, truncated: false };
    if (columns.length >= limit) return { columns, truncated: true };
    columns.push(caseSensitive ? matchIndex + 1 : sourceColumnByFoldedUnit![matchIndex]!);
    searchFrom = matchIndex + foldedQuery.length;
  }
}

function searchDrafts(
  drafts: readonly JavaProjectTextSearchDraft[],
  query: string,
  caseSensitive: boolean,
) {
  const matches: JavaProjectTextSearchMatch[] = [];
  const dirtyPaths = new Set(drafts.map((draft) => draft.path));
  let searchedDraftFiles = 0;
  let skippedDraftFiles = Math.max(0, drafts.length - MAX_DRAFT_FILES);
  let scannedBytes = 0;
  let truncated = skippedDraftFiles > 0;

  for (const [index, draft] of drafts.slice(0, MAX_DRAFT_FILES).entries()) {
    if (draft.content.length > MAX_DRAFT_FILE_BYTES || draft.content.includes("\0")) {
      skippedDraftFiles++;
      truncated = true;
      continue;
    }
    const byteLength = utf8Encoder.encode(draft.content).length;
    if (byteLength > MAX_DRAFT_FILE_BYTES) {
      skippedDraftFiles++;
      truncated = true;
      continue;
    }
    if (scannedBytes + byteLength > MAX_DRAFT_TOTAL_BYTES) {
      skippedDraftFiles += Math.min(drafts.length, MAX_DRAFT_FILES) - index;
      truncated = true;
      break;
    }
    scannedBytes += byteLength;
    searchedDraftFiles++;

    let start = 0;
    let lineNumber = 1;
    while (start < draft.content.length) {
      const newline = draft.content.indexOf("\n", start);
      const end = newline < 0 ? draft.content.length : newline;
      const rawLine = draft.content.slice(start, end);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      const lineMatches = literalMatchColumns(
        line,
        query,
        caseSensitive,
        MAX_SEARCH_MATCHES - matches.length,
      );
      for (const column of lineMatches.columns)
        matches.push({ path: draft.path, line: lineNumber, column, snippet: boundedSnippet(line) });
      if (lineMatches.truncated) truncated = true;
      if (newline < 0) break;
      start = newline + 1;
      lineNumber++;
    }
  }

  return { matches, dirtyPaths, searchedDraftFiles, skippedDraftFiles, truncated };
}

export interface JavaProjectTextSearchController extends JavaProjectTextSearchSnapshot {
  search(query: string, caseSensitive: boolean, projectPath: string): Promise<void>;
  searchAndGetSnapshot(
    query: string,
    caseSensitive: boolean,
    projectPath: string,
  ): Promise<JavaProjectTextSearchSnapshot | null>;
  clear(): void;
}

export function useJavaProjectTextSearchController(
  dependencies: Dependencies,
): JavaProjectTextSearchController {
  const [state, setState] = useState<JavaProjectTextSearchSnapshot>(emptyState);
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const revision = useRef(0);
  const sequence = useRef(0);

  const clear = useCallback(() => {
    revision.current++;
    setState(emptyState);
  }, []);

  useEffect(() => {
    const active = dependencies.getWorkspaceContext();
    if (
      active.workspaceId !== dependencies.workspaceId ||
      active.generation !== dependencies.generation ||
      active.isSwitching ||
      active.isMetadataLoading
    ) {
      revision.current++;
      setState(emptyState);
    }
  }, [dependencies.generation, dependencies.getWorkspaceContext, dependencies.workspaceId]);

  const searchAndGetSnapshot = useCallback(
    async (
      query: string,
      caseSensitive: boolean,
      projectPath: string,
    ): Promise<JavaProjectTextSearchSnapshot | null> => {
      const current = latest.current;
      const active = current.getWorkspaceContext();
      if (
        !current.workspaceId ||
        active.workspaceId !== current.workspaceId ||
        active.generation !== current.generation ||
        active.isSwitching ||
        active.isMetadataLoading
      ) {
        const failure = {
          ...emptyState,
          error: "The active workspace changed. Search again when it is ready.",
        };
        setState(failure);
        return failure;
      }
      if (!query.trim()) {
        const failure = { ...emptyState, error: "Enter text to search project files." };
        setState(failure);
        return failure;
      }

      const requestId = `java-search-${current.generation}-${++sequence.current}`;
      const request = {
        workspaceId: current.workspaceId,
        generation: current.generation,
        requestId,
        projectPath,
        query,
        caseSensitive,
      };
      const draftSnapshot = projectDraftSnapshot(current.getOpenTextDrafts(), projectPath);
      const draftSearch = searchDrafts(draftSnapshot, query, caseSensitive);
      const admittedRevision = ++revision.current;
      setState({ ...emptyState, isBusy: true });
      try {
        const result = await current.port.search(request);
        if (admittedRevision !== revision.current) return null;
        const newest = latest.current;
        const workspace = newest.getWorkspaceContext();
        if (
          newest.workspaceId !== request.workspaceId ||
          newest.generation !== request.generation ||
          workspace.workspaceId !== request.workspaceId ||
          workspace.generation !== request.generation ||
          workspace.isSwitching ||
          workspace.isMetadataLoading
        )
          return null;
        const newestDrafts = projectDraftSnapshot(newest.getOpenTextDrafts(), projectPath);
        if (!sameDraftSnapshot(draftSnapshot, newestDrafts)) return null;
        if (
          result.workspaceId !== request.workspaceId ||
          result.generation !== request.generation ||
          result.requestId !== request.requestId ||
          result.projectPath !== request.projectPath ||
          result.query !== request.query ||
          !Array.isArray(result.matches)
        )
          throw new Error("The Java search response did not match the active request.");
        const matches = [
          ...result.matches.filter((match) => !draftSearch.dirtyPaths.has(match.path)),
          ...draftSearch.matches,
        ].sort((left, right) =>
          left.path < right.path
            ? -1
            : left.path > right.path
              ? 1
              : left.line - right.line || left.column - right.column,
        );
        const snapshot: JavaProjectTextSearchSnapshot = {
          matches: matches.slice(0, MAX_SEARCH_MATCHES),
          scannedFiles: result.scannedFiles,
          skippedFiles: result.skippedFiles,
          searchedDraftFiles: draftSearch.searchedDraftFiles,
          skippedDraftFiles: draftSearch.skippedDraftFiles,
          truncated:
            result.truncated || draftSearch.truncated || matches.length > MAX_SEARCH_MATCHES,
          hasSearched: true,
          isBusy: false,
          error: null,
        };
        setState(snapshot);
        return snapshot;
      } catch {
        if (admittedRevision !== revision.current) return null;
        const failure = {
          ...emptyState,
          error: "Project text search failed. Check the project and try again.",
        };
        setState(failure);
        return failure;
      } finally {
        if (admittedRevision === revision.current)
          setState((previous) => (previous.isBusy ? { ...previous, isBusy: false } : previous));
      }
    },
    [],
  );

  const search = useCallback(
    async (query: string, caseSensitive: boolean, projectPath: string): Promise<void> => {
      await searchAndGetSnapshot(query, caseSensitive, projectPath);
    },
    [searchAndGetSnapshot],
  );

  return useMemo(
    () => ({ ...state, search, searchAndGetSnapshot, clear }),
    [clear, search, searchAndGetSnapshot, state],
  );
}
