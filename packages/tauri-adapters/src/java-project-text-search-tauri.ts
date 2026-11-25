import type {
  JavaProjectTextSearchMatch,
  JavaProjectTextSearchRequest,
  JavaProjectTextSearchResult,
} from "@ide/contracts";
import type { JavaProjectTextSearchPort } from "@ide/web-core";
import { isNormalizedWorkspaceRelativePath } from "@ide/web-core/editor-open-coordinator";
import { invokeTauri, TauriAdapterError } from "./errors";

const COMMAND = "search_java_project_text";
const INVALID = "Invalid or uncorrelated Java project search response.";
const MAX_MATCH_COLUMN = 2 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || (!empty && !value) || value.length > max || value.includes("\0"))
    throw new Error(INVALID);
  return value;
}

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max)
    throw new Error(INVALID);
  return value;
}

function match(value: unknown): JavaProjectTextSearchMatch {
  const item = object(value);
  const path = text(item.path, 4096);
  if (!isNormalizedWorkspaceRelativePath(path)) throw new Error(INVALID);
  const line = integer(item.line);
  const column = integer(item.column, MAX_MATCH_COLUMN);
  if (line === 0 || column === 0) throw new Error(INVALID);
  return {
    path,
    line,
    column,
    snippet: text(item.snippet, 512, true),
  };
}

export class TauriJavaProjectTextSearchAdapter implements JavaProjectTextSearchPort {
  async search(request: JavaProjectTextSearchRequest): Promise<JavaProjectTextSearchResult> {
    if (
      !request ||
      typeof request !== "object" ||
      typeof request.workspaceId !== "string" ||
      !request.workspaceId ||
      request.workspaceId.length > 256 ||
      !Number.isSafeInteger(request.generation) ||
      request.generation < 0 ||
      typeof request.requestId !== "string" ||
      !request.requestId ||
      request.requestId.length > 256 ||
      typeof request.projectPath !== "string" ||
      request.projectPath.length > 4096 ||
      (request.projectPath !== "" &&
        (request.projectPath.includes(":") ||
          !isNormalizedWorkspaceRelativePath(request.projectPath))) ||
      typeof request.query !== "string" ||
      !request.query.trim() ||
      request.query.length > 256 ||
      /[\r\n\0]/u.test(request.query) ||
      typeof request.caseSensitive !== "boolean"
    )
      throw new TauriAdapterError(COMMAND, "The Java project search request is invalid.");

    const raw = object(await invokeTauri<unknown>(COMMAND, { ...request }));
    if (
      raw.workspaceId !== request.workspaceId ||
      raw.generation !== request.generation ||
      raw.requestId !== request.requestId ||
      raw.projectPath !== request.projectPath ||
      raw.query !== request.query ||
      !Array.isArray(raw.matches) ||
      raw.matches.length > 200 ||
      typeof raw.truncated !== "boolean"
    )
      throw new TauriAdapterError(COMMAND, INVALID);

    try {
      return {
        workspaceId: text(raw.workspaceId, 256),
        generation: integer(raw.generation),
        requestId: text(raw.requestId, 256),
        projectPath: text(raw.projectPath, 4096, true),
        query: text(raw.query, 256),
        matches: raw.matches.map(match),
        scannedFiles: integer(raw.scannedFiles, 20_000),
        skippedFiles: integer(raw.skippedFiles, 20_000),
        truncated: raw.truncated,
      };
    } catch {
      throw new TauriAdapterError(COMMAND, INVALID);
    }
  }
}
