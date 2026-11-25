import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  javaNavigationRefusal,
  type JavaNavigationRequest,
  type JavaNavigationResult,
} from "@ide/contracts";
import { EditorViewModel, type JavaNavigationPort } from "@ide/web-core";
import { createEditorStore } from "@ide/web-core/state";
import { EditorOpenCoordinator } from "@ide/web-core/editor-open-coordinator";
import type { EditorPort } from "@ide/web-core/ports";
import { useJavaNavigationController } from "./useJavaNavigationController";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import type { JavaEffectiveProjectContext, JavaProjectContextSettings } from "@ide/contracts";

const projectSettings: JavaProjectContextSettings = {
  projectPath: "",
  sdkHome: "/jdk",
  mavenRepository: "/maven",
  activeMavenProfiles: ["alternate"],
  inactiveMavenProfiles: ["inactive"],
};
function effectiveProject(
  schemaVersion: JavaEffectiveProjectContext["schemaVersion"] = "java-project-context-v1",
) {
  return {
    ...javaProjectContextResponse({
      ...projectSettings,
      workspaceId: "one",
      generation: 1,
      requestId: "context",
    }).context,
    schemaVersion,
  };
}

const source = "class Main { Helper helper; }";
const target = "class Helper {}";
const request: JavaNavigationRequest = {
  workspaceId: "one",
  generation: 1,
  requestId: "definition-1",
  kind: "definition",
  document: { path: "Main.java", text: source, version: 1 },
  position: { line: 0, character: 13 },
  includeDeclaration: true,
  limit: 1,
};
const location = {
  path: "Helper.java",
  range: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
};
function ready(query = request): Extract<JavaNavigationResult, { status: "ready" }> {
  return {
    workspaceId: query.workspaceId,
    generation: query.generation,
    requestId: query.requestId,
    kind: query.kind,
    documentPath: query.document.path,
    documentVersion: query.document.version,
    status: "ready",
    locations: [location],
    sourceFiles: [{ path: "Helper.java", text: target }],
    items: [],
    returned: 1,
    ...(query.editorOverlay
      ? {
          editorOverlay: {
            baseSnapshotHash: query.projectContext!.snapshotHash,
            providerSnapshotHash: "d".repeat(64),
            overlayHash: "e".repeat(64),
            documents: query.editorOverlay.documents.map((document) => ({
              path: document.path,
              version: document.version,
              contentSha256: "f".repeat(64),
            })),
          },
        }
      : {}),
    total: 1,
    truncated: false,
    complete: true,
    warningCount: 0,
    snapshotHash: "a".repeat(64),
    ...(query.projectContext
      ? {
          projectContext: {
            projectPath: query.projectContext.projectPath,
            contextHash: query.projectContext.contextHash,
            contextSchemaVersion:
              query.projectContext.contextSchemaVersion ?? "java-project-context-v1",
            platformIdentities: [...query.projectContext.platformIdentities],
          },
        }
      : {}),
    sourceHash: "b".repeat(64),
    indexGeneration: 3,
    provider: {
      name: "RefactorKit",
      version: "0.7.0",
      backend: "eclipse-jdt-3.44-bindings-v1",
      evidence: "compiler",
    },
  };
}
async function harness(
  getProjectContext?: () => {
    settings: JavaProjectContextSettings;
    context: JavaEffectiveProjectContext | null;
  },
) {
  const store = createEditorStore();
  const disk = new Map([
    ["Main.java", source],
    ["Helper.java", target],
  ]);
  const filePort: EditorPort = {
    loadContent: vi.fn(async (path: string) => ({
      filePath: path,
      content: disk.get(path)!,
      language: "java",
    })),
    getOpenFiles: vi.fn(async () => store.getState().openFiles),
    saveContent: vi.fn(async (path: string, text: string) => {
      disk.set(path, text);
      return store.getState().openFiles;
    }),
    closeFile: vi.fn(async (path: string) =>
      store.getState().openFiles.filter((file) => file.filePath !== path),
    ),
  };
  const editor = new EditorViewModel(store.getState, filePort);
  await editor.openFile("Main.java");
  const port: JavaNavigationPort = {
    query: vi.fn(async (query) => ready(query)),
    cancel: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
  const context = { workspaceId: "one" as string | null, generation: 1, isSwitching: false };
  const revealed = vi.fn();
  const onProjectContextRetired = vi.fn();
  const coordinator = new EditorOpenCoordinator(editor, store.getState);
  const navigate = vi.fn(
    async (item: typeof location, canReveal: (afterOpen: boolean) => boolean) => {
      if (!canReveal(false)) return false;
      await coordinator.open(item.path);
      if (coordinator.state.status !== "ready") return false;
      if (!canReveal(true)) return false;
      revealed(item);
      return true;
    },
  );
  const props = {
    port,
    workspaceId: context.workspaceId,
    generation: context.generation,
    getContext: () => context,
    getEditorState: store.getState,
    getProjectContext,
    onProjectContextRetired,
    editor,
    navigate,
  };
  const hook = renderHook(useJavaNavigationController, { initialProps: props });
  async function query(value = request) {
    let response!: JavaNavigationResult;
    await act(async () => {
      response = await hook.result.current.navigation!.query(value);
    });
    return response;
  }
  return {
    store,
    disk,
    editor,
    filePort,
    port,
    context,
    props,
    hook,
    revealed,
    navigate,
    query,
    onProjectContextRetired,
  };
}

describe("Java navigation editor authority", () => {
  it("carries selected project SDK repository profiles and provider identities into navigation", async () => {
    const selected = { settings: projectSettings, context: effectiveProject() };
    const h = await harness(() => selected);
    expect(await h.query()).toMatchObject({
      status: "ready",
      projectContext: { contextHash: "b".repeat(64) },
    });
    expect(h.port.query).toHaveBeenCalledWith(
      expect.objectContaining({
        projectContext: {
          ...projectSettings,
          contextSchemaVersion: "java-project-context-v1",
          snapshotHash: "a".repeat(64),
          contextHash: "b".repeat(64),
          platformIdentities: ["c".repeat(64)],
        },
      }),
    );
    selected.settings = { ...projectSettings, activeMavenProfiles: ["other"] };
    await act(async () =>
      expect(
        await h.hook.result.current.navigation!.openLocation(request.requestId, location),
      ).toBe(false),
    );
    expect(h.revealed).not.toHaveBeenCalled();
  });

  it("retires the selected project context when the native bridge reports that its session was discarded", async () => {
    const message =
      "RefactorKit could not complete Java navigation. The project session was retired; synchronize the Java project and retry.";
    const h = await harness(() => ({ settings: projectSettings, context: effectiveProject() }));
    vi.mocked(h.port.query).mockResolvedValueOnce({
      ...javaNavigationRefusal(request, "refused", message),
      status: "refused",
      message,
      projectContextRetired: true,
    });

    await expect(h.query()).resolves.toMatchObject({
      status: "refused",
      projectContextRetired: true,
    });

    expect(h.onProjectContextRetired).toHaveBeenCalledOnce();
    expect(h.onProjectContextRetired).toHaveBeenCalledWith(message);
    expect(h.hook.result.current.message).toBe(message);
  });
  it("retires the selected project context even if an editor buffer changes while the failed query is pending", async () => {
    const message = "The selected project session was retired; synchronize again.";
    const h = await harness(() => ({ settings: projectSettings, context: effectiveProject() }));
    let complete!: (result: JavaNavigationResult) => void;
    vi.mocked(h.port.query).mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );

    let pending!: Promise<JavaNavigationResult>;
    act(() => {
      pending = h.hook.result.current.navigation!.query(request);
    });
    await waitFor(() => expect(h.port.query).toHaveBeenCalledOnce());
    act(() => h.editor.updateContent("Main.java", `${source}\n// concurrent edit`));

    let response!: JavaNavigationResult;
    await act(async () => {
      complete({
        ...javaNavigationRefusal(request, "refused", message),
        status: "refused",
        message,
        projectContextRetired: true,
      });
      response = await pending;
    });

    expect(response).toMatchObject({ status: "refused", projectContextRetired: true });
    expect(h.onProjectContextRetired).toHaveBeenCalledOnce();
    expect(h.onProjectContextRetired).toHaveBeenCalledWith(message);
  });
  it("carries a v2 project-context schema into native Java navigation", async () => {
    const selected = {
      settings: projectSettings,
      context: effectiveProject("java-project-context-v2"),
    };
    const h = await harness(() => selected);
    expect(await h.query()).toMatchObject({
      status: "ready",
      projectContext: { contextSchemaVersion: "java-project-context-v2" },
    });
    expect(h.port.query).toHaveBeenCalledWith(
      expect.objectContaining({
        projectContext: expect.objectContaining({
          contextSchemaVersion: "java-project-context-v2",
        }),
      }),
    );
  });
  it.each(["partial", "unavailable", "outside"])(
    "refuses %s selected project context before calling the provider",
    async (kind) => {
      const selected = {
        settings:
          kind === "outside" ? { ...projectSettings, projectPath: "maven" } : projectSettings,
        context:
          kind === "unavailable"
            ? null
            : {
                ...effectiveProject(),
                status: kind === "partial" ? ("partial" as const) : ("available" as const),
              },
      };
      const h = await harness(() => selected);
      expect(await h.query()).toMatchObject({ status: "refused" });
      expect(h.port.query).not.toHaveBeenCalled();
      expect(h.store.getState().contents["Main.java"]).toBe(source);
    },
  );
  it("rejects missing SDK attestation and a context replaced during a delayed query", async () => {
    const selected = { settings: projectSettings, context: effectiveProject() };
    const h = await harness(() => selected);
    vi.mocked(h.port.query).mockResolvedValueOnce(ready());
    expect(await h.query()).toMatchObject({ status: "refused" });
    let finish!: () => void;
    vi.mocked(h.port.query).mockImplementationOnce(async (value) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return ready(value);
    });
    let pending!: Promise<JavaNavigationResult>;
    await act(async () => {
      pending = h.hook.result.current.navigation!.query(request);
    });
    selected.context = { ...selected.context, contextHash: "d".repeat(64) };
    await act(async () => {
      finish();
      expect(await pending).toMatchObject({ status: "refused" });
    });
    expect(h.revealed).not.toHaveBeenCalled();
  });
  it("opens a verified saved target through the real editor without saving any source", async () => {
    const h = await harness();
    expect(await h.query()).toMatchObject({ status: "ready" });
    await act(async () =>
      expect(
        await h.hook.result.current.navigation!.openLocation(request.requestId, location),
      ).toBe(true),
    );
    expect(h.revealed).toHaveBeenCalledWith(location);
    expect(h.store.getState().contents["Helper.java"]).toBe(target);
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
    h.hook.unmount();
    expect(h.port.stop).toHaveBeenCalledWith({ workspaceId: "one", generation: 1 });
  });

  it("refuses a dirty companion buffer before contacting RefactorKit", async () => {
    const h = await harness();
    await h.editor.openFile("Helper.java");
    h.editor.updateContent("Helper.java", "companion draft");
    expect(await h.query()).toMatchObject({ status: "refused" });
    expect(h.port.query).not.toHaveBeenCalled();
    expect(h.store.getState().contents["Helper.java"]).toBe("companion draft");
  });

  it("navigates with captured dirty Java companions under SDK authority without saving them", async () => {
    const h = await harness(() => ({ settings: projectSettings, context: effectiveProject() }));
    await h.editor.openFile("Helper.java");
    const draft = "// editor draft\n" + target;
    h.editor.updateContent("Helper.java", draft);
    vi.mocked(h.port.query).mockImplementation(async (query) => ({
      ...ready(query),
      sourceFiles: [{ path: "Helper.java", text: draft }],
    }));
    const result = await h.query();
    expect(result.status).toBe("ready");
    const sent = vi.mocked(h.port.query).mock.calls[0][0];
    expect(sent.editorOverlay?.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Main.java", text: source }),
        expect.objectContaining({ path: "Helper.java", text: draft }),
      ]),
    );
    await act(async () =>
      expect(
        await h.hook.result.current.navigation!.openLocation(request.requestId, location),
      ).toBe(true),
    );
    expect(h.store.getState().contents["Helper.java"]).toBe(draft);
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });

  it("preserves a non-Java draft while navigating saved Java under SDK authority", async () => {
    const h = await harness(() => ({ settings: projectSettings, context: effectiveProject() }));
    h.disk.set("notes.txt", "saved notes");
    await h.editor.openFile("notes.txt");
    h.editor.updateContent("notes.txt", "unrelated draft");
    expect(await h.query()).toMatchObject({ status: "ready" });
    expect(vi.mocked(h.port.query).mock.calls[0][0].editorOverlay).toBeUndefined();
    await act(async () =>
      expect(
        await h.hook.result.current.navigation!.openLocation(request.requestId, location),
      ).toBe(true),
    );
    expect(h.store.getState().contents["notes.txt"]).toBe("unrelated draft");
    expect(h.disk.get("notes.txt")).toBe("saved notes");
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });

  it("revokes a saved Java result when the captured non-Java draft changes", async () => {
    const h = await harness(() => ({ settings: projectSettings, context: effectiveProject() }));
    h.disk.set("notes.txt", "saved notes");
    await h.editor.openFile("notes.txt");
    h.editor.updateContent("notes.txt", "unrelated draft");
    expect(await h.query()).toMatchObject({ status: "ready" });
    h.editor.updateContent("notes.txt", "changed draft");
    await act(async () =>
      expect(
        await h.hook.result.current.navigation!.openLocation(request.requestId, location),
      ).toBe(false),
    );
    expect(h.revealed).not.toHaveBeenCalled();
    expect(h.store.getState().contents["notes.txt"]).toBe("changed draft");
    expect(h.disk.get("notes.txt")).toBe("saved notes");
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });

  it("revokes SDK overlay results when another Java draft changes and returns to identical text", async () => {
    const h = await harness(() => ({ settings: projectSettings, context: effectiveProject() }));
    await h.editor.openFile("Helper.java");
    h.editor.updateContent("Helper.java", "// editor draft\n" + target);
    let resolve!: (result: JavaNavigationResult) => void;
    const pending = {
      promise: new Promise<JavaNavigationResult>((complete) => {
        resolve = complete;
      }),
      resolve: (result: JavaNavigationResult) => resolve(result),
    };
    vi.mocked(h.port.query).mockImplementationOnce(() => pending.promise);
    let result!: Promise<JavaNavigationResult>;
    await act(async () => {
      result = h.hook.result.current.navigation!.query(request);
    });
    const sent = vi.mocked(h.port.query).mock.calls[0][0];
    h.editor.updateContent("Helper.java", "changed again");
    h.editor.updateContent("Helper.java", "// editor draft\n" + target);
    await act(async () => {
      pending.resolve(ready(sent));
      expect((await result).status).toBe("refused");
    });
    expect(h.revealed).not.toHaveBeenCalled();
  });

  it("rejects an SDK dirty query result without immutable-buffer attestation", async () => {
    const h = await harness(() => ({ settings: projectSettings, context: effectiveProject() }));
    h.editor.updateContent("Main.java", "// editor draft\n" + source);
    vi.mocked(h.port.query).mockImplementation(async (query) => {
      const result = ready(query);
      delete result.editorOverlay;
      return result;
    });
    expect(
      (
        await h.query({
          ...request,
          document: { ...request.document, text: "// editor draft\n" + source },
        })
      ).status,
    ).toBe("refused");
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });

  it.each(["ready", "failure"])(
    "revokes a cancelled query before a delayed %s response",
    async (outcome) => {
      const h = await harness();
      let finish!: () => void;
      vi.mocked(h.port.query).mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        if (outcome === "failure") throw new Error("late provider failure");
        return ready();
      });
      let operation!: Promise<JavaNavigationResult>;
      act(() => {
        operation = h.hook.result.current.navigation!.query(request);
      });
      expect(h.hook.result.current.message).toContain("Resolving");
      act(() => {
        h.hook.result.current.navigation!.cancel(request.requestId);
      });
      expect(h.port.cancel).toHaveBeenCalledWith(request.requestId);
      expect(h.hook.result.current.message).toBeNull();
      await act(async () => {
        finish();
        expect(await operation).toMatchObject({ status: "refused" });
      });
      expect(h.hook.result.current.message).toBeNull();
      expect(
        await h.hook.result.current.navigation!.openLocation(request.requestId, location),
      ).toBe(false);
      expect(h.navigate).not.toHaveBeenCalled();
      expect(h.port.stop).not.toHaveBeenCalled();
    },
  );

  it("keeps the current query status when an older request finishes or is cancelled", async () => {
    const h = await harness();
    let finish!: () => void;
    vi.mocked(h.port.query).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return ready();
    });
    let older!: Promise<JavaNavigationResult>;
    act(() => {
      older = h.hook.result.current.navigation!.query(request);
    });
    const next = { ...request, requestId: "next" };
    vi.mocked(h.port.query).mockResolvedValueOnce(
      javaNavigationRefusal(next, "unavailable", "Install the provider."),
    );
    await h.query(next);
    await act(async () => {
      finish();
      await older;
    });
    expect(h.hook.result.current.message).toBe("Install the provider.");
    act(() => {
      h.hook.result.current.navigation!.cancel(request.requestId);
    });
    expect(h.hook.result.current.message).toBe("Install the provider.");
    expect(await h.hook.result.current.navigation!.openLocation(request.requestId, location)).toBe(
      false,
    );
  });

  it.each(["edit-save", "close-reopen", "workspace"])(
    "rejects a delayed query after %s",
    async (change) => {
      const h = await harness();
      let resolve!: (value: JavaNavigationResult) => void;
      vi.mocked(h.port.query).mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      let pending!: Promise<JavaNavigationResult>;
      act(() => {
        pending = h.hook.result.current.navigation!.query(request);
      });
      if (change === "edit-save") {
        h.editor.updateContent("Main.java", "changed");
        h.editor.updateContent("Main.java", source);
        await h.editor.saveFile("Main.java");
      } else if (change === "close-reopen") {
        await h.editor.closeFile("Main.java");
        await h.editor.openFile("Main.java");
      } else {
        h.context.generation = 2;
        h.hook.rerender({ ...h.props, generation: 2 });
      }
      let response!: JavaNavigationResult;
      await act(async () => {
        resolve(ready());
        response = await pending;
      });
      expect(response.status).toBe("refused");
      await act(async () =>
        expect(
          await h.hook.result.current.navigation!.openLocation(request.requestId, location),
        ).toBe(false),
      );
      expect(h.revealed).not.toHaveBeenCalled();
    },
  );

  it.each(["changed disk target", "source edit and save", "workspace switch", "cancellation"])(
    "suppresses reveal while opening after %s",
    async (change) => {
      const h = await harness();
      await h.query();
      vi.mocked(h.filePort.loadContent).mockImplementationOnce(async (path) => {
        if (change === "changed disk target") h.disk.set(path, "class Changed {} ");
        else if (change === "source edit and save") {
          h.editor.updateContent("Main.java", "temporary change");
          h.editor.updateContent("Main.java", source);
          await h.editor.saveFile("Main.java");
        } else if (change === "cancellation")
          h.hook.result.current.navigation!.cancel(request.requestId);
        else h.context.generation = 2;
        return { filePath: path, content: h.disk.get(path)!, language: "java" };
      });
      await act(async () =>
        expect(
          await h.hook.result.current.navigation!.openLocation(request.requestId, location),
        ).toBe(false),
      );
      expect(h.revealed).not.toHaveBeenCalled();
      if (change === "changed disk target")
        expect(h.store.getState().contents["Helper.java"]).toBe("class Changed {} ");
    },
  );

  it("preserves dirty target edits and rejects a result from another request", async () => {
    const h = await harness();
    await h.query();
    await h.editor.openFile("Helper.java");
    h.editor.updateContent("Helper.java", "unsaved target");
    await act(async () =>
      expect(
        await h.hook.result.current.navigation!.openLocation(request.requestId, location),
      ).toBe(false),
    );
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.store.getState().contents["Helper.java"]).toBe("unsaved target");
    h.editor.updateContent("Helper.java", target);
    await h.editor.saveFile("Helper.java");
    vi.mocked(h.port.query).mockResolvedValueOnce({ ...ready(), requestId: "another" });
    expect(await h.query()).toMatchObject({ status: "refused" });
  });

  it("reports unavailable providers and partial references without fabricated locations", async () => {
    const h = await harness();
    vi.mocked(h.port.query).mockResolvedValueOnce(
      javaNavigationRefusal(request, "unavailable", "Install RefactorKit."),
    );
    expect(await h.query()).toMatchObject({ status: "unavailable" });
    expect(h.hook.result.current.message).toBe("Install RefactorKit.");
    vi.mocked(h.port.query).mockRejectedValueOnce(new Error("provider failure"));
    expect(await h.query()).toMatchObject({ status: "refused" });
    const refs = { ...request, requestId: "references-1", kind: "references" as const };
    vi.mocked(h.port.query).mockResolvedValueOnce({ ...ready(refs), total: 2, truncated: true });
    expect(await h.query(refs)).toMatchObject({ status: "ready", complete: true, truncated: true });
    expect(h.hook.result.current.message).toContain("1 of 2 references");
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });

  it("records a bounded provider rejection cause only in opt-in diagnostics", async () => {
    const h = await harness();
    const previousEnabled = document.body.getAttribute("data-native-java-navigation-diagnostics");
    const previousHistory = document.body.getAttribute("data-java-navigation-lifecycle-history");
    document.body.setAttribute("data-native-java-navigation-diagnostics", "");
    vi.mocked(h.port.query).mockRejectedValueOnce(new Error("adapter normalization failed"));

    try {
      expect(await h.query()).toMatchObject({ status: "refused" });
      expect(h.hook.result.current.message).toBe(
        "The RefactorKit Java navigation provider is unavailable or returned invalid evidence.",
      );
      const history = JSON.parse(
        document.body.getAttribute("data-java-navigation-lifecycle-history") ?? "[]",
      ) as Array<Record<string, unknown>>;
      expect(history.at(-1)).toMatchObject({
        event: "port-query-rejected",
        error: "Error: adapter normalization failed",
      });
    } finally {
      if (previousEnabled === null)
        document.body.removeAttribute("data-native-java-navigation-diagnostics");
      else document.body.setAttribute("data-native-java-navigation-diagnostics", previousEnabled);
      if (previousHistory === null)
        document.body.removeAttribute("data-java-navigation-lifecycle-history");
      else document.body.setAttribute("data-java-navigation-lifecycle-history", previousHistory);
    }
  });
});
