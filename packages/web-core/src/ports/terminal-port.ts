// ---------------------------------------------------------------------------
// @ide/web-core – TerminalPort
// ---------------------------------------------------------------------------
// Port interface for interacting with a shell / terminal process.
// Concrete adapters implement this interface.

import type { TerminalOutput } from '@ide/contracts';

export interface TerminalPort {
  /** Execute a single command (non‑interactive or typed into the shell). */
  executeCommand(command: string): Promise<void>;

  /** Resize the terminal emulator dimensions. */
  resize(cols: number, rows: number): Promise<void>;

  /**
   * Subscribe to new output lines.
   * Returns an unsubscribe function.
   */
  onOutput(callback: (output: TerminalOutput) => void): () => void;

  /**
   * Subscribe to session exit events.
   * Returns an unsubscribe function.
   */
  onExit(callback: (code: number | null) => void): () => void;
}
