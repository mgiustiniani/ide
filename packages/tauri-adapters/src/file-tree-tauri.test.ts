import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TauriFileTreeAdapter } from './file-tree-tauri';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe('TauriFileTreeAdapter', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('derives relative node paths from absolute entry.path values', async () => {
    const adapter = new TauriFileTreeAdapter();

    invokeMock
      .mockResolvedValueOnce({
        name: 'project',
        path: '/workspace/project',
        type: 'directory',
        children: [
          {
            name: 'invented-root-name',
            path: '/workspace/project/src',
            type: 'directory',
            children: [],
          },
          {
            name: 'wrong-root-file.ts',
            path: '/workspace/project/package.json',
            type: 'file',
          },
        ],
      })
      .mockResolvedValueOnce({
        name: 'invented-root-name',
        path: '/workspace/project/src',
        type: 'directory',
        children: [
          {
            name: 'invented-child-name.ts',
            path: '/workspace/project/src/actual-child.ts',
            type: 'file',
          },
        ],
      });

    const root = await adapter.getRoot();

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_directory', {
      path: '.',
    });
    expect(root[0]).toMatchObject({
      name: 'invented-root-name',
      path: 'src',
      type: 'folder',
    });
    expect(root[1]).toMatchObject({
      name: 'wrong-root-file.ts',
      path: 'package.json',
      type: 'file',
    });
    expect(root[0].path).not.toBe('invented-root-name');
    expect(root[1].path).not.toBe('wrong-root-file.ts');

    const children = await adapter.getChildren(root[0].path);

    expect(invokeMock).toHaveBeenNthCalledWith(2, 'list_directory', {
      path: 'src',
    });
    expect(children[0]).toMatchObject({
      name: 'invented-child-name.ts',
      path: 'src/actual-child.ts',
      type: 'file',
    });
    expect(children[0].path).not.toBe('src/invented-child-name.ts');
  });
});
