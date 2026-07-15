import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import React, { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { configureLocalMonaco } from '../../monaco/bootstrap';
import type { LanguageDiagnostic } from '../diagnostics';
import type { EditorProps, JavaEditorSemantics } from './Editor';
import { registerJavaSemanticProviders } from './javaSemantics';
import { getMonacoLanguage, getMonacoModelPath } from './monacoLanguage';

export { getMonacoLanguage, getMonacoModelPath } from './monacoLanguage';

configureLocalMonaco();

type MonacoCodeEditorProps = Pick<EditorProps, 'content' | 'diagnosticOwner' | 'diagnostics' | 'documentIdentity' | 'filePath' | 'javaSemantics' | 'language' | 'onChange' | 'revealRequest'> & {
  attempt: number;
  initialSize: { width: number; height: number };
  isRenderable: boolean;
  onFailure: (reason: string) => void;
  onReadyChange: (ready: boolean) => void;
};

type ErrorBoundaryProps = {
  children: React.ReactNode;
  onError: (error: Error) => void;
  resetKey: number;
};

type ErrorBoundaryState = { error: Error | null };

class MonacoErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): React.ReactNode {
    return this.state.error ? null : this.props.children;
  }
}

function detectTheme(): 'vs-dark' | 'light' {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return 'vs-dark';
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'vs-dark';
  return 'light';
}

function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return message ? `Monaco failed: ${message}` : 'Monaco failed to start.';
}

const MONACO_MARKER_SEVERITY = {
  hint: 1,
  info: 2,
  warning: 4,
  information: 2,
  error: 8,
} as const;

type MarkerModel = Pick<Monaco.editor.ITextModel, 'getLineCount' | 'getLineMaxColumn'>;

function safeInteger(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function clampMarkerPosition(model: MarkerModel, line: number, character: number): { lineNumber: number; column: number } {
  const lineNumber = Math.min(Math.max(safeInteger(line) + 1, 1), Math.max(1, model.getLineCount()));
  const column = Math.min(Math.max(safeInteger(character) + 1, 1), Math.max(1, model.getLineMaxColumn(lineNumber)));
  return { lineNumber, column };
}

/** Converts a zero-based, end-exclusive provider diagnostic to a clamped Monaco marker. */
export function toMonacoMarker(model: MarkerModel, diagnostic: LanguageDiagnostic): Monaco.editor.IMarkerData {
  const start = clampMarkerPosition(model, diagnostic.range.start.line, diagnostic.range.start.character);
  let end = clampMarkerPosition(model, diagnostic.range.end.line, diagnostic.range.end.character);
  if (end.lineNumber < start.lineNumber || (end.lineNumber === start.lineNumber && end.column < start.column)) {
    end = start;
  }
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
    severity: MONACO_MARKER_SEVERITY[diagnostic.severity],
    message: diagnostic.message,
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
    ...(diagnostic.code !== undefined ? { code: String(diagnostic.code) } : {}),
  };
}

export function MonacoCodeEditor({
  attempt,
  content,
  filePath,
  initialSize,
  isRenderable,
  language,
  javaSemantics,
  onChange,
  onFailure,
  onReadyChange,
  revealRequest,
  diagnostics = [],
  documentIdentity,
  diagnosticOwner = 'language-diagnostics',
}: MonacoCodeEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const markerRegistrationRef = useRef<{ model: Monaco.editor.ITextModel; owner: string; api: typeof Monaco } | null>(null);
  const semanticsRef = useRef<JavaEditorSemantics | undefined>(javaSemantics);
  const handledRevealRef = useRef<{ filePath: string; requestId: string | number } | null>(null);
  const layoutFrameRef = useRef<number | null>(null);
  const renderableRef = useRef(isRenderable);
  const readyRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  renderableRef.current = isRenderable;
  semanticsRef.current = javaSemantics;
  const semanticContext = javaSemantics?.context;
  const revealFilePath = revealRequest?.filePath;
  const revealLine = revealRequest?.line;
  const revealColumn = revealRequest?.column;
  const revealRequestId = revealRequest?.requestId;
  const hasDiagnosticDocumentIdentity = Boolean(documentIdentity);
  const diagnosticDocumentPath = documentIdentity?.path;
  const modelPath = useMemo(
    () => semanticContext?.document.path === filePath ? semanticContext.document.uri : getMonacoModelPath(filePath),
    [filePath, semanticContext?.document.path, semanticContext?.document.uri],
  );
  const monacoLanguage = useMemo(() => getMonacoLanguage(language, filePath), [filePath, language]);

  const layoutEditor = useCallback((preferredSize?: { width: number; height: number }): void => {
    const host = hostRef.current;
    const editor = editorRef.current;
    if (!host || !editor || !renderableRef.current) return;

    const rect = host.getBoundingClientRect();
    const width = Math.max(0, rect.width || host.clientWidth || preferredSize?.width || 0);
    const height = Math.max(0, rect.height || host.clientHeight || preferredSize?.height || 0);
    if (width <= 0 || height <= 0) return;

    try {
      editor.layout({ width, height });
      if (!readyRef.current) {
        readyRef.current = true;
        setMounted(true);
        onReadyChange(true);
      }
    } catch (error) {
      onFailure(describeFailure(error));
    }
  }, [onFailure, onReadyChange]);

  const scheduleLayout = useCallback((preferredSize?: { width: number; height: number }): void => {
    if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
    layoutFrameRef.current = requestAnimationFrame(() => {
      layoutFrameRef.current = null;
      layoutEditor(preferredSize);
    });
  }, [layoutEditor]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = (): void => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(0, rect.width || host.clientWidth || (isRenderable ? initialSize.width : 0));
      const height = Math.max(0, rect.height || host.clientHeight || (isRenderable ? initialSize.height : 0));
      if (isRenderable && width > 0 && height > 0) scheduleLayout({ width, height });
    };

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(host);
    if (!observer) window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', measure);
      if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
      layoutFrameRef.current = null;
    };
  }, [attempt, initialSize.height, initialSize.width, isRenderable, scheduleLayout]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!mounted || !editor || revealFilePath !== filePath || revealLine === undefined || revealRequestId === undefined) return;
    const handled = handledRevealRef.current;
    if (handled?.filePath === filePath && Object.is(handled.requestId, revealRequestId)) return;

    const model = editor.getModel();
    const requested = { lineNumber: revealLine, column: revealColumn ?? 1 };
    const position = model?.validatePosition(requested) ?? requested;
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
    editor.focus();
    handledRevealRef.current = { filePath, requestId: revealRequestId };
  }, [filePath, mounted, revealColumn, revealFilePath, revealLine, revealRequestId]);

  useEffect(() => {
    const previous = markerRegistrationRef.current;
    if (previous) {
      previous.api.editor.setModelMarkers(previous.model, previous.owner, []);
      markerRegistrationRef.current = null;
    }

    const editor = editorRef.current;
    const api = monacoRef.current;
    const model = editor?.getModel();
    const diagnosticsMatchActiveFile = !hasDiagnosticDocumentIdentity || diagnosticDocumentPath === filePath;
    if (!mounted || !api || !model || !diagnosticsMatchActiveFile) return;

    const owner = diagnosticOwner.trim() || 'language-diagnostics';
    api.editor.setModelMarkers(model, owner, diagnostics.map((diagnostic) => toMonacoMarker(model, diagnostic)));
    markerRegistrationRef.current = { model, owner, api };

    return () => {
      if (markerRegistrationRef.current?.model === model && markerRegistrationRef.current.owner === owner) {
        api.editor.setModelMarkers(model, owner, []);
        markerRegistrationRef.current = null;
      }
    };
  }, [diagnosticDocumentPath, diagnosticOwner, diagnostics, filePath, hasDiagnosticDocumentIdentity, modelPath, mounted]);

  useEffect(() => {
    const editor = editorRef.current;
    const api = monacoRef.current;
    const model = editor?.getModel();
    if (!mounted || !api || !model || monacoLanguage !== 'java' || !javaSemantics?.context) return;

    return registerJavaSemanticProviders({
      api,
      model,
      filePath,
      semantics: javaSemantics,
      getCurrentSemantics: () => semanticsRef.current,
    }).dispose;
  }, [
    filePath,
    javaSemantics,
    javaSemantics?.context?.document.path,
    javaSemantics?.context?.document.uri,
    javaSemantics?.context?.document.version,
    javaSemantics?.context?.generation,
    javaSemantics?.context?.workspaceId,
    modelPath,
    monacoLanguage,
    mounted,
  ]);

  useEffect(() => () => {
    const markers = markerRegistrationRef.current;
    if (markers) markers.api.editor.setModelMarkers(markers.model, markers.owner, []);
    markerRegistrationRef.current = null;
    editorRef.current = null;
    monacoRef.current = null;
    if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
    layoutFrameRef.current = null;
    readyRef.current = false;
  }, []);

  const handleMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    layoutEditor(initialSize);
  }, [initialSize, layoutEditor]);

  const handleBoundaryError = useCallback((error: Error) => onFailure(describeFailure(error)), [onFailure]);

  return (
    <div ref={hostRef} className="monaco-code-editor-host" data-testid="monaco-code-editor-host">
      <MonacoErrorBoundary onError={handleBoundaryError} resetKey={attempt}>
          <MonacoEditor
            key={attempt}
            height="100%"
            width="100%"
            path={modelPath}
            language={monacoLanguage}
            value={content}
            theme={detectTheme()}
            saveViewState
            keepCurrentModel
            onMount={handleMount}
            onChange={(value) => {
              const nextValue = value ?? '';
              if (nextValue !== content) onChange(nextValue);
            }}
            options={{
              ariaLabel: `Code editor for ${filePath || 'untitled file'}`,
              automaticLayout: true,
              bracketPairColorization: { enabled: true },
              codeLens: true,
              colorDecorators: true,
              cursorBlinking: 'smooth',
              folding: true,
              fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
              fontLigatures: true,
              fontSize: 14,
              formatOnPaste: false,
              glyphMargin: true,
              lineHeight: 21,
              lineNumbers: 'on',
              matchBrackets: 'always',
              minimap: { enabled: true, showSlider: 'mouseover' },
              multiCursorModifier: 'alt',
              padding: { top: 12, bottom: 12 },
              parameterHints: { enabled: true, cycle: true },
              quickSuggestions: { other: true, comments: false, strings: true },
              stickyScroll: { enabled: true },
              suggestOnTriggerCharacters: true,
              tabSize: 2,
              wordWrap: 'off',
            }}
          />
      </MonacoErrorBoundary>
    </div>
  );
}
