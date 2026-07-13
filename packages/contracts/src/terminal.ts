// ---------------------------------------------------------------------------
// @ide/contracts – Terminal Types
// ---------------------------------------------------------------------------
// Shared types for the terminal panel.

/** Type of output line emitted by the terminal. */
export type TerminalOutputType = 'stdout' | 'stderr' | 'input' | 'system';

/** A single line of terminal output. */
export interface TerminalOutput {
  /** The textual content. */
  text: string;
  /** The kind of output. */
  type: TerminalOutputType;
  /** Timestamp when the output was produced. */
  timestamp: number;
}

/** A command string entered by the user. */
export interface TerminalCommand {
  /** The raw command text. */
  command: string;
  /** Timestamp when it was submitted. */
  timestamp: number;
}

/** The overall state of the terminal panel. */
export interface TerminalState {
  /** All accumulated output lines. */
  output: TerminalOutput[];
  /** History of commands entered this session. */
  commandHistory: string[];
  /** Whether a shell session is currently active. */
  isSessionActive: boolean;
  /** Current number of columns (width) of the terminal. */
  cols: number;
  /** Current number of rows (height) of the terminal. */
  rows: number;
  /** The current input line being typed (not yet submitted). */
  currentInput: string;
  /** Whether the terminal is loading / initialising. */
  isLoading: boolean;
}
