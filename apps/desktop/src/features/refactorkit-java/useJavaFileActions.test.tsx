import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RefactorKitCapabilities } from "@ide/contracts";
import { EditorViewModel } from "@ide/web-core";
import { createEditorStore } from "@ide/web-core/state";
import type { EditorPort } from "@ide/web-core/ports";
import { useJavaFileActions } from "./useJavaFileActions";

async function harness(initialContent = "class Sample {}") {
  const store = createEditorStore();
  const file = "/workspace/src/main/java/Sample.java";
  const port = {
    loadContent: vi.fn(async (filePath) => ({
      filePath,
      content: initialContent,
      language: "java",
    })),
    getOpenFiles: vi.fn(async () => []),
    saveContent: vi.fn(),
    closeFile: vi.fn(),
  } as unknown as EditorPort;
  const editor = new EditorViewModel(store.getState, port);
  await editor.openFile(file);
  let context = { workspaceId: "one", generation: 1, isSwitching: false };
  const dependencies = {
    workspaceId: "one",
    generation: 1,
    rootPath: "/workspace",
    capabilities: {
      generalRefactoring: {
        supported: true,
        preview: true,
        operations: ["format-file", "organize-imports"],
      },
    } as unknown as RefactorKitCapabilities,
    sdkSelected: false,
    projectContextAvailable: false,
    javaWorkspaceSymbolsAvailable: false,
    getCursorPosition: vi.fn(() => ({ line: 1, column: 7 })),
    getContext: () => context,
    getEditorState: store.getState,
    editor,
    refactoring: { open: vi.fn(), isWriting: false },
  };
  return {
    dependencies,
    editor,
    store,
    file,
    port,
    retire: () => {
      context = { ...context, generation: 2 };
    },
  };
}

function extractMethodCapabilities(): RefactorKitCapabilities {
  const runtime = {
    executionMode: "in-process" as const,
    supportsTimeout: true,
    supportsCancellation: true,
    usesWorkspaceOverlay: true,
    recordsProcessProvenance: true,
    limits: {
      requestTimeoutMillis: 30_000,
      maxInputBytes: 1_048_576,
      maxOutputBytes: 1_048_576,
      maxProcesses: 1,
    },
  };
  return {
    api: "refactorkit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.7.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["extractMethod"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
    },
    languageKernel: {
      available: true,
      schema: {
        schemaVersion: 1,
        adapters: [
          {
            languageId: "java",
            extensions: ["java"],
            backend: "java-test-backend",
            runtime,
            capabilities: [
              {
                operation: "extractMethod",
                stability: "stable",
                evidence: "compiler",
                mutationAuthority: "managed-stable",
                backend: "java-test-backend",
                runtime,
                extensions: ["java"],
              },
            ],
          },
        ],
        vocabulary: {
          stability: ["stable", "experimental", "structural", "refused", "not-applicable"],
          evidence: [
            "compiler",
            "language-server",
            "native-ast",
            "structural-parse",
            "lexical",
            "none",
          ],
          mutationAuthority: ["managed-stable", "proposal-only", "none"],
          executionMode: ["in-process", "external-process"],
        },
      },
    },
    methods: [
      {
        name: "project.context",
        requiresProject: true,
        writesWorkspace: false,
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
      { name: "refactor.apply", requiresProject: true, writesWorkspace: true },
    ],
  } as RefactorKitCapabilities;
}

describe("Java saved-file review controller", () => {
  it("uses the active source path rather than guessing a semantic symbol and refuses unsaved changes", async () => {
    const h = await harness();
    const hook = renderHook(() => useJavaFileActions(h.dependencies));
    const document = () => ({
      path: h.file,
      text: h.store.getState().contents[h.file],
      version: 1,
    });
    act(() => hook.result.current!.review("format-file", document()));
    expect(h.dependencies.refactoring.open).toHaveBeenCalledWith("format-file", {
      kind: "file",
      path: "src/main/java/Sample.java",
      identity: "src/main/java/Sample.java",
    });
    h.editor.updateContent(h.file, "class Sample { int value; }");
    expect(() => hook.result.current!.review("organize-imports", document())).toThrow("Save all");
    expect(h.dependencies.refactoring.open).toHaveBeenCalledTimes(1);
    expect(h.port.saveContent).not.toHaveBeenCalled();
    expect(h.store.getState().contents[h.file]).toBe("class Sample { int value; }");
  });
  it("offers only advertised operations and refuses a captured workspace action", async () => {
    const h = await harness();
    const hook = renderHook(() => useJavaFileActions(h.dependencies));
    const captured = hook.result.current!;
    h.dependencies.capabilities = {
      generalRefactoring: { supported: true, preview: true, operations: ["organize-imports"] },
    } as unknown as RefactorKitCapabilities;
    hook.rerender();
    expect(hook.result.current!.operations).toEqual(["organize-imports"]);
    const document = { path: h.file, text: "class Sample {}", version: 1 };
    expect(() => captured.review("format-file", document)).toThrow("advertise");
    h.retire();
    expect(() => captured.review("organize-imports", document)).toThrow("obsolete");
    expect(h.dependencies.refactoring.open).not.toHaveBeenCalled();
  });
});

it("offers only the RefactorKit LSP operations advertised for the selected Java SDK", async () => {
  const h = await harness();
  const lspCapabilities = {
    available: true,
    serverVersion: "0.7.0",
    changeVisibility: true,
    extractParameter: false,
    extractSuperclass: true,
    detail: null,
  } as const;
  const hook = renderHook(() =>
    useJavaFileActions({ ...h.dependencies, sdkSelected: true, lspCapabilities }),
  );
  expect(hook.result.current?.operations).toContain("lsp-change-visibility");
  expect(hook.result.current?.operations).toContain("lsp-extract-superclass");
  expect(hook.result.current?.operations).not.toContain("lsp-extract-parameter");
});

it("uses explicit SDK operation admission for editor actions and retires a legacy offer", async () => {
  const h = await harness();
  let sdkSelected = false;
  const hook = renderHook(() => useJavaFileActions({ ...h.dependencies, sdkSelected }));
  const legacy = hook.result.current!;
  sdkSelected = true;
  hook.rerender();
  expect(hook.result.current!.operations).toEqual(["format-file", "organize-imports"]);
  const document = { path: h.file, text: "class Sample {}", version: 1 };
  act(() => hook.result.current!.review("format-file", document));
  expect(h.dependencies.refactoring.open).toHaveBeenCalledOnce();
  expect(() => legacy.review("format-file", document)).not.toThrow();
  h.dependencies.capabilities = {
    generalRefactoring: { supported: false },
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["organizeImports"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  h.dependencies.projectContextAvailable = true;
  hook.rerender();
  expect(hook.result.current!.operations).toEqual(["organize-imports"]);
  act(() => hook.result.current!.review("organize-imports", document));
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith("organize-imports", {
    kind: "file",
    path: "src/main/java/Sample.java",
    identity: "src/main/java/Sample.java",
  });
});

it("opens a capability-advertised cursor rename review without saving a dirty Java draft", async () => {
  const h = await harness();
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.7.0",
    javaImportExternalClass: {
      supported: false,
      targetDirectory: false,
      preview: false,
      apply: false,
      rollback: false,
      stability: "preview",
    },
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["renameClass", "renameMember"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
      editorSelectionSchemaVersion: "java-editor-mutation-selection-v1",
      dirtyEditorPreview: true,
      editorPreviewMethod: "refactor.editor.preview",
      editorPreviewSchemaVersion: "java-editor-refactoring-v1",
      editorPreviewOperations: ["renameClass", "renameMember"],
    },
    methods: [
      {
        name: "project.context",
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: false,
        features: { immutableJavaEditorOverlays: true },
      },
      {
        name: "intelligence.query",
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: false,
      },
      {
        name: "refactor.editor.preview",
        stability: "experimental",
        requiresProject: true,
        writesWorkspace: false,
      },
    ],
  } as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  expect(hook.result.current?.operations).toContain("rename-class");
  h.editor.updateContent(h.file, "class Sample { int changed; }");
  const position = { line: 1, column: 7 };
  const document = {
    path: h.file,
    text: h.store.getState().contents[h.file],
    version: 2,
  };
  act(() => hook.result.current!.review("rename-class", document, position));
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "rename-class",
    { kind: "class", path: "src/main/java/Sample.java", identity: "@cursor" },
    { path: "src/main/java/Sample.java", ...position },
  );
  expect(h.store.getState().tabs.find((tab) => tab.filePath === h.file)?.isDirty).toBe(true);
  expect(h.port.saveContent).not.toHaveBeenCalled();
  expect(h.store.getState().contents[h.file]).toBe("class Sample { int changed; }");
  h.dependencies.getCursorPosition.mockReturnValue({ line: 2, column: 1 });
  expect(() => hook.result.current!.review("rename-class", document, position)).toThrow(
    "unavailable or obsolete",
  );
  expect(h.dependencies.refactoring.open).toHaveBeenCalledTimes(1);
});

it("opens Add Parameter with a zero-width saved-source cursor selection", async () => {
  const h = await harness("class Sample { void run() {} }");
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["changeSignature.addParameter"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("run") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("add-method-parameter");
  act(() => hook.result.current!.review("add-method-parameter", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "add-method-parameter",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
  );
  expect(h.store.getState().contents[h.file]).toBe(text);
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens Extract Interface on the saved Java class at the cursor", async () => {
  const h = await harness(
    "public class Sample { public int calculate(int value) { return value; } }",
  );
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["extractInterface"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("Sample") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("extract-interface");
  act(() => hook.result.current!.review("extract-interface", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "extract-interface",
    {
      kind: "class",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
    { operation: "extract-interface", interfaceName: "", methodName: "" },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens Extract Superclass on the saved Java class at the cursor", async () => {
  const h = await harness(
    "public class Sample { public int calculate(int value) { return value; } }",
  );
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["extractSuperclass"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("Sample") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("extract-superclass");
  act(() => hook.result.current!.review("extract-superclass", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "extract-superclass",
    {
      kind: "class",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
    { operation: "extract-superclass", superclassName: "", methodName: "" },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens Pull Up Member from an exact saved Java method cursor", async () => {
  const h = await harness(
    "package fixture; class Parent {} class Child extends Parent { protected final int value() { return 42; } }",
  );
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["pullUpMember"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("value") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("pull-up-member");
  act(() => hook.result.current!.review("pull-up-member", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "pull-up-member",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
    { operation: "pull-up-member", targetType: "" },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens Push Down Member from an exact saved Java method cursor", async () => {
  const h = await harness(
    "package fixture; abstract class Parent { protected final int value() { return 42; } } final class Child extends Parent {}",
  );
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["pushDownMember"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("value") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("push-down-member");
  act(() => hook.result.current!.review("push-down-member", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "push-down-member",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
    { operation: "push-down-member", targetType: "" },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens Move Member only with the saved cursor and provider-backed destination search", async () => {
  const h = await harness(
    "package fixture; class Source { static int value() { return 42; } } class Destination {}",
  );
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.javaWorkspaceSymbolsAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["moveMember"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("value") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("move-member");
  act(() => hook.result.current!.review("move-member", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "move-member",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
    {
      operation: "move-member",
      targetType: "",
      targetPath: "",
      targetPosition: { line: 0, character: 0 },
    },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens parameter reordering from the saved Java cursor", async () => {
  const h = await harness("class Sample { void run(int first, int second) {} }");
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["changeSignature.reorderParameters"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("run") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("reorder-method-parameters");
  act(() => hook.result.current!.review("reorder-method-parameters", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "reorder-method-parameters",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens parameter rename from the saved Java cursor", async () => {
  const h = await harness(
    "class Sample { int run(int first, int second) { return first + second; } }",
  );
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["changeSignature.renameParameter"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("run") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("change-method-signature");
  act(() => hook.result.current!.review("change-method-signature", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "change-method-signature",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens Remove Parameter from the saved Java method cursor", async () => {
  const h = await harness("class Sample { void run(int value, int unused) {} }");
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["changeSignature.removeParameter"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("run") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("remove-method-parameter");
  act(() => hook.result.current!.review("remove-method-parameter", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "remove-method-parameter",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens Make Static from an attested saved Java cursor without change intent", async () => {
  const h = await harness("class Sample { private int isolated() { return 42; } }");
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["makeStatic"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("isolated") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("make-static");
  act(() => hook.result.current!.review("make-static", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "make-static",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it.each([{ operation: "make-public" as const, provider: "changeVisibility" }, { operation: "change-field-type" as const, provider: "changeType" }])("opens $operation from an attested saved Java cursor without saving", async ({ operation, provider }) => {
  const h = await harness("class Sample { private final int isolated() { return 42; } }");
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: [provider],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("isolated") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain(operation);
  act(() => hook.result.current!.review(operation, document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    operation,
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens Inline Method from an attested saved Java cursor without change intent", async () => {
  const h = await harness("class Sample { private static int isolated() { return 42; } }");
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["inlineMethod"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: true,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("isolated") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("inline-method");
  act(() => hook.result.current!.review("inline-method", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "inline-method",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("passes the selected Java statement range to Extract Method", async () => {
  const text =
    "class Sample {\n  void run(int base) {\n    int total = base + 1;\n    System.out.println(total);\n  }\n}";
  const h = await harness(text);
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = extractMethodCapabilities();
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const selected = "int total = base + 1;\n    System.out.println(total);";
  const start = text.indexOf(selected);
  const end = start + selected.length;
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("extract-method");
  act(() =>
    hook.result.current!.review("extract-method", document, undefined, {
      start,
      end,
    }),
  );

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "extract-method",
    {
      kind: "file",
      path: "src/main/java/Sample.java",
      identity: "src/main/java/Sample.java",
      selection: { start, end },
    },
    undefined,
    { operation: "extract-method", methodName: "" },
    { path: h.file, text },
  );
  expect(h.dependencies.refactoring.open).toHaveBeenCalledOnce();
  expect(h.store.getState().contents[h.file]).toBe(text);
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it("opens parameter type changes from the saved Java cursor", async () => {
  const h = await harness("class Sample { void run(int count) {} }");
  h.dependencies.sdkSelected = true;
  h.dependencies.projectContextAvailable = true;
  h.dependencies.capabilities = {
    api: "RefactorKit",
    apiVersion: "0.2",
    provider: "refactorkit",
    providerVersion: "0.8.0",
    javaContextRefactoring: {
      schemaVersion: 1,
      operations: ["changeSignature.changeParameterType"],
      requiresExplicitContext: true,
      sourceAuthority: "saved-snapshot",
      rollbackAuthority: false,
      renderedDiff: true,
      selectionQueryKind: "mutationSelection",
      selectionSchemaVersion: "java-mutation-selection-v1",
    },
    methods: [
      {
        name: "project.context",
        features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
      },
      { name: "intelligence.query", requiresProject: true, writesWorkspace: false },
      { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
    ],
  } as unknown as RefactorKitCapabilities;
  const hook = renderHook(() => useJavaFileActions(h.dependencies));
  const reviewSavedBuffers = vi.spyOn(h.editor, "reviewSavedBuffers");
  const text = h.store.getState().contents[h.file];
  const cursor = { line: 1, column: text.indexOf("run") + 2 };
  h.dependencies.getCursorPosition.mockReturnValue(cursor);
  const document = { path: h.file, text, version: 1 };

  expect(hook.result.current?.operations).toContain("change-method-parameter-type");
  act(() => hook.result.current!.review("change-method-parameter-type", document, cursor));

  expect(reviewSavedBuffers).toHaveBeenCalledOnce();
  expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
    "change-method-parameter-type",
    {
      kind: "member",
      path: "src/main/java/Sample.java",
      identity: "@cursor",
      selection: { start: cursor.column - 1, end: cursor.column - 1 },
    },
    { path: "src/main/java/Sample.java", ...cursor },
  );
  expect(h.port.saveContent).not.toHaveBeenCalled();
});

it.each([
  ["extract-constant", "extractConstant"],
  ["extract-variable", "extractVariable"],
  ["extract-parameter", "extractParameter"],
  ["extract-field", "extractField"],
] as const)(
  "opens %s with an exact selection and the saved text snapshot",
  async (operation, providerOperation) => {
    const h = await harness("class Sample { int total = 1 + 2; }");
    h.dependencies.sdkSelected = true;
    h.dependencies.projectContextAvailable = true;
    h.dependencies.capabilities = {
      api: "RefactorKit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: "0.8.0",
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "preview",
      },
      javaContextRefactoring: {
        schemaVersion: 1,
        operations: [providerOperation],
        requiresExplicitContext: true,
        sourceAuthority: "saved-snapshot",
        rollbackAuthority: true,
        renderedDiff: true,
      },
      methods: [
        {
          name: "project.context",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: false,
          features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
        },
        { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
      ],
    } as unknown as RefactorKitCapabilities;
    const hook = renderHook(() => useJavaFileActions(h.dependencies));
    const document = {
      path: h.file,
      text: h.store.getState().contents[h.file],
      version: 4,
    };
    const start = document.text.indexOf("1 + 2");
    act(() =>
      hook.result.current!.review(operation, document, undefined, {
        start,
        end: start + "1 + 2".length,
      }),
    );
    expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
      operation,
      {
        kind: "file",
        path: "src/main/java/Sample.java",
        identity: "src/main/java/Sample.java",
        selection: { start, end: start + "1 + 2".length },
      },
      undefined,
      { operation, name: "" },
      { path: h.file, text: document.text },
    );
  },
);

it.each([
  ["inline-variable", "inlineVariable", "local-binding", "value"],
  ["inline-constant", "inlineConstant", "member", "ANSWER"],
] as const)(
  "opens %s for the exact selected identifier and synchronized project",
  async (operation, providerOperation, kind, identifier) => {
    const source =
      "class Sample { private static final int ANSWER = 7; int run() { int value = 3; return value + ANSWER; } }";
    const h = await harness(source);
    h.dependencies.sdkSelected = true;
    h.dependencies.projectContextAvailable = true;
    h.dependencies.capabilities = {
      api: "RefactorKit",
      apiVersion: "0.2",
      provider: "refactorkit",
      providerVersion: "0.8.0",
      javaImportExternalClass: {
        supported: false,
        targetDirectory: false,
        preview: false,
        apply: false,
        rollback: false,
        stability: "preview",
      },
      javaContextRefactoring: {
        schemaVersion: 1,
        operations: [providerOperation],
        requiresExplicitContext: true,
        sourceAuthority: "saved-snapshot",
        rollbackAuthority: true,
        renderedDiff: true,
      },
      methods: [
        {
          name: "project.context",
          stability: "stable",
          requiresProject: true,
          writesWorkspace: false,
          features: { javaRefactoringsUseContextAuthority: true, managedMutationAuthority: true },
        },
        { name: "refactor.preview", requiresProject: true, writesWorkspace: false },
      ],
    } as unknown as RefactorKitCapabilities;
    const hook = renderHook(() => useJavaFileActions(h.dependencies));
    const document = {
      path: h.file,
      text: h.store.getState().contents[h.file],
      version: 1,
    };
    const start = document.text.indexOf(identifier);
    act(() =>
      hook.result.current!.review(operation, document, undefined, {
        start,
        end: start + identifier.length,
      }),
    );

    expect(h.dependencies.refactoring.open).toHaveBeenCalledWith(
      operation,
      {
        kind,
        path: "src/main/java/Sample.java",
        identity: identifier,
        selection: { start, end: start + identifier.length },
      },
      undefined,
      undefined,
      { path: h.file, text: document.text },
    );
  },
);
