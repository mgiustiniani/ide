import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JavaWorkspaceSymbolsResponse, WorkspaceFileSearchResult } from "@ide/contracts";
import type { CommandPaletteCommand } from "@ide/ui";
import type { JavaProjectTextSearchSnapshot } from "../refactorkit-java-project-model/useJavaProjectTextSearchController";
import { SearchEverywhereDialog } from "./SearchEverywhereDialog";

const files: WorkspaceFileSearchResult = {
  files: [{ name: "Widget.java", path: "app/src/main/java/example/Widget.java" }],
  truncated: false,
  partial: false,
};

const symbols: JavaWorkspaceSymbolsResponse = {
  ok: true,
  requestId: "symbols-1",
  result: {
    provider: "jdt.ls",
    providerVersion: "1",
    workspaceId: "workspace-one",
    generation: 7,
    symbols: [
      {
        name: "Widget",
        kind: "class",
        path: "app/src/main/java/example/Widget.java",
        containerName: "example",
        range: {
          start: { line: 3, character: 4 },
          end: { line: 3, character: 10 },
        },
      },
    ],
    isTruncated: false,
  },
};

const text: JavaProjectTextSearchSnapshot = {
  matches: [
    {
      path: "app/src/main/java/example/Widget.java",
      line: 4,
      column: 5,
      snippet: "class Widget {}",
    },
  ],
  scannedFiles: 1,
  skippedFiles: 0,
  searchedDraftFiles: 0,
  skippedDraftFiles: 0,
  truncated: false,
  hasSearched: true,
  isBusy: false,
  error: null,
};

function renderSearch(
  overrides: Partial<React.ComponentProps<typeof SearchEverywhereDialog>> = {},
) {
  const commands: CommandPaletteCommand[] = [
    { id: "widget.command", label: "Widget command", category: "Workbench", run: vi.fn() },
  ];
  const onOpenFile = vi.fn(async () => undefined);
  const onNavigate = vi.fn(async () => undefined);
  const onClose = vi.fn();
  const view = render(
    <SearchEverywhereDialog
      commands={commands}
      enabled
      javaSymbolSearchAvailable
      onClose={onClose}
      onNavigate={onNavigate}
      onOpen={vi.fn()}
      onOpenFile={onOpenFile}
      open
      searchFiles={vi.fn(async () => files)}
      searchJavaSymbols={vi.fn(async () => symbols)}
      searchProjectText={vi.fn(async () => text)}
      workspaceGeneration={7}
      {...overrides}
    />,
  );
  return { ...view, onClose, onNavigate, onOpenFile, commands };
}

describe("SearchEverywhereDialog", () => {
  it("combines available commands, workspace files, Java symbols, and project text", async () => {
    const { onClose, onNavigate } = renderSearch();
    const input = screen.getByRole("combobox", {
      name: "Search commands, files, Java symbols, and project text",
    });
    fireEvent.change(input, { target: { value: "Widget" } });

    await screen.findByRole("option", { name: /Command: Widget command/ });
    await screen.findByRole("option", { name: /File: Widget\.java/ });
    const symbol = await screen.findByRole("option", { name: /Java symbol: Widget/ });
    await screen.findByRole("option", { name: /Project text: class Widget/ });

    fireEvent.click(symbol);
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        "app/src/main/java/example/Widget.java",
        {
          kind: "range",
          range: {
            start: { line: 3, character: 4 },
            end: { line: 3, character: 10 },
          },
        },
        7,
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not display a file result returned for a previous workspace generation", async () => {
    let resolveOldSearch!: (result: WorkspaceFileSearchResult) => void;
    const searchFiles = vi.fn((_query: string, generation: number) => {
      if (generation === 7)
        return new Promise<WorkspaceFileSearchResult>((resolve) => {
          resolveOldSearch = resolve;
        });
      return new Promise<WorkspaceFileSearchResult>(() => {});
    });
    const props = {
      commands: [],
      enabled: true,
      javaSymbolSearchAvailable: false,
      onClose: vi.fn(),
      onNavigate: vi.fn(async () => undefined),
      onOpen: vi.fn(),
      onOpenFile: vi.fn(async () => undefined),
      open: true,
      searchFiles,
      searchJavaSymbols: vi.fn(async () => symbols),
      searchProjectText: vi.fn(async () => text),
      workspaceGeneration: 7,
    } satisfies React.ComponentProps<typeof SearchEverywhereDialog>;
    const view = render(<SearchEverywhereDialog {...props} />);
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Search commands, files, Java symbols, and project text",
      }),
      { target: { value: "Widget" } },
    );
    await waitFor(() => expect(searchFiles).toHaveBeenCalledWith("Widget", 7));

    view.rerender(<SearchEverywhereDialog {...props} workspaceGeneration={8} />);
    resolveOldSearch(files);

    await waitFor(() =>
      expect(screen.queryByRole("option", { name: /File: Widget\.java/ })).toBeNull(),
    );
  });

  it("cancels the previous Java symbol request when the search query changes", async () => {
    const searchJavaSymbols = vi.fn(
      (_query: string, _signal?: AbortSignal) =>
        new Promise<JavaWorkspaceSymbolsResponse>(() => undefined),
    );
    renderSearch({ searchJavaSymbols });
    const input = screen.getByRole("combobox", {
      name: "Search commands, files, Java symbols, and project text",
    });
    fireEvent.change(input, { target: { value: "Widget" } });
    await waitFor(() => expect(searchJavaSymbols).toHaveBeenCalledOnce());
    const firstSignal = searchJavaSymbols.mock.calls[0]?.[1];
    expect(firstSignal?.aborted).toBe(false);

    fireEvent.change(input, { target: { value: "Gadget" } });

    expect(firstSignal?.aborted).toBe(true);
  });

  it("opens with Ctrl/Cmd+Shift+E and leaves other text fields alone", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const props = {
      commands: [],
      enabled: true,
      javaSymbolSearchAvailable: false,
      onClose,
      onNavigate: vi.fn(async () => undefined),
      onOpen,
      onOpenFile: vi.fn(async () => undefined),
      open: false,
      searchFiles: vi.fn(async () => files),
      searchJavaSymbols: vi.fn(async () => symbols),
      searchProjectText: vi.fn(async () => text),
      workspaceGeneration: 7,
    } satisfies React.ComponentProps<typeof SearchEverywhereDialog>;
    render(<SearchEverywhereDialog {...props} />);

    fireEvent.keyDown(window, { key: "e", ctrlKey: true, shiftKey: true });
    expect(onOpen).toHaveBeenCalledOnce();

    const textInput = document.createElement("input");
    document.body.append(textInput);
    fireEvent.keyDown(textInput, { key: "e", ctrlKey: true, shiftKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
    textInput.remove();

    const editor = document.createElement("div");
    editor.className = "monaco-editor";
    const editorInput = document.createElement("textarea");
    editor.append(editorInput);
    document.body.append(editor);
    fireEvent.keyDown(editorInput, { key: "e", ctrlKey: true, shiftKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);
    editor.remove();
  });
});
