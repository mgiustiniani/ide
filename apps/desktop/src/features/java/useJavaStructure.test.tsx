import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  JavaDocumentSymbol,
  JavaDocumentSymbolsRequest,
  JavaDocumentSymbolsResponse,
} from "@ide/contracts";
import {
  structureEntries,
  useJavaStructure,
  type JavaStructureDependencies,
} from "./useJavaStructure";

const text = "class Café {\n int value;\n void run() {}\n}";
const symbol: JavaDocumentSymbol = {
  name: "Café",
  kind: "class",
  range: { start: { line: 0, character: 0 }, end: { line: 3, character: 1 } },
  selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 10 } },
  children: [
    {
      name: "run()",
      kind: "method",
      range: { start: { line: 2, character: 1 }, end: { line: 2, character: 14 } },
      selectionRange: { start: { line: 2, character: 6 }, end: { line: 2, character: 9 } },
    },
  ],
};
function fixture() {
  const document = { path: "Café.java", text, lifetime: Symbol("buffer") };
  const context = {
    workspaceId: "workspace",
    generation: 17,
    document: { path: document.path, uri: "file:///workspace/Caf%C3%A9.java", version: 4 },
  };
  const response = (request: JavaDocumentSymbolsRequest): JavaDocumentSymbolsResponse => ({
    ok: true,
    requestId: request.requestId,
    result: {
      ...context,
      document: { ...context.document },
      provider: "jdt-ls",
      providerVersion: "1.63",
      symbols: structuredClone([symbol]),
      isTruncated: false,
    },
  });
  const query = vi.fn(async (request: JavaDocumentSymbolsRequest) => response(request));
  const cancel = vi.fn();
  const reveal = vi.fn(async (_path, _range, current) => current());
  let live = document,
    current = true;
  const props: JavaStructureDependencies = {
    active: true,
    workspaceId: "workspace",
    generation: 3,
    document,
    semantics: { context, documentSymbols: query, cancel },
    capable: true,
    isCurrent: () => current,
    getCurrentDocument: () => live,
    reveal,
  };
  return {
    props,
    document,
    context,
    query,
    cancel,
    reveal,
    response,
    replace: () => {
      live = { ...document, lifetime: Symbol("reopened") };
    },
    retire: () => {
      current = false;
    },
  };
}
async function queryNow() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(251);
  });
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("reads the exact current unsaved document and navigates through the guarded provider range", async () => {
  const f = fixture();
  const h = renderHook(() => useJavaStructure(f.props));
  expect(f.query).not.toHaveBeenCalled();
  await queryNow();
  expect(f.query).toHaveBeenCalledOnce();
  expect(f.query.mock.calls[0]![0]).toMatchObject({
    workspaceId: "workspace",
    generation: 17,
    document: f.context.document,
  });
  const entry = h.result.current.entries[0]!.children[0]!;
  await act(async () => {
    expect(await h.result.current.navigate(entry)).toBe(true);
  });
  expect(f.reveal).toHaveBeenCalledWith(
    f.document.path,
    symbol.children![0]!.selectionRange,
    expect.any(Function),
  );
  expect(h.result.current.partial).toBe(false);
});
it.each(["correlation", "workspace", "generation", "version", "uri", "range"])(
  "refuses mismatched %s results",
  async (mismatch) => {
    const f = fixture();
    f.query.mockImplementation(async (request) => {
      const result = f.response(request);
      if (!result.ok) throw Error();
      if (mismatch === "correlation") result.requestId = "old";
      if (mismatch === "workspace") result.result.workspaceId = "other";
      if (mismatch === "generation") result.result.generation++;
      if (mismatch === "version") result.result.document.version++;
      if (mismatch === "uri") result.result.document.uri = "file:///other";
      if (mismatch === "range") result.result.symbols[0]!.selectionRange.end.character = 99;
      return result;
    });
    const h = renderHook(() => useJavaStructure(f.props));
    await queryNow();
    expect(h.result.current.entries).toEqual([]);
    expect(h.result.current.error).toBeTruthy();
    expect(f.reveal).not.toHaveBeenCalled();
  },
);
it("reports partial provider results without claiming a complete structure", async () => {
  const f = fixture();
  f.query.mockImplementation(async (request) => {
    const response = f.response(request);
    if (response.ok) response.result.isTruncated = true;
    return response;
  });
  const h = renderHook(() => useJavaStructure(f.props));
  await queryNow();
  expect(h.result.current.partial).toBe(true);
  expect(h.result.current.entries).toHaveLength(1);
});
it("retires old entries immediately on document changes and cancels the old request", async () => {
  const f = fixture();
  const h = renderHook((props) => useJavaStructure(props), { initialProps: f.props });
  await queryNow();
  const oldEntry = h.result.current.entries[0]!;
  h.rerender({ ...f.props, document: { ...f.document, text: "//changed\n" + text } });
  expect(h.result.current.entries).toEqual([]);
  expect(f.cancel).toHaveBeenCalled();
  await act(async () => {
    expect(await h.result.current.navigate(oldEntry)).toBe(false);
  });
});
it.each(["replacement", "workspace", "teardown"])(
  "refuses retained actions after %s before another React render",
  async (change) => {
    const f = fixture();
    const h = renderHook(() => useJavaStructure(f.props));
    await queryNow();
    const navigate = h.result.current.navigate,
      entry = h.result.current.entries[0]!;
    if (change === "replacement") f.replace();
    else if (change === "workspace") f.retire();
    else h.unmount();
    await act(async () => {
      expect(await navigate(entry)).toBe(false);
    });
    expect(f.reveal).not.toHaveBeenCalled();
  },
);
it("ignores a held provider result after workspace activation changes", async () => {
  const f = fixture();
  let resolve!: (response: JavaDocumentSymbolsResponse) => void;
  f.query.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const h = renderHook((props) => useJavaStructure(props), { initialProps: f.props });
  await queryNow();
  const request = f.query.mock.calls[0]![0];
  h.rerender({ ...f.props, generation: 4, active: false });
  await act(async () => resolve(f.response(request)));
  expect(h.result.current.entries).toEqual([]);
  expect(h.result.current.busy).toBe(false);
  expect(f.cancel).toHaveBeenCalled();
});
it("does not query hidden, unsupported or mismatched documents", async () => {
  const f = fixture();
  const h = renderHook((props) => useJavaStructure(props), {
    initialProps: { ...f.props, active: false },
  });
  await queryNow();
  h.rerender({ ...f.props, active: true, capable: false });
  await queryNow();
  h.rerender({ ...f.props, active: true, document: { ...f.document, path: "Other.java" } });
  await queryNow();
  expect(f.query).not.toHaveBeenCalled();
  expect(h.result.current.available).toBe(false);
  expect(h.result.current.busy).toBe(false);
});
it("refreshes an error without retaining a previous result", async () => {
  const f = fixture();
  f.query.mockRejectedValueOnce(new Error("Provider failed"));
  const h = renderHook(() => useJavaStructure(f.props));
  await queryNow();
  expect(h.result.current.error).toBeTruthy();
  act(() => h.result.current.refresh());
  await queryNow();
  expect(h.result.current.entries).toHaveLength(1);
  expect(h.result.current.error).toBeNull();
});
it("bounds very large outlines and validates UTF-16/CRLF positions", () => {
  const leaf = {
    ...symbol.children![0]!,
    range: { start: { line: 2, character: 1 }, end: { line: 2, character: 14 } },
  };
  const result = structureEntries(
    Array.from({ length: 2001 }, () => leaf),
    text.replaceAll("\n", "\r\n"),
  );
  expect(result.entries).toHaveLength(2000);
  expect(result.truncated).toBe(true);
  expect(() =>
    structureEntries(
      [
        {
          ...leaf,
          selectionRange: { start: { line: 2, character: 20 }, end: { line: 2, character: 21 } },
        },
      ],
      text,
    ),
  ).toThrow();
});
