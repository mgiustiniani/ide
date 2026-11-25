import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JavaLspRefactoringPort } from "@ide/web-core";
import { JavaLspRefactoringDialog } from "./JavaLspRefactoringDialog";

describe("JavaLspRefactoringDialog", () => {
  it("sends saved Java overlays and excludes non-Java and new-file drafts", async () => {
    const documents = [
      { path: "src/Main.java", text: "class Main {}", version: 3, isDirty: true },
      { path: "src/Other.java", text: "class Other {}", version: 2, isDirty: false },
      { path: "docs/notes.md", text: "notes", version: 1, isDirty: true },
      {
        path: "src/Generated.java",
        text: "class Generated {}",
        version: 1,
        isDirty: true,
        isNew: true as const,
      },
    ];
    const port = {
      getCapabilities: vi.fn(),
      preview: vi.fn().mockResolvedValue({
        operation: "changeVisibility",
        summary: "Change visibility",
        providerVersion: "0.7.0",
        workspaceEdit: {
          documentChanges: [
            {
              kind: "edit",
              path: "src/Main.java",
              version: 3,
              edits: [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                  },
                  newText: "public ",
                },
              ],
            },
          ],
        },
      }),
    } as unknown as JavaLspRefactoringPort;
    const capture = { documents, verify: vi.fn() };
    const editor = { captureEditorBuffers: vi.fn(() => capture) };
    const onApplied = vi.fn();
    const renderDialog = (sdkHome: string) => (
      <JavaLspRefactoringDialog
        intent={{
          operation: "lsp-change-visibility",
          document: { path: "src/Main.java", text: "class Main {}" },
          cursor: { line: 1, column: 7 },
        }}
        authority={{ workspaceId: "workspace-one", generation: 1, projectPath: "", sdkHome }}
        port={port}
        editor={editor as never}
        getContext={() => ({
          workspaceId: "workspace-one",
          generation: 1,
          isSwitching: false,
          projectPath: "",
        })}
        onCancel={vi.fn()}
        onApplied={onApplied}
      />
    );

    const view = render(renderDialog("/jdk"));

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    await waitFor(() => expect(port.preview).toHaveBeenCalledOnce());
    expect(port.preview).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "public",
        documents: [
          { path: "src/Main.java", text: "class Main {}", version: 3 },
          { path: "src/Other.java", text: "class Other {}", version: 2 },
        ],
      }),
    );
    expect(capture.verify).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Apply to editor buffers" }).textContent).toBe(
      "Apply to editor buffers",
    );

    view.rerender(renderDialog("/jdk-next"));
    fireEvent.click(screen.getByRole("button", { name: "Apply to editor buffers" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("project JDK changed"),
    );
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("refuses Apply when the synchronized project root changes after preview", async () => {
    const projectPath = "maven";
    const documents = [{ path: "maven/src/Main.java", text: "class Main {}", version: 3 }];
    const port = {
      preview: vi.fn().mockResolvedValue({
        operation: "changeVisibility",
        summary: "Change visibility",
        providerVersion: "0.7.0",
        workspaceEdit: {
          documentChanges: [
            {
              kind: "edit",
              path: "maven/src/Main.java",
              version: 3,
              edits: [
                {
                  range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                  },
                  newText: "public ",
                },
              ],
            },
          ],
        },
      }),
    } as unknown as JavaLspRefactoringPort;
    const editor = {
      captureEditorBuffers: vi.fn(() => ({ documents, verify: vi.fn() })),
      beginEditorTransaction: vi.fn(),
    };
    const renderDialog = (selectedProjectPath: string) => (
      <JavaLspRefactoringDialog
        intent={{
          operation: "lsp-change-visibility",
          document: { path: "maven/src/Main.java", text: "class Main {}" },
          cursor: { line: 1, column: 7 },
        }}
        authority={{
          workspaceId: "workspace-one",
          generation: 1,
          projectPath: selectedProjectPath,
          sdkHome: "/jdk",
        }}
        port={port}
        editor={editor as never}
        getContext={() => ({
          workspaceId: "workspace-one",
          generation: 1,
          isSwitching: false,
          projectPath: selectedProjectPath,
        })}
        onCancel={vi.fn()}
        onApplied={vi.fn()}
      />
    );
    const view = render(renderDialog(projectPath));

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await waitFor(() => expect(port.preview).toHaveBeenCalledOnce());
    expect(port.preview).toHaveBeenCalledWith(expect.objectContaining({ projectPath: "maven" }));

    view.rerender(renderDialog("other"));
    fireEvent.click(screen.getByRole("button", { name: "Apply to editor buffers" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("changed after review"),
    );
    expect(editor.beginEditorTransaction).not.toHaveBeenCalled();
  });
});
