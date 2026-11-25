import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriAdapterError } from "./errors";
import { TauriJavaLspRefactoringAdapter } from "./java-lsp-refactoring-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const request = {
  operation: "extractSuperclass" as const,
  workspaceId: "workspace-one",
  generation: 3,
  projectPath: "",
  sdkHome: "/jdk",
  file: "src/App.java",
  position: { line: 1, character: 2 },
  superclassName: "Base",
  methodName: "compute",
  documents: [
    { path: "src/App.java", text: "class App { int compute() { return 1; } }", version: 4 },
    { path: "src/Other.java", text: "class Other {}", version: 2 },
  ],
};

const capabilities = {
  available: true,
  serverVersion: "0.7.0",
  changeVisibility: true,
  extractParameter: true,
  extractSuperclass: true,
  detail: null,
};

const superclassPreview = {
  operation: "extractSuperclass",
  summary: "Extract compute into Base",
  providerVersion: "0.7.0",
  workspaceEdit: {
    documentChanges: [
      {
        kind: "edit",
        path: "src/App.java",
        version: 4,
        edits: [
          {
            range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } },
            newText: " extends Base",
          },
          {
            range: { start: { line: 0, character: 13 }, end: { line: 0, character: 39 } },
            newText: "",
          },
        ],
      },
      { kind: "create", path: "src/Base.java", text: "class Base { int compute() { return 1; } }" },
    ],
  },
};

describe("TauriJavaLspRefactoringAdapter", () => {
  beforeEach(() => invokeMock.mockReset());

  it("loads only the advertised RefactorKit LSP operations", async () => {
    invokeMock.mockResolvedValueOnce(capabilities);
    await expect(
      new TauriJavaLspRefactoringAdapter().getCapabilities({
        workspaceId: request.workspaceId,
        generation: request.generation,
        sdkHome: request.sdkHome,
      }),
    ).resolves.toEqual(capabilities);
    expect(invokeMock).toHaveBeenCalledWith("get_refactorkit_lsp_capabilities", {
      workspaceId: request.workspaceId,
      generation: request.generation,
      sdkHome: request.sdkHome,
    });
  });

  it("accepts a bounded client-managed CreateFile proposal and never invokes managed Apply", async () => {
    invokeMock.mockResolvedValueOnce(superclassPreview);
    await expect(new TauriJavaLspRefactoringAdapter().preview(request)).resolves.toEqual(
      superclassPreview,
    );
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("preview_refactorkit_lsp_java_refactoring", {
      request,
    });
  });

  it("rejects unsupported operations and uncorrelated paths or document versions", async () => {
    const adapter = new TauriJavaLspRefactoringAdapter();
    for (const invalid of [
      { ...superclassPreview, operation: "extractParameter" },
      {
        ...superclassPreview,
        workspaceEdit: {
          documentChanges: superclassPreview.workspaceEdit.documentChanges.map((change) =>
            change.kind === "create" ? { ...change, path: "../Base.java" } : change,
          ),
        },
      },
      {
        ...superclassPreview,
        workspaceEdit: {
          documentChanges: superclassPreview.workspaceEdit.documentChanges.map((change) =>
            change.kind === "edit" ? { ...change, version: 3 } : change,
          ),
        },
      },
      {
        ...superclassPreview,
        workspaceEdit: {
          documentChanges: superclassPreview.workspaceEdit.documentChanges.slice(0, 1),
        },
      },
    ]) {
      invokeMock.mockResolvedValueOnce(invalid);
      await expect(adapter.preview(request)).rejects.toBeInstanceOf(TauriAdapterError);
    }
  });

  it("rejects an invalid native capability report", async () => {
    invokeMock.mockResolvedValueOnce({ ...capabilities, available: false });
    await expect(
      new TauriJavaLspRefactoringAdapter().getCapabilities({
        workspaceId: request.workspaceId,
        generation: request.generation,
        sdkHome: request.sdkHome,
      }),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("rejects a selected project root outside the active workspace", async () => {
    await expect(
      new TauriJavaLspRefactoringAdapter().preview({ ...request, projectPath: "../outside" }),
    ).rejects.toBeInstanceOf(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
