import type {
  JavaCompletionResponse,
  JavaCompletionResult,
  JavaHoverResult,
  JavaSignatureHelpResult,
} from '@ide/contracts';
import { describe, expect, it, vi } from 'vitest';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import type { JavaEditorSemantics } from '../Editor/Editor';
import { registerJavaSemanticProviders } from '../Editor/javaSemantics';
import { getMonacoLanguage } from '../Editor/monacoLanguage';
import { configureLocalMonaco } from '../../monaco/bootstrap';

function success<T>(requestId: string, result: T) {
  return { ok: true as const, requestId, result };
}

const documentTarget = { path: 'src/Main.java', uri: 'file:///src/Main.java', version: 7 };
const metadata = { workspaceId: 'workspace-1', generation: 3, document: documentTarget, provider: 'java', providerVersion: null };

function harness() {
  const providers: Record<string, unknown> = {};
  const disposed = { completion: false, hover: false, signature: false };
  const languages = {
    registerCompletionItemProvider: vi.fn((_language: string, provider: unknown) => {
      providers.completion = provider;
      return { dispose: () => { disposed.completion = true; } };
    }),
    registerHoverProvider: vi.fn((_language: string, provider: unknown) => {
      providers.hover = provider;
      return { dispose: () => { disposed.hover = true; } };
    }),
    registerSignatureHelpProvider: vi.fn((_language: string, provider: unknown) => {
      providers.signature = provider;
      return { dispose: () => { disposed.signature = true; } };
    }),
  };
  const model = {
    uri: { toString: () => documentTarget.uri },
    getLineCount: () => 2,
    getLineMaxColumn: (line: number) => line === 1 ? 13 : 8,
  } as Monaco.editor.ITextModel;
  const completion = vi.fn<JavaEditorSemantics['completion']>();
  const hover = vi.fn<JavaEditorSemantics['hover']>();
  const signatureHelp = vi.fn<JavaEditorSemantics['signatureHelp']>();
  const cancel = vi.fn<JavaEditorSemantics['cancel']>();
  const semantics: JavaEditorSemantics = {
    context: { workspaceId: 'workspace-1', generation: 3, document: documentTarget },
    completion, hover, signatureHelp, cancel,
  };
  let current: JavaEditorSemantics | undefined = semantics;
  const registration = registerJavaSemanticProviders({
    api: { languages } as unknown as typeof Monaco,
    model,
    filePath: documentTarget.path,
    semantics,
    getCurrentSemantics: () => current,
  });
  const tokenListeners = new Set<() => void>();
  const token = {
    isCancellationRequested: false,
    onCancellationRequested(listener: () => void) {
      tokenListeners.add(listener);
      return { dispose: () => { tokenListeners.delete(listener); } };
    },
  } as unknown as Monaco.CancellationToken;
  return {
    providers: providers as {
      completion: Monaco.languages.CompletionItemProvider;
      hover: Monaco.languages.HoverProvider;
      signature: Monaco.languages.SignatureHelpProvider;
    },
    disposed, languages, model, semantics, completion, hover, signatureHelp, cancel, registration, token,
    cancelToken() {
      (token as { isCancellationRequested: boolean }).isCancellationRequested = true;
      tokenListeners.forEach((listener) => listener());
    },
    setCurrent(value: JavaEditorSemantics | undefined) { current = value; },
  };
}

const position = { lineNumber: 2, column: 4 } as Monaco.Position;

describe('Java Monaco semantics', () => {
  it('bundles the Java tokenizer and registers semantic providers only for Java', () => {
    const h = harness();
    expect(getMonacoLanguage('plaintext', 'src/Main.java')).toBe('java');
    expect(configureLocalMonaco().languages.getLanguages().some(({ id }) => id === 'java')).toBe(true);
    expect(h.languages.registerCompletionItemProvider).toHaveBeenCalledWith('java', h.providers.completion);
    expect(h.languages.registerHoverProvider).toHaveBeenCalledWith('java', h.providers.hover);
    expect(h.languages.registerSignatureHelpProvider).toHaveBeenCalledWith('java', h.providers.signature);
    expect((h.providers.signature.signatureHelpTriggerCharacters)).toEqual(['(', ',']);
  });

  it('sends exact zero-based completion context and safely maps bounded items', async () => {
    const h = harness();
    h.completion.mockImplementation(async (request) => success(request.requestId, {
      ...metadata,
      isIncomplete: true,
      items: [{
        label: 'println', kind: 'method', detail: 'detail', sortText: '1', filterText: 'print',
        insertText: 'ignored', textEdit: { range: { start: { line: 1, character: 1 }, end: { line: 1, character: 3 } }, newText: 'println()' },
        additionalTextEdits: [{ document: { workspaceId: 'workspace-1', ...documentTarget }, edit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'unsafe' } }],
        documentation: { format: 'markdown', value: '**docs**' }, commitCharacters: [';'], deprecated: true, preselect: true,
      }, { label: 'snippet', kind: 'snippet', insertText: '${1:value}' }],
    } satisfies JavaCompletionResult));

    const result = await h.providers.completion.provideCompletionItems(
      h.model, position, { triggerKind: 1, triggerCharacter: '.' }, h.token,
    ) as Monaco.languages.CompletionList;
    const request = h.completion.mock.calls[0]![0];
    expect(request).toMatchObject({
      workspaceId: 'workspace-1', generation: 3, document: documentTarget,
      position: { line: 1, character: 3 }, trigger: { kind: 'trigger-character', character: '.' },
    });
    expect(request.requestId).toMatch(/^java-ui-request-/);
    expect(request.cancellationId).toMatch(/^java-ui-cancel-/);
    expect(request.requestId.length).toBeLessThan(80);
    expect(result.incomplete).toBe(true);
    expect(result.suggestions[0]).toMatchObject({
      label: 'println', kind: 1, detail: 'detail', insertText: 'println()',
      range: { startLineNumber: 2, startColumn: 2, endLineNumber: 2, endColumn: 4 },
      documentation: { value: '**docs**', isTrusted: false, supportHtml: false },
      tags: [1], preselect: true, commitCharacters: [';'],
    });
    expect(result.suggestions[0]).not.toHaveProperty('additionalTextEdits');
    expect(result.suggestions[0]).not.toHaveProperty('command');
    expect(result.suggestions[0]).not.toHaveProperty('insertTextRules');
    expect(result.suggestions[1]).toMatchObject({ insertText: '${1:value}', insertTextRules: 4 });
  });

  it('maps hover and signatures with untrusted display content and disposal', async () => {
    const h = harness();
    h.hover.mockImplementation(async (request) => success(request.requestId, {
      ...metadata, isTruncated: false,
      contents: [{ format: 'plaintext', value: 'String' }, { format: 'markdown', value: '<b>unsafe</b>' }],
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
    } satisfies JavaHoverResult));
    h.signatureHelp.mockImplementation(async (request) => success(request.requestId, {
      ...metadata, isTruncated: false, activeSignature: 0, activeParameter: 1,
      signatures: [{ label: 'call(String, int)', documentation: { format: 'markdown', value: '**call**' }, parameters: [
        { label: 'String' }, { label: { start: 13, end: 16 }, documentation: { format: 'plaintext', value: 'count' } },
      ] }],
    } satisfies JavaSignatureHelpResult));

    const hover = await h.providers.hover.provideHover(h.model, position, h.token) as Monaco.languages.Hover;
    expect(hover.contents).toEqual([
      { value: 'String', isTrusted: false, supportHtml: false },
      { value: '<b>unsafe</b>', isTrusted: false, supportHtml: false },
    ]);
    const signature = await h.providers.signature.provideSignatureHelp(h.model, position, h.token, {
      triggerKind: 1, isRetrigger: false,
    }) as Monaco.languages.SignatureHelpResult;
    expect(signature.value).toMatchObject({ activeSignature: 0, activeParameter: 1, signatures: [{
      label: 'call(String, int)', parameters: [{ label: 'String' }, { label: [13, 16] }],
    }] });
    signature.dispose();
    h.registration.dispose();
    expect(h.disposed).toEqual({ completion: true, hover: true, signature: true });
  });

  it('cancels best effort and suppresses late, stale, wrong-model, and contextless work', async () => {
    const h = harness();
    let resolve!: (value: JavaCompletionResponse) => void;
    h.completion.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = h.providers.completion.provideCompletionItems(
      h.model, position, { triggerKind: 0 }, h.token,
    ) as Promise<Monaco.languages.CompletionList>;
    const request = h.completion.mock.calls[0]![0];
    h.cancelToken();
    expect(h.cancel).toHaveBeenCalledWith(request.cancellationId);
    resolve(success(request.requestId, { ...metadata, items: [], isIncomplete: false }));
    expect(await pending).toEqual({ suggestions: [] });

    const otherModel = { ...h.model, uri: { toString: () => 'file:///src/Other.java' } } as Monaco.editor.ITextModel;
    const freshToken = { ...h.token, isCancellationRequested: false } as Monaco.CancellationToken;
    await h.providers.hover.provideHover(otherModel, position, freshToken);
    expect(h.hover).not.toHaveBeenCalled();

    h.setCurrent(undefined);
    await h.providers.hover.provideHover(h.model, position, freshToken);
    expect(h.hover).not.toHaveBeenCalled();
  });
});
