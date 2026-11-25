import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  JavaCodeActionsRequest,
  JavaFormattingRequest,
  JavaRangeFormattingRequest,
  JavaRenameRequest,
  JavaCompletionRequest,
  JavaDocumentHighlightsRequest,
  JavaImplementationsRequest,
  JavaDefinitionsRequest,
  JavaCallHierarchyRequest,
  JavaReferencesRequest,
  JavaDocumentSymbolsRequest,
  JavaSemanticTokensRequest,
  JavaInlayHintsRequest,
  JavaWorkspaceSymbolsRequest,
} from "@ide/contracts";

import { TauriAdapterError } from "./errors";
import { TauriJavaIntelligenceAdapter } from "./java-intelligence-tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const request: JavaCompletionRequest = {
  workspaceId: "workspace-1",
  generation: 7,
  document: {
    path: "src/Main.java",
    uri: "file:///workspace/project/src/Main.java",
    version: 4,
  },
  position: { line: 2, character: 6 },
  requestId: "request-1",
  cancellationId: "cancel-1",
  trigger: { kind: "trigger-character", character: "." },
};

const documentSymbolsRequest: JavaDocumentSymbolsRequest = {
  workspaceId: "workspace-1",
  generation: 7,
  document: request.document,
  requestId: "outline-1",
  cancellationId: "outline-cancel-1",
};

const documentHighlightsRequest: JavaDocumentHighlightsRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  position: request.position,
  requestId: "highlights-1",
  cancellationId: "highlights-cancel-1",
};

const implementationsRequest: JavaImplementationsRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  position: request.position,
  requestId: "implementations-1",
  cancellationId: "implementations-cancel-1",
};

const definitionsRequest: JavaDefinitionsRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  position: request.position,
  requestId: "definitions-1",
  cancellationId: "definitions-cancel-1",
};

const referencesRequest: JavaReferencesRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  position: request.position,
  requestId: "references-1",
  cancellationId: "references-cancel-1",
  includeDeclaration: true,
};

const callHierarchyRequest: JavaCallHierarchyRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  position: request.position,
  requestId: "call-hierarchy-1",
  cancellationId: "call-hierarchy-cancel-1",
  direction: "incoming",
};

const semanticTokensRequest: JavaSemanticTokensRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  requestId: "tokens-1",
  cancellationId: "tokens-cancel-1",
};

const inlayHintsRequest: JavaInlayHintsRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
  requestId: "inlay-hints-1",
  cancellationId: "inlay-hints-cancel-1",
};

const workspaceSymbolsRequest: JavaWorkspaceSymbolsRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  query: "OrderService",
  requestId: "workspace-symbols-1",
  cancellationId: "workspace-symbols-cancel-1",
};

const codeActionsRequest: JavaCodeActionsRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  position: { line: 0, character: 0 },
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
  diagnostics: [
    {
      range: { start: { line: 0, character: 7 }, end: { line: 0, character: 11 } },
      severity: 1,
      message: "List cannot be resolved to a type",
      source: "jdt.ls",
      code: "16777218",
    },
  ],
  requestId: "actions-1",
  cancellationId: "actions-cancel-1",
};

const renameRequest: JavaRenameRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  position: request.position,
  newName: "renamedValue",
  requestId: "rename-1",
  cancellationId: "rename-cancel-1",
};

const formattingRequest: JavaFormattingRequest = {
  workspaceId: request.workspaceId,
  generation: request.generation,
  document: request.document,
  options: { tabSize: 2, insertSpaces: false },
  requestId: "formatting-1",
  cancellationId: "formatting-cancel-1",
};

const rangeFormattingRequest: JavaRangeFormattingRequest = {
  ...formattingRequest,
  range: {
    start: { line: 0, character: 10 },
    end: { line: 0, character: 22 },
  },
};

function native(result: unknown, overrides: Record<string, unknown> = {}) {
  return {
    provider: "jdtls",
    providerVersion: "1.42.0",
    workspaceId: request.workspaceId,
    generation: request.generation,
    path: request.document.path,
    uri: request.document.uri,
    version: request.document.version,
    requestId: request.requestId,
    cancelled: false,
    timeout: false,
    error: null,
    result,
    ...overrides,
  };
}

const range = {
  start: { line: 2, character: 2 },
  end: { line: 2, character: 6 },
};

describe("TauriJavaIntelligenceAdapter", () => {
  beforeEach(() => invokeMock.mockReset());

  it("sends the exact completion payload without source text", async () => {
    invokeMock.mockResolvedValueOnce(native({ items: [], isIncomplete: false }));
    const runtimeRequest = { ...request, source: "private source" } as JavaCompletionRequest;

    await new TauriJavaIntelligenceAdapter().completion(runtimeRequest);

    expect(invokeMock).toHaveBeenCalledWith("request_java_completion", {
      request: {
        workspaceId: "workspace-1",
        generation: 7,
        document: {
          path: "src/Main.java",
          uri: "file:///workspace/project/src/Main.java",
          version: 4,
        },
        position: { line: 2, character: 6 },
        requestId: "request-1",
        cancellationId: "cancel-1",
        trigger: { kind: "trigger-character", character: "." },
      },
    });
    expect(JSON.stringify(invokeMock.mock.calls)).not.toContain("private source");
  });

  it("sends provider formatting options and normalizes only bounded same-document edits", async () => {
    const edit = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      newText: "class",
    };
    invokeMock.mockResolvedValueOnce(
      native({ edits: [edit] }, { requestId: formattingRequest.requestId }),
    );

    const response = await new TauriJavaIntelligenceAdapter().formatDocument(formattingRequest);

    expect(invokeMock).toHaveBeenCalledWith("request_java_formatting", {
      request: {
        workspaceId: formattingRequest.workspaceId,
        generation: formattingRequest.generation,
        document: formattingRequest.document,
        position: { line: 0, character: 0 },
        requestId: formattingRequest.requestId,
        cancellationId: formattingRequest.cancellationId,
        formattingOptions: { tabSize: 2, insertSpaces: false },
      },
    });
    expect(response).toMatchObject({
      ok: true,
      requestId: formattingRequest.requestId,
      result: { document: formattingRequest.document, edits: [edit] },
    });
  });

  it("sends on-type formatting with the typed position and exact trigger", async () => {
    const typed = { ...formattingRequest, position: { line: 2, character: 6 }, character: ";" };
    invokeMock.mockResolvedValueOnce(native({ edits: [] }, { requestId: typed.requestId }));
    const adapter = new TauriJavaIntelligenceAdapter();
    expect((await adapter.formatOnType(typed)).ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("request_java_formatting", { request: {
      workspaceId: typed.workspaceId, generation: typed.generation, document: typed.document,
      position: typed.position, requestId: typed.requestId, cancellationId: typed.cancellationId,
      formattingOptions: typed.options, formattingCharacter: ";",
    } });
    invokeMock.mockClear();
    for (const character of ["", ";;", "\0", "\ud800"])
      expect(() => adapter.formatOnType({ ...typed, character })).toThrow(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects overlapping formatting edits from the native adapter", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
              newText: "class",
            },
            {
              range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } },
              newText: "Main",
            },
          ],
        },
        { requestId: formattingRequest.requestId },
      ),
    );

    await expect(
      new TauriJavaIntelligenceAdapter().formatDocument(formattingRequest),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("formats only the requested selection and rejects edits outside it", async () => {
    const edit = {
      range: { start: { line: 0, character: 12 }, end: { line: 0, character: 16 } },
      newText: "int\n  ",
    };
    invokeMock.mockResolvedValueOnce(
      native({ edits: [edit] }, { requestId: rangeFormattingRequest.requestId }),
    );
    const adapter = new TauriJavaIntelligenceAdapter();
    const response = await adapter.formatRange(rangeFormattingRequest);
    expect(invokeMock).toHaveBeenCalledWith("request_java_formatting", {
      request: {
        workspaceId: rangeFormattingRequest.workspaceId,
        generation: rangeFormattingRequest.generation,
        document: rangeFormattingRequest.document,
        position: rangeFormattingRequest.range.start,
        range: rangeFormattingRequest.range,
        requestId: rangeFormattingRequest.requestId,
        cancellationId: rangeFormattingRequest.cancellationId,
        formattingOptions: { tabSize: 2, insertSpaces: false },
      },
    });
    expect(response).toMatchObject({
      ok: true,
      requestId: rangeFormattingRequest.requestId,
      result: { edits: [edit] },
    });

    invokeMock.mockResolvedValueOnce(
      native(
        {
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              newText: "class",
            },
          ],
        },
        { requestId: rangeFormattingRequest.requestId },
      ),
    );
    await expect(adapter.formatRange(rangeFormattingRequest)).rejects.toBeInstanceOf(
      TauriAdapterError,
    );
  });

  it("requests bounded inlay hints for the current Java range", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          hints: [
            {
              position: { line: 0, character: 8 },
              label: "count:",
              kind: "parameter",
              paddingRight: true,
            },
          ],
          isTruncated: false,
        },
        { requestId: inlayHintsRequest.requestId },
      ),
    );
    const response = await new TauriJavaIntelligenceAdapter().inlayHints(inlayHintsRequest);
    expect(invokeMock).toHaveBeenCalledWith("request_java_inlay_hints", {
      request: {
        workspaceId: inlayHintsRequest.workspaceId,
        generation: inlayHintsRequest.generation,
        document: inlayHintsRequest.document,
        position: inlayHintsRequest.range.start,
        range: inlayHintsRequest.range,
        requestId: inlayHintsRequest.requestId,
        cancellationId: inlayHintsRequest.cancellationId,
      },
    });
    expect(response).toMatchObject({
      ok: true,
      requestId: inlayHintsRequest.requestId,
      result: {
        hints: [{ position: { line: 0, character: 8 }, label: "count:", kind: "parameter" }],
        isTruncated: false,
      },
    });
  });

  it("rejects provider inlay hints outside the requested range", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          hints: [{ position: { line: 1, character: 0 }, label: "outside" }],
          isTruncated: false,
        },
        { requestId: inlayHintsRequest.requestId },
      ),
    );
    await expect(new TauriJavaIntelligenceAdapter().inlayHints(inlayHintsRequest)).rejects.toThrow(
      TauriAdapterError,
    );
  });

  it("rejects empty Java formatting selections before invoking native code", async () => {
    expect(() =>
      new TauriJavaIntelligenceAdapter().formatRange({
        ...rangeFormattingRequest,
        range: { start: { line: 0, character: 8 }, end: { line: 0, character: 8 } },
      }),
    ).toThrow(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses invalid editor formatting options before invoking native code", async () => {
    expect(() =>
      new TauriJavaIntelligenceAdapter().formatDocument({
        ...formattingRequest,
        options: { tabSize: 0, insertSpaces: true },
      }),
    ).toThrow(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("normalizes bounded completion fields, edits, and metadata", async () => {
    invokeMock.mockResolvedValueOnce(
      native({
        isIncomplete: true,
        items: [
          {
            label: "println",
            kind: "method",
            detail: "void println(String)",
            documentation: { format: "markdown", value: "**Untrusted**" },
            sortText: "001",
            filterText: "println",
            insertText: "println($1)",
            textEdit: { range, newText: "println()" },
            additionalTextEdits: [
              {
                document: { workspaceId: request.workspaceId, ...request.document },
                edit: {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "import java.io.*;\n",
                },
              },
            ],
            commitCharacters: [";", ")"],
            deprecated: false,
            preselect: true,
          },
        ],
      }),
    );

    const response = await new TauriJavaIntelligenceAdapter().completion(request);

    expect(response).toEqual({
      ok: true,
      requestId: "request-1",
      result: {
        provider: "jdt-ls",
        providerVersion: "1.42.0",
        workspaceId: "workspace-1",
        generation: 7,
        document: request.document,
        isIncomplete: true,
        items: [
          expect.objectContaining({
            label: "println",
            kind: "method",
            documentation: { format: "markdown", value: "**Untrusted**" },
            textEdit: { range, newText: "println()" },
            additionalTextEdits: [
              expect.objectContaining({
                document: { workspaceId: request.workspaceId, ...request.document },
              }),
            ],
            commitCharacters: [";", ")"],
            deprecated: false,
            preselect: true,
          }),
        ],
      },
    });
  });

  it("requests and normalizes bounded hierarchical document symbols", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          isTruncated: false,
          symbols: [
            {
              name: "Main",
              kind: "class",
              range: {
                start: { line: 0, character: 0 },
                end: { line: 4, character: 1 },
              },
              selectionRange: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 10 },
              },
              children: [
                {
                  name: "run",
                  kind: "method",
                  detail: "void run()",
                  tags: [1],
                  range: {
                    start: { line: 2, character: 2 },
                    end: { line: 3, character: 3 },
                  },
                  selectionRange: {
                    start: { line: 2, character: 7 },
                    end: { line: 2, character: 10 },
                  },
                },
              ],
            },
          ],
        },
        { requestId: documentSymbolsRequest.requestId },
      ),
    );

    const result = await new TauriJavaIntelligenceAdapter().documentSymbols(documentSymbolsRequest);

    expect(invokeMock).toHaveBeenCalledWith("request_java_document_symbols", {
      request: {
        workspaceId: "workspace-1",
        generation: 7,
        document: request.document,
        position: { line: 0, character: 0 },
        requestId: "outline-1",
        cancellationId: "outline-cancel-1",
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        symbols: [
          {
            name: "Main",
            kind: "class",
            children: [{ name: "run", kind: "method", deprecated: true }],
          },
        ],
        isTruncated: false,
      },
    });
  });

  it("requests and normalizes typed same-document symbol highlights", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          highlights: [
            { range, kind: "write" },
            {
              range: { start: { line: 3, character: 4 }, end: { line: 3, character: 8 } },
              kind: "read",
            },
          ],
          isTruncated: false,
        },
        { requestId: documentHighlightsRequest.requestId },
      ),
    );
    const result = await new TauriJavaIntelligenceAdapter().documentHighlights(
      documentHighlightsRequest,
    );
    expect(invokeMock).toHaveBeenCalledWith("request_java_document_highlights", {
      request: {
        workspaceId: documentHighlightsRequest.workspaceId,
        generation: documentHighlightsRequest.generation,
        document: documentHighlightsRequest.document,
        position: documentHighlightsRequest.position,
        requestId: documentHighlightsRequest.requestId,
        cancellationId: documentHighlightsRequest.cancellationId,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        isTruncated: false,
        highlights: [{ kind: "write" }, { kind: "read" }],
      },
    });
  });

  it("requests bounded full-document semantic tokens for the synchronized document", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          tokens: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              tokenType: "class",
              tokenModifiers: ["declaration"],
            },
          ],
          isTruncated: false,
        },
        { requestId: semanticTokensRequest.requestId },
      ),
    );
    const result = await new TauriJavaIntelligenceAdapter().semanticTokens(semanticTokensRequest);
    expect(invokeMock).toHaveBeenCalledWith("request_java_semantic_tokens", {
      request: {
        workspaceId: semanticTokensRequest.workspaceId,
        generation: semanticTokensRequest.generation,
        document: semanticTokensRequest.document,
        position: { line: 0, character: 0 },
        requestId: semanticTokensRequest.requestId,
        cancellationId: semanticTokensRequest.cancellationId,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: { tokens: [{ tokenType: "class", tokenModifiers: ["declaration"] }] },
    });
  });

  it("requests workspace symbols and normalizes only workspace-relative Java targets", async () => {
    invokeMock.mockResolvedValueOnce({
      provider: "jdtls",
      providerVersion: "1.61.0",
      workspaceId: workspaceSymbolsRequest.workspaceId,
      generation: workspaceSymbolsRequest.generation,
      requestId: workspaceSymbolsRequest.requestId,
      cancelled: false,
      timeout: false,
      error: null,
      result: {
        symbols: [
          {
            name: "OrderService",
            kind: "class",
            path: "src/main/java/example/OrderService.java",
            range: {
              start: { line: 4, character: 13 },
              end: { line: 4, character: 25 },
            },
            containerName: "example",
          },
        ],
        isTruncated: false,
      },
    });

    const result = await new TauriJavaIntelligenceAdapter().workspaceSymbols(
      workspaceSymbolsRequest,
    );
    expect(invokeMock).toHaveBeenCalledWith("request_java_workspace_symbols", {
      request: workspaceSymbolsRequest,
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        workspaceId: workspaceSymbolsRequest.workspaceId,
        generation: workspaceSymbolsRequest.generation,
        provider: "jdt-ls",
        symbols: [
          {
            name: "OrderService",
            kind: "class",
            path: "src/main/java/example/OrderService.java",
            containerName: "example",
          },
        ],
      },
    });
  });

  it("requests implementations and rejects targets outside the workspace path policy", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          locations: [
            {
              path: "src/ServiceImpl.java",
              range: {
                start: { line: 8, character: 13 },
                end: { line: 8, character: 25 },
              },
            },
          ],
          isTruncated: false,
        },
        { requestId: implementationsRequest.requestId },
      ),
    );
    const result = await new TauriJavaIntelligenceAdapter().implementations(implementationsRequest);
    expect(invokeMock).toHaveBeenCalledWith("request_java_implementations", {
      request: {
        workspaceId: implementationsRequest.workspaceId,
        generation: implementationsRequest.generation,
        document: implementationsRequest.document,
        position: implementationsRequest.position,
        requestId: implementationsRequest.requestId,
        cancellationId: implementationsRequest.cancellationId,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: { locations: [{ path: "src/ServiceImpl.java" }], isTruncated: false },
    });

    invokeMock.mockResolvedValueOnce(
      native(
        {
          locations: [{ path: "../outside/Secret.java", range }],
          isTruncated: false,
        },
        { requestId: implementationsRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().implementations(implementationsRequest),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("requests JDT LS definitions and rejects targets outside workspace Java sources", async () => {
    const location = {
      path: "src/main/java/example/Service.java",
      range: {
        start: { line: 8, character: 13 },
        end: { line: 8, character: 25 },
      },
    };
    invokeMock.mockResolvedValueOnce(
      native(
        { locations: [location], isTruncated: false },
        { requestId: definitionsRequest.requestId },
      ),
    );
    const result = await new TauriJavaIntelligenceAdapter().definitions!(definitionsRequest);
    expect(invokeMock).toHaveBeenCalledWith("request_java_definitions", {
      request: {
        workspaceId: definitionsRequest.workspaceId,
        generation: definitionsRequest.generation,
        document: definitionsRequest.document,
        position: definitionsRequest.position,
        requestId: definitionsRequest.requestId,
        cancellationId: definitionsRequest.cancellationId,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: { locations: [location], isTruncated: false },
    });

    invokeMock.mockResolvedValueOnce(
      native(
        { locations: [{ ...location, path: "../outside/Secret.java" }], isTruncated: false },
        { requestId: definitionsRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().definitions!(definitionsRequest),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("requests workspace references with declaration policy and validates result paths", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          locations: [
            {
              path: "src/Consumer.java",
              range: {
                start: { line: 12, character: 17 },
                end: { line: 12, character: 29 },
              },
            },
          ],
          isTruncated: true,
        },
        { requestId: referencesRequest.requestId },
      ),
    );
    const result = await new TauriJavaIntelligenceAdapter().references(referencesRequest);
    expect(invokeMock).toHaveBeenCalledWith("request_java_references", {
      request: {
        workspaceId: referencesRequest.workspaceId,
        generation: referencesRequest.generation,
        document: referencesRequest.document,
        position: referencesRequest.position,
        requestId: referencesRequest.requestId,
        cancellationId: referencesRequest.cancellationId,
        includeDeclaration: true,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        locations: [
          {
            path: "src/Consumer.java",
            range: {
              start: { line: 12, character: 17 },
              end: { line: 12, character: 29 },
            },
          },
        ],
        isTruncated: true,
      },
    });

    invokeMock.mockResolvedValueOnce(
      native(
        { locations: [{ path: "../outside/Secret.java", range }], isTruncated: false },
        { requestId: referencesRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().references(referencesRequest),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("requests bounded JDT LS call hierarchy and rejects paths outside the workspace", async () => {
    const location = {
      path: "src/Service.java",
      range: { start: { line: 5, character: 2 }, end: { line: 5, character: 7 } },
    };
    const callSite = {
      path: "src/Consumer.java",
      range: { start: { line: 12, character: 17 }, end: { line: 12, character: 29 } },
    };
    invokeMock.mockResolvedValueOnce(
      native(
        {
          direction: "incoming",
          entries: [
            {
              name: "Consumer.run",
              kind: "method",
              detail: "void run()",
              location,
              callSites: [callSite],
            },
          ],
          isTruncated: false,
        },
        { requestId: callHierarchyRequest.requestId },
      ),
    );
    const result = await new TauriJavaIntelligenceAdapter().callHierarchy!(callHierarchyRequest);
    expect(invokeMock).toHaveBeenCalledWith("request_java_call_hierarchy", {
      request: {
        workspaceId: callHierarchyRequest.workspaceId,
        generation: callHierarchyRequest.generation,
        document: callHierarchyRequest.document,
        position: callHierarchyRequest.position,
        requestId: callHierarchyRequest.requestId,
        cancellationId: callHierarchyRequest.cancellationId,
        direction: "incoming",
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        direction: "incoming",
        entries: [{ name: "Consumer.run", location, callSites: [callSite] }],
      },
    });

    invokeMock.mockResolvedValueOnce(
      native(
        {
          direction: "incoming",
          entries: [
            {
              name: "Escape.run",
              kind: "method",
              location: { ...location, path: "../outside/Escape.java" },
              callSites: [],
            },
          ],
          isTruncated: false,
        },
        { requestId: callHierarchyRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().callHierarchy!(callHierarchyRequest),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("rejects unsafe workspace-symbol queries and result paths", async () => {
    await expect(
      new TauriJavaIntelligenceAdapter().workspaceSymbols({
        ...workspaceSymbolsRequest,
        query: "Order\nService",
      }),
    ).rejects.toThrow(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();

    invokeMock.mockResolvedValueOnce({
      provider: "jdtls",
      providerVersion: "1.61.0",
      workspaceId: workspaceSymbolsRequest.workspaceId,
      generation: workspaceSymbolsRequest.generation,
      requestId: workspaceSymbolsRequest.requestId,
      cancelled: false,
      timeout: false,
      error: null,
      result: {
        symbols: [
          {
            name: "Escape",
            kind: "class",
            path: "../Secret.java",
            range,
          },
        ],
        isTruncated: false,
      },
    });
    await expect(
      new TauriJavaIntelligenceAdapter().workspaceSymbols(workspaceSymbolsRequest),
    ).rejects.toThrow(TauriAdapterError);
  });

  it("requests bounded Java code actions with the exact diagnostics and normalizes safe edits", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
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
                  range: { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } },
                  newText: "if (value instanceof String text)",
                },
              ],
            },
            {
              title: "Extract to method",
              kind: "refactor.extract",
              edits: [
                {
                  range: { start: { line: 5, character: 4 }, end: { line: 5, character: 18 } },
                  newText: "extracted()",
                },
              ],
            },
            {
              title: "Generate getter and setter",
              kind: "source.generate.accessors",
              edits: [
                {
                  range: { start: { line: 3, character: 0 }, end: { line: 3, character: 0 } },
                  newText: "  public String getName() { return name; }\n",
                },
              ],
            },
            {
              title: "Sort members",
              kind: "source.sortMembers",
              edits: [
                {
                  range: { start: { line: 3, character: 0 }, end: { line: 5, character: 0 } },
                  newText: "  private int count;\n  private String name;\n",
                },
              ],
            },
            {
              title: "Update open companion",
              kind: "quickfix",
              edits: [
                {
                  range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
                  newText: "// updated\n",
                },
              ],
              additionalEdits: [
                {
                  document: {
                    workspaceId: codeActionsRequest.workspaceId,
                    path: "src/Use.java",
                    uri: "file:///workspace/project/src/Use.java",
                    version: 2,
                  },
                  edit: {
                    range: {
                      start: { line: 1, character: 0 },
                      end: { line: 1, character: 0 },
                    },
                    newText: "// companion\n",
                  },
                },
              ],
            },
          ],
          isTruncated: false,
        },
        { requestId: codeActionsRequest.requestId },
      ),
    );

    const result = await new TauriJavaIntelligenceAdapter().codeActions(codeActionsRequest);

    expect(invokeMock).toHaveBeenCalledWith("request_java_code_actions", {
      request: {
        workspaceId: codeActionsRequest.workspaceId,
        generation: codeActionsRequest.generation,
        document: codeActionsRequest.document,
        position: codeActionsRequest.position,
        requestId: codeActionsRequest.requestId,
        cancellationId: codeActionsRequest.cancellationId,
        range: codeActionsRequest.range,
        diagnostics: codeActionsRequest.diagnostics,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        isTruncated: false,
        actions: [
          { title: "Import java.util.List", kind: "quickfix", isPreferred: true },
          { title: "Use pattern matching", kind: "quickassist" },
          { title: "Extract to method", kind: "refactor.extract" },
          { title: "Generate getter and setter", kind: "source.generate.accessors" },
          { title: "Sort members", kind: "source.sortMembers" },
          {
            title: "Update open companion",
            kind: "quickfix",
            additionalEdits: [
              {
                document: {
                  workspaceId: codeActionsRequest.workspaceId,
                  path: "src/Use.java",
                  uri: "file:///workspace/project/src/Use.java",
                  version: 2,
                },
                edit: {
                  range: {
                    start: { line: 1, character: 0 },
                    end: { line: 1, character: 0 },
                  },
                  newText: "// companion\n",
                },
              },
            ],
          },
        ],
      },
    });
  });

  it("rejects overlapping edits in a Java code action", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Unsafe edits",
              kind: "quickfix",
              edits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                  newText: "x",
                },
                {
                  range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
                  newText: "y",
                },
              ],
            },
          ],
          isTruncated: false,
        },
        { requestId: codeActionsRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().codeActions(codeActionsRequest),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("rejects Java code-action edits from another workspace root", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Escape workspace",
              kind: "quickfix",
              edits: [],
              additionalEdits: [
                {
                  document: {
                    workspaceId: codeActionsRequest.workspaceId,
                    path: "src/Use.java",
                    uri: "file:///another-workspace/src/Use.java",
                    version: 2,
                  },
                  edit: {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    newText: "unsafe",
                  },
                },
              ],
            },
          ],
          isTruncated: false,
        },
        { requestId: codeActionsRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().codeActions(codeActionsRequest),
    ).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("normalizes JDT LS generator choices and sends the selected binding keys back", async () => {
    const memberSelection = {
      kind: "constructors",
      groups: [
        {
          id: "fields",
          label: "Fields to initialize",
          members: [
            { selectionKey: "field-display", name: "displayName", detail: "String" },
            { selectionKey: "field-revision", name: "revision", detail: "int" },
          ],
          selectedKeys: ["field-display", "field-revision"],
        },
        {
          id: "constructors",
          label: "Super constructors",
          members: [{ selectionKey: "ctor-noarg", name: "Object", detail: "Object()" }],
          selectedKeys: ["ctor-noarg"],
        },
      ],
    };
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Generate constructors",
              kind: "quickassist",
              edits: [],
              memberSelection,
            },
          ],
          isTruncated: false,
        },
        { requestId: codeActionsRequest.requestId },
      ),
    );
    const adapter = new TauriJavaIntelligenceAdapter();
    const choices = await adapter.codeActions(codeActionsRequest);
    expect(choices).toMatchObject({
      ok: true,
      result: {
        actions: [{ title: "Generate constructors", edits: [], memberSelection }],
      },
    });

    const generationRequest: JavaCodeActionsRequest = {
      ...codeActionsRequest,
      requestId: "actions-generate-1",
      cancellationId: "actions-generate-cancel-1",
      generationSelection: {
        kind: "constructors",
        selectedFieldBindingKeys: ["field-display"],
        selectedConstructorBindingKeys: ["ctor-noarg"],
        selectedOverridableMethodKeys: [],
        selectedDelegateMethodKeys: [],
      },
    };
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Generate constructors",
              kind: "quickassist",
              edits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "public Main(String displayName) {}",
                },
              ],
            },
          ],
          isTruncated: false,
        },
        { requestId: generationRequest.requestId },
      ),
    );
    const generated = await adapter.codeActions(generationRequest);
    expect(invokeMock).toHaveBeenLastCalledWith("request_java_code_actions", {
      request: expect.objectContaining({
        generationSelection: generationRequest.generationSelection,
      }),
    });
    expect(generated).toMatchObject({
      ok: true,
      result: {
        actions: [
          {
            title: "Generate constructors",
            edits: [{ newText: "public Main(String displayName) {}" }],
          },
        ],
      },
    });
  });

  it("rejects unsafe Java generator member selections before invoking native code", async () => {
    const adapter = new TauriJavaIntelligenceAdapter();
    await expect(
      adapter.codeActions({
        ...codeActionsRequest,
        generationSelection: {
          kind: "constructors",
          selectedFieldBindingKeys: ["field-display", "field-display"],
          selectedConstructorBindingKeys: ["ctor-noarg"],
          selectedOverridableMethodKeys: [],
          selectedDelegateMethodKeys: [],
        },
      }),
    ).rejects.toThrow(TauriAdapterError);
    await expect(
      adapter.codeActions({
        ...codeActionsRequest,
        generationSelection: {
          kind: "hashCodeEquals",
          selectedFieldBindingKeys: [],
          selectedConstructorBindingKeys: [],
          selectedOverridableMethodKeys: [],
          selectedDelegateMethodKeys: [],
        },
      }),
    ).rejects.toThrow(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("normalizes delegate-method choices and forwards the selected field-method pair", async () => {
    const selectionKey = '{"fieldBindingKey":"field:delegate","methodBindingKey":"method:format"}';
    const memberSelection = {
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
          selectedKeys: [selectionKey],
        },
      ],
    };
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Generate Delegate Methods",
              kind: "quickassist",
              edits: [],
              memberSelection,
            },
          ],
          isTruncated: false,
        },
        { requestId: codeActionsRequest.requestId },
      ),
    );
    const adapter = new TauriJavaIntelligenceAdapter();
    const offered = await adapter.codeActions(codeActionsRequest);
    expect(offered).toMatchObject({
      ok: true,
      result: { actions: [{ title: "Generate Delegate Methods", memberSelection }] },
    });

    const generationRequest: JavaCodeActionsRequest = {
      ...codeActionsRequest,
      requestId: "actions-generate-delegate",
      cancellationId: "actions-generate-delegate-cancel",
      generationSelection: {
        kind: "delegateMethods",
        selectedFieldBindingKeys: [],
        selectedConstructorBindingKeys: [],
        selectedOverridableMethodKeys: [],
        selectedDelegateMethodKeys: [selectionKey],
      },
    };
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Generate Delegate Methods",
              kind: "quickassist",
              edits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "String format(String value) { return textDelegate.format(value); }",
                },
              ],
            },
          ],
          isTruncated: false,
        },
        { requestId: generationRequest.requestId },
      ),
    );
    const generated = await adapter.codeActions(generationRequest);
    expect(invokeMock).toHaveBeenLastCalledWith("request_java_code_actions", {
      request: expect.objectContaining({
        generationSelection: generationRequest.generationSelection,
      }),
    });
    expect(generated).toMatchObject({
      ok: true,
      result: {
        actions: [
          {
            title: "Generate Delegate Methods",
            edits: [
              {
                newText: "String format(String value) { return textDelegate.format(value); }",
              },
            ],
          },
        ],
      },
    });
  });

  it("normalizes and submits a selected inherited method for JDT LS generation", async () => {
    const selectionKey =
      '{"name":"label","declaringClass":"example.LabelContract","parameters":[]}';
    const memberSelection = {
      kind: "overrideMethods",
      groups: [
        {
          id: "overridableMethods",
          label: "Methods to override or implement",
          members: [{ selectionKey, name: "label", detail: "label() — example.LabelContract" }],
          selectedKeys: [],
        },
      ],
    };
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Generate Override/Implement Methods",
              kind: "quickassist",
              edits: [],
              memberSelection,
            },
          ],
          isTruncated: false,
        },
        { requestId: codeActionsRequest.requestId },
      ),
    );
    const adapter = new TauriJavaIntelligenceAdapter();
    const offered = await adapter.codeActions(codeActionsRequest);
    expect(offered).toMatchObject({
      ok: true,
      result: {
        actions: [
          {
            title: "Generate Override/Implement Methods",
            memberSelection,
          },
        ],
      },
    });

    const generationRequest: JavaCodeActionsRequest = {
      ...codeActionsRequest,
      requestId: "actions-generate-override",
      cancellationId: "actions-generate-override-cancel",
      generationSelection: {
        kind: "overrideMethods",
        selectedFieldBindingKeys: [],
        selectedConstructorBindingKeys: [],
        selectedOverridableMethodKeys: [selectionKey],
        selectedDelegateMethodKeys: [],
      },
    };
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Generate Override/Implement Methods",
              kind: "quickassist",
              edits: [
                {
                  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                  newText: "@Override\\nString label() { return null; }",
                },
              ],
            },
          ],
          isTruncated: false,
        },
        { requestId: generationRequest.requestId },
      ),
    );
    const generated = await adapter.codeActions(generationRequest);
    expect(invokeMock).toHaveBeenLastCalledWith("request_java_code_actions", {
      request: expect.objectContaining({
        generationSelection: generationRequest.generationSelection,
      }),
    });
    expect(generated).toMatchObject({
      ok: true,
      result: {
        actions: [
          {
            title: "Generate Override/Implement Methods",
            edits: [{ newText: "@Override\\nString label() { return null; }" }],
          },
        ],
      },
    });
  });

  it("refuses generator choices whose selected bindings are absent from the member list", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          actions: [
            {
              title: "Generate hashCode() and equals()",
              kind: "quickassist",
              edits: [],
              memberSelection: {
                kind: "hashCodeEquals",
                groups: [
                  {
                    id: "fields",
                    label: "Fields",
                    members: [{ selectionKey: "field-display", name: "displayName" }],
                    selectedKeys: ["field-stale"],
                  },
                ],
              },
            },
          ],
          isTruncated: false,
        },
        { requestId: codeActionsRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().codeActions(codeActionsRequest),
    ).rejects.toThrow(TauriAdapterError);
  });

  it("admits bounded closed-source discovery without exposing edits", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        { documentEdits: [], documentsToOpen: ["src/Use.java"] },
        { requestId: renameRequest.requestId },
      ),
    );
    await expect(new TauriJavaIntelligenceAdapter().rename(renameRequest)).resolves.toMatchObject({
      ok: true,
      result: { documentEdits: [], documentsToOpen: ["src/Use.java"] },
    });
  });

  it.each(
    [
      [],
      ["../Use.java"],
      ["/Use.java"],
      ["src/Use.txt"],
      [request.document.path],
      ["src/Use.java", "src/Use.java"],
      Array.from({ length: 129 }, (_, n) => `src/Use${n}.java`),
    ].map((paths) => ({ paths })),
  )("refuses invalid or unbounded closed-source discovery $paths", async ({ paths }) => {
    invokeMock.mockResolvedValueOnce(
      native({ documentEdits: [], documentsToOpen: paths }, { requestId: renameRequest.requestId }),
    );
    await expect(new TauriJavaIntelligenceAdapter().rename(renameRequest)).rejects.toThrow(
      TauriAdapterError,
    );
  });

  it("refuses closed-source discovery mixed with applicable edits", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          documentEdits: [{ document: request.document, edits: [{ range, newText: "changed" }] }],
          documentsToOpen: ["src/Use.java"],
        },
        { requestId: renameRequest.requestId },
      ),
    );
    await expect(new TauriJavaIntelligenceAdapter().rename(renameRequest)).rejects.toThrow(
      TauriAdapterError,
    );
  });

  it("admits a closed-source action as an unapplied proposal", async () => {
    const action = {
      title: "Create method",
      kind: "quickfix",
      edits: [],
      documentsToOpen: ["src/Use.java"],
      editPlanSha256: "1".repeat(64),
      sourceDocuments: [{ path: "src/Use.java", contentSha256: "2".repeat(64) }],
    };
    invokeMock.mockResolvedValueOnce(
      native(
        { actions: [action], isTruncated: false },
        { requestId: codeActionsRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().codeActions(codeActionsRequest),
    ).resolves.toMatchObject({ ok: true, result: { actions: [action] } });
  });

  it.each([
    { editPlanSha256: undefined },
    { editPlanSha256: "wrong" },
    { sourceDocuments: [] },
    { documentsToOpen: ["../Use.java"] },
    { documentsToOpen: ["src/Other.java"] },
    { documentsToOpen: ["src/Use.java", "src/Use.java"] },
    { sourceDocuments: [{ path: "src/Use.java", contentSha256: "wrong" }] },
    { edits: [{ range, newText: "unsafe partial edit" }] },
  ])("refuses malformed closed-source action metadata %j", async (override) => {
    const action = {
      title: "Create method",
      kind: "quickfix",
      edits: [],
      documentsToOpen: ["src/Use.java"],
      editPlanSha256: "1".repeat(64),
      sourceDocuments: [{ path: "src/Use.java", contentSha256: "2".repeat(64) }],
      ...override,
    };
    invokeMock.mockResolvedValueOnce(
      native(
        { actions: [action], isTruncated: false },
        { requestId: codeActionsRequest.requestId },
      ),
    );
    await expect(
      new TauriJavaIntelligenceAdapter().codeActions(codeActionsRequest),
    ).rejects.toThrow(TauriAdapterError);
  });

  it("requests semantic rename and normalizes versioned workspace document edits", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          documentEdits: [
            {
              document: request.document,
              edits: [
                {
                  range: { start: { line: 2, character: 2 }, end: { line: 2, character: 6 } },
                  newText: "renamedValue",
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
                  range: { start: { line: 3, character: 4 }, end: { line: 3, character: 8 } },
                  newText: "renamedValue",
                },
              ],
            },
          ],
        },
        { requestId: renameRequest.requestId },
      ),
    );

    const result = await new TauriJavaIntelligenceAdapter().rename(renameRequest);

    expect(invokeMock).toHaveBeenCalledWith("request_java_rename", {
      request: {
        workspaceId: renameRequest.workspaceId,
        generation: renameRequest.generation,
        document: renameRequest.document,
        position: renameRequest.position,
        newName: renameRequest.newName,
        requestId: renameRequest.requestId,
        cancellationId: renameRequest.cancellationId,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        documentEdits: [
          { document: request.document, edits: [{ newText: "renamedValue" }] },
          {
            document: {
              path: "src/Use.java",
              uri: "file:///workspace/project/src/Use.java",
              version: 2,
            },
            edits: [{ newText: "renamedValue" }],
          },
        ],
      },
    });
  });

  it("rejects a semantic rename edit from a different workspace URI", async () => {
    invokeMock.mockResolvedValueOnce(
      native({
        documentEdits: [
          {
            document: {
              path: "src/Use.java",
              uri: "file:///other-workspace/src/Use.java",
              version: 2,
            },
            edits: [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                newText: "renamedValue",
              },
            ],
          },
        ],
      }),
    );
    await expect(new TauriJavaIntelligenceAdapter().rename(renameRequest)).rejects.toBeInstanceOf(
      TauriAdapterError,
    );
  });

  it("rejects invalid rename names before invoking native code", async () => {
    await expect(
      new TauriJavaIntelligenceAdapter().rename({ ...renameRequest, newName: "bad\nname" }),
    ).rejects.toBeInstanceOf(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects document outlines whose child range escapes its parent", async () => {
    invokeMock.mockResolvedValueOnce(
      native(
        {
          isTruncated: false,
          symbols: [
            {
              name: "Main",
              kind: "class",
              range: {
                start: { line: 0, character: 0 },
                end: { line: 1, character: 0 },
              },
              selectionRange: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 4 },
              },
              children: [
                {
                  name: "run",
                  kind: "method",
                  range: {
                    start: { line: 1, character: 0 },
                    end: { line: 1, character: 2 },
                  },
                  selectionRange: {
                    start: { line: 1, character: 0 },
                    end: { line: 1, character: 2 },
                  },
                },
              ],
            },
          ],
        },
        { requestId: documentSymbolsRequest.requestId },
      ),
    );

    await expect(
      new TauriJavaIntelligenceAdapter().documentSymbols(documentSymbolsRequest),
    ).rejects.toThrow("Native Java semantic response was rejected");
  });

  it("maps and normalizes hover and signature-help commands", async () => {
    invokeMock
      .mockResolvedValueOnce(
        native({
          contents: [
            { format: "plaintext", value: "String value" },
            { format: "markdown", value: "`value`" },
          ],
          isTruncated: false,
          range,
        }),
      )
      .mockResolvedValueOnce(
        native({
          signatures: [
            {
              label: "print(String value)",
              documentation: { format: "markdown", value: "Prints `value`." },
              parameters: [
                {
                  label: { start: 6, end: 18 },
                  documentation: { format: "plaintext", value: "the value" },
                },
              ],
              activeParameter: 0,
            },
          ],
          activeSignature: 0,
          activeParameter: 0,
          isTruncated: false,
        }),
      );
    const positionRequest = { ...request };
    delete positionRequest.trigger;
    const adapter = new TauriJavaIntelligenceAdapter();

    const hover = await adapter.hover(positionRequest);
    const signature = await adapter.signatureHelp(positionRequest);

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "request_java_hover",
      "request_java_signature_help",
    ]);
    expect(hover).toMatchObject({
      ok: true,
      result: {
        contents: [
          { format: "plaintext", value: "String value" },
          { format: "markdown", value: "`value`" },
        ],
        range,
      },
    });
    expect(signature).toMatchObject({
      ok: true,
      result: {
        activeSignature: 0,
        activeParameter: 0,
        signatures: [
          {
            label: "print(String value)",
            activeParameter: 0,
            parameters: [{ label: { start: 6, end: 18 } }],
          },
        ],
      },
    });
  });

  it("returns provider failures and transport failures as redacted data", async () => {
    invokeMock
      .mockResolvedValueOnce(
        native(null, {
          error: {
            kind: "provider-error",
            summary: "/secret/source.java: private source",
            providerCode: -32603,
            retryable: false,
          },
        }),
      )
      .mockRejectedValueOnce(new Error("/secret/source.java private source"));
    const adapter = new TauriJavaIntelligenceAdapter();

    const providerFailure = await adapter.completion(request);
    const transportFailure = await adapter.completion(request);

    expect(providerFailure).toEqual({
      ok: false,
      requestId: "request-1",
      error: {
        kind: "provider-error",
        summary: "Java semantic provider returned an error",
        providerCode: -32603,
        retryable: false,
      },
    });
    expect(transportFailure).toEqual({
      ok: false,
      requestId: "request-1",
      error: {
        kind: "unavailable",
        summary: "Java semantic provider is unavailable",
        retryable: true,
      },
    });
    expect(JSON.stringify([providerFailure, transportFailure])).not.toContain("private source");
    expect(JSON.stringify([providerFailure, transportFailure])).not.toContain("/secret");
  });

  it("cancels by the exact ID and treats native cancellation failure as best-effort", async () => {
    invokeMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("secret native detail"));
    const adapter = new TauriJavaIntelligenceAdapter();

    await adapter.cancel("cancel-exact");
    await expect(adapter.cancel("cancel-exact")).resolves.toBeUndefined();

    expect(invokeMock.mock.calls).toEqual([
      ["cancel_java_semantic_request", { cancellationId: "cancel-exact" }],
      ["cancel_java_semantic_request", { cancellationId: "cancel-exact" }],
    ]);
  });

  it.each([
    ["absolute path", { document: { ...request.document, path: "/tmp/Main.java" } }],
    ["traversal path", { document: { ...request.document, path: "../Main.java" } }],
    ["backslash path", { document: { ...request.document, path: "src\\Main.java" } }],
    [
      "mismatched URI",
      { document: { ...request.document, uri: "file:///workspace/project/src/Other.java" } },
    ],
    [
      "traversal URI",
      {
        document: {
          ...request.document,
          uri: "file:///workspace/%2e%2e/workspace/project/src/Main.java",
        },
      },
    ],
    ["unsafe version", { document: { ...request.document, version: Number.MAX_SAFE_INTEGER + 1 } }],
    ["invalid position", { position: { line: 0, character: -1 } }],
    ["invalid request ID", { requestId: "bad\nrequest" }],
    ["invalid cancellation ID", { cancellationId: "" }],
    ["invalid trigger", { trigger: { kind: "trigger-character", character: ".." } }],
  ])("rejects %s before invoking native code", async (_label, patch) => {
    await expect(
      new TauriJavaIntelligenceAdapter().completion({
        ...request,
        ...patch,
      } as JavaCompletionRequest),
    ).rejects.toBeInstanceOf(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ["workspace", { workspaceId: "other-workspace" }],
    ["generation", { generation: 8 }],
    ["path", { path: "src/Other.java", uri: "file:///workspace/project/src/Other.java" }],
    ["URI", { uri: "file:///workspace/project/src/Other.java" }],
    ["version", { version: 5 }],
    ["request ID", { requestId: "other-request" }],
  ])("rejects stale or mismatched response %s metadata", async (_label, override) => {
    invokeMock.mockResolvedValueOnce(native({ items: [], isIncomplete: false }, override));
    await expect(new TauriJavaIntelligenceAdapter().completion(request)).rejects.toBeInstanceOf(
      TauriAdapterError,
    );
  });

  it.each([
    [
      "oversized item array",
      {
        items: Array.from({ length: 201 }, () => ({ label: "x", kind: "text" })),
        isIncomplete: true,
      },
    ],
    [
      "oversized content",
      {
        items: [
          {
            label: "x",
            kind: "text",
            documentation: { format: "markdown", value: "x".repeat(8_193) },
          },
        ],
        isIncomplete: false,
      },
    ],
    [
      "reversed range",
      {
        items: [
          {
            label: "x",
            kind: "text",
            textEdit: {
              range: { start: { line: 2, character: 1 }, end: { line: 1, character: 1 } },
              newText: "x",
            },
          },
        ],
        isIncomplete: false,
      },
    ],
    [
      "unsupported insert/replace edit",
      {
        items: [
          { label: "x", kind: "text", textEdit: { insert: range, replace: range, newText: "x" } },
        ],
        isIncomplete: false,
      },
    ],
    [
      "unauthorized additional edit",
      {
        items: [
          {
            label: "x",
            kind: "text",
            additionalTextEdits: [
              {
                document: { workspaceId: "other", ...request.document },
                edit: { range, newText: "x" },
              },
            ],
          },
        ],
        isIncomplete: false,
      },
    ],
  ])("rejects malformed completion result: %s", async (_label, result) => {
    invokeMock.mockResolvedValueOnce(native(result));
    await expect(new TauriJavaIntelligenceAdapter().completion(request)).rejects.toBeInstanceOf(
      TauriAdapterError,
    );
  });

  it("rejects malformed active indexes and oversized signature arrays", async () => {
    const positionRequest = { ...request };
    delete positionRequest.trigger;
    invokeMock
      .mockResolvedValueOnce(
        native({
          signatures: [{ label: "f()", parameters: [] }],
          activeSignature: 1,
          isTruncated: false,
        }),
      )
      .mockResolvedValueOnce(
        native({
          signatures: Array.from({ length: 33 }, () => ({ label: "f()", parameters: [] })),
          isTruncated: true,
        }),
      );
    const adapter = new TauriJavaIntelligenceAdapter();

    await expect(adapter.signatureHelp(positionRequest)).rejects.toBeInstanceOf(TauriAdapterError);
    await expect(adapter.signatureHelp(positionRequest)).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it("uses static malformed-response errors without raw response, source, or cause leakage", async () => {
    const secret = "class Secret { String password; }";
    invokeMock.mockResolvedValueOnce(native({ items: secret, isIncomplete: false }));

    let error: unknown;
    try {
      await new TauriJavaIntelligenceAdapter().completion(request);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TauriAdapterError);
    expect((error as Error).message).toContain("response was rejected");
    expect((error as Error).message).not.toContain(secret);
    expect((error as TauriAdapterError).cause).toBeUndefined();
  });
});
