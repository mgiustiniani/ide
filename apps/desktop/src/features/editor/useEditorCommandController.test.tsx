import type { EditorTab } from "@ide/contracts";
import { StrictMode, useEffect } from "react";
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
  const lifetimes = new Map<string, symbol>();
  const editor = {
    bufferLifetime: vi.fn((filePath: string) => {
      if (!state.tabs.some((tab) => tab.filePath === filePath)) return undefined;
      if (!lifetimes.has(filePath)) lifetimes.set(filePath, Symbol());
      return lifetimes.get(filePath);
    }),
    updateContent: vi.fn(),
    saveFile: vi.fn(async (filePath: string) => {
      order.push(`editor.save:${filePath}`);
      state.tabs = state.tabs.map((tab) =>
        tab.filePath === filePath ? { ...tab, isDirty: false } : tab,
      );
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
  it("refreshes the file tree after saving a client-managed new-file draft", async () => {
    const refresh = vi.fn(async () => undefined);
    const path = "src/main/java/Base.java";
    const h = createHarness({ activeFilePath: path, afterNewFileSaved: refresh }, [
      { filePath: path, isDirty: true, isActive: true, isNew: true },
    ]);
    h.state.activeFilePath = path;
    h.state.contents[path] = "class Base {}";

    await act(async () => h.hook.result.current.saveActiveFile());

    expect(h.editor.saveFile).toHaveBeenCalledExactlyOnceWith(path);
    expect(h.documents.notifySaved).toHaveBeenCalledExactlyOnceWith(path);
    expect(refresh).toHaveBeenCalledExactlyOnceWith(path);
  });

  it("blocks the save shortcut and editing for a library view while Save All can still save workspace drafts", async () => {
    const tab = { filePath: "Main.java", isActive: true, isDirty: true };
    const h = createHarness({ activeReadOnly: true, activeFilePath: "Main.java" }, [tab]);
    h.state.activeFilePath = "Main.java";
    act(() => {
      h.hook.result.current.changeContent("library edit");
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });
    await act(() => h.hook.result.current.saveActiveFile());
    expect(h.editor.updateContent).not.toHaveBeenCalled();
    expect(h.editor.saveFile).not.toHaveBeenCalled();
    expect(h.documents.flush).not.toHaveBeenCalled();
    await act(() => h.hook.result.current.saveAll());
    expect(h.editor.saveFile).toHaveBeenCalledExactlyOnceWith("Main.java");
  });

  it.each(["pending", "refused"] as const)("persists Java execution sources while language-service synchronization is %s", async (state) => {
    const javaSync = new Promise<void>(() => undefined);
    const h = createHarness(
      {
        activeFilePath: "Main.java",
        afterNewFileSaved: vi.fn(async () => undefined),
      },
      [{ filePath: "Main.java", isActive: true, isDirty: true }],
    );
    h.state.activeFilePath = "Main.java";
    h.state.contents["Main.java"] = "public class Main {}";
    h.documents.flush.mockReturnValue(javaSync);
    if (state === "pending") {
      h.documents.notifySaved.mockReturnValue(javaSync);
    } else {
      h.documents.notifySaved.mockRejectedValue(new Error("Document is already open in the current session"));
    }

    await act(() =>
      h.hook.result.current.saveAll({ deferJavaLanguageServiceSync: true }),
    );

    expect(h.documents.flush).not.toHaveBeenCalled();
    expect(h.editor.saveFile).toHaveBeenCalledExactlyOnceWith("Main.java");
    expect(h.documents.notifySaved).toHaveBeenCalledExactlyOnceWith("Main.java");
    expect(h.state.tabs[0]?.isDirty).toBe(false);
  });

  it("saves Java files while language-service startup is still pending", async () => {
    const javaSync = new Promise<void>(() => undefined);
    const filePath = "src/Main.java";
    const h = createHarness({ activeFilePath: filePath }, [
      { filePath, isActive: true, isDirty: true },
    ]);
    h.state.activeFilePath = filePath;
    h.state.contents[filePath] = "public class Main {}";
    h.documents.flush.mockReturnValue(javaSync);
    h.documents.notifySaved.mockReturnValue(javaSync);

    await act(() => h.hook.result.current.saveActiveFile());

    expect(h.documents.flush).not.toHaveBeenCalled();
    expect(h.editor.saveFile).toHaveBeenCalledExactlyOnceWith(filePath);
    expect(h.documents.notifySaved).toHaveBeenCalledExactlyOnceWith(filePath);
    expect(h.state.tabs[0]?.isDirty).toBe(false);
  });

  it("reports deferred Java synchronization failure without undoing the disk save or exposing details", async () => {
    const filePath = "src/Main.java";
    const h = createHarness({ activeFilePath: filePath }, [
      { filePath, isActive: true, isDirty: true },
    ]);
    h.state.activeFilePath = filePath;
    h.state.contents[filePath] = "public class Main {}";
    h.documents.notifySaved.mockRejectedValueOnce(
      new Error("private source path /workspace/Secret.java could not synchronize"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await act(() => h.hook.result.current.saveActiveFile());
    await waitFor(() =>
      expect(h.hook.result.current.error).toBe(
        "The saved Java file could not be synchronized with the language service.",
      ),
    );

    expect(h.editor.saveFile).toHaveBeenCalledExactlyOnceWith(filePath);
    expect(h.state.tabs[0]?.isDirty).toBe(false);
    expect(h.hook.result.current.error).not.toContain("Secret.java");
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      "[EditorCommands] Saved Java file synchronization failed",
      { errorType: "Error" },
    );
  });
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

  it("commits multi-file edits only when every target still matches an open buffer", () => {
    const harness = createHarness(
      {
        activeFilePath: "src/Use.java",
        hasJavaContext: true,
      },
      [
        { filePath: "src/Use.java", isDirty: false, isActive: true },
        { filePath: "src/Main.java", isDirty: false, isActive: false },
      ],
    );
    harness.state.activeFilePath = "src/Use.java";
    harness.state.contents = {
      "src/Use.java": "class Use {}\n",
      "src/Main.java": "class Main {}\n",
    };
    const changes = [
      {
        filePath: "src/Main.java",
        before: "class Main {}\n",
        after: "class Main { String caption() { return null; } }\n",
      },
    ];
    let accepted = false;
    act(() => {
      accepted = harness.hook.result.current.changeOpenDocumentContents(changes);
    });
    expect(accepted).toBe(true);
    expect(harness.editor.updateContent).toHaveBeenCalledExactlyOnceWith(
      "src/Main.java",
      "class Main { String caption() { return null; } }\n",
    );
    expect(harness.documents.queueChange).toHaveBeenCalledExactlyOnceWith(
      "src/Main.java",
      "class Main { String caption() { return null; } }\n",
    );

    harness.editor.updateContent.mockClear();
    harness.documents.queueChange.mockClear();
    let staleAccepted = true;
    act(() => {
      staleAccepted = harness.hook.result.current.changeOpenDocumentContents([
        { ...changes[0]!, before: "stale text" },
      ]);
    });
    expect(staleAccepted).toBe(false);
    expect(harness.editor.updateContent).not.toHaveBeenCalled();
    expect(harness.documents.queueChange).not.toHaveBeenCalled();
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

  it("checkpoints a dirty buffer before saving without changing the save protocol", async () => {
    const checkpoint = vi.fn(async () => undefined);
    const harness = createHarness({ checkpointBeforeSave: checkpoint });
    harness.state.activeFilePath = "src/dirty.ts";
    harness.state.tabs = [{ filePath: "src/dirty.ts", isDirty: true, isActive: true }];
    await act(() => harness.hook.result.current.saveActiveFile());
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
      harness.editor.saveFile.mock.invocationCallOrder[0],
    );
    expect(harness.documents.notifySaved).toHaveBeenCalledWith("src/dirty.ts");
  });

  it("refuses an old-workspace save after its checkpoint is delayed", async () => {
    let release!: () => void;
    const harness = createHarness({
      workspaceGeneration: 1,
      checkpointBeforeSave: () =>
        new Promise<void>((done) => {
          release = done;
        }),
    });
    harness.state.activeFilePath = "src/dirty.ts";
    harness.state.tabs = [{ filePath: "src/dirty.ts", isDirty: true, isActive: true }];
    let pending!: Promise<void>;
    await act(async () => {
      pending = harness.hook.result.current.saveActiveFile();
      await Promise.resolve();
    });
    harness.hook.rerender({ ...harness.dependencies, workspaceGeneration: 2 });
    await act(async () => {
      release();
      await pending;
    });
    expect(harness.editor.saveFile).not.toHaveBeenCalled();
    expect(harness.state.tabs[0].isDirty).toBe(true);
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

  it("refuses closing a buffer edited during the pending save", async () => {
    const harness = createHarness({}, [
      { filePath: "src/close.ts", isDirty: true, isActive: true },
    ]);
    harness.editor.saveFile.mockImplementationOnce(async () => undefined);
    await act(() => harness.hook.result.current.closeTab("src/close.ts"));
    expect(harness.editor.closeFile).not.toHaveBeenCalled();
    expect(harness.desktopEditor.fileClosed).not.toHaveBeenCalled();
    expect(harness.hook.result.current.error).toContain("changed while saving");
  });

  it("retains edits arriving while the language document is closing", async () => {
    const harness = createHarness({}, [
      { filePath: "src/close.ts", isDirty: false, isActive: true },
    ]);
    harness.documents.closeDocument.mockImplementationOnce(async () => {
      harness.state.tabs[0].isDirty = true;
      harness.state.contents["src/close.ts"] = "new edit";
    });
    await act(() => harness.hook.result.current.closeTab("src/close.ts"));
    expect(harness.editor.closeFile).not.toHaveBeenCalled();
    expect(harness.documents.activate).toHaveBeenCalledWith("src/close.ts", "new edit");
  });

  it("ignores completion of a tab-close request from an old workspace generation", async () => {
    const harness = createHarness({ workspaceGeneration: 1 }, [
      { filePath: "src/close.ts", isDirty: false, isActive: true },
    ]);
    let release!: () => void;
    harness.documents.closeDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    let closing!: Promise<void>;
    await act(async () => {
      closing = harness.hook.result.current.closeTab("src/close.ts");
      await Promise.resolve();
    });
    harness.hook.rerender({ ...harness.dependencies, workspaceGeneration: 2 });
    await act(async () => {
      release();
      await closing;
    });
    expect(harness.editor.closeFile).not.toHaveBeenCalled();
    expect(harness.desktopEditor.fileClosed).not.toHaveBeenCalled();
  });

  it("does not publish a completed provider close into a newer workspace", async () => {
    const harness = createHarness({ workspaceGeneration: 1 }, [
      { filePath: "src/close.ts", isDirty: false, isActive: true },
    ]);
    let release!: () => void;
    harness.editor.closeFile.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    let closing!: Promise<void>;
    await act(async () => {
      closing = harness.hook.result.current.closeTab("src/close.ts");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(harness.editor.closeFile).toHaveBeenCalledOnce();
    harness.hook.rerender({ ...harness.dependencies, workspaceGeneration: 2 });
    await act(async () => {
      release();
      await closing;
    });
    expect(harness.desktopEditor.fileClosed).not.toHaveBeenCalled();
    expect(harness.documents.activate).not.toHaveBeenCalled();
  });

  it("does not resume save or tab close after unmount during document flush", async () => {
    for (const operation of ["save", "close"]) {
      const harness = createHarness({}, [
        { filePath: "src/close.ts", isDirty: true, isActive: true },
      ]);
      harness.state.activeFilePath = "src/close.ts";
      let release!: () => void;
      harness.documents.flush.mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            release = done;
          }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending =
          operation === "save"
            ? harness.hook.result.current.saveActiveFile()
            : harness.hook.result.current.closeTab("src/close.ts");
      });
      harness.hook.unmount();
      await act(async () => {
        release();
        await pending;
      });
      expect(harness.editor.saveFile).not.toHaveBeenCalled();
      expect(harness.editor.closeFile).not.toHaveBeenCalled();
      expect(harness.documents.closeDocument).not.toHaveBeenCalled();
      expect(harness.desktopEditor.fileClosed).not.toHaveBeenCalled();
      expect(harness.state.tabs[0].isDirty).toBe(true);
    }
  });

  it("reactivates the retained language document when the final provider close refuses an edit", async () => {
    const harness = createHarness({}, [
      { filePath: "src/close.ts", isDirty: false, isActive: true },
    ]);
    harness.editor.closeFile.mockImplementationOnce(async () => {
      harness.state.tabs[0].isDirty = true;
      harness.state.contents["src/close.ts"] = "latest retained draft";
      throw new Error("The file changed while closing; save it again before closing.");
    });
    await act(() => harness.hook.result.current.closeTab("src/close.ts"));
    expect(harness.documents.activate).toHaveBeenCalledWith(
      "src/close.ts",
      "latest retained draft",
    );
    expect(harness.desktopEditor.fileClosed).not.toHaveBeenCalled();
    expect(harness.hook.result.current.error).toContain("changed while closing");
    expect(harness.state.tabs[0].isDirty).toBe(true);
  });

  it("does not resume an operation from the retired StrictMode effect lifetime", async () => {
    const harness = createHarness({}, [
      { filePath: "src/close.ts", isDirty: true, isActive: true },
    ]);
    harness.state.activeFilePath = "src/close.ts";
    harness.hook.unmount();
    const releases: Array<() => void> = [];
    harness.documents.flush.mockImplementation(
      () =>
        new Promise<void>((done) => {
          releases.push(done);
        }),
    );
    const requests: Array<Promise<void>> = [];
    const hook = renderHook(
      () => {
        const commands = useEditorCommandController(harness.dependencies);
        const { saveActiveFile } = commands;
        useEffect(() => {
          requests.push(saveActiveFile());
        }, [saveActiveFile]);
        return commands;
      },
      { wrapper: StrictMode },
    );
    expect(requests).toHaveLength(2);
    await act(async () => {
      releases[0]();
      await requests[0];
    });
    expect(harness.editor.saveFile).not.toHaveBeenCalled();
    await act(async () => {
      releases[1]();
      await requests[1];
    });
    expect(harness.editor.saveFile).toHaveBeenCalledOnce();
    expect(harness.documents.notifySaved).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it("fails save-all admission after unmount without writing subsequent buffers", async () => {
    const harness = createHarness({}, [
      { filePath: "one.ts", isDirty: true, isActive: true },
      { filePath: "two.ts", isDirty: true, isActive: false },
    ]);
    let release!: () => void;
    harness.documents.flush.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = harness.hook.result.current.saveAll();
    });
    harness.hook.unmount();
    await act(async () => {
      release();
      await expect(pending).rejects.toThrow("workspace changed");
    });
    expect(harness.editor.saveFile).not.toHaveBeenCalled();
    expect(harness.documents.flush).toHaveBeenCalledTimes(1);
    expect(harness.state.tabs.every((tab) => tab.isDirty)).toBe(true);
  });

  it("preserves the original close error and buffer when language reactivation also fails", async () => {
    const harness = createHarness({}, [
      { filePath: "src/close.ts", isDirty: false, isActive: true },
    ]);
    harness.state.contents["src/close.ts"] = "retained text";
    harness.editor.closeFile.mockRejectedValueOnce(
      new Error("The file changed while closing; save it again before closing."),
    );
    harness.documents.activate.mockRejectedValueOnce(
      new Error("secret-token private language failure"),
    );
    await act(() => harness.hook.result.current.closeTab("src/close.ts"));
    expect(harness.state.contents["src/close.ts"]).toBe("retained text");
    expect(harness.hook.result.current.error).toBe(
      "The file changed while closing; save it again before closing.",
    );
    expect(harness.desktopEditor.fileClosed).not.toHaveBeenCalled();
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
    const privatePath = "/private/workspace/Secret.ts";
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
