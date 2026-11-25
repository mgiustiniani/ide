import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorViewModel, type JavaEditorDiagnosticsPort } from "@ide/web-core";
import { createEditorStore } from "@ide/web-core/state";
import { EditorOpenCoordinator } from "@ide/web-core/editor-open-coordinator";
import type { EditorPort } from "@ide/web-core/ports";
import type { JavaEditorDiagnosticsRequest, JavaEditorDiagnosticsResult } from "@ide/contracts";
import { javaProjectContextResponse } from "../../../../../tests/story/fixtures/java-project-context-response";
import { useJavaEditorDiagnosticsController } from "./useJavaEditorDiagnosticsController";

function ready(r: JavaEditorDiagnosticsRequest): JavaEditorDiagnosticsResult {
  return {
    workspaceId: r.workspaceId,
    generation: r.generation,
    requestId: r.requestId,
    kind: "diagnostics",
    documentPath: r.document.path,
    documentVersion: r.document.version,
    status: "ready",
    coverage: "compiler-errors",
    complete: true,
    analyzedSourceCount: 3,
    total: 1,
    items: [
      {
        severity: "error",
        code: "java.jdt.typeResolution",
        message: "Missing type",
        location: {
          path: r.document.path,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        },
      },
    ],
    sourceFiles: [{ path: r.document.path, text: r.document.text, contentSha256: "e".repeat(64) }],
    snapshotHash: r.projectContext.snapshotHash,
    indexGeneration: 2,
    provider: {
      name: "RefactorKit",
      version: "0.7.0",
      backend: "eclipse-jdt-3.44-bindings-v1",
      evidence: "compiler",
    },
    projectContext: {
      projectPath: r.projectContext.projectPath,
      contextHash: r.projectContext.contextHash,
      contextSchemaVersion: r.projectContext.contextSchemaVersion,
      platformIdentities: r.projectContext.platformIdentities,
    },
    editorOverlay: {
      baseSnapshotHash: r.projectContext.snapshotHash,
      providerSnapshotHash: "e".repeat(64),
      overlayHash: "f".repeat(64),
      documents: r.editorOverlay.documents.map((d) => ({
        path: d.path,
        version: d.version,
        contentSha256: "a".repeat(64),
      })),
    },
  };
}
async function harness() {
  const store = createEditorStore(),
    disk = new Map([
      ["Main.java", "class Main {}"],
      ["Helper.java", "class Helper {}"],
      ["Closed.java", "class Closed {}"],
    ]);
  const filePort: EditorPort = {
    loadContent: vi.fn(async (path) => ({
      filePath: path,
      content: disk.get(path)!,
      language: "java",
    })),
    getOpenFiles: vi.fn(async () => store.getState().openFiles),
    saveContent: vi.fn(async () => store.getState().openFiles),
    closeFile: vi.fn(async () => []),
  };
  const editor = new EditorViewModel(store.getState, filePort);
  await editor.openFile("Main.java");
  await editor.openFile("Helper.java");
  const context = { workspaceId: "one" as string | null, generation: 1, isSwitching: false };
  const settings = {
    projectPath: "",
    sdkHome: "/jdk",
    mavenRepository: "",
    activeMavenProfiles: [],
    inactiveMavenProfiles: [],
  };
  const selected = {
    settings,
    context: javaProjectContextResponse({
      ...settings,
      workspaceId: "one",
      generation: 1,
      requestId: "ctx",
    }).context,
  };
  const port: JavaEditorDiagnosticsPort = {
    query: vi.fn(async (r) => ready(r)),
    cancel: vi.fn(async () => undefined),
  };
  const coordinator = new EditorOpenCoordinator(editor, store.getState);
  const revealed = vi.fn();
  const navigate = vi.fn(
    async (
      location: {
        path: string;
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      },
      canReveal: (afterOpen: boolean) => boolean,
    ) => {
      if (!canReveal(false)) return false;
      await coordinator.open(location.path);
      if (coordinator.state.status !== "ready" || !canReveal(true)) return false;
      revealed(location);
      return true;
    },
  );
  const props = {
    port,
    workspaceId: context.workspaceId,
    generation: 1,
    activeDocument: { path: "Main.java", text: disk.get("Main.java")! },
    getContext: () => context,
    getEditorState: store.getState,
    navigate,
    getProjectContext: () => selected,
    editor,
    subscribeEditor: store.subscribe,
    onProjectContextRetired: vi.fn(),
  };
  const hook = renderHook(useJavaEditorDiagnosticsController, { initialProps: props });
  const check = async () => {
    await act(async () => {
      await hook.result.current.check();
    });
  };
  return {
    store,
    disk,
    editor,
    filePort,
    context,
    selected,
    port,
    props,
    hook,
    check,
    revealed,
    navigate,
  };
}
describe("Java compiler-check editor lifecycle", () => {
  afterEach(() => vi.useRealTimers());
  it("debounces automatic checks and does not poll after an accepted result", async () => {
    vi.useFakeTimers();
    const h = await harness();
    act(() => h.hook.result.current.setAutomaticChecks(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(749);
    });
    expect(h.port.query).not.toHaveBeenCalled();
    act(() => h.editor.updateContent("Helper.java", "class Helper { int first; }"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => h.editor.updateContent("Helper.java", "class Helper { int latest; }"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(749);
    });
    expect(h.port.query).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(h.port.query).toHaveBeenCalledOnce();
    expect(h.port.query).toHaveBeenCalledWith(
      expect.objectContaining({
        editorOverlay: {
          documents: expect.arrayContaining([
            expect.objectContaining({ path: "Helper.java", text: "class Helper { int latest; }" }),
          ]),
        },
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(h.port.query).toHaveBeenCalledOnce();
    expect(h.hook.result.current.result?.status).toBe("ready");
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });
  it("cancels superseded automatic queries and accepts only the latest buffer frame", async () => {
    vi.useFakeTimers();
    const h = await harness();
    let first!: JavaEditorDiagnosticsRequest;
    let resolveFirst!: (result: JavaEditorDiagnosticsResult) => void;
    vi.mocked(h.port.query).mockImplementationOnce((request) => {
      first = request;
      return new Promise((done) => {
        resolveFirst = done;
      });
    });
    act(() => h.hook.result.current.setAutomaticChecks(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    act(() => h.editor.updateContent("Helper.java", "class Helper { int changed; }"));
    expect(h.port.cancel).toHaveBeenCalledWith(first.requestId);
    expect(h.hook.result.current.result).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(h.port.query).toHaveBeenCalledTimes(2);
    const latest = h.hook.result.current.result;
    expect(latest?.requestId).not.toBe(first.requestId);
    await act(async () => {
      resolveFirst(ready(first));
    });
    expect(h.hook.result.current.result).toBe(latest);
  });
  it("keeps metadata-only contexts available without requesting unsupported compiler analysis", async () => {
    const h = await harness();
    h.selected.context.semanticAnalysis = {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    };
    h.hook.rerender({ ...h.props });
    await h.check();
    expect(h.port.query).not.toHaveBeenCalled();
    expect(h.hook.result.current.result).toBeNull();
    expect(h.hook.result.current.message).toContain("cannot analyze Java source");
    expect(h.selected.context.status).toBe("available");
    expect(h.props.onProjectContextRetired).not.toHaveBeenCalled();
  });
  it("waits for source analysis to become available before scheduling automatic checks", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.selected.context.semanticAnalysis = {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    };
    act(() => h.hook.result.current.setAutomaticChecks(true));
    act(() => h.editor.updateContent("Helper.java", "class Helper { int changed; }"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(h.port.query).not.toHaveBeenCalled();
    expect(h.hook.result.current.result).toBeNull();
    h.selected.context.semanticAnalysis = { availability: "available", refusalCode: null };
    h.hook.rerender({ ...h.props });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(h.port.query).toHaveBeenCalledOnce();
    expect(h.hook.result.current.result?.status).toBe("ready");
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });
  it("cancels pending compiler analysis when semantic authority is withdrawn with unchanged hashes", async () => {
    vi.useFakeTimers();
    const h = await harness();
    let resolve!: (result: JavaEditorDiagnosticsResult) => void;
    let captured!: JavaEditorDiagnosticsRequest;
    vi.mocked(h.port.query).mockImplementation((request) => {
      captured = request;
      return new Promise((done) => {
        resolve = done;
      });
    });
    act(() => h.hook.result.current.setAutomaticChecks(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    h.selected.context.semanticAnalysis = {
      availability: "unqualified",
      refusalCode: "java.context.sourceAnalysisUnqualified",
    };
    h.hook.rerender({ ...h.props });
    expect(h.port.cancel).toHaveBeenCalledWith(captured.requestId);
    await act(async () => {
      resolve(ready(captured));
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(h.port.query).toHaveBeenCalledOnce();
    expect(h.hook.result.current.result).toBeNull();
    expect(h.hook.result.current.message).toContain("cannot analyze Java source");
    expect(h.selected.context.status).toBe("available");
    expect(h.props.onProjectContextRetired).not.toHaveBeenCalled();
  });
  it("manual checks consume a scheduled automatic check", async () => {
    vi.useFakeTimers();
    const h = await harness();
    act(() => h.hook.result.current.setAutomaticChecks(true));
    await h.check();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.port.query).toHaveBeenCalledOnce();
  });
  it("pausing automatic checks cancels an in-flight query and rejects its late reply", async () => {
    vi.useFakeTimers();
    const h = await harness();
    let resolve!: (result: JavaEditorDiagnosticsResult) => void;
    let request!: JavaEditorDiagnosticsRequest;
    vi.mocked(h.port.query).mockImplementation((r) => {
      request = r;
      return new Promise((done) => {
        resolve = done;
      });
    });
    act(() => h.hook.result.current.setAutomaticChecks(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(h.hook.result.current.busy).toBe(true);
    act(() => h.hook.result.current.setAutomaticChecks(false));
    expect(h.port.cancel).toHaveBeenCalledWith(request.requestId);
    await act(async () => {
      resolve(ready(request));
    });
    expect(h.hook.result.current.result).toBeNull();
    act(() => h.editor.updateContent("Helper.java", "class Helper { int changed; }"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.port.query).toHaveBeenCalledOnce();
  });
  it("does not query an unsynchronized project or retain a timer after unmount", async () => {
    vi.useFakeTimers();
    const h = await harness();
    h.selected.context.status = "partial";
    act(() => h.hook.result.current.setAutomaticChecks(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.port.query).not.toHaveBeenCalled();
    h.selected.context.status = "available";
    h.hook.rerender({ ...h.props });
    h.hook.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(h.port.query).not.toHaveBeenCalled();
  });

  it("captures every open Java companion, preserves drafts and publishes compiler errors", async () => {
    const h = await harness();
    act(() => h.editor.updateContent("Helper.java", "// dirty\nclass Helper {}"));
    await h.check();
    expect(h.port.query).toHaveBeenCalledWith(
      expect.objectContaining({
        editorOverlay: {
          documents: expect.arrayContaining([
            expect.objectContaining({ path: "Helper.java", text: "// dirty\nclass Helper {}" }),
          ]),
        },
      }),
    );
    expect(h.hook.result.current.activeDiagnostics).toHaveLength(1);
    expect(h.hook.result.current.problemItems).toHaveLength(1);
    expect(h.hook.result.current.message).toContain("3 analyzed sources");
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
    expect(h.disk.get("Helper.java")).toBe("class Helper {}");
  });
  it.each(["java-project-context-v1", "java-project-context-v7"] as const)(
    "refuses dirty provider-declared build inputs with %s paths without saving drafts",
    async (schemaVersion) => {
      const h = await harness();
      h.selected.settings.projectPath = "nested";
      h.selected.context!.schemaVersion = schemaVersion;
      h.selected.context!.buildEvidence = [
        {
          path: schemaVersion === "java-project-context-v1" ? "pom.xml" : "nested/pom.xml",
          kind: "declaration-file",
          fingerprint: "file:current",
        },
      ];
      h.disk.set("nested/Main.java", "class Main {}");
      h.disk.set("nested/pom.xml", "<project />");
      await act(async () => {
        await h.editor.openFile("nested/Main.java");
        await h.editor.openFile("nested/pom.xml");
      });
      act(() => h.editor.updateContent("nested/pom.xml", "<project>changed</project>"));
      h.hook.rerender({
        ...h.props,
        activeDocument: { path: "nested/Main.java", text: "class Main {}" },
      });
      await h.check();
      expect(h.port.query).not.toHaveBeenCalled();
      expect(h.hook.result.current.result).toBeNull();
      expect(h.hook.result.current.message).toContain("nested/pom.xml");
      expect(h.hook.result.current.message).toContain("synchronize");
      expect(h.filePort.saveContent).not.toHaveBeenCalled();
      expect(h.store.getState().contents["nested/pom.xml"]).toBe("<project>changed</project>");
    },
  );
  it("allows unrelated drafts and clean provider-declared build inputs", async () => {
    const h = await harness();
    h.disk.set("pom.xml", "<project />");
    h.disk.set("notes.txt", "notes");
    await act(async () => {
      await h.editor.openFile("pom.xml");
      await h.editor.openFile("notes.txt");
    });
    act(() => h.editor.updateContent("notes.txt", "draft notes"));
    await h.check();
    expect(h.port.query).toHaveBeenCalledOnce();
    expect(h.hook.result.current.result?.status).toBe("ready");
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });
  it("retires accepted errors immediately after an edit and restore", async () => {
    const h = await harness();
    await h.check();
    act(() => {
      h.editor.updateContent("Helper.java", "changed");
      h.editor.updateContent("Helper.java", "class Helper {}");
    });
    expect(h.hook.result.current.result).toBeNull();
    expect(h.hook.result.current.activeDiagnostics).toEqual([]);
  });
  it("cancels a pending frame on edits and ignores its late result", async () => {
    const h = await harness();
    let resolve!: (r: JavaEditorDiagnosticsResult) => void;
    let captured!: JavaEditorDiagnosticsRequest;
    vi.mocked(h.port.query).mockImplementation((r) => {
      captured = r;
      return new Promise((done) => {
        resolve = done;
      });
    });
    let check!: Promise<void>;
    act(() => {
      check = h.hook.result.current.check();
    });
    act(() => h.editor.updateContent("Helper.java", "changed"));
    await act(async () => {
      resolve(ready(captured));
      await check;
    });
    expect(h.port.cancel).toHaveBeenCalledWith(captured.requestId);
    expect(h.hook.result.current.result).toBeNull();
  });
  it("cancels through the original port when the adapter changes", async () => {
    const h = await harness();
    let resolve!: (result: JavaEditorDiagnosticsResult) => void;
    let request!: JavaEditorDiagnosticsRequest;
    vi.mocked(h.port.query).mockImplementation((r) => {
      request = r;
      return new Promise((done) => {
        resolve = done;
      });
    });
    let check!: Promise<void>;
    act(() => {
      check = h.hook.result.current.check();
    });
    const replacement: JavaEditorDiagnosticsPort = {
      query: vi.fn(async (r) => ready(r)),
      cancel: vi.fn(async () => undefined),
    };
    h.hook.rerender({ ...h.props, port: replacement });
    expect(h.port.cancel).toHaveBeenCalledWith(request.requestId);
    expect(replacement.cancel).not.toHaveBeenCalled();
    await act(async () => {
      resolve(ready(request));
      await check;
    });
    expect(h.hook.result.current.result).toBeNull();
  });
  it("retires results when project settings or workspace change", async () => {
    const h = await harness();
    await h.check();
    h.selected.settings = { ...h.selected.settings, sdkHome: "/other-jdk" };
    h.hook.rerender({ ...h.props });
    expect(h.hook.result.current.result).toBeNull();
    await h.check();
    h.context.generation = 2;
    h.hook.rerender({ ...h.props, generation: 2 });
    expect(h.hook.result.current.result).toBeNull();
  });
  it("does not retain a clean result after another Java buffer is opened", async () => {
    const h = await harness();
    await h.check();
    await act(async () => {
      await h.editor.openFile("Closed.java");
    });
    expect(h.hook.result.current.result).toBeNull();
  });
  it("preserves unavailable results and session-retirement requests without a clean verdict", async () => {
    const h = await harness();
    vi.mocked(h.port.query).mockImplementation(
      async (r) =>
        ({
          ...ready(r),
          status: "refused",
          message: "Synchronize again",
          projectContextRetired: true,
        }) as JavaEditorDiagnosticsResult,
    );
    await h.check();
    expect(h.hook.result.current.result).toBeNull();
    expect(h.hook.result.current.message).toBe("Synchronize again");
    expect(h.props.onProjectContextRetired).toHaveBeenCalledWith("Synchronize again");
  });
});

describe("Java compiler problem navigation", () => {
  async function withClosedProblem() {
    const h = await harness();
    vi.mocked(h.port.query).mockImplementation(async (request) => {
      const result = ready(request);
      if (result.status !== "ready") throw Error("fixture");
      result.items[0].location.path = "Closed.java";
      result.sourceFiles = [
        { path: "Closed.java", text: h.disk.get("Closed.java")!, contentSha256: "e".repeat(64) },
      ];
      return result;
    });
    await h.check();
    return h;
  }
  it("defers automatic checks until a slow problem navigation has revealed its verified range", async () => {
    vi.useFakeTimers();
    const h = await withClosedProblem();
    try {
      act(() => h.hook.result.current.setAutomaticChecks(true));
      const id = h.hook.result.current.problemItems[0].id!;
      let loaded!: () => void;
      const sourceLoaded = new Promise<void>((done) => {
        loaded = done;
      });
      let finish!: () => void;
      h.navigate.mockImplementationOnce(async (location, canReveal) => {
        if (!canReveal(false)) return false;
        await h.editor.openFile(location.path);
        const revealed = new Promise<boolean>((done) => {
          finish = () => {
            const valid = canReveal(true);
            if (valid) h.revealed(location);
            done(valid);
          };
        });
        loaded();
        return revealed;
      });
      let opening!: Promise<boolean>;
      await act(async () => {
        opening = h.hook.result.current.openProblem(id);
        await sourceLoaded;
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(h.port.query).toHaveBeenCalledOnce();
      await act(async () => {
        finish();
        expect(await opening).toBe(true);
      });
      expect(h.revealed).toHaveBeenCalledWith(expect.objectContaining({ path: "Closed.java" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750);
      });
      expect(h.port.query).toHaveBeenCalledTimes(2);
      expect(h.hook.result.current.result?.status).toBe("ready");
    } finally {
      h.hook.unmount();
      vi.useRealTimers();
    }
  });
  it("opens a verified closed source and retires the old diagnostic frame", async () => {
    const h = await withClosedProblem();
    const id = h.hook.result.current.problemItems[0].id!;
    let opened = false;
    await act(async () => {
      opened = await h.hook.result.current.openProblem(id);
    });
    expect(opened).toBe(true);
    expect(h.revealed).toHaveBeenCalledWith(expect.objectContaining({ path: "Closed.java" }));
    expect(h.hook.result.current.result).toBeNull();
    expect(h.filePort.saveContent).not.toHaveBeenCalled();
  });
  it("refuses an obsolete range after the closed source changed on disk", async () => {
    const h = await withClosedProblem();
    const id = h.hook.result.current.problemItems[0].id!;
    h.disk.set("Closed.java", "// newer content\nclass Closed {}");
    let opened = true;
    await act(async () => {
      opened = await h.hook.result.current.openProblem(id);
    });
    expect(opened).toBe(false);
    expect(h.revealed).not.toHaveBeenCalled();
    expect(h.hook.result.current.message).toContain("source changed");
    expect(h.store.getState().contents["Closed.java"]).toContain("newer content");
  });
  it("refuses navigation after a captured companion changed and was restored", async () => {
    const h = await withClosedProblem();
    const id = h.hook.result.current.problemItems[0].id!;
    act(() => {
      h.editor.updateContent("Helper.java", "changed");
      h.editor.updateContent("Helper.java", "class Helper {}");
    });
    let opened = true;
    await act(async () => {
      opened = await h.hook.result.current.openProblem(id);
    });
    expect(opened).toBe(false);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.revealed).not.toHaveBeenCalled();
  });
});
