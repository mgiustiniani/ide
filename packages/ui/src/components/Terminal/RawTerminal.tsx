import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { RawTerminalFeed } from "@ide/contracts";
export interface RawTerminalProps {
  feed: RawTerminalFeed;
  isRunning: boolean;
  onData(data: string): void;
  onResize(cols: number, rows: number): void;
}

/** Raw xterm transport for an owned workspace shell. It adds no prompt, line editor, or command parser. */
export function RawTerminal({ feed, isRunning, onData, onResize }: RawTerminalProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onDataRef = useRef(onData);
  const runningRef = useRef(isRunning);
  runningRef.current = isRunning;
  const onResizeRef = useRef(onResize);
  const [isReady, setIsReady] = useState(false);

  onDataRef.current = onData;
  onResizeRef.current = onResize;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const terminal = new XtermTerminal({
      cols: 80,
      rows: 24,
      allowProposedApi: false,
      allowTransparency: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      disableStdin: !runningRef.current,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      scrollback: 10_000,
      screenReaderMode: true,
      theme: {
        background: "#0f1117",
        foreground: "#d7dae0",
        cursor: "#f5f7fa",
        selectionBackground: "#264f78",
        black: "#161922",
        red: "#ef6b73",
        green: "#80c77b",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#d7dae0",
        brightBlack: "#707784",
        brightRed: "#ff7b83",
        brightGreen: "#98d893",
        brightYellow: "#f0d18f",
        brightBlue: "#78bdff",
        brightMagenta: "#d993ee",
        brightCyan: "#70cbd6",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);

    const dataDisposable = terminal.onData((data) => onDataRef.current(data));
    const resizeDisposable = terminal.onResize(({ cols, rows }) => onResizeRef.current(cols, rows));
    const unsubscribeFeed = feed.subscribe((event) => {
      if (event.kind === "reset") terminal.reset();
      if (event.data.length > 0) terminal.write(event.data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setIsReady(true);

    const fit = (): void => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
      try {
        fitAddon.fit();
      } catch {
        // A hidden activity can report transient zero geometry; the next
        // ResizeObserver notification will retry without affecting the PTY.
      }
    };
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(host);
    queueMicrotask(fit);

    return () => {
      resizeObserver.disconnect();
      unsubscribeFeed();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [feed]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.disableStdin = !isRunning;
  }, [isRunning]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0f1117]">
      <div
        ref={hostRef}
        className="h-full min-h-0 w-full overflow-hidden px-1 py-1"
        aria-label="Interactive workspace terminal"
        data-workspace-terminal="true"
      />
      {!isReady ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0f1117]/90 text-xs text-[var(--text-secondary)]"
          role="status"
        >
          Opening terminal…
        </div>
      ) : null}
    </div>
  );
}
