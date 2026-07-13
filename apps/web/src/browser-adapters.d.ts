// ---------------------------------------------------------------------------
// apps/web/src/browser-adapters.d.ts
// App-level type surface consumed from @ide/browser-adapters.
// Keeps @ide/web type-checking against the package contract without requiring
// emitted declaration files from the referenced workspace package.
// ---------------------------------------------------------------------------

declare module '@ide/browser-adapters' {
  import type {
    FileTreePort,
    EditorPort,
    TerminalPort,
    ClipboardPort,
    LanguageSessionPort,
    Xcom2SetupMonitorPort,
    Xcom2SetupPort,
  } from '@ide/web-core/ports';

  export interface BrowserAdapters {
    fileTreeAdapter: FileTreePort;
    editorAdapter: EditorPort;
    terminalAdapter: TerminalPort & {
      startSession(): void;
      stopSession(): void;
    };
    clipboardAdapter: ClipboardPort;
    languageSessionAdapter: LanguageSessionPort;
    xcom2SetupAdapter: Xcom2SetupPort;
    xcom2SetupMonitorAdapter: Xcom2SetupMonitorPort;
  }

  export function createBrowserAdapters(): BrowserAdapters;
}
