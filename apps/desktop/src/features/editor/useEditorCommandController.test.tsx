import type { EditorTab } from "@ide/contracts";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useEditorCommandController,
  type EditorCommandStoreState,
  type UseEditorCommandControllerDependencies,
} from "./useEditorCommandController";

function createHarness(
  overrides: Partial<UseEditorCommandControllerDependencies> = {},
  initialTabs: EditorTab[] = [],
) {
  const order: string[] = [];
  const state: EditorCommandStoreState = {
    activeFilePath: null,
    tabs: initialTabs,
    contents: {},
  };
  const editor = {
    updateContent: vi.fn(),
    saveFile: vi.fn(async (filePath: string) => {
      order.push(`editor.save:${filePath}`);
    }),
    closeFile: vi.fn(async (filePath: string) => {
      order.push(`editor.close:${filePath}`);
    }),
  };
  const desktopEditor = {
    activateTab: vi.fn(),
    fileClosed: vi.fn((filePath: string) => {
      order.push(`desktop.closed:${filePath}`);
    }),
  };
  const documents = {
    queueChange: vi.fn(),
    flush: vi.fn(async (filePath: string) => {
      order.push(`documents.flush:${filePath}`);
    }),
    notifySaved: vi.fn(async (filePath: string) => {
      order.push(`documents.saved:${filePath}`);
    }),
    closeDocument: vi.fn(async (filePath: string) => {
      order.push(`documents.close:${filePath}`);
    }),
    activate: vi.fn(async () => undefined),
  };
  const dependencies: UseEditorCommandControllerDependencies = {
    activeFilePath: null,
    activeContent: "",
    hasJavaContext: false,
    workspaceId: "workspace-one",
    getEditorState: () => state,
    editor,
    desktopEditor,
    documents,
    ...overrides,
  };
  const hook = renderHook(
    (props: UseEditorCommandControllerDependencies) => useEditorCommandController(props),
    { initialProps: dependencies },
  );

  return { hook, state, editor, desktopEditor, documents, dependencies, order };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useEditorCommandController", () => {
  it("updates and queues changes only when an active file exists", () => {
    const harness = createHarness();

    act(() => harness.hook.result.current.changeContent("ignored"));
    expect(harness.editor.updateContent).not.toHaveBeenCalled();
    expect(harness.documents.queueChange).not.toHaveBeenCalled();

    harness.hook.rerender({ ...harness.dependencies, activeFilePath: "src/Main.java" });
    act(() => harness.hook.result.current.changeContent("class Main {}"));
    expect(harness.editor.updateContent).toHaveBeenCalledWith("src/Main.java", "class Main {}");
    expect(harness.documents.queueChange).toHaveBeenCalledWith("src/Main.java", "class Main {}");
  });

  it("ignores save when no active dirty tab exists", async () => {
    const harness = createHarness();

    await act(() => harness.hook.result.current.saveActiveFile());
    harness.state.activeFilePath = "src/clean.ts";
    harness.state.tabs = [{ filePath: "src/clean.ts", isDirty: false, isActive: true }];
    await act(() => harness.hook.result.current.saveActiveFile());

    expect(harness.documents.flush).not.toHaveBeenCalled();
    expect(harness.editor.saveFile).not.toHaveBeenCalled();
    expect(harness.documents.notifySaved).not.toHaveBeenCalled();
  });

  it("flushes, saves, and notifies a dirty active file in order", async () => {
    const harness = createHarness();
    harness.state.activeFilePath = "src/dirty.ts";
    harness.state.tabs = [{ filePath: "src/dirty.ts", isDirty: true, isActive: true }];

    await act(() => harness.hook.result.current.saveActiveFile());

    expect(harness.order).toEqual([
      "documents.flush:src/dirty.ts",
      "editor.save:src/dirty.ts",
      "documents.saved:src/dirty.ts",
    ]);
  });

  it("handles the Ctrl/Cmd+S shortcut and leaves unrelated key presses alone", async () => {
    const harness = createHarness();
    harness.state.activeFilePath = "src/shortcut.ts";
    harness.state.tabs = [{ filePath: "src/shortcut.ts", isDirty: true, isActive: true }];

    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    expect(harness.documents.flush).not.toHaveBeenCalled();

    const saveEvent = new KeyboardEvent("keydown", {
      key: "S",
      metaKey: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(saveEvent));

    expect(saveEvent.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(harness.documents.notifySaved).toHaveBeenCalledWith("src/shortcut.ts"),
    );
  });

  it("closes dirty tabs only after synchronization and reports the closed file", async () => {
    const tab = { filePath: "src/close.ts", isDirty: true, isActive: true };
    const harness = createHarness({}, [tab]);

    await act(() => harness.hook.result.current.closeTab(tab.filePath));

    expect(harness.order).toEqual([
      "documents.flush:src/close.ts",
      "editor.save:src/close.ts",
      "documents.saved:src/close.ts",
      "documents.close:src/close.ts",
      "editor.close:src/close.ts",
      "desktop.closed:src/close.ts",
    ]);
  });

  it("activates desktop tabs and synchronizes only buffers that exist", () => {
    const harness = createHarness();
    harness.state.contents["src/open.ts"] = "const open = true;";

    act(() => harness.hook.result.current.activateTab("src/open.ts"));
    expect(harness.desktopEditor.activateTab).toHaveBeenCalledWith("src/open.ts");
    expect(harness.documents.activate).toHaveBeenCalledWith("src/open.ts", "const open = true;");

    harness.documents.activate.mockClear();
    act(() => harness.hook.result.current.activateTab("src/missing.ts"));
    expect(harness.desktopEditor.activateTab).toHaveBeenCalledWith("src/missing.ts");
    expect(harness.documents.activate).not.toHaveBeenCalled();
  });

  it("activates the current Java document when its context or workspace changes", () => {
    const harness = createHarness({
      activeFilePath: "src/Main.java",
      activeContent: "class Main {}",
      hasJavaContext: true,
    });

    expect(harness.documents.activate).toHaveBeenCalledWith("src/Main.java", "class Main {}");
    harness.documents.activate.mockClear();

    harness.hook.rerender({ ...harness.dependencies, workspaceId: "workspace-two" });
    expect(harness.documents.activate).toHaveBeenCalledWith("src/Main.java", "class Main {}");

    harness.documents.activate.mockClear();
    harness.hook.rerender({
      ...harness.dependencies,
      workspaceId: "workspace-three",
      hasJavaContext: false,
    });
    expect(harness.documents.activate).not.toHaveBeenCalled();
  });

  it("sanitizes save and close failures without leaking paths, content, or error messages", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const privatePath = "/private/workspace/Secret.java";
    const harness = createHarness({}, [{ filePath: privatePath, isDirty: true, isActive: true }]);
    harness.state.activeFilePath = privatePath;
    harness.documents.flush.mockRejectedValueOnce(new Error("secret source: class Password {}"));

    await act(() => harness.hook.result.current.saveActiveFile());
    expect(consoleError).toHaveBeenNthCalledWith(1, "[EditorCommands] Active file save failed", {
      errorType: "Error",
    });

    harness.documents.flush.mockResolvedValueOnce(undefined);
    harness.documents.closeDocument.mockRejectedValueOnce(
      new Error("close failed for /private/workspace/Secret.java"),
    );
    await act(() => harness.hook.result.current.closeTab(privatePath));
    expect(consoleError).toHaveBeenNthCalledWith(2, "[EditorCommands] Tab close failed", {
      errorType: "Error",
    });
    expect(harness.desktopEditor.fileClosed).not.toHaveBeenCalled();

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(privatePath);
    expect(logged).not.toContain("Password");
    expect(logged).not.toContain("close failed for");
  });
});
