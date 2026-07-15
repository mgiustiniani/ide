import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const monacoHarness = vi.hoisted(() => ({
  shouldMount: true,
  resizeCallbacks: new Set<() => void>(),
  intersectionCallbacks: new Set<(visible: boolean) => void>(),
  layout: vi.fn(),
  focus: vi.fn(),
  setPosition: vi.fn(),
  revealPositionInCenter: vi.fn(),
  validatePosition: vi.fn((position: { lineNumber: number; column: number }) => position),
  setModelMarkers: vi.fn(),
  models: new Map<string, { content: string; getLineCount: () => number; getLineMaxColumn: (line: number) => number; validatePosition: (position: { lineNumber: number; column: number }) => { lineNumber: number; column: number } }>(),
  activeModel: null as null | { content: string; getLineCount: () => number; getLineMaxColumn: (line: number) => number; validatePosition: (position: { lineNumber: number; column: number }) => { lineNumber: number; column: number } },
}));

vi.mock('../../monaco/bootstrap', () => ({ configureLocalMonaco: vi.fn() }));
vi.mock('@monaco-editor/react', async () => {
  const ReactModule = await import('react');
  return {
    default: (props: Record<string, unknown>) => {
      const path = String(props.path);
      let model = monacoHarness.models.get(path);
      if (!model) {
        model = {
          content: String(props.value ?? ''),
          getLineCount: () => Math.max(1, model!.content.split('\n').length),
          getLineMaxColumn: (line: number) => (model!.content.split('\n')[line - 1]?.length ?? 0) + 1,
          validatePosition: monacoHarness.validatePosition,
        };
        monacoHarness.models.set(path, model);
      }
      model.content = String(props.value ?? '');
      monacoHarness.activeModel = model;
      ReactModule.useEffect(() => {
        if (monacoHarness.shouldMount) {
          (props.onMount as ((editor: unknown, api: unknown) => void) | undefined)?.({
            layout: monacoHarness.layout,
            focus: monacoHarness.focus,
            setPosition: monacoHarness.setPosition,
            revealPositionInCenter: monacoHarness.revealPositionInCenter,
            getModel: () => monacoHarness.activeModel,
          }, { editor: { setModelMarkers: monacoHarness.setModelMarkers } });
        }
      }, []);
      return ReactModule.createElement('textarea', {
        'data-testid': 'monaco-mock',
        'data-language': props.language,
        'data-path': props.path,
        value: props.value as string,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          (props.onChange as ((value: string) => void) | undefined)?.(event.currentTarget.value),
      });
    },
    loader: { config: vi.fn() },
  };
});

class MockIntersectionObserver {
  private readonly callback: (visible: boolean) => void;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    monacoHarness.intersectionCallbacks.add(this.callback);
  }
  observe(): void {}
  disconnect(): void { monacoHarness.intersectionCallbacks.delete(this.callback); }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  unobserve(): void {}
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
}

class MockResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    monacoHarness.resizeCallbacks.add(callback);
  }
  observe(): void {}
  disconnect(): void { monacoHarness.resizeCallbacks.delete(this.callback); }
}

vi.mocked(ResizeObserver).mockImplementation((callback) =>
  new MockResizeObserver(() => callback([], {} as ResizeObserver)) as unknown as ResizeObserver
);

import { Editor } from '../Editor/Editor';
import { getMonacoLanguage, getMonacoModelPath } from '../Editor/monacoLanguage';
import { configureLocalMonaco } from '../../monaco/bootstrap';

async function giveMonacoHostPositiveSize(width = 900, height = 600): Promise<void> {
  const host = screen.getByTestId('editor-monaco-layer');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: height });
  host.getBoundingClientRect = () => ({
    bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0,
    toJSON: () => ({}),
  });
  await act(async () => {
    monacoHarness.resizeCallbacks.forEach((callback) => callback());
    await Promise.resolve();
  });
}

const baseProps = { content: 'private source', language: 'typescript' as const, onChange: vi.fn(), filePath: 'src/private.ts' };

function expectNoEditor(): void {
  expect(screen.queryByTestId('editor-renderer-stack')).toBeNull();
  expect(screen.queryByTestId('editor-monaco-layer')).toBeNull();
  expect(screen.queryByTestId('monaco-mock')).toBeNull();
  expect(screen.queryByTestId('native-code-editor')).toBeNull();
}

describe('Editor', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    monacoHarness.shouldMount = true;
    monacoHarness.resizeCallbacks.clear();
    monacoHarness.intersectionCallbacks.clear();
    monacoHarness.layout.mockClear();
    monacoHarness.focus.mockClear();
    monacoHarness.setPosition.mockClear();
    monacoHarness.revealPositionInCenter.mockClear();
    monacoHarness.setModelMarkers.mockClear();
    monacoHarness.models.clear();
    monacoHarness.activeModel = null;
    vi.unstubAllGlobals();
  });

  it('shows the fileless welcome without initializing any editor', () => {
    vi.mocked(configureLocalMonaco).mockClear();
    render(<Editor {...baseProps} content="" filePath="" />);
    expect(screen.getByRole('heading', { name: 'No document open' })).toBeDefined();
    expectNoEditor();
    expect(configureLocalMonaco).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Monaco' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Native' })).toBeNull();
  });

  it('submits a trimmed valid filename with Enter', async () => {
    const onCreateNewFile = vi.fn();
    render(<Editor {...baseProps} content="" filePath="" onCreateNewFile={onCreateNewFile} createFileTargetLabel="Project root" />);
    const input = screen.getByLabelText('Create a new file');
    fireEvent.change(input, { target: { value: '  index.ts  ' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onCreateNewFile).toHaveBeenCalledWith('index.ts'));
    expect(screen.getByText('Location: Project root')).toBeDefined();
  });

  it.each(['', '.', '..', 'src/file.ts', 'src\\file.ts', `bad${String.fromCharCode(1)}name`])('blocks invalid filename %j', async (name) => {
    const onCreateNewFile = vi.fn();
    render(<Editor {...baseProps} content="" filePath="" onCreateNewFile={onCreateNewFile} />);
    const input = screen.getByLabelText('Create a new file');
    fireEvent.change(input, { target: { value: name } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(onCreateNewFile).not.toHaveBeenCalled();
    cleanup();
  });

  it('shows a neutral loading placeholder with filename, tabs, and no source or editor', () => {
    render(<Editor {...baseProps} isLoading tabs={[{ filePath: 'src/private.ts', isActive: true, isDirty: false }]} />);
    const placeholder = screen.getByTestId('editor-opening-placeholder');
    expect(placeholder.textContent).toContain('private.ts');
    expect(placeholder.textContent).toContain('Opening editor…');
    expect(placeholder.textContent).not.toContain(baseProps.content);
    expect(screen.getByRole('tablist')).toBeDefined();
    expectNoEditor();
  });

  it('keeps source out of the cold-load placeholder and replaces it when Monaco is ready', async () => {
    render(<Editor {...baseProps} />);
    const placeholder = screen.getByTestId('editor-opening-placeholder');
    expect(placeholder.textContent).not.toContain(baseProps.content);
    expect(screen.queryByTestId('native-code-editor')).toBeNull();
    await giveMonacoHostPositiveSize(840, 520);
    expect(await screen.findByTestId('monaco-mock')).toBeDefined();
    expect(screen.queryByTestId('editor-opening-placeholder')).toBeNull();
    expect(monacoHarness.layout).toHaveBeenCalledWith({ width: 840, height: 520 });
  });

  it('activates Monaco when the measurable pending host is visually transparent', async () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if ((element as HTMLElement).classList?.contains('editor-monaco-layer')) {
        return { display: 'block', opacity: '0', visibility: 'hidden' } as CSSStyleDeclaration;
      }
      return nativeGetComputedStyle(element);
    });

    render(<Editor {...baseProps} />);
    expect(screen.getByTestId('editor-opening-placeholder').textContent).not.toContain(baseProps.content);
    await giveMonacoHostPositiveSize(760, 440);

    expect(await screen.findByTestId('monaco-mock')).toBeDefined();
    expect(screen.getByTestId('editor-monaco-layer').classList.contains('editor-monaco-layer--ready')).toBe(true);
  });

  it('does not activate Monaco inside a display-hidden ancestor', async () => {
    let ancestorHidden = true;
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (ancestorHidden && (element as HTMLElement).classList?.contains('editor-content')) {
        return { display: 'none', visibility: 'visible' } as CSSStyleDeclaration;
      }
      return nativeGetComputedStyle(element);
    });

    render(<Editor {...baseProps} />);
    await giveMonacoHostPositiveSize(760, 440);
    expect(screen.queryByTestId('monaco-mock')).toBeNull();

    ancestorHidden = false;
    await act(async () => {
      monacoHarness.resizeCallbacks.forEach((callback) => callback());
      await Promise.resolve();
    });
    expect(await screen.findByTestId('monaco-mock')).toBeDefined();
  });

  it('handles a same-file loading transition with the inert placeholder', async () => {
    const { rerender } = render(<Editor {...baseProps} />);
    await giveMonacoHostPositiveSize();
    expect(await screen.findByTestId('monaco-mock')).toBeDefined();

    rerender(<Editor {...baseProps} isLoading />);
    expect(screen.getByTestId('editor-opening-placeholder').textContent).not.toContain(baseProps.content);
    expectNoEditor();

    rerender(<Editor {...baseProps} content="new private source" />);
    expect(screen.getByTestId('editor-opening-placeholder').textContent).not.toContain('new private source');
    await giveMonacoHostPositiveSize(700, 400);
    expect(await screen.findByTestId('monaco-mock')).toBeDefined();
  });

  it('keeps Monaco pending while hidden and recovers on host visibility', async () => {
    vi.useFakeTimers();
    render(<Editor {...baseProps} />);
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(screen.getByTestId('editor-opening-placeholder')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Retry Monaco' })).toBeNull();
    await giveMonacoHostPositiveSize(700, 400);
    expect(screen.getByTestId('monaco-mock')).toBeDefined();
  });

  it('remeasures on visibility and focus and cleans lifecycle observers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    let visibility: DocumentVisibilityState = 'hidden';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const { unmount } = render(<Editor {...baseProps} />);
    const host = screen.getByTestId('editor-monaco-layer');
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 700 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 400 });
    host.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 700, top: 0, width: 700, x: 0, y: 0, toJSON: () => ({}) });
    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      vi.runAllTimers();
    });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('monaco-mock')).toBeDefined();
    unmount();
    expect(monacoHarness.resizeCallbacks.size).toBe(0);
    expect(monacoHarness.intersectionCallbacks.size).toBe(0);
  });

  it('propagates Monaco edits and preserves model language mapping', async () => {
    const onChange = vi.fn();
    render(<Editor {...baseProps} onChange={onChange} />);
    await giveMonacoHostPositiveSize();
    fireEvent.change(screen.getByTestId('monaco-mock'), { target: { value: 'new' } });
    expect(onChange).toHaveBeenCalledWith('new');
    expect(getMonacoModelPath('src\\Main.java')).toBe('file:///src/Main.java');
    expect(getMonacoLanguage('java', 'Main.java')).toBe('java');
    expect(getMonacoLanguage('unknown' as never, 'LICENSE')).toBe('plaintext');
  });

  it('preserves reveal requests and diagnostic markers', async () => {
    render(<Editor
      {...baseProps}
      filePath="src/Main.java"
      language="java"
      content={'abc\ndef'}
      revealRequest={{ filePath: 'src/Main.java', line: 2, column: 2, requestId: 1 }}
      documentIdentity={{ workspaceId: 'workspace-1', path: 'src/Main.java', uri: 'file:///src/Main.java' }}
      diagnosticOwner="jdtls"
      diagnostics={[{ severity: 'error', message: 'Broken', range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } } }]}
    />);
    await giveMonacoHostPositiveSize();
    expect(monacoHarness.setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 2 });
    expect(monacoHarness.revealPositionInCenter).toHaveBeenCalled();
    expect(monacoHarness.setModelMarkers).toHaveBeenCalledWith(
      monacoHarness.models.get('file:///src/Main.java'),
      'jdtls',
      [expect.objectContaining({ severity: 8, startLineNumber: 1, startColumn: 2 })]
    );
  });

  it('does not repeat reveal or marker registration for equivalent request and document identities', async () => {
    const diagnostics = [{
      severity: 'error' as const,
      message: 'Broken',
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
    }];
    const editorProps = {
      ...baseProps,
      filePath: 'src/Main.java',
      language: 'java' as const,
      content: 'abc\ndef',
      diagnosticOwner: 'jdtls',
      diagnostics,
    };
    const { rerender } = render(<Editor
      {...editorProps}
      revealRequest={{ filePath: 'src/Main.java', line: 2, column: 2, requestId: 1 }}
      documentIdentity={{ workspaceId: 'workspace-1', path: 'src/Main.java', uri: 'file:///src/Main.java' }}
    />);
    await giveMonacoHostPositiveSize();

    rerender(<Editor
      {...editorProps}
      revealRequest={{ filePath: 'src/Main.java', line: 2, column: 2, requestId: 1 }}
      documentIdentity={{ workspaceId: 'workspace-1', path: 'src/Main.java', uri: 'file:///src/Main.java' }}
    />);

    expect(monacoHarness.setPosition).toHaveBeenCalledTimes(1);
    expect(monacoHarness.setModelMarkers).toHaveBeenCalledTimes(1);

    rerender(<Editor
      {...editorProps}
      revealRequest={{ filePath: 'src/Main.java', line: 1, column: 3, requestId: 2 }}
      documentIdentity={{ workspaceId: 'workspace-1', path: 'src/Main.java', uri: 'file:///src/Main.java' }}
    />);

    expect(monacoHarness.setPosition).toHaveBeenCalledTimes(2);
    expect(monacoHarness.setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 3 });
    expect(monacoHarness.setModelMarkers).toHaveBeenCalledTimes(1);
  });
});
