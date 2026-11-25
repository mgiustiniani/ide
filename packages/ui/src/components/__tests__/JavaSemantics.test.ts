import type {
  JavaCompletionResponse,
  JavaFormattingResponse,
  JavaRangeFormattingResponse,
  JavaCompletionResult,
  JavaDocumentSymbolsResult,
  JavaHoverResult,
  JavaSignatureHelpResult,
  JavaSemanticTokensResult,
  JavaInlayHintsResult,
  JavaCodeActionMemberSelection,
  JavaCodeActionsResponse,
} from "@ide/contracts";
import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaEditorSemantics } from "../Editor/Editor";
import { registerJavaSemanticProviders } from "../Editor/javaSemantics";
import { getMonacoLanguage } from "../Editor/monacoLanguage";
import { configureLocalMonaco } from "../../monaco/bootstrap";

function success<T>(requestId: string, result: T) {
  return { ok: true as const, requestId, result };
}

const documentTarget = { path: "src/Main.java", uri: "file:///src/Main.java", version: 7 };
const metadata = {
  workspaceId: "workspace-1",
  generation: 3,
  document: documentTarget,
  provider: "java",
  providerVersion: null,
};

function harness(initialModelVersion = documentTarget.version) {
  const providers: Record<string, unknown> = {};
  const disposed = {
    completion: false,
    documentSymbols: false,
    documentHighlights: false,
    hover: false,
    signature: false,
    codeActions: false,
    rename: false,
    semanticTokens: false,
    formatting: false,
    rangeFormatting: false,
    inlayHints: false,
  };
  let applyCommand: ((accessor: unknown, key: unknown) => unknown) | undefined;
  const editor = {
    getModel: () => model,
    executeEdits: vi.fn(),
    pushUndoStop: vi.fn(),
    addAction: vi.fn(() => ({ dispose: vi.fn() })),
    trigger: vi.fn(),
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  const languages = {
    registerCompletionItemProvider: vi.fn((_language: string, provider: unknown) => {
      providers.completion = provider;
      return {
        dispose: () => {
          disposed.completion = true;
        },
      };
    }),
    registerHoverProvider: vi.fn((_language: string, provider: unknown) => {
      providers.hover = provider;
      return {
        dispose: () => {
          disposed.hover = true;
        },
      };
    }),
    registerDocumentSymbolProvider: vi.fn((_language: string, provider: unknown) => {
      providers.documentSymbols = provider;
      return {
        dispose: () => {
          disposed.documentSymbols = true;
        },
      };
    }),
    registerDocumentHighlightProvider: vi.fn((_language: string, provider: unknown) => {
      providers.documentHighlights = provider;
      return {
        dispose: () => {
          disposed.documentHighlights = true;
        },
      };
    }),
    registerDocumentSemanticTokensProvider: vi.fn((_language: string, provider: unknown) => {
      providers.semanticTokens = provider;
      return {
        dispose: () => {
          disposed.semanticTokens = true;
        },
      };
    }),
    registerDocumentFormattingEditProvider: vi.fn((_language: string, provider: unknown) => {
      providers.formatting = provider;
      return {
        dispose: () => {
          disposed.formatting = true;
        },
      };
    }),
    registerDocumentRangeFormattingEditProvider: vi.fn((_language: string, provider: unknown) => {
      providers.rangeFormatting = provider;
      return {
        dispose: () => {
          disposed.rangeFormatting = true;
        },
      };
    }),
    registerInlayHintsProvider: vi.fn((_language: string, provider: unknown) => {
      providers.inlayHints = provider;
      return {
        dispose: () => {
          disposed.inlayHints = true;
        },
      };
    }),
    registerSignatureHelpProvider: vi.fn((_language: string, provider: unknown) => {
      providers.signature = provider;
      return {
        dispose: () => {
          disposed.signature = true;
        },
      };
    }),
    registerCodeActionProvider: vi.fn(
      (_language: string, provider: unknown, options?: { providedCodeActionKinds?: string[] }) => {
        providers.codeActions = provider;
        providers.codeActionKinds = options?.providedCodeActionKinds;
        return {
          dispose: () => {
            disposed.codeActions = true;
          },
        };
      },
    ),
    registerRenameProvider: vi.fn((_language: string, provider: unknown) => {
      providers.rename = provider;
      return {
        dispose: () => {
          disposed.rename = true;
        },
      };
    }),
  };
  let modelVersion = initialModelVersion;
  let modelText = "class Main {}\n";
  const offsetAt = (value: string, position: { lineNumber: number; column: number }) =>
    value
      .split("\n")
      .slice(0, position.lineNumber - 1)
      .reduce((offset, line) => offset + line.length + 1, 0) +
    position.column -
    1;
  const model = {
    uri: { toString: () => documentTarget.uri },
    getLineCount: () => 2,
    getLineMaxColumn: (line: number) => (line === 1 ? 13 : 8),
    getVersionId: () => modelVersion,
    getValue: () => modelText,
    getEOL: () => "\n",
    getOffsetAt: (position: { lineNumber: number; column: number }) =>
      offsetAt(modelText, position),
    isDisposed: () => false,
    pushStackElement: vi.fn(),
    pushEditOperations: vi.fn(
      (_before: unknown, edits: Monaco.editor.IIdentifiedSingleEditOperation[]) => {
        for (const edit of [...edits].reverse()) {
          const start = offsetAt(modelText, {
            lineNumber: edit.range.startLineNumber,
            column: edit.range.startColumn,
          });
          const end = offsetAt(modelText, {
            lineNumber: edit.range.endLineNumber,
            column: edit.range.endColumn,
          });
          modelText = `${modelText.slice(0, start)}${edit.text ?? ""}${modelText.slice(end)}`;
        }
        modelVersion += 1;
        return null;
      },
    ),
  } as unknown as Monaco.editor.ITextModel;
  const models: Monaco.editor.ITextModel[] = [model];
  const completion = vi.fn<JavaEditorSemantics["completion"]>();
  const formatDocument = vi.fn<NonNullable<JavaEditorSemantics["formatDocument"]>>();
  const formatRange = vi.fn<NonNullable<JavaEditorSemantics["formatRange"]>>();
  const hover = vi.fn<JavaEditorSemantics["hover"]>();
  const signatureHelp = vi.fn<JavaEditorSemantics["signatureHelp"]>();
  const documentSymbols = vi.fn<JavaEditorSemantics["documentSymbols"]>();
  const documentHighlights = vi.fn<JavaEditorSemantics["documentHighlights"]>();
  const implementations = vi.fn<JavaEditorSemantics["implementations"]>();
  const references = vi.fn<JavaEditorSemantics["references"]>();
  const codeActions = vi.fn<JavaEditorSemantics["codeActions"]>();
  const applyCodeAction = vi.fn<NonNullable<JavaEditorSemantics["applyCodeAction"]>>();
  const rename = vi.fn<NonNullable<JavaEditorSemantics["rename"]>>();
  const semanticTokens = vi.fn<JavaEditorSemantics["semanticTokens"]>();
  const inlayHints = vi.fn<NonNullable<JavaEditorSemantics["inlayHints"]>>();
  const cancel = vi.fn<JavaEditorSemantics["cancel"]>();
  const selectCodeActionMembers = vi.fn(async (selection: JavaCodeActionMemberSelection) => ({
    kind: selection.kind,
    selectedFieldBindingKeys:
      selection.groups.find((group) => group.id === "fields")?.selectedKeys ?? [],
    selectedConstructorBindingKeys:
      selection.groups.find((group) => group.id === "constructors")?.selectedKeys ?? [],
    selectedOverridableMethodKeys:
      selection.groups.find((group) => group.id === "overridableMethods")?.selectedKeys ?? [],
    selectedDelegateMethodKeys:
      selection.groups.find((group) => group.id === "delegateMethods")?.selectedKeys ?? [],
  }));
  const onWorkspaceDocumentChanges = vi.fn(() => true);
  const semantics: JavaEditorSemantics = {
    context: { workspaceId: "workspace-1", generation: 3, document: documentTarget },
    semanticTokensEnabled: true,
    formattingEnabled: true,
    rangeFormattingEnabled: true,
    inlayHints,
    completion,
    formatDocument,
    formatRange,
    hover,
    signatureHelp,
    documentSymbols,
    documentHighlights,
    implementations,
    references,
    codeActions,
    applyCodeAction,
    rename,
    semanticTokens,
    cancel,
  };
  let current: JavaEditorSemantics | undefined = semantics;
  const registration = registerJavaSemanticProviders({
    api: {
      languages: {
        ...languages,
        DocumentHighlightKind: { Text: 0, Read: 1, Write: 2 },
        InlayHintKind: { Type: 1, Parameter: 2 },
      },
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      KeyMod: { CtrlCmd: 1, Alt: 2, Shift: 4 },
      KeyCode: { KeyR: 18 },
      editor: {
        getModels: vi.fn(() => models),
        registerCommand: vi.fn((_id: string, handler: typeof applyCommand) => {
          applyCommand = handler;
          return { dispose: vi.fn() };
        }),
      },
    } as unknown as typeof Monaco,
    editor,
    model,
    filePath: documentTarget.path,
    semantics,
    getCurrentSemantics: () => current,
    selectCodeActionMembers,
    onWorkspaceDocumentChanges,
  });
  const tokenListeners = new Set<() => void>();
  const token = {
    isCancellationRequested: false,
    onCancellationRequested(listener: () => void) {
      tokenListeners.add(listener);
      return {
        dispose: () => {
          tokenListeners.delete(listener);
        },
      };
    },
  } as unknown as Monaco.CancellationToken;
  return {
    providers: providers as {
      completion: Monaco.languages.CompletionItemProvider;
      hover: Monaco.languages.HoverProvider;
      documentSymbols: Monaco.languages.DocumentSymbolProvider;
      documentHighlights: Monaco.languages.DocumentHighlightProvider;
      signature: Monaco.languages.SignatureHelpProvider;
      codeActions: Monaco.languages.CodeActionProvider;
      rename: Monaco.languages.RenameProvider;
      semanticTokens: Monaco.languages.DocumentSemanticTokensProvider;
      formatting: Monaco.languages.DocumentFormattingEditProvider;
      rangeFormatting: Monaco.languages.DocumentRangeFormattingEditProvider;
      inlayHints: Monaco.languages.InlayHintsProvider;
      codeActionKinds: string[];
    },
    disposed,
    languages,
    model,
    setModels(next: Monaco.editor.ITextModel[]) {
      models.splice(0, models.length, ...next);
    },
    semantics,
    completion,
    formatDocument,
    formatRange,
    hover,
    signatureHelp,
    documentSymbols,
    documentHighlights,
    codeActions,
    applyCodeAction,
    rename,
    semanticTokens,
    inlayHints,
    selectCodeActionMembers,
    onWorkspaceDocumentChanges,
    cancel,
    editor,
    get applyCommand() {
      return applyCommand;
    },
    registration,
    token,
    cancelToken() {
      (token as { isCancellationRequested: boolean }).isCancellationRequested = true;
      tokenListeners.forEach((listener) => listener());
    },
    setCurrent(value: JavaEditorSemantics | undefined) {
      current = value;
    },
    setModelVersion(value: number) {
      modelVersion = value;
    },
  };
}

const position = { lineNumber: 2, column: 4 } as Monaco.Position;

describe("Java Monaco semantics", () => {
  it("bundles the Java tokenizer and registers semantic providers only for Java", () => {
    const h = harness();
    expect(getMonacoLanguage("plaintext", "src/Main.java")).toBe("java");
    expect(
      configureLocalMonaco()
        .languages.getLanguages()
        .some(({ id }) => id === "java"),
    ).toBe(true);
    expect(h.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
      "java",
      h.providers.completion,
    );
    expect(h.languages.registerHoverProvider).toHaveBeenCalledWith("java", h.providers.hover);
    expect(h.languages.registerSignatureHelpProvider).toHaveBeenCalledWith(
      "java",
      h.providers.signature,
    );
    expect(h.languages.registerDocumentSymbolProvider).toHaveBeenCalledWith(
      "java",
      h.providers.documentSymbols,
    );
    expect(h.providers.signature.signatureHelpTriggerCharacters).toEqual(["(", ","]);
  });

  it("maps JDT LS document-formatting edits and discards a reply for an edited model", async () => {
    const h = harness(8);
    h.formatDocument.mockImplementation(async (request) => ({
      ok: true,
      requestId: request.requestId,
      result: {
        ...metadata,
        document: request.document,
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            newText: "class",
          },
        ],
      },
    }));

    const edits = await h.providers.formatting.provideDocumentFormattingEdits(
      h.model,
      { tabSize: 2, insertSpaces: false },
      h.token,
    );

    expect(h.languages.registerDocumentFormattingEditProvider).toHaveBeenCalledWith(
      "java",
      h.providers.formatting,
    );
    expect(h.formatDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        document: documentTarget,
        options: { tabSize: 2, insertSpaces: false },
      }),
    );
    expect(edits).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
        text: "class",
      },
    ]);

    let resolve!: (response: JavaFormattingResponse) => void;
    h.formatDocument.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const pending = h.providers.formatting.provideDocumentFormattingEdits(
      h.model,
      { tabSize: 4, insertSpaces: true },
      h.token,
    );
    const lateRequest = h.formatDocument.mock.calls[1]![0];
    h.setModelVersion(8);
    resolve({
      ok: true,
      requestId: lateRequest.requestId,
      result: { ...metadata, document: lateRequest.document, edits: [] },
    });
    await expect(pending).resolves.toEqual([]);
  });

  it("formats only the selected range and refuses out-of-range or stale edits", async () => {
    const h = harness(8);
    const selected = {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 8,
    } as Monaco.Range;
    h.formatRange.mockImplementation(async (request) => ({
      ok: true,
      requestId: request.requestId,
      result: {
        ...metadata,
        document: request.document,
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            newText: "class",
          },
        ],
      },
    }));

    const edits = await h.providers.rangeFormatting.provideDocumentRangeFormattingEdits(
      h.model,
      selected,
      { tabSize: 2, insertSpaces: false },
      h.token,
    );

    expect(h.languages.registerDocumentRangeFormattingEditProvider).toHaveBeenCalledWith(
      "java",
      h.providers.rangeFormatting,
    );
    expect(h.formatRange).toHaveBeenCalledWith(
      expect.objectContaining({
        document: documentTarget,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 12 },
        },
        options: { tabSize: 2, insertSpaces: false },
      }),
    );
    expect(edits).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 },
        text: "class",
      },
    ]);

    h.formatRange.mockImplementationOnce(async (request) => ({
      ok: true,
      requestId: request.requestId,
      result: {
        ...metadata,
        document: request.document,
        edits: [
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
            newText: "outside",
          },
        ],
      },
    }));
    await expect(
      h.providers.rangeFormatting.provideDocumentRangeFormattingEdits(
        h.model,
        selected,
        { tabSize: 2, insertSpaces: false },
        h.token,
      ),
    ).resolves.toEqual([]);

    let resolve!: (response: JavaRangeFormattingResponse) => void;
    h.formatRange.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const pending = h.providers.rangeFormatting.provideDocumentRangeFormattingEdits(
      h.model,
      selected,
      { tabSize: 4, insertSpaces: true },
      h.token,
    );
    const lateRequest = h.formatRange.mock.calls.at(-1)![0];
    h.setModelVersion(8);
    resolve({
      ok: true,
      requestId: lateRequest.requestId,
      result: { ...metadata, document: lateRequest.document, edits: [] },
    });
    await expect(pending).resolves.toEqual([]);
  });

  it("renders provider hints only for the current visible Java document range", async () => {
    const h = harness(8);
    h.inlayHints.mockImplementation(async (request) => ({
      ok: true,
      requestId: request.requestId,
      result: {
        ...metadata,
        document: request.document,
        isTruncated: false,
        hints: [
          {
            position: { line: 0, character: 7 },
            label: "count:",
            kind: "parameter",
            paddingRight: true,
          },
        ],
      } as JavaInlayHintsResult,
    }));
    const visible = {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 13,
    } as Monaco.Range;

    const result = await h.providers.inlayHints.provideInlayHints(h.model, visible, h.token);
    expect(h.languages.registerInlayHintsProvider).toHaveBeenCalledWith(
      "java",
      h.providers.inlayHints,
    );
    expect(h.inlayHints).toHaveBeenCalledWith(
      expect.objectContaining({
        document: documentTarget,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 12 },
        },
      }),
    );
    expect(result?.hints).toEqual([
      {
        position: { lineNumber: 1, column: 8 },
        label: "count:",
        kind: 2,
        paddingRight: true,
      },
    ]);

    let resolve!: (response: Awaited<ReturnType<typeof h.inlayHints>>) => void;
    h.inlayHints.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    const pending = h.providers.inlayHints.provideInlayHints(h.model, visible, h.token);
    const lateRequest = h.inlayHints.mock.calls[1]![0];
    h.setModelVersion(9);
    resolve({
      ok: true,
      requestId: lateRequest.requestId,
      result: { ...metadata, document: lateRequest.document, hints: [], isTruncated: false },
    });
    await expect(pending).resolves.toMatchObject({ hints: [] });
  });

  it("maps current document symbols into Monaco's hierarchical Java outline", async () => {
    const h = harness();
    h.documentSymbols.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isTruncated: false,
        symbols: [
          {
            name: "Main",
            kind: "class",
            range: { start: { line: 0, character: 0 }, end: { line: 1, character: 7 } },
            selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            children: [
              {
                name: "main",
                kind: "method",
                detail: "void main(String[])",
                deprecated: true,
                range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
                selectionRange: {
                  start: { line: 1, character: 2 },
                  end: { line: 1, character: 6 },
                },
              },
            ],
          },
        ],
      } satisfies JavaDocumentSymbolsResult),
    );

    const result = (await h.providers.documentSymbols.provideDocumentSymbols(
      h.model,
      h.token,
    )) as Monaco.languages.DocumentSymbol[];

    expect(h.documentSymbols.mock.calls[0]![0]).toMatchObject({
      workspaceId: "workspace-1",
      generation: 3,
      document: documentTarget,
    });
    expect(result).toMatchObject([
      {
        name: "Main",
        kind: 4,
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 8 },
        children: [
          {
            name: "main",
            kind: 5,
            detail: "void main(String[])",
            tags: [1],
          },
        ],
      },
    ]);
    h.registration.dispose();
    expect(h.disposed.documentSymbols).toBe(true);
  });

  it("highlights same-document read and write occurrences at the current cursor version", async () => {
    const h = harness();
    h.documentHighlights.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isTruncated: false,
        highlights: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            kind: "write",
          },
          {
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
            kind: "read",
          },
        ],
      }),
    );
    const highlights = await h.providers.documentHighlights.provideDocumentHighlights(
      h.model,
      position,
      h.token,
    );
    expect(h.documentHighlights).toHaveBeenCalledWith(
      expect.objectContaining({ position: { line: 1, character: 3 } }),
    );
    expect(highlights).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 },
        kind: 2,
      },
      {
        range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7 },
        kind: 1,
      },
    ]);
    h.registration.dispose();
    expect(h.disposed.documentHighlights).toBe(true);
  });

  it("maps current-version semantic tokens into Monaco's relative token format", async () => {
    const h = harness();
    h.semanticTokens.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isTruncated: false,
        tokens: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            tokenType: "class",
            tokenModifiers: ["declaration"],
          },
          {
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } },
            tokenType: "method",
            tokenModifiers: [],
          },
        ],
      } satisfies JavaSemanticTokensResult),
    );
    const result = await h.providers.semanticTokens.provideDocumentSemanticTokens(
      h.model,
      null,
      h.token,
    );
    const legend = h.providers.semanticTokens.getLegend();
    const data = Array.from(result && "data" in result ? result.data : []);
    expect(h.semanticTokens).toHaveBeenCalledWith(
      expect.objectContaining({ document: documentTarget, workspaceId: "workspace-1" }),
    );
    expect(data).toEqual([
      0,
      0,
      4,
      legend.tokenTypes.indexOf("class"),
      1 << legend.tokenModifiers.indexOf("declaration"),
      1,
      2,
      4,
      legend.tokenTypes.indexOf("method"),
      0,
    ]);
    h.registration.dispose();
    expect(h.disposed.semanticTokens).toBe(true);
  });

  it("opens closed-source quick fixes only after the person selects their command", async () => {
    const h = harness();
    const action = {
      title: "Create method in Use",
      kind: "quickfix",
      edits: [],
      documentsToOpen: ["src/Use.java"],
      editPlanSha256: "1".repeat(64),
      sourceDocuments: [{ path: "src/Use.java", contentSha256: "2".repeat(64) }],
    };
    h.codeActions.mockImplementation(async (request) =>
      success(request.requestId, { ...metadata, isTruncated: false, actions: [action] }),
    );
    h.applyCodeAction.mockResolvedValue(true);
    const result = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 },
      { markers: [], only: undefined, trigger: 1 },
      h.token,
    );
    expect(result?.actions).toHaveLength(1);
    expect(h.applyCodeAction).not.toHaveBeenCalled();
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
    await h.applyCommand?.({}, result?.actions[0].command?.arguments?.[0]);
    expect(h.applyCodeAction).toHaveBeenCalledWith(
      expect.objectContaining({ action, document: documentTarget }),
    );
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
    h.registration.dispose();
  });

  it("cancels a selected closed-source quick fix when its provider retires", async () => {
    const h = harness();
    const action = {
      title: "Create method in Use",
      kind: "quickfix",
      edits: [],
      documentsToOpen: ["src/Use.java"],
      editPlanSha256: "1".repeat(64),
      sourceDocuments: [{ path: "src/Use.java", contentSha256: "2".repeat(64) }],
    };
    h.codeActions.mockImplementation(async (request) =>
      success(request.requestId, { ...metadata, isTruncated: false, actions: [action] }),
    );
    let finish!: (value: boolean) => void;
    h.applyCodeAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const result = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 },
      { markers: [], only: undefined, trigger: 1 },
      h.token,
    );
    const selected = h.applyCommand?.({}, result?.actions[0].command?.arguments?.[0]);
    h.registration.dispose();
    expect(h.cancel).toHaveBeenCalledWith(h.applyCodeAction.mock.calls[0][0].cancellationId);
    finish(false);
    await expect(selected).rejects.toThrow("source changed");
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
  });

  it("offers current-version same-document code actions and refuses them after an edit", async () => {
    const h = harness();
    h.codeActions.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isTruncated: false,
        actions: [
          {
            title: "Import java.util.List",
            kind: "quickfix",
            isPreferred: true,
            edits: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: "import java.util.List;\n",
              },
            ],
          },
          {
            title: "Use pattern matching",
            kind: "quickassist",
            edits: [
              {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } },
                newText: "if (value instanceof String text)",
              },
            ],
          },
          {
            title: "Extract to method",
            kind: "refactor.extract",
            edits: [
              {
                range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } },
                newText: "extracted()",
              },
            ],
          },
          {
            title: "Generate getter and setter",
            kind: "source.generate.accessors",
            edits: [
              {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
                newText: "  public String getName() { return name; }\n",
              },
            ],
          },
          {
            title: "Sort members",
            kind: "source.sortMembers",
            edits: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
                newText: "private int count;\nprivate String name;\n",
              },
            ],
          },
        ],
      }),
    );
    const list = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      {
        markers: [
          {
            severity: 8 as Monaco.MarkerSeverity,
            message: "List cannot be resolved to a type",
            source: "jdt.ls",
            code: "16777218",
            startLineNumber: 1,
            startColumn: 8,
            endLineNumber: 1,
            endColumn: 12,
          },
        ],
        trigger: 1,
      } as Monaco.languages.CodeActionContext,
      h.token,
    );
    expect(h.codeActions).toHaveBeenCalledWith(
      expect.objectContaining({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } },
        diagnostics: [
          {
            range: { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } },
            severity: 1,
            message: "List cannot be resolved to a type",
            source: "jdt.ls",
            code: "16777218",
          },
        ],
      }),
    );
    const action = list?.actions[0];
    expect(h.providers.codeActionKinds).toContain("quickassist");
    expect(h.providers.codeActionKinds).toContain("refactor");
    expect(h.providers.codeActionKinds).toContain("source");
    expect(list?.actions).toContainEqual(
      expect.objectContaining({ title: "Sort members", kind: "source.sortMembers" }),
    );
    expect(list?.actions).toContainEqual(
      expect.objectContaining({ title: "Use pattern matching", kind: "quickassist" }),
    );
    expect(list?.actions).toContainEqual(
      expect.objectContaining({ title: "Extract to method", kind: "refactor.extract" }),
    );
    expect(action).toMatchObject({
      title: "Import java.util.List",
      kind: "quickfix",
      isPreferred: true,
    });
    const key = action?.command?.arguments?.[0];
    h.applyCommand?.({}, key);
    expect(h.editor.executeEdits).toHaveBeenCalledWith("java-code-action", [
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: "import java.util.List;\n",
      },
    ]);

    const extract = list?.actions.find((candidate) => candidate.title === "Extract to method");
    h.applyCommand?.({}, extract?.command?.arguments?.[0]);
    expect(h.editor.executeEdits).toHaveBeenLastCalledWith("java-code-action", [
      {
        range: { startLineNumber: 1, startColumn: 9, endLineNumber: 1, endColumn: 12 },
        text: "extracted()",
      },
    ]);

    vi.mocked(h.editor.executeEdits).mockClear();
    const stale = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      { markers: [], trigger: 1 } as Monaco.languages.CodeActionContext,
      h.token,
    );
    expect(stale?.actions).toHaveLength(5);
    vi.spyOn(h.model, "getVersionId").mockReturnValue(8);
    h.applyCommand?.({}, stale?.actions[0]?.command?.arguments?.[0]);
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
    h.registration.dispose();
    expect(h.disposed.codeActions).toBe(true);
  });

  it("applies multi-document code actions to current open models and workspace buffers", async () => {
    const h = harness();
    let companionVersion = 4;
    let companionText = "class Use {}\n";
    const companion = {
      uri: { toString: () => "file:///src/Use.java" },
      getVersionId: () => companionVersion,
      getLanguageId: () => "java",
      getLineCount: () => 1,
      getLineMaxColumn: () => 20,
      getValue: () => companionText,
      getEOL: () => "\n",
      getOffsetAt: (position: { lineNumber: number; column: number }) => position.column - 1,
      isDisposed: () => false,
      pushStackElement: vi.fn(),
      pushEditOperations: vi.fn(
        (_before: unknown, edits: Monaco.editor.IIdentifiedSingleEditOperation[]) => {
          for (const edit of [...edits].reverse())
            companionText = `${companionText.slice(0, edit.range.startColumn - 1)}${edit.text ?? ""}${companionText.slice(edit.range.endColumn - 1)}`;
          companionVersion += 1;
          return null;
        },
      ),
    } as unknown as Monaco.editor.ITextModel;
    h.setModels([h.model, companion]);
    h.codeActions.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        actions: [
          {
            title: "Update related Java file",
            kind: "quickfix",
            edits: [],
            additionalEdits: [
              {
                document: {
                  workspaceId: "workspace-1",
                  path: "src/Use.java",
                  uri: "file:///src/Use.java",
                  version: companionVersion,
                },
                edit: {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "// companion\n",
                },
              },
            ],
          },
        ],
        isTruncated: false,
      }),
    );
    const result = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      { markers: [], trigger: 1 } as Monaco.languages.CodeActionContext,
      h.token,
    );
    const action = result?.actions[0];
    expect(action).toMatchObject({ title: "Update related Java file", kind: "quickfix" });
    expect(action?.edit).toBeUndefined();
    expect(action?.command?.id).toMatch(/^ide\.java\.applyCodeAction\./);
    const key = action?.command?.arguments?.[0];
    companionVersion += 1;
    h.applyCommand?.({}, key);
    expect(h.onWorkspaceDocumentChanges).not.toHaveBeenCalled();
    expect(companion.getValue()).toBe("class Use {}\n");

    const currentResult = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      { markers: [], trigger: 1 } as Monaco.languages.CodeActionContext,
      h.token,
    );
    const currentAction = currentResult?.actions[0];
    h.applyCommand?.({}, currentAction?.command?.arguments?.[0]);
    expect(h.onWorkspaceDocumentChanges).toHaveBeenCalledWith([
      {
        filePath: "src/Use.java",
        before: "class Use {}\n",
        after: "// companion\nclass Use {}\n",
      },
    ]);
    expect(companion.getValue()).toBe("// companion\nclass Use {}\n");
    expect(companion.pushStackElement).toHaveBeenCalledTimes(2);

    let resolveResponse!: (response: JavaCodeActionsResponse) => void;
    h.codeActions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const pending = h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      { markers: [], trigger: 1 } as Monaco.languages.CodeActionContext,
      h.token,
    );
    companionVersion += 1;
    const requestId = h.codeActions.mock.calls.at(-1)?.[0].requestId;
    if (!requestId) throw new Error("Expected a pending Java code-action request");
    resolveResponse({
      ok: true,
      requestId,
      result: {
        ...metadata,
        actions: [
          {
            title: "Update related Java file",
            edits: [],
            additionalEdits: [
              {
                document: {
                  workspaceId: "workspace-1",
                  path: "src/Use.java",
                  uri: "file:///src/Use.java",
                  version: 4,
                },
                edit: {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "// stale\n",
                },
              },
            ],
          },
        ],
        isTruncated: false,
      },
    });
    await expect(pending).resolves.toMatchObject({ actions: [] });
  });

  it("re-queries JDT LS with the selected generator members and applies only a current edit", async () => {
    const h = harness();
    const memberSelection: JavaCodeActionMemberSelection = {
      kind: "constructors",
      groups: [
        {
          id: "fields",
          label: "Fields to initialize",
          members: [
            { selectionKey: "field-display", name: "displayName" },
            { selectionKey: "field-revision", name: "revision" },
          ],
          selectedKeys: ["field-display", "field-revision"],
        },
        {
          id: "constructors",
          label: "Super constructors",
          members: [{ selectionKey: "ctor-noarg", name: "Object" }],
          selectedKeys: ["ctor-noarg"],
        },
      ],
    };
    h.selectCodeActionMembers.mockResolvedValueOnce({
      kind: "constructors",
      selectedFieldBindingKeys: ["field-display"],
      selectedConstructorBindingKeys: ["ctor-noarg"],
      selectedOverridableMethodKeys: [],
      selectedDelegateMethodKeys: [],
    });
    h.codeActions.mockImplementation(async (request) => {
      const response: JavaCodeActionsResponse = request.generationSelection
        ? success(request.requestId, {
            ...metadata,
            isTruncated: false,
            actions: [
              {
                title: "Generate constructors",
                kind: "quickassist",
                edits: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 0 },
                    },
                    newText: "public Main(String displayName) {}",
                  },
                ],
              },
            ],
          })
        : success(request.requestId, {
            ...metadata,
            isTruncated: false,
            actions: [
              {
                title: "Generate constructors",
                kind: "quickassist",
                edits: [],
                memberSelection,
              },
            ],
          });
      return response;
    });
    const list = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      { markers: [], trigger: 1 } as Monaco.languages.CodeActionContext,
      h.token,
    );
    const action = list?.actions[0];
    h.applyCommand?.({}, action?.command?.arguments?.[0]);

    await vi.waitFor(() => expect(h.codeActions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(h.editor.executeEdits).toHaveBeenCalledTimes(1));
    expect(h.selectCodeActionMembers).toHaveBeenCalledWith(memberSelection);
    expect(h.codeActions.mock.calls[1]?.[0].generationSelection).toEqual({
      kind: "constructors",
      selectedFieldBindingKeys: ["field-display"],
      selectedConstructorBindingKeys: ["ctor-noarg"],
      selectedOverridableMethodKeys: [],
      selectedDelegateMethodKeys: [],
    });
    expect(h.editor.executeEdits).toHaveBeenCalledWith("java-code-action", [
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: "public Main(String displayName) {}",
      },
    ]);
    h.registration.dispose();
  });

  it("discards a generated member-selection edit if the document changes while JDT LS responds", async () => {
    const h = harness();
    const memberSelection: JavaCodeActionMemberSelection = {
      kind: "hashCodeEquals",
      groups: [
        {
          id: "fields",
          label: "Fields",
          members: [{ selectionKey: "field-display", name: "displayName" }],
          selectedKeys: ["field-display"],
        },
      ],
    };
    let resolveGeneration!: (response: JavaCodeActionsResponse) => void;
    h.codeActions
      .mockImplementationOnce(async (request) =>
        success(request.requestId, {
          ...metadata,
          isTruncated: false,
          actions: [
            {
              title: "Generate hashCode() and equals()",
              kind: "quickassist",
              edits: [],
              memberSelection,
            },
          ],
        }),
      )
      .mockImplementationOnce(() => new Promise((resolve) => (resolveGeneration = resolve)));
    const list = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      { markers: [], trigger: 1 } as Monaco.languages.CodeActionContext,
      h.token,
    );
    h.applyCommand?.({}, list?.actions[0]?.command?.arguments?.[0]);
    await vi.waitFor(() => expect(h.codeActions).toHaveBeenCalledTimes(2));
    h.setModelVersion(8);
    const request = h.codeActions.mock.calls[1]?.[0];
    resolveGeneration(
      success(request!.requestId, {
        ...metadata,
        isTruncated: false,
        actions: [
          {
            title: "Generate hashCode() and equals()",
            kind: "quickassist",
            edits: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: "stale generator methods",
              },
            ],
          },
        ],
      }),
    );
    await Promise.resolve();
    expect(h.editor.executeEdits).not.toHaveBeenCalled();
    h.registration.dispose();
  });

  it("lets the person choose inherited methods and applies the fresh JDT LS edit", async () => {
    const h = harness();
    const selectionKey =
      '{"name":"label","declaringClass":"example.LabelContract","parameters":[]}';
    const memberSelection: JavaCodeActionMemberSelection = {
      kind: "overrideMethods",
      groups: [
        {
          id: "overridableMethods",
          label: "Methods to override or implement",
          members: [
            {
              selectionKey,
              name: "label",
              detail: "label() — example.LabelContract",
            },
          ],
          selectedKeys: [],
        },
      ],
    };
    h.selectCodeActionMembers.mockResolvedValueOnce({
      kind: "overrideMethods",
      selectedFieldBindingKeys: [],
      selectedConstructorBindingKeys: [],
      selectedOverridableMethodKeys: [selectionKey],
      selectedDelegateMethodKeys: [],
    });
    h.codeActions.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isTruncated: false,
        actions: [
          {
            title: "Generate Override/Implement Methods",
            kind: "quickassist",
            edits: request.generationSelection
              ? [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 0 },
                    },
                    newText: "@Override\nString label() { return null; }",
                  },
                ]
              : [],
            ...(!request.generationSelection ? { memberSelection } : {}),
          },
        ],
      }),
    );

    const list = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      { markers: [], trigger: 1 } as Monaco.languages.CodeActionContext,
      h.token,
    );
    const action = list?.actions.find((candidate) =>
      candidate.title.includes("Override/Implement"),
    );
    expect(action).toBeDefined();
    h.applyCommand?.({}, action?.command?.arguments?.[0]);

    await vi.waitFor(() => expect(h.codeActions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(h.editor.executeEdits).toHaveBeenCalledTimes(1));
    expect(h.selectCodeActionMembers).toHaveBeenCalledWith(memberSelection);
    expect(h.codeActions.mock.calls[1]?.[0].generationSelection).toEqual({
      kind: "overrideMethods",
      selectedFieldBindingKeys: [],
      selectedConstructorBindingKeys: [],
      selectedOverridableMethodKeys: [selectionKey],
      selectedDelegateMethodKeys: [],
    });
    expect(h.editor.executeEdits).toHaveBeenCalledWith("java-code-action", [
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: "@Override\nString label() { return null; }",
      },
    ]);
    h.registration.dispose();
  });

  it("lets the person choose a delegate target method and applies the fresh JDT LS edit", async () => {
    const h = harness();
    const selectionKey = '{"fieldBindingKey":"field:delegate","methodBindingKey":"method:format"}';
    const memberSelection: JavaCodeActionMemberSelection = {
      kind: "delegateMethods",
      groups: [
        {
          id: "delegateMethods",
          label: "Methods to delegate",
          members: [
            {
              selectionKey,
              name: "textDelegate.format",
              detail: "example.TextDelegate textDelegate → format(String)",
            },
          ],
          selectedKeys: [],
        },
      ],
    };
    h.selectCodeActionMembers.mockResolvedValueOnce({
      kind: "delegateMethods",
      selectedFieldBindingKeys: [],
      selectedConstructorBindingKeys: [],
      selectedOverridableMethodKeys: [],
      selectedDelegateMethodKeys: [selectionKey],
    });
    h.codeActions.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isTruncated: false,
        actions: [
          {
            title: "Generate Delegate Methods",
            kind: "quickassist",
            edits: request.generationSelection
              ? [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 0 },
                    },
                    newText: "String format(String value) { return textDelegate.format(value); }",
                  },
                ]
              : [],
            ...(!request.generationSelection ? { memberSelection } : {}),
          },
        ],
      }),
    );

    const list = await h.providers.codeActions.provideCodeActions(
      h.model,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 } as Monaco.Range,
      { markers: [], trigger: 1 } as Monaco.languages.CodeActionContext,
      h.token,
    );
    const action = list?.actions.find(
      (candidate) => candidate.title === "Generate Delegate Methods",
    );
    expect(action).toBeDefined();
    h.applyCommand?.({}, action?.command?.arguments?.[0]);

    await vi.waitFor(() => expect(h.codeActions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(h.editor.executeEdits).toHaveBeenCalledTimes(1));
    expect(h.selectCodeActionMembers).toHaveBeenCalledWith(memberSelection);
    expect(h.codeActions.mock.calls[1]?.[0].generationSelection).toEqual({
      kind: "delegateMethods",
      selectedFieldBindingKeys: [],
      selectedConstructorBindingKeys: [],
      selectedOverridableMethodKeys: [],
      selectedDelegateMethodKeys: [selectionKey],
    });
    expect(h.editor.executeEdits).toHaveBeenCalledWith("java-code-action", [
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: "String format(String value) { return textDelegate.format(value); }",
      },
    ]);
    h.registration.dispose();
  });

  it("maps a semantic rename across captured Monaco workspace models", async () => {
    const h = harness();
    const companion = {
      uri: { toString: () => "file:///workspace/project/src/Use.java" },
      getLineCount: () => 2,
      getLineMaxColumn: (line: number) => (line === 1 ? 13 : 8),
      getVersionId: () => 11,
    } as Monaco.editor.ITextModel;
    h.setModels([h.model, companion]);
    h.rename.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        documentEdits: [
          {
            document: documentTarget,
            edits: [
              {
                range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
                newText: "renamed",
              },
              {
                range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } },
                newText: "renamed",
              },
            ],
          },
          {
            document: {
              path: "src/Use.java",
              uri: "file:///workspace/project/src/Use.java",
              version: 2,
            },
            edits: [
              {
                range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } },
                newText: "renamed",
              },
            ],
          },
        ],
      }),
    );

    const result = await h.providers.rename.provideRenameEdits(
      h.model,
      position,
      "renamed",
      h.token,
    );

    expect(h.rename).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace-1",
        generation: 3,
        document: documentTarget,
        position: { line: 1, character: 3 },
        newName: "renamed",
      }),
    );
    expect(result).toEqual({
      edits: [
        {
          resource: h.model.uri,
          textEdit: {
            range: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 5 },
            text: "renamed",
          },
          versionId: 7,
        },
        {
          resource: h.model.uri,
          textEdit: {
            range: { startLineNumber: 2, startColumn: 2, endLineNumber: 2, endColumn: 4 },
            text: "renamed",
          },
          versionId: 7,
        },
        {
          resource: companion.uri,
          textEdit: {
            range: { startLineNumber: 2, startColumn: 2, endLineNumber: 2, endColumn: 4 },
            text: "renamed",
          },
          versionId: 11,
        },
      ],
    });
  });

  it("does not reapply a rename already committed by the desktop editor", async () => {
    const h = harness();
    h.rename.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        documentEdits: [
          {
            document: documentTarget,
            edits: [
              {
                range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
                newText: "renamed",
              },
            ],
          },
        ],
        appliedToEditor: true,
      }),
    );

    await expect(
      h.providers.rename.provideRenameEdits(h.model, position, "renamed", h.token),
    ).resolves.toEqual({ edits: [] });
    h.registration.dispose();
  });

  it("sends exact zero-based completion context and safely maps bounded items", async () => {
    const h = harness();
    h.completion.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isIncomplete: true,
        items: [
          {
            label: "println",
            kind: "method",
            detail: "detail",
            sortText: "1",
            filterText: "print",
            insertText: "ignored",
            textEdit: {
              range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } },
              newText: "println()",
            },
            additionalTextEdits: [
              {
                document: { workspaceId: "workspace-1", ...documentTarget },
                edit: {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "import java.util.List;\n",
                },
              },
            ],
            documentation: { format: "markdown", value: "**docs**" },
            commitCharacters: [";"],
            deprecated: true,
            preselect: true,
          },
          { label: "snippet", kind: "snippet", insertText: "${1:value}" },
        ],
      } satisfies JavaCompletionResult),
    );

    const result = (await h.providers.completion.provideCompletionItems(
      h.model,
      position,
      { triggerKind: 1, triggerCharacter: "." },
      h.token,
    )) as Monaco.languages.CompletionList;
    const request = h.completion.mock.calls[0]![0];
    expect(request).toMatchObject({
      workspaceId: "workspace-1",
      generation: 3,
      document: documentTarget,
      position: { line: 1, character: 3 },
      trigger: { kind: "trigger-character", character: "." },
    });
    expect(request.requestId).toMatch(/^java-ui-request-/);
    expect(request.cancellationId).toMatch(/^java-ui-cancel-/);
    expect(request.requestId.length).toBeLessThan(80);
    expect(result.incomplete).toBe(true);
    expect(result.suggestions[0]).toMatchObject({
      label: "println",
      kind: 1,
      detail: "detail",
      insertText: "println()",
      range: { startLineNumber: 2, startColumn: 2, endLineNumber: 2, endColumn: 4 },
      documentation: { value: "**docs**", isTrusted: false, supportHtml: false },
      tags: [1],
      preselect: true,
      commitCharacters: [";"],
    });
    expect(result.suggestions[0]).toMatchObject({
      additionalTextEdits: [
        {
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
          text: "import java.util.List;\n",
        },
      ],
    });
    expect(result.suggestions[0]).not.toHaveProperty("command");
    expect(result.suggestions[0]).not.toHaveProperty("insertTextRules");
    expect(result.suggestions[1]).toMatchObject({ insertText: "${1:value}", insertTextRules: 4 });
  });

  it("rejects stale, cross-document, invalid, and overlapping completion edits", async () => {
    const h = harness();
    const completionItem = {
      label: "List",
      kind: "class" as const,
      textEdit: {
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } },
        newText: "List",
      },
      additionalTextEdits: [
        {
          document: { workspaceId: "workspace-1", ...documentTarget },
          edit: {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: "import java.util.List;\n",
          },
        },
      ],
    };
    h.completion.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isIncomplete: false,
        items: [completionItem],
      } satisfies JavaCompletionResult),
    );

    const getSuggestion = async () => {
      const result = (await h.providers.completion.provideCompletionItems(
        h.model,
        position,
        { triggerKind: 0 },
        h.token,
      )) as Monaco.languages.CompletionList;
      return result.suggestions;
    };

    expect(await getSuggestion()).toHaveLength(1);

    h.completion.mockImplementationOnce(async (request) =>
      success(request.requestId, {
        ...metadata,
        isIncomplete: false,
        items: [
          {
            ...completionItem,
            additionalTextEdits: completionItem.additionalTextEdits.map((additional) => ({
              ...additional,
              document: { ...additional.document, version: additional.document.version - 1 },
            })),
          },
        ],
      } satisfies JavaCompletionResult),
    );
    expect(await getSuggestion()).toHaveLength(0);

    h.completion.mockImplementationOnce(async (request) =>
      success(request.requestId, {
        ...metadata,
        isIncomplete: false,
        items: [
          {
            ...completionItem,
            additionalTextEdits: completionItem.additionalTextEdits.map((additional) => ({
              ...additional,
              document: { ...additional.document, path: "src/Other.java" },
            })),
          },
        ],
      } satisfies JavaCompletionResult),
    );
    expect(await getSuggestion()).toHaveLength(0);

    h.completion.mockImplementationOnce(async (request) =>
      success(request.requestId, {
        ...metadata,
        isIncomplete: false,
        items: [
          {
            ...completionItem,
            additionalTextEdits: completionItem.additionalTextEdits.map((additional) => ({
              ...additional,
              edit: {
                ...additional.edit,
                range: {
                  start: { line: 8, character: 0 },
                  end: { line: 8, character: 0 },
                },
              },
            })),
          },
        ],
      } satisfies JavaCompletionResult),
    );
    expect(await getSuggestion()).toHaveLength(0);

    h.completion.mockImplementationOnce(async (request) =>
      success(request.requestId, {
        ...metadata,
        isIncomplete: false,
        items: [
          {
            ...completionItem,
            additionalTextEdits: completionItem.additionalTextEdits.map((additional) => ({
              ...additional,
              edit: {
                ...additional.edit,
                range: {
                  start: { line: 1, character: 2 },
                  end: { line: 1, character: 4 },
                },
              },
            })),
          },
        ],
      } satisfies JavaCompletionResult),
    );
    expect(await getSuggestion()).toHaveLength(0);

    h.completion.mockImplementationOnce(async (request) =>
      success(request.requestId, {
        ...metadata,
        isIncomplete: false,
        items: [
          {
            ...completionItem,
            textEdit: {
              ...completionItem.textEdit,
              range: {
                start: { line: 8, character: 0 },
                end: { line: 8, character: 0 },
              },
            },
          },
        ],
      } satisfies JavaCompletionResult),
    );
    expect(await getSuggestion()).toHaveLength(0);
  });

  it("maps hover and signatures with untrusted display content and disposal", async () => {
    const h = harness();
    h.hover.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isTruncated: false,
        contents: [
          { format: "plaintext", value: "String" },
          { format: "markdown", value: "<b>unsafe</b>" },
        ],
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
      } satisfies JavaHoverResult),
    );
    h.signatureHelp.mockImplementation(async (request) =>
      success(request.requestId, {
        ...metadata,
        isTruncated: false,
        activeSignature: 0,
        activeParameter: 1,
        signatures: [
          {
            label: "call(String, int)",
            documentation: { format: "markdown", value: "**call**" },
            parameters: [
              { label: "String" },
              {
                label: { start: 13, end: 16 },
                documentation: { format: "plaintext", value: "count" },
              },
            ],
          },
        ],
      } satisfies JavaSignatureHelpResult),
    );

    const hover = (await h.providers.hover.provideHover(
      h.model,
      position,
      h.token,
    )) as Monaco.languages.Hover;
    expect(hover.contents).toEqual([
      { value: "String", isTrusted: false, supportHtml: false },
      { value: "<b>unsafe</b>", isTrusted: false, supportHtml: false },
    ]);
    const signature = (await h.providers.signature.provideSignatureHelp(
      h.model,
      position,
      h.token,
      {
        triggerKind: 1,
        isRetrigger: false,
      },
    )) as Monaco.languages.SignatureHelpResult;
    expect(signature.value).toMatchObject({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [
        {
          label: "call(String, int)",
          parameters: [{ label: "String" }, { label: [13, 16] }],
        },
      ],
    });
    signature.dispose();
    h.registration.dispose();
    expect(h.disposed).toEqual({
      completion: true,
      documentSymbols: true,
      documentHighlights: true,
      hover: true,
      signature: true,
      codeActions: true,
      rename: true,
      semanticTokens: true,
      formatting: true,
      rangeFormatting: true,
      inlayHints: true,
    });
  });

  it("cancels best effort and suppresses late, stale, wrong-model, and contextless work", async () => {
    const h = harness();
    let resolve!: (value: JavaCompletionResponse) => void;
    h.completion.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = h.providers.completion.provideCompletionItems(
      h.model,
      position,
      { triggerKind: 0 },
      h.token,
    ) as Promise<Monaco.languages.CompletionList>;
    const request = h.completion.mock.calls[0]![0];
    h.cancelToken();
    expect(h.cancel).toHaveBeenCalledWith(request.cancellationId);
    resolve(success(request.requestId, { ...metadata, items: [], isIncomplete: false }));
    expect(await pending).toEqual({ suggestions: [] });

    const otherModel = {
      ...h.model,
      uri: { toString: () => "file:///src/Other.java" },
    } as Monaco.editor.ITextModel;
    const freshToken = { ...h.token, isCancellationRequested: false } as Monaco.CancellationToken;
    await h.providers.hover.provideHover(otherModel, position, freshToken);
    expect(h.hover).not.toHaveBeenCalled();

    h.setCurrent(undefined);
    await h.providers.hover.provideHover(h.model, position, freshToken);
    expect(h.hover).not.toHaveBeenCalled();
  });
});
