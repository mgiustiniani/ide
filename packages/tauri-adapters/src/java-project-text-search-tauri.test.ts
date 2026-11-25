import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { TauriAdapterError } from "./errors";
import { TauriJavaProjectTextSearchAdapter } from "./java-project-text-search-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);
const request = {
  workspaceId: "workspace-one",
  generation: 3,
  requestId: "search-1",
  projectPath: "app",
  query: "Widget",
  caseSensitive: false,
};
const response = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  requestId: request.requestId,
  projectPath: request.projectPath,
  query: request.query,
  matches: [
    {
      path: "app/src/main/java/example/Widget.java",
      line: 12,
      column: 7,
      snippet: "class Widget {}",
    },
  ],
  scannedFiles: 7,
  skippedFiles: 0,
  truncated: false,
};

describe("TauriJavaProjectTextSearchAdapter", () => {
  beforeEach(() => invokeMock.mockReset());

  it("validates and returns workspace-bound literal search results", async () => {
    invokeMock.mockResolvedValueOnce(response);
    await expect(new TauriJavaProjectTextSearchAdapter().search(request)).resolves.toEqual(
      response,
    );
    expect(invokeMock).toHaveBeenCalledWith("search_java_project_text", request);
  });

  it("rejects invalid requests without invoking the native command", async () => {
    await expect(
      new TauriJavaProjectTextSearchAdapter().search({ ...request, projectPath: "../outside" }),
    ).rejects.toBeInstanceOf(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses stale identities, unsafe paths and unbounded result payloads", async () => {
    for (const invalid of [
      { ...response, generation: 2 },
      {
        ...response,
        matches: [{ path: "../outside.java", line: 1, column: 1, snippet: "x" }],
      },
      {
        ...response,
        matches: [{ path: "app/src/Widget.java", line: 1, column: 0, snippet: "Widget" }],
      },
      { ...response, matches: Array.from({ length: 201 }, () => response.matches[0]) },
      { ...response, scannedFiles: 20_001 },
    ]) {
      invokeMock.mockResolvedValueOnce(invalid);
      await expect(new TauriJavaProjectTextSearchAdapter().search(request)).rejects.toBeInstanceOf(
        TauriAdapterError,
      );
    }
  });
});
