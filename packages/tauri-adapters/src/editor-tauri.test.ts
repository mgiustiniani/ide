import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriEditorAdapter } from './editor-tauri';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

describe('TauriEditorAdapter', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.useRealTimers();
  });

  it('normalizes the exact native read_file response', async () => {
    invokeMock.mockResolvedValueOnce({
      path: '/native/root/README.md',
      content: '# Fixture',
      language: 'markdown',
    });

    await expect(new TauriEditorAdapter().loadContent('README.md')).resolves.toEqual({
      filePath: 'README.md',
      content: '# Fixture',
      language: 'markdown',
    });
    expect(invokeMock).toHaveBeenCalledWith('read_file', { path: 'README.md' });
  });

  it('bounds a never-resolving read_file invoke and redacts source and paths', async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementationOnce(() => new Promise(() => undefined));
    const secretPath = '/home/user/private/workspace/Secret.java';
    const pending = new TauriEditorAdapter({ readTimeoutMs: 25 })
      .loadContent(secretPath)
      .catch((value: unknown) => value);

    await vi.advanceTimersByTimeAsync(25);
    const error = await pending;

    expect(error).toMatchObject({
      name: 'TauriAdapterError',
      command: 'read_file',
      message: '[tauri:read_file] File read timed out',
    });
    expect(String(error)).not.toContain(secretPath);
    expect(error).toHaveProperty('cause', undefined);
  });
});
