// ---------------------------------------------------------------------------
// @ide/web-core – Terminal View‑Model
// ---------------------------------------------------------------------------
// Wraps the terminal store and TerminalPort to provide a clean view‑model
// for UI components.

import type { TerminalStoreSlice } from '../state/terminal-store';
import type { StoreAccessor } from '../state/store-accessor';
import { toGetState } from '../state/store-accessor';
import type { TerminalPort } from '../ports/terminal-port';
import type { TerminalOutput } from '@ide/contracts';

export class TerminalViewModel {
  private unsubscribeOutput: (() => void) | null = null;
  private unsubscribeExit: (() => void) | null = null;
  private readonly getState: () => TerminalStoreSlice;

  constructor(
    store: StoreAccessor<TerminalStoreSlice>,
    private readonly port: TerminalPort,
  ) {
    this.getState = toGetState(store);
  }

  // ── State accessors ────────────────────────────────────────────────

  get output(): TerminalOutput[] {
    return this.getState().output;
  }

  get commandHistory(): string[] {
    return this.getState().commandHistory;
  }

  get isSessionActive(): boolean {
    return this.getState().isSessionActive;
  }

  get isLoading(): boolean {
    return this.getState().isLoading;
  }

  get currentInput(): string {
    return this.getState().currentInput;
  }

  get cols(): number {
    return this.getState().cols;
  }

  get rows(): number {
    return this.getState().rows;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  /** Start listening to port events. Call once during initialisation. */
  connect(): void {
    this.unsubscribeOutput = this.port.onOutput((output) => {
      this.getState().pushOutput(output);
    });

    this.unsubscribeExit = this.port.onExit((code) => {
      this.getState().setSessionActive(false);
      this.getState().pushOutput({
        text: `process exited with code ${code ?? -1}`,
        type: 'system',
        timestamp: Date.now(),
      });
    });
  }

  /** Stop listening. Call on dispose / cleanup. */
  disconnect(): void {
    this.unsubscribeOutput?.();
    this.unsubscribeExit?.();
    this.unsubscribeOutput = null;
    this.unsubscribeExit = null;
  }

  // ── Actions ────────────────────────────────────────────────────────

  /** Execute a command through the port. */
  async executeCommand(command: string): Promise<void> {
    this.getState().pushCommandHistory(command);
    await this.port.executeCommand(command);
  }

  /** Submit the current input line. */
  async submitInput(): Promise<void> {
    const input = this.getState().submitCurrentInput();
    if (input.trim()) {
      await this.port.executeCommand(input);
    }
  }

  /** Update the current input as the user types. */
  updateCurrentInput(input: string): void {
    this.getState().setCurrentInput(input);
  }

  /** Resize the terminal. */
  async resize(cols: number, rows: number): Promise<void> {
    this.getState().setDimensions(cols, rows);
    await this.port.resize(cols, rows);
  }

  /** Clear all output. */
  clearOutput(): void {
    this.getState().clearOutput();
  }
}
