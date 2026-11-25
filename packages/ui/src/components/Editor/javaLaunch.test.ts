import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import { expect, it, vi } from "vitest";
import { registerJavaLaunch } from "./javaLaunch";
import type { JavaEditorLaunch } from "./Editor";
function setup() {
  let version = 3,
    disposed = false;
  let cursor: { lineNumber: number; column: number } | null = { lineNumber: 7, column: 12 };
  const actions = new Map<string, Monaco.editor.IActionDescriptor>();
  const model = {
    getVersionId: () => version,
    getValue: () => "class Secondary {}",
    isDisposed: () => disposed,
  } as unknown as Monaco.editor.ITextModel;
  let currentModel: Monaco.editor.ITextModel | null = model;
  const remove = vi.fn();
  const editor = {
    getModel: () => currentModel,
    getPosition: () => cursor,
    addAction: (a: Monaco.editor.IActionDescriptor) => {
      actions.set(a.id, a);
      return { dispose: remove };
    },
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  let launch: JavaEditorLaunch | undefined = {
    context: { workspaceId: "one", generation: 1 },
    available: true,
    run: vi.fn(async () => {}),
  };
  const onStatus = vi.fn();
  const registration = registerJavaLaunch({
    editor,
    model,
    filePath: "src/Runner.java",
    launch,
    getCurrentLaunch: () => launch,
    onStatus,
  });
  return {
    invoke: (operation = "run", mode = "file") =>
      actions.get(`ide.java.${operation}-main-from-${mode}`)!.run(editor),
    getAction: (operation = "run", mode = "file") =>
      actions.get(`ide.java.${operation}-main-from-${mode}`)!,
    getLaunch: () => launch!,
    setLaunch: (l: JavaEditorLaunch | undefined) => {
      launch = l;
    },
    edit: () => {
      version++;
    },
    disposeModel: () => {
      disposed = true;
    },
    replaceModel: () => {
      currentModel = null;
    },
    moveCursor: (value: typeof cursor) => {
      cursor = value;
    },
    registration,
    onStatus,
    remove,
  };
}
it("registers a Java-only file action and sends an immutable source identity", async () => {
  const h = setup();
  expect(h.getAction()).toMatchObject({
    id: "ide.java.run-main-from-file",
    label: "Run main from this file…",
    precondition: "editorLangId == java && !editorReadonly",
  });
  await h.invoke();
  expect(h.getLaunch().run).toHaveBeenCalledWith(
    { path: "src/Runner.java", text: "class Secondary {}", version: 3 },
    expect.any(Function),
    "run",
  );
});
it("uses the current application callback after a harmless React rerender", async () => {
  const h = setup(),
    previous = h.getLaunch();
  const next = { ...previous, run: vi.fn(async () => {}) };
  h.setLaunch(next);
  await h.invoke();
  expect(previous.run).not.toHaveBeenCalled();
  expect(next.run).toHaveBeenCalledOnce();
});
it.each(["workspace", "generation", "unavailable", "missing", "model", "disposed"])(
  "does not launch with a stale %s",
  async (change) => {
    const h = setup();
    const launch = h.getLaunch();
    if (change === "workspace")
      h.setLaunch({ ...launch, context: { ...launch.context, workspaceId: "two" } });
    if (change === "generation")
      h.setLaunch({ ...launch, context: { ...launch.context, generation: 2 } });
    if (change === "unavailable") h.setLaunch({ ...launch, available: false });
    if (change === "missing") h.setLaunch(undefined);
    if (change === "model") h.replaceModel();
    if (change === "disposed") h.disposeModel();
    await h.invoke();
    expect(launch.run).not.toHaveBeenCalled();
    expect(h.onStatus).toHaveBeenCalledWith(expect.stringMatching(/stale/));
  },
);
it("revokes a captured source frame when its text version changes", async () => {
  const h = setup();
  await h.invoke();
  const verify = vi.mocked(h.getLaunch().run).mock.calls[0][1];
  expect(verify()).toBe(true);
  h.edit();
  expect(verify()).toBe(false);
});
it("disposes its action and revokes an already captured frame", async () => {
  const h = setup();
  await h.invoke();
  const launch = h.getLaunch();
  const verify = vi.mocked(launch.run).mock.calls[0][1];
  h.registration.dispose();
  expect(h.remove).toHaveBeenCalledTimes(4);
  expect(verify()).toBe(false);
  await h.invoke();
  expect(launch.run).toHaveBeenCalledOnce();
});

it("registers Debug separately and preserves its execution intent", async () => {
  const h = setup();
  expect(h.getAction("debug")).toMatchObject({
    id: "ide.java.debug-main-from-file",
    label: "Debug main from this file…",
  });
  await h.invoke("debug");
  expect(h.getLaunch().run).toHaveBeenCalledWith(
    { path: "src/Runner.java", text: "class Secondary {}", version: 3 },
    expect.any(Function),
    "debug",
  );
});

it.each(["run", "debug"])("passes an exact UTF-16 position for %s at cursor", async (operation) => {
  const h = setup();
  await h.invoke(operation, "cursor");
  expect(h.getLaunch().run).toHaveBeenCalledWith(
    {
      path: "src/Runner.java",
      text: "class Secondary {}",
      version: 3,
      position: { line: 6, character: 11 },
    },
    expect.any(Function),
    operation,
  );
  const current = vi.mocked(h.getLaunch().run).mock.calls[0][1];
  expect(current()).toBe(true);
  h.moveCursor({ lineNumber: 8, column: 1 });
  expect(current()).toBe(false);
});
it("does not create a cursor request when the editor has no position", async () => {
  const h = setup();
  h.moveCursor(null);
  await h.invoke("run", "cursor");
  expect(h.getLaunch().run).not.toHaveBeenCalled();
});
