import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JavaProjectTextSearchPort } from "@ide/web-core";
import {
  useJavaProjectTextSearchController,
  type JavaProjectTextSearchDraft,
} from "./useJavaProjectTextSearchController";

function setup(port?: JavaProjectTextSearchPort, initialDrafts: JavaProjectTextSearchDraft[] = []) {
  let drafts = initialDrafts;
  let workspace = {
    workspaceId: "one" as string | null,
    generation: 1,
    isSwitching: false,
    isMetadataLoading: false,
  };
  const searchPort: JavaProjectTextSearchPort = port ?? {
    search: vi.fn(async (request) => ({
      ...request,
      matches: [
        { path: "app/src/main/java/Widget.java", line: 9, column: 7, snippet: "class Widget {}" },
      ],
      scannedFiles: 6,
      skippedFiles: 0,
      truncated: false,
    })),
  };
  const props = () => ({
    port: searchPort,
    workspaceId: workspace.workspaceId,
    generation: workspace.generation,
    getWorkspaceContext: () => workspace,
    getOpenTextDrafts: () => drafts,
  });
  const hook = renderHook(() => useJavaProjectTextSearchController(props()));
  return {
    hook,
    port: searchPort,
    setDrafts(next: JavaProjectTextSearchDraft[]) {
      drafts = next;
    },
    switchWorkspace() {
      workspace = { ...workspace, workspaceId: "two", generation: 2 };
      hook.rerender();
    },
  };
}

describe("useJavaProjectTextSearchController", () => {
  it("binds search results to the selected project and active workspace", async () => {
    const { hook, port } = setup();
    let snapshot!: Awaited<ReturnType<typeof hook.result.current.searchAndGetSnapshot>>;
    await act(async () => {
      snapshot = await hook.result.current.searchAndGetSnapshot("Widget", false, "app");
    });
    expect(port.search).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "one",
        generation: 1,
        projectPath: "app",
        query: "Widget",
        caseSensitive: false,
      }),
    );
    expect(hook.result.current.matches[0]).toEqual({
      path: "app/src/main/java/Widget.java",
      line: 9,
      column: 7,
      snippet: "class Widget {}",
    });
    expect(hook.result.current.searchedDraftFiles).toBe(0);
    expect(snapshot?.matches).toEqual(hook.result.current.matches);
  });

  it("uses dirty editor text as the current version of a saved source file", async () => {
    const { hook, port } = setup(undefined, [
      {
        path: "app/src/main/java/Widget.java",
        content: "// Widget from the unsaved buffer\nclass Current {}\n",
        lifetime: Symbol("widget-buffer"),
      },
    ]);
    await act(() => hook.result.current.search("Widget", true, "app"));
    expect(port.search).toHaveBeenCalledOnce();
    expect(hook.result.current.matches).toEqual([
      {
        path: "app/src/main/java/Widget.java",
        line: 1,
        column: 4,
        snippet: "// Widget from the unsaved buffer",
      },
    ]);
    expect(hook.result.current.searchedDraftFiles).toBe(1);
    expect(hook.result.current.skippedDraftFiles).toBe(0);
  });

  it("reports every case-folded match in Monaco UTF-16 columns after Unicode text", async () => {
    const { hook } = setup(undefined, [
      {
        path: "app/src/main/java/Widget.java",
        content: "😀 call WIDGET(); and widget;\n",
        lifetime: Symbol("widget-buffer"),
      },
    ]);
    await act(() => hook.result.current.search("widget", false, "app"));

    expect(hook.result.current.matches).toEqual([
      {
        path: "app/src/main/java/Widget.java",
        line: 1,
        column: 9,
        snippet: "😀 call WIDGET(); and widget;",
      },
      {
        path: "app/src/main/java/Widget.java",
        line: 1,
        column: 23,
        snippet: "😀 call WIDGET(); and widget;",
      },
    ]);
  });

  it("returns non-overlapping exact matches and marks a line truncated at the global limit", async () => {
    const { hook } = setup(undefined, [
      {
        path: "app/src/main/java/Widget.java",
        content: "aaaaa\n",
        lifetime: Symbol("overlapping-draft"),
      },
    ]);
    await act(() => hook.result.current.search("aa", true, "app"));
    expect(hook.result.current.matches.map((match) => match.column)).toEqual([1, 3]);
    expect(hook.result.current.truncated).toBe(false);

    const limited = setup(undefined, [
      {
        path: "app/src/main/java/Widget.java",
        content: `${"needle ".repeat(201)}\n`,
        lifetime: Symbol("many-matches-draft"),
      },
    ]);
    await act(() => limited.hook.result.current.search("needle", true, "app"));
    expect(limited.hook.result.current.matches).toHaveLength(200);
    expect(limited.hook.result.current.truncated).toBe(true);
  });

  it("uses dirty editor text as the current version of a saved resource file", async () => {
    const resourcePath = "app/src/main/resources/application.properties";
    const { hook, port } = setup(
      {
        search: vi.fn(async (request) => ({
          ...request,
          matches: [{ path: resourcePath, line: 1, column: 10, snippet: "app.name=OldName" }],
          scannedFiles: 5,
          skippedFiles: 0,
          truncated: false,
        })),
      },
      [
        {
          path: resourcePath,
          content: "app.name=CurrentName\n",
          lifetime: Symbol("properties-buffer"),
        },
      ],
    );
    await act(() => hook.result.current.search("CurrentName", true, "app"));
    expect(port.search).toHaveBeenCalledOnce();
    expect(hook.result.current.matches).toEqual([
      {
        path: resourcePath,
        line: 1,
        column: 10,
        snippet: "app.name=CurrentName",
      },
    ]);
    expect(hook.result.current.searchedDraftFiles).toBe(1);
  });

  it("caps draft file count and refuses saved matches when a dirty buffer exceeds its byte limit", async () => {
    const drafts = Array.from({ length: 129 }, (_, index) => ({
      path: `app/src/main/java/Draft${index}.java`,
      content: "class needle {}\n",
      lifetime: Symbol(`draft-${index}`),
    }));
    const emptyPort: JavaProjectTextSearchPort = {
      search: vi.fn(async (request) => ({
        ...request,
        matches: [],
        scannedFiles: 0,
        skippedFiles: 0,
        truncated: false,
      })),
    };
    const { hook } = setup(emptyPort, drafts);
    await act(() => hook.result.current.search("needle", false, "app"));
    expect(hook.result.current.searchedDraftFiles).toBe(128);
    expect(hook.result.current.skippedDraftFiles).toBe(1);
    expect(hook.result.current.matches).toHaveLength(128);
    expect(hook.result.current.truncated).toBe(true);

    const { hook: oversized } = setup(undefined, [
      {
        path: "app/src/main/java/Widget.java",
        content: "needle ".repeat(350_000),
        lifetime: Symbol("oversized-widget"),
      },
    ]);
    await act(() => oversized.result.current.search("Widget", false, "app"));
    expect(oversized.result.current.matches).toEqual([]);
    expect(oversized.result.current.searchedDraftFiles).toBe(0);
    expect(oversized.result.current.skippedDraftFiles).toBe(1);
    expect(oversized.result.current.truncated).toBe(true);
  });

  it("discards a late result after workspace switching", async () => {
    let resolve!: (value: Awaited<ReturnType<JavaProjectTextSearchPort["search"]>>) => void;
    const port: JavaProjectTextSearchPort = {
      search: vi.fn<JavaProjectTextSearchPort["search"]>(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    };
    const { hook, switchWorkspace } = setup(port);
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.search("Widget", false, "app");
    });
    switchWorkspace();
    resolve({
      workspaceId: "one",
      generation: 1,
      requestId: "java-search-1-1",
      projectPath: "app",
      query: "Widget",
      matches: [{ path: "app/Widget.java", line: 1, column: 7, snippet: "class Widget {}" }],
      scannedFiles: 1,
      skippedFiles: 0,
      truncated: false,
    });
    await act(async () => pending);
    expect(hook.result.current.matches).toEqual([]);
  });

  it("discards disk and draft matches when a dirty buffer changes during the search", async () => {
    let resolve!: (value: Awaited<ReturnType<JavaProjectTextSearchPort["search"]>>) => void;
    const port: JavaProjectTextSearchPort = {
      search: vi.fn<JavaProjectTextSearchPort["search"]>(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    };
    const lifetime = Symbol("same-buffer-lifetime");
    const { hook, setDrafts } = setup(port, [
      { path: "app/src/Main.java", content: "class Before {}", lifetime },
    ]);
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.search("Before", false, "app");
    });
    setDrafts([{ path: "app/src/Main.java", content: "class After {}", lifetime }]);
    resolve({
      workspaceId: "one",
      generation: 1,
      requestId: "java-search-1-1",
      projectPath: "app",
      query: "Before",
      matches: [{ path: "app/src/Main.java", line: 1, column: 7, snippet: "class Before {}" }],
      scannedFiles: 1,
      skippedFiles: 0,
      truncated: false,
    });
    await act(async () => pending);
    expect(hook.result.current.matches).toEqual([]);
    expect(hook.result.current.hasSearched).toBe(false);
  });

  it("reports an uncorrelated provider response as an error", async () => {
    const port: JavaProjectTextSearchPort = {
      search: vi.fn(async (request) => ({
        ...request,
        requestId: "different-request",
        matches: [],
        scannedFiles: 0,
        skippedFiles: 0,
        truncated: false,
      })),
    };
    const { hook } = setup(port);
    await act(() => hook.result.current.search("Widget", false, ""));
    expect(hook.result.current.error).toContain("search failed");
    expect(hook.result.current.matches).toEqual([]);
  });
});
