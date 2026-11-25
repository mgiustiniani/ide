import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JavaDocumentSymbolsResponse } from "@ide/contracts";
import type { JavaEditorSemantics } from "@ide/ui";
import { useJavaTestMethodNavigation } from "./useJavaTestMethodNavigation";

const path = "app/src/test/java/pkg/Owner.java";
const text = "class Owner {\n void actual() {}\n}";
const target = { path, declaringClassName: "pkg.Owner", methodName: "actual", workspaceId: "workspace", generation: 4 };
function fixture() {
  const context = { workspaceId: "workspace", generation: 7, document: { path, uri: "file:///workspace/" + path, version: 2 } };
  const response = (): JavaDocumentSymbolsResponse => ({ ok: true, requestId: "query", result: {
    ...context, provider: "jdt-ls", providerVersion: null, isTruncated: false,
    symbols: [{ name: "Owner", kind: "class", range: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } }, selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, children: [
      { name: "actual()", kind: "method", range: { start: { line: 1, character: 1 }, end: { line: 1, character: 17 } }, selectionRange: { start: { line: 1, character: 6 }, end: { line: 1, character: 12 } } },
    ] }],
  } });
  const documentSymbols = vi.fn().mockImplementation(async () => response());
  const semantics = { context, documentSymbols, cancel: vi.fn() } as unknown as JavaEditorSemantics;
  const buffer = { text, isDirty: false, isCurrent: vi.fn(() => true) };
  const workspace = { workspaceId: "workspace", generation: 4, isSwitching: false };
  const reveal = vi.fn().mockImplementation(async (_path, _range, isCurrent) => isCurrent());
  const props = { semantics: semantics as JavaEditorSemantics | undefined, activeFilePath: path as string | null,
    source: () => buffer, getWorkspaceContext: () => workspace, reveal };
  return { context, response, documentSymbols, semantics, buffer, workspace, reveal, props };
}
function deferred() {
  let resolve!: (value: JavaDocumentSymbolsResponse) => void;
  const promise = new Promise<JavaDocumentSymbolsResponse>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
describe("test method navigation through synchronized production outlines", () => {
  it("does not guess a declaration from a runner name even if an outline has a matching overload", async () => {
    const f = fixture();
    const hook = renderHook(() => useJavaTestMethodNavigation(f.props));
    let result!: Promise<{ revealed: boolean; reason?: string }>;
    act(() => { result = hook.result.current({ ...target, declaringClassName: undefined }); });
    const response = await result;
    expect(response.revealed).toBe(false);
    expect(response.reason).toContain("runner class alone cannot identify");
    expect(f.documentSymbols).not.toHaveBeenCalled();
    expect(f.reveal).not.toHaveBeenCalled();
  });
  it("waits for didOpen and resolves the exact method without changing source", async () => {
    const f = fixture();
    const hook = renderHook((props) => useJavaTestMethodNavigation(props), { initialProps: { ...f.props, semantics: undefined as JavaEditorSemantics | undefined } });
    let result!: Promise<{ revealed: boolean }>;
    act(() => { result = hook.result.current(target); });
    expect(f.documentSymbols).not.toHaveBeenCalled();
    hook.rerender(f.props);
    await act(async () => { expect((await result).revealed).toBe(true); });
    expect(f.documentSymbols).toHaveBeenCalledWith(expect.objectContaining({ document: f.context.document, generation: 7 }));
    expect(f.reveal).toHaveBeenCalledWith(path, { start: { line: 1, character: 6 }, end: { line: 1, character: 12 } }, expect.any(Function));
    expect(f.buffer.text).toBe(text);
  });
  it.each(["dirty", "workspace", "buffer", "lifetime", "tab", "project-context"])("refuses a %s change while the outline is pending", async (change) => {
    const f = fixture(), pending = deferred(); f.documentSymbols.mockReturnValue(pending.promise);
    const hook = renderHook((props) => useJavaTestMethodNavigation(props), { initialProps: f.props });
    let projectCurrent = true;
    let result!: Promise<{ revealed: boolean }>; act(() => { result = hook.result.current({ ...target, isCurrent: () => projectCurrent }); });
    await waitFor(() => expect(f.documentSymbols).toHaveBeenCalledOnce());
    if (change === "project-context") projectCurrent = false;
    if (change === "dirty") f.buffer.isDirty = true;
    if (change === "workspace") f.workspace.generation++;
    if (change === "buffer") f.buffer.text += "// newer";
    if (change === "lifetime") f.buffer.isCurrent.mockReturnValue(false);
    if (change === "tab") hook.rerender({ ...f.props, activeFilePath: "Other.java" });
    await act(async () => { pending.resolve(f.response()); expect((await result).revealed).toBe(false); });
    expect(f.reveal).not.toHaveBeenCalled();
  });
  it.each(["truncated", "version", "uri", "provider"])("keeps the class fallback for %s outline results", async (change) => {
    const f = fixture(); const response = f.response(); if (!response.ok) throw new Error();
    if (change === "truncated") response.result.isTruncated = true;
    if (change === "version") response.result.document = { ...response.result.document, version: 99 };
    if (change === "uri") response.result.document = { ...response.result.document, uri: "file:///other" };
    f.documentSymbols.mockImplementation(async () => { if (change === "provider") throw new Error("Unavailable"); return response; });
    const hook = renderHook(() => useJavaTestMethodNavigation(f.props));
    let result!: Promise<{ revealed: boolean }>; act(() => { result = hook.result.current(target); });
    await act(async () => { expect((await result).revealed).toBe(false); });
    expect(f.reveal).not.toHaveBeenCalled();
  });
  it("rejects a replacement document and cancels its earlier query", async () => {
    const f = fixture(), pending = deferred(); f.documentSymbols.mockReturnValue(pending.promise);
    const hook = renderHook((props) => useJavaTestMethodNavigation(props), { initialProps: f.props });
    let result!: Promise<{ revealed: boolean }>; act(() => { result = hook.result.current(target); });
    await waitFor(() => expect(f.documentSymbols).toHaveBeenCalledOnce());
    hook.rerender({ ...f.props, semantics: { ...f.semantics, context: { ...f.context, document: { ...f.context.document, version: 3 } } } });
    expect((await result).revealed).toBe(false);
    await act(async () => pending.resolve(f.response()));
    expect(f.documentSymbols).toHaveBeenCalledOnce();
    expect(f.semantics.cancel).toHaveBeenCalled();
    expect(f.reveal).not.toHaveBeenCalled();
  });
  it("a new navigation retires its predecessor without accepting the late result", async () => {
    const f = fixture(), pending = deferred(); f.documentSymbols.mockReturnValueOnce(pending.promise);
    const hook = renderHook(() => useJavaTestMethodNavigation(f.props));
    let first!: Promise<{ revealed: boolean }>; act(() => { first = hook.result.current(target); });
    await waitFor(() => expect(f.documentSymbols).toHaveBeenCalledOnce());
    let second!: Promise<{ revealed: boolean }>; act(() => { second = hook.result.current(target); });
    expect((await first).revealed).toBe(false);
    await act(async () => { expect((await second).revealed).toBe(true); pending.resolve(f.response()); });
    expect(f.reveal).toHaveBeenCalledOnce();
  });
  it("retires a request if document synchronization never becomes available", async () => {
    vi.useFakeTimers(); const f = fixture();
    const hook = renderHook(() => useJavaTestMethodNavigation({ ...f.props, semantics: undefined }));
    let result!: Promise<{ revealed: boolean }>; act(() => { result = hook.result.current(target); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); expect((await result).revealed).toBe(false); });
    expect(f.reveal).not.toHaveBeenCalled();
  });
  it("cancels pending provider work on unmount without a later reveal", async () => {
    const f = fixture(), pending = deferred(); f.documentSymbols.mockReturnValue(pending.promise);
    const hook = renderHook(() => useJavaTestMethodNavigation(f.props));
    let result!: Promise<{ revealed: boolean }>; act(() => { result = hook.result.current(target); });
    await waitFor(() => expect(f.documentSymbols).toHaveBeenCalledOnce());
    hook.unmount(); expect((await result).revealed).toBe(false);
    pending.resolve(f.response());
    expect(f.semantics.cancel).toHaveBeenCalled(); expect(f.reveal).not.toHaveBeenCalled();
  });
});
