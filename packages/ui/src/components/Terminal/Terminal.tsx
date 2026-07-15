// ---------------------------------------------------------------------------
// @ide/ui – Terminal
// Terminal component wrapping xterm.js (@xterm/xterm, @xterm/addon-fit).
// Uses xterm's native input handling (no separate HTML input line).
// Features: command history browsing (arrow up/down), clear button,
// session status indicator, proper ANSI rendering.
// ---------------------------------------------------------------------------

import { useRef, useEffect, useState, useCallback } from 'react';
import { Terminal as XtermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { TerminalOutput } from '@ide/contracts';
import '@xterm/xterm/css/xterm.css';
import { Icon } from '../ui/Icon';

export interface TerminalProps {
  /** Accumulated output lines to display. */
  output: TerminalOutput[];
  /** Called when the user submits a command. */
  onCommand: (command: string) => void;
  /** Whether a shell session is active. */
  isSessionActive: boolean;
  /** Current input line being typed (not yet submitted). */
  currentInput: string;
  /** Called when the current input changes. */
  onInputChange: (value: string) => void;
  /** Whether the terminal is initialising. */
  isLoading: boolean;
  /** Number of columns (width) for the terminal. */
  cols: number;
  /** Number of rows (height) for the terminal. */
  rows: number;
  /** Command history for arrow-up/down browsing. */
  commandHistory?: string[];
  /** Called to clear the terminal output. */
  onClear?: () => void;
}

/** ANSI colour codes for 16-colour palette (matches VS Code theme). */
const ANSI_COLORS: Record<number, string> = {
  0: '#1e1e1e',   // black
  1: '#ef4444',   // red
  2: '#22c55e',   // green
  3: '#eab308',   // yellow
  4: '#3b82f6',   // blue
  5: '#a855f7',   // magenta
  6: '#22d3ee',   // cyan
  7: '#d4d4d4',   // white
  8: '#6a6a6a',   // bright black
  9: '#ff6b6b',   // bright red
  10: '#4ade80',  // bright green
  11: '#facc15',  // bright yellow
  12: '#60a5fa',  // bright blue
  13: '#c084fc',  // bright magenta
  14: '#67e8f9',  // bright cyan
  15: '#ffffff',  // bright white
};

export function Terminal({
  output,
  onCommand,
  isSessionActive,
  currentInput,
  onInputChange,
  isLoading,
  cols,
  rows,
  commandHistory = [],
  onClear,
}: TerminalProps): JSX.Element {
  const xtermRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [xtermReady, setXtermReady] = useState(false);
  const historyIndexRef = useRef(-1);
  const historyRef = useRef(commandHistory);
  const currentInputRef = useRef(currentInput);
  const onCommandRef = useRef(onCommand);
  const onInputChangeRef = useRef(onInputChange);
  const promptRef = useRef(`\x1b[32m$\x1b[0m `);

  // Keep mutable refs in sync so the xterm key handler does not close over stale props.
  useEffect(() => {
    historyRef.current = commandHistory;
  }, [commandHistory]);

  useEffect(() => {
    currentInputRef.current = currentInput;
  }, [currentInput]);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    onInputChangeRef.current = onInputChange;
  }, [onInputChange]);

  // Initialise xterm.js with native input handling
  useEffect(() => {
    if (!xtermRef.current || terminalRef.current) return;

    const term = new XtermTerminal({
      cols: cols || 80,
      rows: rows || 24,
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        selectionBackground: '#264f78',
        cursor: '#d4d4d4',
        black: ANSI_COLORS[0],
        red: ANSI_COLORS[1],
        green: ANSI_COLORS[2],
        yellow: ANSI_COLORS[3],
        blue: ANSI_COLORS[4],
        magenta: ANSI_COLORS[5],
        cyan: ANSI_COLORS[6],
        white: ANSI_COLORS[7],
        brightBlack: ANSI_COLORS[8],
        brightRed: ANSI_COLORS[9],
        brightGreen: ANSI_COLORS[10],
        brightYellow: ANSI_COLORS[11],
        brightBlue: ANSI_COLORS[12],
        brightMagenta: ANSI_COLORS[13],
        brightCyan: ANSI_COLORS[14],
        brightWhite: ANSI_COLORS[15],
      },
      allowTransparency: false,
      convertEol: true,
      // Enable input handling
      disableStdin: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(xtermRef.current);
    fitAddon.fit();

    // Write initial prompt
    term.write(promptRef.current);

    // Track current input buffer
    let inputBuffer = '';

    // Handle key events for native input
    term.onKey((e) => {
      const { domEvent } = e;

      if (!domEvent) return;

      // Prevent default browser handling
      domEvent.preventDefault();

      if (domEvent.key === 'Enter') {
        // Submit command
        const cmd = inputBuffer;
        term.write('\r\n');
        onCommandRef.current(cmd);
        inputBuffer = '';
        historyIndexRef.current = -1;
        // Write prompt after command is processed
        term.write(promptRef.current);
        return;
      }

      if (domEvent.key === 'Backspace') {
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          term.write('\b \b'); // Erase character
        }
        return;
      }

      if (domEvent.key === 'ArrowUp') {
        // Browse command history (older)
        const history = historyRef.current;
        if (history.length === 0) return;

        const newIndex = historyIndexRef.current === -1
          ? history.length - 1
          : Math.max(0, historyIndexRef.current - 1);

        historyIndexRef.current = newIndex;
        const cmd = history[newIndex];

        // Clear current line
        const clearLen = inputBuffer.length;
        for (let i = 0; i < clearLen; i++) term.write('\b \b');
        // Write the history command
        term.write(cmd);
        inputBuffer = cmd;
        onInputChangeRef.current(cmd);
        return;
      }

      if (domEvent.key === 'ArrowDown') {
        // Browse command history (newer)
        if (historyIndexRef.current === -1) return;

        const history = historyRef.current;
        const newIndex = historyIndexRef.current + 1;
        if (newIndex >= history.length) {
          historyIndexRef.current = -1;
          // Clear and show current input
          const clearLen = inputBuffer.length;
          for (let i = 0; i < clearLen; i++) term.write('\b \b');
          inputBuffer = currentInputRef.current;
          term.write(inputBuffer);
          onInputChangeRef.current(inputBuffer);
          return;
        }

        historyIndexRef.current = newIndex;
        const cmd = history[newIndex];
        const clearLen = inputBuffer.length;
        for (let i = 0; i < clearLen; i++) term.write('\b \b');
        term.write(cmd);
        inputBuffer = cmd;
        onInputChangeRef.current(cmd);
        return;
      }

      // Printable characters
      if (!domEvent.ctrlKey && !domEvent.metaKey && domEvent.key.length === 1) {
        inputBuffer += domEvent.key;
        term.write(domEvent.key);
        onInputChangeRef.current(inputBuffer);
      }
    });

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;
    setXtermReady(true);

    return () => {
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fit on resize
  useEffect(() => {
    const handleResize = () => {
      fitAddonRef.current?.fit();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Write output lines to xterm (with proper ANSI rendering)
  useEffect(() => {
    if (!terminalRef.current) return;
    const term = terminalRef.current;

    // Write new output lines since last render
    // We use a simple approach: write all output that hasn't been written yet.
    // In a real implementation, you'd use a cursor offset tracker.
    const lastOutput = output[output.length - 1];
    if (lastOutput) {
      const color = lastOutput.type === 'stderr' ? '\x1b[31m' :
                    lastOutput.type === 'input' ? '\x1b[36m' :
                    lastOutput.type === 'system' ? '\x1b[2;3m' : '';
      term.write(`${color}${lastOutput.text}\x1b[0m\r\n`);
      // Re-write prompt after output
      term.write(promptRef.current);
    }
  }, [output]);

  // Clear terminal handler
  const handleClear = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.clear();
      terminalRef.current.write(promptRef.current);
    }
    onClear?.();
  }, [onClear]);

  return (
    <div className="h-full w-full flex flex-col bg-[#1e1e1e] glass-panel">
      {/* Terminal tab header with clear button */}
      <div className="flex items-center justify-between px-2 py-1 text-xs text-[var(--text-muted)] border-b border-[var(--border-default)] bg-[var(--surface-header)] glass-header">
        <div className="flex items-center gap-2">
          {/* Session status dot with gradient */}
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isSessionActive
                ? 'bg-[var(--accent-green)] animate-pulse gradient-accent'
                : 'bg-[var(--text-muted)]'
            }`}
          />
          <span className="text-[var(--text-secondary)] font-medium">
            {isSessionActive ? 'Session active' : 'Session inactive'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="inline-flex items-center justify-center rounded-sm p-0.5 hover:bg-[var(--highlight-bg)] transition-colors spring-pop"
            onClick={handleClear}
            aria-label="Clear terminal"
            title="Clear terminal"
          >
            <Icon type="close" size={12} className="text-[var(--text-muted)]" />
          </button>
        </div>
      </div>

      {/* xterm.js container with glass effect */}
      <div
        ref={xtermRef}
        className="flex-1 overflow-hidden px-2 py-1 glass-panel-inner"
        style={{ minHeight: 0 }}
      />

      {/* Loading overlay (shown during initialisation) */}
      {!xtermReady && isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
          <div className="shimmer-lines">
            <div className="shimmer-line shimmer-line--short" />
            <div className="shimmer-line shimmer-line--medium" />
          </div>
        </div>
      )}
    </div>
  );
}
