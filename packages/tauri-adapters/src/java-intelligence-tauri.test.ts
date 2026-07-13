import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JavaCompletionRequest } from '@ide/contracts';

import { TauriAdapterError } from './errors';
import { TauriJavaIntelligenceAdapter } from './java-intelligence-tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const request: JavaCompletionRequest = {
  workspaceId: 'workspace-1',
  generation: 7,
  document: {
    path: 'src/Main.java',
    uri: 'file:///workspace/project/src/Main.java',
    version: 4,
  },
  position: { line: 2, character: 6 },
  requestId: 'request-1',
  cancellationId: 'cancel-1',
  trigger: { kind: 'trigger-character', character: '.' },
};

function native(result: unknown, overrides: Record<string, unknown> = {}) {
  return {
    provider: 'jdtls',
    providerVersion: '1.42.0',
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

describe('TauriJavaIntelligenceAdapter', () => {
  beforeEach(() => invokeMock.mockReset());

  it('sends the exact completion payload without source text', async () => {
    invokeMock.mockResolvedValueOnce(native({ items: [], isIncomplete: false }));
    const runtimeRequest = { ...request, source: 'private source' } as JavaCompletionRequest;

    await new TauriJavaIntelligenceAdapter().completion(runtimeRequest);

    expect(invokeMock).toHaveBeenCalledWith('request_java_completion', { request: {
      workspaceId: 'workspace-1',
      generation: 7,
      document: {
        path: 'src/Main.java',
        uri: 'file:///workspace/project/src/Main.java',
        version: 4,
      },
      position: { line: 2, character: 6 },
      requestId: 'request-1',
      cancellationId: 'cancel-1',
      trigger: { kind: 'trigger-character', character: '.' },
    } });
    expect(JSON.stringify(invokeMock.mock.calls)).not.toContain('private source');
  });

  it('normalizes bounded completion fields, edits, and metadata', async () => {
    invokeMock.mockResolvedValueOnce(native({
      isIncomplete: true,
      items: [{
        label: 'println', kind: 'method', detail: 'void println(String)',
        documentation: { format: 'markdown', value: '**Untrusted**' },
        sortText: '001', filterText: 'println', insertText: 'println($1)',
        textEdit: { range, newText: 'println()' },
        additionalTextEdits: [{
          document: { workspaceId: request.workspaceId, ...request.document },
          edit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'import java.io.*;\n' },
        }],
        commitCharacters: [';', ')'], deprecated: false, preselect: true,
      }],
    }));

    const response = await new TauriJavaIntelligenceAdapter().completion(request);

    expect(response).toEqual({
      ok: true,
      requestId: 'request-1',
      result: {
        provider: 'jdt-ls', providerVersion: '1.42.0', workspaceId: 'workspace-1', generation: 7,
        document: request.document, isIncomplete: true,
        items: [expect.objectContaining({
          label: 'println', kind: 'method',
          documentation: { format: 'markdown', value: '**Untrusted**' },
          textEdit: { range, newText: 'println()' },
          additionalTextEdits: [expect.objectContaining({ document: { workspaceId: request.workspaceId, ...request.document } })],
          commitCharacters: [';', ')'], deprecated: false, preselect: true,
        })],
      },
    });
  });

  it('maps and normalizes hover and signature-help commands', async () => {
    invokeMock
      .mockResolvedValueOnce(native({
        contents: [{ format: 'plaintext', value: 'String value' }, { format: 'markdown', value: '`value`' }],
        isTruncated: false, range,
      }))
      .mockResolvedValueOnce(native({
        signatures: [{
          label: 'print(String value)',
          documentation: { format: 'markdown', value: 'Prints `value`.' },
          parameters: [{ label: { start: 6, end: 18 }, documentation: { format: 'plaintext', value: 'the value' } }],
          activeParameter: 0,
        }],
        activeSignature: 0, activeParameter: 0, isTruncated: false,
      }));
    const positionRequest = { ...request };
    delete positionRequest.trigger;
    const adapter = new TauriJavaIntelligenceAdapter();

    const hover = await adapter.hover(positionRequest);
    const signature = await adapter.signatureHelp(positionRequest);

    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      'request_java_hover', 'request_java_signature_help',
    ]);
    expect(hover).toMatchObject({ ok: true, result: { contents: [
      { format: 'plaintext', value: 'String value' }, { format: 'markdown', value: '`value`' },
    ], range } });
    expect(signature).toMatchObject({ ok: true, result: {
      activeSignature: 0, activeParameter: 0,
      signatures: [{ label: 'print(String value)', activeParameter: 0, parameters: [{ label: { start: 6, end: 18 } }] }],
    } });
  });

  it('returns provider failures and transport failures as redacted data', async () => {
    invokeMock
      .mockResolvedValueOnce(native(null, {
        error: { kind: 'provider-error', summary: '/secret/source.java: private source', providerCode: -32603, retryable: false },
      }))
      .mockRejectedValueOnce(new Error('/secret/source.java private source'));
    const adapter = new TauriJavaIntelligenceAdapter();

    const providerFailure = await adapter.completion(request);
    const transportFailure = await adapter.completion(request);

    expect(providerFailure).toEqual({
      ok: false, requestId: 'request-1',
      error: { kind: 'provider-error', summary: 'Java semantic provider returned an error', providerCode: -32603, retryable: false },
    });
    expect(transportFailure).toEqual({
      ok: false, requestId: 'request-1',
      error: { kind: 'unavailable', summary: 'Java semantic provider is unavailable', retryable: true },
    });
    expect(JSON.stringify([providerFailure, transportFailure])).not.toContain('private source');
    expect(JSON.stringify([providerFailure, transportFailure])).not.toContain('/secret');
  });

  it('cancels by the exact ID and treats native cancellation failure as best-effort', async () => {
    invokeMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('secret native detail'));
    const adapter = new TauriJavaIntelligenceAdapter();

    await adapter.cancel('cancel-exact');
    await expect(adapter.cancel('cancel-exact')).resolves.toBeUndefined();

    expect(invokeMock.mock.calls).toEqual([
      ['cancel_java_semantic_request', { cancellationId: 'cancel-exact' }],
      ['cancel_java_semantic_request', { cancellationId: 'cancel-exact' }],
    ]);
  });

  it.each([
    ['absolute path', { document: { ...request.document, path: '/tmp/Main.java' } }],
    ['traversal path', { document: { ...request.document, path: '../Main.java' } }],
    ['backslash path', { document: { ...request.document, path: 'src\\Main.java' } }],
    ['mismatched URI', { document: { ...request.document, uri: 'file:///workspace/project/src/Other.java' } }],
    ['traversal URI', { document: { ...request.document, uri: 'file:///workspace/%2e%2e/workspace/project/src/Main.java' } }],
    ['unsafe version', { document: { ...request.document, version: Number.MAX_SAFE_INTEGER + 1 } }],
    ['invalid position', { position: { line: 0, character: -1 } }],
    ['invalid request ID', { requestId: 'bad\nrequest' }],
    ['invalid cancellation ID', { cancellationId: '' }],
    ['invalid trigger', { trigger: { kind: 'trigger-character', character: '..' } }],
  ])('rejects %s before invoking native code', async (_label, patch) => {
    await expect(new TauriJavaIntelligenceAdapter().completion({ ...request, ...patch } as JavaCompletionRequest))
      .rejects.toBeInstanceOf(TauriAdapterError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each([
    ['workspace', { workspaceId: 'other-workspace' }],
    ['generation', { generation: 8 }],
    ['path', { path: 'src/Other.java', uri: 'file:///workspace/project/src/Other.java' }],
    ['URI', { uri: 'file:///workspace/project/src/Other.java' }],
    ['version', { version: 5 }],
    ['request ID', { requestId: 'other-request' }],
  ])('rejects stale or mismatched response %s metadata', async (_label, override) => {
    invokeMock.mockResolvedValueOnce(native({ items: [], isIncomplete: false }, override));
    await expect(new TauriJavaIntelligenceAdapter().completion(request)).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it.each([
    ['oversized item array', { items: Array.from({ length: 201 }, () => ({ label: 'x', kind: 'text' })), isIncomplete: true }],
    ['oversized content', { items: [{ label: 'x', kind: 'text', documentation: { format: 'markdown', value: 'x'.repeat(8_193) } }], isIncomplete: false }],
    ['reversed range', { items: [{ label: 'x', kind: 'text', textEdit: { range: { start: { line: 2, character: 1 }, end: { line: 1, character: 1 } }, newText: 'x' } }], isIncomplete: false }],
    ['unsupported insert/replace edit', { items: [{ label: 'x', kind: 'text', textEdit: { insert: range, replace: range, newText: 'x' } }], isIncomplete: false }],
    ['unauthorized additional edit', { items: [{ label: 'x', kind: 'text', additionalTextEdits: [{ document: { workspaceId: 'other', ...request.document }, edit: { range, newText: 'x' } }] }], isIncomplete: false }],
  ])('rejects malformed completion result: %s', async (_label, result) => {
    invokeMock.mockResolvedValueOnce(native(result));
    await expect(new TauriJavaIntelligenceAdapter().completion(request)).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it('rejects malformed active indexes and oversized signature arrays', async () => {
    const positionRequest = { ...request };
    delete positionRequest.trigger;
    invokeMock
      .mockResolvedValueOnce(native({ signatures: [{ label: 'f()', parameters: [] }], activeSignature: 1, isTruncated: false }))
      .mockResolvedValueOnce(native({ signatures: Array.from({ length: 33 }, () => ({ label: 'f()', parameters: [] })), isTruncated: true }));
    const adapter = new TauriJavaIntelligenceAdapter();

    await expect(adapter.signatureHelp(positionRequest)).rejects.toBeInstanceOf(TauriAdapterError);
    await expect(adapter.signatureHelp(positionRequest)).rejects.toBeInstanceOf(TauriAdapterError);
  });

  it('uses static malformed-response errors without raw response, source, or cause leakage', async () => {
    const secret = 'class Secret { String password; }';
    invokeMock.mockResolvedValueOnce(native({ items: secret, isIncomplete: false }));

    let error: unknown;
    try { await new TauriJavaIntelligenceAdapter().completion(request); } catch (caught) { error = caught; }

    expect(error).toBeInstanceOf(TauriAdapterError);
    expect((error as Error).message).toContain('response was rejected');
    expect((error as Error).message).not.toContain(secret);
    expect((error as TauriAdapterError).cause).toBeUndefined();
  });
});
