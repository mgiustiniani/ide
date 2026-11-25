import { afterEach, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";
import type { JavaFormattingResponse } from "@ide/contracts";
import type { JavaEditorSemantics } from "../Editor/Editor";
import { registerJavaOnTypeFormattingProvider } from "../Editor/javaSemantics";

afterEach(() => vi.useRealTimers());

function harness() {
  let version = 17;
  const text = "class Main { int x=1; }";
  const context = { workspaceId: "ws", generation: 2,
    document: { path: "Main.java", uri: "file:///ws/Main.java", version: 1 } };
  const edit = { range: { start: { line: 0, character: 17 }, end: { line: 0, character: 18 } }, newText: " = " };
  const format = vi.fn<NonNullable<JavaEditorSemantics["formatOnType"]>>(async request => ({
    ok: true, requestId: request.requestId, result: { workspaceId: request.workspaceId,
      generation: request.generation, document: request.document, provider: "java", providerVersion: null, edits: [edit] },
  }));
  const cancel = vi.fn(async () => undefined);
  const semantics = (ready: boolean): JavaEditorSemantics => ({ context: { ...context,
    document: { ...context.document, version: ready ? 2 : 1 } }, documentText: ready ? text : "class Main {}",
    onTypeFormattingTriggers: [";"], formatOnType: format, cancel } as unknown as JavaEditorSemantics);
  let current: JavaEditorSemantics | undefined = semantics(false);
  const model = { isDisposed: () => false, getVersionId: () => version, getValue: () => text, getLanguageId: () => "java",
    uri: { toString: () => context.document.uri }, getLineCount: () => 1, getLineMaxColumn: () => text.length + 1 } as unknown as Monaco.editor.ITextModel;
  let provider!: Monaco.languages.OnTypeFormattingEditProvider;
  const registration = registerJavaOnTypeFormattingProvider({
    api: { languages: { registerOnTypeFormattingEditProvider: (_language: string, value: typeof provider) => {
      provider = value; return { dispose: vi.fn() };
    } } } as unknown as typeof Monaco,
    editor: { getModel: () => model } as unknown as Monaco.editor.IStandaloneCodeEditor,
    model, filePath: "Main.java", scope: context, triggerCharacters: [";"], getCurrentSemantics: () => current,
  });
  const listeners = new Set<() => void>();
  const token = { isCancellationRequested: false, onCancellationRequested: (callback: () => void) => {
    listeners.add(callback); return { dispose: () => listeners.delete(callback) };
  } } as unknown as Monaco.CancellationToken;
  return { format, cancel, registration,
    publish() { current = semantics(true); },
    syncing() { current = undefined; },
    withdraw() { current = current ? { ...current, onTypeFormattingTriggers: [] } : undefined; },
    edit() { version += 1; },
    cancelToken() { (token as { isCancellationRequested: boolean }).isCancellationRequested = true; listeners.forEach(callback => callback()); },
    run() { return Promise.resolve(provider.provideOnTypeFormattingEdits(model, { lineNumber: 1, column: 21 } as Monaco.Position, ";", { tabSize: 4, insertSpaces: true }, token)); },
  };
}

it("waits for the exact typed buffer and sends its newer language-service version", async () => {
  vi.useFakeTimers();
  const h = harness();
  h.syncing();
  const pending = h.run();
  expect(h.format).not.toHaveBeenCalled();
  h.publish();
  await vi.advanceTimersByTimeAsync(10);
  expect(await pending).toEqual([{ range: { startLineNumber: 1, startColumn: 18, endLineNumber: 1, endColumn: 19 }, text: " = " }]);
  expect(h.format).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ version: 2 }),
    position: { line: 0, character: 20 }, character: ";", options: { tabSize: 4, insertSpaces: true } }));
  h.registration.dispose();
});

it("refuses another edit while waiting and bounds a missing synchronization", async () => {
  vi.useFakeTimers();
  const h = harness();
  const pending = h.run(); h.edit(); h.publish();
  await vi.advanceTimersByTimeAsync(10);
  expect(await pending).toEqual([]); expect(h.format).not.toHaveBeenCalled(); h.registration.dispose();
  const unavailable = harness(); const absent = unavailable.run();
  await vi.advanceTimersByTimeAsync(500);
  expect(await absent).toEqual([]); expect(unavailable.format).not.toHaveBeenCalled(); unavailable.registration.dispose();
});

it.each(["edit", "withdraw", "cancelToken", "dispose"] as const)("rejects a late response after %s", async change => {
  const h = harness(); h.publish();
  let resolve!: (response: JavaFormattingResponse) => void;
  h.format.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = h.run();
  const request = h.format.mock.calls[0]![0];
  if (change === "dispose") h.registration.dispose(); else h[change]();
  resolve({ ok: true, requestId: request.requestId, result: { workspaceId: request.workspaceId,
    generation: request.generation, document: request.document, provider: "java", providerVersion: null,
    edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: " " }] } });
  expect(await pending).toEqual([]);
  if (change === "cancelToken" || change === "dispose") expect(h.cancel).toHaveBeenCalledWith(request.cancellationId);
  h.registration.dispose();
});
