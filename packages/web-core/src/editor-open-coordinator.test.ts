import type { EditorContent, OpenFile } from '@ide/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { EditorPort } from './ports/editor-port';
import { createEditorStore } from './state/editor-store';
import { EditorViewModel } from './view-models/editor-view-model';
import {
  EDITOR_OPEN_ERROR_MESSAGE,
  EDITOR_OPEN_INVALID_PATH_MESSAGE,
  EditorOpenCoordinator,
  type EditorOpenState,
} from './editor-open-coordinator';

function content(filePath: string, value = `content for ${filePath}`): EditorContent {
  return { filePath, content: value, language: 'typescript' };
}

function openFile(filePath: string): OpenFile {
  return {
    filePath,
    name: filePath.split('/').pop() ?? filePath,
    language: 'typescript',
    openedAt: 1,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPort(): EditorPort {
  return {
    loadContent: vi.fn(async (filePath) => content(filePath)),
    saveContent: vi.fn(async () => []),
    closeFile: vi.fn(async () => []),
    getOpenFiles: vi.fn(async () => []),
  };
}

function createHarness(port = createPort()) {
  const store = createEditorStore();
  const editor = new EditorViewModel(store, port);
  const coordinator = new EditorOpenCoordinator(editor, store, { now: () => 1234 });
  return { coordinator, editor, port, store };
}

describe('EditorOpenCoordinator', () => {
  it('emits idle, opening, and ready for a successful load', async () => {
    const h = createHarness();
    const states: EditorOpenState[] = [];
    h.coordinator.subscribe((state) => states.push(state));

    const opening = h.coordinator.open('src/main.ts');
    expect(h.coordinator.state).toEqual({
      status: 'opening',
      intentId: 1,
      requestedPath: 'src/main.ts',
      startedAt: 1234,
    });

    await opening;

    expect(states).toEqual([
      { status: 'idle' },
      {
        status: 'opening',
        intentId: 1,
        requestedPath: 'src/main.ts',
        startedAt: 1234,
      },
      {
        status: 'ready',
        intentId: 1,
        requestedPath: 'src/main.ts',
        activePath: 'src/main.ts',
      },
    ]);
  });

  it('treats an own empty-string content buffer as ready', async () => {
    const port = createPort();
    vi.mocked(port.loadContent).mockResolvedValue(content('empty.ts', ''));
    const h = createHarness(port);

    await h.coordinator.open('empty.ts');

    expect(h.coordinator.state).toEqual({
      status: 'ready',
      intentId: 1,
      requestedPath: 'empty.ts',
      activePath: 'empty.ts',
    });
    expect(Object.prototype.hasOwnProperty.call(h.store.getState().contents, 'empty.ts')).toBe(true);
  });

  it('uses the same opening-to-ready transitions for an already-buffered file', async () => {
    const h = createHarness();
    h.store.getState().openFile(openFile('current.ts'));
    h.store.getState().setContent('current.ts', 'buffered');
    h.store.getState().openFile(openFile('buffered.ts'));
    h.store.getState().setContent('buffered.ts', 'already here');
    h.store.getState().setActiveFile('current.ts');
    const states: string[] = [];
    h.coordinator.subscribe((state) => states.push(state.status));

    await h.coordinator.open('buffered.ts');

    expect(h.port.loadContent).not.toHaveBeenCalled();
    expect(states).toEqual(['idle', 'opening', 'ready']);
    expect(h.store.getState().activeFilePath).toBe('buffered.ts');
  });

  it('publishes a static sanitized error for a rejected load', async () => {
    const port = createPort();
    vi.mocked(port.loadContent).mockRejectedValue(
      new Error('read failed: secret source text at /private/workspace/passwords.ts'),
    );
    const h = createHarness(port);

    await expect(h.coordinator.open('src/broken.ts')).resolves.toBeUndefined();

    expect(h.coordinator.state).toEqual({
      status: 'error',
      intentId: 1,
      requestedPath: 'src/broken.ts',
      safeMessage: EDITOR_OPEN_ERROR_MESSAGE,
    });
    expect(JSON.stringify(h.coordinator.state)).not.toContain('secret source text');
    expect(JSON.stringify(h.coordinator.state)).not.toContain('/private/workspace');
  });

  it('cancels a never-resolving open immediately and discards its eventual result', async () => {
    const load = deferred<EditorContent>();
    const port = createPort();
    vi.mocked(port.loadContent).mockReturnValue(load.promise);
    const h = createHarness(port);

    const pending = h.coordinator.open('slow.ts');
    h.coordinator.cancel();

    expect(h.coordinator.state).toEqual({ status: 'idle' });
    load.resolve(content('slow.ts'));
    await pending;
    expect(h.coordinator.state).toEqual({ status: 'idle' });
    expect(h.store.getState().activeFilePath).toBeNull();
    expect(h.store.getState().openFiles).toEqual([]);
  });

  it('suppresses an older completion and error during rapid A/B opens', async () => {
    const a = deferred<EditorContent>();
    const b = deferred<EditorContent>();
    const port = createPort();
    vi.mocked(port.loadContent).mockImplementation((filePath) => {
      if (filePath === 'a.ts') return a.promise;
      return b.promise;
    });
    const h = createHarness(port);

    const openA = h.coordinator.open('a.ts');
    const openB = h.coordinator.open('b.ts');
    b.resolve(content('b.ts'));
    await openB;
    a.reject(new Error('raw stale failure'));
    await openA;

    expect(h.coordinator.state).toEqual({
      status: 'ready',
      intentId: 2,
      requestedPath: 'b.ts',
      activePath: 'b.ts',
    });
    expect(h.store.getState().activeFilePath).toBe('b.ts');
  });

  it('does not let an older completion select A while newer B is pending', async () => {
    const a = deferred<EditorContent>();
    const b = deferred<EditorContent>();
    const port = createPort();
    vi.mocked(port.loadContent).mockImplementation((filePath) =>
      filePath === 'a.ts' ? a.promise : b.promise,
    );
    const h = createHarness(port);

    const openA = h.coordinator.open('a.ts');
    const openB = h.coordinator.open('b.ts');
    a.resolve(content('a.ts'));
    await openA;

    expect(h.coordinator.state).toMatchObject({ status: 'opening', requestedPath: 'b.ts' });
    expect(h.store.getState().activeFilePath).toBeNull();

    b.resolve(content('b.ts'));
    await openB;
    expect(h.store.getState().activeFilePath).toBe('b.ts');
  });

  it('reports a canonical active path returned by the provider', async () => {
    const port = createPort();
    vi.mocked(port.loadContent).mockResolvedValue(
      content('/canonical/workspace/src/file.ts', 'canonical'),
    );
    const h = createHarness(port);

    await h.coordinator.open('alias/file.ts');

    expect(h.coordinator.state).toEqual({
      status: 'ready',
      intentId: 1,
      requestedPath: 'alias/file.ts',
      activePath: '/canonical/workspace/src/file.ts',
    });
  });

  it.each([
    '',
    '   ',
    '/absolute.ts',
    'C:/absolute.ts',
    '../escape.ts',
    'src/../escape.ts',
    './src/file.ts',
    'src\\file.ts',
    'src//file.ts',
    'src/',
  ])('rejects invalid path %j without loading it', async (requestedPath) => {
    const h = createHarness();

    await h.coordinator.open(requestedPath);

    expect(h.port.loadContent).not.toHaveBeenCalled();
    expect(h.coordinator.state).toEqual({
      status: 'error',
      intentId: 1,
      requestedPath,
      safeMessage: EDITOR_OPEN_INVALID_PATH_MESSAGE,
    });
  });

  it('publishes opening synchronously before invoking the editor target', async () => {
    const storeState = { activeFilePath: null as string | null, contents: {} as Record<string, string> };
    let coordinator!: EditorOpenCoordinator;
    const openFileTarget = vi.fn(async (filePath: string) => {
      expect(coordinator.state.status).toBe('opening');
      storeState.activeFilePath = filePath;
      storeState.contents[filePath] = '';
    });
    coordinator = new EditorOpenCoordinator(
      { openFile: openFileTarget, cancelPendingOpen: vi.fn() },
      () => storeState,
    );

    const pending = coordinator.open('sync.ts');

    expect(openFileTarget).toHaveBeenCalledOnce();
    expect(coordinator.state.status).toBe('opening');
    await pending;
    expect(coordinator.state.status).toBe('ready');
  });

  it('reset invalidates work, keeps intent IDs monotonic, and unsubscribe is idempotent', async () => {
    const h = createHarness();
    await h.coordinator.open('before-reset.ts');
    const states: string[] = [];
    const unsubscribe = h.coordinator.subscribe((state) => states.push(state.status));
    unsubscribe();
    unsubscribe();

    h.coordinator.reset();
    await h.coordinator.open('after-reset.ts');

    expect(states).toEqual(['ready']);
    expect(h.coordinator.state).toMatchObject({ status: 'ready', intentId: 2 });
  });
});
